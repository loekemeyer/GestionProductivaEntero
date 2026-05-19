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

async function cargarEnviosPS() {
  const { data, error } = await supabaseClient
    .from("Envios a PS")
    .select(`
      "Dia-mes",
      "Sector SC",
      "Cajones",
      "KG",
      "Prov_Serv"
    `)
    .limit(20000);

  if (error) {
    console.error("ERROR Envios a PS:", error);
    throw new Error(error.message || "Error al leer Envios a PS");
  }

  return data || [];
}

async function cargarDBEspejo() {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseClient
      .from("db_n8n_espejo")
      .select("*")
      .neq("Legajo", "1")
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
    arr.sort((a, b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));
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

  // Acumular producción por Matriz + Fecha (Mes-Dia)
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
    const key = `${matriz}|||${fecha}`;
    if (!prodPorMatrizFecha.has(key)) {
      prodPorMatrizFecha.set(key, { matriz, fecha, uni: 0 });
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

  for (const [, { matriz, fecha, uni: uniTotal }] of prodPorMatrizFecha.entries()) {
    const efectos = causaMap.get(matriz) || [];
    efectos.forEach((ef) => {
      if (ef.aumenta) {
        const e = ensure(ef.aumenta);
        e.aumenta += uniTotal;
        e.detalleAumenta.push({ matriz, fecha, desc: ef.desc, uni: uniTotal });
      }
      if (ef.descuenta) {
        const e = ensure(ef.descuenta);
        e.descuenta += uniTotal;
        e.detalleDescuenta.push({ matriz, fecha, desc: ef.desc, uni: uniTotal });
      }
    });
  }

  return sectorMap;
}

/* =========================================================
   BLOQUE: POPUP
========================================================= */
function detalleToPopup(detalle, etiqueta, kgXUni) {
  if (!detalle.length) return `Sin ${etiqueta}`;

  return detalle
    .map((x) => {
      const uni = (kgXUni > 0 && x.kg) ? Math.round(x.kg / kgXUni) : 0;
      const kgTxt = x.kg ? ` - ${formatDecimal(x.kg)} kg` : "";
      const cajTxt = x.cajones ? ` - ${formatCajones(x.cajones)} caj` : "";
      const destTxt = x.provServ ? ` → ${x.provServ}` : "";
      return `${x.fecha || "Sin fecha"}${kgTxt}${cajTxt} - ${formatNumber(uni)} uni${destTxt}`;
    })
    .join("|");
}

/* =========================================================
   BLOQUE: RENDER
========================================================= */
function renderTabla(scRows, enviosPSData, fabricacionMap) {
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
    fabData.detalleAumenta.forEach((d) =>
      popupLineas.push(`▲ ${d.fecha ? d.fecha + " - " : ""}Mtz ${d.matriz} - ${d.desc}: +${formatNumber(Math.round(d.uni))} uni`)
    );
    fabData.detalleDescuenta.forEach((d) =>
      popupLineas.push(`▼ ${d.fecha ? d.fecha + " - " : ""}Mtz ${d.matriz} - ${d.desc}: -${formatNumber(Math.round(d.uni))} uni`)
    );
    const popupFabricacion = popupLineas.length ? popupLineas.join("|") : "Sin fabricación";

    /* =========================================================
       BLOQUE: ENVIOS PS
       Busca por sector SC — acumula KG, convierte a uni
    ========================================================= */
    const enviosPSKg = Number(enviosPSData.totalMap.get(key) || 0);
    const enviosPSUni = kgXUni > 0 ? enviosPSKg / kgXUni : 0;

    /* =========================================================
       BLOQUE: FORMULA ONLINE UNI
       Uni = Stock Inicial + FabricaciónNeta - Envios PS (uni)
    ========================================================= */
    const onlineUni = stockInicial + fabricacionNeta - enviosPSUni;

    /* =========================================================
       BLOQUE: DERIVADOS VISUALES
    ========================================================= */
    const onlineKg = onlineUni * kgXUni;
    const onlineCaj = kgXCajon > 0 ? onlineKg / kgXCajon : 0;

    const detalleEnviosPS = enviosPSData.detalleMap.get(key) || [];
    const popupEnviosPS = detalleToPopup(detalleEnviosPS, "envíos PS", kgXUni);

    rows += `
      <tr>
        <td>${escapeHtml(sector)}</td>
        <td>${escapeHtml(descripcion)}</td>

        <td class="right"><b>${escapeHtml(Number(onlineKg).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }))}</b></td>
        <td class="right"><b>${escapeHtml(formatCajones(onlineCaj))}</b></td>
        <td class="right"><b>${escapeHtml(formatNumber(onlineUni))}</b></td>

        <td class="center">
          <div class="cell-combo">
            <span class="cell-total">${escapeHtml(formatNumber(Math.round(fabricacionNeta)))}</span>
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
            <span class="cell-total">${escapeHtml(formatNumber(Math.round(enviosPSUni)))}</span>
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Envios PS - ${descripcion}`)}"
              data-popup-items="${escapeHtml(popupEnviosPS)}"
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
            <th class="center">Envios PS</th>

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
  `;

  const popupOverlay = document.getElementById("popupOverlay");
  const popupTitle = document.getElementById("popupTitle");
  const popupBody = document.getElementById("popupBody");
  const popupClose = document.getElementById("popupClose");

  resultEl.querySelectorAll(".mini-popup-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const title = btn.dataset.popupTitle || "";
      const items = String(btn.dataset.popupItems || "").split("|");

      popupTitle.textContent = title;
      popupBody.innerHTML = items
        .map((x) => `<div class="popup-line">${escapeHtml(x)}</div>`)
        .join("");

      popupOverlay.classList.remove("hidden");
    });
  });

  popupClose.addEventListener("click", () => {
    popupOverlay.classList.add("hidden");
  });

  popupOverlay.addEventListener("click", (e) => {
    if (e.target === popupOverlay) {
      popupOverlay.classList.add("hidden");
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

    const [scRows, enviosPSRows, dbEspejoRows, causaEfectoRows, partesPSRows] = await Promise.all([
      cargarBaseSCKg(),
      cargarEnviosPS(),
      cargarDBEspejo(),
      cargarCausaEfecto(),
      supabaseClient.from("Partes x PS").select('"PS", "SC"').then(r => r.data || []),
    ]);

    enviosPSDataG   = armarMapaEnviosPS(enviosPSRows);
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
  renderTabla(filas, enviosPSDataG, fabricacionMapG);
}

/* =========================================================
   BLOQUE: INICIO
========================================================= */
searchInput.addEventListener("input", filtrarYRender);
filtroProvServ.addEventListener("change", filtrarYRender);
document.addEventListener("DOMContentLoaded", cargarTodo);