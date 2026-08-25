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
let spKgData = [];
let partesXPSData = [];
let despieceData = [];
let eMadreLKData = [];
let eMadreCHData = [];
let relevamientosData = []; // relevamiento_cervantes.relevamientos para Flejes
let matricesData = [];
let comprasFlejesMap = new Map(); // N Fleje → total cantidad
let comprasFlejesDetalleMap = new Map(); // N Fleje → [{proveedor, fecha, cantidad, remito}]
let relevStockMap = new Map();         // N Fleje (string) → total_kg del ultimo relev Cervantes
let relevStockMapVirgilio = new Map(); // N Fleje (string) → stock_kg del ultimo relev Virgilio
let lastRelevTs = null;                // creado_en del ultimo relevamiento flejes/Cervantes
let lastRelevTsVirgilio = null;        // creado_en del ultimo relevamiento flejes/Virgilio
let relevRollosCervMap = new Map();    // N Fleje (string) → rollos_json [{caj, kg}] del relev Cervantes

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
    const [resFlejes, resCausa, resSC, resSP, resPS, resDesp, resLK, resCH, resCompras, resRelev, resMatrices] = await Promise.all([
      sb.from("Flejes").select("*"),
      sb.from("Causa-Efecto").select("*"),
      sb.from("SC Kg").select("*"),
      sb.from("SP Kg").select("*"),
      sb.from("Partes x PS").select("*"),
      sb.from("Despiece x Articulo").select("*"),
      sb.from("E. Madre LK").select("*"),
      sb.from("E. Madre CH").select("*"),
      sb.from("Recepcion_Insumos").select("*").eq("rubro","Flejes"),
      sb.from("v_rc_relevamientos").select("id, creado_en, planta").eq("tipo", "flejes"),
      sb.from("Matrices").select("*")
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

    // Determinar el ultimo relevamiento por planta (Cervantes/Virgilio).
    // FILTRO CLAVE: solo se cuentan recepciones y fabricacion POSTERIORES al timestamp
    // del relevamiento de Cervantes. Sin este filtro cualquier recepcion anterior
    // se contaria doble (ya esta sumada en el relevamiento).
    console.log("[relev] resRelev:", resRelev.data, resRelev.error);

    // Ultimo relevamiento por planta
    const latestByPlanta = {};
    for (const r of (resRelev.data || [])) {
      if (!latestByPlanta[r.planta] || new Date(r.creado_en) > new Date(latestByPlanta[r.planta].creado_en)) {
        latestByPlanta[r.planta] = r;
      }
    }
    const lastRelev = latestByPlanta["Cervantes"] || null;
    lastRelevTs = lastRelev ? lastRelev.creado_en : null;
    lastRelevTsVirgilio = latestByPlanta["Virgilio"] ? latestByPlanta["Virgilio"].creado_en : null;
    console.log("[relev] latestByPlanta:", latestByPlanta, "Virgilio:", lastRelevTsVirgilio);

    // Cargar v_rc_detalle para cada planta en paralelo
    relevStockMap.clear();
    relevStockMapVirgilio.clear();
    relevRollosCervMap.clear();
    const PLANTA_MAP = {
      "Cervantes": relevStockMap,
      "Virgilio": relevStockMapVirgilio,
    };
    await Promise.all(Object.entries(latestByPlanta).map(async ([planta, relev]) => {
      const { data: det, error: detErr } = await sb
        .from("v_rc_detalle").select("conteo, info").eq("relevamiento_id", relev.id);
      console.log(`[relev] ${planta} v_rc_detalle rows:`, det?.length, detErr);
      const map = PLANTA_MAP[planta];
      if (!map) return;
      // Cervantes usa total_kg (suma de rollos); Virgilio usa stock_kg (conteo directo)
      const kgField = planta === "Cervantes" ? "total_kg" : "stock_kg";
      (det || []).forEach(row => {
        const nf = String((row.info || {}).n_fleje || "").trim();
        const kg = parseFloat((row.conteo || {})[kgField]);
        if (planta !== "Cervantes") console.log(`[relev] ${planta} row info:`, row.info, `conteo[${kgField}]:`, (row.conteo || {})[kgField], `-> nf="${nf}" kg=${kg}`);
        if (nf && !isNaN(kg)) map.set(nf, kg);
        // Guardar desglose de rollos para Cervantes
        if (planta === "Cervantes" && nf && Array.isArray((row.conteo || {}).rollos_json)) {
          relevRollosCervMap.set(nf, row.conteo.rollos_json);
        }
      });
    }));
    console.log("[relev] Cerv size:", relevStockMap.size, "Virg size:", relevStockMapVirgilio.size);

    // Compras: solo las POSTERIORES al relevamiento (evitar doble contabilidad)
    comprasFlejesMap.clear();
    comprasFlejesDetalleMap.clear();
    (resCompras.data || []).forEach(r => {
      const cod = String(r.codigo || "").trim();
      if (!cod) return;
      // r.fecha es DATE (YYYY-MM-DD); lastRelevTs es timestamptz -> comparar por fecha
      if (lastRelevTs && String(r.fecha) < String(lastRelevTs).slice(0, 10)) return;
      const cant = Number(r.cantidad) || 0;
      comprasFlejesMap.set(cod, (comprasFlejesMap.get(cod) || 0) + cant);
      if (!comprasFlejesDetalleMap.has(cod)) comprasFlejesDetalleMap.set(cod, []);
      comprasFlejesDetalleMap.get(cod).push({
        proveedor: r.proveedor, fecha: r.fecha, cantidad: cant, remito: r.remito,
        rollos_json: Array.isArray(r.rollos_json) ? r.rollos_json : null
      });
    });

    if (resFlejes.error) throw resFlejes.error;
    if (resCausa.error) throw resCausa.error;
    if (resSC.error) throw resSC.error;
    if (resSP.error) throw resSP.error;
    if (resPS.error) throw resPS.error;
    if (resDesp.error) throw resDesp.error;
    if (resLK.error) throw resLK.error;
    if (resCH.error) throw resCH.error;
    if (resMatrices.error) throw resMatrices.error;

    flejesData = resFlejes.data || [];
    causaEfectoData = resCausa.data || [];
    produccionData = allProd; /* paginado completo */
    scKgData = resSC.data || [];
    spKgData = resSP.data || [];
    partesXPSData = resPS.data || [];
    despieceData = resDesp.data || [];
    eMadreLKData = resLK.data || [];
    eMadreCHData = resCH.data || [];
    relevamientosData = resRelev.data || [];
    matricesData = resMatrices.data || [];

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

    // Actualizar headers dinámicamente con la fecha del último relevamiento por planta
    function fmtRelevFecha(ts) {
      if (!ts) return "sin relev";
      const d = new Date(ts);
      return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
    }
    const thVirg = document.getElementById("thVirg");
    if (thVirg) thVirg.innerHTML = `Virg.<br><span style="font-size:10px;font-weight:400">${fmtRelevFecha(lastRelevTsVirgilio)}</span>`;

    const diagVirg = lastRelevTsVirgilio ? `Virg: ${relevStockMapVirgilio.size} flejes` : "Virg: sin relevamiento";
    statusEl.textContent = `${rowsProcessed.length} flejes | ${diagVirg}`;
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
let matrizIdToNombre = {}; // Matriz (numero) → Matriz (nombre texto)

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

  // Matrices: mapear ID numérico a nombre texto (para comparar con Causa-Efecto)
  matrizIdToNombre = {};
  matricesData.forEach(r => {
    const nMatriz = String(r["N_Matriz"] || "").trim();
    const nombre = String(r["Matriz"] || "").trim();
    if (nMatriz && nombre) matrizIdToNombre[nMatriz] = nombre;
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
      const mRaw = String(ce.Matriz || "").trim();
      // Convertir numero de matriz a nombre (igual que produccion) para que matcheen
      const m = matrizIdToNombre[mRaw] || mRaw;
      const a = String(ce.Aumenta || "").trim().toUpperCase();
      if (m && a) {
        if (!matrizAumentaMap.has(m)) matrizAumentaMap.set(m, []);
        matrizAumentaMap.get(m).push(a);
      }
    }
  });

  if (matrizAumentaMap.size === 0) return { total: 0, detalle: [] };

  // Construir mapa sector → kg con desperdicio (SC Kg primero, SP Kg como fallback)
  const kgXUniBySC = new Map();
  scKgData.forEach(r => {
    const sc = String(r["SC"] || "").trim().toUpperCase();
    const kg = n(r["KG Mat PARTE    C/Desp"]);
    if (sc && kg > 0) kgXUniBySC.set(sc, kg);
  });
  // Fallback: sectores en SP Kg que no están en SC Kg
  spKgData.forEach(r => {
    const sp = String(r["Sp"] || "").trim().toUpperCase();
    const kg = n(r["Kg X Uni"]);
    if (sp && kg > 0 && !kgXUniBySC.has(sp)) kgXUniBySC.set(sp, kg);
  });

  // FILTRO CLAVE: solo contar producción POSTERIOR al timestamp exacto del relevamiento
  // (no incluir producción anterior al relevamiento ni la del rollo en alimentador)
  const tsCompara = fechaRelev ? String(fechaRelev) : null;

  // Acumular detalle por (matriz, sectorAumenta)
  const detalleMap = new Map(); // key "matriz|sector" → {matriz, sectorAumenta, uni, kgPorUni, kg}
  let totalKg = 0;
  produccionData.forEach(reg => {
    // Filtrar por timestamp > timestampRelev (DESPUÉS del momento exacto del relev)
    if (tsCompara) {
      const regTs = String(reg.Fecha || ""); // db_n8n_espejo.Fecha es timestamp
      if (!regTs || regTs <= tsCompara) return; // <= porque queremos DESPUÉS (>), no incluir el mismo momento
    }
    // db_n8n_espejo almacena Matriz como numero; convertir a nombre texto
    const matrizNumerico = String(reg.Matriz || "").trim();
    const matrizNombre = matrizIdToNombre[matrizNumerico] || matrizNumerico;
    if (!matrizAumentaMap.has(matrizNombre)) return;
    const uni = n(reg.Uni);
    if (!uni) return;
    const sectores = matrizAumentaMap.get(matrizNombre);
    for (const sectorAumenta of sectores) {
      const kgPorUni = kgXUniBySC.get(sectorAumenta) || 0;
      const kg = uni * kgPorUni;
      totalKg += kg;
      const key = matrizNombre + "|" + sectorAumenta;
      if (!detalleMap.has(key)) {
        detalleMap.set(key, { matriz: matrizNombre, sectorAumenta, uni: 0, kgPorUni, kg: 0 });
      }
      const d = detalleMap.get(key);
      d.uni += uni;
      d.kg += kg;
    }
  });

  // Ordenar detalle por kg desc
  const detalle = [...detalleMap.values()].sort((a, b) => b.kg - a.kg);

  return { total: Math.round(totalKg * 100) / 100, detalle };
}

/* ================= PROCESAR Y ORDENAR ================= */
function procesarRows() {
  rowsProcessed = flejesData.map(f => {
    const nFleje = f["N Fleje"] || "";
    const desc = f["Descripción"] || "";
    const medida = f["Medida mm"] || "";
    const prov = f["Proveedor"] || "";
    // Stock Inicial: del ultimo relevamiento de Cervantes; fallback a Flejes."Stock Inicial"
    const nFlejeStr = String(nFleje).trim();
    const stockInicial = relevStockMap.size > 0
      ? (relevStockMap.has(nFlejeStr) ? relevStockMap.get(nFlejeStr) : n(f["Stock Inicial"]))
      : n(f["Stock Inicial"]);
    const compras = comprasFlejesMap.get(nFlejeStr) || 0;
    const comprasDetalle = comprasFlejesDetalleMap.get(nFlejeStr) || [];
    // Timestamp del ultimo relevamiento de Cervantes (para filtrar fabricacion posterior)
    const timestampRelev = lastRelevTs || f.stock_inicial_updated_at;
    const { total: fabricacion, detalle: fabricacionDetalle } = calcularFabricacion(nFleje, timestampRelev);
    const stockOnline = stockInicial + compras - fabricacion;
    const { total: consumoMes, detalle: consumoDetalle } = calcularConsumoMensual(nFleje);

    // null = sin relevamiento de esa planta; 0 = relevamiento existe pero fleje no contado; número = kg
    const stockVirgilio = lastRelevTsVirgilio !== null ? (relevStockMapVirgilio.get(nFlejeStr) ?? 0) : null;
    return { nFleje, desc, medida, prov, stockOnline, compras, comprasDetalle, fabricacion, fabricacionDetalle, stockInicial, consumoMes, consumoDetalle, stockVirgilio };
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
    if (stockFiltro === "utilizados" && r.fabricacion === 0) return false;

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
          <td></td>
          <td></td>
        </tr>`;
        html += `<tr class="row-sep"><td colspan="9"></td></tr>`;
      }

      // Header del nuevo grupo
      const gId = grupo.replace(/[^a-zA-Z0-9]/g, "_");
      const mVal = getMesesGrupo(grupo);
      html += `<tr class="row-grupo-header">
        <td colspan="2" style="font-size:13px">${esc(r.prov)}</td>
        <td colspan="5"></td>
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
      <td class="col-number">${r.stockVirgilio !== null ? r.stockVirgilio.toLocaleString("es-AR") : "—"}</td>
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
      <td></td>
      <td></td>
    </tr>`;
  }

  tblBody.innerHTML = html || `<tr><td colspan="9" class="empty">No hay flejes cargados</td></tr>`;
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

  const nFlejeStr = String(r.nFleje).trim();
  const rollosCerv = relevRollosCervMap.get(nFlejeStr) || [];

  function fmtFecha(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return ` <span style="font-size:10px;color:#aaa">${d.toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit"})}</span>`;
  }

  // Fila Cervantes + desglose de rollos (relevamiento + compras posteriores)
  let cervHtml = "";
  if (lastRelevTs !== null) {
    // Sumar total: stockInicial (relev) + compras (posteriores)
    const totalCerv = Number(r.stockInicial) + Number(r.compras);
    cervHtml += `<tr style="color:#444"><td>📦 Cervantes${fmtFecha(lastRelevTs)}</td><td style="text-align:right">${fmtN(totalCerv)} kg</td></tr>`;
    // Rollos del relevamiento
    rollosCerv.filter(ro => Number(ro.caj) > 0).forEach(ro => {
      const cant = Number(ro.caj);
      const kgRollo = Number(ro.kg);
      const tot = cant * kgRollo;
      cervHtml += `<tr style="font-size:12px;color:#999"><td style="padding-left:16px">${cant} rollo${cant > 1 ? "s" : ""} × ${fmtN(kgRollo)} kg</td><td style="text-align:right">${fmtN(tot)} kg</td></tr>`;
    });
    // Rollos de compras posteriores al relev (verde para distinguir)
    (r.comprasDetalle || []).forEach(c => {
      if (Array.isArray(c.rollos_json) && c.rollos_json.length) {
        c.rollos_json.filter(ro => Number(ro.count || ro.caj || 0) > 0).forEach(ro => {
          const cant = Number(ro.count || ro.caj);
          const kgRollo = Number(ro.kg);
          const tot = cant * kgRollo;
          cervHtml += `<tr style="font-size:12px;color:#0a7a2f"><td style="padding-left:16px">+ ${cant} rollo${cant > 1 ? "s" : ""} × ${fmtN(kgRollo)} kg <span style="color:#aaa">(${esc(c.proveedor || "")})</span></td><td style="text-align:right">${fmtN(tot)} kg</td></tr>`;
        });
      } else if (Number(c.cantidad) > 0) {
        // Compra sin desglose de rollos (formato viejo): mostrar como una linea
        cervHtml += `<tr style="font-size:12px;color:#0a7a2f"><td style="padding-left:16px">+ Compra <span style="color:#aaa">(${esc(c.proveedor || "")})</span></td><td style="text-align:right">${fmtN(c.cantidad)} kg</td></tr>`;
      }
    });
  }

  // Filas de otras plantas
  const otrasHtml = [
    { label: "📦 Virgilio",  val: r.stockVirgilio, ts: lastRelevTsVirgilio },
  ]
    .filter(p => p.val !== null)
    .map(p => `<tr style="color:#444"><td>${p.label}${fmtFecha(p.ts)}</td><td style="text-align:right">${fmtN(p.val)} kg</td></tr>`)
    .join("");

  const plantasHtml = cervHtml + otrasHtml;
  const sepPlanta = plantasHtml
    ? `<tr><td colspan="2" style="padding:3px 0"><hr style="border:none;border-top:1px solid #ddd;margin:0"></td></tr>`
    : "";

  abrirPopup(`Stock Online — Fleje ${r.nFleje}`,
    `<table style="width:100%">
      ${plantasHtml}${sepPlanta}
      <tr><td>Stock Inicial (Cerv.)</td><td style="text-align:right">${fmtN(r.stockInicial)}</td></tr>
      <tr class="col-clickable" style="cursor:pointer" onclick="popupCompras(${i})"><td>+ Compras</td><td style="text-align:right">${fmtN(r.compras)}</td></tr>
      <tr class="col-clickable" style="cursor:pointer" onclick="popupFabricacion(${i})"><td>− Fabricación</td><td style="text-align:right">${fmtN(r.fabricacion)}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Stock Online</b></td><td style="text-align:right"><b>${fmtN(r.stockOnline)}</b></td></tr>
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

function popupCompras(i) {
  const r = window._rowsPedido[i];
  if (!r) return;

  function fmtFechaComp(f) {
    if (!f) return "";
    // f puede venir 'YYYY-MM-DD' (DATE) — mostrar 'DD/MM/YY'
    const s = String(f).slice(0, 10);
    const [y, m, d] = s.split("-");
    return d && m && y ? `${d}/${m}/${y.slice(2)}` : s;
  }

  const relevLabel = lastRelevTs ? `posteriores al relev del ${fmtFechaComp(lastRelevTs)}` : "";

  let filas = "";
  if (r.comprasDetalle && r.comprasDetalle.length) {
    r.comprasDetalle
      .slice()
      .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
      .forEach(c => {
        filas += `<tr style="font-size:12px;color:#444">
          <td style="padding:2px 6px">${fmtFechaComp(c.fecha)}</td>
          <td style="padding:2px 6px">${esc(c.proveedor || "—")}</td>
          <td style="padding:2px 6px">${esc(c.remito || "—")}</td>
          <td style="padding:2px 6px;text-align:right">${fmtN(c.cantidad)} kg</td>
        </tr>`;
      });
  } else {
    filas = `<tr><td colspan="4" style="color:#999;padding:8px">Sin compras registradas</td></tr>`;
  }

  abrirPopup(`Compras — Fleje ${r.nFleje}`,
    `<div style="font-size:12px;color:#888;margin-bottom:8px">Recepciones ${relevLabel}</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:11px;color:#888;border-bottom:1px solid #ddd">
        <th style="text-align:left;padding:4px 6px">Fecha</th>
        <th style="text-align:left;padding:4px 6px">Proveedor</th>
        <th style="text-align:left;padding:4px 6px">Remito</th>
        <th style="text-align:right;padding:4px 6px">Kg</th>
      </tr></thead>
      <tbody>${filas}</tbody>
      <tfoot><tr style="border-top:2px solid #333;font-weight:700">
        <td colspan="3" style="padding:4px 6px">Total</td>
        <td style="text-align:right;padding:4px 6px">${fmtN(r.compras)} kg</td>
      </tr></tfoot>
    </table>`
  );
}

function popupFabricacion(i) {
  const r = window._rowsPedido[i];
  if (!r) return;

  function fmtFechaRelev(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  let detalleHtml = "";
  if (r.fabricacionDetalle && r.fabricacionDetalle.length) {
    r.fabricacionDetalle.forEach(d => {
      detalleHtml += `<tr style="font-size:12px;color:#444">
        <td style="padding:2px 6px">${esc(d.matriz)}</td>
        <td style="padding:2px 6px">${esc(d.sectorAumenta)}</td>
        <td style="padding:2px 6px;text-align:right">${fmtN(d.uni)}</td>
        <td style="padding:2px 6px;text-align:right">${d.kgPorUni.toFixed(4)}</td>
        <td style="padding:2px 6px;text-align:right">${fmtN(Math.round(d.kg * 100) / 100)}</td>
      </tr>`;
    });
  } else {
    detalleHtml = `<tr><td colspan="5" style="color:#999;padding:8px">Sin producción registrada</td></tr>`;
  }

  const relevLabel = lastRelevTs ? `después del ${fmtFechaRelev(lastRelevTs)}` : "";

  abrirPopup(`Fabricación — Fleje ${r.nFleje}`,
    `<div style="font-size:12px;color:#888;margin-bottom:8px">Producción ${relevLabel}</div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="font-size:11px;color:#888;border-bottom:1px solid #ddd">
        <th style="text-align:left;padding:4px 6px">Matriz</th>
        <th style="text-align:left;padding:4px 6px">Sector</th>
        <th style="text-align:right;padding:4px 6px">Uni</th>
        <th style="text-align:right;padding:4px 6px">Kg/Uni</th>
        <th style="text-align:right;padding:4px 6px">Kg</th>
      </tr></thead>
      <tbody>${detalleHtml}</tbody>
      <tfoot><tr style="border-top:2px solid #333;font-weight:700">
        <td colspan="4" style="padding:4px 6px">Total</td>
        <td style="text-align:right;padding:4px 6px">${fmtN(r.fabricacion)}</td>
      </tr></tfoot>
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
