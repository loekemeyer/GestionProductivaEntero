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
const filtroDesc = document.getElementById("filtroDesc");
const btnImprimir = document.getElementById("btnImprimir");

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

// Helper: paginar + safety net contra loops infinitos
async function fetchAllPaginated(table, selectCols = "*"){
  const out = [];
  const PAGE = 1000;
  const MAX_PAGES = 100;
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++){
    const { data, error } = await supabaseClient.from(table).select(selectCols).range(from, from + PAGE - 1);
    if (error){ console.error(error); throw new Error(`${table}: ${error.message}`); }
    if (!data || !data.length) return out;
    out.push(...data);
    if (data.length < PAGE) return out;
    from += PAGE;
    if (page === MAX_PAGES - 1) console.warn(`[fetchAllPaginated] ${table}: MAX_PAGES alcanzado, filas: ${out.length}`);
  }
  return out;
}

async function cargarEnviosPS(){
  if(enviosPSCache) return enviosPSCache;

  const data = await fetchAllPaginated(TABLA_ENVIOS_PS);
  const error = null;

  if (error){
    console.error(error);
    throw new Error("Error al leer Envios a PS");
  }

  const detalleMap = new Map();
  const totalKgMap = new Map();
  const totalCajMap = new Map();
  const totalUniMap = new Map();

  (data || []).forEach(r=>{
    const provServ = normalizeText(pick(r, ["Prov_Serv", "Prov Serv", "prov_serv"]));
    const sectorSP = normalizeText(pick(r, ["Sector SP", "Sector_SP", "sector sp", "sector_sp"]));
    const sectorSC = normalizeText(pick(r, ["Sector SC", "Sector_SC", "sector sc", "sector_sc"]));
    const parte = normalizeText(pick(r, ["Parte", "parte"]));

    const fecha = String(pick(r, ["Dia-mes", "Dia_mes", "dia-mes", "dia_mes"]) || "").trim();
    const kg = parseDecimal(pick(r, ["KG", "Kg", "kg"]));
    const cajones = parseDecimal(pick(r, ["Cajones", "cajones", "CAJONES"]));
    // Unidades cargadas directamente (PS por unidades, ej. AJ Adhesivos): en esos envíos KG queda null.
    const unidades = parseDecimal(pick(r, ["Unidades", "unidades", "UNIDADES"]));

    if (!provServ) return;
    if (!kg && !cajones && !unidades) return;

    // Clave unica: SC+SP+Parte para maxima precision, con fallbacks
    let key;
    if (sectorSC && sectorSP) key = `${provServ}__${sectorSC}__${sectorSP}__${parte}`;
    else if (sectorSP) key = `${provServ}__sp__${sectorSP}__${parte}`;
    else if (sectorSC) key = `${provServ}__sc__${sectorSC}__${parte}`;
    else if (parte) key = `${provServ}__parte__${parte}`;
    else return;

    if (!detalleMap.has(key)) detalleMap.set(key, []);
    detalleMap.get(key).push({ id: r.id, fecha, kg, cajones, unidades, created_at: r.created_at });
    totalKgMap.set(key, (totalKgMap.get(key) || 0) + kg);
    totalCajMap.set(key, (totalCajMap.get(key) || 0) + cajones);
    totalUniMap.set(key, (totalUniMap.get(key) || 0) + unidades);
  });

  enviosPSCache = {
    detalleMap,
    totalKgMap,
    totalCajMap,
    totalUniMap
  };

  return enviosPSCache;
}

async function cargarEntregasPS(){
  if(entregasPSCache) return entregasPSCache;

  const data = await fetchAllPaginated(TABLA_ENTREGAS_PS);
  const error = null;

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
    detalleMap.get(key).push({ fecha, kg, cajones, created_at: r.created_at });
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

  const data = await fetchAllPaginated(TABLA_ENVIOS_TALLERISTAS);
  const error = null;

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
  const totalUniDirecto = Number((enviosData.totalUniMap && enviosData.totalUniMap.get(key)) || 0);
  // PS por unidades: usar las Unidades cargadas directamente. Sino, derivar de KG / (Kg x Uni).
  const totalUni = totalUniDirecto > 0 ? totalUniDirecto : (kgXUni > 0 ? Math.round(totalKg / kgXUni) : 0);
  const detalleBase = (enviosData.detalleMap.get(key) || [])
    .slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  const detalle = detalleBase.map(x => {
    const uniDirecto = Number(x.unidades || 0);
    const unidades = uniDirecto > 0 ? uniDirecto : (kgXUni > 0 ? Math.round(Number(x.kg || 0) / kgXUni) : 0);
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
  const totalUni = kgXUni > 0 ? Math.round(totalKg / kgXUni) : (totalKg === 0 ? totalCaj : 0);

  const detalleBase = (entregasData.detalleMap.get(key) || [])
    .slice()
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));

  const detalle = detalleBase.map(x => {
    const xkg = Number(x.kg || 0);
    const unidades = kgXUni > 0 ? Math.round(xkg / kgXUni) : (xkg === 0 ? Number(x.cajones || 0) : 0);
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
  let grpIdx = 0;
  const printRows = [];

  for (const [sc, grupo] of gruposSC.entries()) {
    // Datos compartidos del SC (usar primer item para info SC)
    const firstItem = grupo[0];
    const scKey = sc.toLowerCase();
    // Buscar peso: primero en SP Kg (sector procesado), luego SC Kg (crudo), luego plasticas.
    // EXCEPCION: si el SP es 'ST' (Sector Transito) NO usar su peso — ST es un bucket
    // compartido registrado arbitrariamente (ej. "Resorte U" 0.012), y daria unidades
    // erroneas para todas las piezas que pasan por transito. En ese caso caer al peso del SC real.
    const firstSP = String(firstItem.SP || firstItem.Sp || "").trim().toLowerCase();
    const spEsTransito = firstSP === "st";
    let scInfo = (spEsTransito ? null : spKg.get(firstSP)) || spKg.get(scKey) || scKg.get(scKey);
    if (!scInfo || !scInfo.kgUni) scInfo = (spEsTransito ? null : plasticas.get(firstSP)) || plasticas.get(scKey) || scInfo;
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
      // ST (Sector Transito) es un bucket compartido con peso arbitrario (ej "Resorte U" 0.012):
      // NO usarlo para convertir kg->uni, caer al peso del SC real.
      const spItemEsTransito = spKey === "st";
      let info = (spItemEsTransito ? null : spKg.get(spKey)) || scKg.get(scKey);
      if (!info || !info.kgUni) info = (spItemEsTransito ? null : plasticas.get(spKey)) || plasticas.get(scKey) || info;
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
          ? Math.round(totalEntKg / firstSF.info.kgUni)
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
    const onlinePSUni = scKgUni > 0 ? Math.round(onlinePSKg / scKgUni) : 0;

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
      // Preferir el codigo nuevo (Cod_ISIS) sobre el viejo (Cod_Prov_Externo) en el display.
      // data-field indica a que columna se guarda el input al editar: si mostramos Cod_ISIS,
      // el input edita Cod_ISIS; sino edita el placeholder Cod_Prov_Externo.
      const tieneIsis = !!(sf.item.Cod_ISIS && String(sf.item.Cod_ISIS).trim());
      const codProvVal = escapeHtml(tieneIsis ? sf.item.Cod_ISIS : (sf.item.Cod_Prov_Externo || ""));
      const codField = tieneIsis ? "Cod_ISIS" : "Cod_Prov_Externo";

      rows += `<tr data-grp="${grpIdx}">`;

      // Columnas compartidas solo en la primera fila del grupo
      if (idx === 0) {
        rows += `
        <td${rs}${vAlign}>${escapeHtml(sc.startsWith("__solo_") ? (firstItem.SC || firstItem.Sc || "") : sc)}</td>`;
      }

      // Columnas individuales: SP y Descripcion
      rows += `
        <td>${escapeHtml(sf.item.SP || sf.item.Sp || "")}</td>
        <td class="desc-cell">${escapeHtml(sf.item.Parte || "")}</td>`;

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

      // Columna individual: Cod Prov (muestra Cod_ISIS si existe, sino Cod_Prov_Externo)
      rows += `
        <td class="cod-prov-cell">
          <input type="text" class="cod-prov-input" value="${codProvVal}" data-id="${sf.item.id}" data-field="${codField}" placeholder="-" />
        </td>
      </tr>`;
    });

    // Datos para impresión (Descripción + Caj online + Cjn a enviar, nivel SC/grupo)
    printRows.push({
      desc: subFilas.map(sf => String(sf.item.Parte || "").trim()).filter(Boolean).join(" / "),
      caj: onlinePSCaj,
      cjn: enviar
    });

    grpIdx++;
  }

  const printRowsHtml = printRows.length
    ? printRows.map((r, i) => `
        <tr data-pdesc="${escapeHtml(normalizeText(r.desc))}" class="${i % 2 ? "zebra" : ""}">
          <td class="p-num">${i + 1}</td>
          <td class="p-desc">${escapeHtml(r.desc)}</td>
          <td class="p-caj">${formatCajones(r.caj)}</td>
          <td class="p-cjn">${formatCajones(r.cjn)}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" class="center">Sin datos</td></tr>`;

  const totalCjnPrint = printRows.reduce((s, r) => s + Number(r.cjn || 0), 0);
  const totalCajPrint = printRows.reduce((s, r) => s + Number(r.caj || 0), 0);
  const fechaPrint = new Date().toLocaleDateString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric"
  });

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

    <div id="printArea" class="print-only">
      <div class="print-header">
        <div class="print-head-left">
          <div class="print-doc">Cajones a Enviar</div>
          <h2 class="print-title">${escapeHtml(ps)}</h2>
        </div>
        <div class="print-head-right">
          <div class="print-date">Fecha: ${escapeHtml(fechaPrint)}</div>
          <div class="print-count"><span id="printCount">${printRows.length}</span> ítems</div>
        </div>
      </div>
      <table class="print-table">
        <thead>
          <tr>
            <th class="p-num">#</th>
            <th class="p-desc">Descripción</th>
            <th class="p-caj">Caj</th>
            <th class="p-cjn">Cjn a Enviar</th>
          </tr>
        </thead>
        <tbody>${printRowsHtml}</tbody>
        <tfoot>
          <tr class="print-total">
            <td></td>
            <td>TOTAL</td>
            <td class="p-caj" id="printTotalCaj">${formatCajones(totalCajPrint)}</td>
            <td class="p-cjn" id="printTotalCjn">${formatCajones(totalCjnPrint)}</td>
          </tr>
        </tfoot>
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

  // Guardar Cod ISIS (nuevo) o Cod_Prov_Externo (viejo) al perder foco.
  // data-field indica cual columna se actualiza (segun cual mostraba el input).
  resultEl.querySelectorAll(".cod-prov-input").forEach(input => {
    input.addEventListener("blur", async () => {
      const id = Number(input.dataset.id);
      const field = input.dataset.field || "Cod_Prov_Externo";
      const val = input.value.trim() || null;
      const { error } = await supabaseClient.from(TABLA_PARTES).update({ [field]: val }).eq("id", id);
      if (error) {
        console.error("Error guardando " + field + ":", error);
        input.style.borderColor = "#ef4444";
      } else {
        input.style.borderColor = "#22c55e";
        setTimeout(() => { input.style.borderColor = ""; }, 1500);
        // Actualizar cache
        if (partesCache) {
          const item = partesCache.find(x => x.id === id);
          if (item) item[field] = val;
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

  filtroDesc.classList.remove("hidden");
  btnImprimir.classList.remove("hidden");
  aplicarFiltro();

  setStatus(`Encontradas ${filas.length} filas`);

  // Panel advertencia: envios/entregas sin match contra Partes x PS
  renderPanelSinMatchPS(ps, filas, enviosData, entregasData);
}

// =====================================================
// Panel "Sin match": envios/entregas cuyo (PS+SC+SP+parte) no esta en Partes x PS
// =====================================================
function renderPanelSinMatchPS(ps, filasPS, enviosData, entregasData){
  const psNorm = normalizeText(ps);
  // Set de keys esperadas (todas las variantes que arma cargarEnviosPS/cargarEntregasPS)
  const keysEsperadas = new Set();
  filasPS.forEach(r => {
    const sc = normalizeText(r.SC || r.Sc || "");
    const sp = normalizeText(r.SP || r.Sp || "");
    const parte = normalizeText(r.Parte || "");
    if (sc && sp) keysEsperadas.add(`${psNorm}__${sc}__${sp}__${parte}`);
    if (sp) keysEsperadas.add(`${psNorm}__sp__${sp}__${parte}`);
    if (sc) keysEsperadas.add(`${psNorm}__sc__${sc}__${parte}`);
    if (parte) keysEsperadas.add(`${psNorm}__parte__${parte}`);
  });

  const sinMatchEnvios = [];
  const sinMatchEntregas = [];
  const prefijo = `${psNorm}__`;

  const recolectar = (mapData, tipo, lista) => {
    if (!mapData || !mapData.totalKgMap) return;
    for (const [key, kg] of mapData.totalKgMap.entries()){
      if (!key.startsWith(prefijo)) continue;
      if (keysEsperadas.has(key)) continue;
      const caj = mapData.totalCajMap ? (mapData.totalCajMap.get(key) || 0) : 0;
      const uni = mapData.totalUniMap ? (mapData.totalUniMap.get(key) || 0) : 0;
      const detalle = mapData.detalleMap ? (mapData.detalleMap.get(key) || []) : [];
      if (kg <= 0 && caj <= 0 && uni <= 0) continue;
      const fechas = detalle.map(d => d.fecha).filter(Boolean);
      // Parsear key: psNorm__[sc|sp|parte|sc__sp]__parte
      const resto = key.slice(prefijo.length);
      lista.push({ resto, kg, caj, uni, cant: detalle.length, primera: fechas[0]||"", ultima: fechas[fechas.length-1]||"" });
    }
  };
  recolectar(enviosData, "envio", sinMatchEnvios);
  recolectar(entregasData, "entrega", sinMatchEntregas);

  let panel = document.getElementById("panelSinMatchPS");
  if (!sinMatchEnvios.length && !sinMatchEntregas.length){
    if (panel) panel.remove();
    return;
  }
  if (!panel){
    panel = document.createElement("div");
    panel.id = "panelSinMatchPS";
    panel.style.cssText = "margin:14px 0;padding:12px 14px;border:2px solid #f59e0b;background:#fffbeb;border-radius:10px;font-size:14px";
    if (resultEl && resultEl.parentNode) resultEl.parentNode.insertBefore(panel, resultEl);
  }

  sinMatchEnvios.sort((a,b) => b.kg - a.kg);
  sinMatchEntregas.sort((a,b) => b.kg - a.kg);

  const buildTable = (items, titulo) => items.length ? `
    <div style="font-weight:700;color:#92400e;margin-top:10px">${titulo}</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
      <thead><tr style="background:#fde68a">
        <th style="padding:4px 8px;border:1px solid #d97706;text-align:left">Clave (SC/SP/Parte)</th>
        <th style="padding:4px 8px;border:1px solid #d97706">Σ Kg</th>
        <th style="padding:4px 8px;border:1px solid #d97706">Σ Caj</th>
        <th style="padding:4px 8px;border:1px solid #d97706">Σ Uni</th>
        <th style="padding:4px 8px;border:1px solid #d97706">Reg</th>
        <th style="padding:4px 8px;border:1px solid #d97706">Fechas</th>
      </tr></thead>
      <tbody>${items.map(x => `<tr>
        <td style="padding:3px 8px;border:1px solid #d97706"><b>${escapeHtml(x.resto)}</b></td>
        <td style="padding:3px 8px;border:1px solid #d97706;text-align:right">${Number(x.kg).toLocaleString('es-AR',{maximumFractionDigits:2})}</td>
        <td style="padding:3px 8px;border:1px solid #d97706;text-align:right">${Number(x.caj).toLocaleString('es-AR')}</td>
        <td style="padding:3px 8px;border:1px solid #d97706;text-align:right">${Number(x.uni).toLocaleString('es-AR')}</td>
        <td style="padding:3px 8px;border:1px solid #d97706;text-align:center">${x.cant}</td>
        <td style="padding:3px 8px;border:1px solid #d97706;text-align:center">${escapeHtml(x.primera)} → ${escapeHtml(x.ultima)}</td>
      </tr>`).join("")}</tbody>
    </table>` : "";

  panel.innerHTML = `
    <div style="font-weight:800;color:#92400e;font-size:15px;margin-bottom:6px">
      ⚠ Envíos/Entregas sin match con Partes x PS (${sinMatchEnvios.length + sinMatchEntregas.length})
    </div>
    <div style="color:#78350f;margin-bottom:8px">Estas operaciones existen en DB pero su combinación (PS+SC+SP+Parte) no aparece en Partes x PS — revisar carga o agregar la fila.</div>
    ${buildTable(sinMatchEnvios, "📤 Envíos sin match:")}
    ${buildTable(sinMatchEntregas, "📥 Entregas sin match:")}
  `;
}

/*************************************************
 * FILTRO POR DESCRIPCION
 *************************************************/
function aplicarFiltro(){
  const q = normalizeText(filtroDesc.value);

  // Filas en pantalla: agrupadas por data-grp (respeta rowspan)
  const porGrupo = {};
  resultEl.querySelectorAll("tr[data-grp]").forEach(tr => {
    const g = tr.dataset.grp;
    (porGrupo[g] = porGrupo[g] || []).push(tr);
  });

  Object.values(porGrupo).forEach(trs => {
    const match = !q || trs.some(tr => {
      const d = tr.querySelector(".desc-cell");
      return d && normalizeText(d.textContent).includes(q);
    });
    trs.forEach(tr => { tr.style.display = match ? "" : "none"; });
  });

  // Filas de impresión + recalcular totales/contador sobre lo visible
  let totalCaj = 0, totalCjn = 0, visibles = 0;
  resultEl.querySelectorAll("#printArea tr[data-pdesc]").forEach(tr => {
    const match = !q || (tr.dataset.pdesc || "").includes(q);
    tr.style.display = match ? "" : "none";
    if (match){
      visibles++;
      totalCaj += parseDecimal(tr.querySelector(".p-caj")?.textContent);
      totalCjn += parseDecimal(tr.querySelector(".p-cjn")?.textContent);
    }
  });

  const elCount = document.getElementById("printCount");
  const elCaj = document.getElementById("printTotalCaj");
  const elCjn = document.getElementById("printTotalCjn");
  if (elCount) elCount.textContent = visibles;
  if (elCaj) elCaj.textContent = formatCajones(totalCaj);
  if (elCjn) elCjn.textContent = formatCajones(totalCjn);
}

filtroDesc.addEventListener("input", aplicarFiltro);
btnImprimir.addEventListener("click", () => window.print());

/*************************************************
 * VOLVER
 *************************************************/
btnVolver.onclick = ()=>{
  psActivo = "";
  resultEl.innerHTML = "";
  btnVolver.classList.add("hidden");
  filtroDesc.value = "";
  filtroDesc.classList.add("hidden");
  btnImprimir.classList.add("hidden");

  document.querySelectorAll(".tallerista-btn").forEach(b=>{
    b.classList.remove("active");
  });

  setStatus("Seleccioná un proveedor");
};

/*************************************************
 * INIT
 *************************************************/
document.addEventListener("DOMContentLoaded", cargarPS);
