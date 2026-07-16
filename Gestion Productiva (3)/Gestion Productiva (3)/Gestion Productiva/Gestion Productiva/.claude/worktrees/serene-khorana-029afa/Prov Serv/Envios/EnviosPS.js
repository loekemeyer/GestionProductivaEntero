"use strict";

/***********************
 * CONFIG
 ***********************/
const SUCURSAL = "Cerv";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const TABLA_DESTINO = "Envios a PS";
const TABLA_SP_KG = "SP Kg";
const TABLA_ENTREGAS = "Entregas PS";
const SUPABASE_TABLE = "Partes x PS";
const COL_PS = "PS";
const COL_PROCESO = "Proceso";
const COL_PARTE = "Parte";
const COL_SC = "SC";
const COL_SP = "SP";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/***********************
 * DOM
 ***********************/
const statusEl = document.getElementById("status");
const psGridWrap = document.getElementById("psGridWrap");
const psGrid = document.getElementById("psGrid");

const selectedBar = document.getElementById("selectedBar");
const selectedBadge = document.getElementById("selectedBadge");
const btnVolver = document.getElementById("btnVolver");
const btnSiguiente = document.getElementById("btnSiguiente");
const btnEnviar = document.getElementById("btnEnviar");

const fase1 = document.getElementById("fase1");
const fase2 = document.getElementById("fase2");
const fase3 = document.getElementById("fase3");
const btnVolverFase1 = document.getElementById("btnVolverFase1");
const previewBody = document.getElementById("previewBody");
const previewTitle = document.getElementById("previewTitle");
const previewTotalKg = document.getElementById("previewTotalKg");
const previewTotalCaj = document.getElementById("previewTotalCaj");

const resultBody = document.getElementById("resultBody");
const tableTitle = document.getElementById("tableTitle");
const tableMsg = document.getElementById("tableMsg");

const successCodeEl = document.getElementById("successCode");
const okBtn = document.getElementById("okBtn");
const btnVolverPS = document.getElementById("btnVolverPS");

/***********************
 * STATE
 ***********************/
let availablePS = [];
let selectedPS = "";
let fetchedItems = [];
let isSubmitting = false;
let lastSendCode = null;
let lastSendData = null;
let currentPhase = 0;
let itemsToSend = [];

/***********************
 * HELPERS
 ***********************/
function uniqueSorted(arr) {
  return [...new Set(arr.map(v => String(v || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function genNumericCode(len = 4) {
  const min = Math.pow(10, len - 1);
  const max = Math.pow(10, len) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

function setStatus(text, type = "") {
  statusEl.className = "status" + (type ? ` ${type}` : "");
  statusEl.textContent = text;
}

function setTableMsg(text, type = "") {
  tableMsg.className = "status" + (type ? ` ${type}` : "");
  tableMsg.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pick(o, keys) {
  for (const k of keys) {
    if (o && k in o) return o[k];
  }
  return "";
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
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  let s = String(value).trim();
  if (!s || s === "-" || s === "\u2014") return 0;
  s = s.replace(/[^\d,.-]/g, "");
  if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function parseInputNumber(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function getDiaMesHoy() {
  const hoy = new Date();
  const dia = String(hoy.getDate()).padStart(2, "0");
  const mes = String(hoy.getMonth() + 1).padStart(2, "0");
  return `${dia}/${mes}`;
}

/***********************
 * DATA - SP Kg (cached)
 ***********************/
let spKgCache = null;
async function getSpKgMap() {
  if (spKgCache) return spKgCache;

  const { data, error } = await sb
    .from(TABLA_SP_KG)
    .select("*");

  if (error) throw error;

  const map = new Map();
  (data || []).forEach(r => {
    const key = String(r.Sp || r.SP || "").trim().toLowerCase();
    if (!key) return;
    map.set(key, {
      kgUni: parseDecimal(pick(r, ["Kg x UNI", "Kg x Uni", "kg x uni", "Kg x UN", "Kg Uni"])),
      kgCaj: parseDecimal(pick(r, ["KG Cajon", "KG x Cajon", "kg cajon", "kg x cajon"])),
      maxCajonSPTotal: parseDecimal(pick(r, ["Max Cajon SP Total", "MaxCajonSPTotal", "Max Cajon", "Max Caj"]))
    });
  });

  spKgCache = map;
  return map;
}

/***********************
 * DATA - Envios/Entregas (filtered by PS)
 ***********************/
async function getTotalesEnviosMap(ps) {
  const { data, error } = await sb
    .from(TABLA_DESTINO)
    .select("*")
    .eq("Prov_Serv", ps);

  if (error) throw error;

  const map = new Map();
  (data || []).forEach(r => {
    const provServ = normalizeText(pick(r, ["Prov_Serv", "Prov Serv", "prov_serv"]));
    const sectorSP = normalizeText(pick(r, ["Sector SP", "Sector_SP", "sector sp", "sector_sp"]));
    const kg = parseDecimal(pick(r, ["KG", "Kg", "kg"]));
    if (!provServ || !sectorSP) return;
    const key = `${provServ}__${sectorSP}`;
    map.set(key, (map.get(key) || 0) + kg);
  });

  return map;
}

async function getTotalesEntregasMap(ps) {
  const { data, error } = await sb
    .from(TABLA_ENTREGAS)
    .select("*")
    .eq("Prov_Serv", ps);

  if (error) throw error;

  const map = new Map();
  (data || []).forEach(r => {
    const provServ = normalizeText(pick(r, ["Prov_Serv", "Prov Serv", "prov_serv"]));
    const sectorSP = normalizeText(pick(r, ["Sector SP", "Sector_SP", "sector sp", "sector_sp"]));
    const kg = parseDecimal(pick(r, ["KG", "Kg", "kg"]));
    if (!provServ || !sectorSP) return;
    const key = `${provServ}__${sectorSP}`;
    map.set(key, (map.get(key) || 0) + kg);
  });

  return map;
}

function calcularCajonesAEnviar(ps, sp, spKgMap, enviosMap, entregasMap) {
  const spKey = String(sp || "").trim().toLowerCase();
  const info = spKgMap.get(spKey) || { kgCaj: 0, maxCajonSPTotal: 0 };
  const kgCaj = Number(info.kgCaj || 0);
  const maxCajonSPTotal = Number(info.maxCajonSPTotal || 0);
  if (kgCaj <= 0 || maxCajonSPTotal <= 0) return 0;
  const movKey = `${normalizeText(ps)}__${normalizeText(sp)}`;
  const enviosKg = Number(enviosMap.get(movKey) || 0);
  const entregasKg = Number(entregasMap.get(movKey) || 0);
  const onlineKg = enviosKg - entregasKg;
  const objetivoKg = maxCajonSPTotal * kgCaj;
  const faltanteKg = objetivoKg - onlineKg;
  return Math.max(0, Math.ceil(faltanteKg / kgCaj));
}

/***********************
 * DATA - Partes x PS
 ***********************/
async function getPSDisponibles() {
  const { data, error } = await sb.from(SUPABASE_TABLE).select(COL_PS);
  if (error) throw error;
  return uniqueSorted((data || []).map(r => r[COL_PS]));
}

async function getItemsPorPS(ps) {
  const { data, error } = await sb
    .from(SUPABASE_TABLE)
    .select(`${COL_PS}, ${COL_PROCESO}, ${COL_PARTE}, ${COL_SC}, ${COL_SP}`)
    .eq(COL_PS, ps)
    .order(COL_PROCESO, { ascending: true })
    .order(COL_PARTE, { ascending: true });

  if (error) throw error;

  const uniques = [];
  const seen = new Set();

  (data || []).forEach(r => {
    const parte = String(r[COL_PARTE] || "").trim();
    const proceso = String(r[COL_PROCESO] || "").trim();
    const psVal = String(r[COL_PS] || "").trim();
    const sc = String(r[COL_SC] || "").trim();
    const sp = String(r[COL_SP] || "").trim();
    if (!parte) return;
    const key = [parte, proceso, sc, sp].join("||");
    if (seen.has(key)) return;
    seen.add(key);
    uniques.push({ ps: psVal, proceso, parte, sc, sp });
  });

  return uniques;
}

/***********************
 * FASES
 ***********************/
function mostrarFase(n) {
  currentPhase = n;
  psGridWrap.classList.toggle("hidden", n !== 0);
  fase1.classList.toggle("hidden", n !== 1);
  fase2.classList.toggle("hidden", n !== 2);
  fase3.classList.toggle("hidden", n !== 3);

  selectedBar.classList.toggle("hidden", n === 0 || n === 3);
  btnSiguiente.classList.toggle("hidden", n !== 1);
  btnEnviar.classList.toggle("hidden", n !== 2);

  if (n === 1) updateSiguienteState();
  if (n === 2) btnEnviar.classList.add("enabled");
}

function updateSiguienteState() {
  const items = getItemsFromTable();
  const filtered = filterItemsToSend(items);
  const enabled = !isSubmitting && selectedPS && filtered.length > 0;
  btnSiguiente.classList.toggle("enabled", enabled);
}

/***********************
 * UI
 ***********************/
function renderPSButtons(values) {
  psGrid.innerHTML = "";
  values.forEach(ps => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ps-pill";
    btn.textContent = ps;
    btn.addEventListener("click", async () => {
      if (isSubmitting) return;
      await seleccionarPS(ps);
    });
    psGrid.appendChild(btn);
  });
}

function renderTable(items) {
  resultBody.innerHTML = "";

  if (!items.length) {
    resultBody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align:center;color:#b42318;font-weight:700;">
          No hay partes para este proveedor.
        </td>
      </tr>
    `;
    return;
  }

  const rows = items.map((item, i) => {
    return `
      <tr data-idx="${i}">
        <td>${escapeHtml(item.parte)}</td>
        <td>${escapeHtml(item.proceso)}</td>
        <td>${escapeHtml(item.sc)}</td>
        <td>${Number(item.cajonesAEnviar || 0)}</td>
        <td>
          <input class="input-kg" type="text" inputmode="decimal" placeholder="0,0" data-role="kg" data-idx="${i}" />
        </td>
        <td>
          <input class="input-caj" type="text" inputmode="numeric" placeholder="0" data-role="cajones" data-idx="${i}" />
        </td>
      </tr>
    `;
  }).join("");

  resultBody.innerHTML = rows;

  resultBody.querySelectorAll('input[data-role="cajones"]').forEach(input => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "");
      updateSiguienteState();
    });
  });

  resultBody.querySelectorAll('input[data-role="kg"]').forEach(input => {
    input.addEventListener("input", () => {
      input.value = input.value
        .replace(/[^0-9,.]/g, "")
        .replace(/\./g, ",")
        .replace(/(,.*),/g, "$1");
      updateSiguienteState();
    });
  });
}

function renderPreview() {
  previewTitle.textContent = selectedPS;

  let totalKg = 0;
  let totalCaj = 0;

  const rows = itemsToSend.map(it => {
    const kg = Number(it.kg || 0);
    const caj = Number(it.cajones || 0);
    totalKg += kg;
    totalCaj += caj;

    return `
      <tr>
        <td>${escapeHtml(it.parte)}</td>
        <td>${escapeHtml(it.proceso)}</td>
        <td style="text-align:center">${escapeHtml(it.sc)}</td>
        <td style="text-align:center;font-weight:700">${kg.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
        <td style="text-align:center;font-weight:700">${caj}</td>
      </tr>
    `;
  }).join("");

  previewBody.innerHTML = rows;
  previewTotalKg.textContent = totalKg.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  previewTotalCaj.textContent = totalCaj;
}

/***********************
 * TABLE DATA
 ***********************/
function getItemsFromTable() {
  return fetchedItems.map((item, i) => {
    const cajInput = resultBody.querySelector(`input[data-role="cajones"][data-idx="${i}"]`);
    const kgInput = resultBody.querySelector(`input[data-role="kg"][data-idx="${i}"]`);
    const cajones = parseInputNumber(cajInput?.value);
    const kg = parseInputNumber(kgInput?.value);
    return {
      ps: item.ps, proceso: item.proceso, parte: item.parte,
      sc: item.sc, sp: item.sp,
      cajones: cajones ?? 0, kg: kg ?? 0
    };
  });
}

function filterItemsToSend(items) {
  return items.filter(it => Number(it.cajones || 0) > 0 && Number(it.kg || 0) > 0);
}

/***********************
 * SELECCION / RESET
 ***********************/
function resetAll() {
  selectedPS = "";
  fetchedItems = [];
  itemsToSend = [];
  isSubmitting = false;
  lastSendCode = null;
  lastSendData = null;

  selectedBadge.textContent = "";
  tableTitle.textContent = "Proveedor";
  resultBody.innerHTML = "";
  previewBody.innerHTML = "";
  setTableMsg("");

  mostrarFase(0);
  setStatus("Seleccion\u00e1 un proveedor para continuar.", "bad");

  psGrid.querySelectorAll(".ps-pill").forEach(btn => {
    btn.classList.remove("active");
  });
}

async function seleccionarPS(ps) {
  selectedPS = ps;
  fetchedItems = [];

  psGrid.querySelectorAll(".ps-pill").forEach(btn => {
    btn.classList.toggle("active", btn.textContent.trim() === ps);
  });

  setStatus("Buscando partes...", "");

  try {
    const [itemsBase, spKgMap, enviosMap, entregasMap] = await Promise.all([
      getItemsPorPS(ps),
      getSpKgMap(),
      getTotalesEnviosMap(ps),
      getTotalesEntregasMap(ps)
    ]);

    fetchedItems = itemsBase.map(item => ({
      ...item,
      cajonesAEnviar: calcularCajonesAEnviar(ps, item.sp, spKgMap, enviosMap, entregasMap)
    }));

    selectedBadge.textContent = ps;
    tableTitle.textContent = ps;

    renderTable(fetchedItems);
    mostrarFase(1);

    if (fetchedItems.length) {
      setStatus("Proveedor cargado correctamente.", "ok");
      setTableMsg("Complet\u00e1 KG y Cajones. Luego toc\u00e1 Siguiente para revisar.");
    } else {
      setStatus("No hay partes para ese proveedor.", "bad");
      setTableMsg("No hay partes para ese proveedor.", "bad");
    }

    updateSiguienteState();
  } catch (e) {
    console.error(e);
    setStatus("Error consultando partes.", "bad");
    setTableMsg("Error consultando partes.", "bad");
  }
}

/***********************
 * EVENTS
 ***********************/
btnVolver.addEventListener("click", () => {
  if (isSubmitting) return;
  if (currentPhase === 2) {
    mostrarFase(1);
    setStatus("Proveedor cargado correctamente.", "ok");
    return;
  }
  resetAll();
});

okBtn.addEventListener("click", () => {
  if (lastSendData) {
    imprimirComprobante(lastSendData);
    lastSendData = null;
  }
  resetAll();
});

btnVolverPS.addEventListener("click", () => {
  resetAll();
});

/* FASE 1 -> FASE 2: Siguiente */
btnSiguiente.addEventListener("click", () => {
  if (isSubmitting) return;

  const rawItems = getItemsFromTable();

  if (!selectedPS) {
    setTableMsg("Seleccion\u00e1 un proveedor.", "bad");
    return;
  }

  const todosVacios = rawItems.every(it => Number(it.cajones || 0) === 0 && Number(it.kg || 0) === 0);
  if (todosVacios) {
    setTableMsg("Complet\u00e1 al menos una fila con KG y Cajones.", "bad");
    return;
  }

  const hayIncompletos = rawItems.some(it => {
    const caj = Number(it.cajones || 0);
    const kg = Number(it.kg || 0);
    return (caj > 0 && kg === 0) || (kg > 0 && caj === 0);
  });

  if (hayIncompletos) {
    setTableMsg("Si carg\u00e1s KG o Cajones, deb\u00e9s completar ambos.", "bad");
    return;
  }

  itemsToSend = rawItems.filter(it => Number(it.cajones || 0) > 0 && Number(it.kg || 0) > 0);

  renderPreview();
  mostrarFase(2);
  setStatus("Revis\u00e1 los datos antes de enviar.", "");
});

/* FASE 2 -> FASE 1: Volver a editar */
btnVolverFase1.addEventListener("click", () => {
  mostrarFase(1);
  setStatus("Proveedor cargado correctamente.", "ok");
});

/* FASE 2 -> FASE 3: Enviar */
btnEnviar.addEventListener("click", async () => {
  if (isSubmitting || !itemsToSend.length) return;

  const ok = confirm("\u00bfConfirmar env\u00edo?");
  if (!ok) return;

  const payload = itemsToSend.map(it => ({
    "Dia-mes": getDiaMesHoy(),
    "Prov_Serv": selectedPS,
    "Sector SC": it.sc || "",
    "Parte": it.parte || "",
    "Faltante": false,
    "KG": Number(it.kg || 0),
    "Cajones": Number(it.cajones || 0),
    "Sector SP": it.sp || "",
    "Proceso": it.proceso || ""
  }));

  try {
    isSubmitting = true;
    btnEnviar.disabled = true;
    btnEnviar.classList.remove("enabled");

    setStatus("Guardando en base de datos...", "");

    const codigo = genNumericCode(4);
    lastSendCode = codigo;

    const { error } = await sb
      .from(TABLA_DESTINO)
      .insert(payload);

    if (error) throw error;

    isSubmitting = false;
    btnEnviar.disabled = false;

    setStatus("Enviado correctamente.", "ok");

    lastSendData = {
      codigo,
      proveedor: selectedPS,
      fecha: getDiaMesHoy(),
      items: itemsToSend
    };

    successCodeEl.textContent = codigo;
    mostrarFase(3);
  } catch (e) {
    isSubmitting = false;
    btnEnviar.disabled = false;
    btnEnviar.classList.add("enabled");

    console.error(e);
    setStatus("Error guardando en base: " + (e?.message || e), "bad");
  }
});

/***********************
 * INIT
 ***********************/
async function init() {
  try {
    setStatus("Cargando proveedores...", "");
    availablePS = await getPSDisponibles();

    renderPSButtons(availablePS);
    psGridWrap.classList.remove("hidden");

    if (availablePS.length) {
      setStatus("Seleccion\u00e1 un proveedor para continuar.", "bad");
    } else {
      setStatus("No se encontraron proveedores.", "bad");
    }
  } catch (e) {
    console.error(e);
    setStatus("No se pudieron cargar los proveedores.", "bad");
  }
}

mostrarFase(0);
init();

/***********************
 * IMPRIMIR COMPROBANTE
 ***********************/
function imprimirComprobante({ codigo, proveedor, fecha, items }) {
  const totalKg = items.reduce((s, it) => s + Number(it.kg || 0), 0);
  const totalCaj = items.reduce((s, it) => s + Number(it.cajones || 0), 0);

  const detalleRows = items.map((it, i) => `
    <tr>
      <td style="text-align:center;">${i + 1}</td>
      <td>${escapeHtml(it.parte || "")}</td>
      <td>${escapeHtml(it.proceso || "")}</td>
      <td style="text-align:center;">${escapeHtml(it.sc || "")}</td>
      <td style="text-align:center;">${escapeHtml(it.sp || "")}</td>
      <td style="text-align:right;font-weight:600;">${Number(it.kg || 0).toFixed(1)}</td>
      <td style="text-align:right;font-weight:600;">${Number(it.cajones || 0)}</td>
    </tr>
  `).join("");

  const html = `
    <!doctype html>
    <html lang="es">
    <head>
      <meta charset="utf-8" />
      <title>Comprobante envio ${escapeHtml(codigo)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px 30px; color: #111; font-size: 14px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
        .header h1 { margin: 0; font-size: 24px; }
        .header .codigo { font-size: 28px; font-weight: 800; text-align: right; }
        .meta { display: flex; gap: 40px; margin-bottom: 16px; font-size: 15px; line-height: 1.8; }
        table { width: 100%; border-collapse: collapse; font-size: 14px; }
        thead { display: table-header-group; }
        th, td { border: 1px solid #555; padding: 6px 10px; vertical-align: middle; }
        th { background: #e5e5e5; text-align: left; font-size: 13px; font-weight: 700; }
        tr:nth-child(even) { background: #f9f9f9; }
        .totals td { font-weight: 800; font-size: 15px; border-top: 3px solid #111; background: #f1f1f1; }
        .firma { margin-top: 50px; display: flex; justify-content: space-around; }
        .firma div { text-align: center; width: 200px; }
        .firma .linea { border-top: 1px solid #333; margin-top: 40px; padding-top: 4px; font-size: 12px; color: #555; }
        .foot { margin-top: 30px; padding-top: 12px; border-top: 1px solid #999; font-size: 11px; color: #666; display: flex; justify-content: space-between; }
        @media print { body { padding: 10px 20px; } @page { margin: 15mm 10mm; } }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <h1>Comprobante de Envio a PS</h1>
          <div style="font-size:13px;color:#555;margin-top:2px">Envio a Proveedor de Servicios</div>
        </div>
        <div class="codigo">#${escapeHtml(codigo)}</div>
      </div>
      <div class="meta">
        <div><strong>Fecha:</strong> ${escapeHtml(fecha)}</div>
        <div><strong>Proveedor:</strong> ${escapeHtml(proveedor)}</div>
        <div><strong>Items:</strong> ${items.length}</div>
      </div>
      <table>
        <thead>
          <tr>
            <th style="width:30px;text-align:center">#</th>
            <th>Parte</th>
            <th>Proceso</th>
            <th style="text-align:center">SC</th>
            <th style="text-align:center">SP</th>
            <th style="text-align:right;width:70px">KG</th>
            <th style="text-align:right;width:70px">Cajones</th>
          </tr>
        </thead>
        <tbody>${detalleRows}</tbody>
        <tfoot>
          <tr class="totals">
            <td colspan="5" style="text-align:right;">TOTAL</td>
            <td style="text-align:right;">${totalKg.toFixed(1)}</td>
            <td style="text-align:right;">${totalCaj}</td>
          </tr>
        </tfoot>
      </table>
      <div class="firma">
        <div><div class="linea">Entrega</div></div>
        <div><div class="linea">Recibe</div></div>
      </div>
      <div class="foot">
        <span>Comprobante generado automaticamente</span>
        <span>Codigo: ${escapeHtml(codigo)}</span>
      </div>
      <script>window.onload = function() { window.print(); };<\/script>
    </body>
    </html>
  `;

  const iframe = document.getElementById("printFrame");
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(html.replace("window.onload = function() { window.print(); };", ""));
  doc.close();
  setTimeout(() => { iframe.contentWindow.print(); }, 300);
}
