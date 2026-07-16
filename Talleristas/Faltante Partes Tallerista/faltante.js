// Faltante Partes Tallerista
// Reusa funciones globales de ControlTall.js (cargado antes en index.html):
//   buscar(nombre), datosParaFiltro, listaTalleristas, escapeHtml.
// Itera cada tallerista, captura datosParaFiltro, filtra %Lleno < umbral,
// renderiza panel con columnas paralelas por tallerista.
//
// %Lleno (Tall) = onlineUni / consumoTotal * 100  (consumo mensual en uni vs stock actual en uni).
// %Lleno Virg   = pendiente (logica a definir por el usuario).

const UMBRAL_DEFAULT = 25;

const myStatus = document.getElementById("myStatus");
const panel = document.getElementById("faltantePanel");
const umbralInput = document.getElementById("umbralPct");
const btnRecargar = document.getElementById("btnRecargar");
const btnConectarOC = document.getElementById("btnConectarOC");
const pdfStatus = document.getElementById("pdfStatus");
const scrollTop = document.getElementById("scrollTop");
const scrollTopInner = document.getElementById("scrollTopInner");
const filtroBar = document.getElementById("filtroTallsBar");

// Estado del filtro: _todosFull guarda el ultimo resultado completo de recolectarTodos
// para poder re-renderizar al togglear botones sin re-correr las queries Supabase.
// selectedTalls = Set de nombres tallerista activos; si "todos" esta on, ignora el set.
let _todosFull = {};
let _umbralActual = UMBRAL_DEFAULT;
let _modoTodos = true;
const selectedTalls = new Set();

function setPdfStatus(t, cls){
  pdfStatus.className = "pdf-status" + (cls ? " " + cls : "");
  pdfStatus.textContent = t || "";
}

// Scrollbar arriba sincronizada con el panel real abajo.
let _syncing = false;
function syncScrollFromTop(){
  if (_syncing) return;
  _syncing = true;
  panel.scrollLeft = scrollTop.scrollLeft;
  _syncing = false;
}
function syncScrollFromPanel(){
  if (_syncing) return;
  _syncing = true;
  scrollTop.scrollLeft = panel.scrollLeft;
  _syncing = false;
}
scrollTop.addEventListener("scroll", syncScrollFromTop);
panel.addEventListener("scroll", syncScrollFromPanel);

function ajustarScrollTop(){
  // Iguala ancho del dummy al scrollWidth de la tabla para que aparezca la scrollbar arriba.
  scrollTopInner.style.width = panel.scrollWidth + "px";
}
window.addEventListener("resize", ajustarScrollTop);

function setMyStatus(t){ myStatus.textContent = t || ""; }

function _escape(s){
  // Usa escapeHtml global si esta disponible (lo define ControlTall.js); fallback minimo.
  if (typeof escapeHtml === "function") return escapeHtml(s);
  return String(s == null ? "" : s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function waitForTalleristas(timeoutMs = 20000){
  const start = Date.now();
  while (Date.now() - start < timeoutMs){
    if (typeof listaTalleristas !== "undefined" &&
        Array.isArray(listaTalleristas) &&
        listaTalleristas.length){
      return listaTalleristas.filter(t => t && t !== "__TODOS__");
    }
    await new Promise(r => setTimeout(r, 120));
  }
  throw new Error("No se cargo la lista de talleristas a tiempo");
}

function esCartonOCaja(desc){
  const s = String(desc || "").toLowerCase().trim();
  return s.startsWith("carton") || s.startsWith("cartón") || s.startsWith("caja");
}

function calcularPctLleno(d){
  // Si no hay consumo definido, no se puede calcular % lleno (descartar fila).
  const cons = Number(d.consumoTotal || 0);
  if (cons <= 0) return null;
  const stock = Number(d.onlineUni || 0);
  const pct = (stock / cons) * 100;
  // Acotar para mostrar (>100 = sobrado, ignorado por umbral; <0 = stock negativo, mostrar 0).
  return Math.max(0, Math.round(pct * 10) / 10);
}

function clasePct(pct){
  if (pct == null) return "";
  if (pct < 10) return "pct-critico";
  if (pct < 25) return "pct-bajo";
  return "pct-ok";
}

// ====================== % Lleno Virg: PDFs OC Art Term ======================
// Flujo:
//   1) User clickea "Conectar carpeta OC" → File System Access API → guarda
//      handle en IndexedDB (DB: faltante_oc, store: handles, key: rootDir).
//   2) Al cargar el modulo, intenta levantar el handle, pedir permiso silencioso,
//      detectar subcarpeta "PDF DD-M" mas reciente.
//   3) Itera todos los PDFs, parsea con pdf.js: extrae filas {empresa, cod, pct}.
//   4) Carga Despiece x Articulo (REST anon de Supabase) y arma index
//      sectorProce → [{empresa, cod}].
//   5) Por cada parte del panel: lookup articulos del sector, busca pct en mapa
//      PDF (default 100% si no aparece — cubierto), min = %LlenoVirg.

const SUPA_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

// Mapeo Lin del PDF → sufijo del ARTICULO en Despiece x Articulo.
// Confirmado por usuario 2026-05-21: CH→CH, LK→LK, LOk→Loke.
const LIN_A_SUFIJO = { CH: "CH", LK: "LK", LOK: "Loke" };

// ---------- IndexedDB minimal wrapper para guardar el FileSystemDirectoryHandle ----------
const IDB_NAME = "faltante_oc";
const IDB_STORE = "handles";

function idbOpen(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(key){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value){
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function verifyPermission(handle, write = false){
  const opts = { mode: write ? "readwrite" : "read" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  if ((await handle.requestPermission(opts)) === "granted") return true;
  return false;
}

async function pickRootDir(){
  if (!window.showDirectoryPicker){
    throw new Error("Tu navegador no soporta File System Access API (usa Chrome o Edge actual).");
  }
  const handle = await window.showDirectoryPicker({
    id: "oc-art-term-vigente",
    mode: "read",
    startIn: "documents"
  });
  await idbSet("rootDir", handle);
  return handle;
}

async function getRootDir(){
  const saved = await idbGet("rootDir");
  if (!saved) return null;
  const ok = await verifyPermission(saved, false);
  return ok ? saved : null;
}

// Parsea "PDF 20-5", "PDF 27-5" → Date (año actual). Devuelve null si no matchea.
function fechaCarpetaPdf(nombre){
  const m = String(nombre || "").match(/^PDF\s+(\d{1,2})[-/](\d{1,2})$/i);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]) - 1;
  if (!Number.isFinite(dia) || !Number.isFinite(mes)) return null;
  return new Date(new Date().getFullYear(), mes, dia);
}

async function detectarCarpetaPdfMasReciente(rootHandle){
  let mejor = null;
  let mejorFecha = null;
  for await (const [name, h] of rootHandle.entries()){
    if (h.kind !== "directory") continue;
    const f = fechaCarpetaPdf(name);
    if (!f) continue;
    if (!mejorFecha || f > mejorFecha){
      mejorFecha = f;
      mejor = { name, handle: h };
    }
  }
  return mejor;
}

// ---------- pdf.js parser: extrae filas {empresa, cod, pct} de un PDF ----------
// Bucketing por banda Y: descripciones multilinea (ej. "Sacacorcho\nCombinado Color")
// desincronizan el Y exacto de la fila — agrupamos items dentro de Y_TOL para que la
// fila visual completa quede en la misma linea logica antes de aplicar la regex.
const Y_TOL = 12;

async function parsePdfRows(file, debugName){
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const rows = [];
  const numPages = pdf.numPages;
  for (let p = 1; p <= numPages; p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter(it => (it.str || "").trim().length)
      .map(it => ({ y: it.transform[5], x: it.transform[4], str: it.str }))
      .sort((a, b) => b.y - a.y || a.x - b.x);

    const lineas = [];
    let cur = [];
    let curY = null;
    for (const it of items){
      if (curY === null || Math.abs(it.y - curY) <= Y_TOL){
        cur.push(it);
        if (curY === null) curY = it.y;
      } else {
        lineas.push(cur.sort((a, b) => a.x - b.x).map(i => i.str).join(" ").replace(/\s+/g, " ").trim());
        cur = [it];
        curY = it.y;
      }
    }
    if (cur.length){
      lineas.push(cur.sort((a, b) => a.x - b.x).map(i => i.str).join(" ").replace(/\s+/g, " ").trim());
    }

    // Regex permisiva: Lin (CH/LK/LOk) + cod + ...desc... + numero% al final.
    // Captura todas las ocurrencias por linea (por si quedaran 2 filas juntas).
    const RE = /\b(CH|LK|LOk)\s+(\d{1,4})\s+.*?(-?\d{1,3})\s*%/gi;
    for (const linea of lineas){
      RE.lastIndex = 0;
      let m;
      while ((m = RE.exec(linea)) !== null){
        const lin = m[1].toUpperCase();
        const cod = String(parseInt(m[2], 10));
        const pct = Number(m[3]);
        if (!Number.isFinite(pct)) continue;
        rows.push({ empresa: LIN_A_SUFIJO[lin] || lin, cod, pct });
      }
    }
  }
  if (debugName){
    console.log(`[PDF ${debugName}] ${rows.length} filas:`, rows.slice(0, 5));
  }
  return rows;
}

// ---------- Procesa carpeta semana: construye Map cod → pctLleno (min) ----------
// Key = cod solo (sin empresa). El COD en Despiece es unico por (empresa, producto)
// — ej. "C Pizza 8 CH"=863 vs "C Pizza 8 LK"=564 — asi que no hace falta empresa para
// desambiguar. Antes joinaba por <empresa>__<cod> y fallaba para 64% de ARTICULOs
// que NO terminan en CH/LK/Loke (suffix="Inox", "Mamad", etc).
async function procesarPdfs(carpetaHandle){
  const mapa = new Map();
  let nArchivos = 0;
  let nRows = 0;
  for await (const [name, h] of carpetaHandle.entries()){
    if (h.kind !== "file") continue;
    if (!/\.pdf$/i.test(name)) continue;
    nArchivos++;
    setPdfStatus(`Parseando ${name}...`);
    try{
      const file = await h.getFile();
      const rows = await parsePdfRows(file, name);
      for (const r of rows){
        const k = r.cod;
        const prev = mapa.get(k);
        // Si un mismo articulo aparece en mas de un PDF, nos quedamos con el peor (min %).
        if (prev === undefined || r.pct < prev) mapa.set(k, r.pct);
        nRows++;
      }
    }catch (e){
      console.warn("Error parseando", name, e);
    }
  }
  return { mapa, nArchivos, nRows };
}

// ---------- Despiece x Articulo: sector → [cod] ----------
// Key por sector con lista de cods (sin empresa). COD es globalmente unico — cada cod
// identifica unicamente un (empresa, producto) en el catalogo. Antes derivabamos empresa
// del sufijo del ARTICULO pero 64% de ARTICULOs no tienen sufijo CH/LK/Loke (sufijos
// reales: "Inox", "Mamad", "Mariposa", "23cm", numeros, etc) — el lookup fallaba.
let despieceCache = null;
async function cargarDespieceSectorMap(){
  if (despieceCache) return despieceCache;
  const url = `${SUPA_URL}/rest/v1/Despiece%20x%20Articulo?select=COD,ARTICULO,Sector%20Proce&limit=20000`;
  const res = await fetch(url, {
    headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY }
  });
  if (!res.ok) throw new Error("Despiece x Articulo: HTTP " + res.status);
  const data = await res.json();
  const bySector = new Map();
  for (const r of data){
    const sec = String(r["Sector Proce"] || "").trim();
    if (!sec) continue;
    const codNum = parseInt(r.COD, 10);
    if (!Number.isFinite(codNum)) continue;
    const cod = String(codNum);
    if (!bySector.has(sec)) bySector.set(sec, new Set());
    bySector.get(sec).add(cod);
  }
  // Convert Set → Array para shape estable.
  for (const [k, set] of bySector){
    bySector.set(k, [...set]);
  }
  despieceCache = bySector;
  console.log(`[Despiece] ${bySector.size} sectores cargados. Muestra:`,
    [...bySector.entries()].slice(0, 3).map(([s, cods]) => ({ sector: s, cods })));
  return despieceCache;
}

// ---------- Calcula %LlenoVirg para una parte (sector) ----------
// Default 100% para cods del sector que NO aparecen en PDFs (asumir cubiertos),
// PERO solo si al menos UN cod del sector si aparece. Si ninguno aparece, retorna
// null (mostramos "—") porque no hay datos para ese sector — no inventamos 100%.
function calcularPctVirg(sector, despieceMap, pdfMap){
  if (!sector) return null;
  if (!pdfMap || pdfMap.size === 0) return null;
  if (!despieceMap || despieceMap.size === 0) return null;
  const cods = despieceMap.get(sector);
  if (!cods || !cods.length) return null;
  let anyInPdf = false;
  let min = Infinity;
  for (const cod of cods){
    if (pdfMap.has(cod)){
      anyInPdf = true;
      const pct = pdfMap.get(cod);
      if (pct < min) min = pct;
    } else {
      if (100 < min) min = 100;
    }
  }
  if (!anyInPdf) return null;
  return Math.round(min * 10) / 10;
}

// Estado global del modulo
let pdfMapaGlobal = new Map(); // <empresa>__<cod> → pct
let despieceMapaGlobal = new Map(); // sector → [{empresa, cod}]

async function refrescarPdfYDespiece(){
  // Despiece: SIEMPRE (cache interno, queda en memoria).
  setPdfStatus("Cargando Despiece x Articulo...");
  try{
    despieceMapaGlobal = await cargarDespieceSectorMap();
  }catch (e){
    setPdfStatus("Error cargando Despiece: " + e.message, "error");
    return;
  }
  // PDFs: solo si hay carpeta conectada.
  const root = await getRootDir();
  if (!root){
    setPdfStatus('Carpeta OC no conectada — click "Conectar carpeta OC" para habilitar % Lleno Virg.');
    btnConectarOC.classList.remove("connected");
    return;
  }
  btnConectarOC.classList.add("connected");
  setPdfStatus("Detectando carpeta PDF mas reciente...");
  const carp = await detectarCarpetaPdfMasReciente(root);
  if (!carp){
    setPdfStatus('Carpeta conectada pero no encontre subcarpetas "PDF DD-M".', "error");
    return;
  }
  setPdfStatus(`Procesando PDFs de "${carp.name}"...`);
  const { mapa, nArchivos, nRows } = await procesarPdfs(carp.handle);
  pdfMapaGlobal = mapa;
  setPdfStatus(
    `OK — ${nArchivos} PDFs procesados de "${carp.name}", ${nRows} lineas, ${mapa.size} articulos unicos.`,
    "ok"
  );
}

btnConectarOC.addEventListener("click", async () => {
  btnConectarOC.disabled = true;
  try{
    await pickRootDir();
    await refrescarPdfYDespiece();
    // Re-renderiza el panel con los nuevos datos (sin re-correr buscar() por tallerista).
    await correrFlow();
  }catch (e){
    if (e.name !== "AbortError"){
      setPdfStatus("Error: " + (e.message || e), "error");
    }
  }finally{
    btnConectarOC.disabled = false;
  }
});

async function recolectarTodos(talls, umbral){
  const todos = {};
  let idx = 0;
  for (const tall of talls){
    idx++;
    setMyStatus(`Procesando ${idx}/${talls.length}: ${tall}...`);
    // Reset defensivo: si buscar() hace early-return sin reasignar, evitamos arrastrar datos.
    if (typeof datosParaFiltro !== "undefined" && Array.isArray(datosParaFiltro)){
      datosParaFiltro.length = 0;
    }
    try{
      await buscar(tall);
    }catch (e){
      console.error("Error buscando tallerista", tall, e);
      todos[tall] = [];
      continue;
    }
    const snapshot = Array.isArray(datosParaFiltro) ? [...datosParaFiltro] : [];
    const filas = snapshot
      .filter(d => !esCartonOCaja(d.descripcion))
      .map(d => {
        const pct = calcularPctLleno(d);
        const sector = d.sectorProce || "-";
        const pctVirg = calcularPctVirg(sector, despieceMapaGlobal, pdfMapaGlobal);
        return {
          sector,
          descripcion: d.descripcion || "",
          pct,
          pctVirg,
        };
      })
      .filter(f => f.pct !== null && f.pct < umbral)
      .sort((a, b) => a.pct - b.pct);
    todos[tall] = filas;
  }
  return todos;
}

function renderPanel(todos, umbral){
  const talls = Object.keys(todos);
  if (!talls.length){
    panel.innerHTML = '<p class="muted">Sin talleristas detectados.</p>';
    return;
  }

  const maxFilas = Math.max(0, ...talls.map(t => todos[t].length));
  // Sin filas vacias de relleno: render solo hasta el max real de filas.
  const filasRender = maxFilas;

  let html = '<h2 class="panel-title">Panel Items Criticos Talleristas y Proveedores</h2>';
  html += '<table class="faltante-table"><thead>';

  // Row 1: nombre tallerista, colspan 4 columnas
  html += '<tr>';
  talls.forEach((t, i) => {
    const div = (i < talls.length - 1) ? ' col-divider' : '';
    html += `<th colspan="4" class="tall-header${div}">${_escape(t)}</th>`;
  });
  html += '</tr>';

  // Row 2: encabezados de columnas
  html += '<tr>';
  talls.forEach((_, i) => {
    const div = (i < talls.length - 1);
    html += '<th>Sector</th>';
    html += '<th>Descripcion</th>';
    html += '<th>% Lleno Tall</th>';
    html += `<th${div ? ' class="col-divider"' : ''}>% Lleno Virg</th>`;
  });
  html += '</tr></thead><tbody>';

  for (let i = 0; i < filasRender; i++){
    html += '<tr>';
    talls.forEach((t, ti) => {
      const div = (ti < talls.length - 1);
      const f = todos[t][i];
      if (!f){
        html += '<td class="row-empty"></td>';
        html += '<td class="row-empty"></td>';
        html += '<td class="row-empty"></td>';
        html += `<td class="row-empty${div ? ' col-divider' : ''}"></td>`;
      } else {
        const cls = clasePct(f.pct);
        html += `<td>${_escape(f.sector)}</td>`;
        html += `<td class="col-desc" title="${_escape(f.descripcion)}">${_escape(f.descripcion)}</td>`;
        html += `<td class="${cls}">${f.pct}%</td>`;
        const virgTxt = (f.pctVirg == null) ? "—" : (f.pctVirg + "%");
        const virgCls = (f.pctVirg == null) ? "" : clasePct(f.pctVirg);
        const divCls = div ? " col-divider" : "";
        html += `<td class="${virgCls}${divCls}">${virgTxt}</td>`;
      }
    });
    html += '</tr>';
  }

  html += '</tbody></table>';
  panel.innerHTML = html;
  // Tras render, ajustar ancho del dummy para que la scrollbar arriba refleje el tamaño real.
  requestAnimationFrame(ajustarScrollTop);
}

function filtrarTodos(todosFull){
  // Si "Todos" esta activo o set vacio → mostramos todo.
  if (_modoTodos || selectedTalls.size === 0) return { ...todosFull };
  const out = {};
  for (const t of Object.keys(todosFull)){
    if (selectedTalls.has(t)) out[t] = todosFull[t];
  }
  return out;
}

function renderFiltroBar(){
  const talls = Object.keys(_todosFull);
  if (!talls.length){
    filtroBar.innerHTML = "";
    return;
  }
  const parts = [];
  parts.push('<span class="filtro-talls-label">Ver:</span>');
  parts.push(
    `<button type="button" class="filtro-tall-btn filtro-tall-btn--todos${_modoTodos ? " active" : ""}" data-todos="1">Todos</button>`
  );
  for (const t of talls){
    const active = !_modoTodos && selectedTalls.has(t);
    parts.push(
      `<button type="button" class="filtro-tall-btn${active ? " active" : ""}" data-tall="${_escape(t)}">${_escape(t)}</button>`
    );
  }
  filtroBar.innerHTML = parts.join("");
}

filtroBar.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button.filtro-tall-btn");
  if (!btn) return;
  if (btn.dataset.todos === "1"){
    _modoTodos = true;
    selectedTalls.clear();
  } else {
    const t = btn.dataset.tall;
    if (!t) return;
    _modoTodos = false;
    if (selectedTalls.has(t)) selectedTalls.delete(t);
    else selectedTalls.add(t);
    // Si el usuario deselecciono todo manualmente → volvemos a "Todos".
    if (selectedTalls.size === 0) _modoTodos = true;
  }
  renderFiltroBar();
  renderPanel(filtrarTodos(_todosFull), _umbralActual);
});

async function correrFlow(){
  const umbral = Number(umbralInput.value);
  const u = Number.isFinite(umbral) && umbral > 0 ? umbral : UMBRAL_DEFAULT;
  btnRecargar.disabled = true;
  setMyStatus("Cargando lista de talleristas...");
  try{
    // Despiece + PDFs (si carpeta conectada). Tolera errores: sin PDF mapa, %Virg = "—".
    try{ await refrescarPdfYDespiece(); }catch (e){ console.warn("refrescarPdfYDespiece", e); }

    const talls = await waitForTalleristas();
    setMyStatus(`Calculando faltantes (${talls.length} talleristas)...`);
    const todos = await recolectarTodos(talls, u);
    _todosFull = todos;
    _umbralActual = u;
    // Si el set tiene talleristas que ya no existen en el resultado, los limpiamos.
    for (const t of [...selectedTalls]){
      if (!(t in todos)) selectedTalls.delete(t);
    }
    if (selectedTalls.size === 0) _modoTodos = true;
    renderFiltroBar();
    renderPanel(filtrarTodos(todos), u);
    const totalCriticos = Object.values(todos).reduce((s, arr) => s + arr.length, 0);
    setMyStatus(`Listo. ${totalCriticos} items con %Lleno < ${u}% (${talls.length} talleristas).`);
  }catch (e){
    console.error(e);
    setMyStatus("Error: " + (e.message || e));
  }finally{
    btnRecargar.disabled = false;
  }
}

btnRecargar.addEventListener("click", correrFlow);

document.addEventListener("DOMContentLoaded", () => {
  // ControlTall.js dispara cargarTalleristas() en su propio DOMContentLoaded; damos un tick
  // para no competir, despues correrFlow espera con poll.
  setTimeout(correrFlow, 300);
});
