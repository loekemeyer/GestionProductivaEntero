/**
 * Lógica de cálculo - Logistica Virgilio
 */

const CONFIG = {
  legajosTest: ['999', '9999'],
  jornadaHs: 9,
  jornadaInicioHora: 8,    // 08:00
  jornadaFinHora: 17,      // 17:00
  // Días no laborables: sáb/dom + feriados nacionales argentinos (formato MM-DD)
  feriadosFijos: [
    '01-01', // Año Nuevo
    '03-24', // Día de la Memoria
    '04-02', // Veteranos Malvinas
    '05-01', // Día del Trabajador
    '05-25', // Revolución de Mayo
    '06-17', // Güemes
    '06-20', // Bandera
    '07-09', // Independencia
    '08-17', // San Martín
    '10-12', // Diversidad Cultural
    '11-20', // Soberanía
    '12-08', // Inmaculada Concepción
    '12-25'  // Navidad
  ],
  feriadosCustom: [    // editable - feriados puente, paros, vacaciones del depósito
    // ejemplo: '2026-05-02'
  ],
  feriadosAPI: [],     // se llena dinámicamente desde api.argentinadatos.com (formato YYYY-MM-DD)
  operativoPares: ['EP','TP','AP','TAP'],
  operativoTog:   ['CC','RT','RI','EI','MG','CR','CT','AT'],
  muertoTog:      ['PB','PC','Limp','Perm'],
  muertoNombres: { PB:'Baño', PC:'Almuerzo', Limp:'Limpieza', Perm:'Permiso' },
  // Únicos códigos que PUEDEN cruzar día. Todo lo demás → olvido si cruza.
  // pick=EP/TP, arm=AP/TAP, CR=Control Remitos, MG=Góndola
  puedeCruzaDia: ['pick', 'arm', 'CR', 'MG'],
  // Filas del pivot del Reporte Diario, en orden
  filasPivot: [
    { key:'pick',  label:'Picking',         tipo:'op',   rendType:'mt3xh' },
    { key:'arm',   label:'Armado Pedido',   tipo:'op',   rendType:'mt3xh' },
    { key:'cc',    label:'Carga Camion',    tipo:'op',   rendType:'hxmt3' },
    { key:'cr',    label:'Control Remitos', tipo:'op',   rendType:'none' },
    { key:'RT',    label:'Recep. Mercadería', tipo:'op', rendType:'none' },
    { key:'RI',    label:'Recep. Insumos',  tipo:'op',   rendType:'none' },
    { key:'EI',    label:'Entrega Insumos', tipo:'op',   rendType:'none' },
    { key:'MG',    label:'Góndola',         tipo:'op',   rendType:'none' },
    { key:'CT',    label:'Conteo',          tipo:'op',   rendType:'none' },
    { key:'AT',    label:'Atendí Timbre',   tipo:'op',   rendType:'none' },
    { key:'sep1',  label:'',                tipo:'sep' },
    { key:'PB',    label:'Baño',            tipo:'mu',   rendType:'none' },
    { key:'PC',    label:'Almuerzo',        tipo:'mu',   rendType:'none' },
    { key:'Limp',  label:'Limpieza',        tipo:'mu',   rendType:'none' },
    { key:'Perm',  label:'Permiso',         tipo:'mu',   rendType:'none' },
    { key:'sep2',  label:'',                tipo:'sep' },
    { key:'FJ',    label:'Fin de Jornada',  tipo:'fj',   rendType:'none' },
    { key:'total', label:'TOTAL (cobertura real)', tipo:'tot',  rendType:'none' },
    { key:'faltante', label:'Tiempo Faltante', tipo:'falt', rendType:'none' }
  ],
  aliasEspeciales: {
    'DORINKA':    /Dorinka/i,
    'COTO':       /Coto/i,
    'DIARCO':     /Diarco/i,
    'JUMBO':      /CENCOSUD|Jumbo/i,
    'LIBERTAD':   /Libertad/i,
    'LA ANONIMA': /Patagonia|An[oó]nima/i,
    'CARREFOUR':  /Carrefour/i
  }
};

function cleanCodigo(c) {
  if (!c) return '';
  const t = String(c).trim().toUpperCase();
  if (CONFIG.aliasEspeciales[t]) return t;
  const m = t.match(/^[A-Z]\d{1,3}[A-Z]?/);
  return m ? m[0] : t;
}

function fmtHs(hours) {
  if (!hours || hours === 0) return '0H 0m';
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) { h++; m = 0; }
  return `${h}H ${m}m`;
}

function parseDT(fecha, hora) {
  if (!fecha || !hora) return null;
  const fm = fecha.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const hm = hora.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!fm || !hm) return null;
  // Trunco segundos: todos los cálculos quedan en granularidad minuto, consistente con HH:MM mostrado
  return new Date(+fm[3], +fm[2]-1, +fm[1], +hm[1], +hm[2], 0);
}

function fechaIso(s) {
  const m = s && s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}` : '';
}

function horaCorta(dt) {
  return `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
}

function fechaArg(dt) {
  return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
}

function esDiaNoLaborable(dt) {
  const dow = dt.getDay();
  if (dow === 0 || dow === 6) return true;  // dom/sab
  const mmdd = `${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  if (CONFIG.feriadosFijos.includes(mmdd)) return true;
  const isoDate = `${dt.getFullYear()}-${mmdd}`;
  if (CONFIG.feriadosCustom.includes(isoDate)) return true;
  if (CONFIG.feriadosAPI.includes(isoDate)) return true;
  return false;
}

// Devuelve el siguiente día laborable después de dt (o el mismo si ya es laborable)
function siguienteDiaLaborable(dt) {
  const r = new Date(dt);
  let safety = 30;
  while (esDiaNoLaborable(r) && safety-- > 0) {
    r.setDate(r.getDate() + 1);
  }
  return r;
}

// Cuenta días LABORABLES estrictamente entre start y end (excluyendo ambos)
function diasLaborablesIntermedios(start, end) {
  const a = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const b = new Date(end.getFullYear(),   end.getMonth(),   end.getDate());
  let count = 0, cur = new Date(a);
  let safety = 60;
  while (cur < b && safety-- > 0) {
    if (!esDiaNoLaborable(cur)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Calcula la cobertura total (UNIÓN) de un conjunto de intervalos.
 * Si dos intervalos se solapan, NO los suma dos veces.
 * intervals: [{ start: Date, end: Date }, ...]
 * Devuelve horas totales cubiertas.
 */
function unionHs(intervals) {
  if (!intervals || !intervals.length) return 0;
  const sorted = intervals.map(i => ({ s: +i.start, e: +i.end })).sort((a,b) => a.s - b.s);
  let total = 0;
  let curS = sorted[0].s;
  let curE = sorted[0].e;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].s <= curE) {
      if (sorted[i].e > curE) curE = sorted[i].e;
    } else {
      total += curE - curS;
      curS = sorted[i].s;
      curE = sorted[i].e;
    }
  }
  total += curE - curS;
  return total / 36e5;
}

/**
 * Devuelve segmentos por jornada (8-17h).
 * - Mismo día → 1 segmento.
 * - Cruza al siguiente día LABORABLE → 2 segmentos: uno por día (start→17:00 + 08:00→end).
 *   Cada día recibe SOLO su parte trabajada en jornada.
 * - Cruza 2+ días laborables → OLVIDO. Devuelve [].
 */
function splitParPorJornada(start, end) {
  if (!start || !end || end <= start) return [];
  const JF = CONFIG.jornadaFinHora;
  const JI = CONFIG.jornadaInicioHora;

  const finJornadaHoy = new Date(start.getFullYear(), start.getMonth(), start.getDate(), JF, 0, 0);

  // Caso 1: mismo día
  if (end <= finJornadaHoy) {
    return [{
      fecha: fechaArg(start),
      dtIni: start, dtFin: end,
      hs: (end - start) / 36e5
    }].filter(s => s.hs > 0);
  }

  const tmp = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
  const proxLab = siguienteDiaLaborable(tmp);
  const inicioProxLab = new Date(proxLab.getFullYear(), proxLab.getMonth(), proxLab.getDate(), JI, 0, 0);
  const finProxLab    = new Date(proxLab.getFullYear(), proxLab.getMonth(), proxLab.getDate(), JF, 0, 0);

  // Caso 2: cruza al siguiente día laborable
  if (end <= finProxLab) {
    const labIntermedios = diasLaborablesIntermedios(start, proxLab);
    if (labIntermedios > 0) return [];   // olvido (días laborables sin actividad)

    const segs = [];
    // Día de inicio: start → 17:00 (si start está antes del fin de jornada)
    if (start < finJornadaHoy) {
      segs.push({
        fecha: fechaArg(start),
        dtIni: start, dtFin: finJornadaHoy,
        hs: (finJornadaHoy - start) / 36e5
      });
    }
    // Día de fin: 08:00 → end
    const dtIniFin = end > inicioProxLab ? inicioProxLab : end;
    if (dtIniFin < end) {
      segs.push({
        fecha: fechaArg(proxLab),
        dtIni: dtIniFin, dtFin: end,
        hs: (end - dtIniFin) / 36e5
      });
    }
    return segs.filter(s => s.hs > 0);
  }

  // Caso 3: cruza 2+ días laborables → OLVIDO
  return [];
}

function procesar(dataCruda, fechaDesde, fechaHasta) {
  const ppp = dataCruda.ppp || [];
  let prod = (dataCruda.produccion || []).filter(r => !CONFIG.legajosTest.includes(r.legajo));

  prod = prod.map(r => ({
    ...r,
    dt: parseDT(r.fecha, r.hora),
    dtInicio: parseDT(r.fechaIni, r.horaIni) || null,   // null si no vino ts_inicio
    codigoLimpio: cleanCodigo(r.codigo)
  })).filter(r => r.dt);

  const seen = new Set();
  prod = prod.filter(r => {
    const key = `${r.legajo}|${r.fecha}|${r.hora}|${r.opcion}|${r.codigo}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const filtPorFechaIso = (iso) => {
    if (!fechaDesde && !fechaHasta) return true;
    if (fechaDesde && iso < fechaDesde) return false;
    if (fechaHasta && iso > fechaHasta) return false;
    return true;
  };

  // Calculo pares y segmentos GLOBALES (cruzando días si hace falta).
  // Cada par puede generar 1+ segmentos, cada uno asignado a su día.
  const segmentos = []; // { tipo, legajo, fecha, dtIni, dtFin, hs, tanda?, code? }
  const cruces = [];    // info: { legajo, opcion, inicio (DT real), fin (DT real), hsBruta, hsImputada }
  const paresOriginales = []; // { tipo, legajo, code, tanda, inicio, fin, hsBruta, hsImputada, olvidado }

  // === FJ (Fin de Jornada): recolectar y comparar con conteos reales ===
  // El celular envía opcion='FJ' con texto=JSON {opcion:count, ...} de todo lo que hizo ese día.
  // Comparamos vs lo que efectivamente llegó a Supabase → detecta mensajes perdidos.
  const conteoActualPorLegajoDia = {}; // legajo|fecha → { opcion: count }
  prod.forEach(r => {
    if (r.opcion === 'FJ') return;
    const k = `${r.legajo}__${r.fecha}`;
    if (!conteoActualPorLegajoDia[k]) conteoActualPorLegajoDia[k] = {};
    conteoActualPorLegajoDia[k][r.opcion] = (conteoActualPorLegajoDia[k][r.opcion] || 0) + 1;
  });
  const fjEventos = []; // [{ legajo, fecha, hora, dt, reportado, actual, descripcion, eventsSnapshot }]
  prod.forEach(r => {
    if (r.opcion !== 'FJ') return;
    let parsed = {};
    try { parsed = JSON.parse(r.codigo || '{}'); } catch (_) {}
    // Soporta 2 formatos:
    //   Viejo: { "EP": 1, "TP": 1, ... }   ← solo counts en top-level
    //   Nuevo: { "counts": {...}, "events": [...] }  ← incluye snapshot del día
    let reportado, eventsSnapshot;
    if (parsed && typeof parsed === 'object' && (parsed.counts || parsed.events)) {
      reportado = parsed.counts || {};
      eventsSnapshot = Array.isArray(parsed.events) ? parsed.events : [];
    } else {
      reportado = parsed || {};
      eventsSnapshot = [];
    }
    const k = `${r.legajo}__${r.fecha}`;
    fjEventos.push({
      legajo: r.legajo,
      fecha: r.fecha,
      hora: r.hora,
      dt: r.dt,
      reportado,
      actual: conteoActualPorLegajoDia[k] || {},
      eventsSnapshot,
      descripcion: r.descripcion
    });
  });

  // Agrupar por legajo
  const porLegajo = {};
  prod.forEach(r => {
    if (r.opcion === 'FJ') return;  // FJ no entra al pipeline de pares/segmentos
    (porLegajo[r.legajo] = porLegajo[r.legajo] || []).push(r);
  });

  function pushSegmentos(tipo, legajo, dtStart, dtEnd, extra) {
    const cruzaDia = dtStart.toDateString() !== dtEnd.toDateString();
    const codigoCheck = extra?.code || tipo;
    // Solo pick/arm/CR/MG pueden cruzar día. Resto → olvido si cruza.
    const noCruza = !CONFIG.puedeCruzaDia.includes(codigoCheck);
    const splits = (cruzaDia && noCruza) ? [] : splitParPorJornada(dtStart, dtEnd);
    const hsImputada = splits.reduce((s,x) => s + x.hs, 0);
    const hsBruta = (dtEnd - dtStart) / 36e5;
    const olvidado = cruzaDia && splits.length === 0;
    if (cruzaDia || olvidado) {
      cruces.push({
        legajo,
        opcion: extra?.code || tipo,
        tanda: extra?.tanda || null,
        inicio: dtStart, fin: dtEnd,
        hsBruta, hsImputada, olvidado
      });
    }
    paresOriginales.push({
      tipo, legajo,
      code: extra?.code || null,
      tanda: extra?.tanda || null,
      inicio: dtStart, fin: dtEnd,
      hsBruta, hsImputada,
      olvidado, cruzaDia,
      // fechas + hs + intervalos para sumar por rango y hacer unión
      fechasAporta: splits.map(s => s.fecha),
      segmentos: splits.map(s => ({ fecha: s.fecha, hs: s.hs, dtIni: s.dtIni, dtFin: s.dtFin }))
    });
    splits.forEach(s => segmentos.push({
      tipo, legajo,
      fecha: s.fecha,
      dtIni: s.dtIni, dtFin: s.dtFin, hs: s.hs,
      hsDiaAnterior: s.hsDiaAnterior || 0,
      ...(extra || {})
    }));
  }

  Object.entries(porLegajo).forEach(([legajo, evs]) => {
    evs.sort((a,b) => a.dt - b.dt);
    const consumidos = new Set();

    // === PASO 1: cierres con ts_inicio (Supabase moderno) — pair self-contained ===
    // Cada cierre con ts_inicio crea su par directo. Marcamos la apertura
    // correspondiente como consumida (mismo legajo, opcion compatible, dt ≈ ts_inicio).
    evs.forEach((e, idx) => {
      if (!e.dtInicio || consumidos.has(idx)) return;
      let tipo = null, extra = {};
      if (e.opcion === 'TP')                          { tipo = 'pick';   extra = { tanda: e.codigoLimpio }; }
      else if (e.opcion === 'TAP')                    { tipo = 'arm';    extra = { tanda: e.codigoLimpio }; }
      else if (e.opcion === 'CC')                     { tipo = 'cc';     extra = { tanda: e.codigoLimpio }; }
      else if (CONFIG.operativoTog.includes(e.opcion)) { tipo = 'opTog'; extra = { code: e.opcion }; }
      else if (CONFIG.muertoTog.includes(e.opcion))    { tipo = 'muerto';extra = { code: e.opcion }; }
      if (!tipo) return;
      pushSegmentos(tipo, legajo, e.dtInicio, e.dt, extra);
      consumidos.add(idx);
      // Buscar apertura: misma legajo, opcion compatible, dt ≈ dtInicio (tolerancia 1 min)
      for (let i = idx - 1; i >= 0; i--) {
        if (consumidos.has(i)) continue;
        const o = evs[i];
        if (Math.abs(+o.dt - +e.dtInicio) > 60000) continue;
        let match = false;
        if (e.opcion === 'TP')       match = (o.opcion === 'EP');
        else if (e.opcion === 'TAP') match = (o.opcion === 'AP');
        else                          match = (o.opcion === e.opcion && !o.dtInicio);
        if (match) { consumidos.add(i); break; }
      }
    });

    // === PASO 2: algoritmo viejo sobre eventos no consumidos (compat. con datos legacy) ===
    const evsLegacy = evs.filter((_, i) => !consumidos.has(i));

    // EP/TP
    const epAb = {};
    evsLegacy.forEach(e => {
      if (e.opcion === 'EP' && e.codigoLimpio) epAb[e.codigoLimpio] = e;
      else if (e.opcion === 'TP' && e.codigoLimpio && epAb[e.codigoLimpio]) {
        pushSegmentos('pick', legajo, epAb[e.codigoLimpio].dt, e.dt, { tanda: e.codigoLimpio });
        delete epAb[e.codigoLimpio];
      }
    });

    // AP/TAP
    const apAb = {};
    evsLegacy.forEach(e => {
      if (e.opcion === 'AP' && e.codigoLimpio) apAb[e.codigoLimpio] = e;
      else if (e.opcion === 'TAP' && e.codigoLimpio && apAb[e.codigoLimpio]) {
        pushSegmentos('arm', legajo, apAb[e.codigoLimpio].dt, e.dt, { tanda: e.codigoLimpio });
        delete apAb[e.codigoLimpio];
      }
    });

    // Emparejar toggles par-impar (a, b) consecutivos.
    // Regla anti-huérfano: si (a,b) cruza día Y en el día de b hay MÁS toggles
    // sin usar después de b → a es huérfano (operario no cerró tarea día anterior).
    // En ese caso a se marca como olvido y b queda libre para parearse con el siguiente.
    function emparejarToggles(togs, onPar) {
      togs = togs.slice().sort((a,b) => a.dt - b.dt);
      const usados = new Set();
      const marcarHuerfano = (a) => {
        cruces.push({
          legajo, opcion: a.opcion, tanda: a.codigoLimpio || '',
          inicio: a.dt, fin: a.dt,
          hsBruta: 0, hsImputada: 0, olvidado: true
        });
      };
      for (let i = 0; i < togs.length; i++) {
        if (usados.has(i)) continue;
        // buscar siguiente no usado
        let j = -1;
        for (let k = i+1; k < togs.length; k++) {
          if (!usados.has(k)) { j = k; break; }
        }
        const a = togs[i];
        // sin par → huérfano absoluto
        if (j === -1) {
          marcarHuerfano(a);
          usados.add(i);
          continue;
        }
        const b = togs[j];
        const cruzaDia = a.dt.toDateString() !== b.dt.toDateString();
        // Si cruza día, ver si en el día de b hay otros toggles después de b sin usar.
        // Si sí, esos forman par legítimo entre ellos → a queda huérfano.
        let bTieneCompanero = false;
        if (cruzaDia) {
          const diaB = b.dt.toDateString();
          for (let k = j+1; k < togs.length; k++) {
            if (usados.has(k)) continue;
            if (togs[k].dt.toDateString() === diaB) {
              bTieneCompanero = true;
              break;
            }
          }
        }
        if (bTieneCompanero) {
          marcarHuerfano(a);
          usados.add(i);
          continue;
        }
        // Par válido
        onPar(a, b);
        usados.add(i);
        usados.add(j);
      }
    }

    emparejarToggles(
      evsLegacy.filter(e => e.opcion === 'CC' && !e.dtInicio),
      (a, b) => {
        const tanda = b.codigoLimpio || a.codigoLimpio || '';
        pushSegmentos('cc', legajo, a.dt, b.dt, { tanda });
      }
    );
    ['RT','RI','EI','MG','CR','CT','AT'].forEach(code => {
      emparejarToggles(
        evsLegacy.filter(e => e.opcion === code && !e.dtInicio),
        (a, b) => pushSegmentos('opTog', legajo, a.dt, b.dt, { code })
      );
    });
    CONFIG.muertoTog.forEach(code => {
      emparejarToggles(
        evsLegacy.filter(e => e.opcion === code && !e.dtInicio),
        (a, b) => pushSegmentos('muerto', legajo, a.dt, b.dt, { code })
      );
    });
  });

  // === TIEMPO NETO (LIFO): el operario hace UNA tarea a la vez ===
  // Si EP 10:00 → CC 10:01 → CC 10:59 → TP 11:00:
  //   - 10:00-10:01 Picking (1m)
  //   - 10:01-10:59 Carga Camión (58m)  ← la última abierta gana
  //   - 10:59-11:00 Picking (1m)
  //   - Total Picking = 2m, CC = 58m
  // Agrupar segmentos por legajo y calcular tiempo efectivo con stack
  const segsPorLeg = {};
  segmentos.forEach(s => {
    s.hsBruto = (s.dtFin - s.dtIni) / 36e5;
    s.hs = 0;
    (segsPorLeg[s.legajo] = segsPorLeg[s.legajo] || []).push(s);
  });
  Object.values(segsPorLeg).forEach(segs => {
    // Eventos open/close ordenados
    const eventos = [];
    segs.forEach(s => {
      eventos.push({ tipo: 'open',  t: +s.dtIni, seg: s });
      eventos.push({ tipo: 'close', t: +s.dtFin, seg: s });
    });
    // Si dos eventos coinciden en tiempo: cierre antes que apertura (libera stack primero)
    eventos.sort((a,b) => a.t - b.t || (a.tipo === 'close' ? -1 : 1));

    const stack = [];
    for (let i = 0; i < eventos.length; i++) {
      const e = eventos[i];
      if (e.tipo === 'open') stack.push(e.seg);
      else {
        const idx = stack.lastIndexOf(e.seg);
        if (idx >= 0) stack.splice(idx, 1);
      }
      const next = eventos[i+1];
      if (next && stack.length > 0) {
        const dt = (next.t - e.t) / 36e5;
        if (dt > 0) stack[stack.length-1].hs += dt;
      }
    }
  });

  // Propagar netos a paresOriginales.segmentos (que son objetos separados)
  paresOriginales.forEach(p => {
    p.segmentos.forEach(ps => {
      // Buscar el segmento equivalente en segmentos[]
      const s = segmentos.find(o =>
        o.legajo === p.legajo &&
        +o.dtIni === +new Date(ps.dtIni) &&
        +o.dtFin === +new Date(ps.dtFin) &&
        o.fecha === ps.fecha
      );
      if (s) ps.hs = s.hs;
    });
    p.hsImputada = p.segmentos.reduce((sum, ps) => sum + ps.hs, 0);
  });

  // Filtrar segmentos por rango de fechas
  const segFiltrados = segmentos.filter(s => filtPorFechaIso(fechaIso(s.fecha)));

  // Agrupar por (fecha, legajo) -> base para calcular reportes
  const agrup = {};
  segFiltrados.forEach(s => {
    const k = `${s.fecha}__${s.legajo}`;
    (agrup[k] = agrup[k] || []).push(s);
  });

  // También necesitamos el primer/último evento del día (para Inicio/Fin)
  // Tomamos los eventos crudos del rango para esto
  const eventosPorFechaLegajo = {};
  prod.forEach(r => {
    if (!filtPorFechaIso(fechaIso(r.fecha))) return;
    const k = `${r.fecha}__${r.legajo}`;
    (eventosPorFechaLegajo[k] = eventosPorFechaLegajo[k] || []).push(r);
  });

  // Indices PPP principal
  function indexar(arr) {
    const fcTanda = {}, fcRazon = [], estTanda = {}, estRazon = [];
    (arr || []).forEach(p => {
      if (p.mt3fc > 0) {
        if (p.tanda) (fcTanda[p.tanda] = fcTanda[p.tanda] || []).push(p);
        fcRazon.push(p);
      }
      if (p.mt3 > 0) {
        if (p.tanda) (estTanda[p.tanda] = estTanda[p.tanda] || []).push(p);
        estRazon.push(p);
      }
    });
    return { fcTanda, fcRazon, estTanda, estRazon };
  }
  const idx = indexar(ppp);
  const idxProg = indexar(dataCruda.pppProgDiaria || []);

  // Busca primero en PPP principal, fallback a Programación Diaria
  function getMt3(codigo) {
    if (!codigo) return { mt3: 0, est: false };
    function buscar(idxObj) {
      if (CONFIG.aliasEspeciales[codigo]) {
        const re = CONFIG.aliasEspeciales[codigo];
        const fc = idxObj.fcRazon.filter(p => re.test(p.razon)).reduce((s,p) => s + p.mt3fc, 0);
        if (fc > 0) return { mt3: fc, est: false, found: true };
        const est = idxObj.estRazon.filter(p => re.test(p.razon)).reduce((s,p) => s + p.mt3, 0);
        if (est > 0) return { mt3: est, est: true, found: true };
        return { mt3: 0, est: false, found: false };
      }
      const fcArr = idxObj.fcTanda[codigo] || [];
      const fc = fcArr.reduce((s,p) => s + p.mt3fc, 0);
      if (fc > 0) return { mt3: fc, est: false, found: true };
      const estArr = idxObj.estTanda[codigo] || [];
      const est = estArr.reduce((s,p) => s + p.mt3, 0);
      if (est > 0) return { mt3: est, est: true, found: true };
      return { mt3: 0, est: false, found: false };
    }
    const r1 = buscar(idx);
    if (r1.found) return { mt3: r1.mt3, est: r1.est };
    const r2 = buscar(idxProg);
    if (r2.found) return { mt3: r2.mt3, est: r2.est };
    return { mt3: 0, est: false };
  }

  const reportes = Object.entries(agrup).map(([k, segs]) => {
    const [fecha, legajo] = k.split('__');
    const eventos = (eventosPorFechaLegajo[k] || []).sort((a,b) => a.dt - b.dt);
    const primero = eventos.length ? eventos[0].dt : null;
    const ultimo  = eventos.length ? eventos[eventos.length-1].dt : null;

    // Acumular por tipo
    const pickPairs = segs.filter(s => s.tipo === 'pick').map(s => ({ tanda: s.tanda, hs: s.hs }));
    const armPairs  = segs.filter(s => s.tipo === 'arm').map(s => ({ tanda: s.tanda, hs: s.hs }));
    const ccPairs   = segs.filter(s => s.tipo === 'cc').map(s => ({ tanda: s.tanda, hs: s.hs }));

    const opTogPorCode = {};
    ['RT','RI','EI','MG','CR','CT','AT'].forEach(c => opTogPorCode[c] = 0);
    let opTogHs = 0;
    segs.filter(s => s.tipo === 'opTog').forEach(s => {
      opTogPorCode[s.code] = (opTogPorCode[s.code] || 0) + s.hs;
      opTogHs += s.hs;
    });

    let muertoHs = 0;
    const muertoPorTipo = {};
    CONFIG.muertoTog.forEach(c => muertoPorTipo[c] = { hs: 0, eventos: 0 });
    segs.filter(s => s.tipo === 'muerto').forEach(s => {
      muertoPorTipo[s.code].hs += s.hs;
      muertoPorTipo[s.code].eventos += 1;
      muertoHs += s.hs;
    });

    const sumMt3 = pairs => {
      // Para no contar Mt3 repetido cuando una tanda aparece partida en 2 días,
      // sumamos por tanda única.
      const tandas = new Set(pairs.map(p => p.tanda).filter(Boolean));
      let total = 0, est = false;
      tandas.forEach(t => {
        const r = getMt3(t);
        total += r.mt3;
        if (r.est && r.mt3 > 0) est = true;
      });
      return { mt3: total, est };
    };
    const pickHs = pickPairs.reduce((s,p) => s+p.hs, 0);
    const pickRes = sumMt3(pickPairs);
    const pickMt3 = pickRes.mt3, pickEst = pickRes.est;
    const armHs = armPairs.reduce((s,p) => s+p.hs, 0);
    const armRes = sumMt3(armPairs);
    const armMt3 = armRes.mt3, armEst = armRes.est;
    const ccHs = ccPairs.reduce((s,p) => s+p.hs, 0);
    const ccRes = sumMt3(ccPairs);
    const ccMt3 = ccRes.mt3, ccEst = ccRes.est;

    // Cálculo "suma simple" (puede inflar si toggles se solapan)
    const opHsSuma = pickHs + armHs + ccHs + opTogHs;
    const totHsSuma = opHsSuma + muertoHs;

    // Cálculo correcto: UNIÓN de intervalos (sin doble conteo de solapamientos)
    const opSegs = segs.filter(s => ['pick','arm','cc','opTog'].includes(s.tipo))
      .map(s => ({ start: s.dtIni, end: s.dtFin }));
    const muSegs = segs.filter(s => s.tipo === 'muerto')
      .map(s => ({ start: s.dtIni, end: s.dtFin }));
    const opHs = unionHs(opSegs);
    const muHs = unionHs(muSegs);
    const totHs = unionHs([...opSegs, ...muSegs]);
    const faltHs = CONFIG.jornadaHs - totHs;

    // Llegada Tarde, Salida Temprana y Gaps (tiempo olvidado dentro del día)
    // Trunca segundos para que coincida con HH:MM mostrado
    const JI = CONFIG.jornadaInicioHora, JF = CONFIG.jornadaFinHora;
    let llegadaTarde = 0, salidaTemprana = 0, gapHs = 0, tieneContinuacionDiaSig = false;
    if (primero) {
      const inicioJor = new Date(primero.getFullYear(), primero.getMonth(), primero.getDate(), JI, 0, 0);
      const primeroTrunc = new Date(primero.getFullYear(), primero.getMonth(), primero.getDate(), primero.getHours(), primero.getMinutes(), 0);
      if (primeroTrunc > inicioJor) llegadaTarde = (primeroTrunc - inicioJor) / 36e5;
    }
    if (ultimo) {
      const finJor = new Date(ultimo.getFullYear(), ultimo.getMonth(), ultimo.getDate(), JF, 0, 0);
      const ultimoTrunc = new Date(ultimo.getFullYear(), ultimo.getMonth(), ultimo.getDate(), ultimo.getHours(), ultimo.getMinutes(), 0);
      tieneContinuacionDiaSig = segs.some(s => {
        if (!s.dtFin) return false;
        const seg17 = new Date(s.dtFin.getFullYear(), s.dtFin.getMonth(), s.dtFin.getDate(), JF, 0, 0);
        return Math.abs(+s.dtFin - +seg17) < 60000;
      });
      if (!tieneContinuacionDiaSig && ultimoTrunc < finJor) {
        salidaTemprana = (finJor - ultimoTrunc) / 36e5;
      }
    }
    // Gap dentro del día = presencia (primer → último) - tiempo trabajado (unión)
    if (segs.length > 0 && primero && ultimo) {
      const presencia = (ultimo - primero) / 36e5;
      const intervalos = segs.map(s => ({ start: s.dtIni, end: s.dtFin }));
      const trabajado = unionHs(intervalos);
      gapHs = Math.max(0, presencia - trabajado);
    }
    const faltanteTotal = llegadaTarde + salidaTemprana + gapHs;

    return {
      fecha, legajo,
      inicio: primero ? horaCorta(primero) : '—',
      fin: ultimo ? horaCorta(ultimo) : '—',
      pickHs, pickMt3, pickEst, pickPairs,
      armHs, armMt3, armEst, armPairs,
      ccHs, ccMt3, ccEst, ccPairs,
      opTogPorCode, opTogHs, muertoHs: muHs, muertoPorTipo,
      opHs, totHs, faltHs,
      llegadaTarde, salidaTemprana, gapHs, faltanteTotal, tieneContinuacionDiaSig,
      opHsSuma, totHsSuma,  // referencia (suma simple, puede inflar)
      ignorados: []
    };
  });

  // Mostrar tareas que cruzaron día (con duraciones reales imputadas)
  const crossDia = cruces
    .filter(c => filtPorFechaIso(fechaIso(fechaArg(c.inicio))) || filtPorFechaIso(fechaIso(fechaArg(c.fin))))
    .map(c => ({
      legajo: c.legajo,
      opcion: c.opcion,
      tanda: c.tanda || '',
      inicio: `${fechaArg(c.inicio)} ${horaCorta(c.inicio)}`,
      fin: `${fechaArg(c.fin)} ${horaCorta(c.fin)}`,
      hs: Math.round(c.hsImputada * 10) / 10,
      hsBruta: Math.round(c.hsBruta * 10) / 10,
      olvidado: !!c.olvidado
    }))
    .sort((a,b) => b.hsBruta - a.hsBruta);
  const ccTotalHs = reportes.reduce((s,r) => s + r.ccHs, 0);
  // ccTotalMt3 deduplicando tandas (evita doble conteo cross-día)
  const ccTandasUnicas = new Set();
  reportes.forEach(r => r.ccPairs.forEach(p => p.tanda && ccTandasUnicas.add(p.tanda)));
  let ccTotalMt3 = 0;
  ccTandasUnicas.forEach(t => { ccTotalMt3 += getMt3(t).mt3; });

  let mt3Entregados = 0;
  if (fechaDesde || fechaHasta) {
    ppp.forEach(p => {
      if (!p.mt3fc) return;
      const iso = fechaIso(p.fechaEntrega);
      if (fechaDesde && iso < fechaDesde) return;
      if (fechaHasta && iso > fechaHasta) return;
      mt3Entregados += p.mt3fc;
    });
  }

  // Filtrar paresOriginales: incluir si el par TOCA el rango (inicio, fin, o segmento aporta hs en el rango)
  const paresFiltrados = paresOriginales.filter(p => {
    if (p.fechasAporta && p.fechasAporta.some(f => filtPorFechaIso(fechaIso(f)))) return true;
    if (filtPorFechaIso(fechaIso(fechaArg(p.inicio)))) return true;
    if (filtPorFechaIso(fechaIso(fechaArg(p.fin)))) return true;
    return false;
  });

  // FJ filtrado por rango
  const fjFiltrados = fjEventos.filter(fj => filtPorFechaIso(fechaIso(fj.fecha)));

  return {
    reportes: reportes.sort((a,b) => a.fecha.localeCompare(b.fecha) || a.legajo.localeCompare(b.legajo)),
    ccTotalHs, ccTotalMt3, mt3Entregados, crossDia,
    porPersona: agruparPorPersona(reportes, getMt3),
    porSector: agruparPorSector(reportes, getMt3),
    muertosPorTipo: agruparMuertos(reportes),
    pivotEmpleados: agruparParaPivot(reportes, getMt3, paresFiltrados, fjFiltrados),
    paresOriginales: paresFiltrados,
    fjEventos: fjFiltrados
  };
}

// detectarCrossDia: la lógica está embebida en el pipeline principal ahora (cruces[])


function agruparPorPersona(reportes, getMt3Fn) {
  const m = new Map();
  reportes.forEach(r => {
    if (!m.has(r.legajo)) {
      m.set(r.legajo, {
        legajo: r.legajo,
        pickHs:0, pickTandas: new Set(),
        armHs:0,  armTandas:  new Set(),
        ccHs:0,   ccTandas:   new Set(),
        opHs:0, muertoHs:0, totHs:0, dias:new Set()
      });
    }
    const g = m.get(r.legajo);
    g.pickHs += r.pickHs;
    g.armHs  += r.armHs;
    g.ccHs   += r.ccHs;
    g.opHs   += r.opHs;
    g.muertoHs += r.muertoHs;
    g.totHs  += r.totHs;
    g.dias.add(r.fecha);
    r.pickPairs.forEach(p => p.tanda && g.pickTandas.add(p.tanda));
    r.armPairs.forEach(p => p.tanda && g.armTandas.add(p.tanda));
    r.ccPairs.forEach(p => p.tanda && g.ccTandas.add(p.tanda));
  });
  // Calcular Mt3 por tandas únicas (evita doble conteo cross-día)
  function sumMt3Set(set) {
    let total = 0, est = false;
    set.forEach(t => {
      const r = getMt3Fn(t);
      total += r.mt3;
      if (r.est && r.mt3 > 0) est = true;
    });
    return { mt3: total, est };
  }
  return [...m.values()].map(g => {
    const pickRes = sumMt3Set(g.pickTandas);
    const armRes  = sumMt3Set(g.armTandas);
    const ccRes   = sumMt3Set(g.ccTandas);
    return {
      ...g,
      dias: g.dias.size,
      pickMt3: pickRes.mt3, pickEst: pickRes.est,
      armMt3:  armRes.mt3,  armEst:  armRes.est,
      ccMt3:   ccRes.mt3,   ccEst:   ccRes.est
    };
  }).sort((a,b) => b.opHs - a.opHs);
}

function agruparPorSector(reportes, getMt3Fn) {
  const sectores = {
    Picking:        { hs:0, tandas:new Set(), operarios:new Set() },
    'Armado Pedido':{ hs:0, tandas:new Set(), operarios:new Set() },
    'Carga Camion': { hs:0, tandas:new Set(), operarios:new Set() }
  };

  function aportar(key, legajo, hs, pares) {
    if (hs <= 0) return;
    const s = sectores[key];
    s.hs += hs;
    s.operarios.add(legajo);
    (pares || []).forEach(p => p.tanda && s.tandas.add(p.tanda));
  }

  reportes.forEach(r => {
    aportar('Picking',         r.legajo, r.pickHs, r.pickPairs);
    aportar('Armado Pedido',   r.legajo, r.armHs,  r.armPairs);
    aportar('Carga Camion',    r.legajo, r.ccHs,   r.ccPairs);
  });

  return Object.entries(sectores).map(([nombre, s]) => {
    let mt3 = 0, est = false;
    s.tandas.forEach(t => {
      const r = getMt3Fn(t);
      mt3 += r.mt3;
      if (r.est && r.mt3 > 0) est = true;
    });
    return {
      nombre,
      hs: s.hs,
      mt3, est,
      tandas: s.tandas.size,
      operarios: s.operarios.size
    };
  });
}

function agruparMuertos(reportes) {
  const m = {};
  reportes.forEach(r => {
    Object.entries(r.muertoPorTipo || {}).forEach(([code, info]) => {
      if (!m[code]) m[code] = { code, hs:0, eventos:0, operarios:new Set() };
      m[code].hs += info.hs;
      m[code].eventos += info.eventos;
      if (info.hs > 0) m[code].operarios.add(r.legajo);
    });
  });
  return Object.values(m).map(g => ({
    code: g.code,
    nombre: CONFIG.muertoNombres[g.code] || g.code,
    hs: g.hs, eventos: g.eventos,
    operarios: g.operarios.size
  })).sort((a,b) => b.hs - a.hs);
}

// =============================================================================
// PIVOT REPORTE DIARIO: filas=tareas, columnas=empleados
// =============================================================================
function agruparParaPivot(reportes, getMt3Fn, paresOriginales, fjEventos) {
  // Contar pares originales por (legajo, area)
  const olvidosPorLegArea = {};
  (paresOriginales || []).forEach(p => {
    if (!p.olvidado) return;
    const k = p.legajo;
    if (!olvidosPorLegArea[k]) olvidosPorLegArea[k] = {};
    // Mapear code/tipo a area key
    let areaKey = null;
    if (p.tipo === 'pick') areaKey = 'pick';
    else if (p.tipo === 'arm') areaKey = 'arm';
    else if (p.tipo === 'cc') areaKey = 'cc';
    else if (p.tipo === 'opTog' && p.code) areaKey = p.code;
    else if (p.tipo === 'muerto' && p.code) areaKey = p.code;
    if (areaKey) olvidosPorLegArea[k][areaKey] = (olvidosPorLegArea[k][areaKey] || 0) + 1;
  });

  const out = {};
  reportes.forEach(r => {
    if (!out[r.legajo]) {
      const ol = olvidosPorLegArea[r.legajo] || {};
      out[r.legajo] = {
        legajo: r.legajo,
        pick: { hs: 0, mt3: 0, est: false, tandas: new Set(), olv: ol.pick || 0 },
        arm:  { hs: 0, mt3: 0, est: false, tandas: new Set(), olv: ol.arm || 0 },
        cc:   { hs: 0, mt3: 0, est: false, tandas: new Set(), olv: ol.cc || 0 },
        cr:   { hs: 0, olv: ol.CR || 0 }, RT: { hs: 0, olv: ol.RT || 0 },
        RI:   { hs: 0, olv: ol.RI || 0 }, EI: { hs: 0, olv: ol.EI || 0 },
        MG:   { hs: 0, olv: ol.MG || 0 }, CT: { hs: 0, olv: ol.CT || 0 },
        AT:   { hs: 0, olv: ol.AT || 0 },
        PB:   { hs: 0, olv: ol.PB || 0 }, PC: { hs: 0, olv: ol.PC || 0 },
        Limp: { hs: 0, olv: ol.Limp || 0 }, Perm: { hs: 0, olv: ol.Perm || 0 },
        opHs: 0, muHs: 0, totHs: 0,
        tarde: { hs: 0 }, temprano: { hs: 0 }, gap: { hs: 0 },
        faltante: { hs: 0 },
        FJ: { dias: [], hayFJ: false }   // {dias: [{fecha, hora, reportado, actual, mismatches}]}
      };
    }
    const g = out[r.legajo];
    g.pick.hs += r.pickHs;
    g.arm.hs  += r.armHs;
    g.cc.hs   += r.ccHs;
    r.pickPairs.forEach(p => p.tanda && g.pick.tandas.add(p.tanda));
    r.armPairs.forEach(p => p.tanda && g.arm.tandas.add(p.tanda));
    r.ccPairs.forEach(p => p.tanda && g.cc.tandas.add(p.tanda));
    g.cr.hs   += (r.opTogPorCode?.CR || 0);
    g.RT.hs   += (r.opTogPorCode?.RT || 0);
    g.RI.hs   += (r.opTogPorCode?.RI || 0);
    g.EI.hs   += (r.opTogPorCode?.EI || 0);
    g.MG.hs   += (r.opTogPorCode?.MG || 0);
    g.CT.hs   += (r.opTogPorCode?.CT || 0);
    g.AT.hs   += (r.opTogPorCode?.AT || 0);
    g.PB.hs   += (r.muertoPorTipo?.PB?.hs || 0);
    g.PC.hs   += (r.muertoPorTipo?.PC?.hs || 0);
    g.Limp.hs += (r.muertoPorTipo?.Limp?.hs || 0);
    g.Perm.hs += (r.muertoPorTipo?.Perm?.hs || 0);
    g.opHs    += r.opHs;
    g.muHs    += r.muertoHs;
    g.totHs   += r.totHs;
    g.tarde.hs    += (r.llegadaTarde || 0);
    g.temprano.hs += (r.salidaTemprana || 0);
    g.gap.hs      += (r.gapHs || 0);
    g.faltante.hs += (r.faltanteTotal || 0);
  });
  // Calcular Mt3 por tanda única (deduplicado entre días)
  Object.values(out).forEach(g => {
    ['pick','arm','cc'].forEach(k => {
      let mt3 = 0, est = false;
      g[k].tandas.forEach(t => {
        const r = getMt3Fn(t);
        mt3 += r.mt3;
        if (r.est && r.mt3 > 0) est = true;
      });
      g[k].mt3 = mt3;
      g[k].est = est;
    });
  });

  // === FJ: aggregar por legajo ===
  // Si operario presionó FJ pero no aparece en reportes (sin segmentos válidos), lo agregamos igual.
  (fjEventos || []).forEach(fj => {
    if (!out[fj.legajo]) {
      out[fj.legajo] = {
        legajo: fj.legajo,
        pick: { hs:0, mt3:0, est:false, tandas:new Set(), olv:0 },
        arm:  { hs:0, mt3:0, est:false, tandas:new Set(), olv:0 },
        cc:   { hs:0, mt3:0, est:false, tandas:new Set(), olv:0 },
        cr:{hs:0,olv:0}, RT:{hs:0,olv:0}, RI:{hs:0,olv:0}, EI:{hs:0,olv:0},
        MG:{hs:0,olv:0}, CT:{hs:0,olv:0}, AT:{hs:0,olv:0},
        PB:{hs:0,olv:0}, PC:{hs:0,olv:0}, Limp:{hs:0,olv:0}, Perm:{hs:0,olv:0},
        opHs:0, muHs:0, totHs:0,
        tarde:{hs:0}, temprano:{hs:0}, gap:{hs:0}, faltante:{hs:0},
        FJ: { dias: [], hayFJ: false }
      };
    }
    const g = out[fj.legajo];
    // Detectar mismatches reportado vs actual
    const opciones = new Set([
      ...Object.keys(fj.reportado || {}),
      ...Object.keys(fj.actual || {})
    ]);
    const mismatches = [];
    opciones.forEach(op => {
      const rep = (fj.reportado || {})[op] || 0;
      const act = (fj.actual || {})[op] || 0;
      if (rep !== act) mismatches.push({ opcion: op, reportado: rep, actual: act, diff: rep - act });
    });
    g.FJ.dias.push({
      fecha: fj.fecha,
      hora: fj.hora,
      reportado: fj.reportado || {},
      actual: fj.actual || {},
      eventsSnapshot: fj.eventsSnapshot || [],
      mismatches
    });
    g.FJ.hayFJ = true;
  });
  return out;
}
