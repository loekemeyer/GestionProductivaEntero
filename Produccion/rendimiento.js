"use strict";

/* ============================================================
   Rendimiento x Mes — Adaptativo: Bloques (mes) ↔ Dots (día)
   ECharts 5 + Supabase JS v2
   ============================================================ */

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ----- Estado -----
let matrices = [];
let empleadosMap = {};
let registrosFiltrados = [];
let recordsByDayKey = {};
let recordsByMonthKey = {};
let scatterNormal = [];
let scatterOutliers = [];
let rollingData = [];           // global (cuando hay 1 sola serie)
let rollingByOp = {};           // legajo → [[ts, avg], ...] (para multi-linea)
let monthlyBlocks = [];      // [{value:[ts,open,close,low,high], __key, __mes, __anio, __n, __avg, __min, __max}]
let operariosUsados = [];
let visMax = 10, yMax = 10, outlierThreshold = 100, tHistGlobal = null;
let currentMode = null; // 'bloques' | 'dots'
let zoomDebounce = null;
let fullStartMs = null, fullEndMs = null;
let chart = null;
let suppressZoomHandler = false;

// ----- DOM -----
const $matriz   = document.getElementById("selMatriz");
const $anio     = document.getElementById("selAnio");
const $mes      = document.getElementById("selMes");
const $btn      = document.getElementById("btnRefrescar");
const $chipsRow = document.getElementById("operChipsRow");
const $chips    = document.getElementById("operChips");
const selectedOperarios = new Set(); // legajos activos; vacio = todos
let allRows = []; // datos crudos del ultimo cargarDatos
let dotsVisible = true; // toggle UI para mostrar/ocultar scatter dots
const $chart    = document.getElementById("chart");
const $empty    = document.getElementById("chartEmpty");
const $loading  = document.getElementById("loadingMsg");
const $statsRow = document.getElementById("statsRow");
const $stN      = document.getElementById("stN");
const $stMin    = document.getElementById("stMin");
const $stMax    = document.getElementById("stMax");
const $stAvg    = document.getElementById("stAvg");
const $stHist   = document.getElementById("stHist");
const $stRoll      = document.getElementById("stRoll");
const $stRollSub   = document.getElementById("stRollSub");
const $stTrend     = document.getElementById("stTrend");
const $stTrendSub  = document.getElementById("stTrendSub");
const $legend   = document.getElementById("legendOperarios");
const $modeInd  = document.getElementById("modeIndicator");
const $overlay  = document.getElementById("overlay");
const $popTitle = document.getElementById("popupTitle");
const $popStats = document.getElementById("popupStats");
const $popBody  = document.getElementById("popupBody");

document.getElementById("closePopup").addEventListener("click", () => $overlay.classList.remove("visible"));
$overlay.addEventListener("click", (e) => { if (e.target === $overlay) $overlay.classList.remove("visible"); });

/* ===== HELPERS ===== */
const fmt2 = (v) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(2));
const fmtSeg = (v) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(2) + " s");
function pad2(n) { return String(n).padStart(2, "0"); }
function parseFechaToDate(fechaStr) {
  if (!fechaStr) return null;
  const s = String(fechaStr).slice(0, 10);
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}
function nombreOperario(legajo) {
  const k = String(legajo).trim();
  return empleadosMap[k] || `Leg ${k}`;
}
function colorOperario(legajo) {
  const s = String(legajo);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 78%, 62%)`;  // más saturado/claro para fondo oscuro
}
function parseHoraOffset(h) {
  if (!h) return 0;
  const [hh, mm, ss] = String(h).split(":").map(Number);
  return ((hh || 0) * 3600 + (mm || 0) * 60 + (ss || 0)) * 1000;
}
const MESES_NOM = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

/* ===== INIT ===== */
(async function init() {
  $loading.style.display = "block";

  const hoy = new Date();
  const anioActual = hoy.getUTCFullYear();
  for (let y = anioActual; y >= anioActual - 4; y--) {
    const opt = document.createElement("option");
    opt.value = y; opt.textContent = y;
    $anio.appendChild(opt);
  }
  // Default: Todos los años + Todos los meses (mostrar todo)
  $anio.value = "";
  $mes.value = "";

  const [matRes, empRes] = await Promise.all([
    sb.from("Matrices").select("N_Matriz, Matriz, Tiempo_Historico").order("N_Matriz"),
    sb.from("Empleados").select("Legajo, Empleado")
  ]);

  matrices = (matRes.data || []).filter(m => m.N_Matriz != null);
  // sort numerico-alfa: 1, 2, 10, 100, 101B, 101C, 102...
  matrices.sort((a, b) => {
    const an = String(a.N_Matriz);
    const bn = String(b.N_Matriz);
    const ax = an.match(/^(\d+)(.*)$/);
    const bx = bn.match(/^(\d+)(.*)$/);
    if (ax && bx) {
      const na = parseInt(ax[1], 10), nb = parseInt(bx[1], 10);
      if (na !== nb) return na - nb;
      return ax[2].localeCompare(bx[2], "es");
    }
    return an.localeCompare(bn, "es");
  });

  (empRes.data || []).forEach(e => {
    empleadosMap[String(e.Legajo || "").trim()] = e.Empleado || "";
  });

  matrices.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.N_Matriz;
    const nom = m.Matriz ? ` — ${m.Matriz}` : "";
    opt.textContent = `Mat ${m.N_Matriz}${nom}`;
    $matriz.appendChild(opt);
  });

  buildChart();
  $loading.style.display = "none";

  $btn.addEventListener("click", cargarDatos);
  $matriz.addEventListener("change", () => { if ($matriz.value) cargarDatos(); });
  $anio.addEventListener("change", () => { if ($matriz.value) cargarDatos(); });
  $mes.addEventListener("change", () => { if (allRows.length) zoomToMes(); });

  const $btnDots = document.getElementById("btnToggleDots");
  $btnDots.addEventListener("click", () => {
    dotsVisible = !dotsVisible;
    $btnDots.textContent = dotsVisible ? "● Puntos: ON" : "○ Puntos: OFF";
    $btnDots.classList.toggle("off", !dotsVisible);
    if (allRows.length) renderChart();
  });
})();

/* ===== CHART SETUP ===== */
function buildChart() {
  chart = echarts.init($chart, null, { renderer: "canvas" });
  chart.on("click", onChartClick);
  chart.on("dataZoom", onDataZoom);
  window.addEventListener("resize", () => chart && chart.resize());
}

/* ===== CARGAR DATOS ===== */
async function cargarDatos() {
  const nMatriz = $matriz.value;
  if (!nMatriz) return;

  const anioStr = $anio.value;
  const anio = anioStr ? parseInt(anioStr, 10) : null;

  $loading.style.display = "block";
  $statsRow.style.display = "none";
  $empty.classList.remove("visible");

  const PAGE = 1000;
  let from = 0;
  const rows = [];
  while (true) {
    let q = sb.from("db_n8n_espejo")
      .select("id, Matriz, Nombre_Matriz, Legajo, Uni, Fecha, Hora_Inicio, Hora_Fin, Segundos_Trabajados, Tiempo_Toma, Premio, Eliminar")
      .eq("Matriz", nMatriz)
      .or("Eliminar.is.null,Eliminar.neq.S")
      .neq("Legajo", "1")  // excluir registros de Pruebas (Legajo 1)
      .gt("Uni", 0)
      .gt("Tiempo_Toma", 0)
      .order("Fecha", { ascending: true })
      .order("Hora_Inicio", { ascending: true })
      .range(from, from + PAGE - 1);
    if (anio) {
      q = q.gte("Fecha", `${anio}-01-01`).lte("Fecha", `${anio}-12-31`);
    }
    const { data, error } = await q;
    if (error) { console.error(error); break; }
    if (!data || !data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  allRows = rows;
  selectedOperarios.clear();
  $loading.style.display = "none";

  if (!rows.length) {
    $empty.classList.add("visible");
    chart.clear();
    $legend.innerHTML = "";
    $modeInd.textContent = "";
    $chipsRow.style.display = "none";
    return;
  }

  // Rango del eje X: si año esta seteado usa ese, si no min/max real de los datos
  if (anio) {
    fullStartMs = Date.UTC(anio, 0, 1);
    fullEndMs   = Date.UTC(anio, 11, 31, 23, 59, 59);
  } else {
    const dates = rows.map(r => parseFechaToDate(r.Fecha)).filter(Boolean).map(d => d.getTime());
    dates.sort((a, b) => a - b);
    fullStartMs = dates[0];
    fullEndMs   = dates[dates.length - 1] + 86400000;
  }

  renderChips(rows);
  renderAndApply();
}

// ===== Filtrar por chips seleccionados + render =====
function renderAndApply() {
  const filtered = selectedOperarios.size === 0
    ? allRows
    : allRows.filter(r => selectedOperarios.has(String(r.Legajo || "").trim()));

  registrosFiltrados = filtered;

  if (!filtered.length) {
    $empty.classList.add("visible");
    chart.clear();
    $legend.innerHTML = "";
    actualizarStats([]);
    return;
  }
  $empty.classList.remove("visible");

  computeAll(filtered);
  currentMode = "dots";
  renderChart();
  actualizarModeIndicator();
  renderLegendOperarios(operariosUsados, scatterOutliers.length > 0);
  zoomToMes();
  actualizarStats(filtered);
}

// ===== CHIPS DE OPERARIOS =====
function renderChips(rows) {
  const counts = {};
  rows.forEach(r => {
    const leg = String(r.Legajo || "").trim();
    if (!leg) return;
    counts[leg] = (counts[leg] || 0) + 1;
  });
  const legajos = Object.keys(counts).sort((a, b) => nombreOperario(a).localeCompare(nombreOperario(b), "es"));
  if (!legajos.length) { $chipsRow.style.display = "none"; return; }

  const chipsHtml = legajos.map(leg => {
    const c = colorOperario(leg);
    return `
      <button class="oper-chip" data-leg="${leg}" type="button">
        <span class="chip-dot" style="background:${c}"></span>
        ${nombreOperario(leg)}
        <span class="chip-n">${counts[leg]}</span>
      </button>
    `;
  }).join("");

  const actions = legajos.length > 1 ? `
    <span class="chips-actions">
      <button class="chips-action-btn" id="chipsAllBtn" type="button">Todos</button>
      <button class="chips-action-btn" id="chipsNoneBtn" type="button">Ninguno</button>
    </span>
  ` : "";

  $chips.innerHTML = chipsHtml + actions;
  $chipsRow.style.display = "block";

  $chips.querySelectorAll(".oper-chip").forEach(btn => {
    btn.addEventListener("click", () => {
      const leg = btn.dataset.leg;
      if (selectedOperarios.has(leg)) selectedOperarios.delete(leg);
      else selectedOperarios.add(leg);
      btn.classList.toggle("active");
      renderAndApply();
    });
  });
  const allBtn = document.getElementById("chipsAllBtn");
  if (allBtn) allBtn.addEventListener("click", () => {
    legajos.forEach(l => selectedOperarios.add(l));
    $chips.querySelectorAll(".oper-chip").forEach(b => b.classList.add("active"));
    renderAndApply();
  });
  const noneBtn = document.getElementById("chipsNoneBtn");
  if (noneBtn) noneBtn.addEventListener("click", () => {
    selectedOperarios.clear();
    $chips.querySelectorAll(".oper-chip").forEach(b => b.classList.remove("active"));
    renderAndApply();
  });
}

/* ===== COMPUTE: scatter + monthly blocks + rolling ===== */
function computeAll(rows) {
  const mat = matrices.find(m => String(m.N_Matriz) === String($matriz.value));
  tHistGlobal = (mat && Number(mat.Tiempo_Historico)) || null;

  // umbrales
  const tiempos = rows.map(r => Number(r.Tiempo_Toma)).filter(t => t > 0 && isFinite(t)).sort((a, b) => a - b);
  const mediana = tiempos.length ? tiempos[Math.floor(tiempos.length / 2)] : 0;
  // p90 como referencia robusta (no afectada por outliers extremos)
  const p90 = tiempos.length ? tiempos[Math.floor(tiempos.length * 0.9)] : 0;
  const baseRef = tHistGlobal || mediana || 1;
  outlierThreshold = Math.max(baseRef * 10, p90 * 2);
  const sinOutlier = tiempos.filter(t => t <= outlierThreshold);
  visMax = sinOutlier.length ? sinOutlier[sinOutlier.length - 1] * 1.25 : outlierThreshold;
  // Safety cap: yMax no puede ser absurdo (ej. T.Hist * 50)
  const hardCap = (tHistGlobal || mediana || 5) * 50;
  yMax = Math.min(hardCap, Math.max(visMax, tHistGlobal ? tHistGlobal * 1.5 : 0));
  if (!isFinite(yMax) || yMax <= 0) yMax = 20;

  recordsByDayKey = {};
  recordsByMonthKey = {};
  scatterNormal = [];
  scatterOutliers = [];
  const opersSet = new Set();

  rows.forEach(r => {
    const d = parseFechaToDate(r.Fecha);
    if (!d) return;
    const tiempo = Number(r.Tiempo_Toma) || 0;
    if (tiempo <= 0) return;

    const dayKey = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const monthKey = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
    const legajo = String(r.Legajo || "").trim();
    opersSet.add(legajo);

    const item = {
      legajo,
      tiempo,
      uni: Number(r.Uni) || 0,
      segTotal: Number(r.Segundos_Trabajados) || 0,
      premio: Number(r.Premio) || 0,
      hora: r.Hora_Inicio || "",
      fechaStr: String(r.Fecha).slice(0, 10),
      d,
    };
    (recordsByDayKey[dayKey] = recordsByDayKey[dayKey] || []).push(item);
    (recordsByMonthKey[monthKey] = recordsByMonthKey[monthKey] || []).push(item);

    const ts = d.getTime() + parseHoraOffset(r.Hora_Inicio);
    const isOut = tiempo > outlierThreshold;
    const display = isOut ? visMax : tiempo;
    const sItem = {
      value: [ts, display],
      __real: tiempo,
      __legajo: legajo,
      __nombre: nombreOperario(legajo),
      __fecha: String(r.Fecha).slice(0, 10),
      __hora: r.Hora_Inicio || "",
      __uni: Number(r.Uni) || 0,
      __segTotal: Number(r.Segundos_Trabajados) || 0,
      __premio: Number(r.Premio) || 0,
      __isOutlier: isOut,
      itemStyle: isOut
        ? { color: "#ef4444", borderColor: "#fca5a5", borderWidth: 1, shadowBlur: 6, shadowColor: "rgba(239,68,68,.5)" }
        : { color: colorOperario(legajo), opacity: .9, borderColor: "rgba(255,255,255,.4)", borderWidth: 1 },
      symbol: isOut ? "triangle" : "circle",
      symbolSize: isOut ? 14 : 11,
    };
    (isOut ? scatterOutliers : scatterNormal).push(sItem);
  });

  operariosUsados = Array.from(opersSet).sort((a, b) => nombreOperario(a).localeCompare(nombreOperario(b), "es"));

  // Monthly blocks (candlestick) — uno por mes con registros
  monthlyBlocks = [];
  Object.keys(recordsByMonthKey).sort().forEach(mk => {
    const items = recordsByMonthKey[mk]
      .filter(i => i.tiempo <= outlierThreshold)
      .sort((a, b) => (a.fechaStr + a.hora).localeCompare(b.fechaStr + b.hora));
    if (!items.length) return;
    const tts = items.map(i => i.tiempo);
    const open  = tts[0];
    const close = tts[tts.length - 1];
    const high  = Math.max(...tts);
    const low   = Math.min(...tts);
    const avg   = tts.reduce((a, b) => a + b, 0) / tts.length;
    const [yy, mm] = mk.split("-").map(Number);
    const ts = Date.UTC(yy, mm - 1, 15); // mid-month
    const mejora = close < open; // menor seg/uni = mejor
    monthlyBlocks.push({
      value: [ts, open, close, low, high],
      __key: mk, __anio: yy, __mes: mm,
      __open: open, __close: close, __low: low, __high: high,
      __avg: avg, __n: items.length,
      itemStyle: {
        color: mejora ? "#22c55e" : "#ef4444",
        color0: mejora ? "#22c55e" : "#ef4444",
        borderColor: mejora ? "#16a34a" : "#dc2626",
        borderColor0: mejora ? "#16a34a" : "#dc2626",
        opacity: .85,
      }
    });
  });

  // Rolling avg 7d — GLOBAL (todos los operarios juntos)
  rollingData = buildRolling(rows);

  // Rolling avg 7d — POR OPERARIO (para comparar curvas en el grafico)
  rollingByOp = {};
  operariosUsados.forEach(leg => {
    const rsOp = rows.filter(r => String(r.Legajo || "").trim() === leg);
    rollingByOp[leg] = buildRolling(rsOp);
  });
}

// Helper: rolling 7d centrado a partir de rows crudos
function buildRolling(rows) {
  const byDay = {};
  rows.forEach(r => {
    const t = Number(r.Tiempo_Toma) || 0;
    if (t <= 0 || t > outlierThreshold) return;
    const d = parseFechaToDate(r.Fecha);
    if (!d) return;
    const k = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth()+1)}-${pad2(d.getUTCDate())}`;
    (byDay[k] = byDay[k] || []).push(t);
  });
  const daily = Object.keys(byDay).sort().map(k => {
    const arr = byDay[k];
    const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
    const [y, m, d] = k.split("-").map(Number);
    return [Date.UTC(y, m - 1, d), avg];
  });
  const W = 7 * 86400000;
  return daily.map(pt => {
    const t0 = pt[0] - (W - 1) / 2;
    const t1 = pt[0] + (W - 1) / 2;
    const win = daily.filter(p => p[0] >= t0 && p[0] <= t1);
    const avg = win.reduce((a, b) => a + b[1], 0) / win.length;
    return [pt[0], avg];
  });
}

/* ===== RENDER (option base — series data segun currentMode) ===== */
function renderChart() {
  const dotsMode = currentMode === "dots";
  // showDots: depende del zoom mode + del toggle de UI
  const showDots = dotsMode && dotsVisible;
  const showBloques = currentMode === "bloques";

  const option = {
    backgroundColor: "transparent",
    animation: true,
    animationDuration: 600,
    animationDurationUpdate: 700,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicInOut",
    grid: { left: 60, right: 28, top: 28, bottom: 48 },
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(15,23,42,.96)",
      borderColor: "#475569",
      borderWidth: 1,
      textStyle: { color: "#f8fafc", fontFamily: "Inter, sans-serif", fontSize: 12 },
      formatter: tooltipFormatter,
    },
    xAxis: {
      type: "time",
      // padding 60 dias a cada lado para poder scrollear mas alla del rango de datos
      min: fullStartMs - 60 * 86400000,
      max: fullEndMs + 60 * 86400000,
      axisLine: { lineStyle: { color: "#475569" } },
      axisLabel: { color: "#94a3b8", fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: "seg/uni",
      nameTextStyle: { color: "#94a3b8", fontSize: 11, padding: [0, 0, 6, 0] },
      min: 0,
      max: yMax > 0 ? yMax : null,
      axisLine: { lineStyle: { color: "#475569" } },
      axisLabel: { color: "#94a3b8", fontSize: 11 },
      splitLine: { lineStyle: { color: "rgba(148,163,184,.08)" } },
    },
    dataZoom: [
      {
        type: "inside", xAxisIndex: 0,
        zoomOnMouseWheel: true,
        moveOnMouseWheel: false,
        moveOnMouseMove: true,
        throttle: 60,
        // 'none' = no recorta puntos fuera de la vista → las lineas siguen
        // siendo continuas al desplazarse (no "se cortan" cuando el primer
        // punto sale del area visible)
        filterMode: "none",
      }
    ],
    series: buildSeries(showDots, showBloques),
  };

  // replaceMerge:['series'] reemplaza el array de series por completo (necesario
  // porque cantidad de lineas cambia segun chips activos) pero preserva el estado
  // de dataZoom — sin esto el drag/pan se reseteaba en cada re-render.
  chart.setOption(option, { replaceMerge: ["series"] });
}

// Helper: arma series segun cantidad de operarios visibles
function buildSeries(showDots, showBloques) {
  const lineSeries = buildRollingSeries();
  const tHistMarkLine = tHistGlobal ? {
    symbol: ["none", "none"],
    silent: true,
    lineStyle: {
      color: "#a78bfa", type: [8, 6], width: 2.5,
      shadowBlur: 8, shadowColor: "rgba(167,139,250,.5)",
    },
    label: {
      show: true,
      formatter: `T. HISTÓRICO   ${fmt2(tHistGlobal)} s/u`,
      color: "#fff", backgroundColor: "#7c3aed",
      borderColor: "#a78bfa", borderWidth: 1, borderRadius: 6,
      padding: [4, 10, 4, 10], fontWeight: 800, fontSize: 12,
      letterSpacing: 0.5, position: "insideStartTop", distance: 6,
    },
    data: [{ yAxis: tHistGlobal }],
  } : undefined;
  // markLine T.Hist va en la primera serie linea
  if (lineSeries.length && tHistMarkLine) {
    lineSeries[0].markLine = tHistMarkLine;
  }

  return [
    ...lineSeries,
    {
      name: "Cajones",
      type: "scatter",
      data: showDots ? scatterNormal : [],
      z: 4,
      emphasis: { focus: "self", scale: 1.6 },
      universalTransition: { enabled: true },
    },
    {
      name: "Outliers",
      type: "scatter",
      data: showDots ? scatterOutliers : [],
      z: 5,
      emphasis: { focus: "self", scale: 1.4 },
    },
    {
      name: "Bloque mensual",
      type: "candlestick",
      data: showBloques ? monthlyBlocks : [],
      barMaxWidth: 60,
      barMinWidth: 18,
      z: 4,
      universalTransition: { enabled: true },
    },
  ];
}

// Helper: construye las series de linea rolling.
// - Si hay 1 solo operario visible → 1 linea global (con markPoint + endLabel)
// - Si hay 2+ operarios visibles → 1 linea por operario (sin markPoints para no saturar)
function buildRollingSeries() {
  // Operarios visibles: si hay chips activos usalos; si no, todos
  const visibles = selectedOperarios.size === 0
    ? operariosUsados.slice()
    : operariosUsados.filter(l => selectedOperarios.has(l));

  if (visibles.length <= 1) {
    // Single line — global rolling
    return [{
      name: visibles.length === 1
        ? `Rolling 7d — ${nombreOperario(visibles[0])}`
        : "Promedio móvil 7d",
      type: "line",
      smooth: true,
      showSymbol: false,
      data: rollingData,
      lineStyle: { color: "#fbbf24", width: 2.4, shadowBlur: 6, shadowColor: "rgba(251,191,36,.35)" },
      z: 3,
      endLabel: rollingData.length ? {
        show: true,
        formatter: () => {
          const last = rollingData[rollingData.length - 1];
          const v = last ? last[1] : 0;
          const delta = tHistGlobal ? ((v - tHistGlobal) / tHistGlobal) * 100 : null;
          const deltaTxt = delta == null ? "" : ` (${delta > 0 ? "+" : ""}${delta.toFixed(0)}% vs Hist)`;
          return `Avg ${fmt2(v)} s/u${deltaTxt}`;
        },
        color: "#fff",
        backgroundColor: "rgba(251,191,36,.95)",
        padding: [3, 8, 3, 8], borderRadius: 6,
        fontWeight: 800, fontSize: 11, distance: 8,
      } : { show: false },
      markPoint: rollingData.length >= 2 ? (() => {
        let iMin = 0, iMax = 0;
        for (let i = 1; i < rollingData.length; i++) {
          if (rollingData[i][1] < rollingData[iMin][1]) iMin = i;
          if (rollingData[i][1] > rollingData[iMax][1]) iMax = i;
        }
        const mk = (idx, kind) => ({
          coord: [rollingData[idx][0], rollingData[idx][1]],
          value: rollingData[idx][1],
          __mkKind: kind,
          __mkFecha: new Date(rollingData[idx][0]).toISOString().slice(0,10),
          itemStyle: {
            color: kind === "mejor" ? "#16a34a" : "#dc2626",
            borderColor: "#fff", borderWidth: 1.5,
          },
        });
        return {
          symbol: "pin",
          symbolSize: 42,
          label: { color: "#fff", fontWeight: 800, fontSize: 10, formatter: (p) => fmt2(p.value) },
          data: [mk(iMin, "mejor"), mk(iMax, "peor")],
        };
      })() : undefined,
    }];
  }

  // Multi-line — una linea por operario para comparar
  return visibles.map(leg => {
    const data = rollingByOp[leg] || [];
    const c = colorOperario(leg);
    return {
      name: `Rolling 7d — ${nombreOperario(leg)}`,
      type: "line",
      smooth: true,
      showSymbol: false,
      data,
      lineStyle: { color: c, width: 2.2, opacity: .95, shadowBlur: 4, shadowColor: "rgba(0,0,0,.2)" },
      itemStyle: { color: c },
      z: 3,
      endLabel: data.length ? {
        show: true,
        formatter: () => {
          const last = data[data.length - 1];
          return `${nombreOperario(leg)} ${fmt2(last[1])}`;
        },
        color: "#fff",
        backgroundColor: c,
        padding: [3, 8, 3, 8], borderRadius: 6,
        fontWeight: 700, fontSize: 10, distance: 6,
      } : { show: false },
      // Sin markPoint en multi-linea para no saturar
      emphasis: { focus: "series", lineStyle: { width: 3.2 } },
      __leg: leg,
    };
  });
}

function tooltipFormatter(p) {
  const d = p.data || {};
  // MarkPoint (best/worst del rolling)
  if (p.componentType === "markPoint" || d.__mkKind) {
    const kind = d.__mkKind;
    const fecha = d.__mkFecha || "";
    const titulo = kind === "mejor" ? "▼ Mejor día (rolling 7d)" : "▲ Peor día (rolling 7d)";
    const color = kind === "mejor" ? "#22c55e" : "#ef4444";
    return `
      <div style="font-weight:800;color:${color}">${titulo}</div>
      <div style="opacity:.85;margin-top:2px">${fecha}</div>
      <div style="margin-top:4px">Promedio: <strong>${fmt2(p.value)} s/u</strong></div>
      ${tHistGlobal ? `<div style="font-size:11px;opacity:.7">vs T.Hist ${fmt2(tHistGlobal)}: ${((p.value - tHistGlobal)/tHistGlobal*100).toFixed(1)}%</div>` : ""}
    `;
  }
  // Línea rolling (global o por operario)
  if (p.seriesType === "line") {
    if (!Array.isArray(p.value)) return "";
    const dt = new Date(p.value[0]);
    const color = p.color || "#fbbf24";
    return `<strong style="color:${color}">${p.seriesName}</strong><br/>${dt.toISOString().slice(0,10)}: <strong>${fmt2(p.value[1])} s/u</strong>`;
  }
  // Candlestick
  if (p.seriesType === "candlestick") {
    const mejora = d.__close < d.__open;
    const dt = new Date(d.value[0]);
    return `
      <div style="font-weight:800;color:#fbbf24">${MESES_NOM[dt.getUTCMonth()]} ${dt.getUTCFullYear()}</div>
      <div style="font-size:11px;opacity:.8;margin-bottom:6px">${d.__n} cajón${d.__n===1?"":"es"}</div>
      <table style="font-size:12px;border-spacing:0">
        <tr><td style="opacity:.7;padding-right:8px">Apertura:</td><td><strong>${fmt2(d.__open)}</strong></td></tr>
        <tr><td style="opacity:.7;padding-right:8px">Cierre:</td><td><strong style="color:${mejora?'#22c55e':'#ef4444'}">${fmt2(d.__close)}</strong></td></tr>
        <tr><td style="opacity:.7;padding-right:8px">Mejor:</td><td><strong style="color:#86efac">${fmt2(d.__low)}</strong></td></tr>
        <tr><td style="opacity:.7;padding-right:8px">Peor:</td><td><strong style="color:#fca5a5">${fmt2(d.__high)}</strong></td></tr>
        <tr><td style="opacity:.7;padding-right:8px">Promedio:</td><td><strong>${fmt2(d.__avg)}</strong></td></tr>
      </table>
      <div style="font-size:10px;opacity:.55;margin-top:6px">Click para ver el detalle del mes</div>
    `;
  }
  // Scatter (dot)
  const dt = new Date(p.value[0]);
  const fechaTxt = `${pad2(dt.getUTCDate())}/${pad2(dt.getUTCMonth()+1)}/${dt.getUTCFullYear()}`;
  const hora = d.__hora ? ` ${String(d.__hora).slice(0,5)}` : "";
  const real = d.__isOutlier
    ? `<span style="color:#fca5a5">⚠ OUTLIER: ${fmt2(d.__real)} s/u (recortado)</span>`
    : `<strong>${fmt2(d.__real)} s/u</strong>`;
  return `
    <div style="font-weight:800;color:#fbbf24">${d.__nombre || "?"}</div>
    <div style="opacity:.85">${fechaTxt}${hora}</div>
    <div style="margin-top:4px">${real}</div>
    <div style="font-size:11px;opacity:.7">Uni ${d.__uni||0} · Seg total ${d.__segTotal||0} · Pje ${d.__premio ? fmt2(d.__premio) : "—"}</div>
    <div style="font-size:10px;opacity:.55;margin-top:4px">Click para detalle del día</div>
  `;
}

/* ===== ZOOM (vista inicial) ===== */
function zoomToMes() {
  const anioStr = $anio.value;
  const mesStr  = $mes.value;
  let ini, fin;
  if (anioStr && mesStr) {
    const anio = parseInt(anioStr, 10);
    const mes  = parseInt(mesStr, 10);
    ini = Date.UTC(anio, mes - 1, 1);
    fin = Date.UTC(anio, mes, 0, 23, 59, 59);
  } else {
    // Sin lapso especifico: mostrar todo el rango cargado
    ini = fullStartMs;
    fin = fullEndMs;
  }
  suppressZoomHandler = true;
  chart.dispatchAction({ type: "dataZoom", startValue: ini, endValue: fin });
  setTimeout(() => { suppressZoomHandler = false; updateModeFromZoom(); }, 50);
}

/* ===== HANDLER ZOOM ===== */
function onDataZoom() {
  if (suppressZoomHandler) return;
  clearTimeout(zoomDebounce);
  zoomDebounce = setTimeout(updateModeFromZoom, 90);
}

function updateModeFromZoom() {
  if (!fullStartMs || !fullEndMs) return;
  const dzArr = chart.getOption().dataZoom || [];
  const dz = dzArr[0] || dzArr[1] || {};
  // dz.start/end son %  (0-100)
  let startMs, endMs;
  if (dz.startValue != null && dz.endValue != null) {
    startMs = dz.startValue;
    endMs   = dz.endValue;
  } else {
    const span = fullEndMs - fullStartMs;
    startMs = fullStartMs + (dz.start || 0) / 100 * span;
    endMs   = fullStartMs + (dz.end   || 100) / 100 * span;
  }
  const spanDays = (endMs - startMs) / 86400000;
  const target = spanDays > 75 ? "bloques" : "dots";
  if (target === currentMode) return;
  currentMode = target;
  renderChart();
  actualizarModeIndicator();
  renderLegendOperarios(operariosUsados, scatterOutliers.length > 0);
}

function actualizarModeIndicator() {
  if (currentMode === "bloques") {
    $modeInd.className = "mode-indicator bloques";
    $modeInd.textContent = "■ Vista Mensual (bloques)";
  } else if (currentMode === "dots") {
    $modeInd.className = "mode-indicator dots";
    $modeInd.textContent = "● Vista Diaria (cajones)";
  } else {
    $modeInd.className = "mode-indicator";
    $modeInd.textContent = "";
  }
}

/* ===== LEGEND ===== */
function renderLegendOperarios(legajos, hasOutliers) {
  // Solo mostrar leyenda en modo dots (los bloques no van por operario)
  if (currentMode !== "dots" || !legajos.length) { $legend.innerHTML = ""; return; }
  const items = legajos.map(leg => `
    <span class="lo-item">
      <span class="lo-dot" style="background:${colorOperario(leg)}"></span>
      ${nombreOperario(leg)}
    </span>
  `).join("");
  const outItem = hasOutliers
    ? `<span class="lo-item"><span class="lo-dot lo-out" style="background:#dc2626"></span>Outlier (recortado)</span>`
    : "";
  $legend.innerHTML = items + outItem;
}

/* ===== CLICK ===== */
function onChartClick(params) {
  if (params.seriesType === "line") return;
  if (params.seriesType === "candlestick") {
    const d = params.data;
    if (!d || !d.__key) return;
    mostrarDetalleMes(d);
    return;
  }
  // scatter
  const d = params.data && params.data.__fecha;
  if (!d) return;
  const items = recordsByDayKey[d] || [];
  if (!items.length) return;
  mostrarDetalleDia(d, items);
}

/* ===== MODAL DÍA ===== */
function mostrarDetalleDia(fecha, items) {
  const [y, m, d] = fecha.split("-").map(Number);
  $popTitle.textContent = `${pad2(d)}/${pad2(m)}/${y} — ${items.length} cajón${items.length === 1 ? "" : "es"}`;

  const tiempos = items.map(i => i.tiempo);
  const min = Math.min(...tiempos);
  const max = Math.max(...tiempos);
  const prom = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;

  $popStats.innerHTML = `
    <span>Min: <strong>${fmtSeg(min)}</strong></span>
    <span>Max: <strong>${fmtSeg(max)}</strong></span>
    <span>Promedio: <strong>${fmtSeg(prom)}</strong></span>
    ${tHistGlobal ? `<span>T.Hist: <strong>${fmtSeg(tHistGlobal)}</strong></span>` : ""}
  `;

  const sorted = items.slice().sort((a, b) => a.tiempo - b.tiempo);
  $popBody.innerHTML = sorted.map(i => {
    const cls = i.tiempo === min ? "best" : (i.tiempo === max ? "worst" : "");
    return `
      <tr>
        <td>${i.fechaStr}${i.hora ? " " + String(i.hora).slice(0,5) : ""}</td>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorOperario(i.legajo)};margin-right:6px;vertical-align:middle"></span>${nombreOperario(i.legajo)}</td>
        <td class="num">${i.uni}</td>
        <td class="num">${i.segTotal}</td>
        <td class="num ${cls}">${fmt2(i.tiempo)}</td>
        <td class="num">${i.premio ? fmt2(i.premio) : "—"}</td>
      </tr>
    `;
  }).join("");

  $overlay.classList.add("visible");
}

/* ===== MODAL MES ===== */
function mostrarDetalleMes(block) {
  const items = (recordsByMonthKey[block.__key] || [])
    .filter(i => i.tiempo <= outlierThreshold)
    .sort((a, b) => a.tiempo - b.tiempo);
  if (!items.length) return;

  $popTitle.textContent = `${MESES_NOM[block.__mes - 1]} ${block.__anio} — ${block.__n} cajones`;
  $popStats.innerHTML = `
    <span>Apertura: <strong>${fmtSeg(block.__open)}</strong></span>
    <span>Cierre: <strong>${fmtSeg(block.__close)}</strong></span>
    <span>Mejor: <strong style="color:#16a34a">${fmtSeg(block.__low)}</strong></span>
    <span>Peor: <strong style="color:#dc2626">${fmtSeg(block.__high)}</strong></span>
    <span>Promedio: <strong>${fmtSeg(block.__avg)}</strong></span>
    ${tHistGlobal ? `<span>T.Hist: <strong>${fmtSeg(tHistGlobal)}</strong></span>` : ""}
  `;

  const min = block.__low, max = block.__high;
  $popBody.innerHTML = items.map(i => {
    const cls = i.tiempo === min ? "best" : (i.tiempo === max ? "worst" : "");
    return `
      <tr>
        <td>${i.fechaStr}${i.hora ? " " + String(i.hora).slice(0,5) : ""}</td>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${colorOperario(i.legajo)};margin-right:6px;vertical-align:middle"></span>${nombreOperario(i.legajo)}</td>
        <td class="num">${i.uni}</td>
        <td class="num">${i.segTotal}</td>
        <td class="num ${cls}">${fmt2(i.tiempo)}</td>
        <td class="num">${i.premio ? fmt2(i.premio) : "—"}</td>
      </tr>
    `;
  }).join("");

  $overlay.classList.add("visible");
}

/* ===== STATS ===== */
function actualizarStats(rows) {
  if (!rows.length) { $statsRow.style.display = "none"; return; }
  const tiempos = rows.map(r => Number(r.Tiempo_Toma) || 0).filter(t => t > 0);
  const min = Math.min(...tiempos);
  const max = Math.max(...tiempos);
  const avg = tiempos.reduce((a, b) => a + b, 0) / tiempos.length;
  $stN.textContent   = rows.length;
  $stMin.textContent = fmt2(min);
  $stMax.textContent = fmt2(max);
  $stAvg.textContent = fmt2(avg);
  $stHist.textContent = tHistGlobal ? fmt2(tHistGlobal) : "—";

  // Rolling actual = ultimo valor del rolling
  if (rollingData.length) {
    const last = rollingData[rollingData.length - 1];
    const v = last[1];
    $stRoll.textContent = fmt2(v);
    if (tHistGlobal) {
      const delta = ((v - tHistGlobal) / tHistGlobal) * 100;
      const sign = delta > 0 ? "+" : "";
      // delta positivo = peor (tarda mas que historico). Color rojo.
      const cls = Math.abs(delta) < 2 ? "neutral" : (delta > 0 ? "up" : "down");
      const flecha = Math.abs(delta) < 2 ? "≈" : (delta > 0 ? "▲" : "▼");
      $stRollSub.textContent = `${flecha} ${sign}${delta.toFixed(1)}% vs T.Hist`;
      $stRollSub.className = `stat-sub ${cls}`;
    } else {
      $stRollSub.textContent = "";
      $stRollSub.className = "stat-sub neutral";
    }
  } else {
    $stRoll.textContent = "—";
    $stRollSub.textContent = "";
  }

  // Tendencia = comparar primer 30% vs ultimo 30% del rolling
  if (rollingData.length >= 5) {
    const n = rollingData.length;
    const cut = Math.max(1, Math.floor(n * 0.3));
    const inicio = rollingData.slice(0, cut).map(p => p[1]);
    const fin    = rollingData.slice(n - cut).map(p => p[1]);
    const avgIni = inicio.reduce((a, b) => a + b, 0) / inicio.length;
    const avgFin = fin.reduce((a, b) => a + b, 0) / fin.length;
    const delta = ((avgFin - avgIni) / avgIni) * 100;
    const cls = Math.abs(delta) < 2 ? "neutral" : (delta > 0 ? "up" : "down");
    const flecha = Math.abs(delta) < 2 ? "≈" : (delta > 0 ? "▲ Empeora" : "▼ Mejora");
    $stTrend.textContent = `${(delta > 0 ? "+" : "") + delta.toFixed(1)}%`;
    $stTrend.style.color = cls === "up" ? "#dc2626" : (cls === "down" ? "#16a34a" : "#64748b");
    $stTrendSub.textContent = flecha;
    $stTrendSub.className = `stat-sub ${cls}`;
  } else {
    $stTrend.textContent = "—";
    $stTrend.style.color = "";
    $stTrendSub.textContent = "Pocos datos";
    $stTrendSub.className = "stat-sub neutral";
  }

  $statsRow.style.display = "grid";
  const $dotsRow = document.getElementById("dotsRow");
  if ($dotsRow) $dotsRow.style.display = "block";
}
