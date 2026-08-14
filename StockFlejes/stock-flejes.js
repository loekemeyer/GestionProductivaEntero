"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusEl = document.getElementById("status");
const tblBody = document.getElementById("tblBody");
const txtBuscar = document.getElementById("txtBuscar");
const selProv = document.getElementById("selProv");
const selStock = document.getElementById("selStock");

let flejesData = [];
let rowsProcessed = [];
let causaEfectoData = [];
let produccionData = [];
let scKgData = [];
let partesXPSData = [];
let despieceData = [];
let eMadreLKData = [];
let eMadreCHData = [];
let relevamientosData = []; // relevamiento_cervantes.relevamientos para Flejes
let comprasFlejesMap = new Map(); // N Fleje → total cantidad
let comprasFlejesDetalleMap = new Map(); // N Fleje → [{proveedor, fecha, cantidad, remito}]
let flejStockPorNFleje = new Map(); // N Fleje → {fleje_id, relevamiento_id, ...}

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function n(v) { return isNaN(v) ? 0 : Number(v); }
function normalizeText(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const PEDIDO_MIN_COD = 1000;
const PEDIDO_MIN_PROV = {
  "Basconia": 5000, "Aperam": 5000, "Hermac": 5000, "Brawin": 5000,
  "Altrak": 1000, "Szapiro": 1000, "EstaMetal": 1000, "JL Metales": 1000, "Alami": 1000
};

/* ================= CARGAR DATOS ================= */
async function init() {
  statusEl.textContent = "Cargando datos...";

  try {
    const [resFlejes, resCausa, resSC, resPS, resDesp, resLK, resCH, resCompras, resRelev] = await Promise.all([
      sb.from("Flejes").select("*"),
      sb.from("Causa-Efecto").select("*"),
      sb.from("SC Kg").select("*"),
      sb.from("Partes x PS").select("*"),
      sb.from("Despiece x Articulo").select("*"),
      sb.from("E. Madre LK").select("*"),
      sb.from("E. Madre CH").select("*"),
      sb.from("Recepcion_Insumos").select("*").eq("rubro","Flejes"),
      sb.from("relevamiento_cervantes.relevamientos").select("id, creado_en").eq("tipo", "flejes").eq("planta", "Cervantes")
    ]);

    // Cargar db_n8n_espejo con paginacion (Supabase cap 1000 rows/request)
    const allProd = [];
    const PAGE = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await sb
        .from("db_n8n_espejo")
        .select("*")
        .neq("Legajo", "1")  // excluir registros de Pruebas (Legajo 1)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      allProd.push(...data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    // Procesar compras Flejes (rubro=Flejes, codigo=N Fleje).
    // FILTRO CLAVE: solo se cuentan las recepciones POSTERIORES al ultimo relevamiento
    // de esa planta (Flejes_Stock_Planta.stock_inicial_updated_at). Cervantes es la
    // planta de origen/produccion. Sin este filtro, cualquier recepcion cargada antes
    // del relevamiento se contaba 2 veces (una en Stock_Inicial, otra sumada aca).
    const resStockPlanta = await sb
      .from("Flejes_Stock_Planta")
      .select("*")
      .eq("planta", "Cervantes");
    const stockIniTsByFleje = new Map();
    (resStockPlanta.data || []).forEach(sp => {
      const f = (resFlejes.data || []).find(x => x.id === sp.fleje_id);
      if (f) {
        const nfl = String(f["N Fleje"] ?? "").trim();
        const ts = sp.stock_inicial_updated_at;
        if (nfl && ts) stockIniTsByFleje.set(nfl, ts);
      }
    });
    comprasFlejesMap.clear();
    comprasFlejesDetalleMap.clear();
    (resCompras.data || []).forEach(r => {
      const cod = String(r.codigo || "").trim();
      if (!cod) return;
      const ts = stockIniTsByFleje.get(cod);
      // r.fecha es DATE (YYYY-MM-DD); ts es timestamptz -> comparo por YYYY-MM-DD
      if (ts && String(r.fecha) < String(ts).slice(0,10)) return;
      const cant = Number(r.cantidad) || 0;
      comprasFlejesMap.set(cod, (comprasFlejesMap.get(cod) || 0) + cant);
      if (!comprasFlejesDetalleMap.has(cod)) comprasFlejesDetalleMap.set(cod, []);
      comprasFlejesDetalleMap.get(cod).push({
        proveedor: r.proveedor, fecha: r.fecha, cantidad: cant, remito: r.remito
      });
    });

    if (resFlejes.error) throw resFlejes.error;
    if (resCausa.error) throw resCausa.error;
    if (resSC.error) throw resSC.error;
    if (resPS.error) throw resPS.error;
    if (resDesp.error) throw resDesp.error;
    if (resLK.error) throw resLK.error;
    if (resCH.error) throw resCH.error;

    flejesData = resFlejes.data || [];
    causaEfectoData = resCausa.data || [];
    produccionData = allProd; /* paginado completo */
    scKgData = resSC.data || [];
    partesXPSData = resPS.data || [];
    despieceData = resDesp.data || [];
    eMadreLKData = resLK.data || [];
    eMadreCHData = resCH.data || [];
    relevamientosData = resRelev.data || [];

    // Mapear N Fleje → Flejes_Stock_Planta para obtener relevamiento_id
    flejStockPorNFleje.clear();
    const resFlejStockPlanta = await sb.from("Flejes_Stock_Planta").select("*").eq("planta", "Cervantes");
    (resFlejStockPlanta.data || []).forEach(sp => {
      const f = flejesData.find(x => x.id === sp.fleje_id);
      if (f) {
        const nFleje = String(f["N Fleje"]).trim();
        flejStockPorNFleje.set(nFleje, sp);
      }
    });

    buildLookups();

    // Poblar filtro de proveedores
    const provs = [...new Set(flejesData.map(f => f["Proveedor"] || "").filter(p => p && p !== "#N/D"))].sort();
    provs.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      selProv.appendChild(opt);
    });

    procesarRows();
    aplicarFiltros();
    statusEl.textContent = `${rowsProcessed.length} flejes cargados`;
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    console.error("Init error:", err);
  }
}

/* ================= LOOKUPS PARA CONSUMO MENSUAL ================= */
let scPorFleje = {};      // nFleje → [{sc, kgMatParte}]
let scToSP = {};          // sc → [sp]
let despiecePorSector = {}; // sectorProce → [{cod, partesXuni, kgXuni}]
let eMadrePorCod = {};    // cod → eMadre (LK + CH)

function buildLookups() {
  // SC Kg: agrupar por N Fleje
  scPorFleje = {};
  scKgData.forEach(r => {
    const nf = String(r["N Fleje"] || "").trim();
    if (!nf) return;
    if (!scPorFleje[nf]) scPorFleje[nf] = [];
    scPorFleje[nf].push({
      sc: String(r["SC"] || "").trim(),
      kgMatParte: n(r["KG Mat PARTE    C/Desp"])
    });
  });

  // Partes x PS: SC → SP
  scToSP = {};
  partesXPSData.forEach(r => {
    const sc = String(r["SC"] || "").trim();
    const sp = String(r["SP"] || "").trim();
    if (!sc || !sp) return;
    if (!scToSP[sc]) scToSP[sc] = new Set();
    scToSP[sc].add(sp);
  });

  // Despiece x Articulo: agrupar por Sector Proce
  despiecePorSector = {};
  despieceData.forEach(r => {
    const sec = String(r["Sector Proce"] || "").trim();
    if (!sec) return;
    if (!despiecePorSector[sec]) despiecePorSector[sec] = [];
    despiecePorSector[sec].push({
      cod: String(r["COD"] || "").trim(),
      partesXuni: n(r["Partes x uni"]),
      kgXuni: n(r["KGxUni"])
    });
  });

  // E. Madre: sumar LK + CH por código
  eMadrePorCod = {};
  eMadreLKData.forEach(r => {
    const cod = String(r["Cod"] || "").trim();
    if (cod) eMadrePorCod[cod] = (eMadrePorCod[cod] || 0) + n(r["E. Madre"]);
  });
  eMadreCHData.forEach(r => {
    const cod = String(r["Cod"] || "").trim();
    if (cod) eMadrePorCod[cod] = (eMadrePorCod[cod] || 0) + n(r["E. Madre"]);
  });
}

/* ================= CONSUMO MENSUAL (KG) ================= */
function calcularConsumoMensual(nFleje) {
  const scParts = scPorFleje[nFleje] || [];
  if (!scParts.length) return { total: 0, detalle: [] };

  let total = 0;
  const detalle = [];

  scParts.forEach(({ sc, kgMatParte }) => {
    // Buscar artículos: directo (SC en Despiece) + vía SP (SC → PS → SP → Despiece)
    const sectores = new Set([sc]);
    if (scToSP[sc]) scToSP[sc].forEach(sp => sectores.add(sp));

    sectores.forEach(sec => {
      const arts = despiecePorSector[sec] || [];
      arts.forEach(({ cod, partesXuni, kgXuni }) => {
        const eMadre = eMadrePorCod[cod] || 0;
        if (eMadre === 0 || kgXuni === 0) return;
        const consumo = eMadre * partesXuni * kgXuni;
        total += consumo;
        detalle.push({ sc, sec, cod, eMadre, partesXuni, kgXuni, consumo });
      });
    });
  });

  return { total: Math.round(total * 100) / 100, detalle };
}

/* ================= FABRICACIÓN =================
   Calcula los KG de fleje consumidos por la fabricación.
   1. Encuentra las matrices cuyas filas en Causa-Efecto descuentan este fleje (y qué sector aumentan).
   2. Para cada matriz, suma uni producidas en db_n8n_espejo.
   3. Multiplica uni × Kg X Uni del sector aumenta para obtener kg consumidos.
========================================================= */
function calcularFabricacion(nFleje, fechaRelev) {
  // Mapa Matriz → [sector_aumenta, ...] (una matriz puede producir varios sectores desde el mismo fleje)
  const matrizAumentaMap = new Map();
  const flejeLbl = "Fleje " + String(nFleje).trim(); // CE guarda "Fleje 20", no "20"
  causaEfectoData.forEach(ce => {
    if (String(ce.Descuenta || "").trim() === flejeLbl) {
      const m = String(ce.Matriz || "").trim();
      const a = String(ce.Aumenta || "").trim().toUpperCase();
      if (m && a) {
        if (!matrizAumentaMap.has(m)) matrizAumentaMap.set(m, []);
        matrizAumentaMap.get(m).push(a);
      }
    }
  });

  if (matrizAumentaMap.size === 0) return 0;

  // Construir mapa sector → kgXuni (desde SC Kg para conversiones)
  const kgXUniBySC = new Map();
  scKgData.forEach(r => {
    const sc = String(r["SC"] || "").trim().toUpperCase();
    const kg = n(r["Kg X Uni"]);
    if (sc && kg > 0) kgXUniBySC.set(sc, kg);
  });

  // FILTRO CLAVE: solo contar producción POSTERIOR al timestamp exacto del relevamiento
  // (no incluir producción anterior al relevamiento ni la del rollo en alimentador)
  const tsCompara = fechaRelev ? String(fechaRelev) : null;

  let totalKg = 0;
  produccionData.forEach(reg => {
    // Filtrar por timestamp > timestampRelev (DESPUÉS del momento exacto del relev)
    if (tsCompara) {
      const regTs = String(reg.Fecha || ""); // db_n8n_espejo.Fecha es timestamp
      if (!regTs || regTs <= tsCompara) return; // <= porque queremos DESPUÉS (>), no incluir el mismo momento
    }
    const matriz = String(reg.Matriz || "").trim();
    if (!matrizAumentaMap.has(matriz)) return;
    const uni = n(reg.Uni);
    if (!uni) return;
    const sectores = matrizAumentaMap.get(matriz);
    for (const sectorAumenta of sectores) {
      const kgPorUni = kgXUniBySC.get(sectorAumenta) || 0;
      totalKg += uni * kgPorUni;
    }
  });

  return Math.round(totalKg * 100) / 100;
}

/* ================= PROCESAR Y ORDENAR ================= */
function procesarRows() {
  // Mapear relevamiento_id → creado_en (timestamp exacto) para Flejes Cervantes
  let relevIdACreado = new Map();
  (relevamientosData || []).forEach(r => {
    if (r.id) relevIdACreado.set(r.id, r.creado_en);
  });

  rowsProcessed = flejesData.map(f => {
    const nFleje = f["N Fleje"] || "";
    const desc = f["Descripción"] || "";
    const medida = f["Medida mm"] || "";
    const prov = f["Proveedor"] || "";
    const stockInicial = n(f["Stock Inicial"]) || 0;
    const compras = comprasFlejesMap.get(String(nFleje)) || 0;
    const comprasDetalle = comprasFlejesDetalleMap.get(String(nFleje)) || [];
    // Usar timestamp EXACTO del creado_en del relevamiento, no solo la fecha
    let timestampRelev = f.stock_inicial_updated_at;
    const flejStockPl = flejStockPorNFleje.get(String(nFleje));
    if (flejStockPl && flejStockPl.relevamiento_id) {
      const creado = relevIdACreado.get(flejStockPl.relevamiento_id);
      if (creado) timestampRelev = creado;
    }
    const fabricacion = calcularFabricacion(nFleje, timestampRelev);
    const stockOnline = stockInicial + compras - fabricacion;
    const { total: consumoMes, detalle: consumoDetalle } = calcularConsumoMensual(nFleje);

    return { nFleje, desc, medida, prov, stockOnline, compras, comprasDetalle, fabricacion, stockInicial, consumoMes, consumoDetalle };
  });

  // Ordenar por proveedor, luego N° Fleje
  rowsProcessed.sort((a, b) => {
    const pa = a.prov.localeCompare(b.prov, "es");
    if (pa !== 0) return pa;
    return String(a.nFleje).localeCompare(String(b.nFleje), "es", { numeric: true });
  });
}

/* ================= FILTROS ================= */
function aplicarFiltros() {
  const q = normalizeText(txtBuscar.value);
  const provFiltro = selProv.value;
  const stockFiltro = selStock.value;

  const filtradas = rowsProcessed.filter(r => {
    if (q) {
      const match =
        normalizeText(r.nFleje).includes(q) ||
        normalizeText(r.desc).includes(q) ||
        normalizeText(r.prov).includes(q);
      if (!match) return false;
    }

    if (provFiltro !== "todos" && r.prov !== provFiltro) return false;

    if (stockFiltro === "conStock" && r.stockOnline === 0) return false;
    if (stockFiltro === "sinStock" && r.stockOnline !== 0) return false;

    return true;
  });

  renderTabla(filtradas);
}

txtBuscar.addEventListener("input", aplicarFiltros);
selProv.addEventListener("change", aplicarFiltros);
selStock.addEventListener("change", aplicarFiltros);

/* ================= MESES POR GRUPO ================= */
const mesesPorGrupo = {};

function getMesesGrupo(grupo) {
  return mesesPorGrupo[grupo] || 5;
}

function setMesesGrupo(grupo) {
  const inp = document.getElementById("meses_" + grupo.replace(/[^a-zA-Z0-9]/g, "_"));
  if (inp) mesesPorGrupo[grupo] = Number(inp.value) || 5;
  renderTabla(window._lastRows || []);
}

/* ================= RENDER ================= */
function renderTabla(rows) {
  window._lastRows = rows;
  let html = "";

  const rowsConPedido = rows.map(r => {
    const grupo = r.prov;
    const mult = getMesesGrupo(grupo);
    const stockMax = r.consumoMes * mult;
    const need = stockMax - r.stockOnline;
    let pedido = 0;
    if (need > 0) {
      pedido = Math.max(Math.ceil(need / PEDIDO_MIN_COD) * PEDIDO_MIN_COD, PEDIDO_MIN_COD);
    }
    const pedMinProv = PEDIDO_MIN_PROV[r.prov] || 1000;
    return { ...r, stockMax, pedido, pedMinProv, _grupo: grupo, _meses: mult };
  });

  window._rowsPedido = rowsConPedido;

  // Subtotales por proveedor
  const subtotales = {};
  rowsConPedido.forEach(r => {
    if (!subtotales[r._grupo]) subtotales[r._grupo] = { prov: r.prov, pedido: 0, count: 0 };
    subtotales[r._grupo].pedido += r.pedido;
    subtotales[r._grupo].count++;
  });

  let prevGrupo = "";
  rowsConPedido.forEach((r, i) => {
    const grupo = r._grupo;

    if (grupo !== prevGrupo) {
      // Subtotal del grupo anterior
      if (prevGrupo && subtotales[prevGrupo]) {
        const st = subtotales[prevGrupo];
        const minProv = PEDIDO_MIN_PROV[st.prov] || 1000;
        html += `<tr class="row-subtotal">
          <td colspan="4"></td>
          <td class="col-number">${st.pedido.toLocaleString("es-AR")}</td>
          <td></td>
          <td class="col-number" style="font-weight:400;font-size:11px;color:#666">mín ${minProv.toLocaleString("es-AR")}</td>
        </tr>`;
        html += `<tr class="row-sep"><td colspan="7"></td></tr>`;
      }

      // Header del nuevo grupo
      const gId = grupo.replace(/[^a-zA-Z0-9]/g, "_");
      const mVal = getMesesGrupo(grupo);
      html += `<tr class="row-grupo-header">
        <td colspan="2" style="font-size:13px">${esc(r.prov)}</td>
        <td colspan="3"></td>
        <td style="text-align:right;font-size:11px">Meses</td>
        <td><input id="meses_${gId}" type="number" value="${mVal}" min="1" max="24"
          onchange="setMesesGrupo('${esc(grupo)}')" /></td>
      </tr>`;
      prevGrupo = grupo;
    }

    const pedidoClass = r.pedido > 0 ? "col-number col-pedido col-clickable" : "col-number col-clickable";
    html += `<tr>
      <td class="col-marca">${esc(r.prov)}</td>
      <td class="col-nfleje">${esc(r.nFleje)}</td>
      <td class="col-desc" title="${esc(r.desc)}">${esc(r.desc)}</td>
      <td class="col-medida">${esc(r.medida)}</td>
      <td class="${pedidoClass}" onclick="popupPedido(${i})">${r.pedido.toLocaleString("es-AR")}</td>
      <td class="col-number col-clickable" onclick="popupStockMax(${i})">${r.stockMax.toFixed(1)}</td>
      <td class="col-number col-clickable" onclick="popupStockOnline(${i})">${r.stockOnline.toLocaleString("es-AR")}</td>
    </tr>`;
  });

  // Subtotal del último grupo
  if (prevGrupo && subtotales[prevGrupo]) {
    const st = subtotales[prevGrupo];
    const minProv = PEDIDO_MIN_PROV[st.prov] || 1000;
    html += `<tr class="row-subtotal">
      <td colspan="4"></td>
      <td class="col-number">${st.pedido.toLocaleString("es-AR")}</td>
      <td></td>
      <td class="col-number" style="font-weight:400;font-size:11px;color:#666">mín ${minProv.toLocaleString("es-AR")}</td>
    </tr>`;
  }

  tblBody.innerHTML = html || `<tr><td colspan="7" class="empty">No hay flejes cargados</td></tr>`;
}

/* ================= POPUPS ================= */
const popupEl = document.getElementById("popupDetalle");
const popupTitulo = document.getElementById("popupTitulo");
const popupBody = document.getElementById("popupBody");
document.getElementById("popupCerrar").onclick = () => popupEl.classList.add("hidden");
popupEl.addEventListener("click", e => { if (e.target === popupEl) popupEl.classList.add("hidden"); });

function abrirPopup(titulo, html) {
  popupTitulo.textContent = titulo;
  popupBody.innerHTML = html;
  popupEl.classList.remove("hidden");
}

function fmtN(v) { return Number(v).toLocaleString("es-AR"); }

function popupStockOnline(i) {
  const r = window._rowsPedido[i];
  if (!r) return;
  abrirPopup(`Stock Online — Fleje ${r.nFleje}`,
    `<table>
      <tr><td>Stock Inicial</td><td>${fmtN(r.stockInicial)}</td></tr>
      <tr><td>+ Compras</td><td>${fmtN(r.compras)}</td></tr>
      <tr><td>− Fabricación</td><td>${fmtN(r.fabricacion)}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Stock Online</b></td><td><b>${fmtN(r.stockOnline)}</b></td></tr>
    </table>`
  );
}

function popupStockMax(i) {
  const r = window._rowsPedido[i];
  if (!r) return;

  let detalleHtml = "";
  if (r.consumoDetalle && r.consumoDetalle.length) {
    detalleHtml = `<tr><td colspan="2" style="padding-top:10px;font-size:11px;color:#888">Desglose consumo:</td></tr>`;
    r.consumoDetalle.forEach(d => {
      detalleHtml += `<tr style="font-size:11px;color:#555">
        <td>Art ${d.cod} (${d.sec})</td>
        <td>${fmtN(d.eMadre)}×${d.partesXuni}×${d.kgXuni.toFixed(4)} = ${d.consumo.toFixed(2)} kg</td>
      </tr>`;
    });
  }

  abrirPopup(`Stock Max — Fleje ${r.nFleje}`,
    `<table>
      <tr><td>Consumo Mensual (kg)</td><td>${r.consumoMes.toFixed(2)}</td></tr>
      <tr><td>× Meses</td><td>${r._meses}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Stock Max (kg)</b></td><td><b>${r.stockMax.toFixed(2)}</b></td></tr>
      ${detalleHtml}
    </table>`
  );
}

function popupPedido(i) {
  const r = window._rowsPedido[i];
  if (!r) return;
  abrirPopup(`Pedido — Fleje ${r.nFleje}`,
    `<table>
      <tr><td>Stock Max</td><td>${fmtN(r.stockMax)}</td></tr>
      <tr><td>− Stock Online</td><td>${fmtN(r.stockOnline)}</td></tr>
      <tr><td>= Necesidad</td><td>${fmtN(r.stockMax - r.stockOnline)}</td></tr>
      <tr><td>Ped Min Cod</td><td>${fmtN(PEDIDO_MIN_COD)}</td></tr>
      <tr><td>Ped Min Prov</td><td>${fmtN(r.pedMinProv)}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Pedido</b></td><td><b>${fmtN(r.pedido)}</b></td></tr>
    </table>`
  );
}

/* ================= GENERAR PDF ================= */
document.getElementById("btnGenerarPDF").addEventListener("click", generarPDF);

function generarPDF() {
  const rows = window._rowsPedido || [];
  const conPedido = rows.filter(r => r.pedido > 0);
  if (!conPedido.length) { alert("No hay pedidos para generar."); return; }

  const hoy = new Date().toLocaleDateString("es-AR");

  const grupos = {};
  conPedido.forEach(r => {
    const g = r.prov;
    if (!grupos[g]) grupos[g] = { items: [], total: 0, minProv: r.pedMinProv, meses: r._meses };
    grupos[g].items.push(r);
    grupos[g].total += r.pedido;
  });

  let tbody = "";
  let totalGeneral = 0;

  for (const [prov, data] of Object.entries(grupos)) {
    tbody += `<tr style="background:#e8eaed">
      <td colspan="3" style="font-weight:700;padding:6px 8px">${prov} (${data.meses} meses)</td>
      <td style="text-align:right;font-weight:700;padding:6px 8px">${data.total.toLocaleString("es-AR")}</td>
      <td style="text-align:right;font-size:11px;color:#666;padding:6px 8px">mín ${data.minProv.toLocaleString("es-AR")}</td>
    </tr>`;
    data.items.forEach(r => {
      tbody += `<tr>
        <td style="padding:4px 8px;font-weight:700">${r.nFleje}</td>
        <td style="padding:4px 8px;font-size:12px">${r.desc}</td>
        <td style="padding:4px 8px;font-size:12px;color:#555">${r.stockOnline.toLocaleString("es-AR")} → ${r.stockMax.toFixed(1)}</td>
        <td style="text-align:right;font-weight:700;padding:4px 8px">${r.pedido.toLocaleString("es-AR")}</td>
        <td></td>
      </tr>`;
    });
    totalGeneral += data.total;
  }

  const htmlPDF = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Pedido Flejes ${hoy}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#111;max-width:700px;margin:auto}
      h1{font-size:18px;margin:0 0 4px}
      .sub{font-size:13px;color:#555;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      td{border-bottom:1px solid #eee}
      .total{background:#111;color:#fff;font-weight:700;font-size:14px}
      .total td{padding:8px;border:none}
      @media print{body{padding:10px}}
    </style>
  </head><body>
    <h1>PEDIDO FLEJES</h1>
    <div class="sub">Fecha: ${hoy} · ${conPedido.length} flejes</div>
    <table>
      <thead><tr style="border-bottom:2px solid #111">
        <th style="text-align:left;padding:6px 8px">Fleje</th>
        <th style="text-align:left;padding:6px 8px">Descripción</th>
        <th style="text-align:left;padding:6px 8px">Online → Max</th>
        <th style="text-align:right;padding:6px 8px">Pedido</th>
        <th style="text-align:right;padding:6px 8px;width:70px">Mín Prov</th>
      </tr></thead>
      <tbody>${tbody}
        <tr class="total">
          <td colspan="3">TOTAL GENERAL</td>
          <td style="text-align:right">${totalGeneral.toLocaleString("es-AR")}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </body></html>`;

  const win = window.open("", "_blank");
  win.document.write(htmlPDF);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

/* ================= START ================= */
init();
