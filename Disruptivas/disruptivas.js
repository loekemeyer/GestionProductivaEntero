"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const fechaDesde = document.getElementById("fechaDesde");
const fechaHasta = document.getElementById("fechaHasta");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");

/* ================= HELPERS ================= */
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function f(v, d = 0) { return Number(v || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: d }); }
function esc(s) { return String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function cls(v) { return n(v) > 0 ? "pos" : n(v) < 0 ? "neg" : ""; }
function esMatriz(mat) { return /^\d+\w*$/.test(String(mat || "").trim()); }

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

/* ================= STATE ================= */
let allRows = [];
let empMap = new Map();
let matMap = new Map();
let empleadosCache = [];
let selectedEmpleados = new Set();
let lastPositivas = [];
let lastNegativas = [];
const empGrid = document.getElementById("empGrid");

/* ================= INIT ================= */
let allRowsRaw = []; // todos los registros sin filtrar por fecha

async function init() {
  fechaHasta.value = new Date().toISOString().slice(0, 10);
  const hoy = new Date();
  fechaDesde.value = "2020-01-01";

  // Precargar empleados
  empleadosCache = await fetchAll("Empleados");
  empleadosCache.sort((a, b) => String(a.Empleado || "").localeCompare(String(b.Empleado || ""), "es"));
  const activos = empleadosCache.filter(e => String(e.Activo).toUpperCase() === "SI");

  empGrid.innerHTML =
    `<button type="button" class="emp-chip emp-chip-todos active" data-legajo="__todos__">Todos</button>` +
    activos.map(e => {
      const parts = String(e.Empleado || "").trim().split(/\s+/);
      const l1 = parts[0] || "";
      const l2 = parts.slice(1).join(" ");
      return `<button type="button" class="emp-chip" data-legajo="${esc(e.Legajo)}"><span class="emp-chip-l1">${esc(l1)}</span><span class="emp-chip-l2">${esc(l2)}</span></button>`;
    }).join("");

  const btnTodos = empGrid.querySelector('[data-legajo="__todos__"]');
  btnTodos.addEventListener("click", () => {
    selectedEmpleados.clear();
    empGrid.querySelectorAll(".emp-chip").forEach(b => b.classList.remove("active"));
    btnTodos.classList.add("active");
    if (allRows.length) renderDisruptivas();
  });
  empGrid.querySelectorAll('.emp-chip:not([data-legajo="__todos__"])').forEach(btn => {
    btn.addEventListener("click", () => {
      const leg = btn.dataset.legajo;
      if (selectedEmpleados.has(leg)) { selectedEmpleados.delete(leg); btn.classList.remove("active"); }
      else { selectedEmpleados.add(leg); btn.classList.add("active"); }
      btnTodos.classList.toggle("active", selectedEmpleados.size === 0);
      if (allRows.length) renderDisruptivas();
    });
  });

  // Cargar datos
  statusEl.textContent = "Cargando datos...";
  try {
    const [rows, matrices] = await Promise.all([
      fetchAll("db_n8n_espejo"),
      fetchAll("Matrices")
    ]);

    allRowsRaw = rows.filter(r => !r.Eliminar && !r.Revisado && !r.Anular_Tiempo);

    empMap = new Map();
    empleadosCache.forEach(e => empMap.set(String(e.Legajo || "").trim(), e));
    matMap = new Map();
    matrices.forEach(m => matMap.set(String(m.N_Matriz || "").trim(), m));

    empGrid.classList.remove("hidden");
    filtrarPorFecha();
  } catch (err) { statusEl.textContent = "Error: " + err.message; console.error(err); }

  // Filtrar en tiempo real al cambiar fechas
  fechaDesde.addEventListener("change", filtrarPorFecha);
  fechaHasta.addEventListener("change", filtrarPorFecha);
}

function filtrarPorFecha() {
  const desde = fechaDesde.value, hasta = fechaHasta.value;
  if (!desde || !hasta) return;
  const desdeD = new Date(desde + "T00:00:00-03:00");
  const hastaD = new Date(hasta + "T23:59:59-03:00");
  allRows = allRowsRaw.filter(r => {
    const ff = new Date(r.Fecha);
    return ff >= desdeD && ff <= hastaD;
  });
  renderDisruptivas();
  statusEl.textContent = `${allRows.length} registros analizados`;
}

/* ================= RENDER ================= */
function renderDisruptivas() {
  let filtered = allRows;
  if (selectedEmpleados.size > 0) {
    filtered = allRows.filter(r => selectedEmpleados.has(String(r.Legajo || "").trim()));
  }
  const prodRows = filtered.filter(r => {
    if (!esMatriz(r.Matriz) || r.Revisado || r.Anular_Tiempo) return false;
    if (String(r.Legajo || "").trim() === "1") return false;
    const mat = String(r.Matriz || "").trim();
    if (mat === "501" || mat === "502" || mat === "252") return false;
    const info = matMap.get(mat);
    if (!info || !n(info.Tiempo_Historico)) return false;
    return true;
  });

  const positivas = [];
  const negativas = [];

  prodRows.forEach(r => {
    const premio = n(r.Premio);
    const leg = String(r.Legajo || "").trim();
    const emp = empMap.get(leg);
    const mat = String(r.Matriz || "").trim();
    const info = matMap.get(mat);
    const item = {
      id: r.id,
      raw: r,
      fecha: r.Fecha ? new Date(r.Fecha).toLocaleDateString("es-AR") : "",
      legajo: leg,
      nombre: emp?.Empleado || r.Nombre_Empleado || "",
      matriz: mat,
      descMat: info?.Matriz || r.Nombre_Matriz || "",
      uni: n(r.Uni),
      segTrab: n(r.Segundos_Trabajados),
      segHist: n(r.Segundos_Historico),
      promHist: n(info?.Tiempo_Historico),
      premio: premio
    };
    if (premio > 5 && premio < 9.5) positivas.push(item);
    else if (premio < -5) negativas.push(item);
  });

  positivas.sort((a, b) => {
    const ma = parseInt(a.matriz) || 0, mb = parseInt(b.matriz) || 0;
    if (ma !== mb) return ma - mb;
    return new Date(b.raw.Fecha) - new Date(a.raw.Fecha);
  });
  negativas.sort((a, b) => {
    const ma = parseInt(a.matriz) || 0, mb = parseInt(b.matriz) || 0;
    if (ma !== mb) return ma - mb;
    return new Date(b.raw.Fecha) - new Date(a.raw.Fecha);
  });

  lastPositivas = positivas;
  lastNegativas = negativas;
  const btnExcel = document.getElementById("btnExcelDisr");
  if (btnExcel) btnExcel.classList.toggle("hidden", !positivas.length && !negativas.length);

  function buildTable(items, titulo, colorCls) {
    if (!items.length) return `<p style="color:#888;padding:12px;">Sin registros ${titulo.toLowerCase()}.</p>`;
    let h = `
    <div class="informe-wrap" style="margin-bottom:18px;">
      <div class="informe-title">${esc(titulo)} (${items.length})</div>
      <div class="informe-scroll">
        <table class="tbl">
          <thead><tr>
            <th>Fecha</th><th>Leg</th><th>Empleado</th><th>Mat</th><th>Descripcion</th>
            <th>Uni</th><th>T. Prom</th><th>Prom Hist</th><th>Seg Trab</th><th>Seg Hist</th><th>Puntaje</th><th></th>
          </tr></thead>
          <tbody>`;
    items.forEach(i => {
      h += `<tr data-rid="${i.id}">
        <td class="c">${esc(i.fecha)}</td>
        <td class="c b">${esc(i.legajo)}</td>
        <td>${esc(i.nombre)}</td>
        <td class="c b">${esc(i.matriz)}</td>
        <td>${esc(i.descMat)}</td>
        <td class="r">${f(i.uni)}</td>
        <td class="r">${i.uni > 0 ? f(i.segTrab / i.uni, 2) : "-"}</td>
        <td class="r">${f(i.promHist, 2)}</td>
        <td class="r">${f(i.segTrab)}</td>
        <td class="r">${f(i.segHist)}</td>
        <td class="c b ${colorCls}">${f(i.premio, 1)}</td>
        <td class="c" style="white-space:nowrap;">
          <button class="btn-icon btn-ok" title="Revisado" onclick="revisarDisruptiva(${i.id}, this)">&#10003;</button>
          <button class="btn-icon btn-edit" title="Editar" onclick="abrirEditDisruptiva(${i.id})">&#9998;</button>
        </td>
      </tr>`;
    });
    h += `</tbody></table></div></div>`;
    return h;
  }

  const resumen = `
  <div class="resumen">
    <div class="resumen-card"><div class="val pos">${positivas.length}</div><div class="lbl">Puntaje &gt; 5</div></div>
    <div class="resumen-card"><div class="val neg">${negativas.length}</div><div class="lbl">Puntaje &lt; -5</div></div>
    <div class="resumen-card"><div class="val">${prodRows.length}</div><div class="lbl">Total producciones</div></div>
  </div>`;

  const modal = `
  <div id="modalEdit" class="modal-overlay hidden">
    <div class="modal-box">
      <div class="modal-header">Editar produccion</div>
      <div class="modal-body">
        <div class="modal-info" id="modalInfo"></div>
        <div class="modal-fields">
          <div class="field"><label>Hora Inicio</label><input type="time" id="modalHoraIni" step="1"/></div>
          <div class="field"><label>Hora Fin</label><input type="time" id="modalHoraFin" step="1"/></div>
          <div class="field"><label>Tiempo Muerto (hs)</label><input type="number" id="modalTM" min="0" step="0.01"/></div>
          <div id="modalTMDetalle" style="width:100%;font-size:12px;color:#666;margin-top:-4px;"></div>
          <div class="field"><label>Unidades</label><input type="number" id="modalUni" min="0" step="1"/></div>
          <div class="field" style="justify-content:center;"><label style="display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" id="modalAnular" style="width:18px;height:18px;cursor:pointer;"/> Anular Tiempo</label></div>
        </div>
        <div class="modal-preview" id="modalPreview"></div>
      </div>
      <div class="modal-footer">
        <button class="btn" onclick="cerrarModal()">Cancelar</button>
        <button class="btn btn-dark" onclick="guardarEditDisruptiva()">Guardar</button>
      </div>
    </div>
  </div>`;

  resultEl.innerHTML = resumen +
    buildTable(positivas, "Producciones con Puntaje > 5", "pos") +
    buildTable(negativas, "Producciones con Puntaje < -5", "neg") +
    modal;

  ["modalHoraIni","modalHoraFin","modalTM","modalUni"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", actualizarPreview);
      el.addEventListener("change", actualizarPreview);
    }
  });
}

/* ================= EDICION ================= */
let editingRow = null;

function abrirEditDisruptiva(id) {
  const r = allRows.find(x => x.id === id);
  if (!r) return;
  editingRow = r;

  const mat = String(r.Matriz || "").trim();
  const info = matMap.get(mat);
  const emp = empMap.get(String(r.Legajo || "").trim());

  document.getElementById("modalInfo").innerHTML = `
    <strong>${esc(emp?.Empleado || r.Nombre_Empleado || "")}</strong> &mdash;
    Mat ${esc(mat)} (${esc(info?.Matriz || r.Nombre_Matriz || "")}) &mdash;
    ${r.Fecha ? new Date(r.Fecha).toLocaleDateString("es-AR") : ""}`;

  document.getElementById("modalHoraIni").value = r.Hora_Inicio || "";
  document.getElementById("modalHoraFin").value = r.Hora_Fin || "";
  document.getElementById("modalTM").value = +(n(r.Segundos_Tiempo_Muerto) / 3600).toFixed(2);
  document.getElementById("modalUni").value = n(r.Uni);
  document.getElementById("modalAnular").checked = !!r.Anular_Tiempo;

  // Buscar TMs del mismo empleado y fecha
  const leg = String(r.Legajo || "").trim();
  const fechaStr = r.Fecha ? new Date(r.Fecha).toLocaleDateString("es-AR") : "";
  const tmRows = allRowsRaw.filter(x => {
    const xLeg = String(x.Legajo || "").trim();
    const xMat = String(x.Matriz || "").trim();
    const xFecha = x.Fecha ? new Date(x.Fecha).toLocaleDateString("es-AR") : "";
    return xLeg === leg && xFecha === fechaStr && !esMatriz(xMat) && !["RM","PM","RD","LT","E"].includes(xMat);
  });
  const detalleEl = document.getElementById("modalTMDetalle");
  if (tmRows.length > 0) {
    detalleEl.innerHTML = tmRows.map(t => {
      const code = String(t.Matriz || "").trim();
      const hs = (n(t.Segundos_Trabajados) / 3600).toFixed(1);
      return `<span style="display:inline-block;background:#f3f4f6;border:1px solid #e3e6eb;border-radius:6px;padding:2px 8px;margin:2px;">${esc(code)} <strong>${hs}h</strong></span>`;
    }).join("");
  } else {
    detalleEl.innerHTML = '<span style="color:#bbb;">Sin TM registrados</span>';
  }

  actualizarPreview();
  document.getElementById("modalEdit").classList.remove("hidden");
}

function cerrarModal() {
  document.getElementById("modalEdit").classList.add("hidden");
  editingRow = null;
}

function timeToSec(t) {
  if (!t) return 0;
  const p = t.split(":").map(Number);
  return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
}

function calcFromModal() {
  const horaIni = document.getElementById("modalHoraIni").value;
  const horaFin = document.getElementById("modalHoraFin").value;
  const tmHs = n(document.getElementById("modalTM").value);
  const tm = Math.round(tmHs * 3600);
  const uni = n(document.getElementById("modalUni").value);
  const mat = String(editingRow.Matriz || "").trim();
  const info = matMap.get(mat);
  const tProm = n(info?.Tiempo_Historico);

  let segBruto = timeToSec(horaFin) - timeToSec(horaIni);
  if (segBruto < 0) segBruto += 86400;
  const segTrab = segBruto - tm;
  const segHist = uni * tProm;
  const premio = segHist > 0 ? (-(segTrab / segHist - 1)) * 10 : 0;

  return { horaIni, horaFin, tm, uni, segTrab, segHist, premio };
}

function actualizarPreview() {
  if (!editingRow) return;
  const c = calcFromModal();

  const origSegTrab = n(editingRow.Segundos_Trabajados);
  const origSegHist = n(editingRow.Segundos_Historico);
  const origPremio = n(editingRow.Premio);
  document.getElementById("modalPreview").innerHTML = `
    <div style="display:flex;gap:16px;margin-top:10px;flex-wrap:wrap;">
      <div><span class="lbl">Seg Trab:</span> <strong>${f(c.segTrab)}</strong></div>
      <div><span class="lbl">Seg Hist:</span> <strong>${f(c.segHist)}</strong></div>
      <div><span class="lbl">Puntaje:</span> <strong class="${cls(c.premio)}">${f(c.premio, 1)}</strong></div>
    </div>
    <div style="display:flex;gap:16px;margin-top:4px;flex-wrap:wrap;color:#94a3b8;font-size:12px;">
      <div><span class="lbl">Anterior:</span> Seg Trab: ${f(origSegTrab)} | Seg Hist: ${f(origSegHist)} | Puntaje: ${f(origPremio, 1)}</div>
    </div>`;
}

async function guardarEditDisruptiva() {
  if (!editingRow) return;
  const id = editingRow.id;
  const c = calcFromModal();
  const anular = document.getElementById("modalAnular").checked;

  try {
    const { error } = await sb.rpc("anular_produccion", {
      row_id: id,
      p_hora_inicio: c.horaIni || null,
      p_hora_fin: c.horaFin || null,
      p_seg_tiempo_muerto: c.tm,
      p_uni: c.uni,
      p_seg_trabajados: c.segTrab,
      p_seg_historico: c.segHist,
      p_premio: c.premio,
      p_anular: anular
    });
    if (error) throw new Error(error.message);

    // Si se anuló, eliminar del cache para que no reaparezca
    if (anular) {
      const idx = allRowsRaw.findIndex(x => x.id === id);
      if (idx !== -1) allRowsRaw.splice(idx, 1);
    } else {
      // Actualizar en cache local
      const row = allRowsRaw.find(x => x.id === id);
      if (row) {
        row.Hora_Inicio = c.horaIni; row.Hora_Fin = c.horaFin;
        row.Segundos_Tiempo_Muerto = c.tm; row.Uni = c.uni;
        row.Segundos_Trabajados = c.segTrab; row.Segundos_Historico = c.segHist;
        row.Premio = c.premio; row.Anular_Tiempo = anular;
      }
    }

    cerrarModal();
    filtrarPorFecha();
  } catch (err) { alert("Error al guardar: " + err.message); }
}

/* ================= ACCIONES ================= */
async function revisarDisruptiva(id, btnEl) {
  try {
    const { error } = await sb.rpc("marcar_revisado", { row_id: id });
    if (error) throw new Error(error.message);
    // Eliminar del cache local para que no reaparezca
    const idx = allRowsRaw.findIndex(r => r.id === id);
    if (idx !== -1) allRowsRaw.splice(idx, 1);
    const tr = btnEl.closest("tr");
    if (tr) { tr.style.transition = "opacity .3s"; tr.style.opacity = "0"; setTimeout(() => { filtrarPorFecha(); }, 300); }
  } catch (err) { alert("Error: " + err.message); }
}

async function eliminarDisruptiva(id, btnEl) {
  if (!confirm("Eliminar este registro?")) return;
  try {
    const { error } = await sb.from("db_n8n_espejo").delete().eq("id", id);
    if (error) throw new Error(error.message);
    const tr = btnEl.closest("tr");
    if (tr) tr.remove();
  } catch (err) { alert("Error al eliminar: " + err.message); }
}

/* ================= EXCEL ================= */
async function exportarExcelDisruptivas() {
  if (!lastPositivas.length && !lastNegativas.length) return;

  const wb = new ExcelJS.Workbook();
  const border = { top: { style: "medium" }, left: { style: "medium" }, bottom: { style: "medium" }, right: { style: "medium" } };
  const headFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111111" } };
  const headFont = { bold: true, size: 12, color: { argb: "FFFFFFFF" } };
  const greenFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } };
  const redFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE8E8" } };

  const headers = ["Fecha", "Legajo", "Empleado", "Mat", "Descripcion", "Uni", "T. Prom", "Prom Hist", "Seg Trab", "Seg Hist", "Puntaje"];

  function addSheet(name, items, fill) {
    if (!items.length) return;
    const ws = wb.addWorksheet(name);

    // Titulo
    const tr = ws.addRow([name + " (" + items.length + ")"]);
    ws.mergeCells(1, 1, 1, headers.length);
    tr.getCell(1).font = { bold: true, size: 16 };
    tr.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    tr.getCell(1).border = border;
    tr.height = 30;

    // Headers
    const hr = ws.addRow(headers);
    hr.eachCell(function(c) {
      c.fill = headFill;
      c.font = headFont;
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = border;
    });

    // Data
    items.forEach(function(i) {
      const tProm = i.uni > 0 ? +(i.segTrab / i.uni).toFixed(2) : 0;
      const r = ws.addRow([i.fecha, i.legajo, i.nombre, i.matriz, i.descMat, i.uni, tProm, +i.promHist.toFixed(2), i.segTrab, i.segHist, +i.premio.toFixed(1)]);
      r.eachCell(function(c, col) {
        c.font = { size: 11 };
        c.border = border;
        c.alignment = { vertical: "middle", horizontal: col <= 5 ? "center" : "right" };
      });
      // Puntaje con color
      const pCell = r.getCell(11);
      pCell.alignment = { horizontal: "center", vertical: "middle" };
      pCell.font = { size: 11, bold: true };
      if (fill) pCell.fill = fill;
    });

    // Anchos
    ws.getColumn(1).width = 12;
    ws.getColumn(2).width = 8;
    ws.getColumn(3).width = 22;
    ws.getColumn(4).width = 7;
    ws.getColumn(5).width = 30;
    [6,7,8,9,10,11].forEach(function(c) { ws.getColumn(c).width = 11; });
    ws.getColumn(11).width = 10;
    ws.views = [{ state: "frozen", ySplit: 2 }];
  }

  addSheet("Puntaje mayor a 5", lastPositivas, greenFill);
  addSheet("Puntaje menor a -5", lastNegativas, redFill);

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Disruptivas " + fechaDesde.value + " a " + fechaHasta.value + ".xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

/* ================= INIT ================= */
init();
