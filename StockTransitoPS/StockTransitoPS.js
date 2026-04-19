"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusEl    = document.getElementById("status");
const resultEl    = document.getElementById("result");
const searchInput = document.getElementById("searchInput");
const filtroPS    = document.getElementById("filtroPS");
const filtroStock = document.getElementById("filtroStock");

let filasGlobal = [];

/* ============ HELPERS ============ */
function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function norm(v) {
  return String(v ?? "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function num(v) {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim().replace(/[^\d,.-]/g, "");
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  return Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

async function fetchAll(tabla) {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb.from(tabla).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(tabla + ": " + error.message);
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

/* ============ CARGAR DATOS ============ */
async function cargarDatos() {
  try {
    statusEl.textContent = "Cargando datos...";

    const [partesPS, entregasPS, enviosPS] = await Promise.all([
      fetchAll("Partes x PS"),
      fetchAll("Entregas PS"),
      fetchAll("Envios a PS")
    ]);

    // 1. Identificar partes en transito: Partes x PS donde SP es null o SP es "ST"
    const transitoParts = partesPS.filter(p => {
      const sp = String(p["SP"] || "").trim();
      return (!sp || sp === "ST") && p["PS"];
    });

    // 2. PS siguientes: los que tienen SC="ST" (reciben desde Stock Transito)
    // Agrupar por SC_Original para vincular con el PS origen que tiene el mismo SC
    const stParts = partesPS.filter(p => String(p["SC"] || "").trim() === "ST" && p["PS"]);
    const stPorSCOrig = new Map(); // sc_original → [{PS, SP, Proceso, ...}]
    for (const p of stParts) {
      const scOrig = String(p["SC_Original"] || "").trim();
      if (!scOrig) continue;
      if (!stPorSCOrig.has(scOrig)) stPorSCOrig.set(scOrig, []);
      stPorSCOrig.get(scOrig).push(p);
    }

    // Fallback: tambien buscar PS siguiente por mismo SC (logica original para los que no usan ST)
    const psPorSC = new Map();
    for (const p of partesPS) {
      const sc = String(p["SC"] || "").trim();
      if (!sc || sc === "ST") continue;
      if (!psPorSC.has(sc)) psPorSC.set(sc, []);
      psPorSC.get(sc).push(p);
    }

    // 3. Sumar entregas (piezas que volvieron del PS) por PS+Parte+SC
    const entregaMap = new Map(); // "ps|parte|sc" → { kg, cajones, detalle[] }
    for (const e of entregasPS) {
      const ps = String(e["Prov_Serv"] || "").trim();
      const parte = norm(e["Parte"] || "");
      const sc = String(e["Sector SC"] || "").trim();
      const key = norm(ps) + "|" + parte + "|" + norm(sc);
      if (!entregaMap.has(key)) entregaMap.set(key, { kg: 0, cajones: 0, detalle: [] });
      const m = entregaMap.get(key);
      m.kg += num(e["KG"]);
      m.cajones += num(e["Cajones"]);
      m.detalle.push({
        ps: ps,
        fecha: String(e["Dia-mes"] || "").trim(),
        kg: num(e["KG"]),
        cajones: num(e["Cajones"])
      });
    }

    // 4. Sumar envios al siguiente PS por Parte+SC
    // Para cada parte en transito, los envios SON los que van al siguiente PS
    const envioMap = new Map(); // "ps|parte|sc" → { kg, cajones, detalle[] }
    for (const e of enviosPS) {
      const ps = String(e["Prov_Serv"] || "").trim();
      const parte = norm(e["Parte"] || "");
      const sc = String(e["Sector SC"] || "").trim();
      const key = norm(ps) + "|" + parte + "|" + norm(sc);
      if (!envioMap.has(key)) envioMap.set(key, { kg: 0, cajones: 0, detalle: [] });
      const m = envioMap.get(key);
      m.kg += num(e["KG"]);
      m.cajones += num(e["Cajones"]);
      m.detalle.push({
        ps: ps,
        fecha: String(e["Dia-mes"] || "").trim(),
        kg: num(e["KG"]),
        cajones: num(e["Cajones"])
      });
    }

    // 5. Construir filas de transito
    filasGlobal = [];
    const psSet = new Set();

    for (const t of transitoParts) {
      const ps = String(t["PS"] || "").trim();
      const proceso = String(t["Proceso"] || "").trim();
      const parte = String(t["Parte"] || "").trim();
      const sc = String(t["SC"] || "").trim();
      psSet.add(ps);

      // Entregas de este PS (lo que volvio)
      const keyEntrega = norm(ps) + "|" + norm(parte) + "|" + norm(sc);
      const ent = entregaMap.get(keyEntrega) || { kg: 0, cajones: 0, detalle: [] };

      // Buscar PS siguiente:
      // 1. Primero buscar en partes con SC="ST" y SC_Original = mismo SC (nuevo sistema)
      // 2. Fallback: otro PS del mismo SC que tiene SP (sistema original)
      let hermanos = (stPorSCOrig.get(sc) || []).filter(p =>
        String(p["PS"] || "").trim() !== ps
      );
      if (!hermanos.length) {
        hermanos = (psPorSC.get(sc) || []).filter(p =>
          p["SP"] && String(p["PS"] || "").trim() !== ps
        );
      }
      const psSiguiente = hermanos.length > 0
        ? hermanos.map(h => String(h["PS"] || "").trim()).join(", ")
        : "";
      const procesoSiguiente = hermanos.length > 0
        ? hermanos.map(h => String(h["Proceso"] || "").trim()).join(", ")
        : "";

      // Envios al siguiente PS (lo que se mando)
      // Buscar todos los envios del PS siguiente con la misma parte (cualquier SC)
      let env = { kg: 0, cajones: 0, detalle: [] };
      const envVistos = new Set();
      for (const h of hermanos) {
        const nextPS = norm(h["PS"] || "");
        const nextParte = norm(h["Parte"] || "");
        // Buscar todas las claves que matcheen este PS+Parte
        for (const [k, v] of envioMap) {
          if (k.startsWith(nextPS + "|" + nextParte + "|") && !envVistos.has(k)) {
            envVistos.add(k);
            env.kg += v.kg;
            env.cajones += v.cajones;
            env.detalle.push(...v.detalle);
          }
        }
      }

      // Stock en transito = entregas - envios
      const transitoKg = ent.kg - env.kg;
      const transitoCaj = ent.cajones - env.cajones;

      filasGlobal.push({
        ps, proceso, parte, sc,
        psSiguiente, procesoSiguiente,
        entregaKg: ent.kg, entregaCaj: ent.cajones, entregaDetalle: ent.detalle,
        envioKg: env.kg, envioCaj: env.cajones, envioDetalle: env.detalle,
        transitoKg, transitoCaj
      });
    }

    // Ordenar por PS, luego parte
    filasGlobal.sort((a, b) => a.ps.localeCompare(b.ps, "es") || a.parte.localeCompare(b.parte, "es"));

    // Llenar filtro PS
    const psOrdenados = [...psSet].sort((a, b) => a.localeCompare(b, "es"));
    filtroPS.innerHTML = '<option value="">Todos los PS</option>' +
      psOrdenados.map(p => '<option value="' + esc(p) + '">' + esc(p) + '</option>').join("");

    filtrarYRender();
    statusEl.textContent = filasGlobal.length + " partes en transito identificadas";
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    console.error(err);
  }
}

/* ============ FILTRAR Y RENDER ============ */
function filtrarYRender() {
  const q = norm(searchInput.value);
  const psVal = filtroPS.value;
  const stockVal = filtroStock.value;

  const filas = filasGlobal.filter(r => {
    if (q && !norm(r.parte).includes(q) && !norm(r.ps).includes(q) &&
        !norm(r.proceso).includes(q) && !norm(r.sc).includes(q) &&
        !norm(r.psSiguiente).includes(q)) return false;
    if (psVal && r.ps !== psVal) return false;
    const tieneStock = Math.abs(r.transitoKg) > 0 || Math.abs(r.transitoCaj) > 0;
    if (stockVal === "conStock" && !tieneStock) return false;
    if (stockVal === "sinStock" && tieneStock) return false;
    return true;
  });

  renderTabla(filas);
}

/* ============ RENDER ============ */
let popupData = [];

function renderTabla(filas) {
  if (!filas.length) {
    resultEl.innerHTML = '<p class="no-results">Sin resultados.</p>';
    return;
  }

  popupData = [];
  let rows = "";

  for (const r of filas) {
    const trKg = r.transitoKg;
    const trCaj = r.transitoCaj;
    const clsKg = trKg > 0 ? "positivo" : trKg < 0 ? "negativo" : "zero";
    const clsCaj = trCaj > 0 ? "positivo" : trCaj < 0 ? "negativo" : "zero";

    // Popup entregas
    const idxEnt = popupData.length;
    popupData.push({ title: "Entregas de " + r.ps + " — " + r.parte, items: r.entregaDetalle });
    // Popup envios
    const idxEnv = popupData.length;
    popupData.push({ title: "Envios a " + (r.psSiguiente || "?") + " — " + r.parte, items: r.envioDetalle });

    rows += '<tr>';
    rows += '<td>' + esc(r.parte) + '</td>';
    rows += '<td class="center bold">' + esc(r.sc) + '</td>';
    rows += '<td><span class="badge-ps">' + esc(r.ps) + '</span></td>';
    rows += '<td>' + (r.psSiguiente ? '<span class="badge-ps">' + esc(r.psSiguiente) + '</span>' : '<span class="zero">-</span>') + '</td>';
    rows += '<td class="right ' + clsKg + '">' + fmt(trKg) + '</td>';
    rows += '<td class="center"><div class="cell-combo"><span class="cell-total">' + (r.entregaKg ? fmt(r.entregaKg) : '0') + '</span><button class="mini-popup-btn" onclick="abrirPopup(' + idxEnt + ')">+</button></div></td>';
    rows += '<td class="center"><div class="cell-combo"><span class="cell-total">' + (r.envioKg ? fmt(r.envioKg) : '0') + '</span><button class="mini-popup-btn" onclick="abrirPopup(' + idxEnv + ')">+</button></div></td>';
    rows += '</tr>';
  }

  resultEl.innerHTML = `
    <div class="articulo">
      <div class="articulo-header">Stock en Transito — ${filas.length} partes</div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th rowspan="2">Parte</th>
              <th rowspan="2">SC</th>
              <th rowspan="2">PS Origen</th>
              <th rowspan="2">PS Siguiente</th>
              <th class="group-header">Online</th>
              <th rowspan="2">Entrega<br>PS Origen</th>
              <th rowspan="2">Envio<br>PS Siguiente</th>
            </tr>
            <tr>
              <th>Transito Kg</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============ POPUP DETALLE ============ */
function abrirPopup(idx) {
  const data = popupData[idx];
  if (!data) return;

  let bodyHtml = "";
  if (!data.items || data.items.length === 0) {
    bodyHtml = '<div class="popup-line" style="color:#888;text-align:center">Sin movimientos registrados</div>';
  } else {
    // Ordenar por fecha desc
    const sorted = [...data.items].sort((a, b) => {
      const fa = String(a.fecha || "").split(/[/-]/);
      const fb = String(b.fecha || "").split(/[/-]/);
      const da = (fa[1] || 0) * 100 + (fa[0] || 0);
      const db = (fb[1] || 0) * 100 + (fb[0] || 0);
      return db - da;
    });
    for (const it of sorted) {
      bodyHtml += '<div class="popup-line">';
      if (it.ps) bodyHtml += '<span class="badge-ps" style="margin-right:6px">' + esc(it.ps) + '</span>';
      bodyHtml += '<strong>' + esc(it.fecha || "?") + '</strong>';
      if (it.kg) bodyHtml += ' — ' + fmt(it.kg) + ' kg';
      if (it.cajones) bodyHtml += ' — ' + fmt(it.cajones) + ' caj';
      bodyHtml += '</div>';
    }
  }

  const overlay = document.createElement("div");
  overlay.className = "popup-overlay";
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="popup-box">
      <div class="popup-head">
        <div class="popup-title">${esc(data.title)}</div>
        <button class="popup-close" onclick="this.closest('.popup-overlay').remove()">✕</button>
      </div>
      <div class="popup-body">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(overlay);
}

/* ============ EVENTOS ============ */
searchInput.addEventListener("input", filtrarYRender);
filtroPS.addEventListener("change", filtrarYRender);
filtroStock.addEventListener("change", filtrarYRender);

/* ============ INIT ============ */
cargarDatos();
