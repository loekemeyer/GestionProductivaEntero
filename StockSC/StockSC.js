"use strict";

/* =========================================================
   BLOQUE: CONFIG SUPABASE
========================================================= */
const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =========================================================
   BLOQUE: DOM
========================================================= */
const statusEl    = document.getElementById("status");
const resultEl    = document.getElementById("result");
const searchInput = document.getElementById("searchInput");

/* =========================================================
   BLOQUE: ESTADO GLOBAL (para búsqueda)
========================================================= */
let todosLosSC      = [];
let enviosPSDataG   = null;
let enviosTallDataG = null;
let aumentosTransfG = null;
let fabricacionMapG = new Map();
let scPorProvServMap = new Map();
const filtroProvServ = document.getElementById("filtroProvServ");

/* =========================================================
   BLOQUE: HELPERS
========================================================= */
function setStatus(t) {
  statusEl.textContent = t || "";
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function parseDecimal(value) {
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  let s = String(value).trim();
  if (!s || s === "-" || s === "—") return 0;

  s = s.replace(/[^\d,.-]/g, "");

  if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString("es-AR", {
    maximumFractionDigits: 0,
  });
}

function formatDecimal(n) {
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function formatCajones(n) {
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function sortKeyFechaDDMM(value) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{4})?$/);
  if (!m) return 9999;
  return Number(m[2]) * 100 + Number(m[1]);
}

/* =========================================================
   BLOQUE: CARGA DE DATOS
========================================================= */
async function cargarBaseSCKg() {
  const { data, error } = await supabaseClient
    .from("SC Kg")
    .select("*")
    .order("SC", { ascending: true });

  if (error) {
    console.error("ERROR SC Kg:", error);
    throw new Error(error.message || "Error al leer SC Kg");
  }

  return data || [];
}

async function fetchAllPaginated(table, selectCols = "*", filters = null) {
  const out = [];
  const PAGE = 1000;
  const MAX_PAGES = 100; // safety net
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = supabaseClient.from(table).select(selectCols).range(from, from + PAGE - 1);
    if (filters) filters.forEach(f => { q = q[f.op](f.col, f.val); });
    const { data, error } = await q;
    if (error) { console.error(error); throw new Error(`${table}: ${error.message}`); }
    if (!data || !data.length) return out;
    out.push(...data);
    if (data.length < PAGE) return out;
    from += PAGE;
    if (page === MAX_PAGES - 1) console.warn(`[fetchAllPaginated] ${table}: MAX_PAGES alcanzado, filas: ${out.length}`);
  }
  return out;
}

async function cargarEnviosPS() {
  return await fetchAllPaginated("Envios a PS", `"Dia-mes","Sector SC","Cajones","KG","Prov_Serv"`);
}

async function cargarEnviosTalleristas() {
  try { return await fetchAllPaginated("Envios a Talleristas", `"Dia-mes","Sector","Cajones","KG","Tallerista"`); }
  catch(e) { console.error("ERROR Envios a Talleristas:", e); return []; }
}

// Entregas Tallerista Virgilio donde Cod_GRJ apunta a un sector SC (M6/M8/F7) → AUMENTA ese sector.
// Estas son entregas de transformacion 1:1 (Poly devuelve M6 que vino como M10).
async function cargarEntregasTransformacion() {
  try {
    const all = await fetchAllPaginated("Entregas_Tall_Todas", `"Fecha","Cod","Cod_GRJ","Cajas","Kg_GRJ","Nombre_Tall"`);
    return all.filter(r => r.Cod_GRJ != null && String(r.Cod_GRJ).trim() !== "");
  } catch(e) { console.error("ERROR Entregas Tall transf:", e); return []; }
}

function armarMapaAumentosTransformacion(rows) {
  // key: sector normalizado (= Cod_GRJ) → { totalUni, detalle:[{fecha, cajas, tallerista}] }
  const totalMap = new Map();
  const detalleMap = new Map();
  rows.forEach(r => {
    const sector = normalizeText(r["Cod_GRJ"]);
    if (!sector) return;
    const cajas = parseDecimal(r["Cajas"]);
    if (!cajas) return;
    const fecha = String(r["Fecha"] || "").trim();
    const tallerista = String(r["Nombre_Tall"] || "").trim();
    totalMap.set(sector, (totalMap.get(sector) || 0) + cajas);
    if (!detalleMap.has(sector)) detalleMap.set(sector, []);
    detalleMap.get(sector).push({ fecha, cajas, tallerista });
  });
  return { totalMap, detalleMap };
}

async function cargarDBEspejo() {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseClient
      .from("db_n8n_espejo")
      .select("*")
      .neq("Legajo", "1")  // excluir registros de Pruebas (Legajo 1)
      .range(from, from + PAGE - 1);

    if (error) {
      console.error("ERROR db_n8n_espejo:", error);
      throw new Error(error.message || "Error al leer db_n8n_espejo");
    }
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  const data = all;

  const rows = data || [];
  console.log(`[db_n8n_espejo] ${rows.length} filas. Primera:`, rows[0]);
  return rows;
}

async function cargarCausaEfecto() {
  const { data, error } = await supabaseClient
    .from("Causa-Efecto")
    .select("*");

  if (error) {
    console.error("ERROR Causa-Efecto:", error);
    throw new Error(error.message || "Error al leer Causa-Efecto");
  }

  const rows = data || [];
  console.log(`[Causa-Efecto] ${rows.length} filas. Primera:`, rows[0]);
  return rows;
}

/* =========================================================
   BLOQUE: MAPA DE ENVIOS PS POR SECTOR
========================================================= */
function armarMapaEnviosPS(rows) {
  const totalMap = new Map();
  const detalleMap = new Map();

  rows.forEach((r) => {
    const sector = normalizeText(r["Sector SC"]);
    const cajones = parseDecimal(r["Cajones"]);
    const kg = parseDecimal(r["KG"]);
    const fecha = String(r["Dia-mes"] || "").trim();

    if (!sector) return;
    if (!cajones && !kg) return;

    const key = sector;

    totalMap.set(key, (totalMap.get(key) || 0) + kg);

    if (!detalleMap.has(key)) detalleMap.set(key, []);
    const provServ = String(r["Prov_Serv"] || "").trim();
    detalleMap.get(key).push({ fecha, cajones, kg, provServ });
  });

  for (const [key, arr] of detalleMap.entries()) {
    arr.sort((a, b) => sortKeyFechaDDMM(b.fecha) - sortKeyFechaDDMM(a.fecha));
    detalleMap.set(key, arr);
  }

  return { totalMap, detalleMap };
}

function armarMapaEnviosTall(rows) {
  const totalMap = new Map();
  const detalleMap = new Map();

  rows.forEach((r) => {
    const sector = normalizeText(r["Sector"]);
    const cajones = parseDecimal(r["Cajones"]);
    const kg = parseDecimal(r["KG"]);
    const fecha = String(r["Dia-mes"] || "").trim();

    if (!sector) return;
    if (!cajones && !kg) return;

    const key = sector;
    totalMap.set(key, (totalMap.get(key) || 0) + kg);

    if (!detalleMap.has(key)) detalleMap.set(key, []);
    const tallerista = String(r["Tallerista"] || "").trim();
    detalleMap.get(key).push({ fecha, cajones, kg, provServ: tallerista });
  });

  for (const [key, arr] of detalleMap.entries()) {
    arr.sort((a, b) => sortKeyFechaDDMM(b.fecha) - sortKeyFechaDDMM(a.fecha));
    detalleMap.set(key, arr);
  }

  return { totalMap, detalleMap };
}

/* =========================================================
   BLOQUE: MAPA FABRICACIÓN (db_n8n_espejo × Causa-Efecto)
   Devuelve: Map<SECTOR_UPPER, { aumenta, descuenta, detalleAumenta[], detalleDescuenta[] }>
========================================================= */
function pick(obj, ...keys) {
  for (const k of keys) if (obj != null && k in obj) return obj[k];
  return undefined;
}

function armarMapaFabricacion(dbRows, causaEfectoRows) {
  // Lookup: Matriz → [{ descuenta, aumenta, desc }]
  // Acepta variantes de capitalización de los nombres de columna
  const causaMap = new Map();
  causaEfectoRows.forEach((r) => {
    const matriz = String(pick(r, "Matriz", "matriz") ?? "").trim();
    if (!matriz) return;
    if (!causaMap.has(matriz)) causaMap.set(matriz, []);
    causaMap.get(matriz).push({
      descuenta: String(pick(r, "Descuenta", "descuenta") ?? "").trim().toUpperCase(),
      aumenta:   String(pick(r, "Aumenta",   "aumenta")   ?? "").trim().toUpperCase(),
      desc:      String(pick(r, "Descripcion Matriz", "descripcion matriz") ?? "").trim(),
    });
  });

  // Acumular producción por Matriz + Fecha + Legajo
  const prodPorMatrizFecha = new Map();
  dbRows.forEach((r) => {
    const matriz = String(pick(r, "Matriz", "matriz") ?? "").trim();
    const uni = parseDecimal(pick(r, "Uni", "uni"));
    if (!matriz || !uni) return;
    const mes = r["Mes"] ?? r["mes"];
    const dia = r["Dia"] ?? r["dia"];
    const mesStr = String(mes || "").padStart(2, "0");
    const diaStr = String(dia || "").padStart(2, "0");
    const fecha = (mes && dia) ? `${diaStr}-${mesStr}` : "";
    const legajo = String(pick(r, "Legajo", "legajo") ?? "").trim();
    const nombre = String(pick(r, "Nombre_Empleado", "nombre_empleado") ?? "").trim();
    const key = `${matriz}|||${fecha}|||${legajo}`;
    if (!prodPorMatrizFecha.has(key)) {
      prodPorMatrizFecha.set(key, { matriz, fecha, legajo, nombre, uni: 0 });
    }
    prodPorMatrizFecha.get(key).uni += uni;
  });

  console.log(`[fabricacion] causaMap: ${causaMap.size} matrices, prodPorMatrizFecha: ${prodPorMatrizFecha.size} entradas`);
  console.log("[fabricacion] causa keys:", [...causaMap.keys()].slice(0, 10));

  // Construir mapa por sector
  const sectorMap = new Map();
  const ensure = (sector) => {
    if (!sectorMap.has(sector)) {
      sectorMap.set(sector, { aumenta: 0, descuenta: 0, detalleAumenta: [], detalleDescuenta: [] });
    }
    return sectorMap.get(sector);
  };

  for (const [, { matriz, fecha, legajo, nombre, uni: uniTotal }] of prodPorMatrizFecha.entries()) {
    const efectos = causaMap.get(matriz) || [];
    efectos.forEach((ef) => {
      if (ef.aumenta) {
        const e = ensure(ef.aumenta);
        e.aumenta += uniTotal;
        e.detalleAumenta.push({ matriz, fecha, legajo, nombre, uni: uniTotal });
      }
      if (ef.descuenta) {
        const e = ensure(ef.descuenta);
        e.descuenta += uniTotal;
        e.detalleDescuenta.push({ matriz, fecha, legajo, nombre, uni: uniTotal });
      }
    });
  }

  return sectorMap;
}

/* =========================================================
   BLOQUE: POPUP
========================================================= */
function fechaDDMM_a_DDMMAAAA(f) {
  const s = String(f || "").trim();
  const m = s.match(/^(\d{1,2})[\/](\d{1,2})$/);
  if (m) return `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}/${new Date().getFullYear()}`;
  return s || "Sin fecha";
}

function fechaDDguionMM_a_DDMMAAAA(f) {
  const s = String(f || "").trim();
  const m = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1].padStart(2,"0")}/${m[2].padStart(2,"0")}/${new Date().getFullYear()}`;
  return s || "Sin fecha";
}

function detalleToPopup(detalle, etiqueta, kgXUni) {
  if (!detalle.length) return `Sin ${etiqueta}`;

  return detalle
    .map((x) => {
      const uni = (kgXUni > 0 && x.kg) ? Math.round(x.kg / kgXUni) : 0;
      const kgTxt = x.kg ? ` - ${formatDecimal(x.kg)} kg` : "";
      const cajTxt = x.cajones ? ` - ${formatCajones(x.cajones)} caj` : "";
      const destTxt = x.provServ ? ` → ${x.provServ}` : "";
      const fechaTxt = fechaDDMM_a_DDMMAAAA(x.fecha);
      return `${fechaTxt}${kgTxt}${cajTxt} - ${formatNumber(uni)} uni${destTxt}`;
    })
    .join("|");
}

/* =========================================================
   BLOQUE: RENDER
========================================================= */
function renderTabla(scRows, enviosPSData, fabricacionMap, enviosTallData, aumentosTransf) {
  enviosTallData = enviosTallData || { totalMap: new Map(), detalleMap: new Map() };
  aumentosTransf = aumentosTransf || { totalMap: new Map(), detalleMap: new Map() };
  // Detectar si TODOS los sectores visibles son de tipo tallerista-only (envíos tall sin envíos PS)
  let countPS = 0, countTall = 0;
  scRows.forEach(r => {
    const key = normalizeText(r["SC"]);
    const hasPS   = (enviosPSData.totalMap.get(key) || 0) > 0;
    const hasTall = (enviosTallData.totalMap.get(key) || 0) > 0;
    if (hasTall && !hasPS) countTall++;
    else if (hasPS) countPS++;
  });
  // Header dinamico
  const headerLabel = (countTall > 0 && countPS === 0) ? "Envios Tall"
                    : (countPS  > 0 && countTall === 0) ? "Envios PS"
                    : "Envios";
  let rows = "";

  scRows.forEach((r) => {
    const sector = String(r["SC"] || "").trim();
    const descripcion = String(r["Descripcion"] || "").trim();

    const key = normalizeText(sector);
    const sectorUp = sector.toUpperCase();

    const stockInicial = parseDecimal(r["Stock Inicial"]);
    const kgXUni = parseDecimal(r["Kg X Uni"]);
    const maxCajCerv = parseDecimal(r["Max Caj Cerv"]);
    const nFleje = String(r["N Fleje"] || "").trim();
    const piezaMadre = String(r["Pieza Madre"] || "").trim();

    const kgXCajon = parseDecimal(r["Kg x Cajon"] ?? r["Kg Cajon"] ?? r["KG x Cajon"] ?? r["kg x cajon"] ?? 0);

    /* =========================================================
       BLOQUE: FABRICACIÓN (db_n8n_espejo × Causa-Efecto)
       aumenta  = unidades producidas que suman a este sector
       descuenta = unidades consumidas que restan de este sector
    ========================================================= */
    const fabData = fabricacionMap.get(sectorUp) || { aumenta: 0, descuenta: 0, detalleAumenta: [], detalleDescuenta: [] };
    const fabricacionNeta = fabData.aumenta - fabData.descuenta;

    const popupLineas = [];
    // Sort detalle por fecha DD-MM (desc = reciente primero)
    const sortFechaDesc = (a, b) => {
      const pa = (a.fecha || "").split("-"), pb = (b.fecha || "").split("-");
      const ka = (pa[1] || "00") + (pa[0] || "00"), kb = (pb[1] || "00") + (pb[0] || "00");
      return kb.localeCompare(ka);
    };
    [...fabData.detalleAumenta].sort(sortFechaDesc).forEach((d) =>
      popupLineas.push(`▲ ${d.fecha ? fechaDDguionMM_a_DDMMAAAA(d.fecha) + " - " : ""}Mtz ${d.matriz} - Leg ${d.legajo} ${d.nombre}: +${formatNumber(Math.round(d.uni))} uni`)
    );
    [...fabData.detalleDescuenta].sort(sortFechaDesc).forEach((d) =>
      popupLineas.push(`▼ ${d.fecha ? fechaDDguionMM_a_DDMMAAAA(d.fecha) + " - " : ""}Mtz ${d.matriz} - Leg ${d.legajo} ${d.nombre}: -${formatNumber(Math.round(d.uni))} uni`)
    );
    // Agregar aumentos por entregas transformacion (Poly devuelve M6 desde M10)
    const detTransfRows = aumentosTransf.detalleMap.get(normalizeText(sector)) || [];
    [...detTransfRows].sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")).forEach(d => {
      let fTxt = "";
      if (d.fecha) {
        const p = d.fecha.split("-");
        fTxt = p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d.fecha;
      }
      popupLineas.push(`▲ ${fTxt ? fTxt + " - " : ""}${d.tallerista} (transformación): +${formatNumber(Math.round(d.cajas))} uni`);
    });
    const popupFabricacion = popupLineas.length ? popupLineas.join("|") : "Sin fabricación";

    /* =========================================================
       BLOQUE: ENVIOS PS
       Busca por sector SC — acumula KG, convierte a uni
    ========================================================= */
    const enviosPSKg = Number(enviosPSData.totalMap.get(key) || 0);
    const enviosPSUni = kgXUni > 0 ? enviosPSKg / kgXUni : 0;

    /* =========================================================
       BLOQUE: ENVIOS TALLERISTAS
       Algunos sectores SC se envian a talleristas (ej. M10 → Poly para doblar).
    ========================================================= */
    const enviosTallKg = Number(enviosTallData.totalMap.get(key) || 0);
    const enviosTallUni = kgXUni > 0 ? enviosTallKg / kgXUni : 0;

    /* =========================================================
       BLOQUE: AUMENTO POR ENTREGAS TRANSFORMACION (Cod_GRJ=sector)
       Ej. Poly entrega M6 (Cod=M10, Cod_GRJ=M6, Cajas=1 uni) → +1 uni a stock M6.
    ========================================================= */
    const aumentoTransfUni = Number(aumentosTransf.totalMap.get(key) || 0);

    /* =========================================================
       BLOQUE: FORMULA ONLINE UNI
       Uni = Stock Inicial + FabricaciónNeta + AumentoTransformacion - Envios PS (uni) - Envios Tall (uni)
    ========================================================= */
    const onlineUni = stockInicial + fabricacionNeta + aumentoTransfUni - enviosPSUni - enviosTallUni;

    /* =========================================================
       BLOQUE: DERIVADOS VISUALES
    ========================================================= */
    const onlineKg = onlineUni * kgXUni;
    const onlineCaj = kgXCajon > 0 ? onlineKg / kgXCajon : 0;

    const detalleEnviosPS = enviosPSData.detalleMap.get(key) || [];
    const detalleEnviosTall = enviosTallData.detalleMap.get(key) || [];
    // Si el sector tiene envíos tall y no PS, mostrar la columna como "Tall"; si PS y no Tall, "PS"; si ambos, suma.
    const hasPS = enviosPSUni > 0 || detalleEnviosPS.length > 0;
    const hasTall = enviosTallUni > 0 || detalleEnviosTall.length > 0;
    const enviosUniMostrado = enviosPSUni + enviosTallUni;
    const popupEnvios = (hasTall && !hasPS)
      ? detalleToPopup(detalleEnviosTall, "envíos Tall", kgXUni)
      : (hasPS && !hasTall)
        ? detalleToPopup(detalleEnviosPS, "envíos PS", kgXUni)
        : detalleToPopup([...detalleEnviosPS, ...detalleEnviosTall], "envíos PS+Tall", kgXUni);

    rows += `
      <tr>
        <td>${escapeHtml(sector)}</td>
        <td>${escapeHtml(descripcion)}</td>

        <td class="right"><b>${escapeHtml(Number(onlineKg).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }))}</b></td>
        <td class="right"><b>${escapeHtml(formatCajones(onlineCaj))}</b></td>
        <td class="right"><b>${escapeHtml(formatNumber(onlineUni))}</b></td>

        <td class="center">
          <div class="cell-combo">
            <span class="cell-total">${escapeHtml(formatNumber(Math.round(fabricacionNeta + aumentoTransfUni)))}</span>
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Fabricación - ${descripcion}`)}"
              data-popup-items="${escapeHtml(popupFabricacion)}"
            >+</button>
          </div>
        </td>

        <td class="center">
          <div class="cell-combo">
            <span class="cell-total">${escapeHtml(formatNumber(Math.round(enviosUniMostrado)))}</span>
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`${(hasTall && !hasPS) ? 'Envios Tall' : (hasPS && !hasTall) ? 'Envios PS' : 'Envios PS+Tall'} - ${descripcion}`)}"
              data-popup-items="${escapeHtml(popupEnvios)}"
            >+</button>
          </div>
        </td>

        <td class="right"><b>${escapeHtml(formatDecimal(stockInicial))}</b></td>
        <td class="right"><b>${escapeHtml(formatDecimal(kgXUni))}</b></td>
        <td class="right"><b>${escapeHtml(formatDecimal(kgXCajon))}</b></td>
        <td class="right"><b>${escapeHtml(nFleje || "")}</b></td>
        <td class="right"><b>${escapeHtml(formatCajones(maxCajCerv))}</b></td>
        <td class="mono">${piezaMadre ? escapeHtml(piezaMadre) : ""}</td>
      </tr>
    `;
  });

  resultEl.innerHTML = `
    <div class="articulo">
      <div class="articulo-header">SC Kg</div>
      <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th colspan="2">Base</th>
            <th colspan="3" class="right">Online</th>
            <th colspan="2" class="center">Movimientos</th>
            <th colspan="6" class="right">Info</th>
          </tr>
          <tr>
            <th>Sector</th>
            <th>Descripción</th>

            <th class="right">Kg</th>
            <th class="right">Caj</th>
            <th class="right">Uni</th>

            <th class="center">Fabricación</th>
            <th class="center">${escapeHtml(headerLabel)}</th>

            <th class="right">Stock Inicial</th>
            <th class="right">Kg x Uni</th>
            <th class="right">Kg x Cajon</th>
            <th class="right">N Fleje</th>
            <th class="right">Max Caj Cerv</th>
            <th class="right">Pieza Madre</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      </div>
    </div>

    <div id="popupOverlay" class="popup-overlay hidden">
      <div class="popup-box">
        <div class="popup-head">
          <div id="popupTitle" class="popup-title"></div>
          <button id="popupClose" type="button" class="popup-close">✕</button>
        </div>
        <div id="popupBody" class="popup-body"></div>
      </div>
    </div>

    <div id="historialOverlay" class="popup-overlay hidden">
      <div class="historial-modal">
        <div class="popup-head">
          <div id="historialTitle" class="popup-title"></div>
          <button id="historialClose" type="button" class="popup-close">✕</button>
        </div>
        <div id="historialBody" class="historial-body"></div>
      </div>
    </div>
  `;

  const popupOverlay = document.getElementById("popupOverlay");
  const popupTitle = document.getElementById("popupTitle");
  const popupBody = document.getElementById("popupBody");
  const popupClose = document.getElementById("popupClose");

  const historialOverlay = document.getElementById("historialOverlay");
  const historialTitle = document.getElementById("historialTitle");
  const historialBody = document.getElementById("historialBody");
  const historialClose = document.getElementById("historialClose");

  resultEl.querySelectorAll(".mini-popup-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const title = btn.dataset.popupTitle || "";
      const allItems = String(btn.dataset.popupItems || "").split("|").filter(x => x.trim());

      // Mostrar solo las 5 más recientes (ya están desc)
      const ultimasCinco = allItems.slice(0, 5);

      popupTitle.textContent = title;
      popupBody.innerHTML = ultimasCinco
        .map((x) => `<div class="popup-line">${escapeHtml(x)}</div>`)
        .join("");

      // Agregar botón "Ver Historial" si hay más de 5 items
      if (allItems.length > 5) {
        popupBody.innerHTML += `
          <div style="margin-top:12px; text-align:center;">
            <button id="btnVerHistorial" type="button" class="btn-ver-historial">Ver Historial</button>
          </div>
        `;

        document.getElementById("btnVerHistorial").addEventListener("click", () => {
          popupOverlay.classList.add("hidden");
          mostrarHistorialCompleto(title, allItems);
        });
      }

      popupOverlay.classList.remove("hidden");
    });
  });

  function mostrarHistorialCompleto(title, items) {
    historialTitle.textContent = title;
    historialBody.innerHTML = items
      .map((x) => `<div class="popup-line">${escapeHtml(x)}</div>`)
      .join("");
    historialOverlay.classList.remove("hidden");
  }

  popupClose.addEventListener("click", () => {
    popupOverlay.classList.add("hidden");
  });

  popupOverlay.addEventListener("click", (e) => {
    if (e.target === popupOverlay) {
      popupOverlay.classList.add("hidden");
    }
  });

  historialClose.addEventListener("click", () => {
    historialOverlay.classList.add("hidden");
  });

  historialOverlay.addEventListener("click", (e) => {
    if (e.target === historialOverlay) {
      historialOverlay.classList.add("hidden");
    }
  });
}

/* =========================================================
   BLOQUE: MAIN
========================================================= */
async function cargarTodo() {
  try {
    setStatus("Cargando datos...");
    resultEl.innerHTML = "";

    const [scRows, enviosPSRows, enviosTallRows, entregasTransfRows, dbEspejoRows, causaEfectoRows, partesPSRows] = await Promise.all([
      cargarBaseSCKg(),
      cargarEnviosPS(),
      cargarEnviosTalleristas(),
      cargarEntregasTransformacion(),
      cargarDBEspejo(),
      cargarCausaEfecto(),
      supabaseClient.from("Partes x PS").select('"PS", "SC"').then(r => r.data || []),
    ]);

    enviosPSDataG   = armarMapaEnviosPS(enviosPSRows);
    enviosTallDataG = armarMapaEnviosTall(enviosTallRows);
    aumentosTransfG = armarMapaAumentosTransformacion(entregasTransfRows);
    fabricacionMapG = armarMapaFabricacion(dbEspejoRows, causaEfectoRows);
    todosLosSC      = scRows;

    // Armar mapa ProvServ → Set de SC
    scPorProvServMap = new Map();
    const provServSet = new Set();
    for (const p of partesPSRows) {
      const ps = String(p["PS"] || "").trim();
      const sc = normalizeText(p["SC"]);
      if (!ps || !sc) continue;
      provServSet.add(ps);
      if (!scPorProvServMap.has(ps)) scPorProvServMap.set(ps, new Set());
      scPorProvServMap.get(ps).add(sc);
    }
    const provServOrdenados = [...provServSet].sort((a, b) => a.localeCompare(b, "es"));
    filtroProvServ.innerHTML = '<option value="">Todos los Prov Serv</option>' +
      provServOrdenados.map(p => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join("");

    filtrarYRender();

    const topFab = [...fabricacionMapG.entries()]
      .map(([k, v]) => ({ k, neta: v.aumenta - v.descuenta }))
      .filter((x) => x.neta !== 0)
      .sort((a, b) => Math.abs(b.neta) - Math.abs(a.neta))
      .slice(0, 5)
      .map((x) => `${x.k}:${formatNumber(x.neta)}`)
      .join(" | ");

    setStatus("");
  } catch (err) {
    console.error("ERROR GENERAL:", err);
    setStatus(err.message || "Error al cargar datos");
  }
}

/* =========================================================
   BLOQUE: FILTRO + RENDER
========================================================= */
function filtrarYRender() {
  const q = normalizeText(searchInput.value);
  const provServVal = filtroProvServ.value;
  const scDelProvServ = provServVal ? scPorProvServMap.get(provServVal) : null;

  const filas = todosLosSC.filter((r) => {
    const sector = normalizeText(r["SC"]);
    const desc   = normalizeText(r["Descripcion"]);
    if (q && !sector.includes(q) && !desc.includes(q)) return false;
    if (scDelProvServ && !scDelProvServ.has(sector)) return false;
    return true;
  });
  renderTabla(filas, enviosPSDataG, fabricacionMapG, enviosTallDataG, aumentosTransfG);
}

/* =========================================================
   BLOQUE: INICIO
========================================================= */
searchInput.addEventListener("input", filtrarYRender);
filtroProvServ.addEventListener("change", filtrarYRender);
document.addEventListener("DOMContentLoaded", cargarTodo);