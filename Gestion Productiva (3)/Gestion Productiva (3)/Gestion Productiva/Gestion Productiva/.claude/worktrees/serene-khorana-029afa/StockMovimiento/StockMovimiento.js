"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusEl       = document.getElementById("status");
const resultEl       = document.getElementById("result");
const searchInput    = document.getElementById("searchInput");
const selFiltroStock = document.getElementById("selFiltroStock");

let filasGlobal = [];

function setStatus(t) { statusEl.textContent = t || ""; }

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeText(v) {
  return String(v || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[^\d,.-]/g, "");
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatKg(n) {
  return Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
function formatCaj(n) {
  return Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}
function formatUni(n) {
  return Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: 0 });
}
function formatDec(n) {
  return Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
}

function pick(obj, ...keys) {
  for (const k of keys) if (obj != null && k in obj) return obj[k];
  return undefined;
}

function esUbicacionSM(valor) {
  const v = String(valor || "").trim();
  return /^mat(riz)?\s*\d+/i.test(v);
}

function normUbicacion(valor) {
  return String(valor || "").trim().toUpperCase().replace(/\s+/g, " ");
}

async function fetchTabla(nombre) {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabaseClient.from(nombre).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(`${nombre}: ${error.message}`);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function cargarTodo() {
  try {
    setStatus("Cargando datos...");
    resultEl.innerHTML = "";

    const [causaRows, dbRows, scRows] = await Promise.all([
      fetchTabla("Causa-Efecto"),
      fetchTabla("db_n8n_espejo"),
      fetchTabla("SC Kg")
    ]);

    // 1. Construir mapa de Causa-Efecto
    // causaPorMatriz: matriz → [{ descuenta, aumenta, desc }]
    const causaPorMatriz = new Map();
    causaRows.forEach(r => {
      const mat = String(r["Matriz"] ?? "").trim();
      if (!mat) return;
      if (!causaPorMatriz.has(mat)) causaPorMatriz.set(mat, []);
      causaPorMatriz.get(mat).push({
        descuenta: String(r["Descuenta"] ?? "").trim(),
        aumenta: String(r["Aumenta"] ?? "").trim(),
        desc: String(r["Descripcion Matriz"] ?? "").trim()
      });
    });

    // 2. Identificar ubicaciones SM (donde Aumenta = Mat/Matriz X)
    // Para cada ubicación SM:
    //   - matrizQueProducce: la matriz cuyo Aumenta = esta ubicación
    //   - matrizPost: la matriz cuyo Descuenta = esta ubicación
    const ubicacionesSM = new Map(); // normUbicacion → { nombre, matrizProduce, operacion, matrizPost }

    causaRows.forEach(r => {
      const aumenta = String(r["Aumenta"] ?? "").trim();
      if (!esUbicacionSM(aumenta)) return;

      const key = normUbicacion(aumenta);
      if (!ubicacionesSM.has(key)) {
        ubicacionesSM.set(key, {
          nombre: aumenta,
          matrizProduce: String(r["Matriz"] ?? "").trim(),
          operacion: String(r["Descripcion Matriz"] ?? "").trim(),
          matrizPost: null
        });
      }
    });

    // Encontrar matrizPost: la que tiene Descuenta = esta ubicación
    causaRows.forEach(r => {
      const descuenta = String(r["Descuenta"] ?? "").trim();
      const key = normUbicacion(descuenta);
      if (ubicacionesSM.has(key)) {
        ubicacionesSM.get(key).matrizPost = String(r["Matriz"] ?? "").trim();
      }
    });

    // 3. Para cada ubicación SM, seguir cadena hasta encontrar SC destino
    function encontrarSCDestino(ubicKey) {
      const visited = new Set();
      let current = ubicKey;
      for (let i = 0; i < 20; i++) {
        if (visited.has(current)) return null;
        visited.add(current);

        const ubic = ubicacionesSM.get(current);
        if (!ubic || !ubic.matrizPost) return null;

        // Ver qué Aumenta la matrizPost
        const efectos = causaPorMatriz.get(ubic.matrizPost) || [];
        for (const ef of efectos) {
          if (normUbicacion(ef.descuenta) === current) {
            const dest = normUbicacion(ef.aumenta);
            if (!esUbicacionSM(ef.aumenta)) {
              return ef.aumenta.trim(); // SC destino
            }
            current = dest;
            break;
          }
        }
      }
      return null;
    }

    // 4. Mapa SC → { kgUni, kgCajon }
    const scMap = new Map();
    scRows.forEach(r => {
      const sc = String(r["SC"] ?? "").trim().toUpperCase();
      if (!sc) return;
      scMap.set(sc, {
        kgUni: num(r["Kg X Uni"] || r["Kg x Uni"]),
        kgCajon: num(r["KG x Cajon"] || r["Kg x Cajon"])
      });
    });

    // 5. Fabricación: sumar Uni por Matriz de db_n8n_espejo
    const fabPorMatriz = new Map();
    const fabDetallePorMatriz = new Map();
    dbRows.forEach(r => {
      if (String(r["Legajo"] ?? "").trim() === "1") return;
      const mat = String(r["Matriz"] ?? "").trim();
      const uni = num(r["Uni"]);
      if (!mat || !uni) return;

      fabPorMatriz.set(mat, (fabPorMatriz.get(mat) || 0) + uni);

      if (!fabDetallePorMatriz.has(mat)) fabDetallePorMatriz.set(mat, []);
      const mes = String(r["Mes"] ?? "").padStart(2, "0");
      const dia = String(r["Dia"] ?? "").padStart(2, "0");
      const fecha = (r["Mes"] && r["Dia"]) ? `${dia}/${mes}` : "";
      const empleado = String(r["Nombre_Empleado"] ?? "").trim();
      fabDetallePorMatriz.get(mat).push({ fecha, uni, empleado });
    });

    // 6. Construir filas
    filasGlobal = [];

    ubicacionesSM.forEach((ubic, key) => {
      const scDestino = encontrarSCDestino(key);
      const scInfo = scDestino ? (scMap.get(scDestino.toUpperCase()) || { kgUni: 0, kgCajon: 0 }) : { kgUni: 0, kgCajon: 0 };

      const fabMat = fabPorMatriz.get(ubic.matrizProduce) || 0;
      const fabMatPost = ubic.matrizPost ? (fabPorMatriz.get(ubic.matrizPost) || 0) : 0;

      const stockInicial = 0;
      const uniOnline = stockInicial + fabMat - fabMatPost;
      const kgOnline = uniOnline * scInfo.kgUni;
      const cajOnline = scInfo.kgCajon > 0 ? kgOnline / scInfo.kgCajon : 0;

      const detalleFabMat = fabDetallePorMatriz.get(ubic.matrizProduce) || [];
      const detalleFabPost = ubic.matrizPost ? (fabDetallePorMatriz.get(ubic.matrizPost) || []) : [];

      filasGlobal.push({
        matriz: ubic.matrizProduce,
        operacion: ubic.operacion,
        ubicacion: ubic.nombre,
        kgOnline,
        cajOnline,
        uniOnline,
        fabMat,
        fabMatPost,
        kgUni: scInfo.kgUni,
        kgCajon: scInfo.kgCajon,
        stockInicial,
        scDestino: scDestino || "",
        matrizPost: ubic.matrizPost || "",
        detalleFabMat,
        detalleFabPost
      });
    });

    // Ordenar por número de matriz
    filasGlobal.sort((a, b) => {
      const na = parseInt(a.matriz) || 0;
      const nb = parseInt(b.matriz) || 0;
      return na - nb;
    });

    filtrarYRender();
    setStatus(`${filasGlobal.length} ubicaciones en movimiento`);
  } catch (err) {
    console.error("ERROR:", err);
    setStatus(err.message || "Error al cargar datos");
  }
}

function filtrarYRender() {
  const q = normalizeText(searchInput.value);
  const modo = selFiltroStock.value;

  const filas = filasGlobal.filter(r => {
    const matchBusqueda = !q ||
      normalizeText(r.matriz).includes(q) ||
      normalizeText(r.operacion).includes(q) ||
      normalizeText(r.ubicacion).includes(q);

    if (!matchBusqueda) return false;

    const tieneStock = Math.abs(r.uniOnline) > 0;
    if (modo === "conStock" && !tieneStock) return false;
    if (modo === "sinStock" && tieneStock) return false;

    return true;
  });

  renderTabla(filas);
}

let popupDataStore = [];

function renderTabla(filas) {
  if (!filas.length) {
    resultEl.innerHTML = `<p style="color:#888;margin-top:16px">Sin resultados.</p>`;
    return;
  }

  popupDataStore = [];
  let rows = "";
  filas.forEach(r => {
    const uniColor = r.uniOnline > 0 ? "" : r.uniOnline < 0 ? "color:#b00000;font-weight:700" : "color:#999";

    // Ordenar detalle de más reciente a más antiguo (por fecha DD/MM desc, luego por uni desc)
    function sortDetDesc(arr) {
      return [...(arr || [])].sort((a, b) => {
        const [dA, mA] = (a.fecha || "00/00").split("/").map(Number);
        const [dB, mB] = (b.fecha || "00/00").split("/").map(Number);
        if (mB !== mA) return mB - mA;
        if (dB !== dA) return dB - dA;
        return (b.uni || 0) - (a.uni || 0);
      });
    }
    const detMat = sortDetDesc(r.detalleFabMat);
    const detPost = sortDetDesc(r.detalleFabPost);

    const idxMat = popupDataStore.length;
    popupDataStore.push({ title: `Fab Mat ${r.matriz} — ${r.operacion}`, items: detMat });
    const idxPost = popupDataStore.length;
    popupDataStore.push({ title: `Fab Mat ${r.matrizPost} (siguiente)`, items: detPost });

    rows += `
      <tr>
        <td class="center">${escapeHtml(r.matriz)}</td>
        <td title="${escapeHtml(r.operacion)}">${escapeHtml(r.operacion)}</td>
        <td class="right" style="${uniColor}"><b>${escapeHtml(formatKg(r.kgOnline))}</b></td>
        <td class="right" style="${uniColor}"><b>${escapeHtml(formatCaj(r.cajOnline))}</b></td>
        <td class="right" style="${uniColor}"><b>${escapeHtml(formatUni(r.uniOnline))}</b></td>
        <td class="center">
          <div class="cell-combo">
            <span class="cell-total">${escapeHtml(formatUni(r.fabMat))}</span>
            <button type="button" class="mini-popup-btn" data-popup-idx="${idxMat}">+</button>
          </div>
        </td>
        <td class="center">
          <div class="cell-combo">
            <span class="cell-total">${escapeHtml(formatUni(r.fabMatPost))}</span>
            <button type="button" class="mini-popup-btn" data-popup-idx="${idxPost}">+</button>
          </div>
        </td>
        <td class="right mono">${escapeHtml(formatDec(r.kgUni))}</td>
        <td class="right mono">${escapeHtml(formatDec(r.kgCajon))}</td>
        <td class="right mono">0</td>
      </tr>
    `;
  });

  resultEl.innerHTML = `
    <div class="articulo">
      <div class="articulo-header">Stock en Movimiento</div>
      <div class="table-scroll">
        <table class="table">
          <colgroup>
            <col style="width:4ch">
            <col style="width:20ch">
            <col style="width:6ch">
            <col style="width:5ch">
            <col style="width:7ch">
            <col style="width:88px">
            <col style="width:88px">
            <col style="width:6ch">
            <col style="width:6ch">
            <col style="width:9ch">
          </colgroup>
          <thead>
            <tr>
              <th colspan="2">Base</th>
              <th colspan="3" class="center">Online</th>
              <th colspan="2" class="center">Fabricación</th>
              <th colspan="3" class="center">Info</th>
            </tr>
            <tr>
              <th>Matriz</th>
              <th>Descripción</th>
              <th class="center">Kg</th>
              <th class="center">Caj</th>
              <th class="center">Uni</th>
              <th class="center">Fab Mat</th>
              <th class="center">Fab Mat<br>Post</th>
              <th class="center">Kg x<br>Uni</th>
              <th class="center">Kg x<br>Cajon</th>
              <th class="center">Stock<br>Inicial</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>

    <div id="popupOverlay" class="popup-overlay hidden">
      <div class="popup-box">
        <div class="popup-head">
          <div id="popupTitle" class="popup-title"></div>
          <button id="popupClose" type="button" class="popup-close">✕</button>
        </div>
        <div id="popupBody" class="popup-body"></div>
      </div>
    </div>
  `;

  const popupOverlay = document.getElementById("popupOverlay");
  const popupTitle   = document.getElementById("popupTitle");
  const popupBody    = document.getElementById("popupBody");
  const popupClose   = document.getElementById("popupClose");

  function renderPopupTabla(items, showAll) {
    if (!items || !items.length) {
      return `<div style="padding:14px 16px;">Sin fabricacion.</div>`;
    }
    const visible = showAll ? items : items.slice(0, 5);
    const hayMas = !showAll && items.length > 5;

    return `
      <div style="max-height:50vh;overflow-y:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f5f5f5;position:sticky;top:0;z-index:1;">
              <th style="text-align:center;padding:10px 8px;font-weight:700;font-size:15px;border-bottom:2px solid #ddd;">Fecha</th>
              <th style="text-align:center;padding:10px 8px;font-weight:700;font-size:15px;border-bottom:2px solid #ddd;">Empleado</th>
              <th style="text-align:center;padding:10px 8px;font-weight:700;font-size:15px;border-bottom:2px solid #ddd;">Uni</th>
            </tr>
          </thead>
          <tbody>
            ${visible.map(d => `
              <tr>
                <td style="text-align:center;padding:8px;border-top:1px solid #eee;font-size:14px;">${escapeHtml(d.fecha || "")}</td>
                <td style="text-align:center;padding:8px;border-top:1px solid #eee;font-size:14px;">${escapeHtml(d.empleado || "?")}</td>
                <td style="text-align:center;padding:8px;border-top:1px solid #eee;font-size:14px;font-weight:700;">${escapeHtml(formatUni(d.uni))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
      ${hayMas ? `<div style="text-align:center;padding:8px;border-top:1px solid #eee;">
        <button id="smPopupVerMas" type="button" style="border:1px solid #ccc;background:#fff;padding:6px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;">Ver todo (${items.length})</button>
      </div>` : ""}
    `;
  }

  resultEl.querySelectorAll(".mini-popup-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.popupIdx);
      const data = popupDataStore[idx];
      if (!data) return;

      popupTitle.textContent = data.title;
      popupBody.innerHTML = renderPopupTabla(data.items, false);

      const btnMas = document.getElementById("smPopupVerMas");
      if (btnMas) {
        btnMas.addEventListener("click", () => {
          popupBody.innerHTML = renderPopupTabla(data.items, true);
        });
      }

      popupOverlay.classList.remove("hidden");
    });
  });

  popupClose.addEventListener("click", () => popupOverlay.classList.add("hidden"));
  popupOverlay.addEventListener("click", e => {
    if (e.target === popupOverlay) popupOverlay.classList.add("hidden");
  });
}

searchInput.addEventListener("input", filtrarYRender);
selFiltroStock.addEventListener("change", filtrarYRender);
document.addEventListener("DOMContentLoaded", cargarTodo);
