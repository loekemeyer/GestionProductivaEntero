"use strict";

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
const BUFFER_KEY = "enviosPS_pendientes";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const psGrid = document.getElementById("psGrid");
const statusEl = document.getElementById("status");
const btnVolver = document.getElementById("btnVolver");
const btnSiguiente = document.getElementById("btnSiguiente");
const btnEnviar = document.getElementById("btnEnviar");
const btnVolverFase1 = document.getElementById("btnVolverFase1");
const btnVolverPS = document.getElementById("btnVolverPS");
const successCodeEl = document.getElementById("successCode");

const fase0 = document.getElementById("fase0");
const fase1 = document.getElementById("fase1");
const fase2 = document.getElementById("fase2");
const fase3 = document.getElementById("fase3");

const fase1TableBody = document.getElementById("fase1TableBody");
const fase2TableBody = document.getElementById("fase2TableBody");
const fase1Title = document.getElementById("fase1Title");
const fase2Title = document.getElementById("fase2Title");
const fase2HdrCantidad = document.getElementById("fase2HdrCantidad");

let currentPhase = 0;
let selectedPS = "";
let fetchedItems = [];
let availablePS = [];
let isSubmitting = false;
let cargaPorUnidades = false; // true cuando PS seleccionado tiene flag carga_por_unidades=TRUE (ej. AJ Adhesivos)
let cargaPorUniMap = new Map(); // ps -> boolean, se llena al cargar la lista de PS

function getBuffer() {
  try {
    return JSON.parse(localStorage.getItem(BUFFER_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveBuffer(arr) {
  localStorage.setItem(BUFFER_KEY, JSON.stringify(arr));
  actualizarBtnSiguiente();
}

function clearBuffer() {
  localStorage.removeItem(BUFFER_KEY);
  actualizarBtnSiguiente();
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

function parseDecimal(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
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

function normalizarTexto(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function uniqueSorted(arr) {
  return [...new Set(arr.map(v => String(v || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function genNumericCode(len = 4) {
  const min = Math.pow(10, len - 1);
  const max = Math.pow(10, len) - 1;
  return String(Math.floor(min + Math.random() * (max - min + 1)));
}

let spKgCache = null;
async function getSpKgMap() {
  if (spKgCache) return spKgCache;
  const { data, error } = await sb.from(TABLA_SP_KG).select("*");
  if (error) throw error;
  const map = new Map();
  (data || []).forEach(r => {
    const key = String(r.Sp || r.SP || "").trim().toLowerCase();
    if (!key) return;
    map.set(key, {
      kgCaj: parseDecimal(pick(r, ["KG Cajon", "KG x Cajon", "kg cajon", "kg x cajon"]))
    });
  });
  spKgCache = map;
  return map;
}

async function getPSDisponibles() {
  const { data, error } = await sb.from(SUPABASE_TABLE).select(COL_PS);
  if (error) throw error;
  // Cargar flags carga_por_unidades de Tall_ProvAT_PS en paralelo
  try {
    const { data: flagsData } = await sb.from("Tall_ProvAT_PS").select("nombre, carga_por_unidades");
    if (flagsData) {
      cargaPorUniMap = new Map(flagsData.map(r => [String(r.nombre || "").trim(), Boolean(r.carga_por_unidades)]));
    }
  } catch (e) {
    console.warn("No se pudo cargar carga_por_unidades flags:", e);
  }
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

function mostrarFase(n) {
  currentPhase = n;
  fase0.classList.toggle("hidden", n !== 0);
  fase1.classList.toggle("hidden", n !== 1);
  fase2.classList.toggle("hidden", n !== 2);
  fase3.classList.toggle("hidden", n !== 3);
  btnVolver.classList.toggle("hidden", n === 0 || n === 3);
  // Al entrar a fase 2, resetear fecha a hoy + ajustar UI Kg vs Uni
  if (n === 2) {
    const fechaInput = document.getElementById("fechaEnvio");
    if (fechaInput) fechaInput.value = new Date().toISOString().slice(0,10);
    if (fase2Title) fase2Title.textContent = cargaPorUnidades ? "Cargar Unidades" : "Cargar Pesos (Kg)";
    if (fase2HdrCantidad) fase2HdrCantidad.textContent = cargaPorUnidades ? "Uni" : "Kg";
  }
}

function actualizarBtnSiguiente() {
  const buf = getBuffer();
  const tieneItems = buf.some(b => b.ps === selectedPS && Number(b.cajones) > 0);
  btnSiguiente.classList.toggle("hidden", !tieneItems);
}

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

async function seleccionarPS(ps) {
  selectedPS = ps;
  cargaPorUnidades = Boolean(cargaPorUniMap.get(ps));
  isSubmitting = true;
  statusEl.textContent = "Buscando partes...";

  try {
    const itemsBase = await getItemsPorPS(ps);
    fetchedItems = itemsBase;

    renderizarFase1();
    mostrarFase(1);
    statusEl.textContent = "";

    actualizarBtnSiguiente();
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Error al cargar partes";
    isSubmitting = false;
  }
}

function renderizarFase1() {
  const buf = getBuffer();
  fase1Title.textContent = selectedPS;

  fase1TableBody.innerHTML = fetchedItems.map((item, i) => {
    const bufKey = `${selectedPS}__${item.sc}__${item.parte}`;
    const bufItem = buf.find(b => `${b.ps}__${b.sc}__${b.parte}` === bufKey);
    const bufCajVal = bufItem ? bufItem.cajones : "";

    return `
      <tr data-idx="${i}">
        <td>${escapeHtml(item.parte)}</td>
        <td>${escapeHtml(item.proceso)}</td>
        <td>${escapeHtml(item.sc)}</td>
        <td class="right"><input type="text" inputmode="numeric" class="cell-input input-caj" placeholder="0" value="${bufCajVal}" autocomplete="off"></td>
      </tr>
    `;
  }).join("");

  fase1TableBody.querySelectorAll(".input-caj").forEach((input, idx) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/[^\d]/g, "");
      registrarCambioFila1(idx);
    });
    input.addEventListener("change", () => {
      registrarCambioFila1(idx);
    });
  });

  isSubmitting = false;
}

function registrarCambioFila1(idx) {
  const item = fetchedItems[idx];
  if (!item) return;

  const rows = fase1TableBody.querySelectorAll("tr");
  const row = rows[idx];
  const input = row?.querySelector(".input-caj");
  const cajones = parseInputNumber(input?.value);

  const buf = getBuffer();
  const bufKey = `${selectedPS}__${item.sc}__${item.parte}`;
  const bufIdx = buf.findIndex(b => `${b.ps}__${b.sc}__${b.parte}` === bufKey);

  if (cajones !== null && cajones > 0) {
    const newItem = {
      ps: selectedPS,
      parte: item.parte,
      proceso: item.proceso,
      sc: item.sc,
      sp: item.sp,
      cajones: cajones,
      kg: ""
    };
    if (bufIdx >= 0) {
      buf[bufIdx] = newItem;
    } else {
      buf.push(newItem);
    }
  } else {
    if (bufIdx >= 0) {
      buf.splice(bufIdx, 1);
    }
  }

  saveBuffer(buf);
}

function renderizarFase2() {
  const buf = getBuffer();
  // Mapeo con indice ORIGINAL del buffer, luego filtra por PS (para que data-buf-idx apunte a la posicion real en localStorage)
  const itemsConCaj = buf
    .map((b, originalIdx) => ({ ...b, _idx: originalIdx }))
    .filter(b => b.ps === selectedPS && Number(b.cajones) > 0);

  const ph = cargaPorUnidades ? "0" : "0,0";
  const im = cargaPorUnidades ? "numeric" : "decimal";

  fase2TableBody.innerHTML = itemsConCaj.map(item => {
    const i = item._idx;
    return `
      <tr data-buf-idx="${i}">
        <td>${escapeHtml(item.parte)}</td>
        <td>${escapeHtml(item.proceso)}</td>
        <td>${escapeHtml(item.sc)}</td>
        <td class="right"><b>${item.cajones}</b></td>
        <td class="right"><input type="text" inputmode="${im}" class="cell-input input-kg-fase2" data-buf-idx="${i}" placeholder="${ph}" value="${item.kg || ""}" autocomplete="off"></td>
      </tr>
    `;
  }).join("");

  fase2TableBody.querySelectorAll(".input-kg-fase2").forEach(input => {
    input.addEventListener("input", () => {
      // Si carga por unidades: solo enteros. Si por kg: decimales.
      input.value = cargaPorUnidades
        ? input.value.replace(/\D/g, "")
        : input.value.replace(/[^0-9,.\-]/g, "");
      validarFase2Completa();
    });
    input.addEventListener("change", () => {
      const idx = Number(input.dataset.bufIdx);
      const buf = getBuffer();
      if (buf[idx]) buf[idx].kg = input.value.trim();
      localStorage.setItem(BUFFER_KEY, JSON.stringify(buf));
      validarFase2Completa();
    });
  });

  validarFase2Completa();
}

function validarFase2Completa() {
  const inputs = fase2TableBody.querySelectorAll(".input-kg-fase2");
  const todosLlenos = Array.from(inputs).every(input => {
    const val = input.value.trim();
    return val && parseDecimal(val) > 0;
  });
  btnEnviar.disabled = !todosLlenos;
  btnEnviar.classList.toggle("disabled", !todosLlenos);
}

btnSiguiente.addEventListener("click", () => {
  const buf = getBuffer();
  const itemsPS = buf.filter(b => b.ps === selectedPS && Number(b.cajones) > 0);
  if (!itemsPS.length) {
    alert("Selecciona al menos un artículo con cajones para enviar");
    return;
  }
  renderizarFase2();
  mostrarFase(2);
});

btnVolverFase1.addEventListener("click", () => {
  mostrarFase(1);
});

btnEnviar.addEventListener("click", async () => {
  // Defensivo: persistir cualquier valor del DOM que no se haya commiteado por change (ej. usuario clickea Enviar sin perder focus del input)
  const inputsActuales = fase2TableBody.querySelectorAll(".input-kg-fase2");
  if (inputsActuales.length) {
    const bufAct = getBuffer();
    inputsActuales.forEach(input => {
      const idx = Number(input.dataset.bufIdx);
      if (Number.isInteger(idx) && bufAct[idx]) {
        bufAct[idx].kg = String(input.value || "").trim();
      }
    });
    localStorage.setItem(BUFFER_KEY, JSON.stringify(bufAct));
  }

  const buf = getBuffer();
  const itemsConCaj = buf.filter(b => b.ps === selectedPS && Number(b.cajones) > 0);

  const faltanKg = itemsConCaj.filter(b => !(parseDecimal(b.kg) > 0));
  if (faltanKg.length) {
    const etiqueta = cargaPorUnidades ? "Unidades" : "Kg";
    alert("Por favor ingresa " + etiqueta + " para todos los artículos");
    return;
  }

  btnEnviar.disabled = true;
  const textOriginal = btnEnviar.textContent;
  btnEnviar.textContent = "Enviando...";

  try {
    // Tomar fecha seleccionada (default hoy). Convertir YYYY-MM-DD → DD/MM
    const fechaInput = document.getElementById("fechaEnvio");
    let diaMes = getDiaMesHoy();
    if (fechaInput && fechaInput.value) {
      const [y, m, d] = fechaInput.value.split("-");
      diaMes = `${d}/${m}`;
    }
    const payload = itemsConCaj.map(item => {
      const base = {
        "Dia-mes": diaMes,
        "Prov_Serv": selectedPS,
        "Sector SC": item.sc || "",
        "Parte": item.parte || "",
        "Faltante": false,
        "Cajones": Number(item.cajones),
        "Sector SP": item.sp || "",
        "Proceso": item.proceso || ""
      };
      if (cargaPorUnidades) {
        // PS con carga_por_unidades=TRUE (ej. AJ Adhesivos): guardar en Unidades, KG queda null
        base["Unidades"] = parseInt(item.kg, 10) || 0;
      } else {
        base["KG"] = parseDecimal(item.kg);
      }
      return base;
    });

    const { error } = await sb.from(TABLA_DESTINO).insert(payload);
    if (error) throw error;

    const codigo = genNumericCode(4);
    successCodeEl.textContent = codigo;

    clearBuffer();
    mostrarFase(3);
  } catch (err) {
    console.error(err);
    alert("Error: " + (err.message || "no se pudo enviar"));
  } finally {
    btnEnviar.disabled = false;
    btnEnviar.textContent = textOriginal;
  }
});

btnVolver.addEventListener("click", () => {
  selectedPS = "";
  fetchedItems = [];
  clearBuffer();
  psGrid.querySelectorAll(".ps-pill").forEach(btn => {
    btn.classList.remove("active");
  });
  mostrarFase(0);
  statusEl.textContent = "Selecciona un proveedor para continuar.";
});

btnVolverPS.addEventListener("click", () => {
  selectedPS = "";
  fetchedItems = [];
  clearBuffer();
  psGrid.querySelectorAll(".ps-pill").forEach(btn => {
    btn.classList.remove("active");
  });
  mostrarFase(0);
  statusEl.textContent = "Selecciona un proveedor para continuar.";
});

async function init() {
  try {
    statusEl.textContent = "Cargando proveedores...";
    availablePS = await getPSDisponibles();
    renderPSButtons(availablePS);
    mostrarFase(0);
    statusEl.textContent = "Selecciona un proveedor para continuar.";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "Error al cargar proveedores";
  }
}

init();
