"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusEl = document.getElementById("status");
const tblBody = document.getElementById("tblBody");
const txtBuscar = document.getElementById("txtBuscar");
const selProv = document.getElementById("selProv");
const selStock = document.getElementById("selStock");
const selUnidad = document.getElementById("selUnidad");
const tblStockEl = document.getElementById("tblStock");

let pares = [];           // [{ baseSec, scData, spData, scStockUni, scStockKg, spStockUni, spStockKg, ... }]
let entregasPorSector = new Map();
let enviosPSPorSector = new Map();
let enviosTallPorSector = new Map();
let comprasPorCodVerif = new Map();

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function n(v) { return isNaN(v) ? 0 : Number(v); }
function normalizeText(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// Convertir SC sector a su "base" para emparejar con SP. Ej: V1C → V1, V13 → V13, S/S → S/S
function scToBase(sc) {
  const s = String(sc || "").trim();
  if (!s) return "";
  if (s === "S/S") return "S/S";
  // Si termina en C y la parte sin C es valida (no vacia), removerla
  if (s.endsWith("C") && s.length > 1) return s.slice(0, -1);
  return s;
}

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
    const [remSCRes, remSPRes, entregasPS, enviosPS, enviosTall, recepcionInsumos] = await Promise.all([
      sb.from("Remaches SC").select("*"),
      sb.from("Remaches SP").select("*"),
      fetchAll("Entregas PS"),
      fetchAll("Envios a PS"),
      fetchAll("Envios a Talleristas"),
      fetchAll("Recepcion_Insumos")
    ]);
    if (remSCRes.error) throw remSCRes.error;
    if (remSPRes.error) throw remSPRes.error;

    const scRows = (remSCRes.data || []).map(r => ({
      sector: String(r["SC"] || "").trim(),
      desc: r["Descripción"] || "",
      prov: r["Proveedor"] || "",
      stockInicial: n(r["Stock inicial"]),
      kgxUni: n(r["Kg x Uni"]),
      kgxBolsa: n(r["Kg x Bolsa"]),
      maxCajBolsa: n(r["Max Caj/Bolsa"]),
      piezaMadre: r["Pieza Madre"] || "",
      codVerif: String(r["cod_verificacion"] || "").trim()
    }));
    const spRows = (remSPRes.data || []).map(r => ({
      sector: String(r["SP"] || "").trim(),
      desc: r["Descripción"] || "",
      prov: r["Proveedor"] || "",
      stockInicial: n(r["Stock inicial"]),
      kgxUni: n(r["Kg x Uni"]),
      kgxBolsa: n(r["Kg x Bolsa"]),
      maxCajBolsa: n(r["Max Caj/Bolsa"]),
      piezaMadre: r["Pieza Madre"] || "",
      codVerif: String(r["cod_verificacion"] || "").trim()
    }));

    const sectoresRem = new Set([...scRows.map(r => r.sector), ...spRows.map(r => r.sector)].filter(Boolean));

    // Entregas PS: lo que devuelve un PS → entra al sector SP
    entregasPorSector = new Map();
    for (const e of entregasPS) {
      const sp = String(e["Sector SP"] || "").trim();
      if (!sp || !sectoresRem.has(sp)) continue;
      if (!entregasPorSector.has(sp)) entregasPorSector.set(sp, { kg: 0, uni: 0, detalle: [] });
      const m = entregasPorSector.get(sp);
      m.kg += n(e["KG"]); m.uni += n(e["Unidades"]);
      m.detalle.push({ ps: e["Prov_Serv"], fecha: e["Dia-mes"], kg: n(e["KG"]), uni: n(e["Unidades"]) });
    }

    // Envios a PS: sale del sector SC
    enviosPSPorSector = new Map();
    for (const e of enviosPS) {
      const sc = String(e["Sector SC"] || "").trim();
      if (!sc || !sectoresRem.has(sc)) continue;
      if (!enviosPSPorSector.has(sc)) enviosPSPorSector.set(sc, { kg: 0, uni: 0, detalle: [] });
      const m = enviosPSPorSector.get(sc);
      m.kg += n(e["KG"]); m.uni += n(e["Unidades"]);
      m.detalle.push({ ps: e["Prov_Serv"], fecha: e["Dia-mes"], kg: n(e["KG"]), uni: n(e["Unidades"]) });
    }

    // Envios a Talleristas: sale del sector hacia un tallerista
    enviosTallPorSector = new Map();
    for (const e of enviosTall) {
      const sec = String(e["Sector"] || "").trim();
      if (!sec || !sectoresRem.has(sec)) continue;
      if (!enviosTallPorSector.has(sec)) enviosTallPorSector.set(sec, { kg: 0, uni: 0, detalle: [] });
      const m = enviosTallPorSector.get(sec);
      m.kg += n(e["KG"]); m.uni += n(e["Unidades"]);
      m.detalle.push({ tall: e["Tallerista"], fecha: e["Dia-mes"], kg: n(e["KG"]), uni: n(e["Unidades"]) });
    }

    comprasPorCodVerif = new Map();
    for (const r of recepcionInsumos) {
      if (String(r.rubro || "").trim() !== "Remaches") continue;
      const cod = String(r.codigo || "").trim();
      if (!cod) continue;
      if (!comprasPorCodVerif.has(cod)) comprasPorCodVerif.set(cod, { cantidad: 0, detalle: [] });
      const m = comprasPorCodVerif.get(cod);
      m.cantidad += n(r.cantidad);
      m.detalle.push({ proveedor: r.proveedor, fecha: r.fecha, cantidad: n(r.cantidad), remito: r.remito });
    }

    // Calcular stock por sector individual (uni y kg)
    function calcStock(s) {
      if (!s) return { uni: 0, kg: 0, ent: null, envPS: null, envTall: null, compras: null };
      const ent = entregasPorSector.get(s.sector) || { kg: 0, uni: 0, detalle: [] };
      const envPS = enviosPSPorSector.get(s.sector) || { kg: 0, uni: 0, detalle: [] };
      const envTall = enviosTallPorSector.get(s.sector) || { kg: 0, uni: 0, detalle: [] };
      const compras = comprasPorCodVerif.get(s.codVerif) || { cantidad: 0, detalle: [] };
      const kgxUni = s.kgxUni;
      const entUni = kgxUni > 0 ? Math.round(ent.kg / kgxUni) : n(ent.uni);
      const envPSUni = kgxUni > 0 ? Math.round(envPS.kg / kgxUni) : n(envPS.uni);
      const envTallUni = kgxUni > 0 ? Math.round(envTall.kg / kgxUni) : n(envTall.uni);
      const comprasUni = n(compras.cantidad);
      const stockUni = s.stockInicial + comprasUni + entUni - envPSUni - envTallUni;
      const stockKg = kgxUni > 0 ? stockUni * kgxUni : 0;
      return { uni: stockUni, kg: stockKg, entUni, envPSUni, envTallUni, comprasUni,
               entDetalle: ent.detalle, envPSDetalle: envPS.detalle, envTallDetalle: envTall.detalle, comprasDetalle: compras.detalle };
    }

    // Emparejar: para cada SC, calcular su base. Para cada SP, su "base" es el sector mismo.
    // Si misma base existe en ambos, juntar. Si solo en uno, dejar el otro vacio.
    const map = new Map(); // base → { sc, sp }
    scRows.forEach(s => {
      const base = scToBase(s.sector);
      if (!map.has(base)) map.set(base, { sc: null, sp: null });
      map.get(base).sc = s;
    });
    spRows.forEach(s => {
      const base = s.sector; // SP no tiene C suffix
      if (!map.has(base)) map.set(base, { sc: null, sp: null });
      map.get(base).sp = s;
    });

    pares = [];
    for (const [base, par] of map.entries()) {
      const sc = par.sc, sp = par.sp;
      const scStock = calcStock(sc);
      const spStock = calcStock(sp);
      // Tomar descripcion/proveedor/kgxUni del que tenga datos (preferir SP, sino SC)
      const ref = sp || sc;
      pares.push({
        base,
        scSector: sc ? sc.sector : "S/S",
        spSector: sp ? sp.sector : "S/S",
        desc: ref.desc,
        prov: ref.prov,
        kgxUni: ref.kgxUni,
        scStockUni: scStock.uni, scStockKg: scStock.kg,
        spStockUni: spStock.uni, spStockKg: spStock.kg,
        sc, sp, scStock, spStock
      });
    }

    // Ordenar: por sector base alfabeticamente
    pares.sort((a, b) => (a.base || "").localeCompare(b.base || "", "es"));

    // Filtro proveedores
    const provs = [...new Set(pares.map(p => p.prov).filter(Boolean))].sort();
    provs.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p; opt.textContent = p;
      selProv.appendChild(opt);
    });

    aplicarFiltros();
    statusEl.textContent = `${pares.length} remaches`;
  } catch (err) {
    statusEl.textContent = "Error: " + err.message;
    console.error("Init error:", err);
  }
}

/* ================= FILTROS ================= */
function aplicarFiltros() {
  const q = normalizeText(txtBuscar.value);
  const provFiltro = selProv.value;
  const stockFiltro = selStock.value;

  const filtradas = pares.filter(r => {
    if (q) {
      const match = normalizeText(r.desc).includes(q) || normalizeText(r.prov).includes(q)
                 || normalizeText(r.scSector).includes(q) || normalizeText(r.spSector).includes(q);
      if (!match) return false;
    }
    if (provFiltro !== "todos" && r.prov !== provFiltro) return false;
    if (stockFiltro === "conStock" && r.scStockUni <= 0 && r.spStockUni <= 0) return false;
    if (stockFiltro === "sinStock" && (r.scStockUni > 0 || r.spStockUni > 0)) return false;
    return true;
  });

  renderTabla(filtradas);
}

txtBuscar.addEventListener("input", aplicarFiltros);
selProv.addEventListener("change", aplicarFiltros);
selStock.addEventListener("change", aplicarFiltros);
selUnidad.addEventListener("change", aplicarUnidad);

function aplicarUnidad() {
  tblStockEl.classList.remove("unidad-uni", "unidad-kg", "unidad-cajbol");
  const v = selUnidad.value;
  if (v === "uni") tblStockEl.classList.add("unidad-uni");
  else if (v === "kg") tblStockEl.classList.add("unidad-kg");
  else if (v === "cajbol") tblStockEl.classList.add("unidad-cajbol");
  // Colspan de SC/SP según columnas visibles:
  //   Todo: uni + kg = 2
  //   Uni o Kg o Cajbol: 1 col visible cada uno = 1
  const cs = (v === "todo") ? 2 : 1;
  const thSC = document.getElementById("thSC");
  const thSP = document.getElementById("thSP");
  if (thSC) thSC.setAttribute("colspan", cs);
  if (thSP) thSP.setAttribute("colspan", cs);
}

/* ================= RENDER ================= */
function renderTabla(rows) {
  window._lastRows = rows;
  let html = "";

  rows.forEach((r, i) => {
    const kgUni = r.kgxUni ? r.kgxUni.toFixed(4) : "-";
    // Cajones SC: 25 kg fijo
    const cajonesSC = r.sc ? (r.scStockKg / 25).toFixed(1) : "0";
    // Bolsas SP: usa Kg x Bolsa de la BD (varía 2 ó 10 según artículo)
    const kgBolsaSP = r.sp ? n(r.sp.kgxBolsa) : 0;
    const bolsasSP = (r.sp && kgBolsaSP > 0) ? `${(r.spStockKg / kgBolsaSP).toFixed(1)} <span style="font-size:11px;color:#666">(${kgBolsaSP}kg)</span>` : "0";
    html += `<tr>
      <td class="col-sector">${esc(r.scSector)}</td>
      <td class="col-sector">${esc(r.spSector)}</td>
      <td class="col-desc" title="${esc(r.desc)}">${esc(r.desc)}</td>
      <td class="col-marca">${esc(r.prov)}</td>
      <td class="col-number">${kgUni}</td>
      <td class="col-number td-scu ${r.sc ? 'col-clickable' : ''}" ${r.sc ? `onclick="popupSC(${i})"` : ''}>${r.sc ? r.scStockUni.toLocaleString("es-AR") : "0"}</td>
      <td class="col-number td-sck">${r.sc ? r.scStockKg.toFixed(2) : "0"}</td>
      <td class="col-number td-scc">${cajonesSC}</td>
      <td class="col-number td-spu ${r.sp ? 'col-clickable' : ''}" ${r.sp ? `onclick="popupSP(${i})"` : ''}>${r.sp ? r.spStockUni.toLocaleString("es-AR") : "0"}</td>
      <td class="col-number td-spk">${r.sp ? r.spStockKg.toFixed(2) : "0"}</td>
      <td class="col-number td-spb">${bolsasSP}</td>
    </tr>`;
  });

  tblBody.innerHTML = html || `<tr><td colspan="11" class="empty">No hay remaches</td></tr>`;
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
    const valor = tipo === "compra" ? `${fmtN(d.cantidad)} uni` : `${fmtN(d.kg)} kg / ${fmtN(d.uni || 0)} uni`;
    h += `<tr><td style="color:#666;padding:2px 4px">${esc(quien)}</td><td style="padding:2px 4px">${esc(d.fecha || "")}</td><td style="text-align:right;padding:2px 4px">${valor}</td></tr>`;
  });
  h += '</table>';
  return h;
}

function popupSC(i) { popupStock("SC", i); }
function popupSP(i) { popupStock("SP", i); }

function popupStock(tipo, i) {
  const r = window._lastRows[i];
  if (!r) return;
  const s = tipo === "SC" ? r.sc : r.sp;
  const sk = tipo === "SC" ? r.scStock : r.spStock;
  if (!s) return;

  const filas = [
    { label: "Conteo (Stock Inicial)", val: s.stockInicial, detalle: null },
    { label: "+ Compras", val: sk.comprasUni, detalle: sk.comprasDetalle, tipo: "compra" },
    { label: "+ Entregas PS", val: sk.entUni, detalle: sk.entDetalle, tipo: "ps" },
    { label: "− Envios a PS", val: sk.envPSUni, detalle: sk.envPSDetalle, tipo: "ps" },
    { label: "− Envios a Talleristas", val: sk.envTallUni, detalle: sk.envTallDetalle, tipo: "tall" }
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
  html += `<tr style="border-top:2px solid #333"><td><b>= Stock Online (uni)</b></td><td style="text-align:right"><b>${fmtN(sk.uni)}</b></td></tr>`;
  if (s.kgxUni > 0) {
    html += `<tr><td>= Stock Online (kg)</td><td style="text-align:right">${sk.kg.toFixed(2)}</td></tr>`;
  }
  html += '</table>';

  abrirPopup(`Stock ${tipo} — ${r.desc} (${s.sector})`, html);
}

/* ================= START ================= */
init();
