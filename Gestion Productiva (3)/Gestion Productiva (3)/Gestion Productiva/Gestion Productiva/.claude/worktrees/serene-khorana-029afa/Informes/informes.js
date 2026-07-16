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

let selectedEmpleados = new Set();
let empleadosCache = [];

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
    const hoy = new Date();
    const hace30 = new Date(hoy); hace30.setDate(hace30.getDate() - 30);
    fechaHasta.value = hoy.toISOString().slice(0, 10);
    fechaDesde.value = hace30.toISOString().slice(0, 10);

    // Flatpickr rango
    flatpickr("#fechaRango", {
      mode: "range",
      dateFormat: "d/m/Y",
      locale: "es",
      defaultDate: [hace30, hoy],
      onChange: function(dates) {
        if (dates.length === 2) {
          fechaDesde.value = dates[0].toISOString().slice(0, 10);
          fechaHasta.value = dates[1].toISOString().slice(0, 10);
        }
      }
    });

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

  btnGenerar.disabled = true;
  statusEl.textContent = "Cargando datos...";
  resultEl.innerHTML = "";

  try {
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

    // Mostrar subfiltros
    subfiltros.classList.toggle("hidden", esUnidades);
    filtroMatrizWrap.classList.toggle("hidden", currentVista !== "matriz");

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

  if (selLegs.length > 0) {
    const legSet = new Set(selLegs);
    rows = rows.filter(r => legSet.has(String(r.Legajo || "").trim()));
  } else {
    const activosSet = new Set(empleadosCache.filter(e => String(e.Activo).toUpperCase() === "SI").map(e => String(e.Legajo).trim()));
    rows = rows.filter(r => activosSet.has(String(r.Legajo || "").trim()));
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

  // Agregar event listeners a las celdas de datos
  const celdas = resultEl.querySelectorAll(".informe-scroll tbody td.r");
  celdas.forEach(celda => {
    celda.style.cursor = "pointer";
    celda.addEventListener("click", async (e) => {
      const tr = celda.closest("tr");
      if (!tr || tr.classList.contains("sep")) return;

      const matNum = tr.querySelector("td:nth-child(1)")?.textContent?.trim();
      const colIdx = Array.from(tr.children).indexOf(celda);

      // Encontrar empleado por columna
      const empleadoIdx = colIdx - 3; // Después de N, Matriz, Seg Prom
      if (empleadoIdx < 0 || empleadoIdx >= empleados.length) return;

      const legajo = empleados[empleadoIdx];
      await mostrarDetalles(matNum, legajo);
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
    // Cargar registros de db_n8n_espejo para esta matriz + legajo
    const { data, error } = await sb.from("db_n8n_espejo")
      .select("*")
      .eq("Legajo", legajo)
      .eq("Matriz", matriz)
      .in("Dia", [cachedRows[0]?.Dia || 0])
      .order("Fecha", { ascending: true });

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

function showExportBtns() {
  btnExcelInf.classList.remove("hidden");
  btnPDFInf.classList.remove("hidden");
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
  return vista + " (" + fechaDesde.value + " a " + fechaHasta.value + ")";
}

btnExcelInf.addEventListener("click", async () => {
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

    // Fila de titulo para vista unidades
    let titleRowOffset = 0;
    if (esUnidades && exportTitleOverride) {
      const titleRow = ws.addRow([exportTitleOverride]);
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
      // Row 1: fixed headers merged down + operator names merged across
      const row1 = ws.getRow(1);
      const row2 = ws.getRow(2);

      fixedCols.forEach(ci => {
        ws.mergeCells(1, ci + 1, 2, ci + 1);
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
        if (sc !== ec) ws.mergeCells(1, sc, 1, ec);
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

/* ================= INIT ================= */
selVista.addEventListener("change", () => {
  fieldFechaRango.style.display = selVista.value === "unidades" ? "none" : "";
});

init();
