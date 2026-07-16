"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
const setStatus = (t, cls) => {
  const el = $("status");
  if (!el) return;
  el.textContent = t || "";
  el.className = "status" + (cls ? " " + cls : "");
};

// PROV_AT y INTERNO se cargan al inicio desde tabla Talleristas (flags prov_at, interno).
// Fallback hardcoded por si la BD falla — preserva comportamiento previo.
let PROV_AT = new Set(["Carriero","Lopez Jose","Manfer","Maspoli","Melinox","Paternal Goma","Pintos","The Plast"]);
let INTERNO = new Set(["Log/ Fabr","TN"]);

async function cargarTalleristasFlags() {
  try {
    const { data, error } = await sb.from("Tall_ProvAT_PS").select("nombre, prov_at, interno").eq("activo", true);
    if (error) { console.warn("[Despiece] No se pudo cargar Talleristas, uso fallback:", error.message); return; }
    if (!data || !data.length) return;
    const provAt = new Set();
    const interno = new Set();
    data.forEach(r => {
      const n = String(r.nombre || "").trim();
      if (!n) return;
      if (r.prov_at) provAt.add(n);
      if (r.interno) interno.add(n);
    });
    PROV_AT = provAt;
    INTERNO = interno;
  } catch (e) { console.warn("[Despiece] cargarTalleristasFlags fallo, uso fallback:", e); }
}

let CACHE = {
  articulos: [],
  ce: [],
  pxps: [],
  pxtall: [],
  articulos_cajas: [],
  cajas: [],
  grj_componentes: [],  // nuevo: mapeo de GRJ a sus componentes
  flejes: [],           // nuevo: Flejes con sector para detectar compra directa
  flejes_prov: new Map(),   // sector -> proveedor (de Flejes)
  sp_kg_desc: new Map(),
  sc_kg_desc: new Map(),
  // Mapas sector -> proveedor, en orden de prioridad al resolver
  prov_sectorplasticos: new Map(),
  prov_spkg: new Map(),
  prov_sckg: new Map(),
  prov_remachessp: new Map(),
  prov_remachessc: new Map(),
  prov_bomb: new Map(),
  prov_cepillos: new Map(),
  matrices_nombres: new Map()
};

// Resolver proveedor de un sector, en orden: plásticos → SP → SC → remaches SP → remaches SC → BOMB → Cepillos
function getProveedor(sector) {
  for (const m of [CACHE.prov_sectorplasticos, CACHE.prov_spkg, CACHE.prov_sckg,
                   CACHE.prov_remachessp, CACHE.prov_remachessc, CACHE.prov_bomb, CACHE.prov_cepillos]) {
    if (m.has(sector)) {
      const p = m.get(sector);
      if (p) return p;
    }
  }
  return "";
}

async function cargarInicio() {
  setStatus("Cargando datos maestros…");
  const [arts, ce, pxps, pxtall, ac, cajas, grj, flejes, spkg, sckg, plast, remSP, remSC, bomb, cep, mat] = await Promise.all([
    sb.from("Despiece x Articulo").select('"COD","ARTICULO"').then(r => r.data || []),
    sb.from("Causa-Efecto").select('"Matriz","Descripcion Matriz","Descuenta","Aumenta"').then(r => r.data || []),
    sb.from("Partes x PS").select('"PS","Proceso","SC","SP","Parte"').then(r => r.data || []),
    sb.from("Articulos Virgilio X Tallerista").select('"Cod_Art","Desc","Tallerista","Uni_x_Caja"').then(r => r.data || []),
    sb.from("Articulos_Cajas").select('"Cod_Art","N_Caja","Uni_x_Caja","Descripcion"').then(r => r.data || []),
    sb.from("Cajas").select('"N_Caja","Sector","Descripcion","Medidas"').then(r => r.data || []),
    sb.from("GRJ_Componentes").select('cod_grj,componente,orden').then(r => r.data || []),
    sb.from("Flejes").select('"N Fleje","Sector","Descripción","Proveedor"').then(r => r.data || []),
    sb.from("SP Kg").select('"Sp","Parte","Proveedor"').then(r => r.data || []),
    sb.from("SC Kg").select('"SC","Descripcion","Proveedor"').then(r => r.data || []),
    sb.from("SectorPlasticos").select('"Sector","Proveedor"').then(r => r.data || []),
    sb.from("Remaches SP").select('"SP","Proveedor"').then(r => r.data || []),
    sb.from("Remaches SC").select('"SC","Proveedor"').then(r => r.data || []),
    sb.from("BOMB").select('"Sector","Proveedor"').then(r => r.data || []),
    sb.from("Cepillos").select('"Sector","Proveedor"').then(r => r.data || []),
    sb.from("Matrices").select('"N_Matriz","Matriz"').then(r => r.data || [])
  ]);
  CACHE.ce = ce;
  CACHE.pxps = pxps;
  CACHE.pxtall = pxtall;
  CACHE.articulos_cajas = ac;
  CACHE.cajas = cajas;
  CACHE.grj_componentes = grj;
  CACHE.flejes = flejes;
  CACHE.sp_kg_desc = new Map(spkg.map(r => [r.Sp, r.Parte]));
  CACHE.sc_kg_desc = new Map(sckg.map(r => [r.SC, r.Descripcion]));
  CACHE.flejes_prov = new Map(flejes.filter(r => r.Sector).map(r => [r.Sector, r.Proveedor || ""]));
  CACHE.prov_sectorplasticos = new Map(plast.filter(r => r.Sector).map(r => [r.Sector, r.Proveedor || ""]));
  CACHE.prov_spkg = new Map(spkg.filter(r => r.Sp).map(r => [r.Sp, r.Proveedor || ""]));
  CACHE.prov_sckg = new Map(sckg.filter(r => r.SC).map(r => [r.SC, r.Proveedor || ""]));
  CACHE.prov_remachessp = new Map(remSP.filter(r => r.SP).map(r => [r.SP, r.Proveedor || ""]));
  CACHE.prov_remachessc = new Map(remSC.filter(r => r.SC).map(r => [r.SC, r.Proveedor || ""]));
  CACHE.prov_bomb = new Map(bomb.filter(r => r.Sector).map(r => [r.Sector, r.Proveedor || ""]));
  CACHE.prov_cepillos = new Map(cep.filter(r => r.Sector).map(r => [r.Sector, r.Proveedor || ""]));
  CACHE.matrices_nombres = new Map(mat.filter(r => r.N_Matriz != null).map(r => [String(r.N_Matriz), String(r.Matriz || '').trim()]));

  // Armar lista única de artículos desde Despiece
  const seen = new Map();
  for (const a of arts) {
    if (!a.COD) continue;
    if (!seen.has(a.COD)) seen.set(a.COD, String(a.ARTICULO || "").trim());
  }
  CACHE.articulos = Array.from(seen.entries()).sort((a,b) => String(a[0]).localeCompare(String(b[0]),'es',{numeric:true}));

  const sel = $("selArt");
  sel.innerHTML = '<option value="">— elegí un artículo —</option>';
  for (const [cod, desc] of CACHE.articulos) {
    const opt = document.createElement("option");
    opt.value = cod;
    opt.textContent = `${cod} — ${desc}`;
    sel.appendChild(opt);
  }
  setStatus(`${CACHE.articulos.length} artículos cargados. Elegí uno y presioná "Trazar".`);
}

// Traza hacia atrás un sector. Devuelve array de pasos.
// Cada paso: { tipo: 'matriz'|'ps'|'fleje'|'compra', label, sector_prev, matriz, ps, proceso }
function trazarSector(sector, visitados = new Set(), profundidad = 0) {
  if (!sector || profundidad > 15) return [];
  if (sector.startsWith("CC")) return []; // Cartón comprado — no tiene ruta productiva
  if (visitados.has(sector)) return [{ tipo: 'loop', label: `(loop: ${sector})` }];
  visitados = new Set([...visitados, sector]);

  if (/^Fleje\s/i.test(sector)) {
    return [{ tipo: 'fleje', label: sector }];
  }

  // Si el sector es un GRJ composite, expandir en sus componentes (cada uno se traza aparte)
  const grjComp = CACHE.grj_componentes.filter(g => g.cod_grj === sector);
  if (grjComp.length > 0) {
    const compTexto = grjComp.sort((a,b)=>a.orden-b.orden).map(g => g.componente).join(' + ');
    // Buscar tallerista en Causa-Efecto (Matriz = nombre cuando no es número)
    const ceGrj = CACHE.ce.filter(r => r.Aumenta === sector);
    let tallGrj = '';
    for (const r of ceGrj) {
      const m = String(r.Matriz || '').trim();
      if (m && isNaN(Number(m)) && m !== 'Fabr') { tallGrj = m; break; }
    }
    const ramasGRJ = [];
    for (const g of grjComp.sort((a,b)=>a.orden-b.orden)) {
      const prev = trazarSector(g.componente, visitados, profundidad + 1);
      ramasGRJ.push({ tipo: 'grj_comp', label: g.componente, ramas: prev });
    }
    const tallLabel = tallGrj || 'Tallerista';
    return [{ tipo: 'grj', label: `${sector} ← ${tallLabel} ← ${compTexto}`, ramas: ramasGRJ }];
  }

  // Buscar producción por Causa-Efecto (matriz interna) y agrupar por (Descuenta, DescripcionMatriz)
  const ceProduce = CACHE.ce.filter(r => r.Aumenta === sector);
  // Buscar producción por Partes x PS y agrupar por (SC, Proceso)
  const pxpsProduce = CACHE.pxps.filter(r => r.SP === sector);

  const pasos = [];

  // Agrupar CE: múltiples matrices con misma descripción + misma Descuenta -> 1 paso con lista de matrices
  const ceGrouped = new Map();
  for (const r of ceProduce) {
    const key = (r.Descuenta || '') + '|' + (r["Descripcion Matriz"] || '');
    if (!ceGrouped.has(key)) ceGrouped.set(key, []);
    ceGrouped.get(key).push(r);
  }
  for (const [, grupo] of ceGrouped) {
    const r0 = grupo[0];
    const descuenta = r0.Descuenta;
    const matrices = grupo.map(x => {
      const n = String(x.Matriz).trim();
      const nombre = CACHE.matrices_nombres.get(n) || '';
      const isRedundant = !nombre || /^Matriz\s/i.test(nombre);
      return isRedundant ? `Mat ${n}` : `Mat ${n} (${nombre})`;
    }).join(' / ');
    const label = matrices;
    if (!descuenta || descuenta === 'Fabr') {
      pasos.push({ tipo: 'fabr', label, sector_prev: 'Fabricación interna' });
      continue;
    }
    const prev = trazarSector(descuenta, visitados, profundidad + 1);
    if (prev.length === 1 && (prev[0].tipo === 'fleje' || prev[0].tipo === 'compra')) {
      pasos.push({ tipo: 'matriz', label, sector_prev: prev[0].label, ramas: [] });
    } else {
      pasos.push({ tipo: 'matriz', label, sector_prev: descuenta, ramas: prev });
    }
  }

  // Agrupar PS: múltiples PS con mismo Proceso + mismo SC -> 1 paso con lista de PS apilados
  const psGrouped = new Map();
  for (const r of pxpsProduce) {
    const key = (r.SC || '') + '|' + (r.Proceso || '');
    if (!psGrouped.has(key)) psGrouped.set(key, []);
    psGrouped.get(key).push(r);
  }
  for (const [, grupo] of psGrouped) {
    const r0 = grupo[0];
    const sc = r0.SC;
    const parte = r0.Parte;
    const psList = [...new Set(grupo.map(x => (x.PS || '').trim()).filter(Boolean))];
    const procTxt = r0.Proceso ? ' (' + r0.Proceso + ')' : '';
    const label = psList.join(' / ') + procTxt;
    if (!sc) { pasos.push({ tipo: 'ps', label }); continue; }
    if (sc === 'ST') {
      // Buscar quién produjo ST con la misma Parte. Así resolvemos el "tránsito".
      const stProducers = CACHE.pxps.filter(p => p.SP === 'ST' && p.Parte === parte);
      if (stProducers.length === 0) {
        pasos.push({ tipo: 'ps_st', label, sector_prev: 'ST (sin origen)', nota: 'No se encontró quién produce ST para "' + parte + '"' });
        continue;
      }
      // Agrupar productores de ST
      const stGrouped = new Map();
      for (const sp of stProducers) {
        const k = (sp.SC || '') + '|' + (sp.Proceso || '');
        if (!stGrouped.has(k)) stGrouped.set(k, []);
        stGrouped.get(k).push(sp);
      }
      // Por cada productor de ST, construir ramificación: productor_ST -> su SC (y continuar)
      const ramasST = [];
      for (const [, g] of stGrouped) {
        const p0 = g[0];
        const psListST = [...new Set(g.map(x => (x.PS || '').trim()).filter(Boolean))];
        const labelST = psListST.join(' / ') + (p0.Proceso ? ' (' + p0.Proceso + ')' : '');
        const prevST = trazarSector(p0.SC, visitados, profundidad + 1);
        if (prevST.length === 1 && (prevST[0].tipo === 'fleje' || prevST[0].tipo === 'compra')) {
          ramasST.push({ tipo: 'ps', label: labelST, sector_prev: prevST[0].label, ramas: [] });
        } else {
          ramasST.push({ tipo: 'ps', label: labelST, sector_prev: p0.SC, ramas: prevST });
        }
      }
      pasos.push({ tipo: 'ps', label, sector_prev: 'ST', ramas: ramasST });
      continue;
    }
    const prev = trazarSector(sc, visitados, profundidad + 1);
    if (prev.length === 1 && (prev[0].tipo === 'fleje' || prev[0].tipo === 'compra')) {
      pasos.push({ tipo: 'ps', label, sector_prev: prev[0].label, psList, ramas: [] });
    } else {
      pasos.push({ tipo: 'ps', label, sector_prev: sc, psList, ramas: prev });
    }
  }

  // Si no hay productor interno, puede ser Fleje directo o Compra.
  // Regla: si el sector es un SP (existe en SP Kg), NUNCA sale de Fleje aunque exista un
  // Fleje homónimo — los SPs sin matriz en la cadena vienen de Compra (ej: D9-SP vs D9-Fleje).
  if (pasos.length === 0) {
    const spDesc = CACHE.sp_kg_desc.get(sector);
    const scDesc = CACHE.sc_kg_desc.get(sector);

    if (!spDesc) {
      const flejeDirecto = CACHE.flejes.find(f => f.Sector === sector);
      if (flejeDirecto) {
        const nFleje = flejeDirecto["N Fleje"] || sector;
        const desc = flejeDirecto["Descripción"] || "";
        const prov = flejeDirecto["Proveedor"] || "sin proveedor";
        const label = desc ? `Fleje ${nFleje} (${desc}) — ${prov}` : `Fleje ${nFleje} — ${prov}`;
        pasos.push({ tipo: 'fleje', label });
        return pasos;
      }
    }

    const prov = getProveedor(sector) || "sin proveedor";
    const isRemache = CACHE.prov_remachessp.has(sector) || CACHE.prov_remachessc.has(sector);
    if (isRemache) {
      pasos.push({ tipo: 'compra_remache', label: `📦 Comprado (Remaches) — ${prov}` });
    } else {
      pasos.push({ tipo: 'compra', label: `${sector} (${prov})` });
    }
  }

  return pasos;
}

// Aplanar pasos en array de celdas lineal (cada "paso" = una columna)
function aplanar(pasos, acum = []) {
  const res = [];
  for (const p of pasos) {
    const cadena = [...acum, p];
    if (p.ramas && p.ramas.length > 0) {
      res.push(...aplanar(p.ramas, cadena));
    } else {
      res.push(cadena);
    }
  }
  return res;
}

function talleristasDe(cod) {
  return CACHE.pxtall
    .filter(t => t.Cod_Art === cod)
    .map(t => t.Tallerista)
    .filter(Boolean);
}

function resolverCaja(cod) {
  const ac = CACHE.articulos_cajas.find(a => a.Cod_Art === cod);
  if (!ac) return null;
  const caja = CACHE.cajas.find(c => c.N_Caja === ac.N_Caja);
  return {
    n_caja: ac.N_Caja,
    uni_x_caja: ac.Uni_x_Caja,
    sector: caja ? caja.Sector : null,
    medidas: caja ? caja.Medidas : null
  };
}

// Guarda el último resultado renderizado (trace o resumen) para exportarlo a CSV
// desde los datos, no raspando el DOM.
let ULTIMO = null;

// Convierte un paso de la cadena a texto limpio para el CSV — versión INVERSA:
// muestra "entrada ⟶ proceso" (origen primero), en línea con la lectura al revés.
function pasoATextoInv(c) {
  if (typeof c === "string") return c;
  let s = String(c.label || "").replace(/📦/g, "").replace(/\s+/g, " ").trim();
  if (c.sector_prev) s = c.sector_prev + " ⟶ " + s;
  return s;
}

// VERSIÓN INVERSA de renderTrace:
// - El orden de columnas está espejado: arranca por el Origen (Fleje/Compra) a la
//   izquierda y termina en el Item a la derecha.
// - Dentro de la cadena, se invierte el orden: primero el fleje/compra, luego cada
//   proceso hasta el productor final, con la flecha apuntando hacia el producto (⇒).
function renderTrace(cod) {
  const articulo = CACHE.articulos.find(([c]) => c === cod)?.[1] || "";
  sb.from("Despiece x Articulo")
    .select('"Sector Proce","Descripcion de partes","Partes x uni","Rubro","KGxUni"')
    .eq("COD", cod)
    .then(r => {
      const partes = r.data || [];
      const talleristas = talleristasDe(cod);
      const talTxt = talleristas.length ? talleristas.join(" / ") : "— sin asignar —";
      const caja = resolverCaja(cod);

      const destinoTipo = talleristas.every(t => PROV_AT.has(t)) && talleristas.length
        ? "Prov Art Terminado"
        : talleristas.some(t => INTERNO.has(t))
          ? "Fabricación interna"
          : "Tallerista";

      const traceItems = [];

      let html = `<div class="resumen">
        <b>Artículo ${esc(cod)}</b>: ${esc(articulo)}<br>
        <b>Destino:</b> ${esc(talTxt)} <span style="color:#64748b">(${destinoTipo})</span>
        ${caja ? `<br><b>Caja:</b> Nº${esc(caja.n_caja)} · sector ${esc(caja.sector || "?")} · ${esc(caja.medidas || "?")} · ${esc(caja.uni_x_caja)} uni/caja` : ""}
      </div>`;

      // Cabecera espejada: Origen → … → productor a la izquierda, Item a la derecha.
      // trace-frozen: ancla las columnas Tallerista..Item a la derecha (ver style.css);
      // solo la primera columna (Origen) scrollea horizontalmente.
      html += `<table class="trace trace-frozen"><thead><tr>
        <th>Origen → proceso (entrada + proceso)</th>
        <th>Tallerista (destino)</th>
        <th>Partes<br>/ uni</th>
        <th>Sector</th>
        <th>Descripción parte</th>
        <th>Item</th>
      </tr></thead><tbody>`;

      let n = 1;
      for (const p of partes) {
        const sector = p["Sector Proce"];
        const desc = p["Descripcion de partes"] || "";
        const pxu = p["Partes x uni"] || "1";
        const rubro = p.Rubro || "";

        if (!sector) {
          // Cartón o sin sector
          traceItems.push({ item: n, desc, sector: "—", pxu, rubro, ramas: [[{ tipo: "compra", label: "Compra (" + (rubro || "packaging") + ")" }]] });
          html += `<tr>
            <td class="origen">Compra (${esc(rubro || "packaging")})</td>
            <td class="tall">${esc(talTxt)}</td>
            <td>${esc(pxu)}</td>
            <td class="cod">—</td>
            <td>${esc(desc)}</td>
            <td class="item-num">${n++}</td>
          </tr>`;
          continue;
        }

        if (sector.startsWith("CC")) {
          // Cartón con prefijo CC → comprado, sin ruta productiva
          const sectorDisplay = sector.slice(2); // quitar prefijo CC para mostrar
          traceItems.push({ item: n, desc, sector: sectorDisplay, pxu, rubro, ramas: [[{ tipo: "compra", label: "Comprado (" + (rubro || "Cartones") + ")" }]] });
          html += `<tr>
            <td class="origen">📦 Comprado (${esc(rubro || "Cartones")})</td>
            <td class="tall">${esc(talTxt)}</td>
            <td>${esc(pxu)}</td>
            <td class="cod">${esc(sectorDisplay)}</td>
            <td>${esc(desc)}</td>
            <td class="item-num">${n++}</td>
          </tr>`;
          continue;
        }

        const pasos = trazarSector(sector);
        const ramas = aplanar(pasos);

        if (ramas.length === 0) {
          traceItems.push({ item: n, desc, sector, pxu, rubro, ramas: [[{ tipo: "sin", label: "Sin trazado" }]] });
          html += `<tr>
            <td class="origen">Sin trazado</td>
            <td class="tall">${esc(talTxt)}</td>
            <td>${esc(pxu)}</td>
            <td class="cod">${esc(sector)}</td>
            <td>${esc(desc)}</td>
            <td class="item-num">${n++}</td>
          </tr>`;
          continue;
        }

        // Una fila por rama, con la cadena concatenada en la primera columna (izquierda).
        // La cadena se invierte: fleje/compra primero, cada proceso después, hasta el productor final.
        // ramas ESTRUCTURADAS (objetos con tipo/label/sector_prev) para el export con slots
        traceItems.push({ item: n, desc, sector, pxu, rubro, ramas: ramas.map(cadena => [...cadena].reverse()) });
        for (let i = 0; i < ramas.length; i++) {
          const cadenaRev = [...ramas[i]].reverse();
          const cadenaHtml = cadenaRev.map(c => {
            let txt = esc(c.label);
            if (c.sector_prev) txt = '<b>' + esc(c.sector_prev) + '</b> <span style="color:#94a3b8">→</span> ' + txt;
            return '<div class="paso-cell">' + txt + '</div>';
          }).join('<div class="paso-sep">⇒</div>');
          html += `<tr>
            <td class="origen"><div class="paso-row">${cadenaHtml}</div></td>
            <td class="tall">${i === 0 ? esc(talTxt) : ""}</td>
            <td>${i === 0 ? esc(pxu) : ""}</td>
            <td class="cod">${i === 0 ? esc(sector) : ""}</td>
            <td>${i === 0 ? esc(desc) : '<span style="color:#94a3b8">(mismo item, otra rama)</span>'}</td>
            <td class="item-num">${i === 0 ? n : ""}</td>
          </tr>`;
        }
        n++;
      }

      if (caja) {
        traceItems.push({ item: n, desc: "Caja Nº" + caja.n_caja, sector: caja.sector || "—", pxu: "1/" + caja.uni_x_caja, rubro: "Packaging", ramas: [[{ tipo: "compra", label: "Compra (Caja " + (caja.medidas || "") + ")" }]] });
        html += `<tr>
          <td class="origen">Compra (Caja ${esc(caja.medidas || "")})</td>
          <td class="tall">${esc(talTxt)}</td>
          <td>1/${esc(caja.uni_x_caja)}</td>
          <td class="cod">${esc(caja.sector || "—")}</td>
          <td>Caja Nº${esc(caja.n_caja)}</td>
          <td class="item-num">${n++}</td>
        </tr>`;
      }

      html += `</tbody></table>`;
      $("tablaWrap").innerHTML = html;
      ULTIMO = {
        tipo: "trace",
        cod, articulo, destino: talTxt, destinoTipo,
        caja: caja ? { n_caja: caja.n_caja, sector: caja.sector, medidas: caja.medidas, uni_x_caja: caja.uni_x_caja } : null,
        items: traceItems
      };
      setStatus(`Trazado inverso de ${cod} listo (${n - 1} items).`, "ok");
      $("btnExport").disabled = false;
    });
}

function exportarCSV() {
  if (!ULTIMO) { setStatus("Primero generá un trazado o el resumen.", "err"); return; }

  const SEP = ";"; // Excel es-AR abre con ; en columnas al hacer doble clic
  const hoy = new Date().toISOString().slice(0, 10);
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const linea = (arr) => arr.map(q).join(SEP);
  const filas = [];
  let nombreArch;

  if (ULTIMO.tipo === "resumen") {
    filas.push(linea(["Despiece x Artículo — Resumen de cobertura"]));
    filas.push(linea(["Generado", hoy]));
    filas.push("");
    filas.push(linea(["Cod", "Artículo", "Partes", "→ Fleje", "→ Compra", "Sin trazado", "Cobertura %"]));
    for (const r of ULTIMO.rows) {
      filas.push(linea([r.cod, r.desc, r.total, r.llegaFleje, r.llegaCompra, r.sinTrazado, r.cov + "%"]));
    }
    nombreArch = `despiece_resumen_${hoy}.csv`;
  } else {
    // Formato = hoja "Matrices-SC-SP-PS" del Excel del usuario (48 columnas fijas).
    // Una fila por rama; cada elemento de la cadena cae en su "slot" segun tipo.
    // Familia (c48) = familia del ARTICULO que se hace (mismo criterio que clasificarFamilia de EnviosPS.js).
    const familiaDeArticulo = (nombre) => {
      const p = String(nombre || "").toLowerCase();
      if (/pelad|pelap/.test(p)) return "Pelador";
      if (/sacacorch|sac\s*comb|sac\s*mozo|sacatap|aleta|cabezal|destapacorona/.test(p)) return "Sacacorchos";
      if (/abrelat|maripos|varilla\s*c\/?\s*cuch|manija|mgo\s*plano|engranaje|cpo\s*u[ñn]a/.test(p)) return "Abrelatas";
      return "Otros";
    };
    const familiaArt = familiaDeArticulo(ULTIMO.articulo);
    const HDR = ["N° Fleje", "Sector Fleje", "Descripción Fleje",
      "Matriz 1", "N° Matriz", "SC", "Matriz 2", "N° Matriz", "SC",
      "Matriz 3", "N° Matriz", "Matriz 4", "N° Matriz", "Matriz 5", "N° Matriz", "Matriz 6", "N° Matriz",
      "Taller 1", "ST", "SG", "SC", "Taller 2", "SC",
      "PS", "Sflejes", "ST", "SP",
      "Matriz 4", "N° Matriz", "PS", "ST", "SC",
      "PS", "Safilado", "Piedra", "SP",
      "Taller 3", "SC", "PS", "SP",
      "Sec Plástico", "Sec Garage", "Taller 4",
      "Art 1", "Matriz 4", "Matriz 5", "Matriz 6", "Familia"];
    filas.push(linea(HDR));

    const MAT_SLOTS = [[4, 5], [7, 8], [10, 11], [12, 13], [14, 15], [16, 17], [28, 29]];
    const MAT_SC = { 0: 6, 1: 9 };       // salida de Matriz 1/2 tiene columna SC propia
    const SC_SLOTS = [21, 23, 32, 38];
    const SP_SLOTS = [27, 36, 40];
    const PS_SLOTS = [24, 30, 33, 39];
    const ST_SLOTS = [26, 31, 19];

    for (const it of ULTIMO.items) {
      for (const rama of it.ramas) {
        const row = new Array(49).fill("");
        let matI = 0, scI = 0, spI = 0, psI = 0, stI = 0;
        let prevKind = null, prevMatIdx = -1;

        const fillOrigenFleje = (txt) => {
          const m = String(txt).match(/Fleje\s+([^\s(—]+)/i);
          const nF = m ? m[1] : "";
          row[1] = nF;
          const fr = CACHE.flejes.find(f => String(f["N Fleje"]) === String(nF));
          if (fr) { row[2] = fr.Sector || ""; row[3] = fr["Descripción"] || ""; }
          else row[3] = String(txt);
        };
        const placeTaller = (name, esFinal) => {
          const orden = esFinal ? [37, 43, 22, 18] : [18, 22, 37, 43];
          for (const s of orden) { if (!row[s]) { row[s] = name; return; } }
        };
        const placeSector = (sec) => {
          if (!sec) return;
          const s = String(sec).trim();
          if (/^Mat(riz)?\b/i.test(s)) return; // nodo "Mat N": ya representado por el paso matriz
          if (/^ST\b/.test(s)) { if (stI < ST_SLOTS.length && !row[ST_SLOTS[stI]]) row[ST_SLOTS[stI++]] = s; return; }
          if (prevKind === "matriz" && MAT_SC[prevMatIdx] != null && !row[MAT_SC[prevMatIdx]]) { row[MAT_SC[prevMatIdx]] = s; return; }
          if (/^GRJ/i.test(s)) { row[42] = row[42] ? row[42] + " / " + s : s; return; }
          if (CACHE.prov_sectorplasticos.has(s)) { row[41] = row[41] ? row[41] + " / " + s : s; return; }
          // dual SC+SP (ej IF16): preferir slot SC (criterio de la hoja del usuario)
          if (CACHE.sp_kg_desc.has(s) && !CACHE.sc_kg_desc.has(s)) { if (spI < SP_SLOTS.length) { row[SP_SLOTS[spI++]] = s; return; } }
          if (scI < SC_SLOTS.length) { row[SC_SLOTS[scI++]] = s; return; }
          if (spI < SP_SLOTS.length) row[SP_SLOTS[spI++]] = s;
        };

        for (const st of rama) {
          if (typeof st === "string") { // legacy / labels sueltos
            if (/^Fleje/i.test(st)) fillOrigenFleje(st);
            else if (!row[3]) row[3] = st;
            continue;
          }
          const t = st.tipo;
          if (t === "fleje") { fillOrigenFleje(st.label); prevKind = "origin"; continue; }
          if (t === "compra" || t === "compra_remache" || t === "sin" || t === "loop") {
            if (!row[3]) row[3] = String(st.label || "").replace(/📦/g, "").trim();
            prevKind = "origin"; continue;
          }

          // entrada del paso = salida del paso anterior
          const entrada = st.sector_prev ? String(st.sector_prev).trim() : "";
          if (entrada) {
            if (/^Fleje\s/i.test(entrada)) fillOrigenFleje(entrada);
            else if (/Fabricaci/i.test(entrada)) placeTaller("Fábrica", false);
            else if (!/^(Compra|Comprado|📦)/i.test(entrada)) placeSector(entrada);
          }

          if (t === "matriz" || t === "fabr") {
            if (t === "fabr") { placeTaller("Fábrica", false); prevKind = "taller"; prevMatIdx = -1; continue; }
            const nros = [], noms = [];
            const re = /Mat\s+([^\s(\/]+)(?:\s*\(([^)]*)\))?/g;
            let mm;
            while ((mm = re.exec(st.label))) { nros.push(mm[1]); noms.push(mm[2] || CACHE.matrices_nombres.get(mm[1]) || ""); }
            if (nros.length && nros.every(x => !/^\d/.test(x))) {
              // "Mat Martin" etc (no empieza con numero): tallerista que arma, no matriz.
              // Ojo: "12B"/"28B" SI son matrices (empiezan con numero).
              placeTaller(nros.join(" / "), false); prevKind = "taller"; prevMatIdx = -1; continue;
            }
            if (matI < MAT_SLOTS.length) {
              const [cNom, cNro] = MAT_SLOTS[matI];
              row[cNom] = noms.filter(Boolean).join(" / ") || ("Mat " + nros.join(" / "));
              row[cNro] = nros.join(" / ");
              prevMatIdx = matI; matI++;
            }
            prevKind = "matriz"; continue;
          }
          if (t === "ps" || t === "ps_st") {
            const names = String(st.label || "").replace(/\([^)]*\)/g, "").trim();
            if (psI < PS_SLOTS.length) row[PS_SLOTS[psI++]] = names;
            prevKind = "ps"; prevMatIdx = -1; continue;
          }
          if (t === "grj") {
            const partes2 = String(st.label || "").split("←").map(x => x.trim());
            row[42] = row[42] ? row[42] + " / " + partes2[0] : (partes2[0] || "");
            if (partes2[1]) placeTaller(partes2[1], false);
            prevKind = "taller"; prevMatIdx = -1; continue;
          }
          if (t === "grj_comp") { placeSector(st.label); prevKind = "sector"; prevMatIdx = -1; continue; }
          prevKind = "otro"; prevMatIdx = -1;
        }

        // salida del productor final = sector del item; destino y articulo
        if (it.sector && it.sector !== "—") placeSector(it.sector);
        placeTaller(ULTIMO.destino, true);
        row[44] = ULTIMO.cod;
        row[48] = familiaArt;
        filas.push(linea(row.slice(1)));
      }
    }
    nombreArch = `despiece_inverso_${ULTIMO.cod || "articulo"}_${hoy}.csv`;
  }

  const csv = "﻿" + filas.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArch;
  a.click();
  URL.revokeObjectURL(url);
}

// Cuenta cuántos componentes de un producto llegan a Fleje vs Compra, para generar resumen
function analizarProducto(cod){
  const despPartes = [];
  for (const k of CACHE._despiecePorCod[cod] || []){ despPartes.push(k); }
  let llegaFleje = 0, llegaCompra = 0, sinTrazado = 0, total = 0;
  for (const p of despPartes){
    const sector = p["Sector Proce"];
    if (!sector) { llegaCompra++; total++; continue; }
    if (sector.startsWith("CC")) { llegaCompra++; total++; continue; } // Cartón comprado
    const pasos = trazarSector(sector);
    const ramas = aplanar(pasos);
    if (!ramas.length) { sinTrazado++; total++; continue; }
    let hayFleje = false, hayCompra = false;
    for (const cadena of ramas){
      const ult = cadena[cadena.length - 1];
      if (ult.tipo === 'fleje') hayFleje = true;
      else if (ult.tipo === 'compra' || ult.tipo === 'compra_remache' || ult.tipo === 'ps' || ult.tipo === 'matriz') hayCompra = true;
    }
    if (hayFleje) llegaFleje++;
    else if (hayCompra) llegaCompra++;
    else sinTrazado++;
    total++;
  }
  return { total, llegaFleje, llegaCompra, sinTrazado };
}

async function renderResumen(){
  setStatus("Calculando resumen de trazado…");
  // Cache by cod
  CACHE._despiecePorCod = CACHE._despiecePorCod || await (async () => {
    const { data } = await sb.from("Despiece x Articulo").select('"COD","Sector Proce","Descripcion de partes"');
    const map = {};
    for (const r of (data||[])){
      if (!map[r.COD]) map[r.COD] = [];
      map[r.COD].push(r);
    }
    return map;
  })();

  const rows = [];
  for (const [cod, desc] of CACHE.articulos){
    const a = analizarProducto(cod);
    const cov = a.total > 0 ? Math.round(100 * (a.llegaFleje + a.llegaCompra) / a.total) : 0;
    rows.push({ cod, desc, ...a, cov });
  }
  rows.sort((a, b) => (a.cov - b.cov) || a.cod.localeCompare(b.cod));

  let html = `<div class="resumen"><b>Resumen de cobertura</b>: ${rows.length} artículos. Columna "Cobertura %" = componentes con origen trazable (Fleje o Compra) / total.</div>`;
  html += `<table class="trace"><thead><tr><th>Cod</th><th>Artículo</th><th>Partes</th><th>→ Fleje</th><th>→ Compra</th><th>Sin trazado</th><th>Cobertura %</th></tr></thead><tbody>`;
  for (const r of rows){
    const badge = r.cov === 100 ? '✅' : r.cov >= 75 ? '🟡' : '⚠️';
    html += `<tr>
      <td class="cod">${esc(r.cod)}</td>
      <td>${esc(r.desc)}</td>
      <td>${r.total}</td>
      <td style="color:#059669">${r.llegaFleje}</td>
      <td style="color:#2563eb">${r.llegaCompra}</td>
      <td style="color:#ef4444">${r.sinTrazado}</td>
      <td><b>${r.cov}%</b> ${badge}</td>
    </tr>`;
  }
  html += `</tbody></table>`;
  $("tablaWrap").innerHTML = html;
  ULTIMO = { tipo: "resumen", rows };
  const prom = Math.round(rows.reduce((s, r) => s + r.cov, 0) / Math.max(1, rows.length));
  setStatus(`Cobertura promedio: ${prom}% (${rows.length} productos).`, prom === 100 ? "ok" : "");
  $("btnExport").disabled = false;
}

document.addEventListener("DOMContentLoaded", () => {
  $("btnTrazar").addEventListener("click", () => {
    const cod = $("selArt").value;
    if (!cod) { setStatus("Elegí un artículo primero.", "err"); return; }
    setStatus(`Trazando ${cod}…`);
    $("btnExport").disabled = true;
    renderTrace(cod);
  });
  $("btnExport").addEventListener("click", exportarCSV);
  $("btnResumen").addEventListener("click", () => renderResumen().catch(e => setStatus("Error: " + e.message, "err")));
  cargarTalleristasFlags().finally(() => {
    cargarInicio().catch(e => { setStatus("Error cargando: " + e.message, "err"); });
  });
});
