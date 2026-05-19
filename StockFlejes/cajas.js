"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusEl = document.getElementById("status");
const tblBody = document.getElementById("tblBody");
const txtBuscar = document.getElementById("txtBuscar");
const selStock = document.getElementById("selStock");
const selTallerista = document.getElementById("selTallerista");

let cajasData = [];
let rowsProcessed = [];

// Mapeos: código artículo → { nCaja, uniXCaja }
let codToCaja = new Map();
// Consumo de cajas: nCaja → total cajas consumidas
let consumoCajasMap = new Map();
// Envíos de cajas: nCaja → total cajas por envíos
let enviosCajasMap = new Map();
// Entregas de cajas: nCaja → total cajas por entregas
let entregasCajasMap = new Map();
// OC pendientes: nCaja → { cantidad, fecha }
let ocPendienteMap = new Map();
// Detalle consumo: nCaja → [ { cod, desc, cajasUsadas } ]
let consumoDetalleMap = new Map();
// Códigos que usan cada caja: nCaja → [ { cod, desc, uniXCaja } ]
let codigosPorCaja = new Map();
// Detalles envíos: descripción → [{tallerista, diaMes, unidades, cajas}]
let enviosDetalleMap = new Map();
// Compras reales desde Recepcion_Insumos: nCaja → total cantidad
let comprasCajasMap = new Map();
// Detalle compras: nCaja → [{proveedor, fecha, cantidad, remito}]
let comprasDetalleMap = new Map();

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function n(v) { return isNaN(v) ? 0 : Number(v); }
function normalizeText(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const PEDIDO_MIN = 1000; // Pedido mínimo 1000 cajas
const UNI_X_PAQUETE = 25; // Vienen en paquetes de 25

/* ================= CARGAR DATOS ================= */
async function cargarCajas() {
  const { data, error } = await sb.from("Cajas").select("*").order("N_Caja", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function cargarMapeoCajas() {
  // Leer de Despiece x Articulo los campos N_Caja y Uni_x_Caja
  const { data, error } = await sb
    .from("Despiece x Articulo")
    .select("COD, N_Caja, Uni_x_Caja")
    .not("N_Caja", "is", null);

  if (error) throw error;

  // Traer COD, ARTICULO (nombre del producto), N_Caja, Uni_x_Caja
  const { data: dataDesc } = await sb
    .from("Despiece x Articulo")
    .select("COD, ARTICULO, N_Caja, Uni_x_Caja")
    .not("N_Caja", "is", null);

  // Traer E. Madre para consumo mensual por código
  const [resLK, resCH] = await Promise.all([
    sb.from("E. Madre LK").select("*"),
    sb.from("E. Madre CH").select("*")
  ]);
  const eMadreMap = new Map();
  (resLK.data || []).forEach(r => {
    const cod = String(r["Cod"] || "").trim().toUpperCase();
    if (cod) eMadreMap.set(cod, Number(r["E. Madre"]) || 0);
  });
  (resCH.data || []).forEach(r => {
    const cod = String(r["Cod"] || "").trim().toUpperCase();
    if (cod && !eMadreMap.has(cod)) eMadreMap.set(cod, Number(r["E. Madre"]) || 0);
  });

  codToCaja.clear();
  codigosPorCaja.clear();
  (dataDesc || []).forEach(r => {
    const cod = String(r["COD"] || "").trim();
    const nCaja = n(r["N_Caja"]);
    const uniXCaja = n(r["Uni_x_Caja"]) || 12;
    const desc = String(r["ARTICULO"] || "").trim();
    if (cod && nCaja && !codToCaja.has(cod)) {
      const eMadre = eMadreMap.get(cod.toUpperCase()) || 0;
      codToCaja.set(cod, { nCaja, uniXCaja, desc, eMadre });
      if (!codigosPorCaja.has(nCaja)) codigosPorCaja.set(nCaja, []);
      codigosPorCaja.get(nCaja).push({ cod, desc, uniXCaja, eMadre });
    }
  });
}

async function cargarConsumo() {
  // Leer envíos a talleristas (unidades enviadas por código)
  const [resEnvios, resEntregas] = await Promise.all([
    sb.from("Envios a Talleristas").select("Descripcion, Unidades, Tallerista, \"Dia-mes\""),
    sb.from("Entregas Tallerista Virgilio").select("*")
  ]);

  consumoCajasMap.clear();
  enviosCajasMap.clear();
  entregasCajasMap.clear();
  consumoDetalleMap.clear();
  enviosDetalleMap.clear();

  function addConsumo(nCaja, cod, desc, cajasUsadas, tipo) {
    // tipo = "envio" o "entrega"
    consumoCajasMap.set(nCaja, (consumoCajasMap.get(nCaja) || 0) + cajasUsadas);
    if (tipo === "envio") {
      enviosCajasMap.set(nCaja, (enviosCajasMap.get(nCaja) || 0) + cajasUsadas);
    } else if (tipo === "entrega") {
      entregasCajasMap.set(nCaja, (entregasCajasMap.get(nCaja) || 0) + cajasUsadas);
    }
    if (!consumoDetalleMap.has(nCaja)) consumoDetalleMap.set(nCaja, new Map());
    const det = consumoDetalleMap.get(nCaja);
    const prev = det.get(cod) || { cod, desc, cajas: 0 };
    prev.cajas += cajasUsadas;
    det.set(cod, prev);
  }

  // Envios a Talleristas: procesar cada envío
  // NOTA: El campo "Unidades" YA está en cajas, no en unidades de producto
  (resEnvios.data || []).forEach(r => {
    const desc = String(r["Descripcion"] || "").trim();
    const cajasEnviadas = n(r["Unidades"]); // Este valor YA es en cajas
    const tallerista = String(r["Tallerista"] || "").trim();
    const diaMes = String(r["Dia-mes"] || "").trim();
    if (!desc || cajasEnviadas <= 0) return;

    // Envios directos de cajas: "Caja N 29" → nCaja 29, unidades = cajas enviadas
    const matchCaja = desc.match(/^Caja\s+N\s*(\d+)$/i);
    if (matchCaja) {
      const nCaja = parseInt(matchCaja[1], 10);
      if (nCaja > 0) {
        addConsumo(nCaja, desc, desc, cajasEnviadas, "envio");
        const cajaKey = "caja_" + nCaja;
        const detalles = enviosDetalleMap.get(cajaKey) || [];
        detalles.push({ tallerista, diaMes, unidades: cajasEnviadas });
        enviosDetalleMap.set(cajaKey, detalles);
      }
      return;
    }

    // Intentar encontrar el código de forma flexible (para saber a qué caja pertenece)
    let info = null;
    let foundCod = null;

    // Intento 1: buscar por código exacto (case-insensitive)
    for (const [cod, i] of codToCaja.entries()) {
      if (cod.toUpperCase().trim() === desc.toUpperCase().trim()) {
        info = i;
        foundCod = cod;
        break;
      }
    }

    // Intento 2: buscar por descripción normalizada
    if (!info) {
      const descNorm = normalizeText(desc);
      for (const [cod, i] of codToCaja.entries()) {
        if (normalizeText(i.desc) === descNorm) {
          info = i;
          foundCod = cod;
          break;
        }
      }
    }

    // Intento 3: buscar por coincidencia parcial
    if (!info && desc.length >= 3) {
      const descLower = desc.toLowerCase().trim();
      for (const [cod, i] of codToCaja.entries()) {
        const codLower = cod.toLowerCase().trim();
        const articLower = i.desc.toLowerCase().trim();

        // Buscar coincidencia en código
        if (codLower.includes(descLower) || descLower.includes(codLower)) {
          info = i;
          foundCod = cod;
          break;
        }

        // Buscar coincidencia en descripción
        if (articLower.includes(descLower) || descLower.includes(articLower)) {
          info = i;
          foundCod = cod;
          break;
        }
      }
    }

    if (!info) return;

    const nCaja = info.nCaja;

    // Sumar cajas para esta caja (las unidades ya están en cajas)
    addConsumo(nCaja, foundCod, info.desc || desc, cajasEnviadas, "envio");

    // Guardar detalles de envío con caja key
    const cajaKey = "caja_" + nCaja;
    const detalles = enviosDetalleMap.get(cajaKey) || [];
    detalles.push({ tallerista, diaMes, unidades: cajasEnviadas });
    enviosDetalleMap.set(cajaKey, detalles);
  });

  // Entregas Log/Fabrica en Virgilio: también consumen cajas
  (resEntregas.data || []).forEach(r => {
    const codTall = String(r["Cod_Tall"] || "").trim();
    const nombre = String(r["Nombre_Tall"] || "").trim().toLowerCase();
    if (codTall !== "0001" && !nombre.includes("log")) return;

    const cod = String(r["Cod"] || "").trim();
    const cajas = n(r["Cajas"]);
    if (!cod || cajas <= 0) return;

    const info = codToCaja.get(cod);
    if (!info) return;

    addConsumo(info.nCaja, cod, info.desc || cod, cajas, "entrega");
  });
}

/* ================= CARGAR OC PENDIENTES ================= */
async function cargarOCPendientes() {
  try {
    const { data } = await sb.from("Ordenes_Compra")
      .select("*")
      .eq("rubro", "Cajas")
      .eq("estado", "pendiente");

    ocPendienteMap.clear();
    (data || []).forEach(r => {
      const cod = String(r.codigo || "").trim();
      const pendiente = (r.cantidad || 0) - (r.cantidad_recibida || 0);
      if (pendiente > 0) {
        const prev = ocPendienteMap.get(cod);
        if (!prev || r.fecha > prev.fecha) {
          ocPendienteMap.set(cod, {
            cantidad: pendiente,
            fecha: r.fecha,
            fechaEstimada: r.fecha_estimada_proveedor,
            fechaEntrega: r.fecha_entrega_real,
            ocId: r.id
          });
        }
      }
    });
  } catch (err) {
    console.error("Error cargando OC:", err);
  }
}

/* ================= POBLAR TALLERISTAS ================= */
function poblarTalleristas() {
  const talleristas = new Set();
  for (const [_, detalles] of enviosDetalleMap.entries()) {
    detalles.forEach(d => {
      if (d.tallerista) talleristas.add(String(d.tallerista).trim());
    });
  }
  const sorted = Array.from(talleristas).sort();

  selTallerista.innerHTML = '<option value="todos">Todos</option>';
  sorted.forEach(t => {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    selTallerista.appendChild(opt);
  });
}

/* ================= VERIFICAR BLOQUEO LOGISTICA ================= */
async function verificarBloqueoLogistica() {
  // Buscar OC donde el proveedor ya dio fecha estimada pero logística no registró entrega
  const { data } = await sb.from("Ordenes_Compra")
    .select("*")
    .eq("rubro", "Cajas")
    .eq("estado", "pendiente")
    .not("fecha_estimada_proveedor", "is", null);

  if (!data || !data.length) return;

  const hoy = new Date().toISOString().slice(0, 10);
  const vencidas = data.filter(r => r.fecha_estimada_proveedor <= hoy && !r.fecha_entrega_real);

  if (!vencidas.length) return;

  // Mostrar bloqueo
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px";

  overlay.innerHTML = `<div style="background:#fff;border-radius:14px;padding:24px;max-width:480px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3)">
    <h2 style="margin:0 0 8px;font-size:16px">Entregas pendientes sin registrar</h2>
    <p style="font-size:13px;color:#555;margin:0 0 16px">
      Hay ${vencidas.length} OC cuya fecha de entrega estimada ya pasó y no se registró la recepción.
    </p>
    ${vencidas.map(r => `<div style="padding:6px 0;border-bottom:1px solid #eee;font-size:13px">
      <b>Caja ${r.codigo}</b> — ${r.cantidad} uni · Estimada: ${r.fecha_estimada_proveedor}
    </div>`).join("")}
    <div style="display:flex;gap:10px;margin-top:16px">
      <button onclick="bloqueoProvNoEnvio()" style="flex:1;padding:10px;border:2px solid #b42318;background:#fef3f2;color:#b42318;border-radius:8px;font-weight:700;cursor:pointer;font-size:12px">
        Proveedor no envió
      </button>
      <button onclick="bloqueoMeOlvide()" style="flex:1;padding:10px;border:none;background:#111;color:#fff;border-radius:8px;font-weight:700;cursor:pointer;font-size:12px">
        Me olvidé de anotar
      </button>
    </div>
  </div>`;

  document.body.appendChild(overlay);
  window._bloqueoOverlay = overlay;
  window._bloqueoVencidas = vencidas;
}

async function bloqueoProvNoEnvio() {
  // Reenviar mensaje al proveedor pidiendo fecha
  // TODO: conectar con WhatsApp Edge Function
  alert("Se reenviará mensaje al proveedor solicitando fecha de entrega por escrito.");

  const vencidas = window._bloqueoVencidas || [];
  for (const r of vencidas) {
    await sb.from("Control_Logistica").insert({
      oc_id: r.id,
      accion: "proveedor_no_envio",
      detalle: "Logística reportó que proveedor no envió. Se reenvía mensaje."
    });
  }

  if (window._bloqueoOverlay) window._bloqueoOverlay.remove();
}

async function bloqueoMeOlvide() {
  // Avisar a gerentes y llevar a la OC
  const vencidas = window._bloqueoVencidas || [];

  for (const r of vencidas) {
    await sb.from("Control_Logistica").insert({
      oc_id: r.id,
      accion: "logistica_olvido",
      detalle: "Logística admitió no haber registrado la fecha. Se notifica a gerencia."
    });
  }

  // TODO: enviar WhatsApp a 1131181594 y 1162521635
  alert("Se notificó a gerencia que no se registró la fecha de entrega.\nAhora completá las fechas de entrega.");

  if (window._bloqueoOverlay) window._bloqueoOverlay.remove();

  // Ir a modo stock para que vea las OC
  setModo("stock");
}

// Compras reales: lee Recepcion_Insumos rubro=Cajas, suma cantidad por codigo (N_Caja).
async function cargarCompras() {
  comprasCajasMap.clear();
  comprasDetalleMap.clear();
  const { data, error } = await sb.from("Recepcion_Insumos").select("*").eq("rubro", "Cajas");
  if (error) { console.error("Error compras Cajas:", error); return; }
  (data || []).forEach(r => {
    const nCaja = Number(String(r.codigo || "").trim());
    if (!nCaja) return;
    const cant = Number(r.cantidad) || 0;
    comprasCajasMap.set(nCaja, (comprasCajasMap.get(nCaja) || 0) + cant);
    if (!comprasDetalleMap.has(nCaja)) comprasDetalleMap.set(nCaja, []);
    comprasDetalleMap.get(nCaja).push({
      proveedor: r.proveedor, fecha: r.fecha, cantidad: cant, remito: r.remito
    });
  });
}

/* ================= INIT ================= */
async function init() {
  statusEl.textContent = "Cargando cajas...";

  try {
    await cargarMapeoCajas();
    await Promise.all([cargarConsumo(), cargarOCPendientes(), cargarCompras()]);
    cajasData = await cargarCajas();

    poblarTalleristas();
    procesarRows();
    aplicarFiltros();
    statusEl.textContent = `${rowsProcessed.length} cajas cargadas`;

    // Verificar bloqueo de logística
    await verificarBloqueoLogistica();
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    console.error("Init error:", err);
  }
}

/* ================= PROCESAR ================= */
function procesarRows() {
  rowsProcessed = cajasData.map(c => {
    const nCaja = n(c["N_Caja"]);
    const codISIS = c["Cod_ISIS_LK"] || "";
    const stockInicial = n(c["Stock_Inicial"]);
    const consumoMes = n(c["Cons_Mensual"]);
    const compras = comprasCajasMap.get(nCaja) || 0;
    const comprasDetalle = comprasDetalleMap.get(nCaja) || [];
    const consumoReal = consumoCajasMap.get(nCaja) || 0;
    const enviosReal = enviosCajasMap.get(nCaja) || 0;
    const entregasReal = entregasCajasMap.get(nCaja) || 0;
    const stockOnline = stockInicial + compras - consumoReal;

    const stockCerv = n(c["Stock_Cerv"]);
    const stockVirg = n(c["Stock_Virg"]);
    const paqCerv = stockCerv;
    const paqVirg = stockVirg;
    const paqTotal = paqCerv + paqVirg;

    return { nCaja, codISIS, stockOnline, stockInicial, compras, comprasDetalle, consumoReal, enviosReal, entregasReal, consumoMes, stockCerv, stockVirg, paqCerv, paqVirg, paqTotal };
  });
}

/* ================= MODO ================= */
let modo = "stock"; // "stock" o "pedido"
const btnModoStock = document.getElementById("btnModoStock");
const btnModoPedido = document.getElementById("btnModoPedido");
const pdfBar = document.getElementById("pdfBar");
const filtroStockField = document.getElementById("filtroStockField");
const tblHead = document.getElementById("tblHead");

function setModo(m) {
  modo = m;
  btnModoStock.classList.toggle("active", m === "stock");
  btnModoPedido.classList.toggle("active", m === "pedido");
  pdfBar.style.display = m === "pedido" ? "flex" : "none";
  filtroStockField.style.display = m === "stock" ? "" : "none";
  aplicarFiltros();
}

btnModoStock.onclick = () => setModo("stock");
btnModoPedido.onclick = () => setModo("pedido");

/* ================= FILTROS ================= */
function tieneEnviosTallerista(nCaja, tallerista) {
  const cajaKey = "caja_" + nCaja;
  const detalles = enviosDetalleMap.get(cajaKey) || [];
  for (const d of detalles) {
    if (String(d.tallerista || "").trim() === tallerista) return true;
  }
  return false;
}

function aplicarFiltros() {
  const q = normalizeText(txtBuscar.value);
  const stockFiltro = selStock.value;
  const tallerista = selTallerista.value;

  let filtradas = rowsProcessed.map(r => {
    const stockMax = r.consumoMes * mesesGlobal;
    const need = stockMax - r.stockOnline;
    let pedido = 0;
    if (need > 0) {
      pedido = Math.max(Math.ceil(need / UNI_X_PAQUETE) * UNI_X_PAQUETE, PEDIDO_MIN);
    }
    const pctStock = stockMax > 0 ? (r.stockOnline / stockMax) : (r.stockOnline > 0 ? 999 : 0);
    return { ...r, stockMax, pedido, _meses: mesesGlobal, pctStock };
  });

  // Filtro tallerista: solo mostrar cajas que tienen envios de ese tallerista
  if (tallerista !== "todos") {
    filtradas = filtradas.filter(r => tieneEnviosTallerista(r.nCaja, tallerista));
  }

  // Filtro texto
  if (q) {
    filtradas = filtradas.filter(r =>
      normalizeText(String(r.nCaja)).includes(q) || normalizeText(r.codISIS).includes(q)
    );
  }

  if (modo === "stock") {
    // Filtro stock
    if (stockFiltro === "conStock") filtradas = filtradas.filter(r => r.stockOnline > 0);
    if (stockFiltro === "sinStock") filtradas = filtradas.filter(r => r.stockOnline <= 0);
    // Ordenar por N° Caja
    filtradas.sort((a, b) => a.nCaja - b.nCaja);
    renderStock(filtradas);
  } else {
    // Solo los que necesitan pedido (stock < max)
    filtradas = filtradas.filter(r => r.stockOnline < r.stockMax);
    // Ordenar por urgencia: menor % de stock primero
    filtradas.sort((a, b) => a.pctStock - b.pctStock);
    renderPedido(filtradas);
  }
}

txtBuscar.addEventListener("input", aplicarFiltros);
selStock.addEventListener("change", aplicarFiltros);
selTallerista.addEventListener("change", aplicarFiltros);

/* ================= MESES ================= */
let mesesGlobal = 4;
const numMeses = document.getElementById("numMeses");

function setMeses() {
  mesesGlobal = Number(numMeses.value) || 4;
  aplicarFiltros();
}

numMeses.addEventListener("input", setMeses);

/* ================= PEDIDO CONFIRMADO ================= */
const pedidoConf = {}; // nCaja -> cantidad confirmada

function setPedidoConf(i) {
  const r = window._rowsPedido[i];
  if (!r) return;
  const inp = document.getElementById("conf_" + i);
  if (!inp) return;
  const val = Number(inp.value) || 0;
  pedidoConf[r.nCaja] = val;
  updateMesesStock(i);
  updateTotalConf();
}

function getConf(r, pedidoSug) {
  if (r.nCaja in pedidoConf) return pedidoConf[r.nCaja];
  return pedidoSug; // default = sugerido
}

function calcMesesStock(r, cantPedido) {
  if (r.consumoMes <= 0) return "∞";
  const stockFinal = r.stockOnline + cantPedido;
  const meses = stockFinal / r.consumoMes;
  return meses.toFixed(1);
}

function updateMesesStock(i) {
  const r = window._rowsPedido[i];
  if (!r) return;
  const conf = getConf(r, r.pedido);
  const mesesEl = document.getElementById("meses_" + i);
  const confEl = document.getElementById("conf_" + i);
  if (mesesEl) {
    const ms = calcMesesStock(r, conf);
    mesesEl.textContent = ms;
    // Alerta si no llega al mínimo
    if (conf > 0 && conf < PEDIDO_MIN) {
      mesesEl.style.color = "#b42318";
      mesesEl.title = `Pedido min: ${PEDIDO_MIN.toLocaleString("es-AR")}`;
    } else {
      mesesEl.style.color = "";
      mesesEl.title = "";
    }
  }
  // Alerta visual en input
  if (confEl) {
    if (conf > 0 && conf < PEDIDO_MIN) {
      confEl.style.borderColor = "#b42318";
      confEl.style.background = "#fef3f2";
    } else if (conf > 0) {
      confEl.style.borderColor = "#0a7a2f";
      confEl.style.background = "#f3fbf6";
    } else {
      confEl.style.borderColor = "#d0d7de";
      confEl.style.background = "";
    }
  }
}

function updateTotalConf() {
  const rows = window._rowsPedido || [];
  let total = 0;
  rows.forEach(r => total += getConf(r, r.pedido));
  const el = document.getElementById("totalConf");
  if (el) el.textContent = total.toLocaleString("es-AR");
}

/* ================= RENDER STOCK ================= */
function renderStock(rows) {
  window._rowsPedido = rows;

  tblHead.innerHTML = `<tr class="header-sub">
    <th>N°<br>Caja</th>
    <th>Stk<br>Online</th>
    <th><br>Cerv</th>
    <th><br>Virg</th>
    <th>Stk<br>Max</th>
    <th>Cons<br>Mes</th>
    <th>Meses<br>Rest</th>
  </tr>`;

  let html = "";
  rows.forEach((r, i) => {
    const mesesRest = r.consumoMes > 0 ? (r.stockOnline / r.consumoMes).toFixed(1) : "∞";
    const urgente = r.consumoMes > 0 && r.stockOnline < r.consumoMes * 2;
    const style = urgente ? "color:#b42318;font-weight:700" : "";

    html += `<tr>
      <td class="col-nfleje">${r.nCaja}</td>
      <td class="col-number col-clickable" onclick="popupStockOnline(${i})" style="${style}">${r.stockOnline.toLocaleString("es-AR")}</td>
      <td class="col-number">${fmtN(r.paqCerv)}</td>
      <td class="col-number">${fmtN(r.paqVirg)}</td>
      <td class="col-number col-clickable" onclick="popupStockMax(${i})">${r.stockMax.toLocaleString("es-AR")}</td>
      <td class="col-number">${r.consumoMes.toLocaleString("es-AR")}</td>
      <td class="col-number" style="${style}">${mesesRest}</td>
    </tr>`;
  });

  // OC Pendientes
  const ocItems = [...ocPendienteMap.entries()];
  if (ocItems.length > 0) {
    html += `<tr class="row-sep"><td colspan="7"></td></tr>`;
    html += `<tr class="row-grupo-header"><td colspan="7">OC Pendientes</td></tr>`;
    ocItems.forEach(([cod, oc]) => {
      const fechaOC = oc.fecha || "—";
      const fechaEst = oc.fechaEstimada || "sin confirmar";
      html += `<tr>
        <td class="col-nfleje">${esc(cod)}</td>
        <td class="col-number">${fmtN(oc.cantidad)}</td>
        <td colspan="2" style="color:#555;padding:4px 6px">OC: ${fechaOC}</td>
        <td colspan="3" style="color:${oc.fechaEstimada ? '#0a7a2f' : '#b42318'};padding:4px 6px">Entrega: ${fechaEst}</td>
      </tr>`;
    });
  }

  tblBody.innerHTML = html || `<tr><td colspan="7" class="empty">No hay cajas cargadas</td></tr>`;
}

/* ================= RENDER PEDIDO ================= */
function renderPedido(rows) {
  window._rowsPedido = rows;

  tblHead.innerHTML = `<tr class="header-sub">
    <th>N°<br>Caja</th>
    <th>Ped<br>Sug</th>
    <th>Ped<br>Conf</th>
    <th>Meses<br>Stock</th>
    <th>Stk<br>Online</th>
    <th>Stk<br>Max</th>
  </tr>`;

  let html = "";
  rows.forEach((r, i) => {
    const conf = getConf(r, r.pedido);
    const mesesStock = calcMesesStock(r, conf);
    const alerta = conf > 0 && conf < PEDIDO_MIN;
    const pedidoClass = r.pedido > 0 ? "col-number col-pedido col-clickable" : "col-number col-clickable";
    const confStyle = alerta
      ? "border-color:#b42318;background:#fef3f2"
      : (conf > 0 ? "border-color:#0a7a2f;background:#f3fbf6" : "");
    const mesesStyle = alerta ? "color:#b42318;font-weight:700" : "";

    html += `<tr>
      <td class="col-nfleje">${r.nCaja}</td>
      <td class="${pedidoClass}" onclick="popupPedido(${i})">${r.pedido.toLocaleString("es-AR")}</td>
      <td><input id="conf_${i}" type="text" inputmode="numeric" value="${conf || ""}"
        style="width:62px;height:26px;text-align:center;border:2px solid #d0d7de;border-radius:5px;font-weight:700;font-size:12px;${confStyle}"
        oninput="this.value=this.value.replace(/\\D/g,'');setPedidoConf(${i})" /></td>
      <td id="meses_${i}" class="col-number" style="${mesesStyle}">${mesesStock}</td>
      <td class="col-number col-clickable" onclick="popupStockOnline(${i})">${r.stockOnline.toLocaleString("es-AR")}</td>
      <td class="col-number col-clickable" onclick="popupStockMax(${i})">${r.stockMax.toLocaleString("es-AR")}</td>
    </tr>`;
    if (alerta) {
      html += `<tr><td></td><td colspan="5" style="font-size:10px;color:#b42318;padding:0 6px 3px;line-height:1.2">
        ⚠ Mín 1.000 → ${calcMesesStock(r, 1000)} meses</td></tr>`;
    }
  });

  let totalConf = 0;
  rows.forEach(r => totalConf += getConf(r, r.pedido));

  html += `<tr class="row-subtotal">
    <td></td>
    <td></td>
    <td class="col-number" id="totalConf">${totalConf.toLocaleString("es-AR")}</td>
    <td colspan="3"></td>
  </tr>`;

  tblBody.innerHTML = html || `<tr><td colspan="6" class="empty">Todo cubierto</td></tr>`;
}

/* ================= POPUPS ================= */
const popupEl = document.getElementById("popupDetalle");
const popupTitulo = document.getElementById("popupTitulo");
const popupBody = document.getElementById("popupBody");

function cerrarPopupDetalle() {
  popupEl.classList.add("hidden");
  // Cerrar también el popup de detalles de envíos si está abierto
  const detallesEnvios = document.querySelector(".popup-envios-detalle");
  if (detallesEnvios) detallesEnvios.remove();
}

document.getElementById("popupCerrar").onclick = cerrarPopupDetalle;
popupEl.addEventListener("click", e => { if (e.target === popupEl) cerrarPopupDetalle(); });

function abrirPopup(titulo, html) {
  popupTitulo.textContent = titulo;
  popupBody.innerHTML = html;
  popupEl.classList.remove("hidden");
}

function fmtN(v) { return Number(v).toLocaleString("es-AR"); }

function popupStockOnline(i) {
  const r = window._rowsPedido[i];
  if (!r) return;

  // Obtener detalles de envíos usando el número de caja
  const cajaKey = "caja_" + r.nCaja;
  const enviosConDetalle = enviosDetalleMap.get(cajaKey) || [];

  const flechaBtn = (enviosConDetalle.length > 0)
    ? `<button class="btn-detalle-envios" onclick="mostrarDetalleEnviosCajas(event,${i})" title="Ver detalle por tallerista" style="margin-left:8px;padding:2px 8px;background:#111;color:#fff;border:none;border-radius:3px;cursor:pointer;font-weight:700">▶</button>`
    : "";

  abrirPopup(`Stock Online — Caja ${r.nCaja}`,
    `<table>
      <tr><td>Stock Inicial</td><td>${fmtN(r.stockInicial)}</td></tr>
      <tr><td>+ Compras</td><td>${fmtN(r.compras)}</td></tr>
      <tr><td>− Envios</td><td>${fmtN(r.enviosReal)} ${flechaBtn}</td></tr>
      <tr><td>− Entregas</td><td>${fmtN(r.entregasReal)}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Stock Online</b></td><td><b>${fmtN(r.stockOnline)}</b></td></tr>
    </table>
    <div style="margin-top:10px;border-top:1px solid #eee;padding-top:8px">
      <div style="font-weight:700;font-size:12px;margin-bottom:4px">Stock por ubicación (paquetes):</div>
      <table style="font-size:12px;width:100%">
        <tr><td style="padding:2px 6px">Cervantes</td><td style="text-align:right;padding:2px 6px;font-weight:600">${fmtN(r.paqCerv)} paq</td></tr>
        <tr><td style="padding:2px 6px">Virgilio</td><td style="text-align:right;padding:2px 6px;font-weight:600">${fmtN(r.paqVirg)} paq</td></tr>
        <tr style="border-top:1px solid #ddd"><td style="padding:2px 6px;font-weight:700">Total</td><td style="text-align:right;padding:2px 6px;font-weight:700">${fmtN(r.paqTotal)} paq</td></tr>
      </table>
    </div>`
  );
}

function mostrarDetalleEnviosCajas(event, i) {
  event.stopPropagation();
  const r = window._rowsPedido[i];
  if (!r) return;

  // Obtener detalles de envíos usando el número de caja
  const cajaKey = "caja_" + r.nCaja;
  const enviosConDetalle = enviosDetalleMap.get(cajaKey) || [];

  if (!enviosConDetalle.length) return;

  // Ordenar por fecha (más reciente primero) y tomar últimas 5
  // Las fechas en diaMes están en formato "DD/MM", ordenar lexicográficamente funciona si mismo mes
  const ordenados = enviosConDetalle.sort((a, b) => {
    // Convertir "DD/MM" a fecha comparable
    const parseDate = (diaMes) => {
      if (!diaMes) return new Date(0);
      const [dia, mes] = diaMes.split('/').map(Number);
      const hoy = new Date();
      return new Date(hoy.getFullYear(), mes - 1, dia);
    };
    return parseDate(b.diaMes) - parseDate(a.diaMes);
  });

  const ultimas5 = ordenados.slice(0, 5);

  // Crear popup mini sin filtro
  const el = document.createElement("div");
  el.className = "popup-envios-detalle";
  el.innerHTML = `
    <div class="popup-envios-detalle-header">
      <span>Envíos a Talleristas — Caja ${r.nCaja}</span>
      <button onclick="this.parentElement.parentElement.remove()" type="button" style="background:none;border:none;font-size:16px;cursor:pointer">✕</button>
    </div>
    <table style="width:100%;font-size:11px;border-collapse:collapse">
      <tbody>
        ${ultimas5.map(d =>
          `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(d.tallerista)} — ${esc(d.diaMes)}</td><td style="text-align:right;padding:4px 8px;border-bottom:1px solid #eee">${fmtN(d.unidades)}</td></tr>`
        ).join("")}
      </tbody>
    </table>
  `;
  el.style.position = "fixed";
  el.style.background = "#fff";
  el.style.border = "1px solid #ccc";
  el.style.borderRadius = "6px";
  el.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
  el.style.zIndex = "10001";
  el.style.maxHeight = "250px";
  el.style.overflow = "auto";
  el.style.minWidth = "280px";
  document.body.appendChild(el);

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

  // Códigos que usan esta caja
  const codigos = codigosPorCaja.get(r.nCaja) || [];
  // Consumo real por código (si hay)
  const detMap = consumoDetalleMap.get(r.nCaja);

  // Para cada código: calcular cajas/mes = E.Madre / uniXCaja
  const items = codigos.map(c => {
    const cajasMes = c.uniXCaja > 0 ? Math.ceil(c.eMadre / c.uniXCaja) : 0;
    return { cod: c.cod, desc: c.desc, uniXCaja: c.uniXCaja, eMadre: c.eMadre, cajasMes };
  });
  // Ordenar por mayor consumo de cajas/mes
  items.sort((a, b) => b.cajasMes - a.cajasMes || a.cod.localeCompare(b.cod, "es", { numeric: true }));

  let codsHtml = "";
  if (items.length > 0) {
    const totalCajasMes = items.reduce((s, it) => s + it.cajasMes, 0);
    codsHtml = `<div style="margin-top:10px;border-top:1px solid #eee;padding-top:8px">
      <div style="font-weight:700;font-size:12px;margin-bottom:4px">Consumo por código (${items.length} artículos, ${fmtN(totalCajasMes)} cajas/mes):</div>
      <div style="max-height:250px;overflow-y:auto">
      <table style="font-size:12px;width:100%">
        <tr style="border-bottom:1px solid #ddd">
          <td style="font-weight:700;padding:2px 6px">Cod</td>
          <td style="font-weight:700;padding:2px 6px">Artículo</td>
          <td style="font-weight:700;text-align:right;padding:2px 6px">E.Madre</td>
          <td style="font-weight:700;text-align:right;padding:2px 6px">Cja/Mes</td>
        </tr>
        ${items.map(it => `<tr>
          <td style="padding:2px 6px;font-weight:600">${esc(it.cod)}</td>
          <td style="padding:2px 6px;font-size:11px;color:#555">${esc(it.desc)}</td>
          <td style="text-align:right;padding:2px 6px">${it.eMadre > 0 ? fmtN(it.eMadre) : "—"}</td>
          <td style="text-align:right;padding:2px 6px">${it.cajasMes > 0 ? fmtN(it.cajasMes) : "—"}</td>
        </tr>`).join("")}
      </table></div>
    </div>`;
  }

  abrirPopup(`Stock Max — Caja ${r.nCaja}`,
    `<table>
      <tr><td>Consumo Mensual</td><td>${fmtN(r.consumoMes)}</td></tr>
      <tr><td>× Meses</td><td>${r._meses}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Stock Max</b></td><td><b>${fmtN(r.stockMax)}</b></td></tr>
    </table>${codsHtml}`
  );
}

function popupPedido(i) {
  const r = window._rowsPedido[i];
  if (!r) return;
  abrirPopup(`Pedido — Caja ${r.nCaja}`,
    `<table>
      <tr><td>Stock Max</td><td>${fmtN(r.stockMax)}</td></tr>
      <tr><td>− Stock Online</td><td>${fmtN(r.stockOnline)}</td></tr>
      <tr><td>= Necesidad</td><td>${fmtN(r.stockMax - r.stockOnline)}</td></tr>
      <tr><td>Paq x ${UNI_X_PAQUETE} (mínimo)</td><td>${UNI_X_PAQUETE}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Pedido</b></td><td><b>${fmtN(r.pedido)}</b></td></tr>
    </table>`
  );
}

/* ================= GENERAR PDF ================= */
document.getElementById("btnGenerarPDF").addEventListener("click", generarPDF);

async function generarPDF() {
  const rows = window._rowsPedido || [];
  const conPedido = rows.filter(r => getConf(r, r.pedido) > 0);
  if (!conPedido.length) { alert("No hay pedidos para generar."); return; }

  if (!confirm(`Generar pedido con ${conPedido.length} cajas?\nEsto guardará la OC y enviará aviso al proveedor.`)) return;

  const hoy = new Date().toLocaleDateString("es-AR");
  const hoyISO = new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Argentina/Buenos_Aires",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());

  // Guardar OC en Supabase
  try {
    const registros = conPedido.map(r => ({
      fecha: hoyISO,
      rubro: "Cajas",
      proveedor: "Corrugadora",
      codigo: String(r.nCaja),
      descripcion: `Caja ${r.nCaja}`,
      cantidad: getConf(r, r.pedido),
      cantidad_recibida: 0,
      unidad: "Cajas",
      estado: "pendiente",
      mensaje_enviado: false
    }));

    const { error } = await sb.from("Ordenes_Compra").insert(registros);
    if (error) console.error("Error guardando OC:", error);
  } catch (err) {
    console.error("Error guardando OC:", err);
  }

  let totalGeneral = 0;
  let totalPaq = 0;

  let tbody = "";
  conPedido.forEach(r => {
    const conf = getConf(r, r.pedido);
    const paq = conf / UNI_X_PAQUETE;
    const ms = calcMesesStock(r, conf);
    tbody += `<tr>
      <td style="padding:4px 8px;font-weight:700">${r.nCaja}</td>
      <td style="padding:4px 8px;font-size:12px;color:#555">${r.stockOnline.toLocaleString("es-AR")} online</td>
      <td style="text-align:right;font-weight:700;padding:4px 8px">${conf.toLocaleString("es-AR")}</td>
      <td style="text-align:right;padding:4px 8px;color:#555">${paq} paq</td>
      <td style="text-align:right;padding:4px 8px;color:#555">${ms} meses</td>
    </tr>`;
    totalGeneral += conf;
    totalPaq += paq;
  });

  const htmlPDF = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Pedido Cajas ${hoy}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#111;max-width:650px;margin:auto}
      h1{font-size:18px;margin:0 0 4px}
      .sub{font-size:13px;color:#555;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      td{border-bottom:1px solid #eee}
      .total{background:#111;color:#fff;font-weight:700;font-size:14px}
      .total td{padding:8px;border:none}
      @media print{body{padding:10px}}
    </style>
  </head><body>
    <h1>PEDIDO CAJAS (Corrugadora)</h1>
    <div class="sub">Fecha: ${hoy} · ${conPedido.length} cajas · ${mesesGlobal} meses · Paquete x ${UNI_X_PAQUETE}</div>
    <table>
      <thead><tr style="border-bottom:2px solid #111">
        <th style="text-align:left;padding:6px 8px">N° Caja</th>
        <th style="text-align:left;padding:6px 8px">Stock Online</th>
        <th style="text-align:right;padding:6px 8px">Pedido</th>
        <th style="text-align:right;padding:6px 8px">Paquetes</th>
        <th style="text-align:right;padding:6px 8px">Meses</th>
      </tr></thead>
      <tbody>${tbody}
        <tr class="total">
          <td colspan="3">TOTAL</td>
          <td style="text-align:right">${totalGeneral.toLocaleString("es-AR")}</td>
          <td style="text-align:right">${totalPaq.toLocaleString("es-AR")} paq</td>
        </tr>
      </tbody>
    </table>
    <div style="margin-top:20px;font-size:11px;color:#999">
      OC registrada en sistema · Pendiente confirmación fecha de entrega
    </div>
  </body></html>`;

  const win = window.open("", "_blank");
  win.document.write(htmlPDF);
  win.document.close();
  setTimeout(() => win.print(), 400);
}

/* ================= DIAGNOSTICO ================= */
async function diagnosticoCajasVacias() {
  try {
    console.log("=== DIAGNÓSTICO: Cajas sin productos ===");

    // Obtener todas las cajas de la tabla Cajas
    const { data: cajasList } = await sb.from("Cajas").select("N_Caja").order("N_Caja", { ascending: true });
    const todaLasCajas = new Set((cajasList || []).map(c => n(c["N_Caja"])));

    // Obtener cajas que tienen productos en Despiece x Articulo
    const { data: despiece } = await sb.from("Despiece x Articulo").select("N_Caja").not("N_Caja", "is", null);
    const cajasConProductos = new Set((despiece || []).map(d => n(d["N_Caja"])));

    // Cajas sin productos
    const cajasVacias = Array.from(todaLasCajas).filter(caja => !cajasConProductos.has(caja)).sort((a,b) => a-b);

    console.log("✓ Total cajas en tabla 'Cajas':", todaLasCajas.size);
    console.log("✓ Cajas CON productos en 'Despiece x Articulo':", cajasConProductos.size);

    if (cajasVacias.length > 0) {
      console.warn(`⚠️ CAJAS SIN PRODUCTOS (sin asociación): ${cajasVacias.join(", ")}`);
      console.warn(`   Estas cajas existen pero no tienen artículos asignados en 'Despiece x Articulo'`);
      statusEl.textContent += ` | ⚠️ Sin productos: ${cajasVacias.join(", ")}`;
    } else {
      console.log("✓ Todas las cajas tienen al menos 1 producto");
    }

    return cajasVacias;
  } catch (err) {
    console.error("Error en diagnóstico:", err);
    return [];
  }
}

/* ================= START ================= */
init();
diagnosticoCajasVacias();
