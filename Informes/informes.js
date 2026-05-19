"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const fechaDesde = document.getElementById("fechaDesde");
const fechaHasta = document.getElementById("fechaHasta");
const empGrid = document.getElementById("empGrid");
const selVista = document.getElementById("selVista");
const btnGenerar = document.getElementById("btnGenerar");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const subfiltros = document.getElementById("subfiltros");
const filtroMatrizWrap = document.getElementById("filtroMatrizWrap");
const filtroMatriz = document.getElementById("filtroMatriz");
const selMetrica = document.getElementById("selMetrica");
const fieldFechaRango = document.getElementById("fieldFechaRango");
const tipoGrid = document.getElementById("tipoGrid");

let selectedEmpleados = new Set();
let selectedTipos = new Set();
let empleadosCache = [];
let fpFecha = null;

const TIPOS_MATRIZ = [
  { code: "A", label: "Alimentador" },
  { code: "B", label: "Balancín" },
  { code: "T", label: "Tallerista" },
  { code: "D", label: "Dispositivo" },
  { code: "E", label: "Envasado" },
  { code: "P", label: "Piedra" }
];

/* ================= HELPERS ================= */
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function f(v, d = 0) { return Number(v || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: d }); }
function esc(s) { return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function hs(seg) { return f(seg / 3600, 1); }
function dias85(seg) { return f(seg / 30600, 1); }
function pct(segT, segH) { return segH > 0 ? f((-(segT / segH - 1)) * 100, 0) + "%" : "-"; }
function ptje(segT, segH) { return segH > 0 ? f((-(segT / segH - 1)) * 10, 1) : "-"; }
function ptjeNum(segT, segH) { return segH > 0 ? (-(segT / segH - 1)) * 10 : 0; }
function sueldoPremio(segT, segH) {
  const p = ptjeNum(segT, segH);
  return f(((((p * 10) + 100) - 100) / 2) / 100, 2);
}
function cls(v) { return n(v) > 0 ? "pos" : n(v) < 0 ? "neg" : ""; }
function clsP(segT, segH) { return cls(ptjeNum(segT, segH)); }
function esMatriz(mat) { return /^\d+\w*$/.test(String(mat || "").trim()); }
function esTM(mat) { return !esMatriz(mat) && !["RM", "PM", "RD", "LT", "E"].includes(String(mat || "").trim()); }

/* ================= FETCH PAGINADO ================= */
async function fetchAll(tabla) {
  const all = []; const PAGE = 1000; let from = 0;
  while (true) {
    const { data, error } = await sb.from(tabla).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/* ================= INIT ================= */
async function init() {
  try {
    empleadosCache = await fetchAll("Empleados");
    empleadosCache.sort((a, b) => String(a.Empleado || "").localeCompare(String(b.Empleado || ""), "es"));
    const activos = empleadosCache.filter(e => String(e.Activo).toUpperCase() === "SI" && String(e.Legajo || "").trim() !== "1");
    const inactivos = empleadosCache.filter(e => String(e.Activo).toUpperCase() !== "SI" && String(e.Legajo || "").trim() !== "1");

    // Chips activos
    empGrid.innerHTML =
      `<button type="button" class="emp-chip emp-chip-todos active" data-legajo="__todos__">Todos</button>` +
      activos.map(e => {
        const parts = String(e.Empleado || "").trim().split(/\s+/);
        const linea1 = parts[0] || "";
        const linea2 = parts.slice(1).join(" ");
        return `<button type="button" class="emp-chip" data-legajo="${esc(e.Legajo)}"><span class="emp-chip-l1">${esc(linea1)}</span><span class="emp-chip-l2">${esc(linea2)}</span></button>`;
      }).join("") +
      `<div class="emp-inactivos-wrap">
        <button type="button" class="emp-chip emp-chip-inactivos" id="btnInactivos">Inactivos</button>
        <div id="inactivosDropdown" class="inactivos-dropdown hidden">
          <div id="inactivosGrid" class="inactivos-grid"></div>
        </div>
      </div>`;

    // Inactivos en dropdown
    const inactivosGrid = document.getElementById("inactivosGrid");
    inactivosGrid.innerHTML = inactivos.map(e =>
      `<button type="button" class="inactivo-btn" data-legajo="${esc(e.Legajo)}">${esc(e.Empleado)}</button>`
    ).join("");

    const btnInactivos = document.getElementById("btnInactivos");
    const inactivosDrop = document.getElementById("inactivosDropdown");
    btnInactivos.addEventListener("click", () => inactivosDrop.classList.toggle("hidden"));
    document.addEventListener("click", e => {
      if (!btnInactivos.contains(e.target) && !inactivosDrop.contains(e.target)) inactivosDrop.classList.add("hidden");
    });
    inactivosGrid.querySelectorAll(".inactivo-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const leg = btn.dataset.legajo;
        if (selectedEmpleados.has(leg)) { selectedEmpleados.delete(leg); btn.classList.remove("active"); }
        else { selectedEmpleados.add(leg); btn.classList.add("active"); }
        const btnTodos = empGrid.querySelector('[data-legajo="__todos__"]');
        btnTodos.classList.toggle("active", selectedEmpleados.size === 0);
        if (cachedRows.length) aplicarSubfiltros();
      });
    });

    const btnTodos = empGrid.querySelector('[data-legajo="__todos__"]');
    btnTodos.addEventListener("click", () => {
      selectedEmpleados.clear();
      empGrid.querySelectorAll(".emp-chip").forEach(b => b.classList.remove("active"));
      inactivosGrid.querySelectorAll(".inactivo-btn").forEach(b => b.classList.remove("active"));
      btnTodos.classList.add("active");
      if (cachedRows.length) aplicarSubfiltros();
    });
    empGrid.querySelectorAll('.emp-chip:not([data-legajo="__todos__"])').forEach(btn => {
      btn.addEventListener("click", () => {
        const leg = btn.dataset.legajo;
        if (selectedEmpleados.has(leg)) { selectedEmpleados.delete(leg); btn.classList.remove("active"); }
        else { selectedEmpleados.add(leg); btn.classList.add("active"); }
        btnTodos.classList.toggle("active", selectedEmpleados.size === 0);
        if (cachedRows.length) aplicarSubfiltros();
      });
    });

    filtroMatriz.addEventListener("input", () => {
      if (cachedRows.length) aplicarSubfiltros();
    });
    selMetrica.addEventListener("change", () => {
      if (cachedRows.length) aplicarSubfiltros();
    });

    // Chips de Tipo_Matriz
    tipoGrid.innerHTML =
      `<button type="button" class="tipo-chip tipo-chip-todos active" data-tipo="__todos__">Todos</button>` +
      TIPOS_MATRIZ.map(t =>
        `<button type="button" class="tipo-chip" data-tipo="${esc(t.code)}">${esc(t.code)} – ${esc(t.label)}</button>`
      ).join("");
    const btnTipoTodos = tipoGrid.querySelector('[data-tipo="__todos__"]');
    btnTipoTodos.addEventListener("click", () => {
      selectedTipos.clear();
      tipoGrid.querySelectorAll(".tipo-chip").forEach(b => b.classList.remove("active"));
      btnTipoTodos.classList.add("active");
      if (cachedRows.length) aplicarSubfiltros();
    });
    tipoGrid.querySelectorAll('.tipo-chip:not([data-tipo="__todos__"])').forEach(btn => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.tipo;
        if (selectedTipos.has(t)) { selectedTipos.delete(t); btn.classList.remove("active"); }
        else { selectedTipos.add(t); btn.classList.add("active"); }
        btnTipoTodos.classList.toggle("active", selectedTipos.size === 0);
        if (cachedRows.length) aplicarSubfiltros();
      });
    });
    // Fecha de hoy en horario local (sin tz shift por toISOString que puede saltar dia)
    const hoyLocal = new Date();
    const yyyy = hoyLocal.getFullYear();
    const mm = String(hoyLocal.getMonth() + 1).padStart(2, '0');
    const dd = String(hoyLocal.getDate()).padStart(2, '0');
    const hoyIso = yyyy + '-' + mm + '-' + dd;
    fechaHasta.value = hoyIso;
    fechaDesde.value = hoyIso;

    // Flatpickr rango
    fpFecha = flatpickr("#fechaRango", {
      mode: "range",
      dateFormat: "d/m/Y",
      locale: "es",
      onChange: function(dates) {
        if (dates.length === 2) {
          const toIso = (d) => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
          fechaDesde.value = toIso(dates[0]);
          fechaHasta.value = toIso(dates[1]);
        } else if (dates.length === 1) {
          const iso = dates[0].getFullYear() + '-' + String(dates[0].getMonth()+1).padStart(2,'0') + '-' + String(dates[0].getDate()).padStart(2,'0');
          fechaDesde.value = iso;
          fechaHasta.value = iso;
        }
      }
    });
    // Setear rango [hoy, hoy] de forma explicita (mas confiable que defaultDate)
    fpFecha.setDate([hoyLocal, hoyLocal], false);

  } catch (err) { statusEl.textContent = "Error: " + err.message; }
}

/* ================= GENERAR ================= */
let cachedRows = [];
let empMap = new Map();
let matMap = new Map();
let currentVista = "";
let exportTitleOverride = "";

btnGenerar.addEventListener("click", async () => {
  currentVista = selVista.value;
  exportTitleOverride = "";

  // ===== Vista matriz2 (Rendimiento x Matriz 2.0) — embed rendimiento.html via iframe =====
  if (currentVista === "matriz2") {
    subfiltros.classList.add("hidden");
    document.getElementById("btnExcelInf").classList.add("hidden");
    document.getElementById("btnPDFInf").classList.add("hidden");
    document.getElementById("btnPDFDiario").classList.add("hidden");
    statusEl.textContent = "";
    resultEl.innerHTML = `
      <iframe src="../Produccion/rendimiento.html?embed=1"
              style="width:100%;height:900px;border:0;border-radius:14px;display:block;background:#d9d9de"
              title="Rendimiento x Matriz 2.0"></iframe>
    `;
    return;
  }

  const desde = fechaDesde.value, hasta = fechaHasta.value;
  const esUnidades = currentVista === "unidades";
  if (!esUnidades && (!desde || !hasta)) { alert("Selecciona rango de fechas"); return; }

  // Reset subfiltros
  selectedEmpleados.clear();
  empGrid.querySelectorAll(".emp-chip").forEach(b => b.classList.remove("active"));
  const btnT = empGrid.querySelector('[data-legajo="__todos__"]');
  if (btnT) btnT.classList.add("active");
  const inactivosGrid = document.getElementById("inactivosGrid");
  if (inactivosGrid) inactivosGrid.querySelectorAll(".inactivo-btn").forEach(b => b.classList.remove("active"));
  filtroMatriz.value = "";
  selectedTipos.clear();
  tipoGrid.querySelectorAll(".tipo-chip").forEach(b => b.classList.remove("active"));
  const btnTT = tipoGrid.querySelector('[data-tipo="__todos__"]');
  if (currentVista === "piedra" || currentVista === "rdiario") {
    if (btnTT) btnTT.classList.add("active");
  } else {
    TIPOS_MATRIZ.forEach(t => {
      if (t.code === "P") return;
      selectedTipos.add(t.code);
      const b = tipoGrid.querySelector(`[data-tipo="${t.code}"]`);
      if (b) b.classList.add("active");
    });
  }

  btnGenerar.disabled = true;
  statusEl.textContent = "Cargando datos...";
  resultEl.innerHTML = "";

  try {
    const esMensajes = currentVista === "mensajes";
    let rows = await fetchAll("db_n8n_espejo");
    console.log("Total registros cargados:", rows.length);

    if (esUnidades) {
      // Para unidades x matriz: cargar todo sin filtro de fecha, solo excluir eliminados y legajo 1
      cachedRows = rows.filter(r => !r.Eliminar && String(r.Legajo || "").trim() !== "1");
    } else {
      const desdeD = new Date(desde + "T00:00:00-03:00");
      const hastaD = new Date(hasta + "T23:59:59-03:00");
      cachedRows = rows.filter(r => {
        const ff = new Date(r.Fecha);
        return ff >= desdeD && ff <= hastaD && !r.Eliminar && String(r.Legajo || "").trim() !== "1";
      });
    }

    console.log("Registros en rango:", cachedRows.length);

    empMap = new Map();
    empleadosCache.forEach(e => empMap.set(String(e.Legajo || "").trim(), e));

    const matCache = await fetchAll("Matrices");
    matMap = new Map();
    matCache.forEach(m => matMap.set(String(m.N_Matriz || "").trim(), m));

    // Mostrar subfiltros (mensajes: solo chips de empleados, sin tipo/filtroMatriz)
    subfiltros.classList.toggle("hidden", esUnidades);
    filtroMatrizWrap.classList.toggle("hidden", currentVista !== "matriz");
    const tipoWrap = document.getElementById("tipoMatrizWrap");
    if (tipoWrap) tipoWrap.style.display = esMensajes ? "none" : "";

    statusEl.textContent = `Cargado. Vista: ${currentVista}`;
    aplicarSubfiltros();
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    console.error(err);
  }
  finally { btnGenerar.disabled = false; }
});

function aplicarSubfiltros() {
  const selLegs = [...selectedEmpleados];
  let rows = [...cachedRows];
  const esMensajes = currentVista === "mensajes";

  if (selLegs.length > 0) {
    const legSet = new Set(selLegs);
    rows = rows.filter(r => legSet.has(String(r.Legajo || "").trim()));
  } else {
    const activosSet = new Set(empleadosCache.filter(e => String(e.Activo).toUpperCase() === "SI").map(e => String(e.Legajo).trim()));
    rows = rows.filter(r => activosSet.has(String(r.Legajo || "").trim()));
  }

  if (!esMensajes && selectedTipos.size > 0) {
    rows = rows.filter(r => {
      const matId = String(r.Matriz || "").trim();
      if (!esMatriz(matId)) return true;
      const info = matMap.get(matId);
      const tipo = info ? String(info.Tipo_Matriz || "").trim() : "";
      return selectedTipos.has(tipo);
    });
  }

  const matFiltroRaw = (filtroMatriz.value || "").trim().toLowerCase();
  if (matFiltroRaw) {
    const hasComma = matFiltroRaw.includes(",");
    const filtros = hasComma ? matFiltroRaw.split(",").map(f => f.trim()).filter(f => f) : [matFiltroRaw];
    rows = rows.filter(r => {
      const mat = String(r.Matriz || "").trim().toLowerCase();
      const desc = String(r.Nombre_Matriz || "").toLowerCase();
      const info = matMap.get(String(r.Matriz || "").trim());
      const descMap = info ? String(info.Matriz || "").toLowerCase() : "";
      if (hasComma) return filtros.some(f => mat === f);
      return mat.includes(matFiltroRaw) || desc.includes(matFiltroRaw) || descMap.includes(matFiltroRaw);
    });
  }

  if (!rows.length) {
    statusEl.textContent = "Sin datos";
    resultEl.innerHTML = '<p style="color:#888;padding:20px;">No se encontraron registros.</p>';
    return;
  }

  if (currentVista === "piedra") renderPiedra(rows, empMap);
  else if (currentVista === "persona") renderPersona(rows, empMap);
  else if (currentVista === "operario") renderOperario(rows, empMap, matMap);
  else if (currentVista === "unidades") renderUnidadesMatriz(rows, matMap);
  else if (currentVista === "rdiario") renderReporteDiario(rows, empMap, matMap);
  else if (currentVista === "mensajes") renderMensajesCrudos(rows, empMap, matMap);
  else renderMatriz(rows, empMap, matMap);

  statusEl.textContent = `${rows.length} registros analizados`;
  showExportBtns();
}

/* =================================================================
   VISTA 1: RENDIMIENTO X PERSONA
   Agrupado por sede. Columnas: Leg, Empleado, Ptos, %, Seg Trab,
   Seg Prom, [TMs desglosados], Seg Anulados, % Sueldo Puntaje,
   Total dias, Horas, Sede
   ================================================================= */
function renderPersona(rows, empMap) {
  const byLeg = new Map();

  function ensure(leg) {
    if (!byLeg.has(leg)) {
      const emp = empMap.get(leg) || {};
      byLeg.set(leg, {
        legajo: leg, nombre: emp.Empleado || "", sede: emp.Sede || "",
        segTrab: 0, segHist: 0, uni: 0, segAnulados: 0,
        segTotal: 0, roturas: 0, tm: new Map()
      });
    }
    return byLeg.get(leg);
  }

  rows.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    const g = ensure(leg);
    const mat = String(r.Matriz || "").trim();
    const seg = n(r.Segundos_Trabajados);
    const anulado = r.Anular_Tiempo === true;

    if (esMatriz(mat) && n(r.Uni) > 0) {
      if (!anulado) {
        g.segTrab += seg;
        g.segHist += n(r.Segundos_Historico);
        g.uni += n(r.Uni);
      } else {
        g.segAnulados += seg;
      }
      g.segTotal += seg;
    } else if (mat.startsWith("RM")) {
      g.roturas++;
      g.segTotal += seg;
    } else if (!esMatriz(mat) && mat !== "E" && mat !== "LT") {
      const code = mat.split(" ")[0];
      g.tm.set(code, (g.tm.get(code) || 0) + seg);
      g.segTotal += seg;
    }
  });

  // Recoger TM codes
  const tmCodes = new Set();
  byLeg.forEach(g => g.tm.forEach((_, k) => tmCodes.add(k)));
  const tmSorted = [...tmCodes].sort();

  // Ordenar por puntaje desc (sin separar por sede)
  const emps = [...byLeg.values()].sort((a, b) => ptjeNum(b.segTrab, b.segHist) - ptjeNum(a.segTrab, a.segHist));

  let html = `
  <div class="informe-wrap">
    <div class="informe-title">Rendimiento x Persona</div>
    <div class="informe-scroll">
      <table class="tbl">
        <thead>
          <tr>
            <th rowspan="2">Leg</th><th rowspan="2">Empleado</th>
            <th colspan="2">Puntaje</th>
            <th colspan="2">Segundos</th>
            ${tmSorted.map(c => `<th rowspan="2">${esc(c)}</th>`).join("")}
            <th rowspan="2">Seg<br>Anul</th>
            <th rowspan="2">%<br>Puntaje</th>
            <th rowspan="2">Dias</th>
            <th rowspan="2">Horas</th>
            <th rowspan="2">Rot<br>Mat</th>
          </tr>
          <tr>
            <th>Ptos</th><th>%</th><th>Trab</th><th>Prom</th>
          </tr>
        </thead>
        <tbody>`;

  emps.forEach(g => {
    const p = ptjeNum(g.segTrab, g.segHist);
    html += `<tr>
      <td class="c b">${esc(g.legajo)}</td>
      <td>${esc(g.nombre)}</td>
      <td class="c b ${cls(p)}">${ptje(g.segTrab, g.segHist)}</td>
      <td class="c ${cls(p)}">${pct(g.segTrab, g.segHist)}</td>
      <td class="r">${g.segTrab > 0 ? f(g.segTrab) : "-"}</td>
      <td class="r">${g.segHist > 0 ? f(g.segHist) : "-"}</td>
      ${tmSorted.map(c => {
        const s = g.tm.get(c) || 0;
        return `<td class="r">${s > 0 ? hs(s) : ""}</td>`;
      }).join("")}
      <td class="r">${g.segAnulados > 0 ? f(g.segAnulados) : ""}</td>
      <td class="c">${g.segHist > 0 ? sueldoPremio(g.segTrab, g.segHist) : "-"}</td>
      <td class="r">${g.segTotal > 0 ? dias85(g.segTotal) : "-"}</td>
      <td class="r">${g.segTotal > 0 ? hs(g.segTotal) : "-"}</td>
      <td class="c">${g.roturas || ""}</td>
    </tr>`;
  });

  html += `</tbody></table></div></div>`;

  resultEl.innerHTML = html;
}

/* =================================================================
   VISTA 2: PRODUCCION X OPERARIO
   Por cada operario: resumen + tabla de matrices con
   Hs Trabajo, Hs Promedio, Uni Fab, Seg x Uni, Seg Prom, Puntaje
   ================================================================= */
function renderOperario(rows, empMap, matMap) {
  const byLeg = new Map();
  rows.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    if (!byLeg.has(leg)) byLeg.set(leg, []);
    byLeg.get(leg).push(r);
  });

  let html = "";

  byLeg.forEach((empRows, leg) => {
    const emp = empMap.get(leg) || {};
    const nombre = emp.Empleado || leg;

    // Solo cajones con matriz numerica
    const cajones = empRows.filter(r => esMatriz(String(r.Matriz || "").trim()) && n(r.Uni) > 0 && r.Anular_Tiempo !== true);
    const tmRows = empRows.filter(r => !esMatriz(String(r.Matriz || "").trim()));

    // Por matriz
    const byMat = new Map();
    cajones.forEach(r => {
      const mat = String(r.Matriz || "").trim();
      if (!byMat.has(mat)) byMat.set(mat, { segTrab: 0, segHist: 0, uni: 0, cajones: 0 });
      const g = byMat.get(mat);
      g.segTrab += n(r.Segundos_Trabajados);
      g.segHist += n(r.Segundos_Historico);
      g.uni += n(r.Uni);
      g.cajones++;
    });

    // Totales
    const totSegT = cajones.reduce((s, r) => s + n(r.Segundos_Trabajados), 0);
    const totSegH = cajones.reduce((s, r) => s + n(r.Segundos_Historico), 0);
    const totUni = cajones.reduce((s, r) => s + n(r.Uni), 0);
    const totSegTM = tmRows.reduce((s, r) => s + n(r.Segundos_Trabajados), 0);

    const sorted = [...byMat.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));

    html += `
    <div class="resumen">
      <div class="resumen-card"><div class="val">${esc(nombre)}</div><div class="lbl">Legajo ${esc(leg)}</div></div>
      <div class="resumen-card"><div class="val ${clsP(totSegT, totSegH)}">${ptje(totSegT, totSegH)}</div><div class="lbl">Puntaje</div></div>
      <div class="resumen-card"><div class="val">${hs(totSegT)}</div><div class="lbl">Hs Productivas</div></div>
      <div class="resumen-card"><div class="val">${hs(totSegTM)}</div><div class="lbl">Hs No Productivas</div></div>
      <div class="resumen-card"><div class="val">${f(totUni)}</div><div class="lbl">Unidades</div></div>
    </div>
    <div class="informe-wrap" style="margin-bottom:20px;">
      <div class="informe-title">${esc(nombre)} — Detalle por Matriz</div>
      <div class="informe-scroll">
        <table class="tbl">
          <thead><tr>
            <th>Cod</th><th>Descripcion</th><th>Cajones</th><th>Hs Trab</th><th>Hs Prom</th><th>Uni Fab</th><th>Seg x Uni</th><th>Seg Prom</th><th>Puntaje</th>
          </tr></thead>
          <tbody>`;

    sorted.forEach(([mat, g]) => {
      const info = matMap.get(mat);
      const nombre_mat = info?.Matriz || "";
      const tHist = n(info?.Tiempo_Historico);
      const segXUni = g.uni > 0 ? g.segTrab / g.uni : 0;
      const p = ptjeNum(g.segTrab, g.segHist);

      html += `<tr>
        <td class="c b">${esc(mat)}</td>
        <td>${esc(nombre_mat)}</td>
        <td class="c">${g.cajones}</td>
        <td class="r">${hs(g.segTrab)}</td>
        <td class="r">${hs(g.segHist)}</td>
        <td class="r b">${f(g.uni)}</td>
        <td class="r">${f(segXUni, 2)}</td>
        <td class="r">${f(tHist, 2)}</td>
        <td class="c b ${cls(p)}">${f(p, 1)}</td>
      </tr>`;
    });

    // TMs desglosados
    const tmByCode = new Map();
    tmRows.forEach(r => {
      const code = String(r.Matriz || "").trim().split(" ")[0];
      tmByCode.set(code, (tmByCode.get(code) || 0) + n(r.Segundos_Trabajados));
    });

    if (tmByCode.size > 0) {
      html += `<tr class="sep"><td colspan="9" style="font-weight:700;padding:8px;">Tiempos Muertos</td></tr>`;
      [...tmByCode.entries()].sort((a, b) => b[1] - a[1]).forEach(([code, seg]) => {
        html += `<tr style="color:#666;">
          <td class="c">${esc(code)}</td><td colspan="2"></td>
          <td class="r">${hs(seg)}</td><td colspan="5"></td>
        </tr>`;
      });
    }

    html += `</tbody></table></div></div>`;
  });

  resultEl.innerHTML = html;
}

/* =================================================================
   VISTA 2.5: RENDIMIENTO PIEDRA (Tabla cruzada)
   Filas = Fechas, Columnas = Empleados (Kg | Hs Conv | Kg 8.5hs)
   ================================================================= */
function renderPiedra(rows, empMap) {
  try {
    // Solo registros de Piedra (Matriz = "501")
    const piedra = rows.filter(r => String(r.Matriz || "").trim() === "501" && n(r.Uni) > 0);

    // Registros de otros sectores para calcular tiempo fuera (excluir Baño, Mov P y Almuerzo)
    const otrosSectores = rows.filter(r => {
      const mat = String(r.Matriz || "").trim();
      const matLower = mat.toLowerCase();
      return mat !== "501" &&
             !matLower.includes("baño") &&
             !matLower.includes("almuerzo") &&
             mat !== "Mov P" &&
             !matLower.includes("mov p");
    });

    if (!piedra.length) {
      resultEl.innerHTML = '<p style="color:#888;padding:20px;">No hay registros de Piedra.</p>';
      return;
    }

  // Agrupar por fecha y empleado
  const porFecha = new Map();
  const empleados = new Set();

  piedra.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    const fecha = r.Fecha ? String(r.Fecha).split('T')[0] : '-';

    empleados.add(leg);

    if (!porFecha.has(fecha)) {
      porFecha.set(fecha, new Map());
    }
    const diaMap = porFecha.get(fecha);

    if (!diaMap.has(leg)) {
      diaMap.set(leg, { kg: 0, segPiedra: 0, dia: r.Dia, registros: [] });
    }
    const entry = diaMap.get(leg);
    entry.kg += n(r.Uni);
    entry.segPiedra += n(r.Segundos_Trabajados);
    entry.registros.push(r);
  });

  // Obtener solo empleados que tienen registros de Piedra
  const empleadosList = Array.from(empleados)
    .map(leg => ({ leg, emp: empMap.get(leg) }))
    .filter(({ leg }) => {
      // Verificar que el empleado tiene al menos un registro en las fechas
      return Array.from(porFecha.values()).some(diaMap => diaMap.has(leg));
    })
    .sort((a, b) => String(a.emp?.Empleado || a.leg).localeCompare(String(b.emp?.Empleado || b.leg).trim(), "es"));

  // Headers
  let html = `<div class="informe-wrap">
    <div class="informe-title" style="display:flex;justify-content:space-between;align-items:center;">
      <span>Rendimiento Piedra — KG por Empleado</span>
      <button class="btn btn-dark" id="btnOptimizarPiedra" style="margin:0;padding:8px 12px;font-size:12px;">Optimizar</button>
    </div>
    <div class="informe-scroll">
      <table class="tbl">
        <thead>
          <tr>
            <th rowspan="2">Fecha</th>`;

  empleadosList.forEach((_, i) => {
    const nombre = String(empleadosList[i].emp?.Empleado || empleadosList[i].leg).trim();
    const isFinal = i === empleadosList.length - 1;
    html += `<th colspan="3" class="c ${isFinal ? '' : 'piedra-sep'}">${esc(nombre)}</th>`;
  });

  html += `</tr><tr>`;
  empleadosList.forEach((_, i) => {
    const isFinal = i === empleadosList.length - 1;
    html += `<th class="r c piedra-col-kg" style="font-size:11px;">Kg</th>
             <th class="r c piedra-col-hsconv" style="font-size:11px;">Hs Conv</th>
             <th class="r c piedra-col-kg85 ${isFinal ? '' : 'piedra-sep'}" style="font-size:12px;font-weight:900;">Kg 8.5hs</th>`;
  });
  html += `</tr></thead><tbody>`;

  // Filas por fecha
  const fechasOrdenadas = Array.from(porFecha.keys()).sort();

  fechasOrdenadas.forEach(fecha => {
    const [year, month, day] = (fecha || '-').split('-');
    const fechaCorta = fecha === '-' ? '-' : `${day}/${month}`;
    const diaMap = porFecha.get(fecha);

    html += `<tr><td>${fechaCorta}</td>`;

    empleadosList.forEach(({ leg }) => {
      const entry = diaMap.get(leg);

      if (!entry) {
        html += `<td class="r">-</td><td class="r">-</td><td class="r">-</td>`;
        return;
      }

      // Calcular Hs Conv = tiempo en otros sectores del mismo día
      const hsfueraRegistros = otrosSectores.filter(r =>
        String(r.Legajo || "").trim() === leg && n(r.Dia) === entry.dia
      );
      const segFuera = hsfueraRegistros.reduce((sum, r) => sum + n(r.Segundos_Trabajados), 0);
      const hsConv = segFuera / 3600;

      const kg = entry.kg;
      const hsPiedra = entry.segPiedra / 3600;

      // Kg 8.5hs = KG / (8.5 - Hs Conv) × 8.5
      const tiempoDisponible = 8.5 - hsConv;
      const kg85 = tiempoDisponible > 0 ? (kg / tiempoDisponible) * 8.5 : 0;

      const isFinal = empleadosList.indexOf(empleadosList.find(e => e.leg === leg)) === empleadosList.length - 1;

      html += `<td class="r piedra-col-kg">${f(kg, 1)}</td>
               <td class="r piedra-col-hsconv">${f(hsConv, 2)}</td>
               <td class="r kg85 ${kg85 > kg ? 'pos' : 'neg'} piedra-col-kg85 ${isFinal ? '' : 'piedra-sep'}">${f(kg85, 1)}</td>`;
    });

    html += `</tr>`;
  });

    html += `</tbody></table></div></div>`;
    resultEl.innerHTML = html;

    // Agregar evento al botón Optimizar
    const btnOpt = resultEl.querySelector("#btnOptimizarPiedra");
    if (btnOpt) {
      btnOpt.addEventListener("click", () => {
        const tbl = resultEl.querySelector(".tbl");
        tbl.classList.toggle("piedra-optimizar");
        btnOpt.textContent = tbl.classList.contains("piedra-optimizar") ? "Ver Todos" : "Optimizar";
      });
    }
  } catch (err) {
    console.error("Error renderizando Piedra:", err);
    resultEl.innerHTML = `<p style="color:red;padding:20px;">Error: ${esc(err.message)}</p>`;
  }
}

/* =================================================================
   VISTA 3: RENDIMIENTO X MATRIZ (tabla cruzada)
   Filas = matrices, Columnas = empleados
   Celda = Seg x Uni de ese empleado en esa matriz
   ================================================================= */
function renderMatriz(rows, empMap, matMap) {
  // Solo cajones con matriz numerica, no anulados, EXCLUIR Piedra (501)
  const cajones = rows.filter(r => {
    const mat = String(r.Matriz || "").trim();
    return esMatriz(mat) && mat !== "501" && n(r.Uni) > 0 && r.Anular_Tiempo !== true;
  });

  // Empleados unicos
  const empSet = new Set();
  cajones.forEach(r => empSet.add(String(r.Legajo || "").trim()));
  const empleados = [...empSet].sort((a, b) => {
    const na = empMap.get(a)?.Empleado || a;
    const nb = empMap.get(b)?.Empleado || b;
    return na.localeCompare(nb, "es");
  });

  // Matrices unicas
  const matSet = new Set();
  cajones.forEach(r => matSet.add(String(r.Matriz || "").trim()));
  const matrices = [...matSet].sort((a, b) => Number(a) - Number(b));

  // Agrupar: mat+leg → { segTrab, uni }
  const data = new Map();
  cajones.forEach(r => {
    const mat = String(r.Matriz || "").trim();
    const leg = String(r.Legajo || "").trim();
    const key = `${mat}__${leg}`;
    if (!data.has(key)) data.set(key, { segTrab: 0, uni: 0 });
    const g = data.get(key);
    g.segTrab += n(r.Segundos_Trabajados);
    g.uni += n(r.Uni);
  });

  // Hs total por empleado
  const hsTotalByEmp = new Map();
  empleados.forEach(leg => {
    let total = 0;
    matrices.forEach(mat => {
      const g = data.get(`${mat}__${leg}`);
      if (g) total += g.segTrab;
    });
    hsTotalByEmp.set(leg, total);
  });

  const metrica = selMetrica ? selMetrica.value : "ambos";
  const showSeg = metrica === "segxuni" || metrica === "ambos";
  const showPremio = metrica === "premio" || metrica === "ambos";
  const subCols = (showSeg ? 1 : 0) + (showPremio ? 1 : 0);

  const pocasCols = empleados.length * subCols <= 3;

  // Titulo dinamico
  const tituloMetrica = metrica === "ambos" ? "Seg x Uni y Puntaje" : metrica === "segxuni" ? "Seg x Uni" : "Puntaje";

  let html = `
  <div class="informe-wrap">
    <div class="informe-title">Rendimiento x Matriz — ${esc(tituloMetrica)} por Empleado</div>
    <div class="informe-scroll">
      <table class="tbl" ${pocasCols ? 'style="width:auto;"' : ''}>
        <thead>
          <tr>
            <th ${metrica === "ambos" ? 'rowspan="2"' : ''}>N</th>
            <th ${metrica === "ambos" ? 'rowspan="2"' : ''}>Matriz</th>
            <th ${metrica === "ambos" ? 'rowspan="2"' : ''}>Seg<br>Prom</th>
            ${empleados.map(leg => {
              const full = empMap.get(leg)?.Empleado || leg;
              const parts = String(full).trim().split(/\s+/);
              const l1 = parts[0] || "";
              const l2 = parts.slice(1).join(" ");
              const label = `${esc(l1)}<br><span style="font-weight:400;font-size:11px;">${esc(l2)}</span>`;
              return metrica === "ambos"
                ? `<th colspan="2">${label}</th>`
                : `<th>${label}</th>`;
            }).join("")}
          </tr>
          ${metrica === "ambos" ? `<tr>${empleados.map(() => `<th>Seg</th><th>Ptje</th>`).join("")}</tr>` : ""}
        </thead>
        <tbody>`;

  matrices.forEach(mat => {
    const info = matMap.get(mat);
    const nombre = info?.Matriz || "";
    const tHist = n(info?.Tiempo_Historico);

    html += `<tr>
      <td class="c b">${esc(mat)}</td>
      <td>${esc(nombre)}</td>
      <td class="r b">${tHist > 0 ? f(tHist, 2) : ""}</td>`;

    empleados.forEach(leg => {
      const g = data.get(`${mat}__${leg}`);
      if (g && g.uni > 0) {
        const segXUni = g.segTrab / g.uni;
        const colorSeg = tHist > 0 ? (segXUni <= tHist ? "pos" : "neg") : "";
        const premio = tHist > 0 ? (-(segXUni / tHist - 1)) * 10 : 0;
        const colorPrem = cls(premio);
        if (showSeg) html += `<td class="r ${colorSeg}">${f(segXUni, 2)}</td>`;
        if (showPremio) html += `<td class="c b ${colorPrem}">${f(premio, 1)}</td>`;
      } else {
        if (showSeg) html += `<td></td>`;
        if (showPremio) html += `<td></td>`;
      }
    });

    html += `</tr>`;
  });

  // Fila HS TOTAL
  html += `<tr class="sep">
    <td></td><td class="b">HS TOTAL</td><td></td>
    ${empleados.map(leg => {
      const h = `<td class="r b">${hs(hsTotalByEmp.get(leg) || 0)}</td>`;
      return showSeg && showPremio ? h + `<td></td>` : h;
    }).join("")}
  </tr>`;

  html += `</tbody></table></div></div>`;
  resultEl.innerHTML = html;

  // Agregar event listeners a las celdas de datos de empleados.
  // subCols = 1 (solo Seg o solo Ptje) o 2 (ambos). Cuando ambos,
  // cada empleado ocupa 2 columnas (Seg + Ptje); hay que dividir
  // por subCols para mapear la columna clickeada al indice de empleado.
  const filasDatos = resultEl.querySelectorAll(".informe-scroll tbody tr:not(.sep)");
  filasDatos.forEach(tr => {
    const celdasTr = Array.from(tr.children);
    celdasTr.forEach((celda, colIdx) => {
      // Las primeras 3 columnas (N, Matriz, Seg Prom) no son de empleados
      if (colIdx < 3) return;
      const empleadoIdx = Math.floor((colIdx - 3) / subCols);
      if (empleadoIdx < 0 || empleadoIdx >= empleados.length) return;
      // No clickear celdas vacias (empleado sin datos en esa matriz)
      if (!celda.textContent.trim()) return;
      celda.style.cursor = "pointer";
      celda.addEventListener("click", async () => {
        const matNum = tr.querySelector("td:nth-child(1)")?.textContent?.trim();
        const legajo = empleados[empleadoIdx];
        await mostrarDetalles(matNum, legajo);
      });
    });
  });
}

async function mostrarDetalles(matriz, legajo) {
  const modal = document.getElementById("detallesModal");
  const titulo = document.getElementById("detallesTitle");
  const body = document.getElementById("detallesBody");
  const totUni = document.getElementById("detallesTotalUni");
  const totSeg = document.getElementById("detallesTotalSeg");
  const totSegXUni = document.getElementById("detallesTotalSegXUni");

  const emp = empMap.get(legajo);
  const mat = matMap.get(matriz);
  titulo.textContent = `${esc(emp?.Empleado || legajo)} - Matriz ${esc(matriz)} (${esc(mat?.Matriz || "")})`;

  try {
    // Cargar registros de db_n8n_espejo para esta matriz + legajo.
    // Fecha es timestamptz: si pasamos solo "YYYY-MM-DD" PostgreSQL lo
    // interpreta como 00:00 UTC, lo cual excluye registros del ultimo dia
    // del rango (ej. un cajon cargado a las 15:00 ART = 18:00 UTC queda
    // fuera de `<= 2026-04-16`). Usamos bordes con TZ ART (-03) para que
    // coincida con el filtro que arma la tabla (aplicarSubfiltros).
    const { data, error } = await sb.from("db_n8n_espejo")
      .select("*")
      .eq("Legajo", legajo)
      .eq("Matriz", matriz)
      .gte("Fecha", fechaDesde.value + "T00:00:00-03:00")
      .lte("Fecha", fechaHasta.value + "T23:59:59-03:00")
      .order("Fecha", { ascending: true })
      .order("Hora_Inicio", { ascending: true });

    if (error || !data) throw new Error(error?.message || "Sin datos");

    let totalUni = 0, totalSeg = 0;
    body.innerHTML = data.map((r, i) => {
      const uni = n(r.Uni);
      const seg = n(r.Segundos_Trabajados);
      totalUni += uni;
      totalSeg += seg;
      const segXUni = uni > 0 ? seg / uni : 0;
      const fechaStr = r.Fecha ? String(r.Fecha).split('T')[0] : '-';
      const [year, month, day] = fechaStr.split('-');
      const fecha = fechaStr === '-' ? '-' : `${day}/${month}`;
      const horaInicio = r.Hora_Inicio ? String(r.Hora_Inicio).substring(0, 5) : '-';
      const horaFin = r.Hora_Fin ? String(r.Hora_Fin).substring(0, 5) : '-';
      return `<tr>
        <td>${i + 1}</td>
        <td>${fecha}</td>
        <td>${horaInicio}</td>
        <td>${horaFin}</td>
        <td class="r">${f(uni)}</td>
        <td class="r">${f(seg)}</td>
        <td class="r">${f(segXUni, 2)}</td>
      </tr>`;
    }).join("");

    const segXUniTotal = totalUni > 0 ? totalSeg / totalUni : 0;
    totUni.textContent = f(totalUni);
    totSeg.textContent = f(totalSeg);
    totSegXUni.textContent = f(segXUniTotal, 2);

    modal.classList.remove("hidden");
  } catch (err) {
    alert("Error cargando detalles: " + err.message);
  }
}

/* =================================================================
   VISTA 5: UNIDADES x MATRIZ (dias productivos)
   Muestra la cantidad total de unidades por matriz, contando solo
   los dias en que hubo al menos 1 registro de produccion.
   El usuario define cuantos dias productivos mirar hacia atras.
   ================================================================= */
function renderUnidadesMatriz(rows, matMap) {
  // Solo registros de cajones con unidades > 0
  const prodRows = rows.filter(r => esMatriz(r.Matriz) && n(r.Uni) > 0);

  // Obtener dias productivos unicos (por fecha YYYY-MM-DD), excluyendo fines de semana
  const diasSet = new Set();
  const diasFindeSet = new Set();
  prodRows.forEach(r => {
    const fecha = String(r.Fecha || "").substring(0, 10);
    if (!fecha) return;
    const dow = new Date(fecha + "T12:00:00").getDay();
    if (dow === 0 || dow === 6) {
      diasFindeSet.add(fecha);
    } else {
      diasSet.add(fecha);
    }
  });
  const diasOrdenados = [...diasSet].sort().reverse(); // mas reciente primero (solo L-V)
  const totalDiasProd = diasOrdenados.length;

  const diasDefault = Math.min(totalDiasProd, 22);

  let html = `<div class="informe-wrap">
    <div class="informe-title">Unidades por Matriz - Dias Productivos</div>
    <div style="margin:10px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="display:inline-flex;border:2px solid #111;border-radius:8px;overflow:hidden">
        <button type="button" id="btnModoDias" style="padding:6px 14px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:#111;color:#fff">Dias productivos</button>
        <button type="button" id="btnModoFecha" style="padding:6px 14px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:#fff;color:#111">Por fecha</button>
      </div>
      <div id="wrapModoDias" style="display:flex;align-items:center;gap:8px">
        <label style="font-weight:600">Ultimos</label>
        <input type="number" id="inputDiasProd" value="${diasDefault}" min="1" max="${totalDiasProd}" style="width:60px;height:32px;border:1px solid #ccc;border-radius:6px;text-align:center;font-size:14px" />
        <span style="color:#888;font-size:13px">(hay ${totalDiasProd} dias)</span>
      </div>
      <div id="wrapModoFecha" style="display:none;align-items:center;gap:8px">
        <input type="text" id="inputFechaUni" placeholder="Seleccionar rango..." style="width:220px;height:32px;border:1px solid #ccc;border-radius:6px;padding:0 8px;font-size:13px" />
      </div>
    </div>
    <div id="tablaUnidadesWrap"></div>
  </div>`;

  resultEl.innerHTML = html;

  const inputDias = document.getElementById("inputDiasProd");
  const wrapDias = document.getElementById("wrapModoDias");
  const wrapFecha = document.getElementById("wrapModoFecha");
  const btnModoDias = document.getElementById("btnModoDias");
  const btnModoFecha = document.getElementById("btnModoFecha");
  const inputFecha = document.getElementById("inputFechaUni");
  const wrap = document.getElementById("tablaUnidadesWrap");

  let fechaDesdeUni = null;
  let fechaHastaUni = null;
  let usandoFecha = false;

  btnModoDias.addEventListener("click", () => {
    usandoFecha = false;
    wrapDias.style.display = "flex";
    wrapFecha.style.display = "none";
    btnModoDias.style.background = "#111";
    btnModoDias.style.color = "#fff";
    btnModoFecha.style.background = "#fff";
    btnModoFecha.style.color = "#111";
    generarTabla();
  });

  btnModoFecha.addEventListener("click", () => {
    usandoFecha = true;
    wrapDias.style.display = "none";
    wrapFecha.style.display = "flex";
    btnModoFecha.style.background = "#111";
    btnModoFecha.style.color = "#fff";
    btnModoDias.style.background = "#fff";
    btnModoDias.style.color = "#111";
    if (fechaDesdeUni && fechaHastaUni) generarTabla();
  });

  const fpUni = flatpickr(inputFecha, {
    mode: "range",
    dateFormat: "Y-m-d",
    locale: "es",
    onChange: function(selectedDates) {
      if (selectedDates.length === 2) {
        fechaDesdeUni = selectedDates[0];
        fechaHastaUni = selectedDates[1];
        generarTabla();
      }
    }
  });

  function generarTabla() {
    let diasSeleccionados;
    let cantDias;

    if (usandoFecha && fechaDesdeUni && fechaHastaUni) {
      const desde = fechaDesdeUni.toISOString().substring(0, 10);
      const hasta = fechaHastaUni.toISOString().substring(0, 10);
      diasSeleccionados = new Set(diasOrdenados.filter(d => d >= desde && d <= hasta));
      cantDias = diasSeleccionados.size;
    } else if (usandoFecha) {
      wrap.innerHTML = '<p style="color:#888;padding:10px">Selecciona un rango de fechas</p>';
      return;
    } else {
      cantDias = Math.max(1, Math.min(n(inputDias.value), totalDiasProd));
      diasSeleccionados = new Set(diasOrdenados.slice(0, cantDias));
    }

    const filtradas = prodRows.filter(r => {
      const fecha = String(r.Fecha || "").substring(0, 10);
      return diasSeleccionados.has(fecha);
    });

    // Agrupar por matriz
    const porMatriz = new Map();
    filtradas.forEach(r => {
      const mat = String(r.Matriz || "").trim();
      if (!porMatriz.has(mat)) porMatriz.set(mat, { uni: 0, seg: 0, registros: 0, diasUsados: new Set() });
      const m = porMatriz.get(mat);
      m.uni += n(r.Uni);
      m.seg += n(r.Segundos_Trabajados);
      m.registros++;
      const fecha = String(r.Fecha || "").substring(0, 10);
      if (fecha) m.diasUsados.add(fecha);
    });

    // Formatear fechas como d/m y agrupar consecutivos en rangos
    function fmtDM(isoStr) {
      const d = new Date(isoStr + "T12:00:00");
      return d.getDate() + "/" + (d.getMonth() + 1);
    }
    function diasARangos(diasArr) {
      if (!diasArr.length) return "";
      const sorted = [...diasArr].sort();
      const rangos = [];
      let inicio = sorted[0];
      let prev = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        const prevDate = new Date(prev + "T12:00:00");
        const currDate = new Date(sorted[i] + "T12:00:00");
        const diffDays = Math.round((currDate - prevDate) / 86400000);
        // Consecutivo si diff <= 3 (salta fines de semana: vie->lun = 3)
        if (diffDays <= 3) {
          prev = sorted[i];
        } else {
          rangos.push(inicio === prev ? fmtDM(inicio) : fmtDM(inicio) + "-" + fmtDM(prev));
          inicio = sorted[i];
          prev = sorted[i];
        }
      }
      rangos.push(inicio === prev ? fmtDM(inicio) : fmtDM(inicio) + "-" + fmtDM(prev));
      return rangos.join(", ");
    }

    // Ordenar por unidades desc
    const sorted = [...porMatriz.entries()].sort((a, b) => b[1].uni - a[1].uni);

    let totalUni = 0;
    let totalSeg = 0;
    const filas = sorted.map(([mat, data]) => {
      const info = matMap.get(mat);
      const nombre = info ? String(info.Matriz || "") : "";
      totalUni += data.uni;
      totalSeg += data.seg;
      const diasTrab = diasARangos([...data.diasUsados]);
      const tHist = n(info?.Tiempo_Historico);
      return `<tr>
        <td class="c">${esc(mat)}</td>
        <td>${esc(nombre)}</td>
        <td class="r">${tHist > 0 ? f(tHist, 1) : '<span style="color:#999">-</span>'}</td>
        <td class="r b">${f(data.uni)}</td>
        <td class="r">${f(data.seg)}</td>
        <td class="r">${f(data.registros)}</td>
        <td style="font-size:11px;white-space:nowrap">${esc(diasTrab)}</td>
      </tr>`;
    }).join("");

    const diasLista = [...diasSeleccionados].sort();
    const desdeStr = diasLista[0] || "";
    const hastaStr = diasLista[diasLista.length - 1] || "";

    // Titulo para export y encabezado
    if (usandoFecha) {
      exportTitleOverride = "Uni x Matriz Desde " + desdeStr + " Hasta " + hastaStr;
    } else {
      exportTitleOverride = "Uni x Matriz Ultimos " + cantDias + " dias desde " + (desdeStr || "");
    }

    wrap.innerHTML = `
      <div style="margin-bottom:6px;color:#555;font-size:13px">
        Periodo: ${desdeStr} a ${hastaStr} (${cantDias} dias productivos)
      </div>
      <div class="informe-scroll">
        <table class="tbl" style="table-layout:auto;width:auto">
          <thead>
            <tr>
              <th>Cod</th>
              <th style="text-align:left">Matriz</th>
              <th class="r">T. Hist</th>
              <th class="r">Unidades</th>
              <th class="r">Seg Trab</th>
              <th class="r">Registros</th>
              <th>Dias Trabajados</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
          <tfoot>
            <tr style="font-weight:bold;border-top:2px solid #333">
              <td colspan="3">TOTAL</td>
              <td class="r">${f(totalUni)}</td>
              <td class="r">${f(totalSeg)}</td>
              <td class="r">${f(filtradas.length)}</td>
              <td>${esc(diasARangos(diasLista))}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }

  generarTabla();
  inputDias.addEventListener("input", generarTabla);
}

/* ================= EXPORT PDF / EXCEL ================= */
const btnExcelInf = document.getElementById("btnExcelInf");
const btnPDFInf = document.getElementById("btnPDFInf");
const btnPDFDiario = document.getElementById("btnPDFDiario");

function showExportBtns() {
  if (currentVista === "rdiario") {
    btnExcelInf.classList.add("hidden");
    btnPDFInf.classList.add("hidden");
    btnPDFDiario.classList.remove("hidden");
  } else {
    btnExcelInf.classList.remove("hidden");
    btnPDFInf.classList.remove("hidden");
    btnPDFDiario.classList.add("hidden");
  }
}

function getVisibleTable() {
  const tbl = resultEl.querySelector(".tbl");
  if (!tbl) return null;
  return tbl;
}

function tableToData(tbl) {
  const theadRows = tbl.querySelectorAll("thead tr");
  if (!theadRows.length) return { headers: [], rows: [] };

  // Build a grid for merged headers
  const grid = [];
  const maxRow = theadRows.length;
  theadRows.forEach((tr, ri) => {
    if (!grid[ri]) grid[ri] = [];
    let ci = 0;
    tr.querySelectorAll("th").forEach(th => {
      while (grid[ri][ci]) ci++;
      const colspan = parseInt(th.getAttribute("colspan")) || 1;
      const rowspan = parseInt(th.getAttribute("rowspan")) || 1;
      const text = th.textContent.trim().replace(/\n/g, " ");
      for (let r = 0; r < rowspan; r++) {
        for (let c = 0; c < colspan; c++) {
          if (!grid[ri + r]) grid[ri + r] = [];
          grid[ri + r][ci + c] = text;
        }
      }
      ci += colspan;
    });
  });

  // Merge header rows into single row: "Row1 Row2" if different
  const numCols = Math.max(...grid.map(r => r.length));
  const headers = [];
  for (let c = 0; c < numCols; c++) {
    const parts = [];
    for (let r = 0; r < maxRow; r++) {
      const val = (grid[r] && grid[r][c]) || "";
      if (val && !parts.includes(val)) parts.push(val);
    }
    headers.push(parts.join(" "));
  }

  return { headers, rows: extractRows(tbl) };
}

function extractRows(tbl) {
  const rows = [];
  tbl.querySelectorAll("tbody tr").forEach(tr => {
    if (tr.classList.contains("sep")) return;
    const row = [];
    tr.querySelectorAll("td").forEach(td => row.push(td.textContent.trim()));
    rows.push(row);
  });
  return rows;
}

function getExportTitle() {
  if (exportTitleOverride) return exportTitleOverride;
  const vista = selVista.options[selVista.selectedIndex].text;
  const fmt = (iso) => iso ? iso.split("-").reverse().join("/") : "";
  const d = fmt(fechaDesde.value);
  const h = fmt(fechaHasta.value);
  if (!d && !h) return vista;
  return vista + " - " + (d === h ? d : d + " a " + h);
}

btnExcelInf.addEventListener("click", async () => {
  if (currentVista === "mensajes") { await exportMensajesExcel(); return; }
  try {
    const tbl = getVisibleTable();
    if (!tbl) return;
    const { headers, rows } = tableToData(tbl);

    const dataRows = rows.map(row => row.map(cell => {
      const cleaned = cell.replace(/\./g, "").replace(",", ".");
      const num = Number(cleaned);
      return cell !== "" && !isNaN(num) ? num : cell;
    }));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Informe");

    const esUnidades = currentVista === "unidades";
    const borderStyle = esUnidades ? "medium" : "thin";
    const border = { top: { style: borderStyle }, left: { style: borderStyle }, bottom: { style: borderStyle }, right: { style: borderStyle } };
    const headStyle = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF111111" } }, font: { bold: true, size: 16, color: { argb: "FFFFFFFF" } }, alignment: { horizontal: "center", vertical: "middle", wrapText: true }, border };
    const subHeadStyle = { fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF333333" } }, font: { bold: true, size: 14, color: { argb: "FFFFFFFF" } }, alignment: { horizontal: "center", vertical: "middle" }, border };

    // Fila de titulo (todas las vistas)
    let titleRowOffset = 0;
    const tituloExcel = getExportTitle();
    if (tituloExcel) {
      const titleRow = ws.addRow([tituloExcel]);
      ws.mergeCells(1, 1, 1, headers.length);
      const titleCell = titleRow.getCell(1);
      titleCell.font = { bold: true, size: 18 };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      titleCell.border = border;
      titleRow.height = 36;
      titleRowOffset = 1;
    }

    // Detectar columnas de operarios: buscar pares que terminen en Seg/Ptje
    // Headers vienen como "ArielCabrera Seg", "ArielCabrera Ptje"
    const opGroups = []; // { name, startCol, endCol }
    const fixedCols = [];
    let i = 0;
    while (i < headers.length) {
      const h = headers[i];
      const parts = h.split(" ");
      const suffix = parts[parts.length - 1];
      if ((suffix === "Seg" || suffix === "Ptje") && parts.length > 1) {
        const name = parts.slice(0, -1).join(" ");
        const start = i;
        // Check if next column is same operator with different suffix
        if (i + 1 < headers.length) {
          const h2 = headers[i + 1];
          const parts2 = h2.split(" ");
          const name2 = parts2.slice(0, -1).join(" ");
          if (name2 === name) {
            opGroups.push({ name, startCol: start, endCol: i + 1 });
            i += 2;
            continue;
          }
        }
        // Single column operator
        opGroups.push({ name, startCol: start, endCol: start });
        i++;
      } else {
        fixedCols.push(i);
        i++;
      }
    }

    const hasOpGroups = opGroups.length > 0;
    const dataStartRow = (hasOpGroups ? 3 : 2) + titleRowOffset;

    if (hasOpGroups) {
      // Row 1+offset: fixed headers merged down + operator names merged across
      const hr1 = 1 + titleRowOffset;
      const hr2 = 2 + titleRowOffset;
      const row1 = ws.getRow(hr1);
      const row2 = ws.getRow(hr2);

      fixedCols.forEach(ci => {
        ws.mergeCells(hr1, ci + 1, hr2, ci + 1);
        const cell = row1.getCell(ci + 1);
        cell.value = headers[ci];
        Object.assign(cell, headStyle);
        cell.fill = headStyle.fill; cell.font = headStyle.font; cell.alignment = headStyle.alignment; cell.border = border;
        // Style row2 cell too for border
        const cell2 = row2.getCell(ci + 1);
        cell2.border = border;
      });

      opGroups.forEach(g => {
        const sc = g.startCol + 1; // 1-based
        const ec = g.endCol + 1;
        if (sc !== ec) ws.mergeCells(hr1, sc, hr1, ec);
        const cell = row1.getCell(sc);
        cell.value = g.name;
        cell.fill = headStyle.fill; cell.font = headStyle.font; cell.alignment = headStyle.alignment; cell.border = border;
        // Border on merged right cell
        if (sc !== ec) { const cr = row1.getCell(ec); cr.border = border; }

        // Row 2: sub-headers (Seg, Ptje)
        for (let c = g.startCol; c <= g.endCol; c++) {
          const parts = headers[c].split(" ");
          const sub = parts[parts.length - 1];
          const cell2 = row2.getCell(c + 1);
          cell2.value = sub;
          cell2.fill = subHeadStyle.fill; cell2.font = subHeadStyle.font; cell2.alignment = subHeadStyle.alignment; cell2.border = border;
        }
      });

      row1.height = 50;
      row2.height = 22;
    } else {
      // Simple single header row
      const headerRow = ws.addRow(headers);
      headerRow.eachCell(cell => {
        cell.fill = headStyle.fill; cell.font = headStyle.font; cell.alignment = headStyle.alignment; cell.border = border;
      });
    }

    // Columna B (Matriz) con wrap text
    const matrizColIdx = headers.findIndex(h => { const hl = h.toLowerCase(); return hl === "matriz" || hl.includes("matriz") || hl === "descripcion"; });

    // Detectar columnas que necesitan separador de miles
    const colsConMiles = new Set();
    headers.forEach((h, idx) => {
      const hl = h.toLowerCase();
      if (hl === "unidades" || hl === "prom/dia" || hl === "registros") colsConMiles.add(idx);
    });

    // Data rows
    dataRows.forEach(row => {
      const r = ws.addRow(row);
      r.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.font = { size: 14 };
        cell.border = border;
        cell.alignment = { horizontal: "center", vertical: "middle" };
        if (colsConMiles.has(colNumber - 1) && typeof cell.value === "number") {
          cell.numFmt = "#,##0";
        }
      });
    });

    // Fill empty cells with borders + wrap text en columna Matriz
    for (let ri = dataStartRow; ri <= dataRows.length + (dataStartRow - 1); ri++) {
      const row = ws.getRow(ri);
      for (let ci = 1; ci <= headers.length; ci++) {
        const cell = row.getCell(ci);
        cell.border = border;
        if (!cell.alignment) cell.alignment = { horizontal: "center", vertical: "middle" };
        if (matrizColIdx >= 0 && ci === matrizColIdx + 1) {
          cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
        }
      }
    }

    // Auto-fit column widths
    headers.forEach((h, idx) => {
      let max = h.length;
      dataRows.forEach(r => {
        const len = String(r[idx] ?? "").length;
        if (len > max) max = len;
      });
      const hLower = h.toLowerCase();
      const parts = h.split(" ");
      const suffix = parts[parts.length - 1];
      const isOpCol = (suffix === "Seg" || suffix === "Ptje") && parts.length > 1;
      let w;
      if (hLower === "matriz" || hLower.includes("nombre") || hLower === "descripcion") w = 28;
      else if (hLower === "n" || hLower === "cod") w = 6;
      else if (isOpCol) w = 6;
      else if (hLower === "segprom" || hLower === "seg prom") w = 7;
      else w = Math.min(Math.max(max + 2, 8), 16);
      ws.getColumn(idx + 1).width = w;
    });

    // Freeze header rows
    ws.views = [{ state: "frozen", ySplit: dataStartRow - 1 }];

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getExportTitle() + ".xlsx";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Error Excel:", err);
    alert("Error al generar Excel: " + err.message);
  }
});

btnPDFInf.addEventListener("click", () => {
  if (currentVista === "mensajes") { exportMensajesPDF(); return; }
  try {
    const tbl = getVisibleTable();
    if (!tbl) return;
    const { headers, rows } = tableToData(tbl);

    const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDFClass) { alert("Error: libreria jsPDF no cargada."); return; }

    const fontSize = 14;
    const headFontSize = 16;
    const cellPad = 3;
    const margins = { top: 30, right: 5, bottom: 10, left: 5 };

    // Detectar columnas fijas (N, Matriz, SegProm, etc) vs columnas de operarios
    const fixedCols = [];
    const opCols = [];
    headers.forEach((h, i) => {
      const hl = h.toLowerCase();
      if (hl === "n" || hl === "matriz" || hl.includes("segpr") || hl.includes("seg prom") || hl === "cod" || hl === "descripcion" || hl === "cajones" || hl.includes("hs ") || hl.includes("uni fab") || hl.includes("seg x uni") || hl.includes("seg prom") || hl.includes("puntaje")) {
        fixedCols.push(i);
      } else {
        opCols.push(i);
      }
    });

    // Max columnas por pagina: A4 landscape 297mm, font 14 necesita ~22mm por col
    // Fijas (N=8mm, Matriz=45mm, SegProm=22mm) = ~75mm, quedan ~212mm para ops
    // Cada op con Seg+Ptje = 2 cols = ~44mm -> ~4-5 ops por pagina = 8-10 data cols
    const maxOpColsPerPage = 12; // 6 operarios x 2 (Seg+Ptje)

    // Construir 2 filas de header: fila1 = nombres operarios (merge), fila2 = Seg/Ptje
    function buildDualHeaders(hdrs) {
      const row1 = []; const row2 = [];
      let i = 0;
      while (i < hdrs.length) {
        const h = hdrs[i];
        const parts = h.split(" ");
        const suffix = parts[parts.length - 1];
        if ((suffix === "Seg" || suffix === "Ptje") && parts.length > 1) {
          const name = parts.slice(0, -1).join(" ");
          // Check if next is same operator
          if (i + 1 < hdrs.length) {
            const h2 = hdrs[i + 1];
            const parts2 = h2.split(" ");
            const name2 = parts2.slice(0, -1).join(" ");
            if (name2 === name) {
              row1.push({ content: name, colSpan: 2 });
              row2.push("Seg"); row2.push("Ptje");
              i += 2; continue;
            }
          }
          row1.push({ content: name, colSpan: 1 });
          row2.push(suffix);
          i++;
        } else {
          row1.push({ content: h, rowSpan: 2 });
          row2.push("");
          i++;
        }
      }
      return [row1, row2];
    }

    function getColumnStyles(hdrs) {
      const cs = {};
      hdrs.forEach((h, i) => {
        const hl = h.toLowerCase();
        const parts = h.split(" ");
        const suffix = parts[parts.length - 1];
        const isOpCol = (suffix === "Seg" || suffix === "Ptje") && parts.length > 1;
        if (hl === "n" || hl === "cod") cs[i] = { cellWidth: 14 };
        else if (hl === "matriz" || hl === "descripcion") cs[i] = { cellWidth: 45 };
        else if (hl.includes("segpr") || hl.includes("seg prom")) cs[i] = { cellWidth: 16 };
        else if (isOpCol) cs[i] = { cellWidth: 14 };
      });
      return cs;
    }

    const baseHeadStyles = { fillColor: [17, 17, 17], fontSize: headFontSize, cellPadding: cellPad, halign: "center", lineColor: [0, 0, 0], lineWidth: 0.3 };
    const baseStyles = { fontSize, cellPadding: cellPad, overflow: "linebreak", halign: "center", lineColor: [0, 0, 0], lineWidth: 0.3 };

    if (opCols.length <= maxOpColsPerPage || opCols.length === 0) {
      const doc = new jsPDFClass({ orientation: "landscape", unit: "mm", format: "a4" });
      doc.setFontSize(18); doc.setFont(undefined, "bold");
      doc.text(getExportTitle(), 14, 14);
      doc.setFontSize(12); doc.setFont(undefined, "normal");
      doc.text("Generado: " + new Date().toLocaleString("es-AR"), 14, 22);
      const dualHead = buildDualHeaders(headers);
      doc.autoTable({
        head: dualHead, body: rows, startY: 28, margin: margins,
        styles: baseStyles, headStyles: baseHeadStyles,
        columnStyles: getColumnStyles(headers),
        theme: "grid", tableWidth: "auto",
      });
      doc.save(getExportTitle() + ".pdf");
      return;
    }

    // Multi-pagina
    const groups = [];
    for (let i = 0; i < opCols.length; i += maxOpColsPerPage) {
      groups.push(opCols.slice(i, i + maxOpColsPerPage));
    }

    const doc = new jsPDFClass({ orientation: "landscape", unit: "mm", format: "a4" });

    groups.forEach((groupOpCols, gi) => {
      if (gi > 0) doc.addPage();

      const pageCols = [...fixedCols, ...groupOpCols];
      const pageHeaders = pageCols.map(i => headers[i]);

      const pageRows = [];
      rows.forEach(row => {
        const hasData = groupOpCols.some(i => row[i] && row[i].trim() !== "");
        if (hasData) pageRows.push(pageCols.map(i => row[i] || ""));
      });

      const pageNum = "Pagina " + (gi + 1) + " de " + groups.length;
      doc.setFontSize(18); doc.setFont(undefined, "bold");
      doc.text(getExportTitle(), 14, 14);
      doc.setFontSize(11); doc.setFont(undefined, "normal");
      doc.text("Generado: " + new Date().toLocaleString("es-AR") + "  —  " + pageNum, 14, 22);

      const dualHead = buildDualHeaders(pageHeaders);
      doc.autoTable({
        head: dualHead, body: pageRows, startY: 28, margin: margins,
        styles: baseStyles, headStyles: baseHeadStyles,
        columnStyles: getColumnStyles(pageHeaders),
        theme: "grid", tableWidth: "auto",
      });
    });

    doc.save(getExportTitle() + ".pdf");
  } catch (err) {
    console.error("Error PDF:", err);
    alert("Error al generar PDF: " + err.message);
  }
});

/* =================================================================
   VISTA 6: REPORTE DIARIO (replica del PDF del edge function)
   ================================================================= */
const RD_JORNADA_SEG = 9 * 3600;
const RD_DAVID_LEGAJO = "233";
const RD_EDUARDO_LEGAJO = "19";

function rdEsCM(r) { return String(r?.Nombre_Matriz || "").trim().toLowerCase() === "cambiar matriz"; }
function rdEsPiedra(mat) { return String(mat || "").trim() === "501"; }
function rdFmtHsMin(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  if (h === 0) return m + "Min";
  return h + "Hs " + String(m).padStart(2, "0") + "Min";
}
function rdSortMatriz(a, b) {
  const na = parseInt(a, 10), nb = parseInt(b, 10);
  const va = Number.isFinite(na) ? na : Number.MAX_SAFE_INTEGER;
  const vb = Number.isFinite(nb) ? nb : Number.MAX_SAFE_INTEGER;
  if (va !== vb) return va - vb;
  return a.localeCompare(b, "es");
}

function computeRDiarioData(rows, empMap, matMap) {
  const rdExcluido = (leg) => leg === "1" || leg === RD_DAVID_LEGAJO || leg === RD_EDUARDO_LEGAJO;

  const cajones = rows.filter(r => {
    const mat = String(r.Matriz || "").trim();
    const leg = String(r.Legajo || "").trim();
    return !rdEsCM(r) && esMatriz(mat) && !rdEsPiedra(mat) && n(r.Uni) > 0 && !rdExcluido(leg);
  });
  const piedraRegs = rows.filter(r => {
    const mat = String(r.Matriz || "").trim();
    return rdEsPiedra(mat) && n(r.Uni) > 0 && String(r.Legajo || "").trim() !== "1";
  });
  const tmEntries = rows.filter(r => {
    const leg = String(r.Legajo || "").trim();
    if (rdExcluido(leg)) return false;
    if (n(r.Segundos_Trabajados) <= 0) return false;
    if (rdEsCM(r)) return true;
    const mat = String(r.Matriz || "").trim();
    return esTM(mat);
  });

  const piedraEmpSet = new Set();
  piedraRegs.forEach(r => piedraEmpSet.add(String(r.Legajo || "").trim()));

  const empSetU = new Set(), matSetU = new Set();
  cajones.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    if (!piedraEmpSet.has(leg)) empSetU.add(leg);
    matSetU.add(String(r.Matriz || "").trim());
  });
  tmEntries.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    if (!piedraEmpSet.has(leg)) empSetU.add(leg);
  });

  const empleados = [...empSetU].sort((a, b) => (empMap.get(a)?.Empleado || a).localeCompare(empMap.get(b)?.Empleado || b, "es"));
  const matrices = [...matSetU].sort(rdSortMatriz);
  const piedraEmps = [...piedraEmpSet].sort((a, b) => (empMap.get(a)?.Empleado || a).localeCompare(empMap.get(b)?.Empleado || b, "es"));

  const dataMap = new Map();
  [...cajones, ...piedraRegs].forEach(r => {
    const mat = String(r.Matriz || "").trim();
    const leg = String(r.Legajo || "").trim();
    const key = mat + "__" + leg;
    if (!dataMap.has(key)) dataMap.set(key, { segTrab: 0, uni: 0 });
    const g = dataMap.get(key);
    g.segTrab += n(r.Segundos_Trabajados);
    g.uni += n(r.Uni);
  });

  const hsTotalByEmp = new Map();
  empleados.forEach(leg => {
    let total = 0;
    matrices.forEach(mat => { const g = dataMap.get(mat + "__" + leg); if (g) total += g.segTrab; });
    hsTotalByEmp.set(leg, total);
  });

  const puntajeByEmp = new Map();
  empleados.forEach(leg => {
    let sumT = 0, sumH = 0;
    matrices.forEach(mat => {
      const tp = n(matMap.get(mat)?.Tiempo_Historico);
      if (tp <= 0) return;
      const g = dataMap.get(mat + "__" + leg);
      if (!g) return;
      sumT += g.segTrab;
      sumH += tp * g.uni;
    });
    puntajeByEmp.set(leg, sumH > 0 ? (-(sumT / sumH - 1)) * 10 : null);
  });

  const tmByTypeByEmp = new Map();
  const tmTypeSet = new Set();
  const tmNombres = new Map();
  tmEntries.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    if (piedraEmpSet.has(leg)) return;
    if (rdEsCM(r)) return;
    const tipo = String(r.Matriz || "").trim();
    tmTypeSet.add(tipo);
    if (!tmNombres.has(tipo)) {
      const nm2 = String(r.Nombre_Matriz || "").trim();
      if (nm2) tmNombres.set(tipo, nm2);
    }
    if (!tmByTypeByEmp.has(leg)) tmByTypeByEmp.set(leg, new Map());
    const em = tmByTypeByEmp.get(leg);
    em.set(tipo, (em.get(tipo) || 0) + n(r.Segundos_Trabajados));
  });
  const tmTypeTotals = new Map();
  tmEntries.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    if (piedraEmpSet.has(leg)) return;
    if (rdEsCM(r)) return;
    const tipo = String(r.Matriz || "").trim();
    tmTypeTotals.set(tipo, (tmTypeTotals.get(tipo) || 0) + n(r.Segundos_Trabajados));
  });
  const tmTypes = [...tmTypeSet].sort((a, b) => (tmTypeTotals.get(b) || 0) - (tmTypeTotals.get(a) || 0));

  // David
  const davidCMs = [];
  const davidOtrosMap = new Map();
  rows.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    if (leg !== RD_DAVID_LEGAJO) return;
    const seg = n(r.Segundos_Trabajados);
    if (seg <= 0) return;
    if (rdEsCM(r)) {
      davidCMs.push({ destino: String(r.Matriz || "").trim() || "-", seg, horaInicio: String(r.Hora_Inicio || "") });
      return;
    }
    const mat = String(r.Matriz || "").trim();
    if (!esTM(mat)) return;
    const nombre = String(r.Nombre_Matriz || mat).trim();
    if (!davidOtrosMap.has(mat)) davidOtrosMap.set(mat, { nombre, seg: 0 });
    davidOtrosMap.get(mat).seg += seg;
  });
  davidCMs.sort((a, b) => a.horaInicio.localeCompare(b.horaInicio));
  const davidOtrosTM = [...davidOtrosMap.values()].sort((a, b) => b.seg - a.seg);

  // Eduardo
  const eduardoMatAggr = new Map();
  const eduardoTMaggr = new Map();
  rows.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    if (leg !== RD_EDUARDO_LEGAJO) return;
    const seg = n(r.Segundos_Trabajados);
    const mat = String(r.Matriz || "").trim();
    if (!rdEsCM(r) && esMatriz(mat) && !rdEsPiedra(mat) && n(r.Uni) > 0) {
      if (!eduardoMatAggr.has(mat)) eduardoMatAggr.set(mat, { segTrab: 0, uni: 0 });
      const g = eduardoMatAggr.get(mat);
      g.segTrab += seg;
      g.uni += n(r.Uni);
      return;
    }
    if (seg <= 0) return;
    if (rdEsCM(r) || esTM(mat)) {
      const nombreTM = rdEsCM(r) ? "Cambie matriz " + (mat || "-") : String(r.Nombre_Matriz || mat).trim();
      const key = rdEsCM(r) ? "CM_" + mat + "_" + r.Hora_Inicio : mat;
      if (!eduardoTMaggr.has(key)) eduardoTMaggr.set(key, { nombre: nombreTM, seg: 0 });
      eduardoTMaggr.get(key).seg += seg;
    }
  });
  const eduardoMats = [...eduardoMatAggr.entries()].map(([mat, g]) => {
    const info = matMap.get(mat);
    const nombre = info?.Matriz || "";
    const tHist = n(info?.Tiempo_Historico);
    const segXUni = g.uni > 0 ? g.segTrab / g.uni : 0;
    const premio = tHist > 0 ? (-(segXUni / tHist - 1)) * 10 : null;
    return { matriz: mat, nombre, prom: segXUni, premio };
  }).sort((a, b) => rdSortMatriz(a.matriz, b.matriz));
  const eduardoTMs = [...eduardoTMaggr.values()].sort((a, b) => b.seg - a.seg);

  return {
    matrices, empleados, piedraEmps, dataMap,
    hsTotalByEmp, puntajeByEmp,
    tmByTypeByEmp, tmTypes, tmNombres,
    davidCMs, davidOtrosTM, eduardoMats, eduardoTMs
  };
}

/* =================================================================
   VISTA: MENSAJES
   Muestra todos los registros de db_n8n_espejo agrupados por operario,
   con toggle de orden por fecha.
   ================================================================= */
let mcOrden = "desc"; // "asc" | "desc"
let mcLastRows = null;
let mcLastEmpMap = null;
let mcLastMatMap = null;

// MC_TM_CODES se carga de "Codificacion Mensajes".tipo='TIEMPO_MUERTO'.
// MC_ISSUE_CODES deprecado — RM/PM/RD/REM/LT ahora son TIEMPO_MUERTO en BD, sin categoria ISSUE.
let MC_TM_CODES = new Set();
let MC_ISSUE_CODES = new Set(); // mantenido vacio por compat
async function cargarTiposCodigosMC() {
  try {
    const { data, error } = await sb.from('Codificacion Mensajes').select('Codigo,tipo').eq('tipo','TIEMPO_MUERTO');
    if (error) throw error;
    MC_TM_CODES = new Set((data || []).map(r => String(r.Codigo).toUpperCase()));
  } catch (e) {
    console.error('[informes] cargarTiposCodigosMC fallo:', e);
  }
}
cargarTiposCodigosMC();
function mcKind(matriz) {
  const m = String(matriz || "").trim();
  if (esMatriz(m)) return 'PROD';
  if (MC_TM_CODES.has(m.toUpperCase())) return 'TM';
  return 'OTHER';
}
function mcTagClass(matriz) {
  return 'mc-' + mcKind(matriz);
}

function mcRowTs(r) {
  // Construir timestamp real del registro: Fecha (dia) + Hora_Inicio
  const dStr = r.Fecha ? String(r.Fecha).slice(0, 10) : '';
  const h = r.Hora_Inicio || '00:00:00';
  if (dStr) return new Date(dStr + 'T' + h + '-03:00').getTime();
  return r.Fecha ? new Date(r.Fecha).getTime() : 0;
}

function mcGroupByLeg(rows, orden) {
  const byLeg = new Map();
  for (const r of rows) {
    const leg = String(r.Legajo || "").trim();
    if (!leg) continue;
    if (!byLeg.has(leg)) byLeg.set(leg, []);
    byLeg.get(leg).push(r);
  }
  const mult = orden === "asc" ? 1 : -1;
  for (const arr of byLeg.values()) {
    arr.sort((a, b) => mult * (mcRowTs(a) - mcRowTs(b)));
  }
  return byLeg;
}

function fmtSegToHMS(s) {
  const n = Number(s || 0);
  if (!n) return '0:00';
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const sec = Math.floor(n % 60);
  return h > 0 ? h + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0') : m + ':' + String(sec).padStart(2,'0');
}

// Descompone segundos en { hs, min } (ej 4512s -> { hs: 1, min: 15 })
function segToHM(s) {
  const n = Number(s || 0);
  return { hs: Math.floor(n / 3600), min: Math.floor((n % 3600) / 60) };
}

// Arma los resumenes (por Matriz / por TM) para un array de registros del operario
function mcBuildResumen(regs) {
  const porMat = new Map(); // key = Matriz → { matriz, nombre, cajones, uni, seg }
  const porTm = new Map();  // key = Codigo  → { cod, nombre, count, seg }
  for (const r of regs) {
    const mat = String(r.Matriz || '').trim();
    const seg = Number(r.Segundos_Trabajados || 0);
    if (esMatriz(mat)) {
      const cur = porMat.get(mat) || { matriz: mat, nombre: r.Nombre_Matriz || '', cajones: 0, uni: 0, seg: 0 };
      cur.cajones += 1;
      cur.uni += Number(r.Uni || 0);
      cur.seg += seg;
      if (!cur.nombre && r.Nombre_Matriz) cur.nombre = r.Nombre_Matriz;
      porMat.set(mat, cur);
    } else if (mat) {
      const cur = porTm.get(mat) || { cod: mat, nombre: r.Nombre_Matriz || '', count: 0, seg: 0 };
      cur.count += 1;
      cur.seg += seg;
      if (!cur.nombre && r.Nombre_Matriz) cur.nombre = r.Nombre_Matriz;
      porTm.set(mat, cur);
    }
  }
  const mats = [...porMat.values()].sort((a, b) => b.seg - a.seg);
  const tms = [...porTm.values()].sort((a, b) => b.seg - a.seg);
  return { mats, tms };
}

function fmtNum(n, dec) {
  const v = Number(n);
  if (!isFinite(v) || v === 0) return '';
  return v.toLocaleString('es-AR', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
}

function renderMensajesCrudos(rows, empMap, matMap) {
  mcLastRows = rows;
  mcLastEmpMap = empMap;
  mcLastMatMap = matMap;

  const byLeg = mcGroupByLeg(rows, mcOrden);
  const legOrdenados = [...byLeg.keys()].sort((a, b) => {
    const na = empMap.get(a)?.Empleado || a;
    const nb = empMap.get(b)?.Empleado || b;
    return String(na).localeCompare(String(nb), "es");
  });

  const desdeVal = fechaDesde.value, hastaVal = fechaHasta.value;
  const titulo = desdeVal && hastaVal
    ? (desdeVal === hastaVal ? "Mensajes Operarios - " + desdeVal.split("-").reverse().join("/") : "Mensajes Operarios " + desdeVal.split("-").reverse().join("/") + " a " + hastaVal.split("-").reverse().join("/"))
    : "Mensajes Operarios";

  let html = '<style>';
  html += '.mc-wrap{display:flex;flex-direction:column;align-items:center;gap:16px;padding:8px 0;}';
  html += '.mc-toolbar{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;}';
  html += '.mc-title{font-size:20px;font-weight:700;color:#111;}';
  html += '.mc-orden{display:flex;align-items:center;gap:8px;font-size:13px;}';
  html += '.mc-orden-btn{height:30px;padding:0 12px;border:1px solid #c9d1d9;background:#fff;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;color:#333;}';
  html += '.mc-orden-btn:hover{background:#f5f5f5;}';
  html += '.mc-orden-btn.active{background:#222;color:#fff;border-color:#222;}';
  html += '.mc-section{background:#fff;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;width:fit-content;max-width:100%;}';
  html += '.mc-head{background:#222;color:#fff;padding:6px 12px;display:flex;align-items:center;justify-content:space-between;font-weight:700;font-size:14px;}';
  html += '.mc-head .mc-count{font-size:11px;color:#bbb;font-weight:400;}';
  html += '.mc-section table{width:auto;max-width:100%;border-collapse:collapse;font-size:12px;}';
  html += '.mc-section th{background:#f5f5f5;padding:4px 8px;text-align:left;border-bottom:1px solid #ccc;color:#333;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;}';
  html += '.mc-section td{padding:2px 8px;border-bottom:1px solid #eee;vertical-align:top;line-height:1.3;white-space:nowrap;}';
  html += '.mc-section td.r{text-align:right;}';
  html += '.mc-section td.wrap{white-space:normal;}';
  html += '.mc-section tr:hover td{background:#fafafa;}';
  html += '.mc-tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:700;color:#fff;min-width:48px;text-align:center;}';
  html += '.mc-PROD{background:#2e7d32;} .mc-TM{background:#f57c00;} .mc-ISSUE{background:#c62828;} .mc-OTHER{background:#616161;}';
  html += '.mc-empty{padding:30px;text-align:center;color:#999;}';
  html += '.mc-resumen{display:flex;flex-wrap:wrap;gap:16px;padding:10px 12px;background:#fafafa;border-top:1px solid #e0e0e0;}';
  html += '.mc-resumen > div{flex:0 0 auto;}';
  html += '.mc-resumen h3{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#555;margin-bottom:6px;}';
  html += '.mc-resumen table{width:auto;border-collapse:collapse;font-size:11px;background:#fff;border:1px solid #e0e0e0;}';
  html += '.mc-resumen th{background:#eeeeee;padding:3px 8px;text-align:left;font-weight:700;border-bottom:1px solid #ccc;white-space:nowrap;}';
  html += '.mc-resumen td{padding:2px 8px;border-bottom:1px solid #f0f0f0;white-space:nowrap;}';
  html += '.mc-resumen tr:last-child td{border-bottom:none;}';
  html += '.mc-resumen td.r,.mc-resumen th.r{text-align:right;}';
  html += '.mc-resumen tfoot td{background:#f5f5f5;font-weight:700;border-top:1px solid #ccc;}';
  html += '</style>';

  html += '<div class="mc-wrap">';
  html += '<div class="mc-toolbar">';
  html += '<h2 class="mc-title">' + esc(titulo) + '</h2>';
  html += '<div class="mc-orden">Orden: ';
  html += '<button class="mc-orden-btn ' + (mcOrden === "desc" ? "active" : "") + '" onclick="setMcOrden(\'desc\')">Más reciente ↓</button>';
  html += '<button class="mc-orden-btn ' + (mcOrden === "asc" ? "active" : "") + '" onclick="setMcOrden(\'asc\')">Más antiguo ↑</button>';
  html += '</div></div>';

  if (!legOrdenados.length) {
    html += '<div class="mc-empty">Sin registros en el rango seleccionado.</div>';
    html += '</div>';
    resultEl.innerHTML = html;
    return;
  }

  for (const leg of legOrdenados) {
    const emp = empMap.get(leg);
    const nombre = emp ? emp.Empleado : '(sin nombre)';
    const regs = byLeg.get(leg);
    html += '<div class="mc-section">';
    html += '<div class="mc-head"><span>' + esc(nombre) + ' <span style="color:#bbb;font-weight:400;">#' + esc(leg) + '</span></span><span class="mc-count">' + regs.length + ' registros</span></div>';
    html += '<table><thead><tr>';
    html += '<th>Fecha</th>';
    html += '<th>Hora Ini</th>';
    html += '<th>Hora Fin</th>';
    html += '<th>Tipo</th>';
    html += '<th>Matriz / Código</th>';
    html += '<th>Descripción</th>';
    html += '<th class="r">Uni</th>';
    html += '<th class="r">Tiempo</th>';
    html += '<th class="r">T.Toma</th>';
    html += '<th class="r">Premio</th>';
    html += '</tr></thead><tbody>';
    for (const r of regs) {
      const d = r.Fecha ? new Date(r.Fecha) : null;
      const fecha = d ? d.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit" }) : '';
      const mat = String(r.Matriz || "").trim();
      const matInfo = esMatriz(mat) ? matMap.get(mat) : null;
      const matCell = mat + (matInfo && matInfo.Matriz ? ' - ' + matInfo.Matriz : '');
      const kind = mcKind(r.Matriz);
      const tagLabel = kind === 'PROD' ? 'PROD' : (kind === 'TM' ? 'TM' : (kind === 'ISSUE' ? 'ISSUE' : '—'));
      html += '<tr>';
      html += '<td>' + esc(fecha) + '</td>';
      html += '<td>' + esc(r.Hora_Inicio || '') + '</td>';
      html += '<td>' + esc(r.Hora_Fin || '') + '</td>';
      html += '<td><span class="mc-tag ' + mcTagClass(r.Matriz) + '">' + esc(tagLabel) + '</span></td>';
      html += '<td>' + esc(matCell) + '</td>';
      html += '<td>' + esc(r.Nombre_Matriz || '') + '</td>';
      html += '<td class="r">' + esc(fmtNum(r.Uni, 0)) + '</td>';
      html += '<td class="r">' + esc(fmtSegToHMS(r.Segundos_Trabajados)) + '</td>';
      html += '<td class="r">' + esc(fmtNum(r.Tiempo_Toma, 1)) + '</td>';
      html += '<td class="r">' + esc(fmtNum(r.Premio, 2)) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table>';

    // Resumen por Matriz y por TM
    const { mats, tms } = mcBuildResumen(regs);
    let totMatSeg = 0, totMatUni = 0, totMatCaj = 0;
    mats.forEach(m => { totMatSeg += m.seg; totMatUni += m.uni; totMatCaj += m.cajones; });
    let totTmSeg = 0, totTmCount = 0;
    tms.forEach(t => { totTmSeg += t.seg; totTmCount += t.count; });

    html += '<div class="mc-resumen">';
    // Matriz
    html += '<div><h3>Resumen por Matriz</h3>';
    if (mats.length) {
      html += '<table><thead><tr><th>Matriz</th><th>Descripción</th><th class="r">Caj</th><th class="r">Uni</th><th class="r">Hs</th><th class="r">Min</th></tr></thead><tbody>';
      for (const m of mats) {
        const hm = segToHM(m.seg);
        html += '<tr>';
        html += '<td>' + esc(m.matriz) + '</td>';
        html += '<td>' + esc(m.nombre) + '</td>';
        html += '<td class="r">' + m.cajones + '</td>';
        html += '<td class="r">' + esc(fmtNum(m.uni, 0)) + '</td>';
        html += '<td class="r">' + hm.hs + '</td>';
        html += '<td class="r">' + hm.min + '</td>';
        html += '</tr>';
      }
      const tHM = segToHM(totMatSeg);
      html += '</tbody><tfoot><tr>';
      html += '<td colspan="2">Total</td>';
      html += '<td class="r">' + totMatCaj + '</td>';
      html += '<td class="r">' + esc(fmtNum(totMatUni, 0)) + '</td>';
      html += '<td class="r">' + tHM.hs + '</td>';
      html += '<td class="r">' + tHM.min + '</td>';
      html += '</tr></tfoot></table>';
    } else {
      html += '<div style="font-size:11px;color:#999;padding:6px;">Sin producción.</div>';
    }
    html += '</div>';
    // TM
    html += '<div><h3>Resumen por TM</h3>';
    if (tms.length) {
      html += '<table><thead><tr><th>Cód</th><th>Descripción</th><th class="r">Veces</th><th class="r">Hs</th><th class="r">Min</th></tr></thead><tbody>';
      for (const t of tms) {
        const hm = segToHM(t.seg);
        html += '<tr>';
        html += '<td>' + esc(t.cod) + '</td>';
        html += '<td>' + esc(t.nombre) + '</td>';
        html += '<td class="r">' + t.count + '</td>';
        html += '<td class="r">' + hm.hs + '</td>';
        html += '<td class="r">' + hm.min + '</td>';
        html += '</tr>';
      }
      const tHM = segToHM(totTmSeg);
      html += '</tbody><tfoot><tr>';
      html += '<td colspan="2">Total</td>';
      html += '<td class="r">' + totTmCount + '</td>';
      html += '<td class="r">' + tHM.hs + '</td>';
      html += '<td class="r">' + tHM.min + '</td>';
      html += '</tr></tfoot></table>';
    } else {
      html += '<div style="font-size:11px;color:#999;padding:6px;">Sin tiempos muertos.</div>';
    }
    html += '</div>';
    html += '</div>'; // close mc-resumen

    html += '</div>'; // close mc-section
  }

  html += '</div>';
  resultEl.innerHTML = html;
}

window.setMcOrden = function(o) {
  if (mcOrden === o || !mcLastRows) return;
  mcOrden = o;
  renderMensajesCrudos(mcLastRows, mcLastEmpMap, mcLastMatMap);
};

/* ---------- EXPORT MENSAJES: Excel (grises) ---------- */
async function exportMensajesExcel() {
  try {
    if (!mcLastRows) { alert("Generá el informe primero."); return; }
    const byLeg = mcGroupByLeg(mcLastRows, mcOrden);
    const legOrdenados = [...byLeg.keys()].sort((a, b) => {
      const na = mcLastEmpMap.get(a)?.Empleado || a;
      const nb = mcLastEmpMap.get(b)?.Empleado || b;
      return String(na).localeCompare(String(nb), "es");
    });
    const desdeVal = fechaDesde.value, hastaVal = fechaHasta.value;
    const titulo = desdeVal === hastaVal
      ? "Mensajes " + desdeVal.split("-").reverse().join("/")
      : "Mensajes Operarios " + desdeVal.split("-").reverse().join("/") + " a " + hastaVal.split("-").reverse().join("/");

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Mensajes Operarios");

    const N_COLS = 10;
    const thin = { style: "thin", color: { argb: "FF999999" } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    const fillOpHead = { type: "pattern", pattern: "solid", fgColor: { argb: "FF222222" } };
    const fillSubHead = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } };
    const fillAlt = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F5" } };
    const fillByKind = {
      PROD:  { type: "pattern", pattern: "solid", fgColor: { argb: "FF9E9E9E" } },
      TM:    { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E0E0" } },
      ISSUE: { type: "pattern", pattern: "solid", fgColor: { argb: "FF616161" } },
      OTHER: { type: "pattern", pattern: "solid", fgColor: { argb: "FFEEEEEE" } }
    };
    const fontByKind = {
      PROD:  { bold: true, color: { argb: "FFFFFFFF" } },
      ISSUE: { bold: true, color: { argb: "FFFFFFFF" } },
      TM:    { color: { argb: "FF000000" } },
      OTHER: { color: { argb: "FF000000" } }
    };

    // Titulo
    ws.addRow([titulo]);
    ws.mergeCells(1, 1, 1, N_COLS);
    const titleCell = ws.getCell(1, 1);
    titleCell.font = { bold: true, size: 16 };
    titleCell.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 28;
    ws.addRow([]);

    // Anchos calculados segun el contenido real
    const headersMain = ["Fecha", "Hora Ini", "Hora Fin", "Tipo", "Matriz/Cod", "Descripción", "Uni", "Tiempo", "T.Toma", "Premio"];
    const maxLen = headersMain.map(h => h.length);
    for (const leg of legOrdenados) {
      const regs = byLeg.get(leg);
      for (const r of regs) {
        const d = r.Fecha ? new Date(r.Fecha) : null;
        const fecha = d ? d.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" }) : '';
        const mat = String(r.Matriz || "").trim();
        const matInfo = esMatriz(mat) ? mcLastMatMap.get(mat) : null;
        const matCell = mat + (matInfo && matInfo.Matriz ? ' - ' + matInfo.Matriz : '');
        const tagLabel = { PROD: 'PROD', TM: 'TM', ISSUE: 'ISSUE', OTHER: '—' }[mcKind(r.Matriz)];
        const vals = [fecha, r.Hora_Inicio || '', r.Hora_Fin || '', tagLabel, matCell, r.Nombre_Matriz || '', fmtNum(r.Uni, 0), fmtNum(r.Segundos_Trabajados, 0), fmtNum(r.Tiempo_Toma, 1), fmtNum(r.Premio, 2)];
        vals.forEach((v, i) => { const l = String(v || '').length; if (l > maxLen[i]) maxLen[i] = l; });
      }
    }
    maxLen.forEach((l, i) => { ws.getColumn(i + 1).width = Math.min(Math.max(l + 2, 6), 40); });

    for (const leg of legOrdenados) {
      const emp = mcLastEmpMap.get(leg);
      const nombre = emp ? emp.Empleado : '(sin nombre)';
      const regs = byLeg.get(leg);

      // Header de operario
      const opHead = ws.addRow([nombre + "  #" + leg + "   (" + regs.length + " registros)"]);
      ws.mergeCells(opHead.number, 1, opHead.number, N_COLS);
      const opHeadCell = ws.getCell(opHead.number, 1);
      opHeadCell.fill = fillOpHead;
      opHeadCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
      opHeadCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      opHead.height = 22;

      // Subheaders
      const subHead = ws.addRow(["Fecha", "Hora Ini", "Hora Fin", "Tipo", "Matriz/Cod", "Descripción", "Uni", "Tiempo", "T.Toma", "Premio"]);
      subHead.eachCell((cell) => {
        cell.fill = fillSubHead;
        cell.font = { bold: true, size: 10 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = border;
      });
      subHead.height = 18;

      regs.forEach((r, idx) => {
        const d = r.Fecha ? new Date(r.Fecha) : null;
        const fecha = d ? d.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" }) : '';
        const mat = String(r.Matriz || "").trim();
        const matInfo = esMatriz(mat) ? mcLastMatMap.get(mat) : null;
        const matCell = mat + (matInfo && matInfo.Matriz ? ' - ' + matInfo.Matriz : '');
        const kind = mcKind(r.Matriz);
        const tagLabel = kind === 'PROD' ? 'PROD' : (kind === 'TM' ? 'TM' : (kind === 'ISSUE' ? 'ISSUE' : '—'));
        const row = ws.addRow([
          fecha,
          r.Hora_Inicio || '',
          r.Hora_Fin || '',
          tagLabel,
          matCell,
          r.Nombre_Matriz || '',
          Number(r.Uni) || 0,
          fmtSegToHMS(r.Segundos_Trabajados),
          Number(r.Tiempo_Toma) || 0,
          Number(r.Premio) || 0
        ]);
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
          cell.border = border;
          cell.font = { size: 10 };
          if (idx % 2 === 1) cell.fill = fillAlt;
          if (colNum === 4) {
            cell.fill = fillByKind[kind];
            cell.font = Object.assign({ size: 10 }, fontByKind[kind] || {});
            cell.alignment = { horizontal: "center", vertical: "middle" };
          } else if (colNum >= 7) {
            cell.alignment = { horizontal: "right", vertical: "middle" };
            if (colNum === 7) cell.numFmt = "#,##0";
            else if (colNum === 9) cell.numFmt = "#,##0.0";
            else if (colNum === 10) cell.numFmt = "#,##0.00";
          } else {
            cell.alignment = { horizontal: "left", vertical: "middle" };
          }
        });
      });

      // --- Resumenes por operario ---
      const { mats, tms } = mcBuildResumen(regs);
      ws.addRow([]);

      // Resumen por Matriz
      if (mats.length) {
        const hdr = ws.addRow(["Resumen por Matriz"]);
        ws.mergeCells(hdr.number, 1, hdr.number, 6);
        const hdrCell = ws.getCell(hdr.number, 1);
        hdrCell.fill = fillSubHead;
        hdrCell.font = { bold: true, size: 10 };
        hdrCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
        const sub = ws.addRow(["Matriz", "Descripción", "Caj", "Uni", "Hs", "Min"]);
        sub.eachCell((c) => { c.fill = fillSubHead; c.font = { bold: true, size: 10 }; c.border = border; c.alignment = { horizontal: "center", vertical: "middle" }; });
        let tC = 0, tU = 0, tS = 0;
        for (const m of mats) {
          const hm = segToHM(m.seg);
          const r = ws.addRow([m.matriz, m.nombre, m.cajones, m.uni, hm.hs, hm.min]);
          r.eachCell({ includeEmpty: true }, (c, ci) => {
            c.border = border; c.font = { size: 10 };
            if (ci >= 3) { c.alignment = { horizontal: "right", vertical: "middle" }; c.numFmt = "#,##0"; }
            else c.alignment = { horizontal: "left", vertical: "middle" };
          });
          tC += m.cajones; tU += m.uni; tS += m.seg;
        }
        const tHM = segToHM(tS);
        const totalRow = ws.addRow(["TOTAL", "", tC, tU, tHM.hs, tHM.min]);
        totalRow.eachCell({ includeEmpty: true }, (c, ci) => {
          c.border = border; c.font = { bold: true, size: 10 }; c.fill = fillAlt;
          if (ci >= 3) { c.alignment = { horizontal: "right", vertical: "middle" }; c.numFmt = "#,##0"; }
          else c.alignment = { horizontal: "left", vertical: "middle" };
        });
        ws.addRow([]);
      }

      // Resumen por TM
      if (tms.length) {
        const hdr = ws.addRow(["Resumen por TM"]);
        ws.mergeCells(hdr.number, 1, hdr.number, 5);
        const hdrCell = ws.getCell(hdr.number, 1);
        hdrCell.fill = fillSubHead;
        hdrCell.font = { bold: true, size: 10 };
        hdrCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
        const sub = ws.addRow(["Cód", "Descripción", "Veces", "Hs", "Min"]);
        sub.eachCell((c) => { c.fill = fillSubHead; c.font = { bold: true, size: 10 }; c.border = border; c.alignment = { horizontal: "center", vertical: "middle" }; });
        let tV = 0, tS = 0;
        for (const t of tms) {
          const hm = segToHM(t.seg);
          const r = ws.addRow([t.cod, t.nombre, t.count, hm.hs, hm.min]);
          r.eachCell({ includeEmpty: true }, (c, ci) => {
            c.border = border; c.font = { size: 10 };
            if (ci >= 3) { c.alignment = { horizontal: "right", vertical: "middle" }; c.numFmt = "#,##0"; }
            else c.alignment = { horizontal: "left", vertical: "middle" };
          });
          tV += t.count; tS += t.seg;
        }
        const tHM = segToHM(tS);
        const totalRow = ws.addRow(["TOTAL", "", tV, tHM.hs, tHM.min]);
        totalRow.eachCell({ includeEmpty: true }, (c, ci) => {
          c.border = border; c.font = { bold: true, size: 10 }; c.fill = fillAlt;
          if (ci >= 3) { c.alignment = { horizontal: "right", vertical: "middle" }; c.numFmt = "#,##0"; }
          else c.alignment = { horizontal: "left", vertical: "middle" };
        });
      }

      ws.addRow([]);
    }

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = titulo + ".xlsx";
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("Error Excel mensajes:", err);
    alert("Error al generar Excel: " + err.message);
  }
}

/* ---------- EXPORT MENSAJES: PDF (grises) ---------- */
function exportMensajesPDF() {
  try {
    if (!mcLastRows) { alert("Generá el informe primero."); return; }
    const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDFClass) { alert("Error: libreria jsPDF no cargada."); return; }

    const byLeg = mcGroupByLeg(mcLastRows, mcOrden);
    const legOrdenados = [...byLeg.keys()].sort((a, b) => {
      const na = mcLastEmpMap.get(a)?.Empleado || a;
      const nb = mcLastEmpMap.get(b)?.Empleado || b;
      return String(na).localeCompare(String(nb), "es");
    });
    const desdeVal = fechaDesde.value, hastaVal = fechaHasta.value;
    const titulo = desdeVal === hastaVal
      ? "Mensajes " + desdeVal.split("-").reverse().join("/")
      : "Mensajes Operarios " + desdeVal.split("-").reverse().join("/") + " a " + hastaVal.split("-").reverse().join("/");

    const doc = new jsPDFClass({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text(titulo, 10, 12);

    const fillByKind = {
      PROD:  [158, 158, 158],
      TM:    [224, 224, 224],
      ISSUE: [97, 97, 97],
      OTHER: [238, 238, 238]
    };
    const textByKind = {
      PROD:  [255, 255, 255],
      TM:    [0, 0, 0],
      ISSUE: [255, 255, 255],
      OTHER: [0, 0, 0]
    };

    let startY = 18;
    for (const leg of legOrdenados) {
      const emp = mcLastEmpMap.get(leg);
      const nombre = emp ? emp.Empleado : '(sin nombre)';
      const regs = byLeg.get(leg);

      const body = regs.map(r => {
        const d = r.Fecha ? new Date(r.Fecha) : null;
        const fecha = d ? d.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit" }) : '';
        const mat = String(r.Matriz || "").trim();
        const matInfo = esMatriz(mat) ? mcLastMatMap.get(mat) : null;
        const matCell = mat + (matInfo && matInfo.Matriz ? ' - ' + matInfo.Matriz : '');
        const kind = mcKind(r.Matriz);
        const tagLabel = kind === 'PROD' ? 'PROD' : (kind === 'TM' ? 'TM' : (kind === 'ISSUE' ? 'ISSUE' : '—'));
        return [
          fecha,
          r.Hora_Inicio || '',
          r.Hora_Fin || '',
          tagLabel,
          matCell,
          r.Nombre_Matriz || '',
          fmtNum(r.Uni, 0),
          fmtSegToHMS(r.Segundos_Trabajados),
          fmtNum(r.Tiempo_Toma, 1),
          fmtNum(r.Premio, 2)
        ];
      });

      doc.autoTable({
        startY,
        margin: { left: 10, right: 10 },
        tableWidth: 'wrap',
        head: [
          [{ content: nombre + '  #' + leg + '   (' + regs.length + ' registros)', colSpan: 10, styles: { fillColor: [34, 34, 34], textColor: [255, 255, 255], halign: 'left', fontSize: 11 } }],
          ['Fecha', 'H.Ini', 'H.Fin', 'Tipo', 'Matriz/Cod', 'Descripción', 'Uni', 'Tiempo', 'T.Toma', 'Premio']
        ],
        body,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, lineColor: [180, 180, 180], lineWidth: 0.1, cellWidth: 'wrap' },
        headStyles: { fillColor: [217, 217, 217], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 8 },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        columnStyles: {
          3: { halign: 'center', fontStyle: 'bold' },
          6: { halign: 'right' },
          7: { halign: 'right' },
          8: { halign: 'right' },
          9: { halign: 'right' }
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 3) {
            const kind = String(data.cell.raw || '').trim();
            if (fillByKind[kind]) {
              data.cell.styles.fillColor = fillByKind[kind];
              data.cell.styles.textColor = textByKind[kind];
            }
          }
        }
      });
      startY = doc.lastAutoTable.finalY + 3;

      // Resumenes por Matriz y por TM (lado a lado)
      const { mats, tms } = mcBuildResumen(regs);
      const baseResumenY = startY;
      let endLeftY = startY;
      let endRightY = startY;

      if (mats.length) {
        let tC = 0, tU = 0, tS = 0;
        const matBody = mats.map(m => { const hm = segToHM(m.seg); tC += m.cajones; tU += m.uni; tS += m.seg; return [m.matriz, m.nombre, m.cajones, fmtNum(m.uni, 0), hm.hs, hm.min]; });
        const tHM = segToHM(tS);
        matBody.push([{ content: 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } }, { content: tC, styles: { fontStyle: 'bold', fillColor: [230, 230, 230], halign: 'right' } }, { content: fmtNum(tU, 0), styles: { fontStyle: 'bold', fillColor: [230, 230, 230], halign: 'right' } }, { content: tHM.hs, styles: { fontStyle: 'bold', fillColor: [230, 230, 230], halign: 'right' } }, { content: tHM.min, styles: { fontStyle: 'bold', fillColor: [230, 230, 230], halign: 'right' } }]);
        doc.autoTable({
          startY: baseResumenY,
          margin: { left: 10 },
          tableWidth: 'wrap',
          head: [[{ content: 'Resumen por Matriz', colSpan: 6, styles: { fillColor: [217, 217, 217], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'left', fontSize: 9 } }], ['Matriz', 'Descripción', 'Caj', 'Uni', 'Hs', 'Min']],
          body: matBody,
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 1, lineColor: [180, 180, 180], lineWidth: 0.1, cellWidth: 'wrap' },
          headStyles: { fillColor: [238, 238, 238], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 8 },
          columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }
        });
        endLeftY = doc.lastAutoTable.finalY;
      }

      if (tms.length) {
        let tV = 0, tS = 0;
        const tmBody = tms.map(t => { const hm = segToHM(t.seg); tV += t.count; tS += t.seg; return [t.cod, t.nombre, t.count, hm.hs, hm.min]; });
        const tHM = segToHM(tS);
        tmBody.push([{ content: 'TOTAL', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [230, 230, 230] } }, { content: tV, styles: { fontStyle: 'bold', fillColor: [230, 230, 230], halign: 'right' } }, { content: tHM.hs, styles: { fontStyle: 'bold', fillColor: [230, 230, 230], halign: 'right' } }, { content: tHM.min, styles: { fontStyle: 'bold', fillColor: [230, 230, 230], halign: 'right' } }]);
        doc.autoTable({
          startY: endLeftY ? endLeftY + 3 : baseResumenY,
          margin: { left: 10 },
          tableWidth: 'wrap',
          head: [[{ content: 'Resumen por TM', colSpan: 5, styles: { fillColor: [217, 217, 217], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'left', fontSize: 9 } }], ['Cód', 'Descripción', 'Veces', 'Hs', 'Min']],
          body: tmBody,
          theme: 'grid',
          styles: { fontSize: 8, cellPadding: 1, lineColor: [180, 180, 180], lineWidth: 0.1, cellWidth: 'wrap' },
          headStyles: { fillColor: [238, 238, 238], textColor: [0, 0, 0], fontStyle: 'bold', fontSize: 8 },
          columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } }
        });
        endRightY = doc.lastAutoTable.finalY;
      }

      startY = Math.max(endLeftY, endRightY) + 5;
      if (startY > 180) { doc.addPage(); startY = 15; }
    }

    doc.save(titulo + ".pdf");
  } catch (err) {
    console.error("Error PDF mensajes:", err);
    alert("Error al generar PDF: " + err.message);
  }
}

function renderReporteDiario(rows, empMap, matMap) {
  const {
    matrices, empleados, piedraEmps, dataMap,
    hsTotalByEmp, puntajeByEmp,
    tmByTypeByEmp, tmTypes, tmNombres,
    davidCMs, davidOtrosTM, eduardoMats, eduardoTMs
  } = computeRDiarioData(rows, empMap, matMap);

  // ============ RENDER ============
  let html = '<div class="rd-wrap">';

  // Titulo
  const desdeVal = fechaDesde.value, hastaVal = fechaHasta.value;
  const titulo = desdeVal && hastaVal
    ? (desdeVal === hastaVal ? "Reporte Diario - " + desdeVal.split("-").reverse().join("/") : "Reporte " + desdeVal.split("-").reverse().join("/") + " a " + hastaVal.split("-").reverse().join("/"))
    : "Reporte Diario";
  html += '<h2 class="rd-title">' + esc(titulo) + '</h2>';

  html += '<div class="rd-cols">';

  // ===== COLUMNA IZQUIERDA: tabla principal =====
  html += '<div class="rd-left">';

  if (matrices.length && empleados.length) {
    html += '<div class="informe-wrap"><div class="informe-title">Rendimiento x Matriz</div><div class="informe-scroll">';
    html += '<table class="rd-main">';
    // Headers dobles
    html += '<thead>';
    html += '<tr><th rowspan="2" class="rd-th-n">N</th><th rowspan="2" class="rd-th-mat">Matriz</th><th rowspan="2" class="rd-th-seg">Seg<br>Prom</th>';
    empleados.forEach(leg => {
      const nombre = empMap.get(leg)?.Empleado || leg;
      html += '<th colspan="2" class="rd-th-emp">' + esc(nombre) + '</th>';
    });
    html += '</tr><tr>';
    empleados.forEach(() => {
      html += '<th class="rd-th-sub">Seg</th><th class="rd-th-sub">Ptje</th>';
    });
    html += '</tr></thead><tbody>';

    matrices.forEach(mat => {
      const info = matMap.get(mat);
      const nombre = info?.Matriz || "";
      const tHist = n(info?.Tiempo_Historico);
      html += '<tr>';
      html += '<td class="rd-num">' + esc(mat) + '</td>';
      html += '<td class="rd-mat-name">' + esc(nombre) + '</td>';
      html += '<td class="rd-seg-prom">' + (tHist > 0 ? tHist.toFixed(1) : "") + '</td>';
      empleados.forEach(leg => {
        const g = dataMap.get(mat + "__" + leg);
        if (g && g.uni > 0) {
          const segXUni = g.segTrab / g.uni;
          const premio = tHist > 0 ? (-(segXUni / tHist - 1)) * 10 : null;
          html += '<td class="rd-cell-seg">' + segXUni.toFixed(1) + '</td>';
          html += '<td class="rd-cell-ptje">' + (premio === null ? "-" : premio.toFixed(1)) + '</td>';
        } else {
          html += '<td class="rd-cell-seg"></td><td class="rd-cell-ptje"></td>';
        }
      });
      html += '</tr>';
    });

    // Rows de resumen
    const sumRow = (label, getVal) => {
      let row = '<tr class="rd-sum"><td colspan="3" class="rd-sum-label">' + esc(label) + '</td>';
      empleados.forEach(leg => { row += '<td colspan="2" class="rd-sum-val">' + esc(getVal(leg)) + '</td>'; });
      row += '</tr>';
      return row;
    };
    html += sumRow("Puntaje Diario", leg => {
      const p = puntajeByEmp.get(leg);
      return (p === null || p === undefined) ? "-" : p.toFixed(1);
    });
    html += sumRow("Hs Total Trabajadas", leg => rdFmtHsMin(hsTotalByEmp.get(leg) || 0));
    html += sumRow("Total Tiempos Muertos", leg => {
      const em = tmByTypeByEmp.get(leg); let t = 0;
      if (em) em.forEach(s => t += s);
      return t > 0 ? rdFmtHsMin(t) : "-";
    });
    html += sumRow("Hs Totales Del Dia", leg => {
      const hsT = hsTotalByEmp.get(leg) || 0;
      const em = tmByTypeByEmp.get(leg); let hsM = 0;
      if (em) em.forEach(s => hsM += s);
      return rdFmtHsMin(hsT + hsM);
    });
    html += sumRow("Hs Faltantes", leg => {
      const hsT = hsTotalByEmp.get(leg) || 0;
      const em = tmByTypeByEmp.get(leg); let hsM = 0;
      if (em) em.forEach(s => hsM += s);
      const td = hsT + hsM;
      return td >= RD_JORNADA_SEG ? "COMPLETO" : rdFmtHsMin(RD_JORNADA_SEG - td);
    });

    html += '</tbody></table></div></div>';

    // Tabla de TMs
    if (tmTypes.length) {
      html += '<div class="informe-wrap" style="margin-top:12px"><div class="informe-title">Tiempos Muertos del Dia</div><div class="informe-scroll">';
      html += '<table class="rd-main"><thead><tr><th colspan="3" class="rd-th-tmhdr">Tipo</th>';
      empleados.forEach(leg => {
        const nombre = empMap.get(leg)?.Empleado || leg;
        html += '<th colspan="2" class="rd-th-emp">' + esc(nombre) + '</th>';
      });
      html += '</tr></thead><tbody>';
      tmTypes.forEach(tipo => {
        const nombreTM = tmNombres.get(tipo) || tipo;
        html += '<tr><td colspan="3" class="rd-sum-label">' + esc(nombreTM) + '</td>';
        empleados.forEach(leg => {
          const em = tmByTypeByEmp.get(leg);
          const seg = em ? (em.get(tipo) || 0) : 0;
          html += '<td colspan="2" class="rd-sum-val">' + (seg > 0 ? rdFmtHsMin(seg) : "-") + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div></div>';
    }
  } else {
    html += '<p style="color:#888;padding:20px;">Sin datos de cajones ni TMs para el rango seleccionado.</p>';
  }

  html += '</div>'; // rd-left

  // ===== COLUMNA DERECHA: piedra / david / eduardo =====
  html += '<div class="rd-right">';

  // Piedra
  if (piedraEmps.length) {
    const tHist501 = n(matMap.get("501")?.Tiempo_Historico);
    html += '<div class="informe-wrap"><div class="informe-title">Piedra</div>';
    html += '<table class="rd-side"><thead><tr><th>Empleado</th><th>KG(Uni)</th><th>Ptje</th></tr></thead><tbody>';
    piedraEmps.forEach(leg => {
      const nombre = empMap.get(leg)?.Empleado || leg;
      const g = dataMap.get("501__" + leg);
      let kg = "-", pt = "-";
      if (g && g.uni > 0) {
        kg = String(g.uni);
        const segXUni = g.segTrab / g.uni;
        const premio = tHist501 > 0 ? (-(segXUni / tHist501 - 1)) * 10 : 0;
        pt = premio.toFixed(1);
      }
      html += '<tr><td>' + esc(nombre) + '</td><td>' + esc(kg) + '</td><td>' + esc(pt) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  // David
  if (davidCMs.length || davidOtrosTM.length) {
    html += '<div class="informe-wrap" style="margin-top:12px"><div class="informe-title">David - Detalle</div>';
    html += '<table class="rd-side"><tbody>';
    davidCMs.forEach(cm => {
      html += '<tr><td>' + esc("Cambie matriz " + cm.destino) + '</td><td class="r">' + esc(rdFmtHsMin(cm.seg)) + '</td></tr>';
    });
    if (davidCMs.length && davidOtrosTM.length) html += '<tr><td colspan="2" style="border-top:1px solid #bbb;padding:0;height:2px;"></td></tr>';
    davidOtrosTM.forEach(tm => {
      html += '<tr><td>' + esc(tm.nombre) + '</td><td class="r">' + esc(rdFmtHsMin(tm.seg)) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  // Eduardo
  if (eduardoMats.length || eduardoTMs.length) {
    html += '<div class="informe-wrap" style="margin-top:12px"><div class="informe-title">Eduardo - Detalle</div>';
    html += '<table class="rd-side"><thead><tr><th>N</th><th>Desc</th><th class="r">Prom</th><th class="r">Ptje</th></tr></thead><tbody>';
    eduardoMats.forEach(em => {
      html += '<tr>';
      html += '<td>' + esc(em.matriz) + '</td>';
      html += '<td>' + esc(em.nombre) + '</td>';
      html += '<td class="r">' + (em.prom > 0 ? em.prom.toFixed(1) : "") + '</td>';
      html += '<td class="r">' + (em.premio === null ? "-" : em.premio.toFixed(1)) + '</td>';
      html += '</tr>';
    });
    if (eduardoMats.length && eduardoTMs.length) html += '<tr><td colspan="4" style="border-top:1px solid #bbb;padding:0;height:2px;"></td></tr>';
    eduardoTMs.forEach(tm => {
      html += '<tr><td colspan="3">' + esc(tm.nombre) + '</td><td class="r">' + esc(rdFmtHsMin(tm.seg)) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }

  html += '</div>'; // rd-right
  html += '</div>'; // rd-cols
  html += '</div>'; // rd-wrap

  resultEl.innerHTML = html;
}

/* ================= PDF REPORTE DIARIO (mismo formato que el edge) ================= */
function rdDrawPage(
  doc, titulo, pageNum, totalPages,
  matrices, empleadosSlice,
  matMap, empMap,
  dataMap, hsTotalByEmp, puntajeByEmp,
  tmByTypeByEmp, tmTypes, tmNombres,
  piedraEmps, showPiedra,
  davidCMs, davidOtrosTM,
  eduardoMats, eduardoTMs
) {
  const pageW = 297, pageH = 210, marginL = 8, marginT = 8;
  const fontSize = 10, headerFontSize = 9, subHeaderFontSize = 8;
  const labelFontSize = fontSize + 2;
  const colN = 12, colMatriz = 55, colSegProm = 10;
  const fixedW = colN + colMatriz + colSegProm;
  const colEmpSingle = 10, colEmpPair = colEmpSingle * 2;
  const tableW = fixedW + colEmpPair * empleadosSlice.length;
  const rowH = 7, tmRowH = 7;
  const headerH1 = 9, headerH2 = 6, headerH = headerH1 + headerH2;

  const pGap = 3, pColNombre = 20, pColKG = 11, pColPtje = 10;
  const pTableW = pColNombre + pColKG + pColPtje;
  const pX = marginL + tableW + pGap;
  const hasPiedra = showPiedra && piedraEmps.length > 0;
  const davidHasData = davidCMs.length > 0 || davidOtrosTM.length > 0;
  const eduardoHasData = eduardoMats.length > 0 || eduardoTMs.length > 0;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text(titulo, marginL, marginT + 5);
  if (totalPages > 1) { doc.setFontSize(9); doc.setFont("helvetica", "normal"); doc.text("Pagina " + pageNum + " de " + totalPages, pageW - marginL, marginT + 5, { align: "right" }); }

  let y = marginT + 10;
  const tableStartY = y;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(headerFontSize); doc.setFont("helvetica", "bold");
  doc.text("N", marginL + colN / 2, y + headerH / 2 + 1, { align: "center" });
  doc.text("Matriz", marginL + colN + colMatriz / 2, y + headerH / 2 + 1, { align: "center" });
  doc.setFontSize(7);
  doc.text("Seg", marginL + colN + colMatriz + colSegProm / 2, y + headerH / 2 - 1, { align: "center" });
  doc.text("Prom", marginL + colN + colMatriz + colSegProm / 2, y + headerH / 2 + 3, { align: "center" });

  let x = marginL + fixedW;
  empleadosSlice.forEach((leg) => {
    const nombre = empMap.get(leg)?.Empleado || leg; const parts = nombre.trim().split(/\s+/);
    doc.setFontSize(headerFontSize); doc.setFont("helvetica", "bold");
    doc.text(parts[0] || "", x + colEmpPair / 2, y + 4, { align: "center" });
    if (parts.length > 1) { doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.text(parts.slice(1).join(" ").substring(0, 14), x + colEmpPair / 2, y + 7.5, { align: "center" }); }
    doc.setFontSize(subHeaderFontSize); doc.setFont("helvetica", "bold");
    doc.text("Seg", x + colEmpSingle / 2, y + headerH - 1.5, { align: "center" });
    doc.text("Ptje", x + colEmpSingle + colEmpSingle / 2, y + headerH - 1.5, { align: "center" });
    x += colEmpPair;
  });
  doc.setDrawColor(80, 80, 80); doc.setLineWidth(0.1);
  doc.line(marginL + fixedW, y + headerH1, marginL + tableW, y + headerH1);
  doc.line(marginL + colN, y, marginL + colN, y + headerH); doc.line(marginL + colN + colMatriz, y, marginL + colN + colMatriz, y + headerH); doc.line(marginL + fixedW, y, marginL + fixedW, y + headerH);
  x = marginL + fixedW; empleadosSlice.forEach(() => { doc.line(x, y, x, y + headerH); doc.line(x + colEmpSingle, y + headerH1, x + colEmpSingle, y + headerH); x += colEmpPair; });
  y += headerH;

  doc.setTextColor(0, 0, 0); const rowYPositions = [];
  matrices.forEach((mat) => {
    if (y + rowH > pageH - 16) {
      doc.addPage(); y = marginT + 5;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text("N", marginL + colN / 2, y + 4, { align: "center" });
      doc.text("Matriz", marginL + colN + colMatriz / 2, y + 4, { align: "center" });
      doc.text("Seg P", marginL + colN + colMatriz + colSegProm / 2, y + 4, { align: "center" });
      let hx = marginL + fixedW;
      empleadosSlice.forEach((leg) => { doc.text((empMap.get(leg)?.Empleado || leg).trim().split(/\s+/)[0] || "", hx + colEmpPair / 2, y + 4, { align: "center" }); hx += colEmpPair; });
      y += 6;
    }
    rowYPositions.push(y);
    const info = matMap.get(mat); const nombre = info?.Matriz || ""; const tHist = n(info?.Tiempo_Historico);
    doc.setFontSize(fontSize); doc.setFont("helvetica", "bold"); doc.setTextColor(0, 0, 0);
    doc.text(mat, marginL + colN / 2, y + rowH / 2 + 1, { align: "center" });
    doc.setFont("helvetica", "normal"); doc.setFontSize(fontSize - 1);
    doc.text(nombre.substring(0, 35), marginL + colN + 2, y + rowH / 2 + 1);
    doc.setFontSize(fontSize); doc.setFont("helvetica", "bold");
    doc.text(tHist > 0 ? tHist.toFixed(1) : "", marginL + colN + colMatriz + colSegProm / 2, y + rowH / 2 + 1, { align: "center" });
    let cx = marginL + fixedW;
    empleadosSlice.forEach((leg) => {
      const g = dataMap.get(mat + "__" + leg);
      if (g && g.uni > 0) {
        const segXUni = g.segTrab / g.uni;
        doc.setFontSize(fontSize); doc.setFont("helvetica", "normal"); doc.setTextColor(0, 0, 0);
        if (tHist > 0) {
          doc.text(segXUni.toFixed(1), cx + colEmpSingle / 2, y + rowH / 2 + 1, { align: "center" });
          const premio = (-(segXUni / tHist - 1)) * 10;
          doc.setFont("helvetica", "bold");
          doc.text(premio.toFixed(1), cx + colEmpSingle + colEmpSingle / 2, y + rowH / 2 + 1, { align: "center" });
        } else {
          doc.text(segXUni.toFixed(1), cx + colEmpSingle / 2, y + rowH / 2 + 1, { align: "center" });
          doc.setFont("helvetica", "bold");
          doc.text("-", cx + colEmpSingle + colEmpSingle / 2, y + rowH / 2 + 1, { align: "center" });
        }
      }
      cx += colEmpPair;
    });
    y += rowH;
  });

  doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.15);
  for (let i = 1; i < rowYPositions.length; i++) { doc.line(marginL, rowYPositions[i], marginL + tableW, rowYPositions[i]); }

  doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
  doc.rect(marginL, tableStartY, tableW, y - tableStartY);

  doc.setLineWidth(0.3);
  doc.line(marginL + colN, tableStartY, marginL + colN, y); doc.line(marginL + colN + colMatriz, tableStartY, marginL + colN + colMatriz, y); doc.line(marginL + fixedW, tableStartY, marginL + fixedW, y);
  doc.setLineWidth(0.2); let vx = marginL + fixedW;
  empleadosSlice.forEach(() => { doc.line(vx, tableStartY, vx, y); doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.1); doc.line(vx + colEmpSingle, tableStartY + headerH, vx + colEmpSingle, y); doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.2); vx += colEmpPair; });

  const sumRowH = 7;
  const drawSumRow = (label, startY, getValue) => {
    doc.setTextColor(0, 0, 0); doc.setFontSize(labelFontSize); doc.setFont("helvetica", "bold");
    doc.text(label, marginL + colN + 2, startY + sumRowH / 2 + 1.5);
    let cx = marginL + fixedW;
    empleadosSlice.forEach((leg) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(fontSize); doc.setFont("helvetica", "bold");
      doc.text(getValue(leg), cx + colEmpPair / 2, startY + sumRowH / 2 + 1.5, { align: "center" });
      cx += colEmpPair;
    });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5); doc.rect(marginL, startY, tableW, sumRowH);
    doc.setLineWidth(0.3); doc.line(marginL + colN, startY, marginL + colN, startY + sumRowH); doc.line(marginL + colN + colMatriz, startY, marginL + colN + colMatriz, startY + sumRowH); doc.line(marginL + fixedW, startY, marginL + fixedW, startY + sumRowH);
    doc.setLineWidth(0.2); let svx = marginL + fixedW;
    empleadosSlice.forEach(() => { doc.line(svx, startY, svx, startY + sumRowH); svx += colEmpPair; });
  };

  drawSumRow("Puntaje Diario", y, (leg) => {
    const p = puntajeByEmp.get(leg);
    return p === null || p === undefined ? "-" : p.toFixed(1);
  });
  y += sumRowH;

  drawSumRow("Hs Total Trabajadas", y, (leg) => rdFmtHsMin(hsTotalByEmp.get(leg) || 0));
  y += sumRowH;

  drawSumRow("Total Tiempos Muertos", y, (leg) => {
    const empTm = tmByTypeByEmp.get(leg); let totalSeg = 0;
    if (empTm) empTm.forEach((seg) => { totalSeg += seg; });
    return totalSeg > 0 ? rdFmtHsMin(totalSeg) : "-";
  });
  y += sumRowH;

  drawSumRow("Hs Totales Del Dia", y, (leg) => {
    const hsTrab = hsTotalByEmp.get(leg) || 0;
    const empTm = tmByTypeByEmp.get(leg); let hsTm = 0;
    if (empTm) empTm.forEach((seg) => { hsTm += seg; });
    return rdFmtHsMin(hsTrab + hsTm);
  });
  y += sumRowH;

  drawSumRow("Hs Faltantes", y, (leg) => {
    const hsTrab = hsTotalByEmp.get(leg) || 0;
    const empTm = tmByTypeByEmp.get(leg); let hsTm = 0;
    if (empTm) empTm.forEach((seg) => { hsTm += seg; });
    const totalDia = hsTrab + hsTm;
    if (totalDia >= RD_JORNADA_SEG) return "COMPLETO";
    return rdFmtHsMin(RD_JORNADA_SEG - totalDia);
  });
  y += sumRowH;

  if (tmTypes.length > 0) {
    let tmY = y + 4;
    doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("Tiempos Muertos del Dia", marginL, tmY + 3);
    tmY += 5;
    const tmStartY = tmY;
    tmTypes.forEach((tipo) => {
      const nombreTM = tmNombres.get(tipo) || tipo;
      doc.setTextColor(0, 0, 0); doc.setFontSize(labelFontSize); doc.setFont("helvetica", "bold");
      doc.text(nombreTM.substring(0, 25), marginL + colN + 2, tmY + tmRowH / 2 + 1);
      let cx3 = marginL + fixedW;
      empleadosSlice.forEach((leg) => {
        const empTm = tmByTypeByEmp.get(leg);
        const seg = empTm ? (empTm.get(tipo) || 0) : 0;
        doc.setTextColor(0, 0, 0); doc.setFontSize(fontSize); doc.setFont("helvetica", "bold");
        doc.text(seg > 0 ? rdFmtHsMin(seg) : "-", cx3 + colEmpPair / 2, tmY + tmRowH / 2 + 1, { align: "center" });
        cx3 += colEmpPair;
      });
      tmY += tmRowH;
    });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.4);
    doc.rect(marginL, tmStartY, tableW, tmY - tmStartY);
    doc.setLineWidth(0.2);
    doc.line(marginL + colN, tmStartY, marginL + colN, tmY);
    doc.line(marginL + colN + colMatriz, tmStartY, marginL + colN + colMatriz, tmY);
    doc.line(marginL + fixedW, tmStartY, marginL + fixedW, tmY);
    vx = marginL + fixedW;
    empleadosSlice.forEach(() => { doc.line(vx, tmStartY, vx, tmY); vx += colEmpPair; });
    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
    let tmLineY = tmStartY;
    for (let i = 0; i < tmTypes.length - 1; i++) { tmLineY += tmRowH; doc.line(marginL, tmLineY, marginL + tableW, tmLineY); }
  }

  let rightY = tableStartY;
  if (hasPiedra) {
    let pY = tableStartY;
    const tHist501 = n(matMap.get("501")?.Tiempo_Historico);
    const pHeaderH = 8, pSubH = 6, pRowH = 7;

    doc.setTextColor(0, 0, 0); doc.setFontSize(9); doc.setFont("helvetica", "bold");
    doc.text("Piedra", pX + pTableW / 2, pY + pHeaderH / 2 + 1, { align: "center" });
    pY += pHeaderH;

    doc.setTextColor(0, 0, 0); doc.setFontSize(6); doc.setFont("helvetica", "bold");
    doc.text("Empleado", pX + pColNombre / 2, pY + pSubH / 2 + 1, { align: "center" });
    doc.text("KG(Uni)", pX + pColNombre + pColKG / 2, pY + pSubH / 2 + 1, { align: "center" });
    doc.text("Ptje", pX + pColNombre + pColKG + pColPtje / 2, pY + pSubH / 2 + 1, { align: "center" });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.1);
    doc.line(pX + pColNombre, pY, pX + pColNombre, pY + pSubH);
    doc.line(pX + pColNombre + pColKG, pY, pX + pColNombre + pColKG, pY + pSubH);
    pY += pSubH;

    const pDataStartY = pY;
    piedraEmps.forEach((leg) => {
      const nombreFull = (empMap.get(leg)?.Empleado || leg).trim();
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(nombreFull.substring(0, 12), pX + 1.5, pY + pRowH / 2 + 1);

      const g = dataMap.get("501__" + leg);
      if (g && g.uni > 0) {
        doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "normal");
        doc.text(String(g.uni), pX + pColNombre + pColKG / 2, pY + pRowH / 2 + 1, { align: "center" });

        const segXUni = g.segTrab / g.uni;
        const premio = tHist501 > 0 ? (-(segXUni / tHist501 - 1)) * 10 : 0;
        doc.setTextColor(0, 0, 0); doc.setFont("helvetica", "bold");
        doc.text(premio.toFixed(1), pX + pColNombre + pColKG + pColPtje / 2, pY + pRowH / 2 + 1, { align: "center" });
      }
      pY += pRowH;
    });

    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
    let pLineY = pDataStartY;
    for (let i = 0; i < piedraEmps.length - 1; i++) { pLineY += pRowH; doc.line(pX, pLineY, pX + pTableW, pLineY); }

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.15);
    doc.line(pX + pColNombre, pDataStartY, pX + pColNombre, pY);
    doc.line(pX + pColNombre + pColKG, pDataStartY, pX + pColNombre + pColKG, pY);

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.rect(pX, tableStartY, pTableW, pY - tableStartY);
    doc.setLineWidth(0.3);
    doc.line(pX, tableStartY + pHeaderH, pX + pTableW, tableStartY + pHeaderH);
    doc.line(pX, tableStartY + pHeaderH + pSubH, pX + pTableW, tableStartY + pHeaderH + pSubH);
    rightY = pY;
  }

  if (showPiedra && davidHasData) {
    let dY = rightY + (hasPiedra ? 3 : 0);
    const dHeaderH = 7, dRowH = 5.5;
    const dBoxStart = dY;

    doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("David - Detalle", pX + pTableW / 2, dY + dHeaderH / 2 + 1, { align: "center" });
    dY += dHeaderH;

    const dDataStartY = dY;

    davidCMs.forEach((cm) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(("Cambie matriz " + cm.destino).substring(0, 22), pX + 1.5, dY + dRowH / 2 + 1.2);
      doc.setFont("helvetica", "normal");
      doc.text(rdFmtHsMin(cm.seg), pX + pTableW - 1.5, dY + dRowH / 2 + 1.2, { align: "right" });
      dY += dRowH;
    });

    if (davidCMs.length > 0 && davidOtrosTM.length > 0) {
      doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3);
      doc.line(pX, dY, pX + pTableW, dY);
    }

    davidOtrosTM.forEach((tm) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text((tm.nombre || "").substring(0, 22), pX + 1.5, dY + dRowH / 2 + 1.2);
      doc.setFont("helvetica", "normal");
      doc.text(rdFmtHsMin(tm.seg), pX + pTableW - 1.5, dY + dRowH / 2 + 1.2, { align: "right" });
      dY += dRowH;
    });

    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
    let dLineY = dDataStartY;
    const totalDRows = davidCMs.length + davidOtrosTM.length;
    for (let i = 0; i < totalDRows - 1; i++) {
      dLineY += dRowH;
      if (i === davidCMs.length - 1 && davidOtrosTM.length > 0) continue;
      doc.line(pX, dLineY, pX + pTableW, dLineY);
    }

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.rect(pX, dBoxStart, pTableW, dY - dBoxStart);
    doc.setLineWidth(0.3);
    doc.line(pX, dBoxStart + dHeaderH, pX + pTableW, dBoxStart + dHeaderH);
    rightY = dY;
  }

  if (showPiedra && eduardoHasData) {
    const eColN = 7, eColDesc = 15, eColProm = 8, eColPtje = pTableW - eColN - eColDesc - eColProm;
    const eHeaderH = 7, eSubH = 5, eRowH = 5.5;
    let eY = rightY + ((hasPiedra || davidHasData) ? 3 : 0);
    const eBoxStart = eY;

    doc.setTextColor(0, 0, 0); doc.setFontSize(8); doc.setFont("helvetica", "bold");
    doc.text("Eduardo - Detalle", pX + pTableW / 2, eY + eHeaderH / 2 + 1, { align: "center" });
    eY += eHeaderH;

    doc.setTextColor(0, 0, 0); doc.setFontSize(6); doc.setFont("helvetica", "bold");
    doc.text("N", pX + eColN / 2, eY + eSubH / 2 + 1, { align: "center" });
    doc.text("Desc", pX + eColN + eColDesc / 2, eY + eSubH / 2 + 1, { align: "center" });
    doc.text("Prom", pX + eColN + eColDesc + eColProm / 2, eY + eSubH / 2 + 1, { align: "center" });
    doc.text("Ptje", pX + eColN + eColDesc + eColProm + eColPtje / 2, eY + eSubH / 2 + 1, { align: "center" });
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.1);
    doc.line(pX + eColN, eY, pX + eColN, eY + eSubH);
    doc.line(pX + eColN + eColDesc, eY, pX + eColN + eColDesc, eY + eSubH);
    doc.line(pX + eColN + eColDesc + eColProm, eY, pX + eColN + eColDesc + eColProm, eY + eSubH);
    eY += eSubH;

    const eDataStartY = eY;

    eduardoMats.forEach((em) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text(em.matriz, pX + eColN / 2, eY + eRowH / 2 + 1.2, { align: "center" });
      doc.setFont("helvetica", "normal"); doc.setFontSize(6);
      doc.text((em.nombre || "").substring(0, 11), pX + eColN + 1, eY + eRowH / 2 + 1.2);
      doc.setFontSize(7);
      doc.text(em.prom > 0 ? em.prom.toFixed(1) : "", pX + eColN + eColDesc + eColProm / 2, eY + eRowH / 2 + 1.2, { align: "center" });
      doc.setFont("helvetica", "bold");
      doc.text(em.premio === null ? "-" : em.premio.toFixed(1), pX + eColN + eColDesc + eColProm + eColPtje / 2, eY + eRowH / 2 + 1.2, { align: "center" });
      eY += eRowH;
    });

    if (eduardoMats.length > 0 && eduardoTMs.length > 0) {
      doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.3);
      doc.line(pX, eY, pX + pTableW, eY);
    }

    eduardoTMs.forEach((tm) => {
      doc.setTextColor(0, 0, 0); doc.setFontSize(7); doc.setFont("helvetica", "bold");
      doc.text((tm.nombre || "").substring(0, 22), pX + 1.5, eY + eRowH / 2 + 1.2);
      doc.setFont("helvetica", "normal");
      doc.text(rdFmtHsMin(tm.seg), pX + pTableW - 1.5, eY + eRowH / 2 + 1.2, { align: "right" });
      eY += eRowH;
    });

    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.1);
    let eLineY = eDataStartY;
    const totalERows = eduardoMats.length + eduardoTMs.length;
    for (let i = 0; i < totalERows - 1; i++) {
      eLineY += eRowH;
      if (i === eduardoMats.length - 1 && eduardoTMs.length > 0) continue;
      doc.line(pX, eLineY, pX + pTableW, eLineY);
    }

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.15);
    const matricesEndY = eDataStartY + eduardoMats.length * eRowH;
    doc.line(pX + eColN, eDataStartY, pX + eColN, matricesEndY);
    doc.line(pX + eColN + eColDesc, eDataStartY, pX + eColN + eColDesc, matricesEndY);
    doc.line(pX + eColN + eColDesc + eColProm, eDataStartY, pX + eColN + eColDesc + eColProm, matricesEndY);

    doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5);
    doc.rect(pX, eBoxStart, pTableW, eY - eBoxStart);
    doc.setLineWidth(0.3);
    doc.line(pX, eBoxStart + eHeaderH, pX + pTableW, eBoxStart + eHeaderH);
    doc.line(pX, eBoxStart + eHeaderH + eSubH, pX + pTableW, eBoxStart + eHeaderH + eSubH);
    rightY = eY;
  }
}

btnPDFDiario.addEventListener("click", () => {
  if (!cachedRows.length) { alert("Primero generá el informe"); return; }
  // Aplicar los mismos filtros que están en pantalla (selectedEmpleados, selectedTipos, filtroMatriz)
  const selLegs = [...selectedEmpleados];
  let rows = [...cachedRows];
  if (selLegs.length > 0) {
    const legSet = new Set(selLegs);
    rows = rows.filter(r => legSet.has(String(r.Legajo || "").trim()));
  } else {
    const activosSet = new Set(empleadosCache.filter(e => String(e.Activo).toUpperCase() === "SI").map(e => String(e.Legajo).trim()));
    rows = rows.filter(r => activosSet.has(String(r.Legajo || "").trim()));
  }
  if (selectedTipos.size > 0) {
    rows = rows.filter(r => {
      const matId = String(r.Matriz || "").trim();
      if (!esMatriz(matId)) return true;
      const info = matMap.get(matId);
      const tipo = info ? String(info.Tipo_Matriz || "").trim() : "";
      return selectedTipos.has(tipo);
    });
  }

  const data = computeRDiarioData(rows, empMap, matMap);
  const { matrices, empleados, piedraEmps, dataMap, hsTotalByEmp, puntajeByEmp, tmByTypeByEmp, tmTypes, tmNombres, davidCMs, davidOtrosTM, eduardoMats, eduardoTMs } = data;

  const anyRight = piedraEmps.length > 0 || davidCMs.length + davidOtrosTM.length > 0 || eduardoMats.length + eduardoTMs.length > 0;
  const reservaLateral = anyRight ? 44 : 0;
  const maxEmpsPerPage = Math.max(1, Math.floor((297 - 16 - 77 - reservaLateral) / 20));
  const empGroups = [];
  for (let i = 0; i < empleados.length; i += maxEmpsPerPage) empGroups.push(empleados.slice(i, i + maxEmpsPerPage));
  if (empGroups.length === 0) empGroups.push([]);

  const fechaIso = fechaDesde.value || new Date().toISOString().slice(0, 10);
  const tituloFecha = fechaIso.split("-").reverse().join("/");
  const ahora = new Date();
  const hhmm = String(ahora.getHours()).padStart(2,"0") + ":" + String(ahora.getMinutes()).padStart(2,"0");
  const titulo = "Rendimiento x Matriz - " + tituloFecha + " " + hhmm;

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  if (matrices.length === 0 && piedraEmps.length === 0 && !davidCMs.length && !davidOtrosTM.length && !eduardoMats.length && !eduardoTMs.length) {
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text(titulo, 8, 15);
    doc.setFontSize(12); doc.setFont("helvetica", "normal");
    doc.text("Sin registros de produccion para la fecha.", 8, 28);
  } else {
    empGroups.forEach((group, idx) => {
      if (idx > 0) doc.addPage();
      rdDrawPage(doc, titulo, idx + 1, empGroups.length, matrices, group, matMap, empMap, dataMap, hsTotalByEmp, puntajeByEmp, tmByTypeByEmp, tmTypes, tmNombres, piedraEmps, idx === 0, davidCMs, davidOtrosTM, eduardoMats, eduardoTMs);
    });
  }

  doc.save("rendimiento_" + fechaIso + ".pdf");
});

/* ================= INIT ================= */
selVista.addEventListener("change", () => {
  const v = selVista.value;
  fieldFechaRango.style.display = (v === "unidades" || v === "matriz2") ? "none" : "";
  if (v === "matriz2") {
    // limpiar resultados previos y subfiltros al cambiar a esta vista
    resultEl.innerHTML = "";
    subfiltros.classList.add("hidden");
    statusEl.textContent = "";
  }
  if (!fpFecha) return;
  if (selVista.value === "rdiario") {
    fpFecha.set("mode", "single");
    const hoy = new Date();
    const hoyIso = hoy.getFullYear() + "-" +
                   String(hoy.getMonth() + 1).padStart(2, "0") + "-" +
                   String(hoy.getDate()).padStart(2, "0");
    fpFecha.setDate(hoy, true);
    fechaDesde.value = hoyIso;
    fechaHasta.value = hoyIso;
  } else {
    fpFecha.set("mode", "range");
    if (fechaDesde.value && fechaHasta.value) {
      // Construir Date objects desde componentes locales (flatpickr parsea mal strings YYYY-MM-DD con dateFormat d/m/Y)
      const [y1, m1, d1] = fechaDesde.value.split('-').map(Number);
      const [y2, m2, d2] = fechaHasta.value.split('-').map(Number);
      fpFecha.setDate([new Date(y1, m1 - 1, d1), new Date(y2, m2 - 1, d2)], true);
    }
  }
});

init();
