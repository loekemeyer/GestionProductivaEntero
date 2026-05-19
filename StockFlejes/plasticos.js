"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusEl = document.getElementById("status");
const tblBody = document.getElementById("tblBody");
const txtBuscar = document.getElementById("txtBuscar");
const selProv = document.getElementById("selProv");
const selTall = document.getElementById("selTall");
const selStock = document.getElementById("selStock");

let plasticosData = [];
let rowsProcessed = [];
let sectorMap = new Map();
let entregasPorSector = new Map();
let enviosPSPorSector = new Map();
let enviosTallPorSector = new Map();
let comprasPorCodISIS = new Map();
let sectoresPorTallerista = new Map(); // tallerista → Set de sectores plásticos

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function n(v) { return isNaN(v) ? 0 : Number(v); }
function normalizeText(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

const PEDIDO_MIN_COD = 1000;

async function fetchAll(tabla) {
  const all = []; const PAGE = 1000; let from = 0;
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

/* ================= INIT ================= */
async function init() {
  statusEl.textContent = "Cargando datos...";

  try {
    const [plasRes, entregasPS, enviosPS, enviosTall, recepcionInsumos, partesTall] = await Promise.all([
      sb.from("Partes_Plasticas").select("*").order("Proveedor", { ascending: true }),
      fetchAll("Entregas PS"),
      fetchAll("Envios a PS"),
      fetchAll("Envios a Talleristas"),
      fetchAll("Recepcion_Insumos"),
      sb.from("Partes x Tallerista").select("tallerista,sector_proce").limit(20000)
    ]);
    if (plasRes.error) throw plasRes.error;
    plasticosData = plasRes.data || [];

    // Obtener sectores plásticos existentes para filtrar
    const sectoresPlastSet = new Set(plasticosData.map(p => (p["Sector"] || "").trim()).filter(Boolean));

    // Obtener todos los sectores de plásticos para filtrar movimientos
    const sectoresPlast = new Set(plasticosData.map(p => (p["Sector"] || "").trim()).filter(Boolean));

    // Entregas PS: lo que devuelve un PS → entra al sector SP
    entregasPorSector = new Map();
    for (const e of entregasPS) {
      const sp = String(e["Sector SP"] || "").trim();
      if (!sp || !sectoresPlast.has(sp)) continue;
      if (!entregasPorSector.has(sp)) entregasPorSector.set(sp, { kg: 0, uni: 0, detalle: [] });
      const m = entregasPorSector.get(sp);
      m.kg += n(e["KG"]);
      m.cajones = (m.cajones || 0) + n(e["Cajones"]);
      m.detalle.push({ ps: e["Prov_Serv"], fecha: e["Dia-mes"], kg: n(e["KG"]), cajones: n(e["Cajones"]) });
    }

    // Envios a PS: sale del sector SC (crudo) hacia un PS para procesar
    enviosPSPorSector = new Map();
    for (const e of enviosPS) {
      const sc = String(e["Sector SC"] || "").trim();
      if (!sc || !sectoresPlast.has(sc)) continue;
      if (!enviosPSPorSector.has(sc)) enviosPSPorSector.set(sc, { kg: 0, uni: 0, detalle: [] });
      const m = enviosPSPorSector.get(sc);
      m.kg += n(e["KG"]);
      m.cajones = (m.cajones || 0) + n(e["Cajones"]);
      m.detalle.push({ ps: e["Prov_Serv"], fecha: e["Dia-mes"], kg: n(e["KG"]), cajones: n(e["Cajones"]) });
    }

    // Envios a Talleristas: sale del sector hacia un tallerista
    enviosTallPorSector = new Map();
    for (const e of enviosTall) {
      const sec = String(e["Sector"] || "").trim();
      if (!sec || !sectoresPlast.has(sec)) continue;
      if (!enviosTallPorSector.has(sec)) enviosTallPorSector.set(sec, { kg: 0, uni: 0, detalle: [] });
      const m = enviosTallPorSector.get(sec);
      m.kg += n(e["KG"]);
      m.uni += n(e["Unidades"]);
      m.cajones = (m.cajones || 0) + n(e["Cajones"]);
      m.detalle.push({ tall: e["Tallerista"], fecha: e["Dia-mes"], kg: n(e["KG"]), cajones: n(e["Cajones"]), uni: n(e["Unidades"]) });
    }

    // Compras: Recepcion_Insumos rubro=Plasticos, key=Cod_ISIS, suma cantidad
    comprasPorCodISIS = new Map();
    for (const r of recepcionInsumos) {
      if (String(r.rubro || "").trim() !== "Plasticos") continue;
      const cod = String(r.codigo || "").trim();
      if (!cod) continue;
      if (!comprasPorCodISIS.has(cod)) comprasPorCodISIS.set(cod, { cantidad: 0, detalle: [] });
      const m = comprasPorCodISIS.get(cod);
      m.cantidad += n(r.cantidad);
      m.detalle.push({ proveedor: r.proveedor, fecha: r.fecha, cantidad: n(r.cantidad), remito: r.remito });
    }

    // Poblar filtro proveedores
    const provs = [...new Set(plasticosData.map(p => p["Proveedor"] || "").filter(Boolean))].sort();
    provs.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      selProv.appendChild(opt);
    });

    // Armar mapa tallerista → sectores plásticos (desde Partes x Tallerista)
    sectoresPorTallerista = new Map();
    ((partesTall.data || partesTall) || []).forEach(r => {
      const tall = String(r.tallerista || "").trim();
      const sec = String(r.sector_proce || "").trim();
      if (!tall || !sec || !sectoresPlastSet.has(sec)) return;
      if (!sectoresPorTallerista.has(tall)) sectoresPorTallerista.set(tall, new Set());
      sectoresPorTallerista.get(tall).add(sec);
    });

    // Poblar filtro talleristas
    const talls = [...sectoresPorTallerista.keys()].sort((a, b) => a.localeCompare(b, "es"));
    talls.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      selTall.appendChild(opt);
    });

    procesarRows();
    aplicarFiltros();
    statusEl.textContent = `${rowsProcessed.length} partes cargadas`;
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    console.error("Init error:", err);
  }
}

/* ================= PROCESAR ================= */
function procesarRows() {
  rowsProcessed = plasticosData.map(p => {
    const desc = p["Descripcion"] || "";
    const prov = p["Proveedor"] || "";
    const familia = p["Familia"] || "";
    const sector = (p["Sector"] || "").trim();
    const stockInicial = n(p["Stock_Inicial"]);
    const consumoMes = n(p["Cons_Mensual"]);
    const pedidoMin = n(p["Pedido_Min"]) || PEDIDO_MIN_COD;

    const ent = entregasPorSector.get(sector) || { kg: 0, detalle: [] };
    const envPS = enviosPSPorSector.get(sector) || { kg: 0, detalle: [] };
    const envTall = enviosTallPorSector.get(sector) || { kg: 0, detalle: [] };
    const codISIS = String(p["Cod_ISIS"] || "").trim();
    const compras = comprasPorCodISIS.get(codISIS) || { cantidad: 0, detalle: [] };

    const kgxUni = n(p["Kg_x_Uni"]);
    const uniBolsa = n(p["Uni_x_Bolsa"]);
    // Si hay Kg_x_Uni: convertir KG a unidades
    // Si no: usar Unidades directamente, o KG como unidades (fallback para envíos registrados en KG sin peso unitario)
    const entUni = kgxUni > 0 ? Math.round(ent.kg / kgxUni) : (n(ent.uni || 0) || Math.round(ent.kg));
    const envPSUni = kgxUni > 0 ? Math.round(envPS.kg / kgxUni) : (n(envPS.uni || 0) || Math.round(envPS.kg));
    const envTallUni = kgxUni > 0 ? Math.round(envTall.kg / kgxUni) : (n(envTall.uni || 0) || Math.round(envTall.kg));
    const comprasUni = n(compras.cantidad);

    const stockOnline = stockInicial + comprasUni + entUni - envPSUni - envTallUni;

    return {
      desc, prov, familia, sector, stockOnline, stockInicial, consumoMes, pedidoMin,
      entUni, envPSUni, envTallUni, comprasUni,
      entDetalle: ent.detalle, envPSDetalle: envPS.detalle, envTallDetalle: envTall.detalle,
      comprasDetalle: compras.detalle,
      kgxUni
    };
  });

  rowsProcessed.sort((a, b) => {
    const pa = a.prov.localeCompare(b.prov, "es");
    if (pa !== 0) return pa;
    return (a.sector || "").localeCompare(b.sector || "", "es");
  });
}

/* ================= FILTROS ================= */
function aplicarFiltros() {
  const q = normalizeText(txtBuscar.value);
  const provFiltro = selProv.value;
  const tallFiltro = selTall.value;
  const stockFiltro = selStock.value;

  const sectoresTall = tallFiltro !== "todos" ? sectoresPorTallerista.get(tallFiltro) : null;

  const filtradas = rowsProcessed.filter(r => {
    if (q) {
      const match = normalizeText(r.desc).includes(q) || normalizeText(r.prov).includes(q) || normalizeText(r.sector).includes(q);
      if (!match) return false;
    }
    if (provFiltro !== "todos" && r.prov !== provFiltro) return false;
    if (sectoresTall && !sectoresTall.has(r.sector)) return false;
    if (stockFiltro === "conStock" && r.stockOnline <= 0) return false;
    if (stockFiltro === "sinStock" && r.stockOnline > 0) return false;
    return true;
  });

  renderTabla(filtradas);
}

txtBuscar.addEventListener("input", aplicarFiltros);
selProv.addEventListener("change", aplicarFiltros);
selTall.addEventListener("change", aplicarFiltros);
selStock.addEventListener("change", aplicarFiltros);

/* ================= MESES POR GRUPO ================= */
const mesesPorGrupo = {};

function getMesesGrupo(grupo) {
  return mesesPorGrupo[grupo] || 4;
}

function setMesesGrupo(grupo) {
  const inp = document.getElementById("meses_" + grupo.replace(/[^a-zA-Z0-9]/g, "_"));
  if (inp) mesesPorGrupo[grupo] = Number(inp.value) || 4;
  renderTabla(window._lastRows || []);
}

/* ================= RENDER ================= */
function renderTabla(rows) {
  window._lastRows = rows;
  let html = "";

  const rowsConPedido = rows.map(r => {
    const mult = getMesesGrupo(r.prov);
    const stockMax = r.consumoMes * mult;
    const need = stockMax - r.stockOnline;
    let pedido = 0;
    if (need > 0) {
      pedido = Math.max(Math.ceil(need / PEDIDO_MIN_COD) * PEDIDO_MIN_COD, PEDIDO_MIN_COD);
    }
    return { ...r, stockMax, pedido, _grupo: r.prov, _meses: mult };
  });

  window._rowsPedido = rowsConPedido;

  // Subtotales
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
      if (prevGrupo && subtotales[prevGrupo]) {
        const st = subtotales[prevGrupo];
        html += `<tr class="row-subtotal">
          <td colspan="3"></td>
          <td class="col-number">${st.pedido.toLocaleString("es-AR")}</td>
          <td colspan="2"></td>
        </tr>`;
        html += `<tr class="row-sep"><td colspan="6"></td></tr>`;
      }

      const gId = grupo.replace(/[^a-zA-Z0-9]/g, "_");
      const mVal = getMesesGrupo(grupo);
      html += `<tr class="row-grupo-header">
        <td colspan="4" style="font-size:14px;font-weight:800">${esc(r.prov)}</td>
        <td style="text-align:right;font-size:11px">Meses</td>
        <td><input id="meses_${gId}" type="number" value="${mVal}" min="1" max="24"
          onchange="setMesesGrupo('${esc(grupo)}')" /></td>
      </tr>`;
      prevGrupo = grupo;
    }

    const pedidoClass = r.pedido > 0 ? "col-number col-pedido col-clickable" : "col-number col-clickable";
    html += `<tr>
      <td class="col-marca">${esc(r.familia || "")}</td>
      <td class="col-sector">${esc(r.sector || "")}</td>
      <td class="col-desc" title="${esc(r.desc)}">${esc(r.desc)}</td>
      <td class="${pedidoClass}" onclick="popupPedido(${i})">${r.pedido.toLocaleString("es-AR")}</td>
      <td class="col-number col-clickable" onclick="popupStockMax(${i})">${r.stockMax.toLocaleString("es-AR")}</td>
      <td class="col-number col-clickable" onclick="popupStockOnline(${i})">${r.stockOnline.toLocaleString("es-AR")}</td>
    </tr>`;
  });

  // Último subtotal
  if (prevGrupo && subtotales[prevGrupo]) {
    const st = subtotales[prevGrupo];
    html += `<tr class="row-subtotal">
      <td colspan="3"></td>
      <td class="col-number">${st.pedido.toLocaleString("es-AR")}</td>
      <td colspan="2"></td>
    </tr>`;
  }

  tblBody.innerHTML = html || `<tr><td colspan="6" class="empty">No hay partes cargadas</td></tr>`;
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

function buildDetRows(detalle, tipo) {
  if (!detalle || !detalle.length) return '<div style="font-size:11px;color:#999;padding:4px 0">Sin movimientos</div>';
  let h = '<table style="width:100%;font-size:11px;margin:2px 0">';
  [...detalle].reverse().forEach(d => {
    const quien = tipo === "tall" ? (d.tall || "") : tipo === "compra" ? (d.proveedor || "") : (d.ps || "");
    const valor = tipo === "compra" ? `${fmtN(d.cantidad)} uni` : `${fmtN(d.kg)} kg`;
    h += `<tr><td style="color:#666;padding:2px 4px">${esc(quien)}</td><td style="padding:2px 4px">${esc(d.fecha || "")}</td><td style="text-align:right;padding:2px 4px">${valor}</td></tr>`;
  });
  h += '</table>';
  return h;
}

function popupStockOnline(i) {
  const r = window._rowsPedido[i];
  if (!r) return;

  const filas = [
    { label: "Conteo (Stock Inicial)", val: r.stockInicial, detalle: null },
    { label: "+ Compras", val: r.comprasUni, detalle: r.comprasDetalle, tipo: "compra" },
    { label: "+ Entregas PS", val: r.entUni, detalle: r.entDetalle, tipo: "ps" },
    { label: "− Envios a PS", val: r.envPSUni, detalle: r.envPSDetalle, tipo: "ps" },
    { label: "− Envios a Talleristas", val: r.envTallUni, detalle: r.envTallDetalle, tipo: "tall" }
  ];

  let html = '<table style="width:100%">';
  filas.forEach((f, idx) => {
    const clickable = f.detalle !== null;
    const cursor = clickable ? "cursor:pointer" : "";
    const toggle = clickable ? `onclick="document.getElementById('det_${idx}').style.display=document.getElementById('det_${idx}').style.display==='none'?'':'none'"` : "";
    const arrow = clickable && f.detalle.length ? ' <span style="font-size:10px;color:#999">▼</span>' : "";
    html += `<tr ${toggle} style="${cursor}"><td>${f.label}${arrow}</td><td style="text-align:right;font-weight:600">${fmtN(f.val)}</td></tr>`;
    if (clickable) {
      html += `<tr id="det_${idx}" style="display:none"><td colspan="2" style="padding:2px 8px;background:#f9f9f9;border-radius:6px">${buildDetRows(f.detalle, f.tipo)}</td></tr>`;
    }
  });
  html += `<tr style="border-top:2px solid #333"><td><b>= Stock Online</b></td><td style="text-align:right"><b>${fmtN(r.stockOnline)}</b></td></tr>`;
  html += '</table>';

  abrirPopup(`Stock Online — ${r.desc} (${r.sector})`, html);
}

function popupStockMax(i) {
  const r = window._rowsPedido[i];
  if (!r) return;
  abrirPopup(`Stock Max — ${r.desc}`,
    `<table>
      <tr><td>Consumo Mensual</td><td>${fmtN(r.consumoMes)}</td></tr>
      <tr><td>× Meses</td><td>${r._meses}</td></tr>
      <tr style="border-top:2px solid #333"><td><b>= Stock Max</b></td><td><b>${fmtN(r.stockMax)}</b></td></tr>
    </table>`
  );
}

function popupPedido(i) {
  const r = window._rowsPedido[i];
  if (!r) return;
  abrirPopup(`Pedido — ${r.desc}`,
    `<table>
      <tr><td>Stock Max</td><td>${fmtN(r.stockMax)}</td></tr>
      <tr><td>− Stock Online</td><td>${fmtN(r.stockOnline)}</td></tr>
      <tr><td>= Necesidad</td><td>${fmtN(r.stockMax - r.stockOnline)}</td></tr>
      <tr><td>Pedido Min</td><td>${fmtN(r.pedidoMin)}</td></tr>
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
    if (!grupos[r.prov]) grupos[r.prov] = { items: [], total: 0, meses: r._meses };
    grupos[r.prov].items.push(r);
    grupos[r.prov].total += r.pedido;
  });

  let tbody = "";
  let totalGeneral = 0;

  for (const [prov, data] of Object.entries(grupos)) {
    tbody += `<tr style="background:#e8eaed">
      <td colspan="2" style="font-weight:700;padding:6px 8px">${prov} (${data.meses} meses)</td>
      <td style="text-align:right;font-weight:700;padding:6px 8px">${data.total.toLocaleString("es-AR")}</td>
    </tr>`;
    data.items.forEach(r => {
      tbody += `<tr>
        <td style="padding:4px 8px">${r.desc}</td>
        <td style="padding:4px 8px;font-size:12px;color:#555">${r.stockOnline.toLocaleString("es-AR")} → ${r.stockMax.toLocaleString("es-AR")}</td>
        <td style="text-align:right;font-weight:700;padding:4px 8px">${r.pedido.toLocaleString("es-AR")}</td>
      </tr>`;
    });
    totalGeneral += data.total;
  }

  const htmlPDF = `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <title>Pedido Plásticos ${hoy}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:30px;color:#111;max-width:600px;margin:auto}
      h1{font-size:18px;margin:0 0 4px}
      .sub{font-size:13px;color:#555;margin-bottom:16px}
      table{width:100%;border-collapse:collapse;font-size:13px}
      td{border-bottom:1px solid #eee}
      .total{background:#111;color:#fff;font-weight:700;font-size:14px}
      .total td{padding:8px;border:none}
      @media print{body{padding:10px}}
    </style>
  </head><body>
    <h1>PEDIDO PARTES PLASTICAS</h1>
    <div class="sub">Fecha: ${hoy} · ${conPedido.length} partes</div>
    <table>
      <thead><tr style="border-bottom:2px solid #111">
        <th style="text-align:left;padding:6px 8px">Descripción</th>
        <th style="text-align:left;padding:6px 8px">Online → Max</th>
        <th style="text-align:right;padding:6px 8px">Pedido</th>
      </tr></thead>
      <tbody>${tbody}
        <tr class="total">
          <td colspan="2">TOTAL GENERAL</td>
          <td style="text-align:right">${totalGeneral.toLocaleString("es-AR")}</td>
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
