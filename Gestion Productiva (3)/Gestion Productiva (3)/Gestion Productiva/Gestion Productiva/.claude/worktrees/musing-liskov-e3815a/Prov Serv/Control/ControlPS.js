const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/*************************************************
 * TABLAS
 *************************************************/
const TABLA_PARTES = "Partes x PS";
const TABLA_SP_KG = "SP Kg";
const TABLA_ENVIOS_PS = "Envios a PS";
const TABLA_ENTREGAS_PS = "Entregas PS";
const TABLA_ENVIOS_TALLERISTAS = "Envios a Talleristas";
const TABLA_SC_KG = "SC Kg";

/*************************************************
 * DOM
 *************************************************/
const grid = document.getElementById("talleristasGrid");
const resultEl = document.getElementById("result");
const statusEl = document.getElementById("status");
const btnVolver = document.getElementById("btnVolver");
const btnIndex = document.getElementById("btnIndex");

/*************************************************
 * STATE
 *************************************************/
let partesCache = null;
let spKgCache = null;
let enviosPSCache = null;
let entregasPSCache = null;
let enviosTalleristasCache = null;
let scKgCache = null;
let listaPS = [];
let psActivo = "";
let ordenActual = "SC"; // "SC" o "SP"
let cacheTimestamp = 0; // Fuerza recarga cada X tiempo

/*************************************************
 * HELPERS
 *************************************************/
function setStatus(t){ statusEl.textContent = t || ""; }

function escapeHtml(s){
  return String(s || "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function pick(o,k){
  for(const key of k){
    if(o && key in o) return o[key];
  }
  return "";
}

function num(n){ return Number(n || 0); }

function formatNumber(n){
  return Number(n || 0).toLocaleString("es-AR");
}

function formatDecimal(n){
  let value = Number(n || 0);

  return value.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
}

function formatCajones(n){
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

function formatKgOnline(n){
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

btnIndex.onclick = ()=>{
  window.location.href = "../../Inicio/index.html";
};

function normalizeText(value){
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function parseDecimal(value){
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number"){
    return Number.isFinite(value) ? value : 0;
  }

  let s = String(value).trim();
  if (!s || s === "-" || s === "—") return 0;

  s = s.replace(/[^\d,.-]/g, "");

  if (s.includes(",") && !s.includes(".")){
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/*************************************************
 * CARGA LISTA PS
 *************************************************/
async function cargarPS(){
  const { data, error } = await supabaseClient.from(TABLA_PARTES).select("PS");

  if (error){
    console.error(error);
    setStatus("Error al cargar proveedores");
    return;
  }

  listaPS = [...new Set((data || []).map(x => x.PS).filter(Boolean))].sort();

  grid.innerHTML = "";
  listaPS.forEach(ps=>{
    const b = document.createElement("button");
    b.className = "tallerista-btn";
    b.textContent = ps;
    b.onclick = ()=>seleccionar(ps);
    grid.appendChild(b);
  });

  setStatus("Seleccioná un proveedor");
}

/*************************************************
 * CACHE
 *************************************************/
async function cargarPartes(){
  if(partesCache) return partesCache;

  const { data, error } = await supabaseClient.from(TABLA_PARTES).select("*");

  if (error){
    console.error(error);
    throw new Error("Error al leer Partes x PS");
  }

  partesCache = data || [];
  return partesCache;
}

async function cargarSPKG(){
  // Refrescar caché cada 2 minutos para capturar nuevos registros
  const now = Date.now();
  if (spKgCache && (now - cacheTimestamp) < 120000) return spKgCache;

  const { data, error } = await supabaseClient.from(TABLA_SP_KG).select("*");

  if (error){
    console.error(error);
    throw new Error("Error al leer SP Kg");
  }

  const map = new Map();

  (data || []).forEach(r => {
    const key = String(r.Sp || r.SP || "").trim().toLowerCase();
    if (!key) return;

    map.set(key, {
      kgUni: parseDecimal(pick(r, [
        "Kg X Uni",
        "Kg x UNI",
        "Kg x Uni",
        "kg x uni",
        "Kg x UN",
        "Kg Uni"
      ])),
      kgCaj: parseDecimal(pick(r, [
        "KG Cajon",
        "KG x Cajon",
        "kg cajon",
        "kg x cajon"
      ])),
      stockInicial: parseDecimal(pick(r, [
        "Stock Inicial",
        "Stock inicial",
        "STOCK INICIAL",
        "StockInicial",
        "Stock_Inicial",
        "Stock Ini",
        "Stock"
      ])),
      maxCajonSPTotal: parseDecimal(pick(r, [
        "Max Cajon SP Total",
        "MaxCajonSPTotal",
        "Max Cajon",
        "Max Caj"
      ]))
    });
  });

  spKgCache = map;
  cacheTimestamp = Date.now();
  return map;
}

async function cargarSCKG(){
  // Refrescar caché cada 2 minutos para capturar nuevos registros
  const now = Date.now();
  if (scKgCache && (now - cacheTimestamp) < 120000) return scKgCache;

  const { data, error } = await supabaseClient.from(TABLA_SC_KG).select("*");

  if (error){
    console.error(error);
    throw new Error("Error al leer SC Kg");
  }

  const map = new Map();

  (data || []).forEach(r => {
    const key = String(r.SC || "").trim().toLowerCase();
    if (!key) return;

    map.set(key, {
      kgUni: parseDecimal(pick(r, [
        "Kg X Uni",
        "Kg x UNI",
        "Kg x Uni",
        "kg x uni",
        "Kg x UN",
        "Kg Uni"
      ])),
      kgCaj: parseDecimal(pick(r, [
        "KG x Cajon",
        "KG Cajon",
        "KG x Cajon",
        "kg cajon",
        "kg x cajon"
      ])),
      stockInicial: parseDecimal(pick(r, [
        "Stock Inicial",
        "Stock inicial",
        "STOCK INICIAL",
        "StockInicial",
        "Stock_Inicial",
        "Stock Ini",
        "Stock"
      ])),
      maxCajonSPTotal: 0
    });
  });

  scKgCache = map;
  cacheTimestamp = Date.now();
  return map;
}

let plasticasCache = null;
async function cargarPlasticas(){
  if (plasticasCache) return plasticasCache;
  const { data, error } = await supabaseClient.from("Partes_Plasticas").select("*");
  if (error){ console.error(error); plasticasCache = new Map(); return plasticasCache; }
  const map = new Map();
  (data || []).forEach(r => {
    const key = String(r.Sector || "").trim().toLowerCase();
    if (!key) return;
    const kgUni = parseDecimal(r.Kg_x_Uni);
    const uniBolsa = parseDecimal(r.Uni_x_Bolsa);
    map.set(key, {
      kgUni: kgUni,
      kgCaj: kgUni && uniBolsa ? kgUni * uniBolsa : 0,
      stockInicial: parseDecimal(r.Stock_Inicial),
      maxCajonSPTotal: 0
    });
  });
  plasticasCache = map;
  return map;
}

async function cargarEnviosPS(){
  if(enviosPSCache) return enviosPSCache;

  const { data, error } = await supabaseClient
    .from(TABLA_ENVIOS_PS)
    .select("*");

  if (error){
    console.error(error);
    throw new Error("Error al leer Envios a PS");
  }

  const detalleMap = new Map();
  const totalKgMap = new Map();
  const totalCajMap = new Map();

  (data || []).forEach(r=>{
    const provServ = normalizeText(pick(r, ["Prov_Serv", "Prov Serv", "prov_serv"]));
    const sectorSP = normalizeText(pick(r, ["Sector SP", "Sector_SP", "sector sp", "sector_sp"]));
    const sectorSC = normalizeText(pick(r, ["Sector SC", "Sector_SC", "sector sc", "sector_sc"]));
    const parte = normalizeText(pick(r, ["Parte", "parte"]));

    const fecha = String(pick(r, ["Dia-mes", "Dia_mes", "dia-mes", "dia_mes"]) || "").trim();
    const kg = parseDecimal(pick(r, ["KG", "Kg", "kg"]));
    const cajones = parseDecimal(pick(r, ["Cajones", "cajones", "CAJONES"]));

    if (!provServ) return;
    if (!kg && !cajones) return;

    // Clave unica: SC+SP+Parte para maxima precision, con fallbacks
    let key;
    if (sectorSC && sectorSP) key = `${provServ}__${sectorSC}__${sectorSP}__${parte}`;
    else if (sectorSP) key = `${provServ}__sp__${sectorSP}__${parte}`;
    else if (sectorSC) key = `${provServ}__sc__${sectorSC}__${parte}`;
    else if (parte) key = `${provServ}__parte__${parte}`;
    else return;

    if (!detalleMap.has(key)) detalleMap.set(key, []);
    detalleMap.get(key).push({ id: r.id, fecha, kg, cajones });
    totalKgMap.set(key, (totalKgMap.get(key) || 0) + kg);
    totalCajMap.set(key, (totalCajMap.get(key) || 0) + cajones);
  });

  enviosPSCache = {
    detalleMap,
    totalKgMap,
    totalCajMap
  };

  return enviosPSCache;
}

async function cargarEntregasPS(){
  if(entregasPSCache) return entregasPSCache;

  const { data, error } = await supabaseClient
    .from(TABLA_ENTREGAS_PS)
    .select("*");

  if (error){
    console.error(error);
    throw new Error("Error al leer Entrega a PS");
  }

  const detalleMap = new Map();
  const totalKgMap = new Map();
  const totalCajMap = new Map();

  (data || []).forEach(r=>{
    const provServ = normalizeText(pick(r, ["Prov_Serv", "Prov Serv", "prov_serv"]));
    const sectorSP = normalizeText(pick(r, ["Sector SP", "Sector_SP", "sector sp", "sector_sp"]));
    const sectorSC = normalizeText(pick(r, ["Sector SC", "Sector_SC", "sector sc", "sector_sc"]));
    const parte = normalizeText(pick(r, ["Parte", "parte"]));

    const fecha = String(pick(r, ["Dia-mes", "Dia_mes", "dia-mes", "dia_mes"]) || "").trim();
    const kg = parseDecimal(pick(r, ["KG", "Kg", "kg"]));
    const cajones = parseDecimal(pick(r, ["Cajones", "cajones", "CAJONES"]));

    if (!provServ) return;
    if (!kg && !cajones) return;

    let key;
    if (sectorSC && sectorSP) key = `${provServ}__${sectorSC}__${sectorSP}__${parte}`;
    else if (sectorSP) key = `${provServ}__sp__${sectorSP}__${parte}`;
    else if (sectorSC) key = `${provServ}__sc__${sectorSC}__${parte}`;
    else if (parte) key = `${provServ}__parte__${parte}`;
    else return;

    if (!detalleMap.has(key)) detalleMap.set(key, []);
    detalleMap.get(key).push({ fecha, kg, cajones });
    totalKgMap.set(key, (totalKgMap.get(key) || 0) + kg);
    totalCajMap.set(key, (totalCajMap.get(key) || 0) + cajones);
  });

  entregasPSCache = {
    detalleMap,
    totalKgMap,
    totalCajMap
  };

  return entregasPSCache;
}

async function cargarEnviosTalleristas(){
  if(enviosTalleristasCache) return enviosTalleristasCache;

  const { data, error } = await supabaseClient
    .from(TABLA_ENVIOS_TALLERISTAS)
    .select("*");

  if (error){
    console.error(error);
    throw new Error("Error al leer Envios a Talleristas");
  }

  const detalleMap = new Map();
  const totalKgMap = new Map();

  (data || []).forEach(r=>{
    const sectorSP = normalizeText(pick(r, [
      "Sector SP",
      "Sector_SP",
      "sector sp",
      "sector_sp",
      "SP",
      "Sp",
      "Sector"
    ]));
    const fecha = String(pick(r, ["Dia-mes", "Dia_mes", "dia-mes", "dia_mes"]) || "").trim();
    const kg = parseDecimal(pick(r, ["KG", "Kg", "kg"]));

    if (!sectorSP) return;
    if (!kg) return;

    if (!detalleMap.has(sectorSP)) detalleMap.set(sectorSP, []);
    detalleMap.get(sectorSP).push({ fecha, kg });

    totalKgMap.set(sectorSP, (totalKgMap.get(sectorSP) || 0) + kg);
  });

  enviosTalleristasCache = {
    detalleMap,
    totalKgMap
  };

  return enviosTalleristasCache;
}

function obtenerEnviosPS(ps, sp, parte, enviosData, kgXUni, sc){
  const psNorm = normalizeText(ps);
  const parteNorm = normalizeText(parte);
  const compKey = (sc && sp) ? `${psNorm}__${normalizeText(sc)}__${normalizeText(sp)}__${parteNorm}` : "";
  const spKey = sp ? `${psNorm}__sp__${normalizeText(sp)}__${parteNorm}` : "";
  const scKey = sc ? `${psNorm}__sc__${normalizeText(sc)}__${parteNorm}` : "";
  const parteKey = parte ? `${psNorm}__parte__${parteNorm}` : "";
  const has = k => k && (enviosData.totalKgMap.has(k) || enviosData.totalCajMap.has(k));
  const key = has(compKey) ? compKey : has(scKey) ? scKey : has(spKey) ? spKey : has(parteKey) ? parteKey : compKey || scKey || spKey || parteKey;

  const totalKg = Number(enviosData.totalKgMap.get(key) || 0);
  const totalCaj = Number(enviosData.totalCajMap.get(key) || 0);
  const totalUni = kgXUni > 0 ? Math.floor(totalKg / kgXUni) : 0;
  const detalleBase = enviosData.detalleMap.get(key) || [];

  const detalle = detalleBase.map(x => {
    const unidades = kgXUni > 0 ? Math.floor(Number(x.kg || 0) / kgXUni) : 0;
    return {
      fecha: x.fecha,
      kg: x.kg,
      cajones: x.cajones,
      unidades
    };
  });

  return {
    totalKg,
    totalCaj,
    totalUni,
    detalle
  };
}

function obtenerEntregasPS(ps, sp, parte, entregasData, kgXUni, sc){
  const psNorm = normalizeText(ps);
  const parteNorm = normalizeText(parte);
  const compKey = (sc && sp) ? `${psNorm}__${normalizeText(sc)}__${normalizeText(sp)}__${parteNorm}` : "";
  const spKey = sp ? `${psNorm}__sp__${normalizeText(sp)}__${parteNorm}` : "";
  const scKey = sc ? `${psNorm}__sc__${normalizeText(sc)}__${parteNorm}` : "";
  const parteKey = parte ? `${psNorm}__parte__${parteNorm}` : "";
  const has = k => k && (entregasData.totalKgMap.has(k) || entregasData.totalCajMap.has(k));
  const key = has(compKey) ? compKey : has(scKey) ? scKey : has(spKey) ? spKey : has(parteKey) ? parteKey : compKey || scKey || spKey || parteKey;

  const totalKg = Number(entregasData.totalKgMap.get(key) || 0);
  const totalCaj = Number(entregasData.totalCajMap.get(key) || 0);
  // Si hay KG y kgXUni, calcular unidades desde KG. Si no, cajones contiene las unidades directas.
  const totalUni = kgXUni > 0 ? Math.floor(totalKg / kgXUni) : (totalKg === 0 ? totalCaj : 0);

  const detalleBase = entregasData.detalleMap.get(key) || [];

  const detalle = detalleBase.map(x => {
    const xkg = Number(x.kg || 0);
    const unidades = kgXUni > 0 ? Math.floor(xkg / kgXUni) : (xkg === 0 ? Number(x.cajones || 0) : 0);
    return {
      id: x.id,
      fecha: x.fecha,
      kg: x.kg,
      cajones: x.cajones,
      unidades
    };
  });

  return {
    totalKg,
    totalCaj,
    totalUni,
    detalle
  };
}

/*************************************************
 * SELECCION
 *************************************************/
async function seleccionar(ps){
  psActivo = ps;
  btnVolver.classList.remove("hidden");

  document.querySelectorAll(".tallerista-btn").forEach(b=>{
    b.classList.toggle("active", b.textContent === ps);
  });

  let partes, spKg, scKg, plasticas, enviosData, entregasData, enviosTallData;

  try{
    [partes, spKg, scKg, plasticas, enviosData, entregasData, enviosTallData] = await Promise.all([
      cargarPartes(),
      cargarSPKG(),
      cargarSCKG(),
      cargarPlasticas(),
      cargarEnviosPS(),
      cargarEntregasPS(),
      cargarEnviosTalleristas()
    ]);
  }catch(err){
    console.error(err);
    setStatus(err.message || "Error al cargar datos");
    return;
  }

  const filas = partes.filter(x => x.PS === ps).sort((a, b) => {
    if (ordenActual === "SP") {
      const spA = String(a.SP || a.Sp || "").toLowerCase();
      const spB = String(b.SP || b.Sp || "").toLowerCase();
      return spA.localeCompare(spB);
    }
    const scA = String(a.SC || a.Sc || "").toLowerCase();
    const scB = String(b.SC || b.Sc || "").toLowerCase();
    return scA.localeCompare(scB);
  });

  // Agrupar filas por SC (solo si tienen SC, sino cada una es su propio grupo)
  // Si ordenamos por SP, cada fila es su propio grupo (sin rowspan)
  const gruposSC = new Map();
  let sinSCIdx = 0;
  filas.forEach(item => {
    if (ordenActual === "SP") {
      gruposSC.set(`__solo_${sinSCIdx++}`, [item]);
    } else {
      const sc = String(item.SC || item.Sc || "").trim();
      if (!sc || sc.toUpperCase() === "ST") {
        gruposSC.set(`__solo_${sinSCIdx++}`, [item]);
      } else {
        if (!gruposSC.has(sc)) gruposSC.set(sc, []);
        gruposSC.get(sc).push(item);
      }
    }
  });

  let rows = "";

  for (const [sc, grupo] of gruposSC.entries()) {
    // Datos compartidos del SC (usar primer item para info SC)
    const firstItem = grupo[0];
    const scKey = sc.toLowerCase();
    // Buscar peso: primero en SP Kg (sector procesado), luego SC Kg (crudo), luego plasticas
    const firstSP = String(firstItem.SP || firstItem.Sp || "").trim().toLowerCase();
    let scInfo = spKg.get(firstSP) || spKg.get(scKey) || scKg.get(scKey);
    if (!scInfo || !scInfo.kgUni) scInfo = plasticas.get(firstSP) || plasticas.get(scKey) || scInfo;
    if (!scInfo) scInfo = { kgUni: 0, kgCaj: 0, stockInicial: 0, maxCajonSPTotal: 0 };

    const scKgUni = Number(scInfo.kgUni || 0);
    const scKgCaj = Number(scInfo.kgCaj || 0);

    // Envios se calculan por SC (compartido) - usar SC real del item, no la clave de agrupación
    const scReal = String(firstItem.SC || firstItem.Sc || "").trim();
    const enviosInfo = obtenerEnviosPS(
      ps,
      firstItem.SP || firstItem.Sp || "",
      firstItem.Parte || "",
      enviosData,
      scKgUni,
      scReal
    );

    // Procesar cada sub-fila para entregas individuales, agrupando por SP para combinar variantes
    let rawSubFilas = grupo.map(item => {
      const spKey = String(item.SP || item.Sp || "").trim().toLowerCase();
      let info = spKg.get(spKey) || scKg.get(scKey);
      if (!info || !info.kgUni) info = plasticas.get(spKey) || plasticas.get(scKey) || info;
      if (!info || !info.kgUni) {
        const itemKg = parseDecimal(item["KG x Uni"]);
        const itemKgCaj = parseDecimal(item["KG x Cajon"]);
        if (itemKg) info = { kgUni: itemKg, kgCaj: itemKgCaj || 0, stockInicial: (info && info.stockInicial) || 0, maxCajonSPTotal: 0 };
      }
      if (!info) info = { kgUni: 0, kgCaj: 0, stockInicial: 0, maxCajonSPTotal: 0 };

      const entregasInfo = obtenerEntregasPS(
        ps,
        item.SP || item.Sp || "",
        item.Parte || "",
        entregasData,
        info.kgUni,
        item.SC || item.Sc || ""
      );

      const popupEntregasItems = entregasInfo.detalle.length
        ? entregasInfo.detalle
            .map(x => {
              if (x.kg > 0) {
                return `${x.id}::${x.fecha} - ${formatDecimal(x.kg)} kg - ${formatCajones(x.cajones)} caj - ${formatNumber(x.unidades)} uni`;
              }
              return `${x.id}::${x.fecha} - ${formatNumber(x.cajones)} uni`;
            })
            .join("|")
        : "Sin entregas";

      return { item, info, entregasInfo, popupEntregasItems };
    });

    // Agrupar subFilas por SP: si múltiples partes comparten SP, fusionarlas
    const subFilasPorSP = new Map();
    rawSubFilas.forEach(sf => {
      const sp = String(sf.item.SP || sf.item.Sp || "").trim();
      if (!subFilasPorSP.has(sp)) subFilasPorSP.set(sp, []);
      subFilasPorSP.get(sp).push(sf);
    });

    const subFilas = [];
    for (const [sp, itemsParaSP] of subFilasPorSP.entries()) {
      if (itemsParaSP.length === 1) {
        subFilas.push(itemsParaSP[0]);
      } else {
        // Múltiples partes mismo SP: extraer variantes (LK/CH) y combinar entregas
        const firstSF = itemsParaSP[0];
        const variantes = itemsParaSP
          .map(sf => {
            const parte = String(sf.item.Parte || "").trim();
            const match = parte.match(/\b(LK|CH)\b/i);
            return match ? match[1].toUpperCase() : parte;
          })
          .filter((v, i, a) => a.indexOf(v) === i)
          .join("/");

        // Extraer base del nombre (sin LK/CH)
        const baseParte = String(firstSF.item.Parte || "").trim().replace(/\s+(LK|CH|lk|ch)\s*$/i, "").trim();
        const descripcionFusionada = baseParte + (variantes ? " " + variantes : "");

        // Sumar entregas de todas las partes
        let totalEntKg = 0, entDetalles = [];
        itemsParaSP.forEach(sf => {
          totalEntKg += Number(sf.entregasInfo.totalKg || 0);
          entDetalles = entDetalles.concat(sf.entregasInfo.detalle || []);
        });
        const totalEntUni = firstSF.info.kgUni > 0
          ? Math.floor(totalEntKg / firstSF.info.kgUni)
          : (totalEntKg === 0 ? entDetalles.reduce((s, d) => s + Number(d.cajones || 0), 0) : 0);

        const entPopupItems = entDetalles.length
          ? entDetalles.map(x => `${x.id}::${x.fecha} - ${x.kg > 0 ? formatDecimal(x.kg) + " kg - " + formatCajones(x.cajones) + " caj" : formatNumber(x.cajones) + " uni"}`).join("|")
          : "Sin entregas";

        subFilas.push({
          item: { ...firstSF.item, Parte: descripcionFusionada },
          info: firstSF.info,
          entregasInfo: { totalKg: totalEntKg, totalCaj: 0, totalUni: totalEntUni, detalle: entDetalles },
          popupEntregasItems: entPopupItems
        });
      }
    }

    // Sumar todas las entregas del grupo para el calculo de Online
    let totalEntregasKg = 0;
    subFilas.forEach(sf => { totalEntregasKg += Number(sf.entregasInfo.totalKg || 0); });

    const onlinePSKg = Number(enviosInfo.totalKg || 0) - totalEntregasKg;
    const onlinePSCaj = scKgCaj > 0 ? (onlinePSKg / scKgCaj) : 0;
    const onlinePSUni = scKgUni > 0 ? Math.floor(onlinePSKg / scKgUni) : 0;

    const stockInicial = Number(scInfo.stockInicial || 0);

    // Sumar max cajones, stock inicial y online cajones de todos los SP del grupo
    let maxCajonSPTotal = 0;
    let stockIniCajTotal = 0;
    let onlineSPCajTotal = 0;
    const enviarDesglose = [];
    subFilas.forEach(sf => {
      const sp = String(sf.item.SP || sf.item.Sp || "").trim();
      const spKey = normalizeText(sp);
      const spInfo = spKg.get(spKey) || scKg.get(spKey) || plasticas.get(spKey);
      const spMax = Number((spInfo && spInfo.maxCajonSPTotal) || 0);
      const spStockIni = Number((spInfo && spInfo.stockInicial) || 0);
      const spStockIniCaj = scKgCaj > 0 ? (spStockIni / scKgCaj) : 0;
      maxCajonSPTotal += spMax;
      stockIniCajTotal += spStockIniCaj;
      const spEntregasKg = Number(entregasData.totalKgMap.get(`${normalizeText(ps)}__${spKey}`) || 0);
      const spEnviosTallKg = Number(enviosTallData.totalKgMap.get(spKey) || 0);
      const spOnlineKg = spStockIni + spEntregasKg - spEnviosTallKg;
      const spOnlineCaj = scKgCaj > 0 ? (spOnlineKg / scKgCaj) : 0;
      onlineSPCajTotal += spOnlineCaj;
      enviarDesglose.push({ sp, parte: sf.item.Parte || "", max: spMax, stockIniCaj: spStockIniCaj, online: spOnlineCaj });
    });

    let enviarTotal = 0;
    enviarDesglose.forEach(d => {
      d.enviar = Math.max(0, d.max - d.stockIniCaj - d.online);
      enviarTotal += d.enviar;
    });
    const enviar = Math.ceil(enviarTotal);

    const popupEnviarItems = enviarDesglose.map(d =>
      `${d.sp} (${d.parte}): (Max ${d.max} - StockIni ${formatCajones(d.stockIniCaj)}) - Online ${formatCajones(d.online)} = ${formatCajones(d.enviar)}`
    ).join("|") + "|---|TOTAL: " + enviar + " cjn";

    const popupEnviosItems = enviosInfo.detalle.length
      ? enviosInfo.detalle
          .map(x => `${x.fecha} - ${formatDecimal(x.kg)} kg - ${formatCajones(x.cajones)} caj - ${formatNumber(x.unidades)} uni`)
          .join("|")
      : "Sin envíos";

    const rowspan = grupo.length;
    const rs = rowspan > 1 ? ` rowspan="${rowspan}"` : "";
    const vAlign = rowspan > 1 ? ' style="vertical-align:middle"' : "";

    subFilas.forEach((sf, idx) => {
      const codProvVal = escapeHtml(sf.item.Cod_Prov_Externo || "");

      rows += `<tr>`;

      // Columnas compartidas solo en la primera fila del grupo
      if (idx === 0) {
        rows += `
        <td${rs}${vAlign}>${escapeHtml(sc.startsWith("__solo_") ? (firstItem.SC || firstItem.Sc || "") : sc)}</td>`;
      }

      // Columnas individuales: SP y Descripcion
      rows += `
        <td>${escapeHtml(sf.item.SP || sf.item.Sp || "")}</td>
        <td>${escapeHtml(sf.item.Parte || "")}</td>`;

      // Columnas compartidas: Online, Enviar, Envios, Info
      if (idx === 0) {
        rows += `
        <td${rs}${vAlign}>${formatKgOnline(onlinePSKg)}</td>
        <td${rs}${vAlign}>${formatCajones(onlinePSCaj)}</td>
        <td${rs}${vAlign}>${formatNumber(onlinePSUni)}</td>

        <td${rs}${vAlign} class="center">
          <div class="cell-combo">
            <span class="cell-total">${formatCajones(enviar)}</span>
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Cjn a Enviar - ${firstItem.Parte || sc}`)}"
              data-popup-items="${escapeHtml(popupEnviarItems)}"
            >+</button>
          </div>
        </td>

        <td${rs}${vAlign} class="center">
          <div class="cell-combo">
            <span class="cell-total">${formatNumber(enviosInfo.totalUni || 0)}</span>
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Envíos - ${firstItem.Parte || ""}`)}"
              data-popup-items="${escapeHtml(popupEnviosItems)}"
            >+</button>
          </div>
        </td>`;
      }

      // Columna individual: Entregas
      rows += `
        <td class="center">
          <div class="cell-combo">
            <span class="cell-total">${formatNumber(sf.entregasInfo.totalUni || 0)}</span>
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Entregas - ${sf.item.Parte || ""}`)}"
              data-popup-items="${escapeHtml(sf.popupEntregasItems)}"
            >+</button>
          </div>
        </td>`;

      // Columnas compartidas: Info
      if (idx === 0) {
        rows += `
        <td${rs}${vAlign}>${formatDecimal(scKgUni)}</td>
        <td${rs}${vAlign}>${formatDecimal(scKgCaj)}</td>
        <td${rs}${vAlign}>${formatNumber(stockInicial)}</td>`;
      }

      // Columna individual: Cod Prov
      rows += `
        <td class="cod-prov-cell">
          <input type="text" class="cod-prov-input" value="${codProvVal}" data-id="${sf.item.id}" placeholder="-" />
        </td>
      </tr>`;
    });
  }

  resultEl.innerHTML = `
    <div class="articulo">
      <div class="articulo-header">${ps}</div>

      <table class="table">
        <thead>
          <tr>
            <th colspan="3">Base</th>
            <th colspan="3">Online</th>
            <th>Enviar</th>
            <th colspan="2">Movimientos Uni</th>
            <th colspan="3">Info</th>
            <th></th>
          </tr>
          <tr>
            <th class="th-sort" data-sort="SC" style="cursor:pointer">SC ${ordenActual === "SC" ? "▼" : ""}</th>
            <th class="th-sort" data-sort="SP" style="cursor:pointer">SP ${ordenActual === "SP" ? "▼" : ""}</th>
            <th>Descripción</th>

            <th>Kg</th>
            <th>Caj</th>
            <th>Uni</th>

            <th>Cjn</th>

            <th>Env</th>
            <th>Ent</th>

            <th>Kg x Uni</th>
            <th>Kg x Caj</th>
            <th>Stock Inicial</th>
            <th>Cod Prov</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
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
  const popupTitle = document.getElementById("popupTitle");
  const popupBody = document.getElementById("popupBody");
  const popupClose = document.getElementById("popupClose");

  resultEl.querySelectorAll(".mini-popup-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const title = btn.dataset.popupTitle || "";
      const items = String(btn.dataset.popupItems || "").split("|");

      var esEntrega = title.startsWith("Entregas");
      popupTitle.textContent = title;
      popupBody.innerHTML = items.map(function(x) {
        if (esEntrega && x.includes("::")) {
          var parts = x.split("::", 2);
          return '<div class="popup-line" style="display:flex;align-items:center;gap:8px;justify-content:space-between"><span>' + escapeHtml(parts[1]) + '</span><button class="btn-del-entrega" data-id="' + escapeHtml(parts[0]) + '" style="border:1px solid #ef4444;background:#fff;color:#ef4444;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;font-weight:600">\u2715</button></div>';
        }
        return '<div class="popup-line">' + escapeHtml(x) + '</div>';
      }).join("");
      popupBody.querySelectorAll(".btn-del-entrega").forEach(function(db) {
        db.addEventListener("click", async function() {
          var eid = Number(db.dataset.id);
          if (!eid || !confirm("Eliminar este registro?")) return;
          var r = await supabaseClient.from("Entregas PS").delete().eq("id", eid);
          if (r.error) { alert("Error: " + r.error.message); return; }
          db.closest(".popup-line").remove();
          entregasPSCache = null;
        });
      });

      popupOverlay.classList.remove("hidden");
    });
  });

  popupClose.addEventListener("click", () => {
    popupOverlay.classList.add("hidden");
  });

  popupOverlay.addEventListener("click", e => {
    if (e.target === popupOverlay){
      popupOverlay.classList.add("hidden");
    }
  });

  // Guardar Cod_Prov_Externo al perder foco
  resultEl.querySelectorAll(".cod-prov-input").forEach(input => {
    input.addEventListener("blur", async () => {
      const id = Number(input.dataset.id);
      const val = input.value.trim() || null;
      const { error } = await supabaseClient.from(TABLA_PARTES).update({ Cod_Prov_Externo: val }).eq("id", id);
      if (error) {
        console.error("Error guardando Cod Prov:", error);
        input.style.borderColor = "#ef4444";
      } else {
        input.style.borderColor = "#22c55e";
        setTimeout(() => { input.style.borderColor = ""; }, 1500);
        // Actualizar cache
        if (partesCache) {
          const item = partesCache.find(x => x.id === id);
          if (item) item.Cod_Prov_Externo = val;
        }
      }
    });
  });

  // Click en headers SC / SP para cambiar orden
  resultEl.querySelectorAll(".th-sort").forEach(th => {
    th.addEventListener("click", () => {
      const nuevoOrden = th.dataset.sort;
      if (nuevoOrden === ordenActual) return;
      ordenActual = nuevoOrden;
      seleccionar(psActivo);
    });
  });

  setStatus(`Encontradas ${filas.length} filas`);
}

/*************************************************
 * VOLVER
 *************************************************/
btnVolver.onclick = ()=>{
  psActivo = "";
  resultEl.innerHTML = "";
  btnVolver.classList.add("hidden");

  document.querySelectorAll(".tallerista-btn").forEach(b=>{
    b.classList.remove("active");
  });

  setStatus("Seleccioná un proveedor");
};

/*************************************************
 * INIT
 *************************************************/
document.addEventListener("DOMContentLoaded", cargarPS);
