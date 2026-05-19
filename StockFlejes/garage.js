"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusEl = document.getElementById("status");
const tblBody = document.getElementById("tblBody");
const txtBuscar = document.getElementById("txtBuscar");
const selStock = document.getElementById("selStock");

let garageData = [];
let componentesPorGRJ = new Map(); // cod_grj → ["A10","C10","V9"]
let entregasPorGRJ = new Map();    // cod_grj → { uni, detalle }
let enviosPorGRJ = new Map();      // cod_grj → { uni, kg, detalle }
let rowsProcessed = [];

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function n(v) { return isNaN(v) ? 0 : Number(v); }
function normalizeText(s) { return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim(); }
function fmtN(v) { return Number(v).toLocaleString("es-AR"); }

async function fetchAll(tabla) {
  const all = []; const PAGE = 1000; let from = 0;
  while (true) {
    const { data, error } = await sb.from(tabla).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(tabla + ": " + error.message);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/* ================= INIT ================= */
async function init() {
  statusEl.textContent = "Cargando datos...";
  try {
    const [garageRes, compRes, entregasVirg, enviosTall] = await Promise.all([
      sb.from("Garage").select("*").order("Cod_GRJ"),
      sb.from("GRJ_Componentes").select("cod_grj, componente, orden").order("cod_grj").order("orden"),
      fetchAll("Entregas Tallerista Virgilio"),
      fetchAll("Envios a Talleristas")
    ]);
    if (garageRes.error) throw garageRes.error;
    if (compRes.error) throw compRes.error;
    garageData = garageRes.data || [];

    const grjsValidos = new Set(garageData.map(g => g["Cod_GRJ"]));

    // Componentes por GRJ (orden ascendente)
    componentesPorGRJ = new Map();
    (compRes.data || []).forEach(c => {
      const cg = String(c.cod_grj || "").trim();
      if (!grjsValidos.has(cg)) return;
      if (!componentesPorGRJ.has(cg)) componentesPorGRJ.set(cg, []);
      componentesPorGRJ.get(cg).push({ comp: c.componente, orden: c.orden || 0 });
    });

    // Entregas: cuando Carlos/Martin entregan GRJ armado, se inserta 1 row por componente
    // con mismo "Cajas" (= unidades de GRJ). Para no duplicar al sumar, tomar SOLO el componente
    // con orden=1 (el "marcador" canonico de cada entrega).
    const markerByGRJ = new Map();
    componentesPorGRJ.forEach((comps, cg) => {
      const marker = comps.find(c => c.orden === 1) || comps[0];
      if (marker) markerByGRJ.set(cg, marker.comp);
    });

    entregasPorGRJ = new Map();
    for (const e of entregasVirg) {
      const cg = String(e["Cod_GRJ"] || "").trim();
      const cod = String(e["Cod"] || "").trim();
      if (!grjsValidos.has(cg)) continue;
      // Solo contar el componente marker para evitar duplicacion
      if (cod !== markerByGRJ.get(cg)) continue;
      if (!entregasPorGRJ.has(cg)) entregasPorGRJ.set(cg, { uni: 0, kg: 0, detalle: [] });
      const m = entregasPorGRJ.get(cg);
      m.uni += n(e["Cajas"]);
      m.kg += n(e["Kg_GRJ"]);
      m.detalle.push({ tall: e["Nombre_Tall"], fecha: e["Fecha"], uni: n(e["Cajas"]), kg: n(e["Kg_GRJ"]) });
    }

    // Envios: Sector matches Cod_GRJ
    enviosPorGRJ = new Map();
    for (const e of enviosTall) {
      const sec = String(e["Sector"] || "").trim();
      if (!grjsValidos.has(sec)) continue;
      if (!enviosPorGRJ.has(sec)) enviosPorGRJ.set(sec, { uni: 0, kg: 0, detalle: [] });
      const m = enviosPorGRJ.get(sec);
      m.uni += n(e["Unidades"]);
      m.kg += n(e["KG"]);
      m.detalle.push({ tall: e["Tallerista"], fecha: e["Dia-mes"], uni: n(e["Unidades"]), kg: n(e["KG"]), cajones: n(e["Cajones"]) });
    }

    procesarRows();
    aplicarFiltros();
    statusEl.textContent = `${rowsProcessed.length} GRJs cargados`;
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    console.error(err);
  }
}

/* ================= PROCESAR ================= */
function procesarRows() {
  rowsProcessed = garageData.map(g => {
    const cg = g["Cod_GRJ"];
    const comps = (componentesPorGRJ.get(cg) || []).map(c => c.comp).join(" + ");
    const ent = entregasPorGRJ.get(cg) || { uni: 0, detalle: [] };
    const env = enviosPorGRJ.get(cg) || { uni: 0, detalle: [] };
    const stockInicial = n(g["Stock_Inicial"]);
    const stockOnline = stockInicial + ent.uni - env.uni;
    return {
      codGRJ: cg,
      desc: g["Descripcion"] || "",
      componentes: comps,
      stockInicial,
      entUni: ent.uni,
      envUni: env.uni,
      stockOnline,
      entDetalle: ent.detalle,
      envDetalle: env.detalle
    };
  });
}

/* ================= FILTROS ================= */
function aplicarFiltros() {
  const q = normalizeText(txtBuscar.value);
  const stockFiltro = selStock.value;
  const filtradas = rowsProcessed.filter(r => {
    if (q) {
      const m = normalizeText(r.desc).includes(q) || normalizeText(r.codGRJ).includes(q) || normalizeText(r.componentes).includes(q);
      if (!m) return false;
    }
    if (stockFiltro === "conStock" && r.stockOnline <= 0) return false;
    if (stockFiltro === "sinStock" && r.stockOnline > 0) return false;
    return true;
  });
  renderTabla(filtradas);
}

txtBuscar.addEventListener("input", aplicarFiltros);
selStock.addEventListener("change", aplicarFiltros);

/* ================= RENDER ================= */
function renderTabla(rows) {
  window._lastRows = rows;
  let html = "";
  rows.forEach((r, i) => {
    html += `<tr>
      <td class="col-sector">${esc(r.codGRJ)}</td>
      <td class="col-desc" title="${esc(r.desc)}">${esc(r.desc)}</td>
      <td class="td-comp" title="${esc(r.componentes)}">${esc(r.componentes)}</td>
      <td class="col-number">${fmtN(r.stockInicial)}</td>
      <td class="col-number col-clickable" onclick="popupEntregas(${i})">${fmtN(r.entUni)}</td>
      <td class="col-number col-clickable" onclick="popupEnvios(${i})">${fmtN(r.envUni)}</td>
      <td class="col-number col-clickable" onclick="popupStockOnline(${i})">${fmtN(r.stockOnline)}</td>
    </tr>`;
  });
  tblBody.innerHTML = html || `<tr><td colspan="7" class="empty">No hay GRJs</td></tr>`;
}

/* ================= POPUPS ================= */
const popupEl = document.getElementById("popupDetalle");
const popupTitulo = document.getElementById("popupTitulo");
const popupBody = document.getElementById("popupBody");
document.getElementById("popupCerrar").onclick = () => popupEl.classList.add("hidden");
popupEl.addEventListener("click", e => { if (e.target === popupEl) popupEl.classList.add("hidden"); });

function abrirPopup(titulo, html) {
  popupTitulo.textContent = titulo;
  popupBody.innerHTML = html;
  popupEl.classList.remove("hidden");
}

function buildDet(detalle) {
  if (!detalle || !detalle.length) return '<div style="font-size:11px;color:#999;padding:4px 0">Sin movimientos</div>';
  let h = '<table style="width:100%;font-size:12px;margin:2px 0">';
  [...detalle].reverse().forEach(d => {
    const valor = `${fmtN(d.uni || 0)} uni${d.kg ? ` / ${fmtN(d.kg)} kg` : ""}`;
    h += `<tr><td style="color:#666;padding:2px 4px">${esc(d.tall || "")}</td><td style="padding:2px 4px">${esc(d.fecha || "")}</td><td style="text-align:right;padding:2px 4px">${valor}</td></tr>`;
  });
  h += '</table>';
  return h;
}

function popupEntregas(i) {
  const r = window._lastRows[i]; if (!r) return;
  abrirPopup(`Entregas — ${r.desc} (${r.codGRJ})`, buildDet(r.entDetalle));
}
function popupEnvios(i) {
  const r = window._lastRows[i]; if (!r) return;
  abrirPopup(`Envios a Talleristas — ${r.desc} (${r.codGRJ})`, buildDet(r.envDetalle));
}
function popupStockOnline(i) {
  const r = window._lastRows[i]; if (!r) return;
  let html = '<table style="width:100%">';
  html += `<tr><td>Stock Inicial</td><td style="text-align:right;font-weight:600">${fmtN(r.stockInicial)}</td></tr>`;
  html += `<tr><td>+ Entregas (armado)</td><td style="text-align:right;font-weight:600">${fmtN(r.entUni)}</td></tr>`;
  html += `<tr><td>− Envíos a Talleristas</td><td style="text-align:right;font-weight:600">${fmtN(r.envUni)}</td></tr>`;
  html += `<tr style="border-top:2px solid #333"><td><b>= Stock Online</b></td><td style="text-align:right"><b>${fmtN(r.stockOnline)}</b></td></tr>`;
  html += '</table>';
  abrirPopup(`Stock Online — ${r.desc} (${r.codGRJ})`, html);
}

init();
