"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLA_ARTS     = "Articulos x Prov AT";
const TABLA_ENTREGAS = "Entregas Prov AT";

/* DOM */
const statusEl      = document.getElementById("status");
const provGridWrap  = document.getElementById("provGridWrap");
const provGrid      = document.getElementById("provGrid");
const selectedBar   = document.getElementById("selectedBar");
const selectedBadge = document.getElementById("selectedBadge");
const btnVolver     = document.getElementById("btnVolver");
const btnEnviar     = document.getElementById("btnEnviar");
const detailWrap    = document.getElementById("detailWrap");
const resultBody    = document.getElementById("resultBody");
const tableTitle    = document.getElementById("tableTitle");
const tableMsg      = document.getElementById("tableMsg");
const successBox    = document.getElementById("successBox");
const successCodeEl = document.getElementById("successCode");
const okBtn         = document.getElementById("okBtn");

/* STATE */
let selectedProv = "";
let fetchedArts  = [];
let isSubmitting = false;

/* HELPERS */
function setStatus(t, c = "") { statusEl.className = "status" + (c ? ` ${c}` : ""); statusEl.textContent = t; }
function setTableMsg(t, c = "") { tableMsg.className = "status" + (c ? ` ${c}` : ""); tableMsg.textContent = t; }
function escapeHtml(v) { return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

function arDateISO() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function genCode(len = 4) {
  const min = Math.pow(10, len - 1);
  const max = Math.pow(10, len) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

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

/* UI */
function renderProvButtons(provs) {
  provGrid.innerHTML = "";
  provs.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ps-pill";
    btn.textContent = p;
    btn.addEventListener("click", () => { if (!isSubmitting) seleccionarProv(p); });
    provGrid.appendChild(btn);
  });
}

function renderTable(arts) {
  resultBody.innerHTML = "";

  if (!arts.length) {
    resultBody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:#b42318;font-weight:700;">Sin artículos.</td></tr>`;
    return;
  }

  const rows = arts.map((a, i) => `
    <tr data-idx="${i}">
      <td>${escapeHtml(a.Cod_Art)}</td>
      <td>${escapeHtml(a.Descripcion)}</td>
      <td><input class="input-qty" type="text" inputmode="numeric" placeholder="0" data-role="cantidad" data-idx="${i}" /></td>
    </tr>
  `).join("");

  resultBody.innerHTML = rows;

  resultBody.querySelectorAll(".input-qty").forEach(input => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "");
      updateEnviarState();
    });
  });
}

function showSelectionView() {
  provGridWrap.classList.remove("hidden");
  detailWrap.classList.add("hidden");
  selectedBar.classList.add("hidden");
  btnEnviar.classList.add("hidden");
}

function showDetailView() {
  provGridWrap.classList.add("hidden");
  detailWrap.classList.remove("hidden");
  selectedBar.classList.remove("hidden");
  btnEnviar.classList.remove("hidden");
}

function updateEnviarState() {
  const items = getItemsFromTable();
  const hasData = items.some(it => it.cantidad > 0);
  btnEnviar.classList.toggle("enabled", !isSubmitting && hasData);
}

function resetAll() {
  selectedProv = "";
  fetchedArts = [];
  isSubmitting = false;
  selectedBadge.textContent = "";
  tableTitle.textContent = "Proveedor";
  resultBody.innerHTML = "";
  setTableMsg("");
  successBox.style.display = "none";
  showSelectionView();
  setStatus("Seleccioná un proveedor.", "bad");
  updateEnviarState();
  provGrid.querySelectorAll(".ps-pill").forEach(b => b.classList.remove("active"));
}

async function seleccionarProv(prov) {
  selectedProv = prov;
  setStatus("Cargando artículos...");

  try {
    fetchedArts = await getArticulosProv(prov);
    selectedBadge.textContent = prov;
    tableTitle.textContent = prov;
    renderTable(fetchedArts);
    showDetailView();

    provGrid.querySelectorAll(".ps-pill").forEach(b => b.classList.toggle("active", b.textContent.trim() === prov));

    if (fetchedArts.length) {
      setStatus("Proveedor cargado.", "ok");
      setTableMsg("Ingresá la cantidad de art. terminados recibidos.");
    } else {
      setStatus("Sin artículos para este proveedor.", "bad");
    }
    updateEnviarState();
  } catch (e) {
    console.error(e);
    setStatus("Error cargando artículos.", "bad");
  }
}

/* TABLE DATA */
function getItemsFromTable() {
  return fetchedArts.map((a, i) => {
    const input = resultBody.querySelector(`input[data-role="cantidad"][data-idx="${i}"]`);
    return {
      cod: a.Cod_Art || "",
      desc: a.Descripcion || "",
      cantidad: parseInt(input?.value || "0") || 0
    };
  });
}

/* EVENTS */
btnVolver.addEventListener("click", () => { if (!isSubmitting) resetAll(); });
okBtn.addEventListener("click", resetAll);

btnEnviar.addEventListener("click", async () => {
  if (isSubmitting || !selectedProv) return;

  const items = getItemsFromTable().filter(it => it.cantidad > 0);

  if (!items.length) {
    setTableMsg("Completá al menos un artículo.", "bad");
    return;
  }

  const detalle = items.map(it => `${it.cod} - ${it.desc} → Cajas: ${it.cantidad}`).join("\n");
  if (!confirm(`¿Confirmar entrega?\n\n${detalle}`)) return;

  const payload = items.map(it => ({
    "Dia_mes": arDateISO(),
    "Proveedor": selectedProv,
    "Cod_Art": it.cod,
    "Descripcion": it.desc,
    "Cantidad": it.cantidad
  }));

  try {
    isSubmitting = true;
    btnEnviar.disabled = true;
    btnEnviar.classList.remove("enabled");
    setStatus("Guardando...");

    const codigo = genCode(4);
    const { error } = await sb.from(TABLA_ENTREGAS).insert(payload);
    if (error) throw error;

    isSubmitting = false;
    btnEnviar.disabled = false;
    setStatus("Entrega registrada.", "ok");

    successCodeEl.textContent = codigo;
    successBox.style.display = "block";

    imprimirComprobante({ codigo, proveedor: selectedProv, fecha: arDateISO(), items });

    setTimeout(resetAll, 500);
  } catch (e) {
    isSubmitting = false;
    btnEnviar.disabled = false;
    updateEnviarState();
    console.error(e);
    setTableMsg("Error registrando: " + (e?.message || e), "bad");
  }
});

/* PRINT */
function imprimirComprobante({ codigo, proveedor, fecha, items }) {
  const rows = items.map(it => `
    <tr>
      <td>${escapeHtml(it.cod)}</td>
      <td>${escapeHtml(it.desc)}</td>
      <td style="text-align:right">${it.cantidad}</td>
    </tr>
  `).join("");

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8" /><title>Comprobante ${codigo}</title>
    <style>body{font-family:Arial,sans-serif;margin:30px;color:#111}h1{font-size:22px;margin:0 0 8px}
    .meta{margin-bottom:18px;line-height:1.6;font-size:14px}table{width:100%;border-collapse:collapse;font-size:13px}
    th,td{border:1px solid #999;padding:8px}th{background:#f1f1f1;text-align:left}.foot{margin-top:20px;font-size:12px;color:#444}
    @media print{body{margin:15px}}</style></head><body>
    <h1>Comprobante de Entrega - Art. Terminado</h1>
    <div style="font-size:18px;margin-bottom:10px"><strong>Código:</strong> ${escapeHtml(codigo)}</div>
    <div class="meta"><div><strong>Fecha:</strong> ${escapeHtml(fecha)}</div><div><strong>Proveedor:</strong> ${escapeHtml(proveedor)}</div></div>
    <table><thead><tr><th>Cod</th><th>Artículo</th><th>Cajas</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="foot">Comprobante generado automáticamente.</div>
    <script>window.onload=function(){window.print()}<\/script></body></html>`;

  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) { alert("Ventana bloqueada por el navegador."); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/* INIT */
async function init() {
  try {
    const provs = await getProveedores();
    renderProvButtons(provs);
    provGridWrap.classList.remove("hidden");
    setStatus(provs.length ? "Seleccioná un proveedor." : "No hay proveedores.", provs.length ? "bad" : "bad");
  } catch (e) {
    console.error(e);
    setStatus("Error cargando proveedores.", "bad");
  }
}

showSelectionView();
init();
