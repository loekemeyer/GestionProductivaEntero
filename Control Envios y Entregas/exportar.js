"use strict";

/****************************************************************
 * Exportar Datos — Envíos + Entregas en UN archivo (por Prov/Tall → CSV)
 * Origen: Prov. Servicios | Talleristas
 * Mes:    un mes (columnas = día)
 * Salida: 2 secciones (ENVÍOS / ENTREGAS), cada una con un BLOQUE por
 *         Proveedor/Tallerista. Dentro de cada bloque: pivote dim × días + TOTAL.
 *         Pensado para que un prompt distinga claramente envío de entrega.
 *
 * Dimensiones de fila (dims) por tipo:
 *   Envíos / Entregas PS / Envíos Tall → Descripción + Sector
 *   Entregas Tall (especial)           → Código + Descripción  (Sucursal=Virg)
 *
 * Medidas por origen+tipo (adaptativo: se oculta la que da 0 en el bloque):
 *   PS Envíos    → Kg + Cajones + Unidades
 *   PS Entregas  → Kg + Cajones
 *   Tall Envíos  → Kg + Unidades  (sin Cajones, por decisión)
 *   Tall Entregas→ Cajas
 ****************************************************************/

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===== Estado =====
let selOrigen = "";   // 'ps' | 'tall'
let nombresToken = 0; // evita carreras al recargar lista de nombres
let ultimoExport = null; // modelo del último Generar, para el CSV

const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

// ===== Helpers =====
function setStatus(t){ statusEl.textContent = t || ""; }

function escapeHtml(s){
  return String(s == null ? "" : s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function normalizeText(v){
  return String(v || "").trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");
}

function parseDecimal(value){
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let s = String(value).trim();
  if (!s || s === "-" || s === "—") return 0;
  s = s.replace(/[^\d,.-]/g, "");
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function pick(obj, keys){
  for (const k of keys){
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

function formatKg(n){
  return Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
function formatUni(n){
  return Math.round(Number(n || 0)).toLocaleString("es-AR");
}

const pad2 = n => String(n).padStart(2, "0");

// Parser de fecha flexible. Devuelve {y,m,d} (y puede ser null si no viene año).
function parseFecha(value){
  const s = String(value || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) return { y: null, m: +m[2], d: +m[1] };
  return null;
}

// Carga paginada de una tabla completa.
async function cargarTabla(tabla, cols = "*"){
  const out = [];
  const PAGE = 1000;
  let from = 0;
  while (true){
    const { data, error } = await sb.from(tabla).select(cols).range(from, from + PAGE - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// ===== Configuración por (origen, tipo) =====
function getConfig(origen, tipo){
  if (origen === "ps" && tipo === "envios"){
    return {
      tabla: "Envios a PS",
      parteKeys: ["Parte", "Descripcion", "descripcion", "Descripción"],
      sectorKeys: ["Sector SP", "Sector", "Sector SC", "sector"],
      fechaKeys: ["Dia-mes", "dia-mes", "Fecha", "fecha"],
      nombreKeys: ["Prov_Serv", "prov_serv", "Prov Serv"],
      medidas: [
        { id: "kg",  label: "Kg",  keys: ["KG", "Kg", "kg"], int: false },
        { id: "caj", label: "Caj", keys: ["Cajones", "cajones"], int: true },
        { id: "uni", label: "Uni", keys: ["Unidades", "unidades", "Uni"], int: true }
      ]
    };
  }
  if (origen === "ps" && tipo === "entregas"){
    return {
      tabla: "Entregas PS",
      parteKeys: ["Parte", "Descripcion", "descripcion", "Descripción"],
      sectorKeys: ["Sector SP", "Sector SC", "Sector", "sector"],
      fechaKeys: ["Dia-mes", "dia-mes", "Fecha", "fecha"],
      nombreKeys: ["Prov_Serv", "prov_serv", "Prov Serv"],
      medidas: [
        { id: "kg",  label: "Kg",  keys: ["KG", "Kg", "kg"], int: false },
        { id: "caj", label: "Caj", keys: ["Cajones", "cajones"], int: true }
      ]
    };
  }
  if (origen === "tall" && tipo === "envios"){
    return {
      tabla: "Envios a Talleristas",
      parteKeys: ["Descripcion", "descripcion", "Descripción", "DESCRIPCION"],
      sectorKeys: ["Sector", "sector", "SECTOR"],
      fechaKeys: ["Dia-mes", "dia-mes", "Fecha", "fecha"],
      nombreKeys: ["Tallerista", "tallerista", "TALLERISTA"],
      // Tall: medida Kg (sin Cajones). Unidades para partes cargadas por unidad.
      medidas: [
        { id: "kg",  label: "Kg",  keys: ["KG", "Kg", "kg"], int: false },
        { id: "uni", label: "Uni", keys: ["Unidades", "unidades", "Uni"], int: true }
      ]
    };
  }
  // tall + entregas → artículo terminado a Virgilio. Fila = Código + Descripción.
  // Cod → desc via Partes x Tallerista. Solo Sucursal=Virg. Medida = Cajas.
  return {
    tabla: "Entregas_Tall_Todas",
    especialTall: true,
    sucursalFiltro: "Virg",
    fechaKeys: ["Fecha", "fecha", "Dia-mes"],
    nombreKeys: ["Nombre_Tall", "nombre_tall"],
    medidas: [
      { id: "cajas", label: "Cajas", keys: ["Cajas", "cajas"], int: true }
    ]
  };
}

// Columnas de dimensión (encabezado de fila) según el tipo de config.
function dimsDeConfig(cfg){
  if (cfg.especialTall){
    return [
      { field: "cod", label: "Código", cls: "cod" },
      { field: "descripcion", label: "Descripción", cls: "desc" }
    ];
  }
  return [
    { field: "descripcion", label: "Descripción", cls: "desc" },
    { field: "sector", label: "Sector", cls: "sector" }
  ];
}

// Mapa Cod → {desc, sector} para Tall + Entregas (desde Partes x Tallerista).
async function cargarMapaPartesTall(){
  const rows = await cargarTabla("Partes x Tallerista",
    '"tallerista","cod_art","descripcion_parte","sector_proce"');
  const porTallCod = new Map(); // tallNorm__cod → {desc,sector}
  const porCod = new Map();     // cod → {desc,sector} (fallback)
  rows.forEach(r => {
    const tall = normalizeText(pick(r, ["tallerista", "Tallerista"]));
    const cod = String(pick(r, ["cod_art", "Cod_Art"]) || "").trim();
    if (!cod) return;
    const info = {
      desc: String(pick(r, ["descripcion_parte", "Descripcion_parte"]) || "").trim(),
      sector: String(pick(r, ["sector_proce", "Sector_Proce"]) || "").trim()
    };
    if (tall){
      const k = `${tall}__${cod}`;
      if (!porTallCod.has(k)) porTallCod.set(k, info);
    }
    if (!porCod.has(cod)) porCod.set(cod, info);
  });
  return { porTallCod, porCod };
}

// Carga la lista de Prov. Servicios o Talleristas y puebla el <select>.
async function cargarNombres(origen){
  const token = ++nombresToken;
  const sel = document.getElementById("selNombre");
  const step = document.getElementById("stepNombre");
  const label = document.getElementById("labelNombre");
  label.textContent = origen === "ps" ? "Proveedor de Servicios" : "Tallerista";
  step.classList.remove("hidden");
  sel.innerHTML = `<option value="">Cargando...</option>`;

  let nombres = [];
  try {
    if (origen === "ps"){
      const [a, b] = await Promise.all([
        cargarTabla("Envios a PS", '"Prov_Serv"'),
        cargarTabla("Entregas PS", '"Prov_Serv"')
      ]);
      nombres = [...a, ...b].map(r => String(r.Prov_Serv || "").trim());
    } else {
      const [a, b] = await Promise.all([
        cargarTabla("Envios a Talleristas", '"Tallerista"'),
        cargarTabla("Entregas_Tall_Todas", '"Nombre_Tall"')
      ]);
      nombres = [
        ...a.map(r => String(r.Tallerista || "").trim()),
        ...b.map(r => String(r.Nombre_Tall || "").trim())
      ];
    }
  } catch(e){
    console.error(e);
    if (token === nombresToken) sel.innerHTML = `<option value="">(error al cargar)</option>`;
    return;
  }
  if (token !== nombresToken) return; // el origen cambió mientras cargaba

  const vistos = new Map();
  nombres.filter(Boolean).forEach(n => {
    const k = normalizeText(n);
    if (!vistos.has(k)) vistos.set(k, n);
  });
  const ordenados = [...vistos.values()].sort((a, b) => a.localeCompare(b, "es"));
  const labelSel = origen === "ps" ? "un proveedor" : "un tallerista";
  sel.innerHTML = `<option value="" disabled selected>— Elegí ${labelSel} —</option>` +
    ordenados.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
}

// ===== Construcción de una sección (un tipo) =====
// Devuelve { cfg, tipoLabel, dims, bloques } o null si no hay datos.
function buildResultado(cfg, tipoLabel, filas, mapaTall, filtroNombre, anio, mes){
  const nMed = cfg.medidas.length;
  const porNombre = new Map(); // nombre → { partes:Map<clave,{...dims,cells,totals}>, diasSet }

  filas.forEach(r => {
    const nombreRaw = String(pick(r, cfg.nombreKeys) || "").trim();
    if (filtroNombre && normalizeText(nombreRaw) !== filtroNombre) return;
    if (cfg.sucursalFiltro){
      const suc = normalizeText(pick(r, ["Sucursal", "sucursal"]));
      if (suc !== normalizeText(cfg.sucursalFiltro)) return;
    }

    const p = parseFecha(pick(r, cfg.fechaKeys));
    if (!p) return;
    if (p.m !== mes) return;
    if (p.y && p.y !== anio) return;
    const dia = p.d;

    const campos = {};
    const valores = new Array(nMed).fill(0);
    let clave;

    if (cfg.especialTall){
      const tall = normalizeText(pick(r, ["Nombre_Tall", "nombre_tall"]));
      const cod = String(pick(r, ["Cod", "cod", "Cod_Art"]) || "").trim();
      const info = mapaTall.porTallCod.get(`${tall}__${cod}`) || mapaTall.porCod.get(cod) || null;
      campos.cod = cod || "(sin cod)";
      campos.descripcion = (info && info.desc) || (cod ? `Cod ${cod}` : "(sin código)");
      valores[0] = parseDecimal(pick(r, cfg.medidas[0].keys));
      clave = campos.cod;
    } else {
      campos.descripcion = String(pick(r, cfg.parteKeys) || "").trim();
      campos.sector = String(pick(r, cfg.sectorKeys) || "").trim();
      cfg.medidas.forEach((m, i) => { valores[i] = parseDecimal(pick(r, m.keys)); });
      if (!campos.descripcion && !campos.sector) return;
      clave = `${campos.sector}|||${normalizeText(campos.descripcion)}`;
    }

    if (valores.every(v => !v)) return;

    const nombre = nombreRaw || "(sin nombre)";
    if (!porNombre.has(nombre)) porNombre.set(nombre, { partes: new Map(), diasSet: new Set() });
    const grp = porNombre.get(nombre);
    grp.diasSet.add(dia);

    if (!grp.partes.has(clave)){
      grp.partes.set(clave, { ...campos, cells: new Map(), totals: new Array(nMed).fill(0) });
    }
    const reg = grp.partes.get(clave);
    let cel = reg.cells.get(dia);
    if (!cel){ cel = new Array(nMed).fill(0); reg.cells.set(dia, cel); }
    for (let i = 0; i < nMed; i++){ cel[i] += valores[i]; reg.totals[i] += valores[i]; }
  });

  if (!porNombre.size) return null;

  const dims = dimsDeConfig(cfg);
  const bloques = [...porNombre.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "es"))
    .map(([nombre, grp]) => {
      const granTot = new Array(nMed).fill(0);
      grp.partes.forEach(p => { for (let i = 0; i < nMed; i++) granTot[i] += p.totals[i]; });
      let keep = cfg.medidas.map((m, i) => i).filter(i => granTot[i] !== 0);
      if (!keep.length) keep = cfg.medidas.map((m, i) => i);
      const medidas = keep.map(i => cfg.medidas[i]);

      const partes = [...grp.partes.values()].sort((a, b) => {
        if (cfg.especialTall) return String(a.cod).localeCompare(String(b.cod), "es", { numeric: true });
        const s = String(a.sector).localeCompare(String(b.sector), "es", { numeric: true });
        return s !== 0 ? s : String(a.descripcion).localeCompare(String(b.descripcion), "es");
      });
      if (keep.length !== nMed){
        partes.forEach(p => {
          p.totals = keep.map(i => p.totals[i]);
          p.cells.forEach((cel, d) => p.cells.set(d, keep.map(i => cel[i])));
        });
      }
      const dias = [...grp.diasSet].sort((a, b) => a - b);
      return { nombre, medidas, dias, partes };
    });

  return { cfg, tipoLabel, dims, bloques };
}

// ===== Generar =====
async function generar(){
  if (!selOrigen){ setStatus("Elegí Origen."); return; }
  const vMes = document.getElementById("inMes").value; // "YYYY-MM"
  if (!vMes){ setStatus("Elegí un mes."); return; }
  const [anio, mes] = vMes.split("-").map(Number);

  const cfgE = getConfig(selOrigen, "envios");
  const cfgS = getConfig(selOrigen, "entregas");
  const selNombreVal = document.getElementById("selNombre").value;
  if (!selNombreVal || selNombreVal === "__todos__"){
    setStatus(`Elegí ${selOrigen === "ps" ? "un proveedor" : "un tallerista"} (es obligatorio).`);
    return;
  }
  const filtroNombre = normalizeText(selNombreVal);
  resultEl.innerHTML = "";
  ultimoExport = null;
  setStatus("Cargando datos...");

  let filasE, filasS, mapaTall = null;
  try {
    [filasE, filasS] = await Promise.all([
      cargarTabla(cfgE.tabla, "*"),
      cargarTabla(cfgS.tabla, "*")
    ]);
    if (cfgE.especialTall || cfgS.especialTall) mapaTall = await cargarMapaPartesTall();
  } catch(e){ console.error(e); setStatus("Error: " + e.message); return; }

  const resE = buildResultado(cfgE, "Envíos", filasE, mapaTall, filtroNombre, anio, mes);
  const resS = buildResultado(cfgS, "Entregas", filasS, mapaTall, filtroNombre, anio, mes);
  if (!resE && !resS){ setStatus("Sin datos para esos filtros."); return; }

  ultimoExport = {
    origen: selOrigen, anio, mes,
    nombre: selNombreVal,
    origenLabel: selOrigen === "ps" ? "Prov. Servicios" : "Talleristas",
    campoNombre: selOrigen === "ps" ? "Proveedor" : "Tallerista",
    secciones: [resE, resS].filter(Boolean)
  };
  renderTodo(ultimoExport);
}

// Totales por columna (día × medida) y gran total por medida de un bloque.
function totalesBloque(bloque){
  const { medidas: meds, dias, partes } = bloque;
  const nMed = meds.length;
  const totCol = new Map();
  const totGen = new Array(nMed).fill(0);
  dias.forEach(d => totCol.set(d, new Array(nMed).fill(0)));
  partes.forEach(p => {
    p.cells.forEach((cel, d) => { const tc = totCol.get(d); for (let i = 0; i < nMed; i++) tc[i] += cel[i]; });
    for (let i = 0; i < nMed; i++) totGen[i] += p.totals[i];
  });
  return { totCol, totGen };
}

// ===== Render preview =====
function celdaDim(d, valor){
  if (d.field === "sector") return `<td class="sector">${valor ? escapeHtml(valor) : '<span class="zero">-</span>'}</td>`;
  if (d.field === "descripcion") return `<td class="desc" title="${escapeHtml(valor)}">${escapeHtml(valor)}</td>`;
  return `<td class="${d.cls}">${escapeHtml(valor == null ? "" : valor)}</td>`;
}

function buildTablaHTML(bloque, dims){
  const { medidas: meds, dias, partes } = bloque;
  const nMed = meds.length;
  const { totCol, totGen } = totalesBloque(bloque);
  const fmtMed = (m, v) => (v ? escapeHtml(m.int ? formatUni(v) : formatKg(v)) : "");

  const leadHead = dims.map(d => `<th class="${d.cls}" rowspan="2">${escapeHtml(d.label)}</th>`).join("");
  const h1 = dias.map(d => `<th class="dia-sep" colspan="${nMed}">${pad2(d)}</th>`).join("") +
             `<th class="dia-sep" colspan="${nMed}">Total</th>`;
  const subMed = meds.map((m, i) => `<th class="${i === 0 ? "dia-sep" : ""}">${escapeHtml(m.label)}</th>`).join("");
  const h2 = dias.map(() => subMed).join("") + subMed;

  const body = partes.map(p => {
    const lead = dims.map(d => celdaDim(d, p[d.field])).join("");
    const celdas = dias.map(d => {
      const cel = p.cells.get(d);
      return meds.map((m, i) =>
        `<td class="num ${i === 0 ? "dia-sep" : ""}">${cel ? fmtMed(m, cel[i]) : ""}</td>`).join("");
    }).join("");
    const totales = meds.map((m, i) =>
      `<td class="num total ${i === 0 ? "dia-sep" : ""}">${fmtMed(m, p.totals[i])}</td>`).join("");
    const dataDesc = String(p.descripcion || "").toLowerCase();
    const dataExtra = String(p.sector != null ? p.sector : (p.cod != null ? p.cod : "")).toLowerCase();
    return `<tr data-desc="${escapeHtml(dataDesc)}" data-extra="${escapeHtml(dataExtra)}">${lead}${celdas}${totales}</tr>`;
  }).join("");

  const footLead = dims.map((d, i) => `<td class="${d.cls}">${i === 0 ? "TOTAL" : ""}</td>`).join("");
  const footCeldas = dias.map(d => {
    const tc = totCol.get(d);
    return meds.map((m, i) => `<td class="num ${i === 0 ? "dia-sep" : ""}">${fmtMed(m, tc[i])}</td>`).join("");
  }).join("");
  const footTot = meds.map((m, i) => `<td class="num total ${i === 0 ? "dia-sep" : ""}">${fmtMed(m, totGen[i])}</td>`).join("");

  return `<table class="pivote exp2">
      <thead>
        <tr class="h1">${leadHead}${h1}</tr>
        <tr class="h2">${h2}</tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot><tr>${footLead}${footCeldas}${footTot}</tr></tfoot>
    </table>`;
}

function renderTodo(model){
  const { secciones, campoNombre, origenLabel, anio, mes } = model;
  const cuantos = campoNombre === "Proveedor" ? "prov" : "tall";
  const resumen = secciones.map(s => `${s.tipoLabel}: ${s.bloques.length} ${cuantos}`).join(" · ");
  const totalPartes = secciones.reduce((a, s) => a + s.bloques.reduce((x, b) => x + b.partes.length, 0), 0);
  setStatus(`${origenLabel} · Mes ${pad2(mes)}/${anio} · ${resumen} · ${totalPartes} filas`);

  const seccionesHtml = secciones.map(s => {
    const bloquesHtml = s.bloques.map(b => {
      const medsLabel = b.medidas.map(m => m.label).join(" + ");
      return `<div class="bloque">
          <div class="report-head">${escapeHtml(campoNombre)}: ${escapeHtml(b.nombre)} · ${b.partes.length} filas · ${b.dias.length} días · <b>${escapeHtml(medsLabel)}</b></div>
          <div class="table-scroll">${buildTablaHTML(b, s.dims)}</div>
        </div>`;
    }).join("");
    return `<div class="seccion">
        <div class="seccion-head">${escapeHtml(s.tipoLabel.toUpperCase())}</div>
        ${bloquesHtml || '<div class="vacio">Sin datos.</div>'}
      </div>`;
  }).join("");

  resultEl.innerHTML = `
    <div class="report-tools no-print">
      <input type="text" id="filtroDesc" class="filtro-input" placeholder="Filtrar por descripción..." autocomplete="off">
      <input type="text" id="filtroSector" class="filtro-input" placeholder="Filtrar por sector / código..." autocomplete="off">
      <span id="filtroCount" class="filtro-count"></span>
      <button type="button" id="btnCsv" class="btn-csv">⬇ Descargar CSV</button>
    </div>
    ${seccionesHtml}`;

  document.getElementById("btnCsv").addEventListener("click", () => descargarCSV(model));

  // Filtros desc + sector/código (aplican a todas las filas de todas las secciones)
  const fDesc = document.getElementById("filtroDesc");
  const fSec  = document.getElementById("filtroSector");
  const cnt   = document.getElementById("filtroCount");
  function aplicarFiltro(){
    const qD = String(fDesc.value || "").trim().toLowerCase();
    const qS = String(fSec.value || "").trim().toLowerCase();
    const trs = resultEl.querySelectorAll("tbody tr");
    let visibles = 0;
    trs.forEach(tr => {
      const ok = (!qD || (tr.dataset.desc || "").includes(qD)) &&
                 (!qS || (tr.dataset.extra || "").includes(qS));
      tr.style.display = ok ? "" : "none";
      if (ok) visibles++;
    });
    cnt.textContent = (qD || qS) ? `${visibles} / ${totalPartes} filas` : "";
  }
  fDesc.addEventListener("input", aplicarFiltro);
  fSec.addEventListener("input", aplicarFiltro);
}

// ===== CSV (secciones ENVÍOS / ENTREGAS, bloque por nombre) =====
function csvNum(v, isInt){
  if (!v) return "";
  if (isInt) return String(Math.round(v));
  return String(Number(v)).replace(".", ",");
}
function csvCampo(s){
  const t = String(s == null ? "" : s);
  return /[;"\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

function descargarCSV(model){
  const { secciones, campoNombre, origen, origenLabel, nombre, anio, mes } = model;
  // Línea de cabecera: hace el CSV autodescriptivo (el mes NO está en las columnas, solo el día).
  const partes = [csvCampo(`Export Control Envios y Entregas | Origen: ${origenLabel} | ${campoNombre}: ${nombre} | Mes: ${pad2(mes)}/${anio}`)];

  secciones.forEach(s => {
    partes.push(csvCampo(`=== ${s.tipoLabel.toUpperCase()} ===`));
    s.bloques.forEach(b => {
      const meds = b.medidas;
      const { totCol, totGen } = totalesBloque(b);

      const head = s.dims.map(d => d.label);
      b.dias.forEach(d => meds.forEach(m => head.push(`${pad2(d)} ${m.label}`)));
      meds.forEach(m => head.push(`Total ${m.label}`));

      const lineas = [
        csvCampo(`${s.tipoLabel} | ${campoNombre}: ${b.nombre}`),
        head.map(csvCampo).join(";")
      ];
      b.partes.forEach(p => {
        const fila = s.dims.map(d => (p[d.field] == null ? "" : p[d.field]));
        b.dias.forEach(d => {
          const cel = p.cells.get(d);
          meds.forEach((m, i) => fila.push(csvNum(cel ? cel[i] : 0, m.int)));
        });
        meds.forEach((m, i) => fila.push(csvNum(p.totals[i], m.int)));
        lineas.push(fila.map(csvCampo).join(";"));
      });
      const filaTot = s.dims.map((d, i) => (i === 0 ? "TOTAL" : ""));
      b.dias.forEach(d => { const tc = totCol.get(d); meds.forEach((m, i) => filaTot.push(csvNum(tc[i], m.int))); });
      meds.forEach((m, i) => filaTot.push(csvNum(totGen[i], m.int)));
      lineas.push(filaTot.map(csvCampo).join(";"));

      partes.push(lineas.join("\r\n"));
    });
  });

  const csv = "﻿" + partes.join("\r\n\r\n"); // BOM + secciones/bloques separados por línea en blanco
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const nombreArch = String(nombre || "").trim().replace(/[^\w\-]+/g, "_").replace(/^_+|_+$/g, "") || "sin_nombre";
  a.download = `export_${origen}_${nombreArch}_${anio}-${pad2(mes)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ===== Wiring =====
function wireGrupo(idGrupo, setter){
  const grp = document.getElementById(idGrupo);
  grp.querySelectorAll(".opt").forEach(b => {
    b.addEventListener("click", () => {
      grp.querySelectorAll(".opt").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      setter(b.dataset.val);
    });
  });
}

wireGrupo("grpOrigen", v => { selOrigen = v; cargarNombres(v); });

document.getElementById("btnGenerar").addEventListener("click", generar);

// Default mes = actual
(function initMes(){
  const hoy = new Date();
  document.getElementById("inMes").value = `${hoy.getFullYear()}-${pad2(hoy.getMonth() + 1)}`;
})();
