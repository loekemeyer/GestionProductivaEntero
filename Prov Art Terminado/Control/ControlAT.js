"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLA_ARTS = "Articulos x Prov AT";
const TABLA_ENVIOS = "Envios Prov AT";
const TABLA_ENTREGAS = "Entregas Prov AT";

// Mapeo proveedor → tallerista: cuando un proveedor externo es el mismo que un tallerista
// interno (ej. Pettofrezza = Rafael), leemos de Partes x Tallerista en vez de Articulos x Prov AT.
// Se carga desde la columna alias_externo de tabla Talleristas. Fallback hardcoded por seguridad.
let PROVEEDOR_A_TALLERISTA = {
  "Pettofrezza": "Rafael"
};

async function cargarAliasProveedor() {
  try {
    const { data, error } = await sb
      .from("Tall_ProvAT_PS")
      .select("nombre, alias_externo")
      .not("alias_externo", "is", null);
    if (error) { console.warn("[ControlAT] No se pudo cargar alias, uso fallback:", error.message); return; }
    if (!data || !data.length) return;
    const mapa = {};
    data.forEach(r => {
      const alias = String(r.alias_externo || "").trim();
      const tall = String(r.nombre || "").trim();
      if (alias && tall) mapa[alias] = tall;
    });
    PROVEEDOR_A_TALLERISTA = mapa;
  } catch (e) { console.warn("[ControlAT] cargarAliasProveedor fallo, uso fallback:", e); }
}

/* DOM */
const statusEl = document.getElementById("status");
const provGrid = document.getElementById("provGrid");
const btnVolver = document.getElementById("btnVolver");
const searchRow = document.getElementById("searchRow");
const txtBuscar = document.getElementById("txtBuscar");
const resultEl = document.getElementById("result");

/* STATE */
let proveedorActivo = "";
let provsList = [];
let datosParaFiltro = [];

/* HELPERS */
function setStatus(t){ statusEl.textContent = t || ""; }

function escapeHtml(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function normalizeText(s){
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function formatNumber(n){
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function formatDecimal(n){
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
}

function formatCajones(n){
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });
}

function formatKg(n){
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });
}

function sortKeyFechaDDMM(s){
  // "DD/MM" o "YYYY-MM-DD"
  const txt = String(s || "").trim();
  if (!txt) return 0;
  const iso = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
  const ddmm = txt.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (ddmm) {
    const d = Number(ddmm[1]), m = Number(ddmm[2]);
    return m * 100 + d;
  }
  return 0;
}

/* CARGA */
async function cargarProveedores(){
  const { data, error } = await sb.from(TABLA_ARTS).select('"Proveedor"').eq("Activo", true);
  if (error) throw error;
  const set = new Set((data || []).map(r => (r.Proveedor || "").trim()).filter(Boolean));
  return [...set].sort((a, b) => a.localeCompare(b, "es"));
}

async function cargarArticulos(prov){
  const { data, error } = await sb
    .from(TABLA_ARTS)
    .select("*")
    .eq("Proveedor", prov)
    .eq("Activo", true)
    .order("Cod_Art");
  if (error) throw error;
  return data || [];
}

async function cargarEnvios(prov){
  const { data, error } = await sb.from(TABLA_ENVIOS).select("*").eq("Proveedor", prov);
  if (error) throw error;
  return data || [];
}

async function cargarEntregas(prov){
  const { data, error } = await sb.from(TABLA_ENTREGAS).select("*").eq("Proveedor", prov);
  if (error) throw error;
  return data || [];
}

/* RENDER */
function renderProveedores(){
  provGrid.innerHTML = "";
  provsList.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tallerista-btn";
    btn.textContent = p;
    if (p === proveedorActivo) btn.classList.add("active");
    btn.addEventListener("click", () => seleccionarProveedor(p));
    provGrid.appendChild(btn);
  });
}

async function seleccionarProveedor(prov){
  proveedorActivo = prov;
  renderProveedores();
  btnVolver.classList.remove("hidden");
  searchRow.classList.remove("hidden");
  txtBuscar.value = "";
  setStatus("Cargando...");

  const tallerista = PROVEEDOR_A_TALLERISTA[prov];

  try {
    if (tallerista) {
      datosParaFiltro = await cargarDesdeTallerista(tallerista);
    } else {
      datosParaFiltro = await cargarDesdeProvAT(prov);
    }
  } catch (e){
    console.error(e);
    setStatus("Error al cargar datos: " + (e.message || e));
    return;
  }

  renderFilasFiltradas();
}

async function cargarDesdeProvAT(prov){
  let arts, envios, entregas, sectorCartonResp;
  [arts, envios, entregas, sectorCartonResp] = await Promise.all([
    cargarArticulos(prov),
    cargarEnvios(prov),
    cargarEntregas(prov),
    sb.from("Sector Carton").select("Cod, Sector, Descripcion").eq("Tipo","Carton")
  ]);

  const sectorCartonByCod = new Map();
  (sectorCartonResp.data || []).forEach(sc => {
    const cod = String(sc.Cod || "").trim();
    if (!cod) return;
    if (!sectorCartonByCod.has(cod)) sectorCartonByCod.set(cod, sc);
  });

  // Agrupar envíos por Cod_Art
  const envMap = new Map();
  const envDetByCod = new Map();
  envios.forEach(r => {
    const cod = String(r.Cod_Art || "").trim();
    if (!cod) return;
    if (!envMap.has(cod)) envMap.set(cod, { carton: 0, cajas: 0 });
    const e = envMap.get(cod);
    e.carton += Number(r.Carton || 0);
    e.cajas += Number(r.Cajas || 0);
    if (!envDetByCod.has(cod)) envDetByCod.set(cod, []);
    envDetByCod.get(cod).push({
      fecha: r.Dia_mes || "",
      carton: Number(r.Carton || 0),
      cajas: Number(r.Cajas || 0)
    });
  });

  // Agrupar entregas por Cod_Art
  const entMap = new Map();
  const entDetByCod = new Map();
  entregas.forEach(r => {
    const cod = String(r.Cod_Art || "").trim();
    if (!cod) return;
    entMap.set(cod, (entMap.get(cod) || 0) + Number(r.Cantidad || 0));
    if (!entDetByCod.has(cod)) entDetByCod.set(cod, []);
    entDetByCod.get(cod).push({
      fecha: r.Fecha || r.Dia_mes || "",
      cantidad: Number(r.Cantidad || 0)
    });
  });

  // Ordenar detalles cronológicamente
  for (const [, arr] of envDetByCod){ arr.sort((a,b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha)); }
  for (const [, arr] of entDetByCod){ arr.sort((a,b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha)); }

  const datos = [];

  // ===== CARTONES: uno por cada cod del proveedor (similar a Pettofrezza/Rafael) =====
  // Sector + descripcion vienen de Sector Carton si existe; si no, "Sin sector" + "Cartón <cod>".
  const cartonesYaAgregados = new Set();
  arts.forEach(a => {
    const cod = String(a.Cod_Art || "").trim();
    if (!cod || cartonesYaAgregados.has(cod)) return;
    cartonesYaAgregados.add(cod);

    const sc = sectorCartonByCod.get(cod);
    const sector = (sc && sc.Sector) ? String(sc.Sector).trim() : "";
    const descripcion = `Cartón ${cod}`;

    const env = envMap.get(cod) || { carton: 0, cajas: 0 };
    const entCant = entMap.get(cod) || 0;

    const totalEnviosUni = env.carton;
    const totalEntregasUni = entCant;
    const onlineUni = totalEnviosUni - totalEntregasUni;

    const popupEnvios = (envDetByCod.get(cod) || [])
      .map(x => `${x.fecha} - ${formatNumber(x.carton)} cartón - ${formatNumber(x.cajas)} cajas`)
      .join("|") || "Sin envíos";
    const popupEntregas = (entDetByCod.get(cod) || [])
      .map(x => `${x.fecha} - ${formatNumber(x.cantidad)} uni`)
      .join("|") || "Sin entregas";

    datos.push({
      tipo: "cartones",
      sectorProce: sector,
      descripcion,
      codsRaw: cod,
      onlineKg: 0,
      onlineCaj: onlineUni,
      onlineUni,
      cajonesEnviar: 0,
      totalEnviosUni,
      totalEntregasUni,
      popupEnviosItems: popupEnvios,
      popupEntregasItems: popupEntregas,
      stockInicialKg: 0,
      kgXUni: 0,
      kgXCajon: 0,
      consumoTotal: 0,
      maxCajones: 0
    });
  });

  // ===== CAJAS: agrupadas por N_Caja =====
  const cajasMap = new Map();
  arts.filter(a => a.N_Caja != null && a.N_Caja !== "").forEach(a => {
    const n = String(a.N_Caja);
    const cod = String(a.Cod_Art || "").trim();
    if (!cajasMap.has(n)) cajasMap.set(n, { codigos: new Set(), cajasEnv: 0, unidRecib: 0, detEnv: [], detEnt: [] });
    const g = cajasMap.get(n);
    g.codigos.add(cod);
    const env = envMap.get(cod) || { carton: 0, cajas: 0 };
    g.cajasEnv += env.cajas;
    g.unidRecib += entMap.get(cod) || 0;
    (envDetByCod.get(cod) || []).forEach(x => g.detEnv.push({ ...x, cod }));
    (entDetByCod.get(cod) || []).forEach(x => g.detEnt.push({ ...x, cod }));
  });

  [...cajasMap.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .forEach(([nCaja, g]) => {
      const cods = [...g.codigos].sort((a, b) => String(a).localeCompare(String(b), "es", { numeric: true }));
      const onlineUni = g.cajasEnv - g.unidRecib;

      g.detEnv.sort((a,b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));
      g.detEnt.sort((a,b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));

      const popupEnvios = g.detEnv
        .map(x => `${x.fecha} - Cod ${x.cod} - ${formatNumber(x.cajas)} cajas`)
        .join("|") || "Sin envíos";
      const popupEntregas = g.detEnt
        .map(x => `${x.fecha} - Cod ${x.cod} - ${formatNumber(x.cantidad)} uni`)
        .join("|") || "Sin entregas";

      datos.push({
        tipo: "cajas",
        sectorProce: "Caja " + nCaja,
        descripcion: "Caja N° " + nCaja,
        codsRaw: cods.join(", "),
        onlineKg: 0,
        onlineCaj: g.cajasEnv,
        onlineUni,
        cajonesEnviar: 0,
        totalEnviosUni: g.cajasEnv,
        totalEntregasUni: g.unidRecib,
        popupEnviosItems: popupEnvios,
        popupEntregasItems: popupEntregas,
        stockInicialKg: 0,
        kgXUni: 0,
        kgXCajon: 0,
        consumoTotal: 0,
        maxCajones: 0
      });
    });

  return datos;
}

/* =========================================================
 * CARGA DESDE TALLERISTA (para proveedores mapeados, ej Pettofrezza = Rafael)
 * Lee Partes x Tallerista (cartones) + Articulos_Cajas + Cajas (cajas)
 * + Envios a Talleristas + Entregas Tallerista Virgilio
 * ========================================================= */
async function cargarDesdeTallerista(tallerista){
  const [partesResp, artTallResp, artCajasResp, cajasResp, enviosResp, entregasResp] = await Promise.all([
    sb.from("Partes x Tallerista").select("*").eq("tallerista", tallerista).limit(20000),
    sb.from("Articulos Virgilio X Tallerista").select("*").eq("Tallerista", tallerista).limit(5000),
    sb.from("Articulos_Cajas").select("*").limit(5000),
    sb.from("Cajas").select("*").limit(500),
    sb.from("Envios a Talleristas").select("*").eq("Tallerista", tallerista).limit(20000),
    sb.from("Entregas Tallerista Virgilio").select("*").eq("Nombre_Tall", tallerista).limit(20000)
  ]);

  if (partesResp.error) throw partesResp.error;
  if (artTallResp.error) throw artTallResp.error;
  if (artCajasResp.error) throw artCajasResp.error;
  if (cajasResp.error) throw cajasResp.error;
  if (enviosResp.error) throw enviosResp.error;
  if (entregasResp.error) throw entregasResp.error;

  const partes = partesResp.data || [];
  const arts = artTallResp.data || [];
  const artCajas = artCajasResp.data || [];
  const cajas = cajasResp.data || [];
  const envios = enviosResp.data || [];
  const entregas = entregasResp.data || [];

  const codsDelTallerista = new Set(arts.map(a => String(a.Cod_Art || "").trim()).filter(Boolean));

  // Detalles de envíos por descripción (Envios a Talleristas no tiene cod_art, usa Sector+Descripcion)
  const enviosByDesc = new Map();
  envios.forEach(e => {
    const desc = normalizeText(e.Descripcion);
    if (!desc) return;
    if (!enviosByDesc.has(desc)) enviosByDesc.set(desc, []);
    enviosByDesc.get(desc).push({
      fecha: String(e["Dia-mes"] || "").trim(),
      kg: Number(e.KG || 0),
      cajones: Number(e.Cajones || 0),
      unidades: Number(e.Unidades || 0)
    });
  });

  // Detalles de entregas por cod
  const entregasByCod = new Map();
  entregas.forEach(e => {
    const cod = String(e.Cod || "").trim();
    if (!cod) return;
    if (!entregasByCod.has(cod)) entregasByCod.set(cod, []);
    entregasByCod.get(cod).push({
      fecha: String(e.Fecha || "").trim(),
      cajas: Number(e.Cajas || 0)
    });
  });

  // Ordenar detalles
  for (const [, arr] of enviosByDesc){ arr.sort((a,b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha)); }
  for (const [, arr] of entregasByCod){ arr.sort((a,b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha)); }

  const datos = [];
  const cartonesYaAgregados = new Set(); // evitar duplicados por (sector+cod+desc)

  // ===== CARTONES: filas de Partes x Tallerista con descripcion_parte LIKE 'Cartón%' =====
  partes
    .filter(p => String(p.descripcion_parte || "").toLowerCase().startsWith("cartón") ||
                 String(p.descripcion_parte || "").toLowerCase().startsWith("carton"))
    .forEach(p => {
      const cod = String(p.cod || "").trim();
      const sector = String(p.sector_proce || "").trim();
      const desc = String(p.descripcion_parte || "").trim();
      const uniXCaja = Number(p.uni_x_cja || 1) || 1;
      const key = `${sector}__${cod}__${desc}`;
      if (cartonesYaAgregados.has(key)) return;
      cartonesYaAgregados.add(key);

      // Envíos: sector + descripcion match en Envios a Talleristas
      const envsCarton = enviosByDesc.get(normalizeText(desc)) || [];
      const totalEnviosUni = envsCarton.reduce((sum, e) => {
        if (e.unidades > 0) return sum + e.unidades;
        return sum + (e.cajones * uniXCaja);
      }, 0);

      // Entregas: cajas × uni_x_cja
      const entsCarton = entregasByCod.get(cod) || [];
      const totalEntregasUni = entsCarton.reduce((sum, e) => sum + (e.cajas * uniXCaja), 0);

      const stockInicialKg = Number(p.stock_inicial || 0);
      const kgXUni = Number(p.kgxuni || 0);
      const stockInicialUni = kgXUni > 0 ? stockInicialKg / kgXUni : 0;

      const onlineUni = stockInicialUni + totalEnviosUni - totalEntregasUni;

      const popupEnvios = envsCarton
        .map(e => {
          const uni = e.unidades > 0 ? e.unidades : (e.cajones * uniXCaja);
          return `${e.fecha} - ${formatNumber(e.cajones)} caj - ${formatNumber(uni)} uni`;
        })
        .join("|") || "Sin envíos";
      const popupEntregas = entsCarton
        .map(e => `${e.fecha} - ${formatNumber(e.cajas)} caj - ${formatNumber(e.cajas * uniXCaja)} uni`)
        .join("|") || "Sin entregas";

      datos.push({
        tipo: "cartones",
        sectorProce: sector || "Sin sector",
        descripcion: desc,
        codsRaw: cod,
        onlineKg: 0,
        onlineCaj: onlineUni,
        onlineUni,
        cajonesEnviar: 0,
        totalEnviosUni,
        totalEntregasUni,
        popupEnviosItems: popupEnvios,
        popupEntregasItems: popupEntregas,
        stockInicialKg: stockInicialUni,
        kgXUni,
        kgXCajon: Number(p.kg_x_caj || 0),
        consumoTotal: 0,
        maxCajones: 0
      });
    });

  // ===== CAJAS: agrupar Articulos_Cajas por N_Caja, filtrando cods del tallerista =====
  const codsPorCaja = new Map();
  artCajas.forEach(ac => {
    const cod = String(ac.Cod_Art || "").trim();
    if (!codsDelTallerista.has(cod)) return;
    const nCaja = Number(ac.N_Caja || 0);
    if (nCaja <= 0) return;
    if (!codsPorCaja.has(nCaja)) codsPorCaja.set(nCaja, new Set());
    codsPorCaja.get(nCaja).add(cod);
  });

  cajas.forEach(c => {
    const nCaja = Number(c.N_Caja || 0);
    if (!codsPorCaja.has(nCaja)) return;
    const sector = String(c.Sector || "").trim();
    const desc = `Caja N ${nCaja}`;
    const cods = [...codsPorCaja.get(nCaja)].sort((a,b) => String(a).localeCompare(String(b), "es", { numeric: true }));
    const maxUni = Number(c.Max_Uni_Virg || 0);
    const stockVirg = Number(c.Stock_Virg || 0);

    const envsCaja = enviosByDesc.get(normalizeText(desc)) || [];
    const totalEnviosUni = envsCaja.reduce((sum, e) => sum + (e.unidades || 0), 0);

    const entsCaja = [];
    cods.forEach(cod => (entregasByCod.get(cod) || []).forEach(e => entsCaja.push({ ...e, cod })));
    entsCaja.sort((a,b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));
    const totalEntregasUni = entsCaja.reduce((sum, e) => sum + (e.cajas || 0), 0);

    const onlineUni = stockVirg + totalEnviosUni - totalEntregasUni;
    const cajonesEnviar = Math.max(0, maxUni - onlineUni);

    const popupEnvios = envsCaja
      .map(e => `${e.fecha} - ${formatNumber(e.unidades)} uni`)
      .join("|") || "Sin envíos";
    const popupEntregas = entsCaja
      .map(e => `${e.fecha} - Cod ${e.cod} - ${formatNumber(e.cajas)} caj`)
      .join("|") || "Sin entregas";

    datos.push({
      tipo: "cajas",
      sectorProce: sector || ("Caja " + nCaja),
      descripcion: desc,
      codsRaw: cods.join(", "),
      onlineKg: 0,
      onlineCaj: stockVirg,
      onlineUni,
      cajonesEnviar,
      totalEnviosUni,
      totalEntregasUni,
      popupEnviosItems: popupEnvios,
      popupEntregasItems: popupEntregas,
      stockInicialKg: 0,
      kgXUni: 0,
      kgXCajon: 0,
      consumoTotal: 0,
      maxCajones: maxUni
    });
  });

  return datos;
}

function renderFilasFiltradas(){
  const q = normalizeText(txtBuscar.value);
  const filtradas = !q ? datosParaFiltro : datosParaFiltro.filter(d =>
    normalizeText(d.sectorProce).includes(q) ||
    normalizeText(d.descripcion).includes(q) ||
    normalizeText(d.codsRaw).includes(q)
  );
  renderResultado(proveedorActivo, filtradas);
}

function renderFilaControl(d){
  return `
      <tr>
        <td class="center">${d.sectorProce ? escapeHtml(d.sectorProce) : '<span class="zero">Sin sector</span>'}</td>
        <td class="center" title="${escapeHtml(d.descripcion)}">${escapeHtml(d.descripcion)}</td>

        <td class="center"><b>${escapeHtml(formatKg(d.onlineKg))}</b></td>
        <td class="center"><b>${escapeHtml(formatCajones(d.onlineCaj))}</b></td>
        <td class="center"><b>${escapeHtml(formatNumber(d.onlineUni))}</b></td>

        <td class="center"><b>${escapeHtml(formatCajones(d.cajonesEnviar))}</b></td>

        <td class="center">
          <div class="cell-combo">
            <span class="cell-total">${escapeHtml(formatNumber(d.totalEnviosUni))}</span>
            <button type="button" class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Envíos - ${d.descripcion}`)}"
              data-popup-items="${escapeHtml(d.popupEnviosItems)}">+</button>
          </div>
        </td>

        <td class="center">
          <div class="cell-combo">
            <span class="cell-total">${escapeHtml(formatNumber(d.totalEntregasUni))}</span>
            <button type="button" class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Entregas - ${d.descripcion}`)}"
              data-popup-items="${escapeHtml(d.popupEntregasItems)}">+</button>
          </div>
        </td>

        <td class="center"><b>${escapeHtml(formatNumber(d.stockInicialKg))}</b></td>
        <td class="center"><b>${escapeHtml(formatKg(d.kgXUni))}</b></td>
        <td class="center"><b>${escapeHtml(formatDecimal(d.kgXCajon))}</b></td>
        <td class="center"><b>${escapeHtml(formatNumber(d.consumoTotal))}</b></td>
        <td class="center"><b>${escapeHtml(formatCajones(d.maxCajones))}</b></td>
        <td class="mono">${d.codsRaw ? escapeHtml(d.codsRaw) : '<span class="zero">Sin códigos</span>'}</td>
      </tr>
    `;
}

function renderResultado(prov, datos){
  const grupos = ["Cartones", "Cajas"];
  const agrupados = { Cartones: [], Cajas: [] };
  datos.forEach(d => {
    if (d.tipo === "cajas") agrupados.Cajas.push(d);
    else agrupados.Cartones.push(d);
  });

  let rows = "";
  grupos.forEach(grupo => {
    const items = agrupados[grupo];
    if (!items.length) return;
    items.sort((a, b) => String(a.sectorProce || "").localeCompare(String(b.sectorProce || ""), "es", { numeric: true, sensitivity: "base" }));
    rows += `<tr class="grupo-header"><td colspan="14">${escapeHtml(grupo)} (${items.length})</td></tr>`;
    items.forEach(d => { rows += renderFilaControl(d); });
  });

  setStatus(`Encontrados ${datos.length} items`);

  resultEl.innerHTML = `
    <div class="articulo">
      <div class="articulo-header">${escapeHtml(prov)}</div>
      <table class="table">
        <thead>
          <tr>
            <th colspan="2">Base</th>
            <th colspan="3">Online</th>
            <th colspan="1">Enviar</th>
            <th colspan="2">Movimientos (Uni)</th>
            <th colspan="6">Info</th>
          </tr>
          <tr>
            <th>Sector</th>
            <th>Descripción</th>
            <th>Kg</th>
            <th>Caj</th>
            <th>Uni</th>
            <th>Cjn<br>a Env</th>
            <th>Envíos</th>
            <th>Entregas</th>
            <th>Stock<br>Inicial</th>
            <th>Kg x<br>Uni</th>
            <th>Kg x<br>Cajon</th>
            <th>Cons x<br>Parte</th>
            <th>Max<br>Cajones</th>
            <th>Codigos</th>
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

    <div id="historialOverlay" class="popup-overlay hidden">
      <div class="historial-modal">
        <div class="popup-head">
          <div id="historialTitle" class="popup-title"></div>
          <button id="historialClose" type="button" class="popup-close">✕</button>
        </div>
        <div id="historialBody" class="historial-body"></div>
      </div>
    </div>
  `;

  const popupOverlay = document.getElementById("popupOverlay");
  const popupTitle = document.getElementById("popupTitle");
  const popupBody = document.getElementById("popupBody");
  const popupClose = document.getElementById("popupClose");

  const historialOverlay = document.getElementById("historialOverlay");
  const historialTitle = document.getElementById("historialTitle");
  const historialBody = document.getElementById("historialBody");
  const historialClose = document.getElementById("historialClose");

  resultEl.querySelectorAll(".mini-popup-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const title = btn.dataset.popupTitle || "";
      const allItems = String(btn.dataset.popupItems || "").split("|").filter(x => x.trim());
      const ultimasCinco = allItems.slice(-5).reverse();

      popupTitle.textContent = title;
      popupBody.innerHTML = ultimasCinco
        .map(x => `<div class="popup-line">${escapeHtml(x)}</div>`)
        .join("");

      if (allItems.length > 5){
        popupBody.innerHTML += `
          <div style="margin-top:12px; text-align:center;">
            <button id="btnVerHistorial" type="button" class="btn-ver-historial">Ver Historial</button>
          </div>
        `;
        document.getElementById("btnVerHistorial").addEventListener("click", () => {
          popupOverlay.classList.add("hidden");
          mostrarHistorialCompleto(title, allItems);
        });
      }
      popupOverlay.classList.remove("hidden");
    });
  });

  function mostrarHistorialCompleto(title, items){
    historialTitle.textContent = title;
    historialBody.innerHTML = items
      .slice()
      .reverse()
      .map(x => `<div class="popup-line">${escapeHtml(x)}</div>`)
      .join("");
    historialOverlay.classList.remove("hidden");
  }

  popupClose.addEventListener("click", () => popupOverlay.classList.add("hidden"));
  popupOverlay.addEventListener("click", e => { if (e.target === popupOverlay) popupOverlay.classList.add("hidden"); });
  historialClose.addEventListener("click", () => historialOverlay.classList.add("hidden"));
  historialOverlay.addEventListener("click", e => { if (e.target === historialOverlay) historialOverlay.classList.add("hidden"); });
}

function volverALista(){
  proveedorActivo = "";
  resultEl.innerHTML = "";
  btnVolver.classList.add("hidden");
  searchRow.classList.add("hidden");
  txtBuscar.value = "";
  datosParaFiltro = [];
  renderProveedores();
  setStatus("Seleccioná un proveedor.");
}

/* EVENTS */
btnVolver.addEventListener("click", volverALista);
txtBuscar.addEventListener("input", () => { if (proveedorActivo) renderFilasFiltradas(); });

/* INIT */
async function init(){
  try {
    await cargarAliasProveedor();
    provsList = await cargarProveedores();
    renderProveedores();
    setStatus(provsList.length ? "Seleccioná un proveedor." : "No hay proveedores cargados.");
  } catch (e){
    console.error(e);
    setStatus("Error cargando proveedores: " + (e.message || e));
  }
}

init();
