/**
 * Renderer - UI del reporte
 */

// =============================================================================
// BACKEND: Supabase browser client (anon key + RLS).
// =============================================================================
const SUPABASE_URL = 'https://hrxfctzncixxqmpfhskv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CACHE_KEY = 'virgilio_data_v6_web';
const CACHE_TTL_MS = 5 * 60 * 1000;
const FERIADOS_API_URL = 'https://api.argentinadatos.com/v1/feriados';
const FERIADOS_CACHE_KEY = 'virgilio_feriados_v1';
const FERIADOS_TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 días

let dataActual = null;
let resultadoActual = null;       // Resultado de procesar() actual
let vistaActual = 'diario';
let empMap = new Map();           // legajo -> nombre
let empSeleccionados = new Set(); // empleados que se muestran

// Convierte timestamptz a {fecha:"DD/MM/YYYY", hora:"HH:MM:SS"} hora Argentina
function tsToFechaHora(tsIso) {
  if (!tsIso) return { fecha: '', hora: '' };
  const d = new Date(tsIso);
  if (isNaN(+d)) return { fecha: '', hora: '' };
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = {};
  fmt.formatToParts(d).forEach(p => { parts[p.type] = p.value; });
  return {
    fecha: `${parts.day}/${parts.month}/${parts.year}`,
    hora: `${parts.hour}:${parts.minute}:${parts.second}`
  };
}

async function fetchAllProduccion() {
  const all = [];
  const SIZE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('Registros_Produccion_Virgilio')
      .select('legajo, opcion, descripcion, texto, ts_cliente, ts_inicio')
      .order('ts_cliente', { ascending: true })
      .range(from, from + SIZE - 1);
    if (error) throw new Error('Supabase produccion: ' + error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < SIZE) break;
    from += SIZE;
  }
  return all.map(r => {
    const { fecha, hora } = tsToFechaHora(r.ts_cliente);
    const ini = tsToFechaHora(r.ts_inicio);
    return {
      fecha, hora,
      fechaIni: ini.fecha,
      horaIni: ini.hora,
      legajo: String(r.legajo || '').trim(),
      opcion: String(r.opcion || '').trim(),
      descripcion: String(r.descripcion || '').trim(),
      codigo: String(r.texto || '').trim()
    };
  });
}

async function fetchEmpleados() {
  const { data, error } = await sb
    .from('Empleados')
    .select('Legajo, Empleado')
    .eq('Sede', 'V')
    .eq('Activo', 'SI');
  if (error) throw new Error('Supabase empleados: ' + error.message);
  return (data || []).map(r => ({
    legajo: String(r.Legajo || '').trim(),
    nombre: String(r.Empleado || '').trim()
  })).filter(o => o.legajo);
}

async function fetchPpp() {
  const SIZE = 1000;

  const allEntregados = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from('PPP_Pedidos_Entregados')
      .select('tanda,mt3')
      .range(from, from + SIZE - 1);
    if (error) throw new Error('PPP_Pedidos_Entregados: ' + error.message);
    if (!data || data.length === 0) break;
    allEntregados.push(...data);
    if (data.length < SIZE) break;
    from += SIZE;
  }

  const allProgDiaria = [];
  from = 0;
  while (true) {
    const { data, error } = await sb
      .from('PPP_Programacion_Diaria')
      .select('tanda,m3,razon_social')
      .range(from, from + SIZE - 1);
    if (error) throw new Error('PPP_Programacion_Diaria: ' + error.message);
    if (!data || data.length === 0) break;
    allProgDiaria.push(...data);
    if (data.length < SIZE) break;
    from += SIZE;
  }

  const ppp = allEntregados.map(r => ({
    tanda: String(r.tanda == null ? '' : r.tanda).trim(),
    mt3: Number(r.mt3) || 0,
    mt3fc: 0,
    razon: ''
  })).filter(p => p.tanda);

  const pppProgDiaria = allProgDiaria.map(r => ({
    tanda: String(r.tanda == null ? '' : r.tanda).trim(),
    mt3: Number(r.m3) || 0,
    mt3fc: 0,
    razon: String(r.razon_social || '').trim()
  })).filter(p => p.tanda);

  return { ppp, pppProgDiaria };
}

async function cargarDatos(forzar = false) {
  setStatus('⏳ Cargando datos...');
  try {
    if (!forzar) {
      const cache = leerCache();
      if (cache) {
        dataActual = cache.data;
        setStatus(`✅ Cache (${edadCache(cache.ts)}) — ${dataActual.produccion.length} eventos`);
        construirEmpMap();
        return;
      }
    }
    const [produccion, operarios, pppRes] = await Promise.all([
      fetchAllProduccion(),
      fetchEmpleados(),
      fetchPpp().catch(e => {
        console.warn('PPP fallback vacío:', e.message);
        return { ppp: [], pppProgDiaria: [] };
      })
    ]);
    const data = {
      produccion,
      operarios,
      ppp: pppRes.ppp,
      pppProgDiaria: pppRes.pppProgDiaria,
      meta: { generadoEn: new Date().toISOString(), source: 'supabase' }
    };
    dataActual = data;
    guardarCache(data);
    setStatus(`✅ Cargado — ${data.produccion.length} eventos, ${(data.ppp||[]).length} pedidos, ${(data.operarios||[]).length} operarios`);
    construirEmpMap();
  } catch (err) {
    setStatus('❌ Error: ' + err.message);
    console.error(err);
  }
}

function construirEmpMap() {
  empMap = new Map();
  (dataActual?.operarios || []).forEach(o => {
    empMap.set(String(o.legajo).trim(), o.nombre);
  });
}

function nombreEmp(leg) {
  return empMap.get(String(leg).trim()) || `Legajo ${leg}`;
}

function leerCache() {
  try {
    const s = localStorage.getItem(CACHE_KEY);
    if (!s) return null;
    const o = JSON.parse(s);
    if (Date.now() - o.ts > CACHE_TTL_MS) return null;
    return o;
  } catch { return null; }
}
function guardarCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); }
  catch (e) { console.warn('No pude guardar cache:', e); }
}
function edadCache(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return s + 's';
  return Math.round(s/60) + 'min';
}
function setStatus(t) { document.getElementById('status').textContent = t; }

// =============================================================================
// FERIADOS
// =============================================================================
async function cargarFeriados() {
  // Cache local
  try {
    const s = localStorage.getItem(FERIADOS_CACHE_KEY);
    if (s) {
      const o = JSON.parse(s);
      if (Date.now() - o.ts < FERIADOS_TTL_MS) {
        CONFIG.feriadosAPI = o.feriados;
        return;
      }
    }
  } catch {}

  const yearActual = new Date().getFullYear();
  const años = [yearActual - 1, yearActual, yearActual + 1];
  const todos = [];
  for (const a of años) {
    try {
      const r = await fetch(`${FERIADOS_API_URL}/${a}`);
      if (!r.ok) continue;
      const arr = await r.json();
      arr.forEach(f => f.fecha && todos.push(f.fecha));
    } catch (e) {
      console.warn(`No se pudo cargar feriados ${a}:`, e);
    }
  }
  CONFIG.feriadosAPI = todos;
  try {
    localStorage.setItem(FERIADOS_CACHE_KEY, JSON.stringify({ ts: Date.now(), feriados: todos }));
  } catch {}
  console.log(`Feriados cargados: ${todos.length} (${años.join(', ')})`);
}

function actualizar() {
  if (!dataActual) return;
  const desde = document.getElementById('desde').value || null;
  const hasta = document.getElementById('hasta').value || null;
  const r = procesar(dataActual, desde, hasta);

  // Detectar empleados con actividad en el rango (para chips).
  // Incluye: pivotEmpleados (los que trabajaron) + crossDia (huérfanos/cross-día).
  const setLegs = new Set(Object.keys(r.pivotEmpleados));
  (r.crossDia || []).forEach(c => c.legajo && setLegs.add(c.legajo));
  const legsActivos = [...setLegs];
  renderEmpChips(legsActivos);

  // Filtrar pivot por seleccionados
  const legsMostrar = (empSeleccionados.size === 0)
    ? legsActivos
    : legsActivos.filter(l => empSeleccionados.has(l));

  renderDiarioPivot(r, legsMostrar, desde, hasta);
  renderDetalleTandas(r, legsMostrar);
  renderPersona(r);
  renderSector(r);
  renderCrossDia(r.crossDia);
  renderCrossVista(r.crossDia);
  // Guardar pares para usar en modal
  resultadoActual = r;

  const txt = `${r.reportes.length} reportes | rango: ${desde || '—'} → ${hasta || '—'}`;
  document.getElementById('metadata').textContent = txt;
  const fm = document.getElementById('footerMeta');
  if (fm) {
    const ahora = new Date().toLocaleString('es-AR');
    fm.textContent = `Generado: ${ahora}  |  ${txt}  |  Vista: ${vistaActual}`;
  }
}

// =============================================================================
// CHIPS EMPLEADOS
// =============================================================================
function renderEmpChips(legsActivos) {
  const cont = document.getElementById('empChips');
  // Construir lista única ordenada por nombre
  const items = legsActivos.map(l => ({ legajo: l, nombre: nombreEmp(l) }))
    .sort((a,b) => a.nombre.localeCompare(b.nombre));

  cont.innerHTML = '';
  // Botón "Todos"
  const btnTodos = document.createElement('button');
  btnTodos.className = 'chip todos' + (empSeleccionados.size === 0 ? ' active' : '');
  btnTodos.textContent = 'Todos';
  btnTodos.onclick = () => {
    empSeleccionados.clear();
    actualizar();
  };
  cont.appendChild(btnTodos);

  items.forEach(it => {
    const b = document.createElement('button');
    b.className = 'chip' + (empSeleccionados.has(it.legajo) ? ' active' : '');
    b.textContent = it.nombre;
    b.onclick = () => {
      if (empSeleccionados.has(it.legajo)) empSeleccionados.delete(it.legajo);
      else empSeleccionados.add(it.legajo);
      actualizar();
    };
    cont.appendChild(b);
  });
}

// =============================================================================
// VISTA DIARIO PIVOT
// =============================================================================
function renderDiarioPivot(r, legs, desde, hasta) {
  const titulo = (() => {
    if (desde && hasta) {
      const d = desde.split('-').reverse().join('/');
      const h = hasta.split('-').reverse().join('/');
      return desde === hasta ? `Reporte Diario — ${d}` : `Reporte ${d} a ${h}`;
    }
    return 'Reporte Diario';
  })();
  document.getElementById('rdTitulo').textContent = titulo;
  document.getElementById('rdTituloPrint').textContent = titulo;

  const tabla = document.getElementById('tablaPivot');
  if (!legs.length) {
    tabla.innerHTML = '<thead><tr><th>Sin datos en el rango</th></tr></thead>';
    return;
  }

  // Header doble
  let html = '<thead>';
  html += '<tr><th rowspan="2">Tarea</th>';
  legs.forEach(l => {
    html += `<th colspan="3" class="emp-name">${esc(nombreEmp(l))}</th>`;
  });
  html += '</tr><tr>';
  legs.forEach(() => {
    html += '<th class="sub-th">Hs</th><th class="sub-th">Mt3</th><th class="sub-th">Rend</th>';
  });
  html += '</tr></thead>';

  // Body
  html += '<tbody>';
  CONFIG.filasPivot.forEach((fila, idx) => {
    if (fila.tipo === 'sep') {
      html += `<tr class="sep"><td colspan="${1 + legs.length*3}">&nbsp;</td></tr>`;
      return;
    }
    const trClass = fila.tipo === 'mu' ? 'muerto'
                  : (fila.tipo === 'tot' ? 'total'
                  : (fila.tipo === 'falt' ? 'faltante' : ''));
    html += `<tr class="${trClass}"><td class="tarea-name">${esc(fila.label)}</td>`;
    legs.forEach(l => {
      const data = r.pivotEmpleados[l] || {};
      const v = celdaValores(fila, data);
      const ceroHs = v.hs === '' || v.hs === '0H 0m';
      const tieneMt3 = fila.rendType === 'mt3xh' || fila.rendType === 'hxmt3';
      // Hay olvidos para esta celda?
      const areaKeyMap = { pick:'pick', arm:'arm', cc:'cc', cr:'cr', RT:'RT', RI:'RI', EI:'EI', MG:'MG', CT:'CT', AT:'AT', PB:'PB', PC:'PC', Limp:'Limp', Perm:'Perm' };
      const areaKey = areaKeyMap[fila.key];
      const tieneOlvidos = areaKey && data[areaKey] && data[areaKey].olv > 0;
      const clickable = (!ceroHs || tieneOlvidos || fila.tipo === 'tot' || fila.key === 'faltante') && fila.tipo !== 'sep';
      const clsOlvido = tieneOlvidos ? ' tiene-olvidos' : '';
      // Si hay olvidos pero hs vacía (muerto con 0), forzar mostrar '0H 0m' para que se vea la celda clickeable
      if (tieneOlvidos && (v.hs === '' || !v.hs)) v.hs = '0H 0m';
      const dataAttr = clickable
        ? ` data-leg="${esc(l)}" data-key="${esc(fila.key)}" data-label="${esc(fila.label)}"`
        : '';
      const clsExtra = clickable ? ' celda-clickeable' : '';

      if (tieneMt3) {
        const ceroMt3 = v.mt3 === '' || v.mt3 === '0';
        const ceroRend = v.rend === '—';
        html += `<td class="num ${ceroHs?'cero':''}${clsExtra}${clsOlvido}"${dataAttr}>${v.hs}</td>`;
        html += `<td class="num ${ceroMt3?'cero':''}${clsExtra}"${dataAttr}>${v.mt3}</td>`;
        html += `<td class="num emp-end ${ceroRend?'cero':''}${clsExtra}"${dataAttr}>${v.rend}</td>`;
      } else {
        html += `<td colspan="3" class="cell-merge emp-end ${ceroHs?'cero':''}${clsExtra}${clsOlvido}"${dataAttr}>${v.hs}</td>`;
      }
    });
    html += '</tr>';
  });
  html += '</tbody>';
  tabla.innerHTML = html;
  // Adjuntar listeners a celdas clickables
  tabla.querySelectorAll('.celda-clickeable').forEach(td => {
    td.addEventListener('click', () => {
      abrirDetalleCelda(td.dataset.leg, td.dataset.key, td.dataset.label);
    });
    // Hover grupal: resalta las 3 celdas de mismo (leg, key)
    td.addEventListener('mouseenter', () => {
      const k = `${td.dataset.leg}|${td.dataset.key}`;
      tabla.querySelectorAll('.celda-clickeable').forEach(c => {
        if (`${c.dataset.leg}|${c.dataset.key}` === k) c.classList.add('grupo-hover');
      });
    });
    td.addEventListener('mouseleave', () => {
      tabla.querySelectorAll('.celda-clickeable.grupo-hover').forEach(c => c.classList.remove('grupo-hover'));
    });
  });
}

// =============================================================================
// MODAL DETALLE
// =============================================================================
function abrirDetalleCelda(legajo, filaKey, labelTarea) {
  if (!resultadoActual) return;
  const operario = nombreEmp(legajo);

  // Caso especial: Tiempo Faltante → modal de desglose distinto
  if (filaKey === 'faltante') {
    abrirDetalleFaltante(legajo);
    return;
  }
  // Caso especial: Fin de Jornada → modal comparativo
  if (filaKey === 'FJ') {
    abrirDetalleFJ(legajo);
    return;
  }

  document.getElementById('modalTitulo').textContent = `${labelTarea} — ${operario}`;
  // Restaurar tabla y ocultar secciones
  document.getElementById('modalTabla').classList.remove('hidden');
  document.getElementById('modalSecciones').classList.add('hidden');
  // Restaurar labels del footer
  const labelsOrig = ['Inicio jornada:', 'Fin jornada:', 'Total trabajado en el rango:', 'Tiempo olvidado (gaps):'];
  document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
    if (labelsOrig[i]) el.textContent = labelsOrig[i];
  });

  // Decidir columnas según fila: con Tanda/Mt3 solo Picking, Armado, CC y TOTAL
  const conTanda = ['pick','arm','cc','total'].includes(filaKey);
  const tabla = document.getElementById('modalTabla');
  if (conTanda) {
    tabla.querySelector('thead').innerHTML = '<tr><th>Tarea</th><th>Inicio</th><th>Fin</th><th>Tanda</th><th>Mt3</th><th>Hs trabajadas</th><th>Estado</th></tr>';
  } else {
    tabla.querySelector('thead').innerHTML = '<tr><th>Tarea</th><th>Inicio</th><th>Fin</th><th>Hs trabajadas</th><th>Estado</th></tr>';
  }

  // Mapear filaKey a tipo/code
  const mapKey = {
    'pick': { tipo: 'pick' },
    'arm':  { tipo: 'arm' },
    'cc':   { tipo: 'cc' },
    'cr':   { tipo: 'opTog', code: 'CR' },
    'RT':   { tipo: 'opTog', code: 'RT' },
    'RI':   { tipo: 'opTog', code: 'RI' },
    'EI':   { tipo: 'opTog', code: 'EI' },
    'MG':   { tipo: 'opTog', code: 'MG' },
    'CT':   { tipo: 'opTog', code: 'CT' },
    'AT':   { tipo: 'opTog', code: 'AT' },
    'PB':   { tipo: 'muerto', code: 'PB' },
    'PC':   { tipo: 'muerto', code: 'PC' },
    'Limp': { tipo: 'muerto', code: 'Limp' },
    'Perm': { tipo: 'muerto', code: 'Perm' },
    'total':{ tipo: 'TODOS' }   // muestra todos los pares del operario
  };
  const m = mapKey[filaKey];
  if (!m) return;

  // Filtrar pares originales
  const pares = (resultadoActual.paresOriginales || []).filter(p => {
    if (p.legajo !== legajo) return false;
    if (m.tipo === 'TODOS') return true;
    if (p.tipo !== m.tipo) return false;
    if (m.code && p.code !== m.code) return false;
    return true;
  });

  const tb = document.querySelector('#modalTabla tbody');
  tb.innerHTML = '';
  // Total trabajado: si es TOTAL (todos los pares) usar UNIÓN; si es tipo específico, sumar hs LIFO (coincide con pivot)
  const desdeUI = document.getElementById('desde').value || null;
  const hastaUI = document.getElementById('hasta').value || null;
  const inRangoFn = (iso) => (!desdeUI || iso >= desdeUI) && (!hastaUI || iso <= hastaUI);
  const intervalosRango = [];
  let cruzaIni = false, cruzaFin = false;
  let sumaHs = 0;
  pares.forEach(p => {
    (p.segmentos || []).forEach(s => {
      if (inRangoFn(fechaIso(s.fecha)) && s.dtIni && s.dtFin) {
        const dtI = new Date(s.dtIni);
        const dtF = new Date(s.dtFin);
        intervalosRango.push({ start: dtI, end: dtF });
        sumaHs += s.hs;   // hs LIFO ya descuenta solapes con otros tipos
        if (p.cruzaDia) {
          const pIni = new Date(p.inicio);
          const pFin = new Date(p.fin);
          if (fechaArg(pIni) !== s.fecha) cruzaIni = true;
          if (fechaArg(pFin) !== s.fecha) cruzaFin = true;
        }
      }
    });
  });
  const totalImputado = (filaKey === 'total') ? unionHs(intervalosRango) : sumaHs;

  // GAPS e INICIO/FIN se calculan SIEMPRE sobre TODOS los pares del operario (no solo el filtro)
  // para que coincidan en modal individual vs TOTAL.
  const todosPares = (resultadoActual.paresOriginales || []).filter(p => p.legajo === legajo);
  const intervalosTodos = [];
  todosPares.forEach(p => {
    (p.segmentos || []).forEach(s => {
      if (inRangoFn(fechaIso(s.fecha)) && s.dtIni && s.dtFin) {
        intervalosTodos.push({ start: new Date(s.dtIni), end: new Date(s.dtFin) });
      }
    });
  });

  // Inicio/Fin/Olvido se calculan sobre TODOS los pares del operario (no solo del filtro)
  let inicioStr = '—', finStr = '—', olvidado = 0;
  if (intervalosTodos.length) {
    // Detectar cruzaIni/cruzaFin sobre TODOS los pares
    let cIni = false, cFin = false;
    todosPares.forEach(p => {
      if (!p.cruzaDia) return;
      (p.segmentos || []).forEach(s => {
        if (!inRangoFn(fechaIso(s.fecha))) return;
        if (fechaArg(new Date(p.inicio)) !== s.fecha) cIni = true;
        if (fechaArg(new Date(p.fin)) !== s.fecha) cFin = true;
      });
    });

    const primerInicio = new Date(Math.min.apply(null, intervalosTodos.map(i => +i.start)));
    const ultimoFin    = new Date(Math.max.apply(null, intervalosTodos.map(i => +i.end)));
    inicioStr = horaCortaJS(primerInicio);
    finStr    = horaCortaJS(ultimoFin);
    if (cIni) inicioStr += '<span class="cross-mark" title="Continuación del día anterior">*</span>';
    if (cFin) finStr    += '<span class="cross-mark" title="Continúa al día siguiente">*</span>';

    // Tiempo olvidado = gaps DENTRO de cada día usando TODOS los pares
    const segsPorDia = {};
    intervalosTodos.forEach(iv => {
      const fecha = fechaArg(iv.start);
      (segsPorDia[fecha] = segsPorDia[fecha] || []).push(iv);
    });
    Object.values(segsPorDia).forEach(segs => {
      const start = Math.min.apply(null, segs.map(s => +s.start));
      const end   = Math.max.apply(null, segs.map(s => +s.end));
      const presenciaHs = (end - start) / 36e5;
      const trabajado   = unionHs(segs);
      olvidado += Math.max(0, presenciaHs - trabajado);
    });
  }
  document.getElementById('modalInicio').innerHTML = inicioStr;
  document.getElementById('modalFin').innerHTML    = finStr;
  document.getElementById('modalTotal').textContent = fmtHs(totalImputado);
  document.getElementById('modalOlvidado').textContent = fmtHs(olvidado);

  // Calcular gaps por día usando TODOS los pares del operario (no solo del filtro)
  const segsPorDiaParaGaps = {};
  todosPares.forEach(p => {
    (p.segmentos || []).forEach(s => {
      if (inRangoFn(fechaIso(s.fecha)) && s.dtIni && s.dtFin) {
        (segsPorDiaParaGaps[s.fecha] = segsPorDiaParaGaps[s.fecha] || []).push({ start: new Date(s.dtIni), end: new Date(s.dtFin) });
      }
    });
  });
  // Para cada día, mergear intervalos y encontrar gaps
  const gapsList = [];  // {fecha, inicio, fin, hs}
  Object.entries(segsPorDiaParaGaps).forEach(([fecha, segs]) => {
    if (segs.length < 2) return;
    const sorted = segs.slice().sort((a,b) => a.start - b.start);
    // Mergear solapados
    const merged = [];
    let cur = { start: sorted[0].start, end: sorted[0].end };
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].start <= cur.end) {
        if (sorted[i].end > cur.end) cur.end = sorted[i].end;
      } else {
        merged.push(cur);
        cur = { start: sorted[i].start, end: sorted[i].end };
      }
    }
    merged.push(cur);
    // Detectar gaps entre tramos mergeados
    for (let i = 1; i < merged.length; i++) {
      const gapHs = (merged[i].start - merged[i-1].end) / 36e5;
      if (gapHs > 0.0167) {  // > 1 min
        gapsList.push({ fecha, inicio: merged[i-1].end, fin: merged[i].start, hs: gapHs });
      }
    }
  });

  if (!pares.length) {
    const cs = conTanda ? 7 : 5;
    tb.innerHTML = `<tr><td colspan="${cs}" class="dim">Sin eventos</td></tr>`;
  } else {
    const star = '<span class="est-star" title="Estimado: aún sin facturar">*</span>';
    pares.sort((a,b) => new Date(a.inicio) - new Date(b.inicio));
    const tipoLabel = {
      pick: 'Picking', arm: 'Armado', cc: 'Carga Camión',
      opTog: '', muerto: ''
    };
    const codeLabel = {
      CR:'Control Remitos', RT:'Recep. Mercadería', RI:'Recep. Insumos',
      EI:'Entrega Insumos', MG:'Góndola', CT:'Conteo', AT:'Atendí Timbre',
      PB:'Baño', PC:'Almuerzo', Limp:'Limpieza', Perm:'Permiso'
    };
    // Construir lista mixta: pares + gaps ordenados cronológicamente
    const items = pares.map(p => ({ kind: 'par', sortKey: +new Date(p.inicio), data: p }))
      .concat(gapsList.map(g => ({ kind: 'gap', sortKey: +g.inicio, data: g })));
    items.sort((a,b) => a.sortKey - b.sortKey);

    items.forEach(it => {
      if (it.kind === 'gap') {
        const g = it.data;
        const fInicio = `${pad(g.inicio.getDate())}/${pad(g.inicio.getMonth()+1)} ${horaCortaJS(g.inicio)}`;
        const fFin    = `${pad(g.fin.getDate())}/${pad(g.fin.getMonth()+1)} ${horaCortaJS(g.fin)}`;
        const colsGap = conTanda ? '<td>—</td><td>—</td>' : '';
        tb.innerHTML += `
          <tr class="gap-row">
            <td><b>⚠ TIEMPO OLVIDADO</b></td>
            <td>${fInicio}</td>
            <td>${fFin}</td>
            ${colsGap}
            <td class="num"><b>${fmtHs(g.hs)}</b></td>
            <td><b>Sin actividad registrada</b></td>
          </tr>`;
        return;
      }
      const p = it.data;
      const ini = new Date(p.inicio);
      const fin = new Date(p.fin);
      const fInicio = `${pad(ini.getDate())}/${pad(ini.getMonth()+1)} ${pad(ini.getHours())}:${pad(ini.getMinutes())}`;
      const fFin    = `${pad(fin.getDate())}/${pad(fin.getMonth()+1)} ${pad(fin.getHours())}:${pad(fin.getMinutes())}`;
      let estado;
      if (p.olvidado) {
        estado = '<span class="exc">⚠ Olvido (descartado)</span>';
      } else if (p.cruzaDia) {
        // Hs trabajadas en cada extremo
        const finJorIni = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate(), 17, 0, 0);
        const hsDiaInicio = ini < finJorIni ? (finJorIni - ini) / 36e5 : 0;
        const inicioJorFin = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate(), 8, 0, 0);
        const hsDiaFin = fin > inicioJorFin ? (fin - inicioJorFin) / 36e5 : 0;

        // Determinar si el rango filtrado incluye el día de inicio o el de fin
        const isoIni = fechaIso(fechaArg(ini));
        const isoFin = fechaIso(fechaArg(fin));
        const desdeUI = document.getElementById('desde').value || null;
        const hastaUI = document.getElementById('hasta').value || null;
        const inRango = (iso) => (!desdeUI || iso >= desdeUI) && (!hastaUI || iso <= hastaUI);
        const iniIn = inRango(isoIni);
        const finIn = inRango(isoFin);

        if (iniIn && finIn) {
          estado = `<span style="color:#d97706">↪ Cross-día (interno al rango)</span>`;
        } else if (finIn) {
          // Vista del día de cierre: trajo +ayer
          estado = `<span style="color:#d97706" title="Trabajó ${fmtHs(hsDiaInicio)} el día anterior">↪ Cross-día (+${fmtHs(hsDiaInicio)} ayer)</span>`;
        } else {
          // Vista del día de inicio: deja +mañana
          estado = `<span style="color:#d97706" title="Continúa mañana ${fmtHs(hsDiaFin)}">↪ Cross-día (+${fmtHs(hsDiaFin)} mañana)</span>`;
        }
      } else {
        estado = '<span style="color:#28a745">✓ OK</span>';
      }

      let mt3Html = '<span class="dim">—</span>';
      if (p.tanda) {
        const det = buscarMt3Detalle(p.tanda);
        if (det.mt3fc > 0) {
          mt3Html = `${num3(det.mt3fc)} <span class="dim" style="font-size:0.85em">FC</span>`;
        } else if (det.mt3 > 0) {
          mt3Html = `${num3(det.mt3)}${star}`;
        }
      }

      const labelTarea = (p.tipo === 'opTog' || p.tipo === 'muerto')
        ? (codeLabel[p.code] || p.code)
        : (tipoLabel[p.tipo] || p.tipo);
      const colorTarea = (p.tipo === 'muerto') ? '#b04400' : '#1e6bd6';

      // Hs aportadas al rango filtrado por este par (suma segmentos cuya fecha está en el rango)
      const hsRango = (p.segmentos || []).reduce((s, seg) => s + (inRangoFn(fechaIso(seg.fecha)) ? seg.hs : 0), 0);
      const colsTanda = conTanda
        ? `<td><b>${esc(p.tanda || '—')}</b></td><td class="num">${mt3Html}</td>`
        : '';
      tb.innerHTML += `
        <tr>
          <td><b style="color:${colorTarea}">${esc(labelTarea)}</b></td>
          <td>${fInicio}</td>
          <td>${fFin}</td>
          ${colsTanda}
          <td class="num">${fmtHs(hsRango)}</td>
          <td>${estado}</td>
        </tr>`;
    });
  }
  document.getElementById('modalDetalle').classList.remove('hidden');
}
function pad(n) { return String(n).padStart(2,'0'); }
function horaCortaJS(dt) { return `${pad(dt.getHours())}:${pad(dt.getMinutes())}`; }

function lunesDeSemana(fecha) {
  const d = new Date(fecha);
  const dow = d.getDay() || 7;  // dom=7
  d.setDate(d.getDate() - dow + 1);
  d.setHours(0,0,0,0);
  return d;
}
function keySemana(fecha) {
  const lun = lunesDeSemana(fecha);
  return `${lun.getFullYear()}-${String(lun.getMonth()+1).padStart(2,'0')}-${String(lun.getDate()).padStart(2,'0')}`;
}
function labelSemana(keyLunes) {
  const lun = new Date(keyLunes);
  const dom = new Date(lun);
  dom.setDate(dom.getDate() + 6);
  const fmt = d => `${pad(d.getDate())}/${pad(d.getMonth()+1)}`;
  return `${fmt(lun)} - ${fmt(dom)}`;
}

function abrirDesgloseSemanal(sectorKey, nombreSector) {
  if (!resultadoActual) return;
  document.getElementById('modalTitulo').textContent = `${nombreSector} — Desglose semanal`;
  document.getElementById('modalTabla').classList.remove('hidden');
  document.getElementById('modalSecciones').classList.add('hidden');

  // Restaurar labels del footer
  const labelsOrig = ['Inicio jornada:', 'Fin jornada:', 'Total trabajado en el rango:', 'Tiempo olvidado (gaps):'];
  document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
    if (labelsOrig[i]) el.textContent = labelsOrig[i];
  });

  // Agrupar reportes por semana
  const porSem = {};  // key -> { hs, tandas:Set, operarios:Set, dias:Set }
  resultadoActual.reportes.forEach(r => {
    let hs = 0, pares = [];
    if (sectorKey === 'pick') { hs = r.pickHs; pares = r.pickPairs; }
    else if (sectorKey === 'arm') { hs = r.armHs; pares = r.armPairs; }
    else if (sectorKey === 'cc')  { hs = r.ccHs;  pares = r.ccPairs; }
    if (hs <= 0) return;
    // Convertir r.fecha (DD/MM/YYYY) a Date
    const m = r.fecha.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return;
    const d = new Date(+m[3], +m[2]-1, +m[1]);
    const k = keySemana(d);
    if (!porSem[k]) porSem[k] = { hs: 0, tandas: new Set(), operarios: new Set(), dias: new Set() };
    porSem[k].hs += hs;
    porSem[k].dias.add(r.fecha);
    porSem[k].operarios.add(r.legajo);
    pares.forEach(p => p.tanda && porSem[k].tandas.add(p.tanda));
  });

  // Buscar Mt3 por tandas únicas de cada semana
  const star = '<span class="est-star" title="Estimado: aún sin facturar">*</span>';
  function mt3DeTandas(tandas) {
    let mt3 = 0, est = false;
    tandas.forEach(t => {
      // Buscar en PPP principal + ProgDiaria
      let rows;
      if (CONFIG.aliasEspeciales[t]) {
        const re = CONFIG.aliasEspeciales[t];
        rows = (dataActual.ppp || []).filter(p => re.test(p.razon));
        if (rows.length === 0) rows = (dataActual.pppProgDiaria || []).filter(p => re.test(p.razon));
      } else {
        rows = (dataActual.ppp || []).filter(p => p.tanda === t);
        if (rows.length === 0) rows = (dataActual.pppProgDiaria || []).filter(p => p.tanda === t);
      }
      const fc = rows.reduce((s,p) => s + (p.mt3fc || 0), 0);
      if (fc > 0) mt3 += fc;
      else {
        const est_ = rows.reduce((s,p) => s + (p.mt3 || 0), 0);
        if (est_ > 0) { mt3 += est_; est = true; }
      }
    });
    return { mt3, est };
  }

  // Header
  const tabla = document.getElementById('modalTabla');
  tabla.querySelector('thead').innerHTML = '<tr><th>Semana</th><th>Hs</th><th>Mt3</th><th>Mt3/h</th><th>Días</th><th>Tandas</th><th>Operarios</th></tr>';

  const tb = tabla.querySelector('tbody');
  tb.innerHTML = '';
  const keys = Object.keys(porSem).sort();
  if (keys.length === 0) {
    tb.innerHTML = '<tr><td colspan="7" class="dim">Sin actividad</td></tr>';
  } else {
    let totalHs = 0, totalMt3 = 0, totalEst = false;
    const totalTandasUnicas = new Set();
    keys.forEach(k => {
      const sem = porSem[k];
      const { mt3, est } = mt3DeTandas(sem.tandas);
      const mt3xh = (sem.hs > 0 && mt3 > 0) ? (mt3 / sem.hs) : 0;
      const sStar = est && mt3 > 0 ? star : '';
      tb.innerHTML += `
        <tr>
          <td><b>${labelSemana(k)}</b></td>
          <td>${fmtHs(sem.hs)}</td>
          <td class="num">${num3(mt3)}${sStar}</td>
          <td class="num">${mt3xh > 0 ? mt3xh.toFixed(3) + sStar : '<span class="dim">—</span>'}</td>
          <td class="num">${sem.dias.size}</td>
          <td class="num">${sem.tandas.size}</td>
          <td class="num">${sem.operarios.size}</td>
        </tr>`;
      totalHs += sem.hs;
      sem.tandas.forEach(t => totalTandasUnicas.add(t));
    });
    const { mt3: totMt3, est: totEst } = mt3DeTandas(totalTandasUnicas);
    totalMt3 = totMt3; totalEst = totEst;

    // Footer del modal - usar el modal-total-box existente
    document.getElementById('modalInicio').textContent = fmtHs(totalHs);
    document.getElementById('modalFin').textContent = num3(totalMt3) + (totalEst ? ' *' : '');
    document.getElementById('modalTotal').textContent = totalHs > 0 && totalMt3 > 0 ? (totalMt3/totalHs).toFixed(3) : '—';
    document.getElementById('modalOlvidado').textContent = String(totalTandasUnicas.size);
    // Cambiar labels
    const labelsSem = ['Total Hs:', 'Total Mt3:', 'Promedio Mt3/h:', 'Tandas únicas:'];
    document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
      if (labelsSem[i]) el.textContent = labelsSem[i];
    });
  }

  document.getElementById('modalDetalle').classList.remove('hidden');
}

function abrirDetalleFaltante(legajo) {
  if (!resultadoActual) return;
  const operario = nombreEmp(legajo);
  document.getElementById('modalTitulo').textContent = `Tiempo Faltante — ${operario}`;
  document.getElementById('modalTabla').classList.remove('hidden');
  document.getElementById('modalSecciones').classList.add('hidden');

  // Sumar tarde, temprano, gap del operario en el rango
  const reportesLeg = resultadoActual.reportes.filter(r => r.legajo === legajo);
  let totalTarde = 0, totalTemprano = 0, totalGap = 0;
  const detallesDias = [];
  reportesLeg.forEach(r => {
    const t = r.llegadaTarde || 0;
    const s = r.salidaTemprana || 0;
    const g = r.gapHs || 0;
    if (t > 0 || s > 0 || g > 0) {
      detallesDias.push({ fecha: r.fecha, tarde: t, temprano: s, gap: g, inicio: r.inicio, fin: r.fin });
    }
    totalTarde += t;
    totalTemprano += s;
    totalGap += g;
  });

  // Header del modal
  const tabla = document.getElementById('modalTabla');
  tabla.querySelector('thead').innerHTML = '<tr><th>Día</th><th>Inicio</th><th>Fin</th><th>Llegada Tarde</th><th>Salida Temprana</th><th>Olvidado (gaps)</th><th>Total faltante</th></tr>';
  const tb = tabla.querySelector('tbody');
  tb.innerHTML = '';
  if (detallesDias.length === 0) {
    tb.innerHTML = '<tr><td colspan="7" class="dim">Sin tiempo faltante</td></tr>';
  } else {
    detallesDias.forEach(d => {
      const tot = d.tarde + d.temprano + d.gap;
      tb.innerHTML += `
        <tr>
          <td><b>${esc(d.fecha)}</b></td>
          <td>${d.inicio}</td>
          <td>${d.fin}</td>
          <td class="num">${d.tarde > 0 ? fmtHs(d.tarde) : '<span class="dim">—</span>'}</td>
          <td class="num">${d.temprano > 0 ? fmtHs(d.temprano) : '<span class="dim">—</span>'}</td>
          <td class="num">${d.gap > 0 ? fmtHs(d.gap) : '<span class="dim">—</span>'}</td>
          <td class="num"><b>${fmtHs(tot)}</b></td>
        </tr>`;
    });
  }

  // Footer: totales
  document.getElementById('modalInicio').textContent = fmtHs(totalTarde);
  document.getElementById('modalFin').textContent    = fmtHs(totalTemprano);
  document.getElementById('modalTotal').textContent  = fmtHs(totalGap);
  document.getElementById('modalOlvidado').textContent = fmtHs(totalTarde + totalTemprano + totalGap);

  // Cambiar labels del footer para este modal especial
  document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
    const labels = ['Llegada Tarde:', 'Salida Temprana:', 'Olvidado (gaps):', 'Total faltante:'];
    if (labels[i]) el.textContent = labels[i];
  });

  document.getElementById('modalDetalle').classList.remove('hidden');
}
function abrirDetalleFJ(legajo) {
  if (!resultadoActual) return;
  const operario = nombreEmp(legajo);
  const pivot = resultadoActual.pivotEmpleados[legajo] || {};
  const fj = pivot.FJ || { dias: [] };

  document.getElementById('modalTitulo').textContent = `Fin de Jornada — ${operario}`;
  document.getElementById('modalTabla').classList.remove('hidden');
  document.getElementById('modalSecciones').classList.add('hidden');

  const tabla = document.getElementById('modalTabla');
  tabla.querySelector('thead').innerHTML =
    '<tr><th>Día</th><th>Hora FJ</th><th>Opción</th><th>Reportado celular</th><th>Recibido Supabase</th><th>Diferencia</th></tr>';
  const tb = tabla.querySelector('tbody');
  tb.innerHTML = '';

  let totalMismatches = 0, totalRep = 0, totalAct = 0;
  if (fj.dias.length === 0) {
    tb.innerHTML = '<tr><td colspan="6" class="dim">Sin FJ registrado en el rango</td></tr>';
  } else {
    // Ordenar por fecha asc
    const dias = fj.dias.slice().sort((a,b) => (a.fecha||'').localeCompare(b.fecha||''));
    dias.forEach(d => {
      // Unión de opciones reportadas y recibidas
      const opciones = new Set([
        ...Object.keys(d.reportado || {}),
        ...Object.keys(d.actual || {})
      ]);
      const arr = [...opciones].sort();
      if (arr.length === 0) {
        tb.innerHTML += `<tr><td><b>${esc(d.fecha)}</b></td><td>${(d.hora||'').slice(0,5)}</td><td colspan="4" class="dim">Sin eventos</td></tr>`;
        return;
      }
      arr.forEach((op, i) => {
        const rep = (d.reportado || {})[op] || 0;
        const act = (d.actual || {})[op] || 0;
        const diff = rep - act;
        const cls = diff !== 0 ? 'tiene-olvidos' : '';
        totalRep += rep; totalAct += act;
        if (diff !== 0) totalMismatches++;
        const diaCell = i === 0 ? `<td rowspan="${arr.length}"><b>${esc(d.fecha)}</b></td><td rowspan="${arr.length}">${(d.hora||'').slice(0,5)}</td>` : '';
        const diffTxt = diff === 0 ? '<span class="dim">—</span>' : (diff > 0 ? `⚠️ +${diff} faltan` : `⚠️ ${diff} sobran`);
        tb.innerHTML += `<tr class="${cls}">${diaCell}<td>${esc(op)}</td><td class="num">${rep}</td><td class="num">${act}</td><td class="num">${diffTxt}</td></tr>`;
      });
    });
  }

  // Footer
  document.getElementById('modalInicio').textContent = fj.dias.length;
  document.getElementById('modalFin').textContent    = totalRep;
  document.getElementById('modalTotal').textContent  = totalAct;
  document.getElementById('modalOlvidado').textContent = totalMismatches > 0 ? `⚠️ ${totalMismatches}` : '0';

  document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
    const labels = ['Días con FJ:', 'Total reportado:', 'Total recibido:', 'Opciones con discrepancia:'];
    if (labels[i]) el.textContent = labels[i];
  });

  document.getElementById('modalDetalle').classList.remove('hidden');
}

function cerrarModal() {
  document.getElementById('modalDetalle').classList.add('hidden');
}
// Tecla ESC cierra modal
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cerrarModal();
});

function celdaValores(fila, data) {
  if (fila.tipo === 'tot') {
    return {
      hs:  fmtHs(data.totHs || 0),
      mt3: '—',
      rend: '—'
    };
  }
  if (fila.tipo === 'fj') {
    const fj = data.FJ || { dias: [], hayFJ: false };
    if (!fj.hayFJ) return { hs: '', mt3: '—', rend: '—' };
    const conMismatch = fj.dias.some(d => d.mismatches && d.mismatches.length);
    const marca = conMismatch ? '⚠️' : '✓';
    if (fj.dias.length === 1) {
      const h = (fj.dias[0].hora || '').slice(0, 5);
      return { hs: `${marca} ${h}`, mt3: '—', rend: '—' };
    }
    return { hs: `${marca} ${fj.dias.length} días`, mt3: '—', rend: '—' };
  }
  let hs = 0, mt3 = 0, est = false;
  switch (fila.key) {
    case 'pick': hs = data.pick?.hs || 0; mt3 = data.pick?.mt3 || 0; est = !!data.pick?.est; break;
    case 'arm':  hs = data.arm?.hs || 0;  mt3 = data.arm?.mt3 || 0;  est = !!data.arm?.est;  break;
    case 'cc':   hs = data.cc?.hs || 0;  mt3 = data.cc?.mt3 || 0;   est = !!data.cc?.est;   break;
    case 'cr':   hs = data.cr?.hs || 0; break;
    case 'RT':   hs = data.RT?.hs || 0; break;
    case 'RI':   hs = data.RI?.hs || 0; break;
    case 'EI':   hs = data.EI?.hs || 0; break;
    case 'MG':   hs = data.MG?.hs || 0; break;
    case 'CT':   hs = data.CT?.hs || 0; break;
    case 'AT':   hs = data.AT?.hs || 0; break;
    case 'PB':   hs = data.PB?.hs || 0; break;
    case 'PC':   hs = data.PC?.hs || 0; break;
    case 'Limp': hs = data.Limp?.hs || 0; break;
    case 'Perm': hs = data.Perm?.hs || 0; break;
    case 'tarde':    hs = data.tarde?.hs || 0; break;
    case 'temprano': hs = data.temprano?.hs || 0; break;
    case 'faltante': hs = data.faltante?.hs || 0; break;
  }
  const star = est ? '<span class="est-star" title="Estimado: aún sin facturar">*</span>' : '';
  let rend = '—';
  if (fila.rendType === 'mt3xh' && hs > 0 && mt3 > 0) rend = (mt3/hs).toFixed(2) + ' Mt3/h' + star;
  if (fila.rendType === 'hxmt3' && hs > 0 && mt3 > 0) rend = fmtHs(hs/mt3) + '/Mt3' + star;
  return {
    hs:  fila.tipo === 'mu' ? (hs > 0 ? fmtHs(hs) : '') : fmtHs(hs),
    mt3: fila.tipo === 'mu' ? '—' : (mt3 > 0 ? (num3(mt3) + star) : (hs > 0 ? '0' : '')),
    rend: rend
  };
}

// =============================================================================
// VISTA PERSONA (sin cambios)
// =============================================================================
function renderPersona(r) {
  const tb = document.querySelector('#tablaPersona tbody');
  tb.innerHTML = '';
  if (!r.porPersona.length) {
    tb.innerHTML = '<tr><td colspan="14" class="dim">Sin datos</td></tr>';
    return;
  }
  const star = '<span class="est-star" title="Estimado: aún sin facturar">*</span>';
  r.porPersona.forEach(g => {
    const pickStar = g.pickEst && g.pickMt3 > 0 ? star : '';
    const armStar  = g.armEst  && g.armMt3 > 0  ? star : '';
    const ccStar   = g.ccEst   && g.ccMt3 > 0   ? star : '';
    const dataLeg = esc(g.legajo);
    const cellsPick = g.pickHs > 0 ? `class="celda-area" data-leg="${dataLeg}" data-area="pick"` : '';
    const cellsArm  = g.armHs  > 0 ? `class="celda-area" data-leg="${dataLeg}" data-area="arm"`  : '';
    const cellsCc   = g.ccHs   > 0 ? `class="celda-area" data-leg="${dataLeg}" data-area="cc"`   : '';
    const cellOp    = g.opHs   > 0 ? `class="celda-area" data-leg="${dataLeg}" data-area="op"`   : '';
    const cellMu    = g.muertoHs > 0 ? `class="celda-area" data-leg="${dataLeg}" data-area="mu"` : '';
    const cellTot   = g.totHs  > 0 ? `class="celda-area" data-leg="${dataLeg}" data-area="total"`: '';
    tb.innerHTML += `
      <tr>
        <td><b>${esc(nombreEmp(g.legajo))}</b></td>
        <td ${cellsPick}>${fmtHs(g.pickHs)}</td>
        <td ${cellsPick} class="num celda-area">${num3(g.pickMt3)}${pickStar}</td>
        <td ${cellsPick} class="num celda-area">${ratio(g.pickMt3, g.pickHs)}${pickStar}</td>
        <td ${cellsArm}>${fmtHs(g.armHs)}</td>
        <td ${cellsArm} class="num celda-area">${num3(g.armMt3)}${armStar}</td>
        <td ${cellsArm} class="num celda-area">${ratio(g.armMt3, g.armHs)}${armStar}</td>
        <td ${cellsCc}>${fmtHs(g.ccHs)}</td>
        <td ${cellsCc} class="num celda-area">${num3(g.ccMt3)}${ccStar}</td>
        <td ${cellsCc}>${g.ccHs > 0 && g.ccMt3 > 0 ? (fmtHs(g.ccHs / g.ccMt3) + ccStar) : '<span class="dim">—</span>'}</td>
        <td ${cellOp}>${fmtHs(g.opHs)}</td>
        <td ${cellMu}>${fmtHs(g.muertoHs)}</td>
        <td ${cellTot}>${fmtHs(g.totHs)}</td>
        <td class="num">${g.dias}</td>
      </tr>`;
  });
  // Click handlers en celdas de área
  tb.querySelectorAll('td.celda-area[data-leg]').forEach(td => {
    td.addEventListener('click', () => abrirDesglosePersonaArea(td.dataset.leg, td.dataset.area));
  });
  // Hover grupal (resaltar las 3 celdas del mismo área)
  tb.querySelectorAll('td.celda-area[data-leg]').forEach(td => {
    td.addEventListener('mouseenter', () => {
      const k = `${td.dataset.leg}|${td.dataset.area}`;
      tb.querySelectorAll('td.celda-area').forEach(c => {
        if (`${c.dataset.leg}|${c.dataset.area}` === k) c.classList.add('grupo-hover-persona');
      });
    });
    td.addEventListener('mouseleave', () => {
      tb.querySelectorAll('td.grupo-hover-persona').forEach(c => c.classList.remove('grupo-hover-persona'));
    });
  });
}

function abrirDesglosePersonaCompuesto(legajo, area) {
  const operario = nombreEmp(legajo);
  const config = {
    op: {
      titulo: 'Op Total',
      subareas: [
        { k:'pick', l:'Picking' }, { k:'arm', l:'Armado' }, { k:'cc', l:'CC' },
        { k:'CR', l:'Ctrl Rem.' }, { k:'RT', l:'Recep Merc' }, { k:'RI', l:'Recep Ins' },
        { k:'EI', l:'Entrega Ins' }, { k:'MG', l:'Góndola' }, { k:'CT', l:'Conteo' }, { k:'AT', l:'Timbre' }
      ]
    },
    mu: {
      titulo: 'Muerto',
      subareas: [
        { k:'PB', l:'Baño' }, { k:'PC', l:'Almuerzo' }, { k:'Limp', l:'Limpieza' }, { k:'Perm', l:'Permiso' }
      ]
    },
    total: {
      titulo: 'Total',
      subareas: [
        { k:'op', l:'Op Total' }, { k:'mu', l:'Muerto' }, { k:'total', l:'TOTAL' }
      ]
    }
  };
  const cfg = config[area];
  document.getElementById('modalTitulo').textContent = `${operario} — ${cfg.titulo} (desglose semanal)`;
  document.getElementById('modalTabla').classList.remove('hidden');
  document.getElementById('modalSecciones').classList.add('hidden');

  // Acumular: día → cada subárea → hs
  const porDia = {};   // key fecha DD/MM/YYYY (ordenable)
  resultadoActual.reportes.forEach(r => {
    if (r.legajo !== legajo) return;
    const k = r.fecha;
    if (!porDia[k]) porDia[k] = { vals: {} };
    const g = porDia[k];
    cfg.subareas.forEach(sa => {
      let hs = 0;
      if (sa.k === 'pick') hs = r.pickHs;
      else if (sa.k === 'arm') hs = r.armHs;
      else if (sa.k === 'cc')  hs = r.ccHs;
      else if (sa.k === 'op')  hs = r.opHs;
      else if (sa.k === 'mu')  hs = r.muertoHs;
      else if (sa.k === 'total') hs = r.totHs;
      else if (r.opTogPorCode && r.opTogPorCode[sa.k] !== undefined) hs = r.opTogPorCode[sa.k];
      else if (r.muertoPorTipo && r.muertoPorTipo[sa.k]) hs = r.muertoPorTipo[sa.k].hs;
      g.vals[sa.k] = (g.vals[sa.k] || 0) + hs;
    });
  });

  // Render tabla
  const tabla = document.getElementById('modalTabla');
  let thead = '<tr><th>Día</th>';
  cfg.subareas.forEach(sa => { thead += `<th>${sa.l}</th>`; });
  thead += '</tr>';
  tabla.querySelector('thead').innerHTML = thead;

  const tb = tabla.querySelector('tbody');
  tb.innerHTML = '';
  const keys = Object.keys(porDia).sort((a,b) => {
    const ma = a.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const mb = b.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return new Date(+ma[3], +ma[2]-1, +ma[1]) - new Date(+mb[3], +mb[2]-1, +mb[1]);
  });
  const totales = {};
  cfg.subareas.forEach(sa => totales[sa.k] = 0);

  if (keys.length === 0) {
    tb.innerHTML = `<tr><td colspan="${cfg.subareas.length+1}" class="dim">Sin actividad</td></tr>`;
  } else {
    keys.forEach(k => {
      const dia = porDia[k];
      let row = `<tr><td><b>${k}</b></td>`;
      cfg.subareas.forEach(sa => {
        const v = dia.vals[sa.k] || 0;
        totales[sa.k] += v;
        row += `<td class="${v===0?'cero':''}">${v > 0 ? fmtHs(v) : '—'}</td>`;
      });
      row += '</tr>';
      tb.innerHTML += row;
    });
    // Fila TOTAL
    let totalRow = '<tr class="row-total"><td><b>TOTAL</b></td>';
    cfg.subareas.forEach(sa => {
      const v = totales[sa.k];
      totalRow += `<td><b>${v > 0 ? fmtHs(v) : '—'}</b></td>`;
    });
    totalRow += '</tr>';
    tb.innerHTML += totalRow;
  }

  // Footer: total global
  const sumaTot = Object.values(totales).reduce((a,b) => a+b, 0);
  document.getElementById('modalInicio').textContent = String(keys.length);
  document.getElementById('modalFin').textContent    = '—';
  document.getElementById('modalTotal').textContent  = fmtHs(area === 'total' ? totales.total : sumaTot);
  document.getElementById('modalOlvidado').textContent = '—';
  const labelsP = ['Días con actividad:', '', 'Total Hs:', ''];
  document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
    if (labelsP[i]) el.textContent = labelsP[i];
  });

  document.getElementById('modalDetalle').classList.remove('hidden');
}

function abrirDesglosePersonaArea(legajo, area) {
  if (!resultadoActual) return;
  // Para Op total, Muerto, Total → pivot por sub-área (más rico)
  if (area === 'op' || area === 'mu' || area === 'total') {
    return abrirDesglosePersonaCompuesto(legajo, area);
  }
  const operario = nombreEmp(legajo);
  const labels = { pick:'Picking', arm:'Armado Pedido', cc:'Carga Camión' };
  document.getElementById('modalTitulo').textContent = `${operario} — ${labels[area]}`;
  document.getElementById('modalTabla').classList.remove('hidden');
  document.getElementById('modalSecciones').classList.add('hidden');

  // Agrupar por día
  const porDia = {};
  resultadoActual.reportes.forEach(r => {
    if (r.legajo !== legajo) return;
    const k = r.fecha;
    if (!porDia[k]) porDia[k] = { hs:0, tandas:new Set() };
    const g = porDia[k];
    let hs = 0, pares = [];
    if (area === 'pick') { hs = r.pickHs; pares = r.pickPairs; }
    else if (area === 'arm') { hs = r.armHs; pares = r.armPairs; }
    else if (area === 'cc')  { hs = r.ccHs;  pares = r.ccPairs; }
    g.hs += hs;
    pares.forEach(p => p.tanda && g.tandas.add(p.tanda));
  });

  function mt3DeTandas(tandas) {
    let mt3 = 0, est = false;
    tandas.forEach(t => {
      let rows;
      if (CONFIG.aliasEspeciales[t]) {
        const re = CONFIG.aliasEspeciales[t];
        rows = (dataActual.ppp || []).filter(p => re.test(p.razon));
        if (rows.length === 0) rows = (dataActual.pppProgDiaria || []).filter(p => re.test(p.razon));
      } else {
        rows = (dataActual.ppp || []).filter(p => p.tanda === t);
        if (rows.length === 0) rows = (dataActual.pppProgDiaria || []).filter(p => p.tanda === t);
      }
      const fc = rows.reduce((s,p) => s + (p.mt3fc || 0), 0);
      if (fc > 0) mt3 += fc;
      else {
        const e = rows.reduce((s,p) => s + (p.mt3 || 0), 0);
        if (e > 0) { mt3 += e; est = true; }
      }
    });
    return { mt3, est };
  }

  const tabla = document.getElementById('modalTabla');
  tabla.querySelector('thead').innerHTML = '<tr><th>Día</th><th>Hs</th><th>Mt3</th><th>Mt3/h</th><th>Tandas</th></tr>';
  const tb = tabla.querySelector('tbody');
  tb.innerHTML = '';
  const keys = Object.keys(porDia).sort((a,b) => {
    const ma = a.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const mb = b.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return new Date(+ma[3], +ma[2]-1, +ma[1]) - new Date(+mb[3], +mb[2]-1, +mb[1]);
  });
  const star = '<span class="est-star" title="Estimado: aún sin facturar">*</span>';

  let totalHs = 0;
  const tandasGlobal = new Set();
  const diasConActividad = [];

  if (keys.length === 0) {
    tb.innerHTML = `<tr><td colspan="5" class="dim">Sin actividad</td></tr>`;
  } else {
    keys.forEach(k => {
      const dia = porDia[k];
      if (dia.hs <= 0) return;
      totalHs += dia.hs;
      diasConActividad.push(k);
      const m = mt3DeTandas(dia.tandas);
      const mt3xh = (dia.hs > 0 && m.mt3 > 0) ? (m.mt3 / dia.hs) : 0;
      const sStar = m.est && m.mt3 > 0 ? star : '';
      dia.tandas.forEach(t => tandasGlobal.add(t));
      tb.innerHTML += `
        <tr>
          <td><b>${k}</b></td>
          <td>${fmtHs(dia.hs)}</td>
          <td class="num">${m.mt3 > 0 ? num3(m.mt3) + sStar : '—'}</td>
          <td class="num">${mt3xh > 0 ? mt3xh.toFixed(3) + sStar : '—'}</td>
          <td class="num">${dia.tandas.size}</td>
        </tr>`;
    });
    // Fila TOTAL
    const mT = mt3DeTandas(tandasGlobal);
    const mt3xhT = (totalHs > 0 && mT.mt3 > 0) ? (mT.mt3 / totalHs) : 0;
    const tStar = mT.est && mT.mt3 > 0 ? star : '';
    tb.innerHTML += `
      <tr class="row-total">
        <td><b>TOTAL</b></td>
        <td><b>${fmtHs(totalHs)}</b></td>
        <td class="num"><b>${mT.mt3 > 0 ? num3(mT.mt3) + tStar : '—'}</b></td>
        <td class="num"><b>${mt3xhT > 0 ? mt3xhT.toFixed(3) + tStar : '—'}</b></td>
        <td class="num"><b>${tandasGlobal.size}</b></td>
      </tr>`;
  }

  // Footer
  const m = mt3DeTandas(tandasGlobal);
  const mt3xh = (totalHs > 0 && m.mt3 > 0) ? (m.mt3 / totalHs) : 0;
  const sStar = m.est && m.mt3 > 0 ? star : '';
  document.getElementById('modalInicio').textContent = fmtHs(totalHs);
  document.getElementById('modalFin').innerHTML    = m.mt3 > 0 ? num3(m.mt3) + sStar : '—';
  document.getElementById('modalTotal').innerHTML  = mt3xh > 0 ? mt3xh.toFixed(3) + sStar : '—';
  document.getElementById('modalOlvidado').textContent = String(tandasGlobal.size);
  const labelsP = ['Total Hs:', 'Total Mt3:', 'Promedio Mt3/h:', 'Tandas únicas:'];
  document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
    if (labelsP[i]) el.textContent = labelsP[i];
  });

  document.getElementById('modalDetalle').classList.remove('hidden');
}

function abrirDesglosePersonaSemanal(legajo) {
  if (!resultadoActual) return;
  abrirDesglosePersonaSecciones(legajo);
}

function abrirDesglosePersonaSecciones(legajo) {
  const operario = nombreEmp(legajo);
  document.getElementById('modalTitulo').textContent = `${operario} — Desglose semanal por área`;
  // Ocultar tabla principal, mostrar secciones
  document.getElementById('modalTabla').classList.add('hidden');
  const cont = document.getElementById('modalSecciones');
  cont.classList.remove('hidden');
  cont.innerHTML = '';

  // Acumular por semana → áreas
  const porSem = {};
  resultadoActual.reportes.forEach(r => {
    if (r.legajo !== legajo) return;
    const m = r.fecha.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return;
    const d = new Date(+m[3], +m[2]-1, +m[1]);
    const k = keySemana(d);
    if (!porSem[k]) porSem[k] = {
      pickHs:0, pickT:new Set(),
      armHs:0,  armT:new Set(),
      ccHs:0,   ccT:new Set(),
      opHs:0,   muHs:0,  totHs:0,
      dias:new Set()
    };
    const g = porSem[k];
    g.pickHs += r.pickHs; r.pickPairs.forEach(p => p.tanda && g.pickT.add(p.tanda));
    g.armHs  += r.armHs;  r.armPairs.forEach(p => p.tanda && g.armT.add(p.tanda));
    g.ccHs   += r.ccHs;   r.ccPairs.forEach(p => p.tanda && g.ccT.add(p.tanda));
    g.opHs   += r.opHs;
    g.muHs   += r.muertoHs;
    g.totHs  += r.totHs;
    g.dias.add(r.fecha);
  });

  function mt3DeTandas(tandas) {
    let mt3 = 0, est = false;
    tandas.forEach(t => {
      let rows;
      if (CONFIG.aliasEspeciales[t]) {
        const re = CONFIG.aliasEspeciales[t];
        rows = (dataActual.ppp || []).filter(p => re.test(p.razon));
        if (rows.length === 0) rows = (dataActual.pppProgDiaria || []).filter(p => re.test(p.razon));
      } else {
        rows = (dataActual.ppp || []).filter(p => p.tanda === t);
        if (rows.length === 0) rows = (dataActual.pppProgDiaria || []).filter(p => p.tanda === t);
      }
      const fc = rows.reduce((s,p) => s + (p.mt3fc || 0), 0);
      if (fc > 0) mt3 += fc;
      else {
        const e = rows.reduce((s,p) => s + (p.mt3 || 0), 0);
        if (e > 0) { mt3 += e; est = true; }
      }
    });
    return { mt3, est };
  }

  const keys = Object.keys(porSem).sort();
  const star = '<span class="est-star">*</span>';

  function seccionConMt3(titulo, color, getHs, getTandas) {
    let totalHs = 0;
    const tandasGlobal = new Set();
    let rows = '';
    keys.forEach(k => {
      const sem = porSem[k];
      const hs = getHs(sem);
      if (hs <= 0) return;
      const tandas = getTandas(sem);
      const m = mt3DeTandas(tandas);
      const mt3xh = (hs > 0 && m.mt3 > 0) ? (m.mt3 / hs) : 0;
      const sStar = m.est && m.mt3 > 0 ? star : '';
      rows += `
        <tr>
          <td><b>${labelSemana(k)}</b></td>
          <td>${fmtHs(hs)}</td>
          <td class="num">${m.mt3 > 0 ? num3(m.mt3) + sStar : '—'}</td>
          <td class="num">${mt3xh > 0 ? mt3xh.toFixed(3) + sStar : '—'}</td>
          <td class="num">${sem.dias.size}</td>
        </tr>`;
      totalHs += hs;
      tandas.forEach(t => tandasGlobal.add(t));
    });
    if (!rows) return '';
    const mTot = mt3DeTandas(tandasGlobal);
    const mt3xhTot = (totalHs > 0 && mTot.mt3 > 0) ? (mTot.mt3 / totalHs) : 0;
    const tStar = mTot.est && mTot.mt3 > 0 ? star : '';
    rows += `
      <tr class="row-total">
        <td><b>TOTAL</b></td>
        <td><b>${fmtHs(totalHs)}</b></td>
        <td class="num"><b>${mTot.mt3 > 0 ? num3(mTot.mt3) + tStar : '—'}</b></td>
        <td class="num"><b>${mt3xhTot > 0 ? mt3xhTot.toFixed(3) + tStar : '—'}</b></td>
        <td class="num">—</td>
      </tr>`;
    return `
      <div class="sec-bloque" style="border-left-color:${color}">
        <h3>${titulo}</h3>
        <table class="sec-tabla">
          <thead><tr><th>Semana</th><th>Hs</th><th>Mt3</th><th>Mt3/h</th><th>Días</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function seccionSimple(titulo, color, getHs) {
    let totalHs = 0;
    let rows = '';
    keys.forEach(k => {
      const sem = porSem[k];
      const hs = getHs(sem);
      if (hs <= 0) return;
      rows += `
        <tr>
          <td><b>${labelSemana(k)}</b></td>
          <td>${fmtHs(hs)}</td>
          <td class="num">${sem.dias.size}</td>
        </tr>`;
      totalHs += hs;
    });
    if (!rows) return '';
    rows += `
      <tr class="row-total">
        <td><b>TOTAL</b></td>
        <td><b>${fmtHs(totalHs)}</b></td>
        <td class="num">—</td>
      </tr>`;
    return `
      <div class="sec-bloque" style="border-left-color:${color}">
        <h3>${titulo}</h3>
        <table class="sec-tabla">
          <thead><tr><th>Semana</th><th>Hs</th><th>Días</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  cont.innerHTML =
    seccionConMt3('Picking',      '#28a745', s => s.pickHs, s => s.pickT) +
    seccionConMt3('Armado Pedido','#ffc107', s => s.armHs,  s => s.armT)  +
    seccionConMt3('Carga Camión', '#1e6bd6', s => s.ccHs,   s => s.ccT)   +
    seccionSimple('Op Total',     '#1e6bd6', s => s.opHs)  +
    seccionSimple('Muerto',       '#b04400', s => s.muHs)  +
    seccionSimple('Total',        '#1652a8', s => s.totHs);

  if (!cont.innerHTML) cont.innerHTML = '<p class="dim" style="text-align:center;padding:20px;">Sin actividad</p>';

  // Footer general (totales)
  const tot = { pick:0, arm:0, cc:0, op:0, mu:0, total:0, dias: new Set() };
  Object.values(porSem).forEach(s => {
    tot.pick += s.pickHs; tot.arm += s.armHs; tot.cc += s.ccHs;
    tot.op += s.opHs; tot.mu += s.muHs; tot.total += s.totHs;
    s.dias.forEach(d => tot.dias.add(d));
  });
  document.getElementById('modalInicio').textContent = fmtHs(tot.op);
  document.getElementById('modalFin').textContent    = fmtHs(tot.mu);
  document.getElementById('modalTotal').textContent  = fmtHs(tot.total);
  document.getElementById('modalOlvidado').textContent = String(tot.dias.size);
  const labelsP = ['Total Operativo:', 'Total Muerto:', 'Total trabajado:', 'Días con actividad:'];
  document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
    if (labelsP[i]) el.textContent = labelsP[i];
  });

  document.getElementById('modalDetalle').classList.remove('hidden');
}

function abrirDesglosePersonaPivotSemanaArea(legajo) {
  if (!resultadoActual) return;
  const operario = nombreEmp(legajo);
  document.getElementById('modalTitulo').textContent = `${operario} — Semanas x Áreas`;

  // Definición de áreas (orden mostrado)
  const areasDef = [
    { key:'pick',  label:'Picking',           tipo:'op' },
    { key:'arm',   label:'Armado Pedido',     tipo:'op' },
    { key:'cc',    label:'Carga Camión',      tipo:'op' },
    { key:'CR',    label:'Control Remitos',   tipo:'op' },
    { key:'RT',    label:'Recep. Merc.',      tipo:'op' },
    { key:'RI',    label:'Recep. Ins.',       tipo:'op' },
    { key:'EI',    label:'Entrega Ins.',      tipo:'op' },
    { key:'MG',    label:'Góndola',           tipo:'op' },
    { key:'CT',    label:'Conteo',            tipo:'op' },
    { key:'AT',    label:'Timbre',            tipo:'op' },
    { key:'PB',    label:'Baño',              tipo:'mu' },
    { key:'PC',    label:'Almuerzo',          tipo:'mu' },
    { key:'Limp',  label:'Limpieza',          tipo:'mu' },
    { key:'Perm',  label:'Permiso',           tipo:'mu' }
  ];

  // Agrupar reportes del operario por semana
  const porSem = {};  // semKey -> { [areaKey]: hs }
  resultadoActual.reportes.forEach(r => {
    if (r.legajo !== legajo) return;
    const m = r.fecha.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return;
    const d = new Date(+m[3], +m[2]-1, +m[1]);
    const k = keySemana(d);
    if (!porSem[k]) porSem[k] = {};
    const g = porSem[k];
    g.pick = (g.pick || 0) + r.pickHs;
    g.arm  = (g.arm  || 0) + r.armHs;
    g.cc   = (g.cc   || 0) + r.ccHs;
    ['CR','RT','RI','EI','MG','CT','AT'].forEach(c => {
      g[c] = (g[c] || 0) + (r.opTogPorCode?.[c] || 0);
    });
    ['PB','PC','Limp','Perm'].forEach(c => {
      g[c] = (g[c] || 0) + (r.muertoPorTipo?.[c]?.hs || 0);
    });
  });

  // Render tabla pivot
  const tabla = document.getElementById('modalTabla');
  // Header
  let thead = '<tr><th>Semana</th>';
  areasDef.forEach(a => {
    const cls = a.tipo === 'mu' ? 'th-muerto' : '';
    thead += `<th class="${cls}">${a.label}</th>`;
  });
  thead += '</tr>';
  tabla.querySelector('thead').innerHTML = thead;

  const tb = tabla.querySelector('tbody');
  tb.innerHTML = '';
  const keys = Object.keys(porSem).sort();

  // Totales por área
  const totales = {};
  areasDef.forEach(a => totales[a.key] = 0);

  if (keys.length === 0) {
    tb.innerHTML = `<tr><td colspan="${areasDef.length+1}" class="dim">Sin actividad</td></tr>`;
  } else {
    keys.forEach(k => {
      const sem = porSem[k];
      let row = `<tr><td><b>${labelSemana(k)}</b></td>`;
      areasDef.forEach(a => {
        const hs = sem[a.key] || 0;
        totales[a.key] += hs;
        const cls = a.tipo === 'mu' ? 'td-muerto' : '';
        row += `<td class="${cls} ${hs===0?'cero':''}">${hs > 0 ? fmtHs(hs) : '—'}</td>`;
      });
      row += '</tr>';
      tb.innerHTML += row;
    });
    // Fila TOTAL
    let totalRow = `<tr class="row-total"><td><b>TOTAL</b></td>`;
    areasDef.forEach(a => {
      const hs = totales[a.key];
      const cls = a.tipo === 'mu' ? 'td-muerto' : '';
      totalRow += `<td class="${cls}"><b>${hs > 0 ? fmtHs(hs) : '—'}</b></td>`;
    });
    totalRow += '</tr>';
    tb.innerHTML += totalRow;
  }

  // Footer general
  let totalOp = 0, totalMu = 0;
  areasDef.forEach(a => {
    if (a.tipo === 'op') totalOp += totales[a.key];
    else totalMu += totales[a.key];
  });
  document.getElementById('modalInicio').textContent = fmtHs(totalOp);
  document.getElementById('modalFin').textContent    = fmtHs(totalMu);
  document.getElementById('modalTotal').textContent  = fmtHs(totalOp + totalMu);
  document.getElementById('modalOlvidado').textContent = String(keys.length);
  const labelsP = ['Total Operativo:', 'Total Muerto:', 'Total trabajado:', 'Semanas con actividad:'];
  document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
    if (labelsP[i]) el.textContent = labelsP[i];
  });

  document.getElementById('modalDetalle').classList.remove('hidden');
}

// Función vieja (mantengo nombre para no romper, pero ahora redirige)
function abrirDesglosePersonaAreaSimple(legajo) {
  if (!resultadoActual) return;
  const operario = nombreEmp(legajo);
  document.getElementById('modalTitulo').textContent = `${operario} — Detalle por área`;

  // Acumular hs por área para el operario en el rango
  const areas = {
    pick:  { label: 'Picking',           tipo: 'op',  conMt3: true,  hs: 0, tandas: new Set(), dias: new Set() },
    arm:   { label: 'Armado Pedido',     tipo: 'op',  conMt3: true,  hs: 0, tandas: new Set(), dias: new Set() },
    cc:    { label: 'Carga Camión',      tipo: 'op',  conMt3: true,  hs: 0, tandas: new Set(), dias: new Set() },
    CR:    { label: 'Control Remitos',   tipo: 'op',  conMt3: false, hs: 0, dias: new Set() },
    RT:    { label: 'Recep. Mercadería', tipo: 'op',  conMt3: false, hs: 0, dias: new Set() },
    RI:    { label: 'Recep. Insumos',    tipo: 'op',  conMt3: false, hs: 0, dias: new Set() },
    EI:    { label: 'Entrega Insumos',   tipo: 'op',  conMt3: false, hs: 0, dias: new Set() },
    MG:    { label: 'Góndola',           tipo: 'op',  conMt3: false, hs: 0, dias: new Set() },
    CT:    { label: 'Conteo',            tipo: 'op',  conMt3: false, hs: 0, dias: new Set() },
    AT:    { label: 'Atendí Timbre',     tipo: 'op',  conMt3: false, hs: 0, dias: new Set() },
    PB:    { label: 'Baño',              tipo: 'mu',  conMt3: false, hs: 0, dias: new Set() },
    PC:    { label: 'Almuerzo',          tipo: 'mu',  conMt3: false, hs: 0, dias: new Set() },
    Limp:  { label: 'Limpieza',          tipo: 'mu',  conMt3: false, hs: 0, dias: new Set() },
    Perm:  { label: 'Permiso',           tipo: 'mu',  conMt3: false, hs: 0, dias: new Set() }
  };

  let totalOp = 0, totalMu = 0, totalTot = 0;
  const diasGlobal = new Set();
  resultadoActual.reportes.forEach(r => {
    if (r.legajo !== legajo) return;
    diasGlobal.add(r.fecha);
    if (r.pickHs > 0) { areas.pick.hs += r.pickHs; areas.pick.dias.add(r.fecha); r.pickPairs.forEach(p => p.tanda && areas.pick.tandas.add(p.tanda)); }
    if (r.armHs > 0)  { areas.arm.hs  += r.armHs;  areas.arm.dias.add(r.fecha);  r.armPairs.forEach(p => p.tanda && areas.arm.tandas.add(p.tanda)); }
    if (r.ccHs > 0)   { areas.cc.hs   += r.ccHs;   areas.cc.dias.add(r.fecha);   r.ccPairs.forEach(p => p.tanda && areas.cc.tandas.add(p.tanda)); }
    ['CR','RT','RI','EI','MG','CT','AT'].forEach(c => {
      const h = r.opTogPorCode?.[c] || 0;
      if (h > 0) { areas[c].hs += h; areas[c].dias.add(r.fecha); }
    });
    ['PB','PC','Limp','Perm'].forEach(c => {
      const h = r.muertoPorTipo?.[c]?.hs || 0;
      if (h > 0) { areas[c].hs += h; areas[c].dias.add(r.fecha); }
    });
    totalOp += r.opHs;
    totalMu += r.muertoHs;
    totalTot += r.totHs;
  });

  function mt3DeTandas(tandas) {
    let mt3 = 0, est = false;
    tandas.forEach(t => {
      let rows;
      if (CONFIG.aliasEspeciales[t]) {
        const re = CONFIG.aliasEspeciales[t];
        rows = (dataActual.ppp || []).filter(p => re.test(p.razon));
        if (rows.length === 0) rows = (dataActual.pppProgDiaria || []).filter(p => re.test(p.razon));
      } else {
        rows = (dataActual.ppp || []).filter(p => p.tanda === t);
        if (rows.length === 0) rows = (dataActual.pppProgDiaria || []).filter(p => p.tanda === t);
      }
      const fc = rows.reduce((s,p) => s + (p.mt3fc || 0), 0);
      if (fc > 0) mt3 += fc;
      else {
        const e = rows.reduce((s,p) => s + (p.mt3 || 0), 0);
        if (e > 0) { mt3 += e; est = true; }
      }
    });
    return { mt3, est };
  }

  // Render tabla
  const tabla = document.getElementById('modalTabla');
  tabla.querySelector('thead').innerHTML = '<tr><th>Área</th><th>Hs</th><th>Mt3</th><th>Mt3/h</th><th>Días</th></tr>';
  const tb = tabla.querySelector('tbody');
  tb.innerHTML = '';
  const sStar = '<span class="est-star" title="Estimado: aún sin facturar">*</span>';

  function fila(key, area, separator) {
    if (area.hs <= 0) return '';
    let mt3Str = '<span class="dim">—</span>', mt3xhStr = '<span class="dim">—</span>';
    if (area.conMt3 && area.tandas) {
      const r = mt3DeTandas(area.tandas);
      if (r.mt3 > 0) {
        const star = r.est ? sStar : '';
        mt3Str = num3(r.mt3) + star;
        mt3xhStr = (area.hs > 0) ? (r.mt3 / area.hs).toFixed(3) + star : '—';
      }
    }
    const cls = area.tipo === 'mu' ? 'fila-muerto' : 'fila-op';
    const sep = separator ? ' fila-sep' : '';
    return `
      <tr class="${cls}${sep}">
        <td><b>${esc(area.label)}</b></td>
        <td>${fmtHs(area.hs)}</td>
        <td class="num">${mt3Str}</td>
        <td class="num">${mt3xhStr}</td>
        <td class="num">${area.dias.size}</td>
      </tr>`;
  }

  // Sectores principales (Picking, Armado, CC)
  tb.innerHTML += fila('pick', areas.pick);
  tb.innerHTML += fila('arm',  areas.arm);
  tb.innerHTML += fila('cc',   areas.cc);
  // Toggles operativos
  let firstOp = true;
  ['CR','RT','RI','EI','MG','CT','AT'].forEach(c => {
    if (areas[c].hs > 0) {
      tb.innerHTML += fila(c, areas[c], firstOp);
      firstOp = false;
    }
  });
  // Muertos
  let firstMu = true;
  ['PB','PC','Limp','Perm'].forEach(c => {
    if (areas[c].hs > 0) {
      tb.innerHTML += fila(c, areas[c], firstMu);
      firstMu = false;
    }
  });

  if (!tb.innerHTML) {
    tb.innerHTML = '<tr><td colspan="5" class="dim">Sin actividad</td></tr>';
  }

  // Footer: totales globales del operario en el rango
  document.getElementById('modalInicio').textContent = fmtHs(totalOp);
  document.getElementById('modalFin').textContent    = fmtHs(totalMu);
  document.getElementById('modalTotal').textContent  = fmtHs(totalTot);
  document.getElementById('modalOlvidado').textContent = String(diasGlobal.size);
  const labelsP = ['Total Operativo:', 'Total Muerto:', 'Total trabajado:', 'Días con actividad:'];
  document.querySelectorAll('.modal-total-row .lbl').forEach((el, i) => {
    if (labelsP[i]) el.textContent = labelsP[i];
  });

  document.getElementById('modalDetalle').classList.remove('hidden');
}

// =============================================================================
// VISTA SECTOR
// =============================================================================
function renderSector(r) {
  const cards = document.getElementById('resumenSectores');
  cards.innerHTML = '';
  const colorClass = { 'Picking':'pick', 'Armado Pedido':'arm', 'Carga Camion':'cc' };
  const sectorKeyMap2 = { 'Picking':'pick', 'Armado Pedido':'arm', 'Carga Camion':'cc' };
  const starS = '<span class="est-star" title="Estimado: aún sin facturar">*</span>';
  r.porSector.forEach(s => {
    const ratioMt3 = (s.hs > 0 && s.mt3 > 0) ? (s.mt3/s.hs).toFixed(3) : '—';
    const ratioH = (s.hs > 0 && s.mt3 > 0) ? fmtHs(s.hs/s.mt3) : '—';
    const star = s.est && s.mt3 > 0 ? starS : '';
    const skey = sectorKeyMap2[s.nombre];
    cards.innerHTML += `
      <div class="kpi-card ${colorClass[s.nombre] || ''}" data-sector="${skey}" data-nombre="${esc(s.nombre)}" title="Click para desglose semanal">
        <h4>${s.nombre}</h4>
        <div class="val">${fmtHs(s.hs)}</div>
        <div class="det">${num3(s.mt3)}${star} Mt3 · ${s.operarios} operarios · ${s.tandas} tandas</div>
        <div class="det"><b>${ratioMt3}${star} Mt3/h</b> · ${ratioH}${star} h/Mt3</div>
      </div>`;
  });
  // Click handler en cards
  cards.querySelectorAll('.kpi-card[data-sector]').forEach(card => {
    card.addEventListener('click', () => {
      abrirDesgloseSemanal(card.dataset.sector, card.dataset.nombre);
    });
  });

  // Tabla resumen por sector (sin desglose por operario)
  const det = document.getElementById('sectoresDetalle');
  det.innerHTML = `
    <div class="table-wrap" style="margin-top:16px;">
      <table id="tablaSectorResumen">
        <thead><tr>
          <th>Sector</th>
          <th>Hs Totales</th>
          <th>Mt3 Totales</th>
          <th>Mt3/h Promedio</th>
          <th>h/Mt3 Promedio</th>
          <th>Cant. Operarios</th>
          <th>Cant. Tandas</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;
  const tbody = document.querySelector('#tablaSectorResumen tbody');
  tbody.innerHTML = '';
  const sectorKeyMap = { 'Picking':'pick', 'Armado Pedido':'arm', 'Carga Camion':'cc' };
  r.porSector.forEach(s => {
    if (s.hs === 0) return;
    const ratioMt3 = (s.hs > 0 && s.mt3 > 0) ? (s.mt3/s.hs).toFixed(3) : '—';
    const ratioH = (s.hs > 0 && s.mt3 > 0) ? fmtHs(s.hs/s.mt3) : '—';
    const star = s.est && s.mt3 > 0 ? starS : '';
    const sectorKey = sectorKeyMap[s.nombre];
    tbody.innerHTML += `
      <tr class="sector-row" data-sector="${sectorKey}" data-nombre="${esc(s.nombre)}" title="Click para ver desglose semanal">
        <td><b>${s.nombre}</b></td>
        <td>${fmtHs(s.hs)}</td>
        <td class="num">${num3(s.mt3)}${star}</td>
        <td class="num">${ratioMt3}${star}</td>
        <td>${ratioH}${star}</td>
        <td class="num">${s.operarios}</td>
        <td class="num">${s.tandas}</td>
      </tr>`;
  });
  // Click handler
  tbody.querySelectorAll('.sector-row').forEach(tr => {
    tr.addEventListener('click', () => {
      abrirDesgloseSemanal(tr.dataset.sector, tr.dataset.nombre);
    });
  });
}

// Devuelve { mt3, mt3fc, fuente } para una tanda
function buscarMt3Detalle(tanda) {
  if (!dataActual || !tanda) return { mt3: 0, mt3fc: 0 };
  function rowsDe(arr) {
    if (!arr) return [];
    if (CONFIG.aliasEspeciales[tanda]) {
      const re = CONFIG.aliasEspeciales[tanda];
      return arr.filter(p => re.test(p.razon));
    }
    return arr.filter(p => p.tanda === tanda);
  }
  // 1) ppp principal
  let rows = rowsDe(dataActual.ppp);
  let fuente = 'principal';
  let mt3 = rows.reduce((s,p) => s + (p.mt3 || 0), 0);
  let mt3fc = rows.reduce((s,p) => s + (p.mt3fc || 0), 0);
  if (mt3 === 0 && mt3fc === 0) {
    // 2) Programación Diaria
    rows = rowsDe(dataActual.pppProgDiaria);
    if (rows.length) {
      mt3 = rows.reduce((s,p) => s + (p.mt3 || 0), 0);
      mt3fc = rows.reduce((s,p) => s + (p.mt3fc || 0), 0);
      fuente = 'progDiaria';
    }
  }
  return { mt3, mt3fc, rows: rows.length, fuente };
}

function renderDetalleTandas(r, legsMostrar) {
  const tb = document.querySelector('#tablaDetalleTandas tbody');
  if (!tb) return;
  tb.innerHTML = '';
  const star = '<span class="est-star" title="Estimado: aún sin facturar">*</span>';
  // Por cada operario en el rango (filtrado por legsMostrar), listar todas sus tandas
  // Aglutinamos por (legajo, tipo, tanda) sumando hs.
  const acc = {};  // key: legajo|tipo|tanda -> { hs }
  r.reportes.forEach(rep => {
    if (!legsMostrar.includes(rep.legajo)) return;
    const procesar = (pairs, tipo) => {
      pairs.forEach(p => {
        if (!p.tanda) return;
        const k = `${rep.legajo}|${tipo}|${p.tanda}`;
        if (!acc[k]) acc[k] = { legajo: rep.legajo, tipo, tanda: p.tanda, hs: 0 };
        acc[k].hs += p.hs;
      });
    };
    procesar(rep.pickPairs, 'Picking');
    procesar(rep.armPairs, 'Armado');
    procesar(rep.ccPairs, 'Carga Camión');
  });

  const filas = Object.values(acc).sort((a,b) => {
    const na = nombreEmp(a.legajo), nb = nombreEmp(b.legajo);
    if (na !== nb) return na.localeCompare(nb);
    if (a.tipo !== b.tipo) return a.tipo.localeCompare(b.tipo);
    return a.tanda.localeCompare(b.tanda);
  });

  if (!filas.length) {
    tb.innerHTML = '<tr><td colspan="6" class="dim">Sin tandas en el rango</td></tr>';
    return;
  }

  let lastLeg = null;
  filas.forEach(f => {
    const det = buscarMt3Detalle(f.tanda);
    const fcStr = det.mt3fc > 0 ? num3(det.mt3fc) : '<span class="dim">—</span>';
    const mt3Str = det.mt3 > 0 ? num3(det.mt3) + (det.mt3fc === 0 ? star : '') : '<span class="dim">—</span>';
    const showLeg = (lastLeg !== f.legajo) ? `<b>${esc(nombreEmp(f.legajo))}</b>` : '';
    lastLeg = f.legajo;
    tb.innerHTML += `
      <tr>
        <td>${showLeg}</td>
        <td>${f.tipo}</td>
        <td><b>${esc(f.tanda)}</b></td>
        <td>${fmtHs(f.hs)}</td>
        <td class="num">${mt3Str}</td>
        <td class="num">${fcStr}</td>
      </tr>`;
  });
}

function renderCrossVista(crossDia) {
  const tb = document.querySelector('#tablaCrossDiaVista tbody');
  const cont = document.getElementById('crossResumen');
  if (!tb || !cont) return;
  tb.innerHTML = '';

  // Aplicar filtro de empleados seleccionados
  let lista = (crossDia || []);
  if (empSeleccionados.size > 0) {
    lista = lista.filter(c => empSeleccionados.has(c.legajo));
  }

  // Resumen: total cruces, olvidos vs imputados
  const olvidos = lista.filter(c => c.olvidado);
  const imputados = lista.filter(c => !c.olvidado);
  const hsOlvidadasBrutas = olvidos.reduce((s,c) => s + c.hsBruta, 0);
  const hsImputadasTot = imputados.reduce((s,c) => s + c.hs, 0);

  cont.innerHTML = `
    <div class="kpi-card" style="border-left-color:#dc2626;">
      <h4>Olvidos descartados</h4>
      <div class="val">${olvidos.length}</div>
      <div class="det">${hsOlvidadasBrutas.toFixed(1)}h brutas perdidas</div>
    </div>
    <div class="kpi-card" style="border-left-color:#d97706;">
      <h4>Cruces imputados</h4>
      <div class="val">${imputados.length}</div>
      <div class="det">${fmtHs(hsImputadasTot)} imputadas</div>
    </div>
    <div class="kpi-card" style="border-left-color:#1e6bd6;">
      <h4>Total cross-día</h4>
      <div class="val">${lista.length}</div>
      <div class="det">en el rango filtrado</div>
    </div>
  `;
  cont.style.display = 'flex';
  cont.style.justifyContent = 'center';
  cont.style.gap = '12px';
  cont.style.flexWrap = 'wrap';
  cont.style.marginBottom = '16px';

  if (lista.length === 0) {
    tb.innerHTML = '<tr><td colspan="8" class="dim">Sin cruces detectados en el rango</td></tr>';
    return;
  }
  lista.forEach(c => {
    const estado = c.olvidado
      ? '<span class="exc">⚠ Olvido</span>'
      : '<span style="color:#28a745">✓ Imputado</span>';
    const tanda = c.tanda ? `<b>${esc(c.tanda)}</b>` : '<span class="dim">—</span>';
    tb.innerHTML += `
      <tr class="${c.olvidado ? 'row-olvido' : ''}">
        <td>${esc(nombreEmp(c.legajo))}</td>
        <td><b>${c.opcion}</b></td>
        <td>${tanda}</td>
        <td>${c.inicio}</td>
        <td>${c.fin}</td>
        <td class="num">${fmtHs(c.hs)}</td>
        <td class="num dim">${c.hsBruta.toFixed(1)}h</td>
        <td>${estado}</td>
      </tr>`;
  });
}

function renderCrossDia(crossDia) {
  const tb = document.querySelector('#tablaCrossDia tbody');
  tb.innerHTML = '';
  const filt = (crossDia || []).slice(0, 50);
  filt.forEach(c => {
    const estado = c.olvidado
      ? '<span class="exc">⚠ Olvido (descartado)</span>'
      : '<span style="color:#28a745">✓ Imputado</span>';
    tb.innerHTML += `
      <tr>
        <td>${esc(nombreEmp(c.legajo))}</td><td>${c.opcion}</td>
        <td>${c.inicio}</td><td>${c.fin}</td>
        <td class="num">${c.hs}h</td>
        <td class="num dim">${c.hsBruta}h</td>
        <td>${estado}</td>
      </tr>`;
  });
  if (!filt.length) tb.innerHTML = '<tr><td colspan="7" class="dim">Ninguna</td></tr>';
}

// =============================================================================
// CONTROLES
// =============================================================================
function cambiarVista(v) {
  vistaActual = v;
  document.querySelectorAll('.vista-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.vista === v);
  });
  document.getElementById('vistaDiario').classList.toggle('hidden', v !== 'diario');
  document.getElementById('vistaPersona').classList.toggle('hidden', v !== 'persona');
  document.getElementById('vistaSector').classList.toggle('hidden', v !== 'sector');
  document.getElementById('vistaCross').classList.toggle('hidden', v !== 'cross');
  // Mostrar fila de chips solo en vista Diario
  document.getElementById('empleadosRow').style.display = (v === 'diario') ? 'flex' : 'none';
  actualizar();
}

document.querySelectorAll('.vista-btn').forEach(b => {
  b.addEventListener('click', () => cambiarVista(b.dataset.vista));
});

document.getElementById('btnRefrescar').addEventListener('click', async () => {
  await cargarDatos(true); actualizar();
});
document.getElementById('btnImprimir').addEventListener('click', () => window.print());
// Flatpickr: rango + shortcuts
// ============================================================
// FLATPICKR — selector único con rango + presets de mes
// ============================================================
let fp = null;
function initFlatpickr() {
  if (typeof flatpickr === 'undefined') return;
  fp = flatpickr('#fechaRange', {
    mode: 'range',
    locale: 'es',
    dateFormat: 'd/m/Y',
    showMonths: 1,
    onClose: function(selectedDates) {
      if (selectedDates.length === 0) return;
      const d1 = selectedDates[0];
      const d2 = selectedDates[1] || d1;
      const iso = dt => `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      document.getElementById('desde').value = iso(d1);
      document.getElementById('hasta').value = iso(d2);
      actualizar();
    }
  });
  agregarPanelMeses();
}

function agregarPanelMeses() {
  if (!fp || !fp.calendarContainer) return;
  if (fp.calendarContainer.querySelector('.fp-meses')) return;
  const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const panel = document.createElement('div');
  panel.className = 'fp-meses';
  const año = new Date().getFullYear();
  panel.innerHTML = `
    <div class="fp-meses-titulo">
      <button type="button" class="fp-year-prev">‹</button>
      <span class="fp-year-label">${año}</span>
      <button type="button" class="fp-year-next">›</button>
    </div>
    <div class="fp-meses-grid">
      ${meses.map((m,i) => `<button type="button" class="fp-mes-btn" data-mes="${i}">${m}</button>`).join('')}
    </div>
  `;
  fp.calendarContainer.appendChild(panel);

  const lbl = panel.querySelector('.fp-year-label');
  panel.querySelector('.fp-year-prev').addEventListener('click', () => {
    lbl.textContent = parseInt(lbl.textContent) - 1;
  });
  panel.querySelector('.fp-year-next').addEventListener('click', () => {
    lbl.textContent = parseInt(lbl.textContent) + 1;
  });
  panel.querySelectorAll('.fp-mes-btn').forEach(b => {
    b.addEventListener('click', () => {
      const yyyy = parseInt(lbl.textContent);
      const mm = parseInt(b.dataset.mes);
      const d1 = new Date(yyyy, mm, 1);
      const d2 = new Date(yyyy, mm+1, 0);
      fp.setDate([d1, d2], true);
      fp.close();
    });
  });
}
function isoToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isoOffset(days) {
  const d = new Date(); d.setDate(d.getDate()+days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function num3(n) {
  if (n === undefined || n === null || n === '' || n === 0) return '0';
  return Number(n).toFixed(3).replace(/\.?0+$/, '');
}
function ratio(num, den) {
  if (!num || !den) return '<span class="dim">—</span>';
  return Number(num/den).toFixed(3);
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

(async () => {
  initFlatpickr();
  await cargarFeriados();
  await cargarDatos();
  if (dataActual && dataActual.produccion.length) {
    const fechas = [...new Set(dataActual.produccion.map(r => r.fecha))]
      .map(f => fechaIso(f)).sort().reverse();
    if (fechas.length) {
      document.getElementById('desde').value = fechas[0];
      document.getElementById('hasta').value = fechas[0];
      const [y,m,d] = fechas[0].split('-').map(Number);
      const dt = new Date(y, m-1, d);
      if (fp) fp.setDate([dt, dt], false);
    }
  }
  actualizar();
})();
