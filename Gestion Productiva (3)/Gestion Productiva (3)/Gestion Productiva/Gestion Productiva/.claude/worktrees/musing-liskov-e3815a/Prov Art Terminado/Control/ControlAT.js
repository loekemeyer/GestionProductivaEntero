"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLA_ARTS   = "Articulos x Prov AT";
const TABLA_ENVIOS = "Envios Prov AT";
const TABLA_ENTREGAS = "Entregas Prov AT";

/* DOM */
const statusEl     = document.getElementById("status");
const provGridWrap = document.getElementById("provGridWrap");
const provGrid     = document.getElementById("provGrid");
const detailWrap   = document.getElementById("detailWrap");
const resultBody   = document.getElementById("resultBody");
const tableTitle   = document.getElementById("tableTitle");
const tableMsg     = document.getElementById("tableMsg");
const selectedBadge = document.getElementById("selectedBadge");
const btnVolver    = document.getElementById("btnVolver");

/* STATE */
let selectedProv = "";

/* HELPERS */
function setStatus(t, c = "") { statusEl.className = "status" + (c ? ` ${c}` : ""); statusEl.textContent = t; }
function escapeHtml(v) { return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

/* DATA */
async function getProveedores() {
  const { data, error } = await sb.from(TABLA_ARTS).select('"Proveedor"').eq("Activo", true);
  if (error) throw error;
  const set = new Set((data || []).map(r => (r.Proveedor || "").trim()).filter(Boolean));
  return [...set].sort();
}

async function getArticulosProv(prov) {
  const { data, error } = await sb.from(TABLA_ARTS).select("*").eq("Proveedor", prov).eq("Activo", true).order("Cod_Art");
  if (error) throw error;
  return data || [];
}

async function getEnviosProv(prov) {
  const { data, error } = await sb.from(TABLA_ENVIOS).select("*").eq("Proveedor", prov);
  if (error) throw error;
  return data || [];
}

async function getEntregasProv(prov) {
  const { data, error } = await sb.from(TABLA_ENTREGAS).select("*").eq("Proveedor", prov);
  if (error) throw error;
  return data || [];
}

/* UI */
function renderProvButtons(provs) {
  provGrid.innerHTML = "";
  provs.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ps-pill";
    btn.textContent = p;
    btn.addEventListener("click", () => seleccionarProv(p));
    provGrid.appendChild(btn);
  });
}

async function seleccionarProv(prov) {
  selectedProv = prov;
  setStatus("Cargando datos...");

  try {
    const [arts, envios, entregas] = await Promise.all([
      getArticulosProv(prov),
      getEnviosProv(prov),
      getEntregasProv(prov)
    ]);

    // Agrupar envíos por Cod_Art
    const envMap = new Map();
    envios.forEach(r => {
      const cod = (r.Cod_Art || "").trim();
      if (!envMap.has(cod)) envMap.set(cod, { carton: 0, cajas: 0 });
      const e = envMap.get(cod);
      e.carton += Number(r.Carton || 0);
      e.cajas  += Number(r.Cajas || 0);
    });

    // Agrupar entregas por Cod_Art
    const entMap = new Map();
    entregas.forEach(r => {
      const cod = (r.Cod_Art || "").trim();
      entMap.set(cod, (entMap.get(cod) || 0) + Number(r.Cantidad || 0));
    });

    // Render
    let html = "";
    arts.forEach(a => {
      const cod = (a.Cod_Art || "").trim();
      const env = envMap.get(cod) || { carton: 0, cajas: 0 };
      const entCant = entMap.get(cod) || 0;

      // Saldo = enviado - recibido (lo que queda en el proveedor)
      const saldoCarton = env.carton - entCant;
      const saldoCajas  = env.cajas - entCant;

      const clsCarton = saldoCarton > 0 ? "saldo-pos" : saldoCarton < 0 ? "saldo-neg" : "";
      const clsCajas  = saldoCajas > 0 ? "saldo-pos" : saldoCajas < 0 ? "saldo-neg" : "";

      html += `<tr>
        <td>${escapeHtml(cod)}</td>
        <td>${escapeHtml(a.Descripcion)}</td>
        <td>${env.carton}</td>
        <td>${env.cajas}</td>
        <td>${entCant}</td>
        <td class="${clsCarton}">${saldoCarton}</td>
        <td class="${clsCajas}">${saldoCajas}</td>
      </tr>`;
    });

    if (!html) html = `<tr><td colspan="7" style="text-align:center;color:#999">Sin artículos asignados</td></tr>`;

    resultBody.innerHTML = html;
    tableTitle.textContent = prov;
    selectedBadge.textContent = prov;

    provGridWrap.classList.add("hidden");
    detailWrap.classList.remove("hidden");
    setStatus(`${arts.length} artículos cargados`, "ok");
  } catch (e) {
    console.error(e);
    setStatus("Error cargando datos: " + e.message, "bad");
  }
}

function resetAll() {
  selectedProv = "";
  resultBody.innerHTML = "";
  detailWrap.classList.add("hidden");
  provGridWrap.classList.remove("hidden");
  setStatus("Seleccioná un proveedor.", "bad");
}

/* EVENTS */
btnVolver.addEventListener("click", resetAll);

/* INIT */
async function init() {
  try {
    const provs = await getProveedores();
    renderProvButtons(provs);
    provGridWrap.classList.remove("hidden");
    setStatus(provs.length ? "Seleccioná un proveedor." : "No hay proveedores cargados.", provs.length ? "bad" : "bad");
  } catch (e) {
    console.error(e);
    setStatus("Error cargando proveedores.", "bad");
  }
}

init();
