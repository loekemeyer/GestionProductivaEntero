"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusEl = document.getElementById("status");
const tblBody = document.getElementById("tblBody");
const txtBuscar = document.getElementById("txtBuscar");
const selMarca = document.getElementById("selMarca");
const selTipo = document.getElementById("selTipo");
const selStock = document.getElementById("selStock");
const selTallerista = document.getElementById("selTallerista");

let cartonesData = [];
let rowsProcessed = [];
let lkSet = new Set();
let chSet = new Set();
let eMadreMap = new Map(); // COD -> valor E. Madre
let enviosMap = new Map(); // COD -> total unidades enviadas
let enviosDetalleMap = new Map(); // descripcion -> [{tallerista, diaMes, unidades}]
let entregasLogMap = new Map(); // COD -> total cajas entregadas por Log/Fabrica
let sectorCartonMap = new Map(); // COD (sin ceros) -> Sector
let talleristasSet = new Set(); // talleristas únicos con envíos
let comprasCartonesMap = new Map(); // COD (normalizado) -> total cantidad de Recepcion_Insumos
let comprasCartonesDetalleMap = new Map(); // COD -> [{proveedor, fecha, cantidad, remito}]

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function n(v) { return isNaN(v) ? 0 : Number(v); }

function normCod(v) { return String(v ?? "").trim().toUpperCase(); }

function normalizeText(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/* Stock Inicial del conteo físico (29/3/2026) se carga al inicio desde tabla Stock_Inicial_Cartones.
   Antes era CONTEO_STOCK hardcoded ~155 codes; ahora vive en BD. Fallback {} si la BD falla. */
let CONTEO_STOCK = {};

async function cargarConteoStock(){
  try {
    const { data, error } = await sb.from("Stock_Inicial_Cartones").select("cod, stock_inicial");
    if (error) { console.warn("[Cartones] No se pudo cargar Stock_Inicial_Cartones:", error.message); return; }
    const m = {};
    (data || []).forEach(r => { m[String(r.cod).trim()] = Number(r.stock_inicial) || 0; });
    CONTEO_STOCK = m;
  } catch (e) { console.warn("[Cartones] cargarConteoStock fallo:", e); }
}

/* Pedido mínimo por tipo (total del pliego) */
const PEDIDO_MIN_TIPO = {
  "Abl": 12000, "Pel": 12000, "Sac": 12000, "Ute": 12000,
  "Huv": 25000, "Co8": 30000, "Ban": 12000, "Lok": 12000
};
const PEDIDO_MIN_COD = 1000;

/* Tipo de cartón para códigos Lok */
const LOK_TIPO = {
  "101": "Lok", "102": "Lok", "103": "Lok", "104": "Lok",
  "109": "Lok", "114": "Lok", "117": "Lok",
  "107": "Huv", "108": "Huv", "110": "Huv",
  "111": "Huv", "112": "Huv", "113": "Huv",
  "115": "Huv", "116": "Huv", "119": "Huv",
  "121": "Huv", "123": "Huv", "186": "Huv",
  "193": "Lok"
};

/* Tipo de cartón para códigos LK */
const LK_TIPO = {
  // Abl - Abrelatas
  "502": "Abl", "512": "Abl", "66": "Abl", "501": "Abl", "511": "Abl",
  // Pel - Peladores
  "513": "Pel", "505": "Pel", "586": "Pel", "587": "Pel",
  // Sac - Sacacorchos
  "525": "Sac", "531": "Sac", "521": "Sac", "523": "Sac",
  "581": "Sac", "530": "Sac", "520": "Sac",
  // Ute - Utensilios varios
  "504": "Ute", "58": "Ute", "547": "Ute",
  "532": "Ute", "551": "Ute", "519": "Ute", "395": "Ute",
  "57": "Ute", "550": "Ute", "499": "Ute", "229": "Ute",
  "569": "Ute", "560": "Ute", "596": "Ute", "595": "Ute",
  "594": "Ute", "565": "Ute", "507": "Ute", "518": "Ute",
  "208": "Ute", "564": "Ute", "498": "Ute", "517": "Ute",
  "561": "Ute", "299": "Ute", "207": "Ute", "508": "Ute",
  // Huv - Huevo
  "543": "Huv", "542": "Huv", "534": "Huv",
  "555": "Huv", "535": "Huv", "29": "Huv",
  "30": "Huv", "562": "Huv", "559": "Huv",
  "334": "Huv", "336": "Huv", "332": "Huv",
  "338": "Huv", "325": "Huv", "333": "Huv",
  "389": "Huv", "570": "Huv", "312": "Huv",
  "548": "Huv", "337": "Huv", "315": "Huv",
  "311": "Huv", "546": "Huv", "355": "Huv", "515": "Huv",
  // Huv - Tapón
  "577": "Huv", "579": "Huv", "575": "Huv",
  // Ban - Bandita
  "234": "Ban", "34": "Ban", "323": "Ban",
  // Co8 - Corbata 8
  "544": "Co8", "580": "Co8", "27": "Co8", "26": "Co8",
  "223": "Co8", "224": "Co8", "225": "Co8", "220": "Co8",
  "221": "Co8", "248": "Co8", "390": "Co8", "391": "Co8",
  "392": "Co8", "393": "Co8", "394": "Co8", "222": "Co8"
};

/* ================= CARGAR SECTOR CARTON ================= */
async function cargarSectorCarton() {
  try {
    const res = await sb.from("Sector Carton").select("Cod, Sector");
    sectorCartonMap.clear();
    (res.data || []).forEach(r => {
      const cod = String(r["Cod"] || "").trim().replace(/^0+/, "") || "0";
      if (cod && r["Sector"]) sectorCartonMap.set(cod, String(r["Sector"]).trim());
    });
  } catch (err) {
    console.error("Error cargando Sector Carton:", err);
  }
}

/* ================= CARGAR MARCAS ================= */
async function cargarMarcas() {
  try {
    const [resLK, resCH] = await Promise.all([
      sb.from("E. Madre LK").select("*"),
      sb.from("E. Madre CH").select("*")
    ]);

    lkSet.clear();
    chSet.clear();
    eMadreMap.clear();

    (resLK.data || []).forEach(r => {
      const cod = normCod(r["Cod"]);
      if (cod) {
        lkSet.add(cod);
        eMadreMap.set(cod, Number(r["E. Madre"]) || 0);
      }
    });

    (resCH.data || []).forEach(r => {
      const cod = normCod(r["Cod"]);
      if (cod) {
        chSet.add(cod);
        if (!eMadreMap.has(cod)) {
          eMadreMap.set(cod, Number(r["E. Madre"]) || 0);
        }
      }
    });
  } catch (err) {
    console.error("Error cargando marcas:", err);
  }
}

/* ================= CARGAR ENVIOS ================= */
async function cargarEnvios() {
  try {
    const res = await sb.from("Envios a Talleristas").select("Descripcion, Unidades, Tallerista, \"Dia-mes\"");

    enviosMap.clear();
    enviosDetalleMap.clear();
    talleristasSet.clear();

    (res.data || []).forEach(r => {
      const cod = String(r["Descripcion"] || "").trim();
      const uni = Number(r["Unidades"] || 0);
      const tallerista = String(r["Tallerista"] || "").trim();

      if (cod && uni > 0) {
        const actual = enviosMap.get(cod) || 0;
        enviosMap.set(cod, actual + uni);

        const detalles = enviosDetalleMap.get(cod) || [];
        detalles.push({ tallerista, diaMes: r["Dia-mes"] || "", unidades: uni });
        enviosDetalleMap.set(cod, detalles);

        if (tallerista) talleristasSet.add(tallerista);
      }
    });

    // Poblar select de talleristas
    const talleristas = Array.from(talleristasSet).sort();
    talleristas.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      selTallerista.appendChild(opt);
    });
  } catch (err) {
    console.error("Error cargando envíos:", err);
  }
}

/* ================= CARGAR ENTREGAS LOG/FABRICA ================= */
// Compras reales: Recepcion_Insumos rubro=Cartones, key=COD
async function cargarComprasCartones() {
  comprasCartonesMap.clear();
  comprasCartonesDetalleMap.clear();
  const { data, error } = await sb.from("Recepcion_Insumos").select("*").eq("rubro", "Cartones");
  if (error) { console.error("Error compras Cartones:", error); return; }
  (data || []).forEach(r => {
    const cod = String(r.codigo || "").trim().toUpperCase();
    if (!cod) return;
    const cant = Number(r.cantidad) || 0;
    comprasCartonesMap.set(cod, (comprasCartonesMap.get(cod) || 0) + cant);
    if (!comprasCartonesDetalleMap.has(cod)) comprasCartonesDetalleMap.set(cod, []);
    comprasCartonesDetalleMap.get(cod).push({
      proveedor: r.proveedor, fecha: r.fecha, cantidad: cant, remito: r.remito
    });
  });
}

async function cargarEntregasLogFabrica() {
  try {
    const res = await sb.from("Entregas Tallerista Virgilio").select("*");

    entregasLogMap.clear();

    (res.data || []).forEach(r => {
      // Filtrar solo entregas de Log/Fabrica (Cod_Tall = "0001" o Nombre_Tall contiene Log)
      const codTall = String(r["Cod_Tall"] || "").trim();
      const nombre = String(r["Nombre_Tall"] || "").trim().toLowerCase();
      if (codTall !== "0001" && !nombre.includes("log")) return;

      const cod = String(r["Cod"] || "").trim();
      const cajas = Number(r["Cajas"] || 0);

      if (cod && cajas > 0) {
        const actual = entregasLogMap.get(cod) || 0;
        entregasLogMap.set(cod, actual + cajas);
      }
    });
  } catch (err) {
    console.error("Error cargando entregas Log/Fabrica:", err);
  }
}

/* ================= INIT ================= */
async function init() {
  statusEl.textContent = "Cargando cartones...";

  try {
    // Cargar marcas, envíos, sectores y pliegos en paralelo
    const resCartones = await Promise.all([
      cargarMarcas(),
      cargarEnvios(),
      cargarEntregasLogFabrica(),
      cargarPliegos(),
      cargarSectorCarton(),
      cargarComprasCartones(),
      cargarConteoStock(),
      sb.from("Despiece x Articulo").select("*").eq("Rubro", "Cartones")
    ]);

    const res = resCartones[7];
    if (res.error) throw res.error;
    cartonesData = res.data || [];

    procesarRows();
    aplicarFiltros();
    statusEl.textContent = `${rowsProcessed.length} cartones cargados`;

    procesarPliegos();
    renderPliegos();
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    console.error("Init error:", err);
  }
}

/* ================= PROCESAR Y ORDENAR ================= */
function procesarRows() {
  // Deduplicar por COD y excluir filas marcadas con excluir_listado=TRUE en BD.
  // Antes: EXCLUIR_CODS hardcoded ["516","67","574"]. Ahora: flag por fila en Despiece.
  const seen = new Set();
  const unicos = cartonesData.filter(c => {
    const k = normCod(c["COD"]);
    if (seen.has(k) || c.excluir_listado === true) return false;
    seen.add(k);
    return true;
  });

  rowsProcessed = unicos.map(c => {
    const cod = c["COD"] || "";
    const codNormPre = normCod(cod);
    const codNumPre = parseInt(codNormPre, 10);
    // Quitar ceros a la izquierda para matchear mapeos (066 → 66, 026 → 26)
    const codLimpio = codNormPre.replace(/^0+/, "") || "0";
    // Tipo: Lok → LOK_TIPO, LK → LK_TIPO, resto → campo de la base
    const tipo = (codNumPre >= 100 && codNumPre <= 199)
      ? (LOK_TIPO[codLimpio] || c["Tipo"] || "")
      : (LK_TIPO[codLimpio] || c["Tipo"] || "");
    const partesXuni = n(c["Partes x uni"]) || 0;
    const codNormTemp = normCod(c["COD"]);
    const eMadre = eMadreMap.get(codNormTemp) || 0;
    const consumoParte = partesXuni * eMadre;
    // Stock Inicial: usar conteo físico si existe, sino campo de la base
    const stockInicial = (codLimpio in CONTEO_STOCK) ? CONTEO_STOCK[codLimpio] : (n(c["Stock Inicial"]) || 0);
    const compras = comprasCartonesMap.get(codNormPre) || comprasCartonesMap.get(codLimpio.toUpperCase()) || 0;
    const comprasDetalle = comprasCartonesDetalleMap.get(codNormPre) || comprasCartonesDetalleMap.get(codLimpio.toUpperCase()) || [];
    const descParte = String(c["Descripcion de partes"] || "").trim();
    const sector = sectorCartonMap.get(codLimpio) || sectorCartonMap.get(codNormPre) || "";
    const enviosTall = enviosMap.get(descParte) || 0;
    // Entregas Log/Fabrica: matchear por código (con y sin ceros)
    const entregasLog = entregasLogMap.get(codNormPre) || entregasLogMap.get(codLimpio) || 0;
    const stockOnline = stockInicial + compras - enviosTall - entregasLog;

    const codNorm = normCod(cod);
    const codNum = parseInt(codNorm, 10);
    let marca = "";
    if (codNum >= 100 && codNum <= 199) {
      marca = "Lok";
    } else if (lkSet.has(codNorm) && chSet.has(codNorm)) {
      marca = "LK+CH";
    } else if (lkSet.has(codNorm)) {
      marca = "LK";
    } else if (chSet.has(codNorm)) {
      marca = "CH";
    }

    // Talleristas que recibieron este cartón
    const detallesEnvio = enviosDetalleMap.get(descParte) || [];
    const talleristas = [...new Set(detallesEnvio.map(d => d.tallerista).filter(t => t))];

    return { cod, tipo, marca, sector, consumoParte, stockOnline, compras, enviosTall, entregasLog, stockInicial, descParte, talleristas };
  });

  // Ordenar: 1° Marca (LK, Lok, CH), 2° Tipo, 3° Código
  const ordenMarca = { "LK": 0, "Lok": 1, "LK+CH": 2, "CH": 3, "": 4 };
  const ordenTipo = { "Abl": 0, "Pel": 1, "Sac": 2, "Ute": 3, "Huv": 4, "Co8": 5, "Ban": 6, "Lok": 7 };
  rowsProcessed.sort((a, b) => {
    const ma = ordenMarca[a.marca] ?? 4;
    const mb = ordenMarca[b.marca] ?? 4;
    if (ma !== mb) return ma - mb;
    const ta = ordenTipo[a.tipo] ?? 99;
    const tb = ordenTipo[b.tipo] ?? 99;
    if (ta !== tb) return ta - tb;
    return String(a.cod).localeCompare(String(b.cod), "es", { numeric: true });
  });
}

/* ================= FILTROS ================= */
function aplicarFiltros() {
  const q = normalizeText(txtBuscar.value);
  const marcaFiltro = selMarca.value;
  const tipoFiltro = selTipo.value;
  const stockFiltro = selStock.value;
  const talleristFiltro = selTallerista.value;

  const filtradas = rowsProcessed.filter(r => {
    // Búsqueda texto
    if (q) {
      const matchTexto =
        normalizeText(r.cod).includes(q) ||
        normalizeText(r.tipo).includes(q) ||
        normalizeText(r.marca).includes(q);
      if (!matchTexto) return false;
    }

    // Filtro marca
    if (marcaFiltro !== "todos") {
      if (marcaFiltro === "Lok" && r.marca !== "Lok") return false;
      if (marcaFiltro === "LK" && r.marca !== "LK" && r.marca !== "LK+CH") return false;
      if (marcaFiltro === "CH" && r.marca !== "CH" && r.marca !== "LK+CH") return false;
    }

    // Filtro tipo
    if (tipoFiltro !== "todos" && r.tipo !== tipoFiltro) return false;

    // Filtro stock
    if (stockFiltro === "conStock" && r.stockOnline === 0) return false;
    if (stockFiltro === "sinStock" && r.stockOnline !== 0) return false;

    // Filtro tallerista
    if (talleristFiltro !== "todos" && !r.talleristas.includes(talleristFiltro)) return false;

    return true;
  });

  renderTabla(filtradas);
}

txtBuscar.addEventListener("input", aplicarFiltros);
selMarca.addEventListener("change", aplicarFiltros);
selTipo.addEventListener("change", aplicarFiltros);
selStock.addEventListener("change", aplicarFiltros);
selTallerista.addEventListener("change", aplicarFiltros);

/* ================= MESES POR GRUPO ================= */
const mesesPorGrupo = {}; // "LK|Abl" -> 5

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

  // Detectar grupos únicos y su orden
  const gruposOrden = [];
  const grupoSet = new Set();
  rows.forEach(r => {
    const g = r.marca + "|" + r.tipo;
    if (!grupoSet.has(g)) { grupoSet.add(g); gruposOrden.push(g); }
  });

  // Calcular pedido por código usando meses del grupo
  const rowsConPedido = rows.map(r => {
    const g = r.marca + "|" + r.tipo;
    const mult = getMesesGrupo(g);
    const stockMax = r.consumoParte * mult;
    const need = stockMax - r.stockOnline;
    let pedido = 0;
    if (need > 0) {
      pedido = Math.max(Math.ceil(need / PEDIDO_MIN_COD) * PEDIDO_MIN_COD, PEDIDO_MIN_COD);
    }
    const pedMinTipo = PEDIDO_MIN_TIPO[r.tipo] || 0;
    return { ...r, stockMax, pedido, pedMinTipo, _grupo: g, _meses: mult };
  });

  // Guardar datos para popups y PDF
  window._rowsPedido = rowsConPedido;

  // Agrupar subtotales
  const subtotales = {};
  rowsConPedido.forEach(r => {
    if (!subtotales[r._grupo]) subtotales[r._grupo] = { marca: r.marca, tipo: r.tipo, pedido: 0, count: 0 };
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
        const minTipo = PEDIDO_MIN_TIPO[st.tipo] || 0;
        html += `<tr class="row-subtotal">
          <td colspan="4"></td>
          <td class="col-number">${st.pedido.toLocaleString("es-AR")}</td>
          <td></td>
          <td class="col-number" style="font-weight:400;font-size:11px;color:#666">mín ${minTipo.toLocaleString("es-AR")}</td>
        </tr>`;
        html += `<tr class="row-sep"><td colspan="7"></td></tr>`;
      }

      // Header del nuevo grupo con input de meses
      const gId = grupo.replace(/[^a-zA-Z0-9]/g, "_");
      const mVal = getMesesGrupo(grupo);
      html += `<tr class="row-grupo-header">
        <td>${esc(r.marca)}</td>
        <td>${esc(r.tipo)}</td>
        <td colspan="3"></td>
        <td style="text-align:right;font-size:11px">Meses</td>
        <td><input id="meses_${gId}" type="number" value="${mVal}" min="1" max="24"
          onchange="setMesesGrupo('${esc(grupo)}')" /></td>
      </tr>`;
      prevGrupo = grupo;
    }

    const pedidoClass = r.pedido > 0 ? "col-number col-pedido col-clickable" : "col-number col-clickable";
    html += `<tr>
      <td class="col-marca">${esc(r.marca)}</td>
      <td class="col-tipo">${esc(r.tipo)}</td>
      <td class="col-nfleje">${esc(r.cod)}</td>
      <td class="col-nfleje" style="color:#888">${esc(r.sector)}</td>
      <td class="${pedidoClass}" onclick="popupPedido(${i})">${r.pedido.toLocaleString("es-AR")}</td>
      <td class="col-number col-clickable" onclick="popupStockMax(${i})">${r.stockMax.toLocaleString("es-AR")}</td>
      <td class="col-number col-clickable" onclick="popupStockOnline(${i})">${r.stockOnline.toLocaleString("es-AR")}</td>
    </tr>`;
  });

  // Subtotal del último grupo
  if (prevGrupo && subtotales[prevGrupo]) {
    const st = subtotales[prevGrupo];
    const minTipo = PEDIDO_MIN_TIPO[st.tipo] || 0;
    html += `<tr class="row-subtotal">
      <td colspan="4"></td>
      <td class="col-number">${st.pedido.toLocaleString("es-AR")}</td>
      <td></td>
      <td class="col-number" style="font-weight:400;font-size:11px;color:#666">mín ${minTipo.toLocaleString("es-AR")}</td>
    </tr>`;
  }

  tblBody.innerHTML = html || `<tr><td colspan="7" class="empty">No hay cartones cargados</td></tr>`;
}

/* ================= GENERAR PDF ================= */
document.getElementById("btnGenerarPDF").addEventListener("click", generarPDF);

function generarPDF() {
  const rows = window._rowsPedido || [];
  const conPedido = rows.filter(r => r.pedido > 0);
  if (!conPedido.length) { alert("No hay pedidos para generar."); return; }

  const hoy = new Date().toLocaleDateString("es-AR");

  // Agrupar por marca+tipo
  const grupos = {};
  conPedido.forEach(r => {
    const g = r.marca + " — " + r.tipo;
    if (!grupos[g]) grupos[g] = { items: [], total: 0, minTipo: r.pedMinTipo, meses: r._meses };
    grupos[g].items.push(r);
    grupos[g].total += r.pedido;
  });

  let totalGeneral = 0;

  let tbody = "";
  for (const [grupo, data] of Object.entries(grupos)) {
    tbody += `<tr style="background:#e8eaed">
      <td colspan="3" style="font-weight:700;padding:6px 8px">${grupo} (${data.meses} meses)</td>
      <td style="text-align:right;font-weight:700;padding:6px 8px">${data.total.toLocaleString("es-AR")}</td>
      <td style="text-align:right;font-size:11px;color:#666;padding:6px 8px">mín ${data.minTipo.toLocaleString("es-AR")}</td>
    </tr>`;
    data.items.forEach(r => {
      tbody += `<tr>
        <td style="padding:4px 8px">${r.cod}</td>
        <td style="padding:4px 8px;font-size:12px;color:#555" colspan="2">${r.stockOnline.toLocaleString("es-AR")} online → ${r.stockMax.toLocaleString("es-AR")} max</td>
        <td style="text-align:right;font-weight:700;padding:4px 8px">${r.pedido.toLocaleString("es-AR")}</td>
        <td></td>
      </tr>`;
    });
    totalGeneral += data.total;
  }

  const htmlPDF = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Pedido Cartones ${hoy}</title>
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
    <h1>PEDIDO CARTONES</h1>
    <div class="sub">Fecha: ${hoy} · ${conPedido.length} códigos</div>
    <table>
      <thead><tr style="border-bottom:2px solid #111">
        <th style="text-align:left;padding:6px 8px">Código</th>
        <th style="text-align:left;padding:6px 8px" colspan="2">Detalle</th>
        <th style="text-align:right;padding:6px 8px">Pedido</th>
        <th style="text-align:right;padding:6px 8px;width:80px">Mín Tipo</th>
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

/* ================= POPUPS DETALLE ================= */
const popupEl = document.getElementById("popupDetalle");
const popupTitulo = document.getElementById("popupTitulo");
const popupBody = document.getElementById("popupBody");
function cerrarPopupPrincipal() {
  popupEl.classList.add("hidden");
  document.getElementById("popupEnviosDetalle").classList.add("hidden");
}
document.getElementById("popupCerrar").onclick = cerrarPopupPrincipal;
popupEl.addEventListener("click", e => { if (e.target === popupEl) cerrarPopupPrincipal(); });

function abrirPopup(titulo, html) {
  popupTitulo.textContent = titulo;
  popupBody.innerHTML = html;
  popupEl.classList.remove("hidden");
}

function fmtN(v) { return Number(v).toLocaleString("es-AR"); }

function popupStockOnline(i) {
  const r = window._rowsPedido[i];
  if (!r) return;

  // Cerrar mini-popup si estaba abierto
  document.getElementById("popupEnviosDetalle").classList.add("hidden");

  const detalles = enviosDetalleMap.get(r.descParte) || [];
  const flechaBtn = (detalles.length > 0)
    ? `<button class="btn-detalle-envios" onclick="mostrarDetalleEnvios(event,${i})" title="Ver detalle por tallerista">▶</button>`
    : "";

  abrirPopup(`Stock Online — Cod ${r.cod}`,
    `<table>
      <tr><td>Stock Inicial</td><td>${fmtN(r.stockInicial)}</td></tr>
      <tr><td>+ Compras</td><td>${fmtN(r.compras)}</td></tr>
      <tr><td>− Envios Tall</td><td>${fmtN(r.enviosTall)} ${flechaBtn}</td></tr>
      <tr><td>− Ent Log/Fab</td><td>${fmtN(r.entregasLog)}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Stock Online</b></td><td><b>${fmtN(r.stockOnline)}</b></td></tr>
    </table>`
  );
}

function mostrarDetalleEnvios(event, i) {
  event.stopPropagation();
  const r = window._rowsPedido[i];
  if (!r) return;

  const detalles = enviosDetalleMap.get(r.descParte) || [];
  if (!detalles.length) return;

  const el = document.getElementById("popupEnviosDetalle");
  const tbody = document.getElementById("popupEnviosDetalleBody");

  tbody.innerHTML = detalles.map(d =>
    `<tr><td>${esc(d.tallerista)} — ${esc(d.diaMes)}</td><td>${fmtN(d.unidades)}</td></tr>`
  ).join("");

  // Mostrar para poder medir altura
  el.classList.remove("hidden");

  // Posicionar a la derecha del popup principal
  requestAnimationFrame(() => {
    const contentEl = document.querySelector(".popup-detalle-content");
    const rect = contentEl.getBoundingClientRect();
    const elH = el.offsetHeight;
    const elW = el.offsetWidth;

    let top = rect.top + rect.height / 2 - elH / 2;
    let left = rect.right + 12;

    // Si no entra a la derecha, ir a la izquierda
    if (left + elW > window.innerWidth - 8) left = rect.left - elW - 12;
    // Clamp vertical
    top = Math.max(8, Math.min(top, window.innerHeight - elH - 8));

    el.style.top = top + "px";
    el.style.left = left + "px";
  });
}

function popupStockMax(i) {
  const r = window._rowsPedido[i];
  if (!r) return;
  const mult = r._meses || 5;
  abrirPopup(`Stock Max — Cod ${r.cod}`,
    `<table>
      <tr><td>Consumo x Parte</td><td>${fmtN(r.consumoParte)}</td></tr>
      <tr><td>× Meses</td><td>${mult}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Stock Max</b></td><td><b>${fmtN(r.stockMax)}</b></td></tr>
    </table>`
  );
}

function popupPedido(i) {
  const r = window._rowsPedido[i];
  if (!r) return;
  abrirPopup(`Pedido — Cod ${r.cod}`,
    `<table>
      <tr><td>Stock Max</td><td>${fmtN(r.stockMax)}</td></tr>
      <tr><td>− Stock Online</td><td>${fmtN(r.stockOnline)}</td></tr>
      <tr><td>= Necesidad</td><td>${fmtN(r.stockMax - r.stockOnline)}</td></tr>
      <tr><td>Ped Min Cod</td><td>${fmtN(PEDIDO_MIN_COD)}</td></tr>
      <tr><td>Ped Min Tipo</td><td>${fmtN(r.pedMinTipo)}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Pedido</b></td><td><b>${fmtN(r.pedido)}</b></td></tr>
    </table>`
  );
}

/* ================= PLIEGOS AJ ADHESIVOS ================= */
let pliegosData = [];
let pliegosRows = [];
let enviosPSPliegosMap = new Map();  // SC → { kg, detalle[] }
let entregasPSPliegosMap = new Map(); // SP → { kg, detalle[] }

async function cargarPliegos() {
  const [partesPSRes, enviosRes, entregasRes] = await Promise.all([
    sb.from("Partes x PS")
      .select("Parte, SC, SP, \"KG x Uni\", \"KG x Cajon\", \"Stock Inicial\"")
      .eq("PS", "AJ Adhesivos")
      .order("Parte", { ascending: true }),
    sb.from("Envios a PS")
      .select("\"Sector SC\", Cajones, \"Dia-mes\"")
      .eq("Prov_Serv", "AJ Adhesivos"),
    sb.from("Entregas PS")
      .select("\"Sector SP\", Cajones, \"Dia-mes\"")
      .eq("Prov_Serv", "AJ Adhesivos")
  ]);

  if (partesPSRes.error) throw partesPSRes.error;

  enviosPSPliegosMap.clear();
  for (const e of (enviosRes.data || [])) {
    const sc = String(e["Sector SC"] || "").trim();
    if (!sc) continue;
    if (!enviosPSPliegosMap.has(sc)) enviosPSPliegosMap.set(sc, { uni: 0, detalle: [] });
    const m = enviosPSPliegosMap.get(sc);
    m.uni += n(e["Cajones"]);
    m.detalle.push({ fecha: e["Dia-mes"] || "", uni: n(e["Cajones"]) });
  }

  entregasPSPliegosMap.clear();
  for (const e of (entregasRes.data || [])) {
    const sp = String(e["Sector SP"] || "").trim();
    if (!sp) continue;
    if (!entregasPSPliegosMap.has(sp)) entregasPSPliegosMap.set(sp, { uni: 0, detalle: [] });
    const m = entregasPSPliegosMap.get(sp);
    m.uni += n(e["Cajones"]);
    m.detalle.push({ fecha: e["Dia-mes"] || "", uni: n(e["Cajones"]) });
  }

  pliegosData = partesPSRes.data || [];
}

function extraerCodigo(parte) {
  const m = parte.match(/\b(\d{3,})\b/);
  return m ? m[1] : "—";
}

function procesarPliegos() {
  pliegosRows = pliegosData.map(p => {
    const parte = String(p["Parte"] || "").trim();
    const sc = String(p["SC"] || "").trim();
    const sp = String(p["SP"] || "").trim();
    const kgxUni = n(p["KG x Uni"]);
    const stockIniSP = n(p["Stock Inicial"]);
    const codigo = extraerCodigo(parte);

    // SC: sin adhesivar — lo que mandaste a AJ Adhesivos (en unidades)
    const envPS = enviosPSPliegosMap.get(sc) || { uni: 0, detalle: [] };
    const scStock = 0 - envPS.uni; // Stock ini SC = 0

    // SP: adhesivado — lo que recibiste de AJ Adhesivos + stock inicial (en unidades)
    const entPS = entregasPSPliegosMap.get(sp) || { uni: 0, detalle: [] };
    const envTall = enviosMap.get(parte) || 0;
    const spStock = stockIniSP + entPS.uni - envTall;

    return {
      parte, sc, sp, codigo, stockIniSP,
      scStock, envPSUni: envPS.uni, envPSDetalle: envPS.detalle,
      spStock, entPSUni: entPS.uni, envTall, entPSDetalle: entPS.detalle
    };
  });
}

function renderPliegos() {
  const tbody = document.getElementById("tblPliegosBody");
  if (!tbody) return;

  if (!pliegosRows.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#999;padding:12px">Sin pliegos cargados</td></tr>`;
    return;
  }

  window._pliegosRows = pliegosRows;

  // Cabecera de grupo AJ Adhesivos
  let html = `<tr class="row-grupo-header">
    <td>AJ Adh</td>
    <td colspan="3"></td>
    <td style="text-align:right;font-size:11px">Pliegos</td>
    <td style="font-size:12px;color:#888;padding-right:8px;text-align:right">${pliegosRows.length * 2} filas</td>
  </tr>`;

  pliegosRows.forEach((r, i) => {
    const fmtOnline = (v) => {
      if (v < 0) return `<span style="color:#b42318;font-weight:700">${fmtN(v)}</span>`;
      if (v === 0) return `<span style="color:#999">0</span>`;
      return `<span style="color:#16a34a;font-weight:700">${fmtN(v)}</span>`;
    };

    // Fila SC — sin adhesivar
    html += `<tr>
      <td class="col-marca">AJ Adh</td>
      <td class="col-tipo">S/Adh</td>
      <td class="col-nfleje">${esc(r.codigo)}</td>
      <td class="col-nfleje" style="color:#888">${esc(r.sc)}</td>
      <td class="col-number">—</td>
      <td class="col-number col-clickable" onclick="popupPliegoSC(${i})">${fmtOnline(r.scStock)}</td>
    </tr>`;

    // Fila SP — adhesivado
    html += `<tr>
      <td class="col-marca">AJ Adh</td>
      <td class="col-tipo">Adh</td>
      <td class="col-nfleje">${esc(r.codigo)}</td>
      <td class="col-nfleje" style="color:#888">${esc(r.sp)}</td>
      <td class="col-number">—</td>
      <td class="col-number col-clickable" onclick="popupPliegoSP(${i})">${fmtOnline(r.spStock)}</td>
    </tr>`;
  });

  // Separador final
  html += `<tr class="row-sep"><td colspan="6"></td></tr>`;

  tbody.innerHTML = html;
}

function popupPliegoSC(i) {
  const r = (window._pliegosRows || [])[i];
  if (!r) return;

  const detRows = r.envPSDetalle.length
    ? [...r.envPSDetalle].reverse().map(d =>
        `<tr><td style="color:#666;font-size:11px;padding:2px 4px">${esc(d.fecha)}</td><td style="text-align:right;padding:2px 4px">${fmtN(d.uni)}</td></tr>`
      ).join("")
    : `<tr><td colspan="2" style="color:#999;font-size:11px;padding:4px">Sin envíos</td></tr>`;

  abrirPopup(`S/Adhesivar — ${r.parte} (${r.sc})`,
    `<table style="width:100%">
      <tr><td>Stock Inicial SC</td><td style="text-align:right;font-weight:600">0</td></tr>
      <tr style="cursor:pointer" onclick="document.getElementById('detSC').style.display=document.getElementById('detSC').style.display==='none'?'':'none'">
        <td>− Envios a AJ Adhesivos <span style="font-size:10px;color:#999">▼</span></td>
        <td style="text-align:right;font-weight:600">${fmtN(r.envPSUni)}</td>
      </tr>
      <tr id="detSC" style="display:none"><td colspan="2" style="padding:4px 8px;background:#f9f9f9">
        <table style="width:100%">${detRows}</table>
      </td></tr>
      <tr style="border-top:2px solid #333"><td><b>= En tránsito</b></td><td style="text-align:right"><b>${fmtN(r.scStock)}</b></td></tr>
    </table>`
  );
}

function popupPliegoSP(i) {
  const r = (window._pliegosRows || [])[i];
  if (!r) return;

  const detEntRows = r.entPSDetalle.length
    ? [...r.entPSDetalle].reverse().map(d =>
        `<tr><td style="color:#666;font-size:11px;padding:2px 4px">${esc(d.fecha)}</td><td style="text-align:right;padding:2px 4px">${fmtN(d.uni)}</td></tr>`
      ).join("")
    : `<tr><td colspan="2" style="color:#999;font-size:11px;padding:4px">Sin entregas</td></tr>`;

  abrirPopup(`Adhesivado — ${r.parte} (${r.sp})`,
    `<table style="width:100%">
      <tr><td>Conteo (Stock Inicial)</td><td style="text-align:right;font-weight:600">${fmtN(r.stockIniSP)}</td></tr>
      <tr style="cursor:pointer" onclick="document.getElementById('detSP').style.display=document.getElementById('detSP').style.display==='none'?'':'none'">
        <td>+ Entregas AJ Adhesivos <span style="font-size:10px;color:#999">▼</span></td>
        <td style="text-align:right;font-weight:600">${fmtN(r.entPSUni)}</td>
      </tr>
      <tr id="detSP" style="display:none"><td colspan="2" style="padding:4px 8px;background:#f9f9f9">
        <table style="width:100%">${detEntRows}</table>
      </td></tr>
      <tr><td>− Envios a Talleristas</td><td style="text-align:right;font-weight:600">${fmtN(r.envTall)}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Stock Online</b></td><td style="text-align:right"><b>${fmtN(r.spStock)}</b></td></tr>
    </table>`
  );
}

/* ================= START ================= */
init();
