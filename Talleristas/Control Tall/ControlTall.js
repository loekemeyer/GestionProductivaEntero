const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const talleristasGrid = document.getElementById("talleristasGrid");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const btnVolver = document.getElementById("btnVolver");
const searchRow = document.getElementById("searchRow");
const txtBuscarTall = document.getElementById("txtBuscarTall");

let consumosCache = null;
let consumoDescCache = null; // cod → desc del articulo (de E. Madre LK/CH) — usado por popup Cons x Parte
let proporcionCache = null; // { proporciones: Map<cod_art__tallNorm, prop>, talleristasPorArticulo: Map<cod_art, Set<tallNorm>> }
let sectoresCache = null;
let stockTalleristaCache = null;
let entregasCache = null;
let enviosCache = null;
let devolucionesCache = null;
let sectoresPorTalleristaCache = null;
let articulosCajasCache = null;
let cajasCache = null;
let cajasExcluidasCache = null;

let talleristaActivo = "";
let listaTalleristas = [];
let filasRenderizadas = [];
let datosParaFiltro = [];

// Mapeo de artículos GRJ a sus componentes. Se carga desde tabla Supabase "GRJ_Componentes"
// via cargarGRJDesdeBD(). NO hay fallback hardcoded — si BD falla, el modulo muestra error
// explicito en lugar de operar con datos viejos (regla: single source of truth en BD).
let GRJ_COMPONENTES = {};

// Inverso de GRJ_COMPONENTES: componente → Set de GRJs que lo contienen.
// Ej: A10 → {GRJ7}, C10 → {GRJ1, GRJ7, GRJ9}, V9 → {GRJ1, GRJ7, GRJ9}.
let COMPONENTE_A_GRJS = new Map();
function rebuildComponenteAGrjs(){
  COMPONENTE_A_GRJS = new Map();
  for (const grj of Object.keys(GRJ_COMPONENTES)){
    (GRJ_COMPONENTES[grj] || []).forEach(comp => {
      if (!COMPONENTE_A_GRJS.has(comp)) COMPONENTE_A_GRJS.set(comp, new Set());
      COMPONENTE_A_GRJS.get(comp).add(grj);
    });
  }
}
rebuildComponenteAGrjs();

// Transformaciones 1:1 SC→SP (Poly cromado) y armado afila Martin (F7→Toch).
// Se derivan de GRJ_Componentes.es_transformacion_unidades=TRUE en cargarGRJDesdeBD.
// En Control Tall:
//   - Fila SC (M6/M8/F7): cuenta solo entregas Cod=articulo, NUNCA Cod=SP/Toch via expansion.
//   - Fila SP (M10/M9): cuenta solo entregas Cod=SP (las que vienen de la transformacion).
let TRANSFORMACION_SCS = new Set();
let TRANSFORMACION_SP_TO_SC = {};
// Envíos remap: M6→M5, M8→M7 (cromado via PS Pedernera).
// Envíos cargados con sector M6/M8 se muestran en la fila M5/M7.
const TRANSFORMACION_ENVIOS_ORIGEN = { M5: ['M6'], M7: ['M8'] };
// SC ocultos: entregas absorbidas por su SP (M6→M10, M8→M9). Filas M6/M8 no se renderizan.
const TRANSFORMACION_SC_OCULTAR = new Set(['M6', 'M8']);
function rebuildTransformaciones(){
  TRANSFORMACION_SP_TO_SC = {};
  TRANSFORMACION_SCS.forEach(sc => {
    const comps = GRJ_COMPONENTES[sc];
    if (comps && comps.length === 1) TRANSFORMACION_SP_TO_SC[comps[0]] = sc;
  });
}

let grjCargadoCache = null; // Promise (cache) para que multiples llamadas paralelas compartan resultado
function cargarGRJDesdeBD(){
  if (grjCargadoCache) return grjCargadoCache;
  grjCargadoCache = (async () => {
    const { data, error } = await supabaseClient.from("GRJ_Componentes").select("cod_grj,componente,orden,es_transformacion_unidades");
    if (error) {
      grjCargadoCache = null; // permitir reintento en proxima llamada
      throw new Error("Error al leer GRJ_Componentes: " + error.message);
    }
    if (!data || !data.length) {
      grjCargadoCache = null;
      throw new Error("Tabla GRJ_Componentes vacia — no se puede operar sin datos de GRJ.");
    }
    const comp = {};
    const transformacionScs = new Set();
    for (const r of data){
      if (!comp[r.cod_grj]) comp[r.cod_grj] = [];
      comp[r.cod_grj].push({ c: r.componente, o: r.orden||0 });
      if (r.es_transformacion_unidades) transformacionScs.add(r.cod_grj);
    }
    GRJ_COMPONENTES = {};
    for (const cod of Object.keys(comp)){
      GRJ_COMPONENTES[cod] = comp[cod].sort((a,b)=>a.o-b.o).map(x=>x.c);
    }
    TRANSFORMACION_SCS = transformacionScs;
    rebuildComponenteAGrjs();
    rebuildTransformaciones();
  })();
  return grjCargadoCache;
}

// Partes crudas de Martin: el consumo se infiere del consumo (E. Madre) de los artículos finales
// que las usan. KF2 y V3C son comunes a 520 y 521. KF8 solo va al 521. LF16 solo al 520.
// NOTA: este mapeo NO se puede derivar de Despiece x Articulo — los crudos son sectores
// intermedios en la cadena Causa-Efecto, no aparecen como Sector Proce de articulos numericos.
// Pendiente migrar a tabla "Crudos_Inferencia" en BD para gestionar via SQL en lugar de codigo.
const CRUDOS_MARTIN_CONSUMO = {
  KF2:  ["520","521"],
  KF8:  ["521"],
  LF16: ["520"],
  V3C:  ["520","521"]
};

function setStatus(t){
  statusEl.textContent = t || "";
}

function escapeHtml(s){
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

function formatEntero(n){
  return Math.round(Number(n || 0)).toLocaleString("es-AR");
}

function formatKgUni(n){
  const v = Number(n || 0);
  if (v === 0) return "0";
  return v.toLocaleString("es-AR", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
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

// Normaliza fechas a DD/MM/YYYY. Envíos guardan "DD/MM" sin año (asumir año actual).
// Entregas guardan "YYYY-MM-DD" o ISO. Otros formatos vuelven tal cual.
function formatFechaDDMMAAAA(s){
  const v = String(s || "").trim();
  if (!v) return "";
  const isoFull = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoFull) return `${isoFull[3]}/${isoFull[2]}/${isoFull[1]}`;
  const ddmm = v.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (ddmm){
    const dd = ddmm[1].padStart(2,"0");
    const mm = ddmm[2].padStart(2,"0");
    return `${dd}/${mm}/${new Date().getFullYear()}`;
  }
  const ddmmyyyy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) return `${ddmmyyyy[1].padStart(2,"0")}/${ddmmyyyy[2].padStart(2,"0")}/${ddmmyyyy[3]}`;
  return v;
}

function pick(obj, keys){
  for (const k of keys){
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)){
      return obj[k];
    }
  }
  return undefined;
}

function normalizeCode(value){
  if (value === null || value === undefined) return "";

  let raw = String(value).trim();
  if (!raw) return "";

  // Códigos alfanuméricos (A10, GRJ7, PC2A, etc.): devolver tal cual
  if (/[a-zA-Z]/.test(raw)) return raw;

  raw = raw.replace(",", ".");

  const num = Number(raw);
  if (Number.isFinite(num)){
    return String(Math.trunc(num)).padStart(3, "0");
  }

  raw = raw.replace(/\s+/g, "");
  raw = raw.replace(/[.,]0+$/, "");

  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";

  return digits.padStart(3, "0");
}

function splitCodes(value){
  return String(value || "")
    .split(",")
    .map(x => normalizeCode(x))
    .filter(Boolean);
}

function parseConsumo(value){
  if (value === null || value === undefined || value === "") return 0;

  if (typeof value === "number"){
    return Number.isFinite(value) ? value : 0;
  }

  let s = String(value).trim();
  if (!s || s === "-" || s === "—") return 0;

  s = s.replace(/[^\d,.-]/g, "");

  if (s.includes(",")){
    s = s.replace(/,/g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
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

function parseFechaDDMM(value){
  const s = String(value || "").trim();
  if (!s) return null;

  // Acepta DD/MM o DD/MM/YYYY (year se ignora para sort, usado solo en formatFechaDDMMAAAA)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{4})?$/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);

  if (!dd || !mm) return null;

  return { dd, mm };
}

function sortKeyFechaDDMM(value){
  const p = parseFechaDDMM(value);
  if (!p) return 9999;
  return (p.mm * 100) + p.dd;
}

// Sort cronologico real (con año) — acepta ISO YYYY-MM-DD, DD/MM/YYYY y DD/MM (asume año actual).
// Usado en popup Saldo para intercalar envios (DD/MM) con entregas (ISO o DD/MM) por fecha real.
function sortKeyFechaCron(value){
  const s = String(value || "").trim();
  if (!s) return 99999999;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Number(iso[1]) * 10000 + Number(iso[2]) * 100 + Number(iso[3]);
  const ddmmyyyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) return Number(ddmmyyyy[3]) * 10000 + Number(ddmmyyyy[2]) * 100 + Number(ddmmyyyy[1]);
  const ddmm = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (ddmm) return new Date().getFullYear() * 10000 + Number(ddmm[2]) * 100 + Number(ddmm[1]);
  return 99999999;
}

function elegirConsumo(ch, lk){
  const a = Number(ch || 0);
  const b = Number(lk || 0);

  if (a > 0 && b === 0) return a;
  if (b > 0 && a === 0) return b;
  if (a > 0 && b > 0) return Math.max(a, b);
  return 0;
}

function normalizeText(value){
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function renderTalleristas(lista){
  talleristasGrid.innerHTML = "";

  if (lista.length > 1){
    const btnTodos = document.createElement("button");
    btnTodos.type = "button";
    btnTodos.className = "tallerista-btn btn-todos";
    btnTodos.textContent = "TODOS";
    btnTodos.addEventListener("click", () => seleccionarTodos());
    talleristasGrid.appendChild(btnTodos);
  }

  lista.forEach(nombre => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tallerista-btn";
    btn.textContent = nombre;

    if (nombre === talleristaActivo){
      btn.classList.add("active");
    }

    btn.addEventListener("click", () => seleccionarTallerista(nombre));
    talleristasGrid.appendChild(btn);
  });
}

function seleccionarTallerista(nombre){
  talleristaActivo = nombre;
  renderTalleristas([nombre]);
  btnVolver.classList.remove("hidden");
  searchRow.classList.remove("hidden");
  txtBuscarTall.value = "";
  buscar(nombre);
}

async function seleccionarTodos(){
  talleristaActivo = "__TODOS__";
  renderTalleristas([]);
  btnVolver.classList.remove("hidden");
  searchRow.classList.remove("hidden");
  txtBuscarTall.value = "";
  resultEl.innerHTML = "";
  setStatus("Cargando todos los talleristas...");

  const { data, error } = await supabaseClient
    .from("v_piezas_por_tallerista_resumen")
    .select("*")
    .limit(5000);

  if (error){
    console.error(error);
    setStatus("Error al cargar: " + (error.message || "sin detalle"));
    return;
  }

  let sectoresData;
  try {
    sectoresData = await cargarSectores();
  } catch(err){
    console.error(err);
    setStatus(err.message || "Error al cargar sectores");
    return;
  }

  const porTallerista = new Map();

  (data || []).forEach(r => {
    const tall = String(pick(r, ["Tallerista", "tallerista", "TALLERISTA"]) || "").trim();
    if (!tall) return;
    if (!porTallerista.has(tall)) porTallerista.set(tall, []);

    const descripcion = String(pick(r, ["pieza", "Pieza", "PIEZA"]) || "").trim();
    const codsRaw = String(pick(r, ["cod_articulos", "Cod_articulos", "COD_ARTICULOS"]) || "");
    const codigos = splitCodes(codsRaw);
    const sectorProce = obtenerSectorProce(descripcion, codigos, sectoresData);
    const kgXUni = obtenerKgXUni(descripcion, codigos, sectoresData);
    const kgXCajon = obtenerKgXCajon(descripcion, codigos, sectoresData);

    porTallerista.get(tall).push({ descripcion, codsRaw, codigos, sectorProce, kgXUni, kgXCajon });
  });

  const tallOrdenados = [...porTallerista.keys()].sort((a, b) => a.localeCompare(b, "es"));

  todosDatosFiltro = [];
  tallOrdenados.forEach(tall => {
    const piezas = porTallerista.get(tall);
    piezas.sort((a, b) => a.descripcion.localeCompare(b.descripcion, "es"));
    piezas.forEach(p => {
      todosDatosFiltro.push({ tallerista: tall, ...p });
    });
  });

  renderTodosFiltrados();
}

function renderTodosFiltrados(){
  const q = normalizeText(txtBuscarTall.value);
  const filtrados = !q ? todosDatosFiltro : todosDatosFiltro.filter(d => {
    return normalizeText(d.tallerista).includes(q) ||
           normalizeText(d.sectorProce).includes(q) ||
           normalizeText(d.descripcion).includes(q) ||
           normalizeText(d.codsRaw).includes(q);
  });

  const porTall = new Map();
  filtrados.forEach(d => {
    if (!porTall.has(d.tallerista)) porTall.set(d.tallerista, []);
    porTall.get(d.tallerista).push(d);
  });

  let rows = "";
  for (const [tall, piezas] of porTall.entries()){
    rows += `<tr class="grupo-header"><td colspan="6">${escapeHtml(tall)} (${piezas.length})</td></tr>`;
    piezas.forEach(d => {
      rows += `
        <tr>
          <td class="center">${d.sectorProce ? escapeHtml(d.sectorProce) : '<span class="zero">-</span>'}</td>
          <td class="center" title="${escapeHtml(d.descripcion)}">${escapeHtml(d.descripcion)}</td>
          <td class="mono center">${d.codsRaw ? escapeHtml(d.codsRaw) : '<span class="zero">-</span>'}</td>
          <td class="center"><b>${escapeHtml(formatKgUni(d.kgXUni))}</b></td>
          <td class="center"><b>${escapeHtml(formatEntero(d.kgXCajon))}</b></td>
        </tr>`;
    });
  }

  setStatus(`${filtrados.length} partes en ${porTall.size} talleristas`);

  resultEl.innerHTML = `
    <div class="articulo">
      <div class="articulo-header">Todos los Talleristas</div>
      <div class="todos-scroll">
        <table class="table table-todos">
          <thead>
            <tr>
              <th>Sector</th>
              <th>Descripcion</th>
              <th>Codigos</th>
              <th>Kg x Uni</th>
              <th>Kg x Cajon</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;
}

let todosDatosFiltro = [];

function volverALista(){
  talleristaActivo = "";
  resultEl.innerHTML = "";
  datosParaFiltro = [];
  todosDatosFiltro = [];
  setStatus("Seleccioná un tallerista");
  btnVolver.classList.add("hidden");
  searchRow.classList.add("hidden");
  txtBuscarTall.value = "";
  renderTalleristas(listaTalleristas);
}

btnVolver.addEventListener("click", volverALista);

async function cargarTalleristas(){
  setStatus("Cargando talleristas...");
  resultEl.innerHTML = "";

  const { data, error } = await supabaseClient
    .from("v_piezas_por_tallerista_resumen")
    .select("*")
    .limit(5000);

  if (error){
    console.error(error);
    setStatus("Error al cargar los talleristas: " + (error.message || "sin detalle"));
    return;
  }

  listaTalleristas = [...new Set(
    (data || [])
      .map(r => String(pick(r, ["Tallerista", "tallerista", "TALLERISTA"]) || "").trim())
      .filter(Boolean)
  )]
    .filter(t => !PROVEEDORES_ART_TERMINADO.has(t))
    .sort((a, b) => a.localeCompare(b, "es"));

  renderTalleristas(listaTalleristas);
  setStatus(listaTalleristas.length ? "Seleccioná un tallerista" : "No se encontraron talleristas");
}

async function cargarConsumos(){
  if (consumosCache) return consumosCache;

  const [respCH, respLK] = await Promise.all([
    supabaseClient.from("E. Madre CH").select("*").limit(10000),
    supabaseClient.from("E. Madre LK").select("*").limit(10000)
  ]);

  if (respCH.error){
    console.error(respCH.error);
    throw new Error("Error al leer E. Madre CH");
  }

  if (respLK.error){
    console.error(respLK.error);
    throw new Error("Error al leer E. Madre LK");
  }

  const mapCH = new Map();
  const mapLK = new Map();
  const finalMap = new Map();
  const descMap = new Map(); // cod → desc (para mostrar en popup Cons x Parte)

  function cargarEnMapa(rows, mapDestino){
    (rows || []).forEach(r => {
      const codRaw =
        r.Cod ??
        r.cod ??
        r.COD ??
        r.codigo ??
        r["Cod"] ??
        r["COD"];

      const consumoRaw =
        r["E. Madre"] ??
        r["E_Madre"] ??
        r["e_madre"] ??
        r["e madre"] ??
        r["E_MADRE"] ??
        r.consumo;

      const descRaw =
        r.Desc ??
        r.desc ??
        r.DESC ??
        r["Desc"] ??
        r["Descripcion"] ??
        r["descripcion"];

      const cod = normalizeCode(codRaw);
      const consumo = parseConsumo(consumoRaw);

      if (!cod) return;
      mapDestino.set(cod, consumo);
      if (descRaw && !descMap.has(cod)) {
        descMap.set(cod, String(descRaw).trim());
      }
    });
  }

  cargarEnMapa(respCH.data, mapCH);
  cargarEnMapa(respLK.data, mapLK);

  const todosLosCodigos = new Set([
    ...mapCH.keys(),
    ...mapLK.keys()
  ]);

  todosLosCodigos.forEach(cod => {
    finalMap.set(cod, elegirConsumo(mapCH.get(cod), mapLK.get(cod)));
  });

  // Consumo inferido para crudas de Martin: suma del consumo de los artículos finales.
  for (const [crudo, codsBase] of Object.entries(CRUDOS_MARTIN_CONSUMO)) {
    let suma = 0;
    codsBase.forEach(c => { suma += Number(finalMap.get(c) || 0); });
    if (suma > 0) finalMap.set(crudo, suma);
  }

  consumosCache = finalMap;
  consumoDescCache = descMap;
  return finalMap;
}

// Helper: paginar para evitar cap 1000 de Supabase + safety net contra loops infinitos
async function fetchAllPaginated(table, selectCols = "*"){
  const out = [];
  const PAGE = 1000;
  const MAX_PAGES = 100; // 100k filas max — safety net contra runaway loops
  let from = 0;
  for (let page = 0; page < MAX_PAGES; page++){
    const { data, error } = await supabaseClient.from(table).select(selectCols).range(from, from + PAGE - 1);
    if (error){ console.error(error); throw new Error(`${table}: ${error.message}`); }
    if (!data || !data.length) return out;
    out.push(...data);
    if (data.length < PAGE) return out;
    from += PAGE;
    if (page === MAX_PAGES - 1) {
      console.warn(`[fetchAllPaginated] ${table}: alcanzo MAX_PAGES=${MAX_PAGES}, posible cap excedido. Filas: ${out.length}`);
    }
  }
  return out;
}

async function cargarSectores(){
  if (sectoresCache) return sectoresCache;

  const data = await fetchAllPaginated("Despiece x Articulo");
  const error = null;
  if (error){
    console.error(error);
    throw new Error("Error al leer Despiece x Articulo");
  }

  const mapByCodeAndPart = new Map();
  const mapByPart = new Map();

  const kgXCajonByCodeAndPart = new Map();
  const kgXCajonByPart = new Map();

  const kgXUniByCodeAndPart = new Map();
  const kgXUniByPart = new Map();

  const partesXUniByCodeAndPart = new Map();
  const partesXUniByPart = new Map();

  // Rubro por sector y por parte (por mayoría de frecuencia, para ignorar datos sucios)
  const rubroCountsBySector = new Map(); // sector → { rubro: count }
  const rubroCountsByPart = new Map();   // parte → { rubro: count }

  (data || []).forEach(r => {
    const cod = normalizeCode(pick(r, ["COD", "Cod", "cod"]));
    const parte = normalizeText(pick(r, ["Descripcion de partes", "Descripción de partes", "descripcion de partes"]));
    const sector = String(pick(r, ["Sector Proce", "sector proce", "Sector_Proce"]) || "").trim();
    const rubro = String(pick(r, ["Rubro", "rubro", "RUBRO"]) || "").trim();

    const kgXCajon = parseDecimal(pick(r, ["Kg x Caj", "KG x Caj", "kg x caj", "Kg x caja", "kg x caja"]));
    const kgXUni = parseDecimal(pick(r, ["KGxUni", "KGxUNI", "KgxUni", "KgXUni", "kgxuni", "KG x Uni", "Kg x Uni", "kg x uni"]));
    const partesXUni = parseDecimal(pick(r, ["Partes x uni", "Partes x Uni", "partes x uni", "PartesXUni"]));

    if (!parte) return;

    if (!mapByPart.has(parte)) mapByPart.set(parte, new Set());
    if (sector) mapByPart.get(parte).add(sector);

    if (sector && rubro) {
      if (!rubroCountsBySector.has(sector)) rubroCountsBySector.set(sector, {});
      const counts = rubroCountsBySector.get(sector);
      counts[rubro] = (counts[rubro] || 0) + 1;
    }
    if (rubro) {
      if (!rubroCountsByPart.has(parte)) rubroCountsByPart.set(parte, {});
      const counts = rubroCountsByPart.get(parte);
      counts[rubro] = (counts[rubro] || 0) + 1;
    }

    if (cod && sector){
      const key = `${cod}__${parte}`;
      if (!mapByCodeAndPart.has(key)) mapByCodeAndPart.set(key, sector);
    }

    if (cod){
      const key = `${cod}__${parte}`;

      if (!kgXCajonByCodeAndPart.has(key)) kgXCajonByCodeAndPart.set(key, kgXCajon);
      if (!kgXUniByCodeAndPart.has(key)) kgXUniByCodeAndPart.set(key, kgXUni);
      if (!partesXUniByCodeAndPart.has(key)) partesXUniByCodeAndPart.set(key, partesXUni);
    }

    if (!kgXCajonByPart.has(parte)) kgXCajonByPart.set(parte, kgXCajon);
    if (!kgXUniByPart.has(parte)) kgXUniByPart.set(parte, kgXUni);
    if (!partesXUniByPart.has(parte)) partesXUniByPart.set(parte, partesXUni);
  });

  // Mapa sector_parte → sectores GRJ que contienen artículos con esa parte
  // Ej: sector "C10" está en artículos 500, 506, 510. Esos artículos tienen GRJ1, GRJ7, GRJ9.
  // Entonces grjPorSector.get("C10") = Set{"GRJ1","GRJ7","GRJ9"}
  const codsPorSector = new Map(); // sector → Set de CODs numéricos que usan esa parte
  const grjPorCod = new Map(); // cod → sector GRJ
  const articuloPorGrj = new Map(); // sector GRJ → Set<cod articulo armado> (puede ser multi, ej GRJ10 → {544, 802})
  const kgXUniBySector = new Map(); // sector → kgXUni (primer valor no-cero del despiece)
  // Derivacion: para cada GRJ X, el articulo es el COD numerico que tiene Sector Proce=X en su despiece.
  // Ej: GRJ7 → 506 (COD 506 tiene fila con Sector Proce=GRJ7).
  // Esto deriva de Despiece x Articulo sin tabla nueva.
  (data || []).forEach(r => {
    const cod = normalizeCode(pick(r, ["COD", "Cod", "cod"]));
    const sector = String(pick(r, ["Sector Proce", "sector proce", "Sector_Proce"]) || "").trim();
    if (!cod || !sector) return;
    // Registrar en codsPorSector para TODOS los sectores (incluido GRJ/CP)
    if (/^\d+$/.test(cod)) {
      if (!codsPorSector.has(sector)) codsPorSector.set(sector, new Set());
      codsPorSector.get(sector).add(cod);
    }
    if (sector.toUpperCase().startsWith("GRJ") || sector.toUpperCase().startsWith("CP")) {
      grjPorCod.set(cod, sector);
    }
    // articuloPorGrj: GRJ aparece como Sector Proce en el despiece del articulo armado
    // (excluir self-reference: COD=GRJ con Sector Proce=GRJ es la fila del propio GRJ).
    // Multi-articulo: GRJ10 → {544, 802} porque ambos articulos comparten la misma armadura.
    if (sector.toUpperCase().startsWith("GRJ") && /^\d+$/.test(cod)) {
      if (!articuloPorGrj.has(sector)) articuloPorGrj.set(sector, new Set());
      articuloPorGrj.get(sector).add(cod);
    }
    // kgXUniBySector: primer valor no-cero por sector (ignora rows con COD=sector mismo y peso=0)
    const kgU = parseDecimal(pick(r, ["KGxUni", "KGxUNI", "KgxUni", "KgXUni", "kgxuni", "KG x Uni", "Kg x Uni", "kg x uni"]));
    if (kgU > 0 && !kgXUniBySector.has(sector)) {
      kgXUniBySector.set(sector, kgU);
    }
  });
  const grjPorSector = new Map();
  for (const [sector, cods] of codsPorSector) {
    const grjs = new Set();
    cods.forEach(cod => {
      const grj = grjPorCod.get(cod);
      if (grj) grjs.add(grj);
    });
    if (grjs.size > 0) grjPorSector.set(sector, grjs);
  }

  // Resolver rubro mayoritario por sector y por parte (ignora filas con dato sucio)
  // En caso de empate, priorizar "Otros" (default seguro) sobre "Remaches" para evitar falsos positivos
  function rubroMayoritario(counts){
    let mejor = "";
    let mejorCount = 0;
    for (const [rubro, n] of Object.entries(counts || {})) {
      if (n > mejorCount) { mejor = rubro; mejorCount = n; }
      else if (n === mejorCount && rubro === "Otros") { mejor = rubro; }
    }
    return mejor;
  }
  const rubroBySector = new Map();
  for (const [sector, counts] of rubroCountsBySector) {
    const r = rubroMayoritario(counts);
    if (r) rubroBySector.set(sector, r);
  }
  const rubroByPart = new Map();
  for (const [parte, counts] of rubroCountsByPart) {
    const r = rubroMayoritario(counts);
    if (r) rubroByPart.set(parte, r);
  }

  sectoresCache = {
    mapByCodeAndPart,
    mapByPart,
    kgXCajonByCodeAndPart,
    kgXCajonByPart,
    kgXUniByCodeAndPart,
    kgXUniByPart,
    partesXUniByCodeAndPart,
    partesXUniByPart,
    grjPorCod,
    grjPorSector,
    articuloPorGrj,
    kgXUniBySector,
    codsPorSector,
    rubroBySector,
    rubroByPart
  };

  return sectoresCache;
}

// Carga Proporcion_Articulo_Tallerista + construye talleristasPorArticulo desde Articulos VxT.
// proporciones: Map clave="cod_art__talleristaNormalizado" → Number(0-1).
// talleristasPorArticulo: Map cod_art numerico → Set<talleristaNormalizado> (incluye match
// directo numerico + match via GRJ→articulo usando sectoresCache.articuloPorGrj).
// Usado por buscar() para filtrar/proporcionar el Cons x Parte de cada pieza.
async function cargarProporciones(){
  if (proporcionCache) return proporcionCache;
  const sectoresData = await cargarSectores();
  const [respProp, respVxT] = await Promise.all([
    fetchAllPaginated("Proporcion_Articulo_Tallerista").then(d => ({ data: d, error: null })),
    fetchAllPaginated("Articulos Virgilio X Tallerista", "Tallerista,Cod_Art").then(d => ({ data: d, error: null }))
  ]);
  if (respProp.error) throw new Error("Proporcion_Articulo_Tallerista: " + respProp.error.message);
  if (respVxT.error) throw new Error("Articulos VxT (proporciones): " + respVxT.error.message);

  const proporciones = new Map();
  (respProp.data || []).forEach(r => {
    const cod = String(r.cod_art || "").trim();
    const tall = normalizeText(r.tallerista || "");
    if (!cod || !tall) return;
    proporciones.set(`${cod}__${tall}`, Number(r.proporcion || 0));
  });

  const talleristasPorArticulo = new Map();
  (respVxT.data || []).forEach(r => {
    const tall = normalizeText(pick(r, ["Tallerista", "tallerista", "TALLERISTA"]) || "");
    const codArt = String(pick(r, ["Cod_Art", "cod_art", "COD_ART"]) || "").trim();
    if (!tall || !codArt) return;
    const agregar = (art) => {
      if (!talleristasPorArticulo.has(art)) talleristasPorArticulo.set(art, new Set());
      talleristasPorArticulo.get(art).add(tall);
    };
    if (/^\d+$/.test(codArt)) {
      agregar(codArt);
    } else if (/^(GRJ|CP)/i.test(codArt)) {
      const arts = sectoresData.articuloPorGrj && sectoresData.articuloPorGrj.get(codArt);
      if (arts && arts.size) arts.forEach(art => agregar(art));
    }
  });

  // articulosFacturasPorTallerista: tallerista_norm → Set<cod_art con destino_entrega=facturas>
  // Usado para filtrar Maspoli/Pintos en Control Tall (solo mostrar piezas relacionadas a facturas)
  const respFact = await supabaseClient
    .from("Articulos Virgilio X Tallerista")
    .select('"Tallerista","Cod_Art"')
    .eq("destino_entrega", "facturas");
  const articulosFacturasPorTallerista = new Map();
  if (!respFact.error && respFact.data) {
    respFact.data.forEach(r => {
      const tall = normalizeText(r["Tallerista"] || "");
      const cod = String(r["Cod_Art"] || "").trim();
      if (!tall || !cod) return;
      if (!articulosFacturasPorTallerista.has(tall)) articulosFacturasPorTallerista.set(tall, new Set());
      articulosFacturasPorTallerista.get(tall).add(cod);
    });
  }

  proporcionCache = { proporciones, talleristasPorArticulo, articulosFacturasPorTallerista };
  return proporcionCache;
}

async function cargarStockTallerista(){
  if (stockTalleristaCache) return stockTalleristaCache;

  const data = await fetchAllPaginated("Articulos Virgilio X Tallerista");
  const error = null;
  if (error){
    console.error(error);
    throw new Error("Error al leer Articulos Virgilio X Tallerista");
  }

  const stockByTalleristaAndCode = new Map();

  (data || []).forEach(r => {
    const tallerista = normalizeText(pick(r, ["Tallerista", "tallerista", "TALLERISTA"]));
    const cod = normalizeCode(pick(r, ["Cod_Art", "Cod Art", "cod_art", "cod_articulo", "Cod"]));
    const stock = parseDecimal(pick(r, ["Stock Online", "stock online", "Stock_Online", "stock_online"]));

    if (!tallerista || !cod) return;

    const key = `${tallerista}__${cod}`;
    stockByTalleristaAndCode.set(key, (stockByTalleristaAndCode.get(key) || 0) + stock);
  });

  stockTalleristaCache = stockByTalleristaAndCode;
  return stockTalleristaCache;
}

async function cargarEntregas(){
  if (entregasCache) return entregasCache;

  const [entregasData, partesData] = await Promise.all([
    fetchAllPaginated("Entregas_Tall_Todas"),
    fetchAllPaginated("Partes x Tallerista")
  ]);
  const respEntregas = { data: entregasData, error: null };
  const respPartes = { data: partesData, error: null };

  if (respEntregas.error){
    console.error(respEntregas.error);
    throw new Error("Error al leer Entregas Tallerista Virgilio");
  }

  if (respPartes.error){
    console.error(respPartes.error);
    throw new Error("Error al leer Partes x Tallerista");
  }

  const uniXCajaByNombreTallAndCod = new Map();
  const uniXCajaBySector = new Map(); // tallerista__cod__sector → uniXCaja (por parte específica)
  const sectorByTallAndCod = new Map(); // tallerista__cod → sector (primer sector encontrado)
  const stockInicialByTallAndSectorAndDesc = new Map(); // tallerista__sector__descParte → kg (por pieza, no por sector)
  const _sectoresPorTall = new Map();

  (respPartes.data || []).forEach(r => {
    const nombreTall = normalizeText(
      pick(r, ["tallerista", "Tallerista", "TALLERISTA"])
    );

    const uniXCaja = parseDecimal(
      pick(r, ["uni_x_cja", "Uni_x_cja", "UNI_X_CJA", "uni x cja"])
    );

    const sectorProce = String(pick(r, ["sector_proce", "Sector_Proce", "Sector Proce"]) || "").trim();
    const descParte = normalizeText(pick(r, ["descripcion_parte", "Descripcion_parte"]) || "");

    const codigosParte = [
      normalizeCode(pick(r, ["cod_art", "Cod_Art", "COD_ART"]))
    ].filter(Boolean);

    if (!nombreTall || !codigosParte.length) return;

    if (sectorProce) {
      if (!_sectoresPorTall.has(nombreTall)) _sectoresPorTall.set(nombreTall, new Set());
      _sectoresPorTall.get(nombreTall).add(sectorProce);

      // stock_inicial por sector + descripcion de parte (clave única por pieza,
      // no solo por sector — sin esto, varias piezas que comparten sector
      // (ej: Arandela Chica + Cartón 530 ambas en E3) levantaban el mismo stock
      // de la primera fila encontrada).
      const stockIni = parseDecimal(pick(r, ["stock_inicial", "Stock_Inicial"]));
      const siKey = `${nombreTall}__${sectorProce}__${descParte}`;
      if (stockIni > 0 && !stockInicialByTallAndSectorAndDesc.has(siKey)) {
        stockInicialByTallAndSectorAndDesc.set(siKey, stockIni);
      }
    }

    codigosParte.forEach(cod => {
      // uniXCaja por sector (para calcular entregas por parte específica)
      if (sectorProce) {
        const sectorKey = `${nombreTall}__${cod}__${normalizeText(sectorProce)}`;
        if (!uniXCajaBySector.has(sectorKey)) uniXCajaBySector.set(sectorKey, uniXCaja);
        // sector por tallerista+cod (fallback para artículos SC que no están en Despiece)
        const tallCodKey = `${nombreTall}__${cod}`;
        if (!sectorByTallAndCod.has(tallCodKey)) sectorByTallAndCod.set(tallCodKey, sectorProce);
      }
      // uniXCaja por cod (fallback): excluir cartones (que tienen uni_x_cja muy alto)
      const esCarton = descParte.startsWith("carton");
      if (!esCarton) {
        const key = `${nombreTall}__${cod}`;
        const actual = Number(uniXCajaByNombreTallAndCod.get(key) || 0);
        uniXCajaByNombreTallAndCod.set(key, Math.max(actual, Number(uniXCaja || 0)));
      }
    });
  });

  sectoresPorTalleristaCache = _sectoresPorTall;

  const detalleByNombreTallAndCod = new Map();
  const detalleByNombreTallAndCodGrj = new Map(); // index paralelo por Cod_GRJ (para transformaciones 1:1 — fila SC muestra entregas)
  const totalByNombreTallAndCod = new Map();

  (respEntregas.data || []).forEach(r => {
    const nombreTall = normalizeText(
      pick(r, ["Nombre_Tall", "nombre_tall", "NOMBRE_TALL"])
    );

    const cod = normalizeCode(
      pick(r, ["Cod", "cod", "COD"])
    );

    const cajas = parseDecimal(
      pick(r, ["Cajas", "cajas", "CAJAS"])
    );

    const fecha = String(
      pick(r, ["Fecha", "fecha", "FECHA"]) || ""
    ).trim();

    const codGrj = String(pick(r, ["Cod_GRJ", "cod_grj"]) || "").trim();
    const kgGrj  = parseDecimal(pick(r, ["Kg_GRJ", "kg_grj"]));

    if (!nombreTall || !cod || !cajas) return;

    const key = `${nombreTall}__${cod}`;
    const item = { fecha, cajas, cod, codGrj, kgGrj };

    if (!detalleByNombreTallAndCod.has(key)) detalleByNombreTallAndCod.set(key, []);
    detalleByNombreTallAndCod.get(key).push(item);

    // Para transformaciones 1:1, indexar tambien por Cod_GRJ
    // (ej. Cod=M10, Cod_GRJ=M6 → entrega visible en fila M6 que es lo que Poly devuelve realmente)
    if (codGrj) {
      const keyGrj = `${nombreTall}__${normalizeCode(codGrj)}`;
      if (!detalleByNombreTallAndCodGrj.has(keyGrj)) detalleByNombreTallAndCodGrj.set(keyGrj, []);
      detalleByNombreTallAndCodGrj.get(keyGrj).push(item);
    }
  });

  // ===== Talleristas via facturas: derivar entregas desde Entregas PS =====
  // Generico: para cada fila en Articulos VxT con destino_entrega='facturas' y sector_factura
  // definido, leemos Entregas PS donde Prov_Serv = nombre tallerista y Sector SP = sector_factura.
  // Convertimos kg → unidades dividiendo por kgxuni del sector (de sectoresData.kgXUniBySector).
  // codGrj seteado para que obtenerEntregasTallerista trate como esGrj=true (cajas = unidades).
  // Casos cubiertos hoy: Maspoli (PC12/PEP7), Pintos (GRJ12/GRJ12B/PA4).
  // Si en el futuro hay otro tallerista con destino=facturas, basta cargar sector_factura en BD.
  try {
    const sectoresFact = await cargarSectores();
    const respFacturas = await supabaseClient
      .from("Articulos Virgilio X Tallerista")
      .select('"Tallerista","Cod_Art","sector_factura"')
      .eq("destino_entrega", "facturas")
      .not("sector_factura", "is", null);

    if (!respFacturas.error && respFacturas.data && respFacturas.data.length) {
      // Agrupar por tallerista para minimizar queries: 1 query por tallerista
      const porTall = new Map(); // tallerista → { sectores: Set, articulosPorSector: Map<sector, cod> }
      respFacturas.data.forEach(r => {
        const tall = String(r["Tallerista"] || "").trim();
        const cod = String(r["Cod_Art"] || "").trim();
        const sector = String(r["sector_factura"] || "").trim();
        if (!tall || !cod || !sector) return;
        if (!porTall.has(tall)) porTall.set(tall, { sectores: new Set(), articulosPorSector: new Map() });
        const entry = porTall.get(tall);
        entry.sectores.add(sector);
        // Para sectores compartidos (PC12 con 508 y 564), pickear lowest numerico
        if (!entry.articulosPorSector.has(sector) || Number(cod) < Number(entry.articulosPorSector.get(sector))) {
          entry.articulosPorSector.set(sector, cod);
        }
      });

      for (const [tall, conf] of porTall.entries()) {
        try {
          const respPS = await supabaseClient
            .from("Entregas PS")
            .select("*")
            .eq("Prov_Serv", tall)
            .in("Sector SP", [...conf.sectores]);
          if (respPS.error) {
            console.error(`Error leyendo Entregas PS ${tall}:`, respPS.error);
            continue;
          }
          (respPS.data || []).forEach(r => {
            const sectorSP = String(r["Sector SP"] || "").trim();
            const kg = parseDecimal(r["KG"]);
            const fecha = String(r["Dia-mes"] || "").trim();
            const kgxuni = sectoresFact.kgXUniBySector.get(sectorSP);
            if (!kgxuni || kg <= 0) return;
            const unidades = Math.round(kg / kgxuni);
            if (unidades <= 0) return;
            const cod = conf.articulosPorSector.get(sectorSP);
            if (!cod) return;
            const tallNorm = normalizeText(tall);
            const key = `${tallNorm}__${cod}`;
            if (!detalleByNombreTallAndCod.has(key)) detalleByNombreTallAndCod.set(key, []);
            detalleByNombreTallAndCod.get(key).push({
              fecha,
              cajas: unidades,
              cod,
              codGrj: `${tall.toUpperCase()}-${sectorSP}`,
              kgGrj: kg
            });
          });
        } catch (e) {
          console.error(`Excepcion al leer Entregas PS ${tall}:`, e);
        }
      }
    } else if (respFacturas.error) {
      console.error("Error leyendo Articulos VxT facturas:", respFacturas.error);
    }
  } catch (e) {
    console.error("Excepcion en bloque facturas:", e);
  }

  for (const [key, arr] of detalleByNombreTallAndCod.entries()){
    arr.sort((a, b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));
    detalleByNombreTallAndCod.set(key, arr);
  }

  entregasCache = {
    detalleByNombreTallAndCod,
    detalleByNombreTallAndCodGrj,
    uniXCajaByNombreTallAndCod,
    uniXCajaBySector,
    sectorByTallAndCod,
    stockInicialByTallAndSectorAndDesc
  };

  return entregasCache;
}

async function cargarEnvios(){
  if (enviosCache) return enviosCache;

  // Paginar: Supabase tiene cap default de 1000 filas por query, .limit() no lo eleva
  // Safety net: MAX_PAGES=100 (100k filas max) para evitar runaway loops
  const data = await fetchAllPaginated("Envios a Talleristas");
  const error = null;
  if (error){
    console.error(error);
    throw new Error("Error al leer Envios a Talleristas");
  }

  const detalleMap = new Map();
  const totalKgMap = new Map();
  const totalUnidadesMap = new Map();
  const totalUniMap = new Map();
  // Index por sector (para remap M6→M5, M8→M7)
  const sectorDetalleMap = new Map();
  const sectorTotalKgMap = new Map();
  const sectorTotalUnidadesMap = new Map();

  (data || []).forEach(r => {
    const tallerista = normalizeText(pick(r, ["Tallerista", "tallerista", "TALLERISTA"]));
    const sector = normalizeText(pick(r, ["Sector", "sector", "SECTOR"]));
    const descripcion = normalizeText(pick(r, ["Descripcion", "descripcion", "DESCRIPCION", "Descripción"]));

    const fecha = String(
      pick(r, ["Dia-mes", "dia-mes", "DIA-MES", "Dia_mes"]) || ""
    ).trim();

    const kg = parseDecimal(pick(r, ["KG", "kg", "Kg"]));
    const cajones = parseDecimal(pick(r, ["Cajones", "cajones", "CAJONES", "Caj", "caj"]));
    const unidades = parseDecimal(pick(r, ["Unidades", "unidades", "UNIDADES"]));

    if (!tallerista || !descripcion) return;
    if (!kg && !cajones && !unidades) return;

    // Clave SIN sector: evita Online=0 si el sector en Despiece cambió desde el envio
    const key = `${tallerista}__${descripcion}`;

    if (!detalleMap.has(key)) detalleMap.set(key, []);
    detalleMap.get(key).push({ fecha, kg, cajones, unidades });

    totalKgMap.set(key, (totalKgMap.get(key) || 0) + kg);
    totalUnidadesMap.set(key, (totalUnidadesMap.get(key) || 0) + unidades);

    // Index por sector
    if (sector) {
      const secKey = `${tallerista}__${sector}`;
      if (!sectorDetalleMap.has(secKey)) sectorDetalleMap.set(secKey, []);
      sectorDetalleMap.get(secKey).push({ fecha, kg, cajones, unidades });
      sectorTotalKgMap.set(secKey, (sectorTotalKgMap.get(secKey) || 0) + kg);
      sectorTotalUnidadesMap.set(secKey, (sectorTotalUnidadesMap.get(secKey) || 0) + unidades);
    }
  });

  for (const [key, arr] of detalleMap.entries()){
    arr.sort((a, b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));
    detalleMap.set(key, arr);
  }

  enviosCache = {
    detalleMap,
    totalKgMap,
    totalUnidadesMap,
    totalUniMap,
    sectorDetalleMap,
    sectorTotalKgMap,
    sectorTotalUnidadesMap
  };

  return enviosCache;
}

async function cargarDevoluciones(){
  if (devolucionesCache) return devolucionesCache;

  const data = await fetchAllPaginated("Devoluciones Tallerista Cervantes");

  const detalleMap = new Map();
  const totalKgMap = new Map();

  (data || []).forEach(r => {
    const tall = normalizeText(r.Nombre_Tall || "");
    const sector = normalizeText(r.Sector || "");
    const desc = String(r.Descripcion || "").trim();
    const fecha = String(r.Fecha || "").trim();
    const kg = parseDecimal(r.Kg);
    const destino = String(r.destino || "").trim();

    if (!tall || !sector || !kg) return;

    const key = `${tall}__${sector}`;

    if (!detalleMap.has(key)) detalleMap.set(key, []);
    detalleMap.get(key).push({ fecha, kg, destino, desc });

    totalKgMap.set(key, (totalKgMap.get(key) || 0) + kg);
  });

  for (const [key, arr] of detalleMap.entries()){
    arr.sort((a, b) => sortKeyFechaCron(a.fecha) - sortKeyFechaCron(b.fecha));
  }

  devolucionesCache = { detalleMap, totalKgMap };
  return devolucionesCache;
}

async function cargarArticulosCajas(){
  if (articulosCajasCache) return articulosCajasCache;
  const { data, error } = await supabaseClient.from("Articulos_Cajas").select("*").limit(5000);
  if (error){ console.error(error); articulosCajasCache = []; return []; }
  articulosCajasCache = data || [];
  return articulosCajasCache;
}

async function cargarCajas(){
  if (cajasCache) return cajasCache;
  const { data, error } = await supabaseClient.from("Cajas").select("*").limit(500);
  if (error){ console.error(error); cajasCache = []; return []; }
  cajasCache = data || [];
  return cajasCache;
}

async function cargarCajasExcluidas(){
  if (cajasExcluidasCache) return cajasExcluidasCache;
  const { data, error } = await supabaseClient.from("cajas_excluidas_por_tallerista").select("tallerista, n_caja").limit(1000);
  if (error){ console.error(error); cajasExcluidasCache = new Map(); return cajasExcluidasCache; }
  const map = new Map();
  (data || []).forEach(r => {
    const tall = normalizeText(r.tallerista);
    const n = Number(r.n_caja || 0);
    if (!tall || !n) return;
    if (!map.has(tall)) map.set(tall, new Set());
    map.get(tall).add(n);
  });
  cajasExcluidasCache = map;
  return cajasExcluidasCache;
}

function obtenerCajasPorTallerista(filasTallerista, articulosCajas, cajasData, nombreTallerista, cajasExcluidasMap){
  const codsDelTallerista = new Set();
  filasTallerista.forEach(r => {
    const codsRaw = String(pick(r, ["cod_articulos", "Cod_articulos", "COD_ARTICULOS"]) || "");
    splitCodes(codsRaw).forEach(c => codsDelTallerista.add(c));
  });

  // Cajas explícitamente excluidas para este tallerista (tabla cajas_excluidas_por_tallerista)
  const cajasExcluidas = (cajasExcluidasMap && nombreTallerista)
    ? (cajasExcluidasMap.get(normalizeText(nombreTallerista)) || new Set())
    : new Set();

  // Mapear N_Caja → Set de Cod_Art que usan esa caja (del tallerista)
  const codsPorCaja = new Map();
  const nCajasSet = new Set();
  (articulosCajas || []).forEach(ac => {
    const cod = normalizeCode(String(ac.Cod_Art || ""));
    if (codsDelTallerista.has(cod)){
      const nCaja = Number(ac.N_Caja || 0);
      if (nCaja > 0 && !cajasExcluidas.has(nCaja)) {
        nCajasSet.add(nCaja);
        if (!codsPorCaja.has(nCaja)) codsPorCaja.set(nCaja, new Set());
        codsPorCaja.get(nCaja).add(cod);
      }
    }
  });

  const result = [];
  (cajasData || []).forEach(c => {
    const nCaja = Number(c.N_Caja || 0);
    if (!nCajasSet.has(nCaja)) return;
    const maxUni = Number(c.Max_Uni_Virg || 0);
    const stockVirg = Number(c.Stock_Virg || 0);
    result.push({
      sector: String(c.Sector || ""),
      descripcion: `Caja N ${nCaja}`,
      maxUni,
      stockVirg,
      cajonesEnviar: Math.max(0, maxUni - stockVirg),
      codigos: [...(codsPorCaja.get(nCaja) || [])]
    });
  });

  return result.sort((a, b) => {
    const na = parseInt(a.descripcion.replace(/\D/g, "") || "0");
    const nb = parseInt(b.descripcion.replace(/\D/g, "") || "0");
    return na - nb;
  });
}

function obtenerSectorProce(descripcion, codigos, sectoresData, sectoresPermitidos){
  const parteNorm = normalizeText(descripcion);
  if (!parteNorm) return "";

  const { mapByCodeAndPart, mapByPart } = sectoresData;
  const sectoresEncontrados = new Set();

  for (const cod of codigos){
    const key = `${cod}__${parteNorm}`;
    const sector = mapByCodeAndPart.get(key);
    if (sector) sectoresEncontrados.add(sector);
  }

  if (!sectoresEncontrados.size && mapByPart.has(parteNorm)){
    for (const s of mapByPart.get(parteNorm)) sectoresEncontrados.add(s);
  }

  if (sectoresPermitidos && sectoresPermitidos.size > 0){
    const filtrados = [...sectoresEncontrados].filter(s => sectoresPermitidos.has(s));
    return filtrados.join(" / ");
  }

  return [...sectoresEncontrados].join(" / ");
}

function obtenerKgXCajon(descripcion, codigos, sectoresData){
  const parteNorm = normalizeText(descripcion);
  if (!parteNorm) return 0;

  const { kgXCajonByCodeAndPart, kgXCajonByPart } = sectoresData;

  for (const cod of codigos){
    const key = `${cod}__${parteNorm}`;
    if (kgXCajonByCodeAndPart.has(key)) return Number(kgXCajonByCodeAndPart.get(key) || 0);
  }

  return Number(kgXCajonByPart.get(parteNorm) || 0);
}

function obtenerKgXUni(descripcion, codigos, sectoresData){
  const parteNorm = normalizeText(descripcion);
  if (!parteNorm) return 0;

  const { kgXUniByCodeAndPart, kgXUniByPart } = sectoresData;

  for (const cod of codigos){
    const key = `${cod}__${parteNorm}`;
    if (kgXUniByCodeAndPart.has(key)) return Number(kgXUniByCodeAndPart.get(key) || 0);
  }

  return Number(kgXUniByPart.get(parteNorm) || 0);
}

function obtenerPartesXUni(descripcion, codigos, sectoresData){
  const parteNorm = normalizeText(descripcion);
  if (!parteNorm) return 0;

  const { partesXUniByCodeAndPart, partesXUniByPart } = sectoresData;

  for (const cod of codigos){
    const key = `${cod}__${parteNorm}`;
    if (partesXUniByCodeAndPart.has(key)) return Number(partesXUniByCodeAndPart.get(key) || 0);
  }

  return Number(partesXUniByPart.get(parteNorm) || 0);
}

function obtenerEntregasTallerista(nombreTallerista, codigos, entregasData, sectorProce, fallbackUniXCaja){
  const nombreTallNorm = normalizeText(nombreTallerista);
  const sectorNorm = normalizeText(sectorProce || "");
  const defaultUniXCaja = fallbackUniXCaja !== undefined ? fallbackUniXCaja : 0;

  let totalUnidades = 0;
  const detalle = [];

  if (!nombreTallNorm){
    return { totalUnidades: 0, detalle: [] };
  }

  // Resolver codigos efectivos por tipo de fila:
  //   - SC de transformacion (M6/M8): mostrar entregas via lookup por Cod_GRJ
  //     (Cod=M10/Cod_GRJ=M6 entonces fila M6 muestra el aporte real del tallerista).
  //     Early return — no usar lookup por Cod.
  //   - SP de transformacion (M10/M9): NO mostrar entregas con codGrj seteado
  //     (esas son transformaciones, no entregas reales del tallerista).
  //   - resto: codigos original (con expansion GRJ normal).
  const sec = String(sectorProce || "").trim();

  // CASO ESPECIAL: TRANSFORMACION_SCS (M6/M8/F7) — fila SC muestra entregas por Cod_GRJ
  if (TRANSFORMACION_SCS.has(sec) && entregasData.detalleByNombreTallAndCodGrj) {
    const keyGrj = `${nombreTallNorm}__${sec}`;
    const arr = entregasData.detalleByNombreTallAndCodGrj.get(keyGrj) || [];
    arr.forEach(x => {
      const esGrj = !!x.codGrj;
      const sectorKey = `${nombreTallNorm}__${x.cod}__${sectorNorm}`;
      let uniXCaja = esGrj ? 1 : Number(
        entregasData.uniXCajaBySector.get(sectorKey) ||
        entregasData.uniXCajaByNombreTallAndCod.get(`${nombreTallNorm}__${x.cod}`) || 0
      );
      if (!esGrj && uniXCaja === 0 && defaultUniXCaja > 0) uniXCaja = defaultUniXCaja;
      const unidades = esGrj ? x.cajas : x.cajas * uniXCaja;
      totalUnidades += unidades;
      detalle.push({
        fecha: x.fecha,
        unidades,
        cajas: x.cajas,
        uniXCaja,
        cod: x.cod,
        codGrj: x.codGrj,
        kgGrj: x.kgGrj
      });
    });
    detalle.sort((a, b) => sortKeyFechaCron(a.fecha) - sortKeyFechaCron(b.fecha));
    return { totalUnidades, detalle };
  }

  let efectivos;
  if (TRANSFORMACION_SP_TO_SC[sec]) {
    efectivos = [sec];
  } else {
    efectivos = codigos;
  }

  // Expandir códigos GRJ a sus componentes (con dedupe — necesario p.ej. para
  // piezas que agrupan componente y GRJ con misma desc, como X1+X5: si X1 ya
  // está en codigos y X5 expande a X1, sin dedupe se contaba doble).
  const codigosExpandidos = new Set();
  for (const cod of efectivos){
    codigosExpandidos.add(cod);
    // No expandir transformaciones 1:1 (SC→SP): cada fila tiene su trigger propio.
    if (GRJ_COMPONENTES[cod] && !TRANSFORMACION_SCS.has(cod)) {
      GRJ_COMPONENTES[cod].forEach(c => codigosExpandidos.add(c));
    }
  }

  const esFilaSP_Transformacion = !!TRANSFORMACION_SP_TO_SC[sec];

  for (const cod of codigosExpandidos){
    const key = `${nombreTallNorm}__${cod}`;

    const arr = entregasData.detalleByNombreTallAndCod.get(key) || [];
    arr.forEach(x => {
      // Excluir transformaciones de fila SP — salvo si el SC destino está oculto
      // (M6/M8 ocultos → sus entregas se absorben en M10/M9).
      if (esFilaSP_Transformacion && x.codGrj) {
        const scMapeado = TRANSFORMACION_SP_TO_SC[sec];
        if (!TRANSFORMACION_SC_OCULTAR.has(scMapeado)) return;
      }
      const esGrj = !!x.codGrj;
      const sectorKey = `${nombreTallNorm}__${cod}__${sectorNorm}`;
      let uniXCaja = esGrj ? 1 : Number(
        entregasData.uniXCajaBySector.get(sectorKey) ||
        entregasData.uniXCajaByNombreTallAndCod.get(key) || 0
      );
      // Fallback: si no se encontró uniXCaja, usar el valor por defecto (1 para cartones/cajas)
      if (!esGrj && uniXCaja === 0 && defaultUniXCaja > 0) uniXCaja = defaultUniXCaja;
      const unidades = esGrj ? x.cajas : x.cajas * uniXCaja;
      totalUnidades += unidades;
      detalle.push({
        fecha: x.fecha,
        unidades,
        cajas: x.cajas,
        uniXCaja,
        cod: x.cod,
        codGrj: x.codGrj,
        kgGrj: x.kgGrj
      });
    });
  }

  detalle.sort((a, b) => sortKeyFechaCron(a.fecha) - sortKeyFechaCron(b.fecha));

  return {
    totalUnidades,
    detalle
  };
}

function obtenerEnviosTallerista(nombre, sector, descripcion, enviosData, kgXUni){
  // Clave SIN sector: coincide con cargarEnvios() y obtenerEnviosUni()
  const key = `${normalizeText(nombre)}__${normalizeText(descripcion)}`;

  const totalKg = Number(enviosData.totalKgMap.get(key) || 0);
  const totalUnidadesEnvio = Number((enviosData.totalUnidadesMap || new Map()).get(key) || 0);
  const totalUni = kgXUni > 0 ? Math.round(totalKg / kgXUni) : totalUnidadesEnvio;
  const detalleBase = enviosData.detalleMap.get(key) || [];


  const detalle = detalleBase.map(x => {
    const unidades = kgXUni > 0
      ? Math.round(Number(x.kg || 0) / kgXUni)
      : Number(x.unidades || 0);
    return {
      fecha: x.fecha,
      kg: x.kg,
      cajones: x.cajones,
      unidades
    };
  });

  return {
    totalKg,
    totalUni,
    detalle
  };
}

function calcularCajones(consumoTotal, kgXUni, partesXUni, kgXCajon){
  const consumo = Number(consumoTotal || 0);
  const uni = Number(kgXUni || 0);
  const partes = Number(partesXUni || 0);
  const caj = Number(kgXCajon || 0);

  if (caj <= 0 || consumo <= 0 || uni <= 0 || partes <= 0) return 0;

  return (consumo * uni * partes) / caj;
}

async function buscar(nombreParam){
  const nombre = String(nombreParam || "").trim();

  if (!nombre){
    setStatus("Seleccioná un tallerista");
    return;
  }

  resultEl.innerHTML = "";
  setStatus("Buscando...");

  const { data, error } = await supabaseClient
    .from("v_piezas_por_tallerista_resumen")
    .select("*")
    .limit(5000);

  if (error){
    console.error(error);
    setStatus("Error al buscar: " + (error.message || "sin detalle"));
    return;
  }

  let filasTallerista = (data || []).filter(r => {
    const t = String(pick(r, ["Tallerista", "tallerista", "TALLERISTA"]) || "").trim();
    return t === nombre;
  });

  if (!filasTallerista.length){
    setStatus("No encontré resultados");
    return;
  }

  let consumoMap, sectoresData, stockMap, entregasData, enviosData, articulosCajas, cajasData, cajasExcluidasMap, proporcionData, devolucionesData;

  try{
    [consumoMap, sectoresData, stockMap, entregasData, enviosData, articulosCajas, cajasData, cajasExcluidasMap, , proporcionData, devolucionesData] = await Promise.all([
      cargarConsumos(),
      cargarSectores(),
      cargarStockTallerista(),
      cargarEntregas(),
      cargarEnvios(),
      cargarArticulosCajas(),
      cargarCajas(),
      cargarCajasExcluidas(),
      cargarGRJDesdeBD(), // sin destructure — solo asegurar que GRJ_COMPONENTES esta poblado
      cargarProporciones(),
      cargarDevoluciones()
    ]);
  }catch (err){
    console.error(err);
    setStatus(err.message || "Error al cargar datos");
    return;
  }

  // Filtro especial: si el tallerista tiene articulos con destino_entrega=facturas (Maspoli/Pintos),
  // mostrar SOLO las piezas relacionadas a esos articulos. Los Prov AT puros (Bate Bife, cucharas, etc.)
  // quedan ocultos en Control Tall — esos se gestionan por Recepcion Virgilio, no por flujo de partes.
  const factSet = proporcionData && proporcionData.articulosFacturasPorTallerista
                  ? proporcionData.articulosFacturasPorTallerista.get(normalizeText(nombre))
                  : null;
  if (factSet && factSet.size) {
    filasTallerista = filasTallerista.filter(r => {
      const codsRaw = String(pick(r, ["cod_articulos", "Cod_articulos", "COD_ARTICULOS"]) || "");
      const cods = splitCodes(codsRaw);
      return cods.some(c => factSet.has(c));
    });
    if (!filasTallerista.length) {
      setStatus("No hay partes via facturas para este tallerista");
      return;
    }
  }

  filasTallerista.sort((a, b) => {
    const pa = String(pick(a, ["pieza", "Pieza", "PIEZA"]) || "");
    const pb = String(pick(b, ["pieza", "Pieza", "PIEZA"]) || "");
    return pa.localeCompare(pb, "es");
  });

  datosParaFiltro = [];

  const sectoresDelTall = sectoresPorTalleristaCache
    ? sectoresPorTalleristaCache.get(normalizeText(nombre)) || new Set()
    : new Set();

  // GRJs que el tallerista realmente entrega (deriva del view: cod_articulos GRJX)
  const talleristaGrjs = new Set();
  filasTallerista.forEach(r => {
    const codsRaw = String(pick(r, ["cod_articulos", "Cod_articulos", "COD_ARTICULOS"]) || "");
    splitCodes(codsRaw).forEach(cod => {
      if (GRJ_COMPONENTES[cod]) talleristaGrjs.add(cod);
    });
  });

  filasTallerista.forEach(r => {
    const descripcion = String(pick(r, ["pieza", "Pieza", "PIEZA"]) || "").trim();
    const codsRaw = String(pick(r, ["cod_articulos", "Cod_articulos", "COD_ARTICULOS"]) || "");
    const codigos = splitCodes(codsRaw);

    // Obtener sector SIN filtro para saber si la pieza tiene sector en Despiece
    const sectorSinFiltro = obtenerSectorProce(descripcion, codigos, sectoresData);
    // Obtener sector CON filtro del tallerista
    let sectorProce = obtenerSectorProce(descripcion, codigos, sectoresData, sectoresDelTall);

    // Si la pieza tiene sector en Despiece pero ninguno corresponde al tallerista, no mostrarla
    if (sectoresDelTall.size > 0 && sectorSinFiltro && !sectorProce) return;

    // Fallback: si no hay sector en Despiece, buscar en Partes x Tallerista (para artículos SC)
    if (!sectorProce) {
      const tallNorm = normalizeText(nombre);
      for (const cod of codigos) {
        const fb = entregasData.sectorByTallAndCod.get(`${tallNorm}__${cod}`);
        if (fb) { sectorProce = fb; break; }
      }
    }

    // SC ocultos (M6/M8): entregas absorbidas por su SP (M10/M9), no renderizar fila
    if (TRANSFORMACION_SC_OCULTAR.has(sectorProce)) return;

    const kgXCajon = obtenerKgXCajon(descripcion, codigos, sectoresData);
    const kgXUni = obtenerKgXUni(descripcion, codigos, sectoresData);
    const partesXUni = obtenerPartesXUni(descripcion, codigos, sectoresData);

    let consumoTotal = 0;
    const consumoBreakdown = []; // [{cod, desc, consumo}] para popup
    // Expandir cada cod del row a TODOS los articulos terminados que afectan consumo:
    // - cod numerico (515, 615, ...) → agregar
    // - cod GRJ (GRJ7, GRJ10) → articuloPorGrj.get(cod) = Set de articulos
    // - cualquier cod con sector match → codsPorSector + articulos via componente→GRJ
    // E. Madre solo tiene filas para articulos terminados.
    const articulosLookup = new Set();
    codigos.forEach(cod => {
      // Caso 1: numerico → directo
      if (/^\d+$/.test(cod)) {
        articulosLookup.add(cod);
        return;
      }
      // Caso 2: GRJ → articulos del armado
      if (/^(GRJ|CP)/i.test(cod)) {
        const arts = sectoresData.articuloPorGrj && sectoresData.articuloPorGrj.get(cod);
        if (arts && arts.size) arts.forEach(a => articulosLookup.add(a));
      }
      // Caso 3: componente (A10, C10, V9, etc) → expandir a GRJs → articulos
      if (COMPONENTE_A_GRJS && COMPONENTE_A_GRJS.has(cod)) {
        COMPONENTE_A_GRJS.get(cod).forEach(grj => {
          const arts = sectoresData.articuloPorGrj && sectoresData.articuloPorGrj.get(grj);
          if (arts && arts.size) arts.forEach(a => articulosLookup.add(a));
        });
      }
    });
    // Caso 4: ademas via sector — articulos numericos que usan este sector directamente
    if (sectorProce && sectoresData.codsPorSector) {
      const codsDelSector = sectoresData.codsPorSector.get(sectorProce);
      if (codsDelSector) {
        codsDelSector.forEach(c => {
          if (/^\d+$/.test(c)) articulosLookup.add(c);
        });
      }
    }
    // Aplicar filtro por tallerista + proporcion (Proporcion_Articulo_Tallerista):
    // - Si hay fila en proporciones para (articulo, tallerista_actual) → factor = proporcion
    // - Si NO hay fila pero tallerista lo hace (Articulos VxT) → factor = 1.0 (exclusivo)
    // - Si NO lo hace → skip (articulo de otro tallerista, no contribuye)
    const tallNorm = normalizeText(nombre);
    articulosLookup.forEach(art => {
      const consBruto = Number(consumoMap.get(art) || 0);
      if (consBruto <= 0) return;

      let factor;
      const propManual = proporcionData && proporcionData.proporciones.get(`${art}__${tallNorm}`);
      if (propManual !== undefined) {
        factor = propManual; // 0-1
      } else {
        const tallSet = proporcionData && proporcionData.talleristasPorArticulo.get(art);
        if (tallSet && tallSet.has(tallNorm)) {
          factor = 1.0; // exclusivo del tallerista
        } else {
          return; // no es de este tallerista
        }
      }

      const c = consBruto * factor;
      consumoTotal += c;
      if (c > 0) {
        consumoBreakdown.push({
          cod: art,
          desc: (consumoDescCache && consumoDescCache.get(art)) || "",
          consumo: Math.round(c),
          consumoBruto: consBruto,
          factor
        });
      }
    });

    const esCarton = normalizeText(descripcion).startsWith("carton");
    const maxCajones = esCarton
      ? (consumoTotal > 0 ? consumoTotal / 1000 : 0)
      : calcularCajones(consumoTotal, kgXUni, partesXUni, kgXCajon);

    let stockInicialUni = parseDecimal(
      pick(r, [
        "Stock Inicial",
        "stock_inicial",
        "stock inicial",
        "Stock_Inicial"
      ])
    );
    if (!stockInicialUni && sectorProce && entregasData.stockInicialByTallAndSectorAndDesc) {
      const siKey = `${normalizeText(nombre)}__${sectorProce}__${normalizeText(descripcion)}`;
      stockInicialUni = entregasData.stockInicialByTallAndSectorAndDesc.get(siKey) || 0;
    }

    // TRANSFORMACION_SCS (M6/M8/F7): el tallerista solo ENTREGA estos sectores, no recibe envíos
    let enviosInfo;
    if (TRANSFORMACION_SCS.has(sectorProce)) {
      enviosInfo = { totalKg: 0, totalUni: 0, detalle: [] };
    } else {
      enviosInfo = obtenerEnviosTallerista(nombre, sectorProce, descripcion, enviosData, kgXUni);
      // Merge envíos de sectores origen (M6→M5, M8→M7)
      const origenes = TRANSFORMACION_ENVIOS_ORIGEN[sectorProce];
      if (origenes) {
        for (const origenSc of origenes) {
          const secKey = `${normalizeText(nombre)}__${normalizeText(origenSc)}`;
          const oKg = enviosData.sectorTotalKgMap.get(secKey) || 0;
          const oUniEnv = (enviosData.sectorTotalUnidadesMap || new Map()).get(secKey) || 0;
          const oUni = kgXUni > 0 ? Math.round(oKg / kgXUni) : oUniEnv;
          const oDet = (enviosData.sectorDetalleMap.get(secKey) || []).map(x => ({
            fecha: x.fecha, kg: x.kg, cajones: x.cajones,
            unidades: kgXUni > 0 ? Math.round(Number(x.kg || 0) / kgXUni) : Number(x.unidades || 0)
          }));
          enviosInfo.totalKg += oKg;
          enviosInfo.totalUni += oUni;
          enviosInfo.detalle.push(...oDet);
        }
        enviosInfo.detalle.sort((a, b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));
      }
    }
    const totalEnviosUni = enviosInfo.totalUni;

    const entregasInfo = obtenerEntregasTallerista(nombre, codigos, entregasData, sectorProce, esCarton ? 1 : undefined);
    const totalEntregasUni = entregasInfo.totalUnidades;

    // Devoluciones: Kg devueltos por tallerista+sector, convertidos a unidades
    const devKey = `${normalizeText(nombre)}__${normalizeText(sectorProce)}`;
    const devTotalKg = devolucionesData ? (devolucionesData.totalKgMap.get(devKey) || 0) : 0;
    const devDetalles = devolucionesData ? (devolucionesData.detalleMap.get(devKey) || []) : [];
    const totalDevolucionesUni = kgXUni > 0 ? Math.round(devTotalKg / kgXUni) : 0;

    let onlineUni, onlineKg, onlineCaj;
    if (esCarton) {
      onlineUni = totalEnviosUni - totalEntregasUni;
      onlineKg = 0;
      onlineCaj = onlineUni;
    } else if (kgXUni > 0) {
      onlineUni = stockInicialUni + totalEnviosUni - totalEntregasUni - totalDevolucionesUni;
      onlineKg = onlineUni * kgXUni;
      onlineCaj = kgXCajon > 0 ? (onlineKg / kgXCajon) : 0;
    } else {
      onlineUni = 0;
      onlineKg = 0;
      onlineCaj = 0;
    }

    const cajonesEnviar = maxCajones - onlineCaj;

    const popupEnviosItems = enviosInfo.detalle.length
      ? enviosInfo.detalle
          .map(x => `${formatFechaDDMMAAAA(x.fecha)} - ${formatDecimal(x.kg)} kg - ${formatCajones(x.cajones)} caj - ${formatNumber(x.unidades)} uni`)
          .join("|")
      : "Sin envíos";

    const popupEntregasItems = entregasInfo.detalle.length
      ? entregasInfo.detalle.map(x =>
          x.codGrj
            ? `${x.codGrj} - ${formatDecimal(x.kgGrj)} Kg - ${formatNumber(x.unidades)} uni`
            : `${formatFechaDDMMAAAA(x.fecha)} - Cod ${x.cod} - ${formatNumber(x.unidades)} uni`
        ).join("|")
      : "Sin entregas";

    const saldoMovs = [
      ...enviosInfo.detalle.map(x => ({
        concepto: "Envío",
        fecha: x.fecha,
        uniMedida: Number(x.kg || 0) > 0 ? "Kg" : "Uni",
        cant: Number(x.kg || 0) > 0 ? Number(x.kg) : Number(x.unidades || 0),
        unidades: Number(x.unidades || 0),
        cod: ""
      })),
      ...entregasInfo.detalle.map(x => {
        return {
          concepto: "Entrega",
          fecha: x.fecha,
          uniMedida: x.codGrj ? "Cajón" : "Caja",
          cant: Number(x.cajas || 0),
          unidades: -Number(x.unidades || 0),
          cod: x.codGrj || x.cod || ""
        };
      }),
      ...devDetalles.map(x => {
        const devKg = Number(x.kg || 0);
        const devUni = kgXUni > 0 ? Math.round(devKg / kgXUni) : 0;
        return {
          concepto: "Devolución",
          fecha: x.fecha,
          uniMedida: "Kg",
          cant: devKg,
          unidades: -devUni,
          cod: x.destino === "ANALIZAR" ? `Analizar (${sectorProce})` : `${x.destino}(${sectorProce})`
        };
      })
    ].sort((a, b) => sortKeyFechaCron(a.fecha) - sortKeyFechaCron(b.fecha));
    let runSaldoSec = stockInicialUni;
    let popupSaldoNegativo = false;
    for (const m of saldoMovs) {
      runSaldoSec += Number(m.unidades || 0);
      if (runSaldoSec < 0) { popupSaldoNegativo = true; break; }
    }
    const popupSaldoEncoded = encodeURIComponent(JSON.stringify({
      stockInicial: stockInicialUni,
      movs: saldoMovs,
      negativo: popupSaldoNegativo,
      consumoTotal,
      kgXUni
    }));

    let codsDisplay = TALLERISTAS_MOSTRAR_GRJ.has(nombre)
      ? convertirCodsAGrj(sectorProce, codsRaw, sectoresData, talleristaGrjs)
      : codsRaw;
    codsDisplay = aplicarTransformacionEnCodigos(sectorProce, codsDisplay);
    // Anotar GRJ con su articulo armado: "GRJ7" → "GRJ7 → 506"
    // Articulo se deriva de Despiece (sector Proce=GRJ con COD numerico).
    codsDisplay = anotarGrjConArticulo(codsDisplay, sectoresData);

    // Popup de Cons x Parte: lista los articulos que componen el consumo + total.
    // Cuando hay proporcion < 100%, muestra el factor: "Cod 506 - Desc - 13.188 uni (70% de 18.840)"
    const popupConsumoItems = consumoBreakdown.length
      ? [
          ...consumoBreakdown
            .sort((a, b) => b.consumo - a.consumo)
            .map(b => {
              const baseLine = `Cod ${b.cod}${b.desc ? ` - ${b.desc}` : ""} - ${formatNumber(b.consumo)} uni`;
              if (b.factor !== undefined && Math.abs(b.factor - 1) > 0.001) {
                const pct = Math.round(b.factor * 1000) / 10;
                return `${baseLine} (${pct}% de ${formatNumber(b.consumoBruto)})`;
              }
              return baseLine;
            }),
          `TOTAL - ${formatNumber(Math.round(consumoTotal))} uni`
        ].join("|")
      : "Sin consumo";

    const rubro = (sectoresData.rubroBySector && sectoresData.rubroBySector.get(sectorProce))
                || (sectoresData.rubroByPart && sectoresData.rubroByPart.get(normalizeText(descripcion)))
                || "";

    datosParaFiltro.push({
      sectorProce, descripcion, codsRaw: codsDisplay, rubro,
      onlineKg, onlineCaj, onlineUni, cajonesEnviar,
      totalEnviosUni, totalEntregasUni,
      popupEnviosItems, popupEntregasItems, popupSaldoEncoded, popupSaldoNegativo, popupConsumoItems,
      stockInicialUni, kgXUni, kgXCajon, consumoTotal, maxCajones
    });
  });

  // Agregar cajas (se envían en unidades como cartones).
  // EXCEPCION: si el tallerista solo tiene articulos via facturas (Maspoli/Pintos), NO mostrar
  // cajas — las cajas son responsabilidad del tallerista que arma el articulo terminado, no del
  // que entrega solo una parte.
  const cajasItems = factSet ? [] : obtenerCajasPorTallerista(filasTallerista, articulosCajas, cajasData, nombre, cajasExcluidasMap);
  cajasItems.forEach(c => {
    const enviosInfo = obtenerEnviosTallerista(nombre, c.sector, c.descripcion, enviosData, 0);
    const totalEnviosUni = enviosInfo.totalUni;

    // Contar entregas de productos que usan esta caja
    const entregasInfo = obtenerEntregasTallerista(nombre, c.codigos || [], entregasData, "", 1);
    const totalEntregasUni = entregasInfo.totalUnidades;

    const onlineUni = c.stockVirg + totalEnviosUni - totalEntregasUni;
    const cajonesEnviar = Math.max(0, c.maxUni - onlineUni);
    if (cajonesEnviar <= 0 && onlineUni <= 0) return;

    const popupEntregasItems = entregasInfo.detalle.length
      ? entregasInfo.detalle.map(x =>
          x.codGrj
            ? `${x.codGrj} - ${formatDecimal(x.kgGrj)} Kg - ${formatNumber(x.unidades)} uni`
            : `${formatFechaDDMMAAAA(x.fecha)} - Cod ${x.cod} - ${formatNumber(x.unidades)} uni`
        ).join("|")
      : "Sin entregas";

    const saldoMovsCaja = [
      ...enviosInfo.detalle.map(x => ({
        concepto: "Envío",
        fecha: x.fecha,
        uniMedida: Number(x.kg || 0) > 0 ? "Kg" : "Uni",
        cant: Number(x.kg || 0) > 0 ? Number(x.kg) : Number(x.unidades || 0),
        unidades: Number(x.unidades || 0),
        cod: ""
      })),
      ...entregasInfo.detalle.map(x => {
        return {
          concepto: "Entrega",
          fecha: x.fecha,
          uniMedida: x.codGrj ? "Cajón" : "Caja",
          cant: Number(x.cajas || 0),
          unidades: -Number(x.unidades || 0),
          cod: x.codGrj || x.cod || ""
        };
      })
    ].sort((a, b) => sortKeyFechaCron(a.fecha) - sortKeyFechaCron(b.fecha));
    let runSaldoCaja = Number(c.stockVirg || 0);
    let popupSaldoNegativo = false;
    for (const m of saldoMovsCaja) {
      runSaldoCaja += Number(m.unidades || 0);
      if (runSaldoCaja < 0) { popupSaldoNegativo = true; break; }
    }
    // Desglose Cons x Parte: suma del consumo de cada articulo que usa esta caja
    const cajaBreakdown = [];
    let cajaConsumoTotal = 0;
    (c.codigos || []).forEach(cod => {
      const cc = Number(consumoMap.get(cod) || 0);
      if (cc > 0) {
        cajaBreakdown.push({
          cod,
          desc: (consumoDescCache && consumoDescCache.get(cod)) || "",
          consumo: cc
        });
        cajaConsumoTotal += cc;
      }
    });

    const popupSaldoEncoded = encodeURIComponent(JSON.stringify({
      stockInicial: Number(c.stockVirg || 0),
      movs: saldoMovsCaja,
      negativo: popupSaldoNegativo,
      consumoTotal: cajaConsumoTotal || c.maxUni,
      kgXUni: 0
    }));
    const popupConsumoItemsCaja = cajaBreakdown.length
      ? [
          ...cajaBreakdown
            .sort((a, b) => b.consumo - a.consumo)
            .map(b => `Cod ${b.cod}${b.desc ? ` - ${b.desc}` : ""} - ${formatNumber(b.consumo)} uni`),
          `TOTAL - ${formatNumber(cajaConsumoTotal)} uni`
        ].join("|")
      : (c.maxUni > 0 ? `TOTAL - ${formatNumber(c.maxUni)} uni` : "Sin consumo");

    datosParaFiltro.push({
      sectorProce: c.sector,
      descripcion: c.descripcion,
      codsRaw: (c.codigos || []).join(", "),
      onlineKg: 0,
      onlineCaj: c.stockVirg,
      onlineUni,
      cajonesEnviar,
      totalEnviosUni,
      totalEntregasUni,
      popupEnviosItems: enviosInfo.detalle.length
        ? enviosInfo.detalle.map(x => `${formatFechaDDMMAAAA(x.fecha)} - ${formatNumber(x.unidades)} uni`).join("|")
        : "Sin envíos",
      popupEntregasItems,
      popupSaldoEncoded,
      popupSaldoNegativo,
      popupConsumoItems: popupConsumoItemsCaja,
      stockInicialUni: 0,
      kgXUni: 0,
      kgXCajon: 0,
      consumoTotal: cajaConsumoTotal || c.maxUni,
      maxCajones: c.maxUni
    });
  });

  renderFilasFiltradas(nombre);

  renderResultado(nombre, datosParaFiltro);

  // Panel de advertencia: envios/entregas del tall que no matchearon ninguna pieza renderizada
  renderPanelSinMatch(nombre, enviosData, entregasData);
}

// =====================================================
// Panel "Sin match": envios/entregas cuyo desc/cod no aparece en las piezas del tall
// =====================================================
function renderPanelSinMatch(nombre, enviosData, entregasData){
  const tallNorm = normalizeText(nombre);
  // Descripciones de las piezas que SE renderizaron (matcheo de envios por descripcion)
  const descsRenderizadas = new Set(
    (datosParaFiltro || []).map(d => normalizeText(d.descripcion)).filter(Boolean)
  );
  // Cods de las piezas (para entregas — entregas matchean por Cod o Cod_GRJ)
  const codsRenderizados = new Set();
  (datosParaFiltro || []).forEach(d => {
    splitCodes(d.codsRaw || "").forEach(c => codsRenderizados.add(c));
    if (d.codGrj) codsRenderizados.add(normalizeCode(d.codGrj));
  });

  // Envios sin match: claves del enviosData.totalKgMap que empiecen con tallNorm
  // y cuya desc no este en descsRenderizadas
  const sinMatchEnvios = [];
  const prefijo = `${tallNorm}__`;
  for (const [key, kg] of enviosData.totalKgMap.entries()){
    if (!key.startsWith(prefijo)) continue;
    const desc = key.slice(prefijo.length);
    if (descsRenderizadas.has(desc)) continue;
    const uni = enviosData.totalUnidadesMap.get(key) || 0;
    const detalle = enviosData.detalleMap.get(key) || [];
    const fechas = detalle.map(d => d.fecha).filter(Boolean);
    sinMatchEnvios.push({
      desc,
      kg,
      uni,
      cant: detalle.length,
      primera: fechas[0] || "",
      ultima: fechas[fechas.length - 1] || ""
    });
  }

  // Entregas sin match: por Cod del tall
  const sinMatchEntregas = [];
  if (entregasData && entregasData.detalleByNombreTallAndCod){
    for (const [key, arr] of entregasData.detalleByNombreTallAndCod.entries()){
      if (!key.startsWith(prefijo)) continue;
      const cod = key.slice(prefijo.length);
      if (codsRenderizados.has(cod)) continue;
      if (!arr || !arr.length) continue;
      const totalCajas = arr.reduce((acc, x) => acc + (Number(x.cajas) || 0), 0);
      if (totalCajas <= 0) continue;
      sinMatchEntregas.push({ cod, total: totalCajas });
    }
  }

  // Si no hay sin-match, ocultar / quitar panel
  let panel = document.getElementById("panelSinMatch");
  if (!sinMatchEnvios.length && !sinMatchEntregas.length){
    if (panel) panel.remove();
    return;
  }
  if (!panel){
    panel = document.createElement("div");
    panel.id = "panelSinMatch";
    panel.style.cssText = "margin:14px 0;padding:12px 14px;border:2px solid #f59e0b;background:#fffbeb;border-radius:10px;font-size:14px";
    // Insertar antes de #result o al inicio del cuerpo
    const result = document.getElementById("result");
    if (result && result.parentNode) result.parentNode.insertBefore(panel, result);
    else document.body.appendChild(panel);
  }

  sinMatchEnvios.sort((a,b) => b.kg - a.kg);
  sinMatchEntregas.sort((a,b) => b.total - a.total);

  const enviosHtml = sinMatchEnvios.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
        <thead><tr style="background:#fde68a"><th style="padding:4px 8px;border:1px solid #d97706;text-align:left">Descripción</th><th style="padding:4px 8px;border:1px solid #d97706">Σ Kg</th><th style="padding:4px 8px;border:1px solid #d97706">Σ Uni</th><th style="padding:4px 8px;border:1px solid #d97706">Reg</th><th style="padding:4px 8px;border:1px solid #d97706">Fechas</th></tr></thead>
        <tbody>${sinMatchEnvios.map(x => `<tr>
          <td style="padding:3px 8px;border:1px solid #d97706"><b>${escapeHtml(x.desc)}</b></td>
          <td style="padding:3px 8px;border:1px solid #d97706;text-align:right">${Number(x.kg).toLocaleString('es-AR',{maximumFractionDigits:2})}</td>
          <td style="padding:3px 8px;border:1px solid #d97706;text-align:right">${Number(x.uni).toLocaleString('es-AR')}</td>
          <td style="padding:3px 8px;border:1px solid #d97706;text-align:center">${x.cant}</td>
          <td style="padding:3px 8px;border:1px solid #d97706;text-align:center">${escapeHtml(x.primera)} → ${escapeHtml(x.ultima)}</td>
        </tr>`).join("")}</tbody>
      </table>`
    : "";

  const entregasHtml = sinMatchEntregas.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:6px">
        <thead><tr style="background:#fde68a"><th style="padding:4px 8px;border:1px solid #d97706;text-align:left">Cod</th><th style="padding:4px 8px;border:1px solid #d97706">Σ Cajas</th></tr></thead>
        <tbody>${sinMatchEntregas.map(x => `<tr>
          <td style="padding:3px 8px;border:1px solid #d97706"><b>${escapeHtml(x.cod)}</b></td>
          <td style="padding:3px 8px;border:1px solid #d97706;text-align:right">${Number(x.total).toLocaleString('es-AR')}</td>
        </tr>`).join("")}</tbody>
      </table>`
    : "";

  panel.innerHTML = `
    <div style="font-weight:800;color:#92400e;font-size:15px;margin-bottom:6px">
      ⚠ Envíos/Entregas sin match con piezas del tallerista (${sinMatchEnvios.length + sinMatchEntregas.length})
    </div>
    <div style="color:#78350f;margin-bottom:8px">Estas operaciones existen en DB pero su descripción/cod no aparece en Partes x Tallerista — revisar carga o agregar pieza.</div>
    ${sinMatchEnvios.length ? '<div style="font-weight:700;color:#92400e;margin-top:8px">📤 Envíos sin match:</div>' + enviosHtml : ''}
    ${sinMatchEntregas.length ? '<div style="font-weight:700;color:#92400e;margin-top:10px">📥 Entregas sin match:</div>' + entregasHtml : ''}
  `;
}

function renderFilasFiltradas(nombre){
  const q = normalizeText(txtBuscarTall.value);
  const filtradas = !q ? datosParaFiltro : datosParaFiltro.filter(d => {
    return normalizeText(d.sectorProce).includes(q) ||
           normalizeText(d.descripcion).includes(q) ||
           normalizeText(d.codsRaw).includes(q);
  });
  renderResultado(nombre, filtradas);
}

function clasificarParte(d){
  const desc = normalizeText(d.descripcion);
  const sec = String(d.sectorProce || "").trim().toUpperCase();
  const rubro = String(d.rubro || "").trim();

  if (desc.startsWith("caja n") || sec === "CAJA") return "Cajas";
  if (desc.startsWith("carton") || desc.startsWith("cartón")) return "Cartones";
  // Clasificar por Rubro primario (fuente de verdad desde Despiece x Articulo)
  if (rubro === "Importados") return "Importados";
  if (rubro === "Remaches") return "Remaches";
  if (rubro === "Plásticos" || rubro === "Plasticos") return "Partes Plásticas";
  if (sec.startsWith("GRJ") || sec.startsWith("CP")) return "Garaje";
  if (sec.startsWith("P")) return "Partes Plásticas";
  // Fallback remaches: sectores V seguidos de dígito (V1, V3, V14, V3C, V16C, etc.)
  if (/^V\d+[A-Z]?$/.test(sec)) return "Remaches";
  if (["W4","W6","W8","S/S","SR","BOM7","BOM8"].includes(sec)) return "Remaches";
  if (SECTORES_CRUDO_MARTIN.has(sec)) return "Sector Crudo";
  if (/p\/\s*cromar/i.test(desc)) return "Sector Crudo";
  return "Sector Procesado";
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
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Envíos (Uni) - ${d.descripcion}`)}"
              data-popup-items="${escapeHtml(d.popupEnviosItems)}"
            >+</button>
          </div>
        </td>

        <td class="center">
          <div class="cell-combo">
            <span class="cell-total"></span>
            <button
              type="button"
              class="mini-popup-btn mini-saldo-btn${d.popupSaldoNegativo ? " mini-saldo-btn--alerta" : ""}"
              data-popup-title="${escapeHtml(`Saldo - ${d.descripcion}`)}"
              data-popup-saldo="${d.popupSaldoEncoded || ""}"
              ${d.popupSaldoNegativo ? `title="Saldo negativo en algún momento — revisar movimientos"` : ""}
            >+</button>
          </div>
        </td>

        <td class="center">
          <div class="cell-combo">
            <span class="cell-total">${escapeHtml(formatNumber(d.totalEntregasUni))}</span>
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Entregas (Uni) - ${d.descripcion}`)}"
              data-popup-items="${escapeHtml(d.popupEntregasItems)}"
            >+</button>
          </div>
        </td>

        <td class="center"><b>${escapeHtml(formatNumber(d.stockInicialUni))}</b></td>
        <td class="center"><b>${escapeHtml(formatKgUni(d.kgXUni))}</b></td>
        <td class="center"><b>${escapeHtml(formatEntero(d.kgXCajon))}</b></td>
        <td class="center">
          <div class="cell-combo">
            <span class="cell-total"><b>${escapeHtml(formatNumber(d.consumoTotal))}</b></span>
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Cons x Parte - ${d.descripcion}`)}"
              data-popup-items="${escapeHtml(d.popupConsumoItems || "Sin consumo")}"
            >+</button>
          </div>
        </td>
        <td class="center"><b>${escapeHtml(formatCajones(d.maxCajones))}</b></td>
        <td class="mono">${d.codsRaw ? escapeHtml(d.codsRaw) : '<span class="zero">Sin códigos</span>'}</td>
      </tr>
    `;
}

// Sectores crudos (SC) que recibe Martin
// SECTORES_CRUDO_MARTIN se carga al inicio desde SC Kg.crudo_martin = TRUE.
// Fallback hardcoded preservado por si la BD falla.
let SECTORES_CRUDO_MARTIN = new Set(["KF2", "LF16", "KF8"]);

async function cargarSectoresCrudoMartin(){
  try {
    const { data, error } = await supabaseClient.from("SC Kg").select("SC").eq("crudo_martin", true);
    if (error) { console.warn("[ControlTall] No se pudo cargar SECTORES_CRUDO_MARTIN, uso fallback:", error.message); return; }
    if (data && data.length) SECTORES_CRUDO_MARTIN = new Set(data.map(r => String(r.SC).trim()));
  } catch (e) { console.warn("[ControlTall] cargarSectoresCrudoMartin fallo, uso fallback:", e); }
}

// Talleristas flags — leidos de tabla "Tall_ProvAT_PS" en cargarTalleristasFlags().
// Fallback hardcoded por si la BD esta vacia o falla la carga (preserva comportamiento previo).
// Maspoli y Pintos NO estan en PROVEEDORES_ART_TERMINADO porque tienen rol dual:
// ademas de prov AT, entregan partes en Cervantes via facturas (destino_entrega='facturas').
let PROVEEDORES_ART_TERMINADO = new Set([
  "Carriero", "Lopez Jose", "Manfer", "Melinox",
  "Paternal Goma", "The Plast"
]);
let TALLERISTAS_SOLO_GRJ_CART_CAJAS = new Set(["Blist-Pack", "Oscar"]);
let TALLERISTAS_MOSTRAR_GRJ = new Set(["Martin", "Carlos"]);

async function cargarTalleristasFlags() {
  try {
    const { data, error } = await supabaseClient
      .from("Tall_ProvAT_PS")
      .select("nombre, ctrl_tall, mostrar_grj, solo_grj, prov_at")
      .eq("activo", true);
    if (error) { console.warn("[ControlTall] No se pudo cargar Talleristas, uso fallback:", error.message); return; }
    if (!data || !data.length) return;
    const ctrlTall = new Set();
    const mostrarGrj = new Set();
    const soloGrj = new Set();
    const provAT = new Set();
    data.forEach(r => {
      const n = String(r.nombre || "").trim();
      if (!n) return;
      if (r.ctrl_tall) ctrlTall.add(n);
      if (r.mostrar_grj) mostrarGrj.add(n);
      if (r.solo_grj) soloGrj.add(n);
      if (r.prov_at) provAT.add(n);
    });
    // PROVEEDORES_ART_TERMINADO = prov_at TRUE Y ctrl_tall FALSE (puros prov AT que no aparecen en Control)
    PROVEEDORES_ART_TERMINADO = new Set([...provAT].filter(n => !ctrlTall.has(n)));
    TALLERISTAS_SOLO_GRJ_CART_CAJAS = soloGrj;
    TALLERISTAS_MOSTRAR_GRJ = mostrarGrj;
  } catch (e) { console.warn("[ControlTall] cargarTalleristasFlags fallo, uso fallback:", e); }
}

// Transformaciones 1:1 (Poly): override de la columna Codigos para que muestre la "ruta".
//   - Fila SP (M10/M9): mostrar el SC origen (M6/M8) — el SC es lo que el tallerista entrega.
//   - Fila SC (M6/M8): mostrar solo cods de articulo (filtrar el SC mismo, que viene de
//     Articulos VxT como cod_art).
function aplicarTransformacionEnCodigos(sectorProce, codsRaw) {
  const sec = String(sectorProce || "").trim();
  if (TRANSFORMACION_SP_TO_SC[sec]) return TRANSFORMACION_SP_TO_SC[sec];
  if (TRANSFORMACION_SCS.has(sec)) {
    return splitCodes(codsRaw).filter(c => c !== sec).join(", ");
  }
  return codsRaw;
}

// Anota cada GRJ del string codsDisplay con los articulos asociados: "GRJ7" → "GRJ7 → 506"
// Si el GRJ tiene multiples articulos: "GRJ10" → "GRJ10 → 544, 802"
// articuloPorGrj se construye en cargarSectores derivando de Despiece x Articulo.
function anotarGrjConArticulo(codsStr, sectoresData) {
  if (!codsStr) return codsStr;
  const map = sectoresData && sectoresData.articuloPorGrj;
  if (!map) return codsStr;
  return splitCodes(codsStr).map(c => {
    const cu = String(c).trim().toUpperCase();
    if (cu.startsWith("GRJ") || cu.startsWith("CP")) {
      const arts = map.get(c.trim());
      if (arts && arts.size) {
        const lista = [...arts].sort((a, b) => Number(a) - Number(b)).join(", ");
        return `${c.trim()} → ${lista}`;
      }
      return c;
    }
    return c;
  }).join(", ");
}

function convertirCodsAGrj(sectorProce, codsRaw, sectoresData, talleristaGrjs) {
  // Caso 1: el sector es un componente directo de GRJ (A10, A15, C1, C10, V9, etc.).
  // Mostrar los GRJ que lo contienen, filtrados a los que el tallerista realmente entrega.
  if (COMPONENTE_A_GRJS.has(sectorProce)) {
    const grjsDelComp = COMPONENTE_A_GRJS.get(sectorProce);
    const filtrados = talleristaGrjs && talleristaGrjs.size
      ? [...grjsDelComp].filter(g => talleristaGrjs.has(g))
      : [...grjsDelComp];
    if (filtrados.length) return filtrados.sort().join(", ");
  }
  // Caso 2 (fallback): GRJ derivado del Despiece via grjPorSector.
  if (sectoresData && sectoresData.grjPorSector) {
    const grjs = sectoresData.grjPorSector.get(sectorProce);
    if (grjs && grjs.size > 0) {
      const lista = [...grjs];
      const filtrados = talleristaGrjs && talleristaGrjs.size
        ? lista.filter(g => talleristaGrjs.has(g))
        : lista;
      if (filtrados.length) return filtrados.sort().join(", ");
    }
  }
  return codsRaw;
}

function renderResultado(nombre, datos){
  const grupos = ["Sector Procesado", "Sector Crudo", "Partes Plásticas", "Garaje", "Remaches", "Cartones", "Cajas", "Importados"];
  const soloGrjCartCajas = TALLERISTAS_SOLO_GRJ_CART_CAJAS.has(nombre);
  const categoriasPermitidas = soloGrjCartCajas ? new Set(["Garaje", "Cartones", "Cajas"]) : null;
  // Talleristas que arman GRJ (Martin/Carlos): no mostrar el grupo Garaje porque las
  // entregas de GRJ se reflejan contra los componentes (A10, A15, C1, C10, V9).
  const ocultarGaraje = TALLERISTAS_MOSTRAR_GRJ.has(nombre);
  const agrupados = {};
  grupos.forEach(g => agrupados[g] = []);

  datos.forEach(d => {
    const cat = clasificarParte(d);
    if (categoriasPermitidas && !categoriasPermitidas.has(cat)) return;
    if (ocultarGaraje && cat === "Garaje") return;
    agrupados[cat].push(d);
  });

  let rows = "";
  grupos.forEach(grupo => {
    const items = agrupados[grupo];
    if (!items.length) return;
    // Ordenar por sector A-Z (comparación natural para V1, V3, V10, V14 en orden).
    // Si no hay sector (cartones/cajas), ordenar por descripción.
    items.sort((a, b) => {
      const sa = String(a.sectorProce || "").trim();
      const sb = String(b.sectorProce || "").trim();
      if (sa && sb) return sa.localeCompare(sb, "es", { numeric: true, sensitivity: "base" });
      if (!sa && !sb) {
        return String(a.descripcion || "").localeCompare(String(b.descripcion || ""), "es", { numeric: true, sensitivity: "base" });
      }
      return sa ? -1 : 1; // los que tienen sector primero
    });
    rows += `<tr class="grupo-header"><td colspan="14">${escapeHtml(grupo)} (${items.length})</td></tr>`;
    items.forEach(d => { rows += renderFilaControl(d); });
  });

  setStatus(`Encontradas ${datos.length} partes`);

  const printRows = datos.map(d => `
      <tr>
        <td>${d.sectorProce ? escapeHtml(d.sectorProce) : '-'}</td>
        <td class="pa-desc">${escapeHtml(d.descripcion)}</td>
        <td class="pa-num">${escapeHtml(formatKg(d.onlineKg))}</td>
        <td class="pa-num">${escapeHtml(formatCajones(d.onlineCaj))}</td>
      </tr>`).join("");

  resultEl.innerHTML = `
    <div class="row-tools no-print">
      <button id="btnImprimir" type="button" class="btn-imprimir">🖨 Imprimir</button>
    </div>
    <div class="articulo">
      <div class="articulo-header">${escapeHtml(nombre)}</div>
      <table class="table">
        <colgroup>
          <col class="col-sector">
        </colgroup>
        <thead>
          <tr>
            <th colspan="2">Base</th>
            <th colspan="3">Online</th>
            <th colspan="1">Enviar</th>
            <th colspan="3">Movimientos (Uni)</th>
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
            <th>Saldo</th>
            <th>Entregas</th>

            <th>Stock<br>Inicial</th>
            <th>Kg x<br>Uni</th>
            <th>Kg x<br>Cajon</th>
            <th>Cons x<br>Parte</th>
            <th>Max<br>Cajones</th>
            <th>Codigos</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>

    <!-- VISTA IMPRESION: Sector / Descripción / Online Kg / Online Cajones -->
    <div id="printArea" class="print-only">
      <div class="print-head">
        <h2>Control Partes Tallerista — ${escapeHtml(nombre)}</h2>
      </div>
      <table class="print-table">
        <thead>
          <tr>
            <th>Sector</th>
            <th>Descripción</th>
            <th>Online Kg</th>
            <th>Online Cajones</th>
          </tr>
        </thead>
        <tbody>${printRows}</tbody>
      </table>
    </div>

    <!-- POPUP NORMAL (últimas 5) -->
    <div id="popupOverlay" class="popup-overlay hidden">
      <div class="popup-box">
        <div class="popup-head">
          <div id="popupTitle" class="popup-title"></div>
          <button id="popupClose" type="button" class="popup-close">✕</button>
        </div>
        <div id="popupBody" class="popup-body"></div>
      </div>
    </div>

    <!-- MODAL HISTORIAL COMPLETO (con scrollbar) -->
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

  const popupBox = popupOverlay.querySelector(".popup-box");

  const btnImprimir = document.getElementById("btnImprimir");
  if (btnImprimir) btnImprimir.addEventListener("click", () => window.print());

  resultEl.querySelectorAll(".mini-popup-btn").forEach(btn => {
    if (btn.classList.contains("mini-saldo-btn")) return; // saldo usa su propio handler
    btn.addEventListener("click", () => {
      const title = btn.dataset.popupTitle || "";
      const allItems = String(btn.dataset.popupItems || "").split("|").filter(x => x.trim());

      // Mostrar solo últimas 5 en orden inverso (reciente primero)
      const ultimasCinco = allItems.slice(-5).reverse();

      popupTitle.textContent = title;
      popupBody.innerHTML = ultimasCinco
        .map(x => `<div class="popup-line">${escapeHtml(x)}</div>`)
        .join("");

      // Agregar botón "Ver Historial" si hay más de 5 items
      if (allItems.length > 5){
        popupBody.innerHTML += `
          <div style="margin-top:12px; text-align:center;">
            <button id="btnVerHistorial" type="button" class="btn-ver-historial">Ver Historial</button>
          </div>
        `;

        // Event listener para botón Ver Historial
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
      .reverse() // Ordenar de más reciente a más antiguo
      .map(x => `<div class="popup-line">${escapeHtml(x)}</div>`)
      .join("");
    historialOverlay.classList.remove("hidden");
  }

  // Handler dedicado para Saldo — renderiza tabla con saldo corriendo
  resultEl.querySelectorAll(".mini-saldo-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const title = btn.dataset.popupTitle || "";
      let data;
      try {
        data = JSON.parse(decodeURIComponent(btn.dataset.popupSaldo || ""));
      } catch (e) {
        data = { stockInicial: 0, movs: [] };
      }
      const stockInicial = Number(data.stockInicial || 0);
      const consumoTotal = Number(data.consumoTotal || 0);
      const kgXUni = Number(data.kgXUni || 0);
      const puedeKg = kgXUni > 0;
      let modoSaldo = "uni"; // 'uni' | 'kg' — solo afecta la columna Saldo (6ta)

      // Convierte saldo (siempre calculado en unidades) al modo elegido para mostrar.
      function fmtSaldo(uni){
        if (modoSaldo === "kg" && puedeKg) return formatKg(uni * kgXUni) + " kg";
        return formatNumber(uni);
      }

      function buildSaldoHtml(incluirControles = true){
        let saldo = stockInicial;
        let html = "";
        if (data.negativo){
          html += `
            <div class="saldo-motivos">
              <div class="saldo-motivos-title">⚠ Saldo negativo detectado — Motivos posibles:</div>
              <ol class="saldo-motivos-list">
                <li>Falta carga de Envíos</li>
                <li>Error peso parte → genera diferencia de unidades enviadas</li>
                <li>Error carga de Entregas</li>
                <li>Error Stock Inicial</li>
              </ol>
            </div>
          `;
        }
        if (consumoTotal > 0) {
          html += `
            <div class="saldo-leyenda-azul">
              ℹ <strong>Celdas azules:</strong> saldo superior al consumo por parte (${formatNumber(Math.round(consumoTotal))} uni)
            </div>
          `;
        }
        if (incluirControles){
          html += `
            <div class="saldo-toggle">
              <span class="saldo-toggle-label">Ver saldo en:</span>
              <button type="button" class="saldo-toggle-btn${modoSaldo === "uni" ? " active" : ""}" data-modo="uni">Uni</button>
              <button type="button" class="saldo-toggle-btn${modoSaldo === "kg" ? " active" : ""}" data-modo="kg"${puedeKg ? "" : " disabled title='Sin peso x unidad (cartones/cajas)'"}>Kg</button>
              <button type="button" id="btnImprimirSaldo" class="btn-imprimir-saldo">🖨 Imprimir</button>
            </div>
          `;
        }
        html += `
          <table class="saldo-table">
            <thead>
              <tr>
                <th>Concepto</th>
                <th>Fecha</th>
                <th>Uni<br>Medida</th>
                <th>Cant</th>
                <th>Unidad</th>
                <th>Saldo<br>(${modoSaldo === "kg" ? "Kg" : "Uni"})</th>
                <th>Cod</th>
              </tr>
            </thead>
            <tbody>
              <tr class="saldo-inicio">
                <td>Inicio</td>
                <td></td>
                <td></td>
                <td></td>
                <td>${escapeHtml(fmtSaldo(stockInicial))}</td>
                <td>${escapeHtml(fmtSaldo(stockInicial))}</td>
                <td></td>
              </tr>
        `;

        (data.movs || []).forEach(m => {
          const unidades = Number(m.unidades || 0);
          saldo += unidades;
          let cls = m.concepto === "Envío" ? "saldo-envio" : (m.concepto === "Devolución" ? "saldo-devolucion" : "saldo-entrega");
          if (saldo < 0) cls += " saldo-neg-row";
          const unidadStr = (unidades >= 0 ? "+" : "-") + formatNumber(Math.abs(unidades));
          const cantNum = Number(m.cant || 0);
          const cantStr = Number.isInteger(cantNum) ? formatNumber(cantNum) : formatDecimal(cantNum);
          const saldoStr = fmtSaldo(saldo);
          // Coloreado siempre sobre el saldo en unidades (independiente del modo de visualización)
          const saldoCls = saldo < 0 ? "saldo-neg-cell" : (consumoTotal > 0 && saldo > consumoTotal ? "saldo-sobra-cell" : "");
          const saldoCell = saldoCls ? `<td class="${saldoCls}">${escapeHtml(saldoStr)}</td>` : `<td>${escapeHtml(saldoStr)}</td>`;
          html += `
            <tr class="${cls}">
              <td>${escapeHtml(m.concepto || "")}</td>
              <td>${escapeHtml(formatFechaDDMMAAAA(m.fecha || ""))}</td>
              <td>${escapeHtml(m.uniMedida || "")}</td>
              <td>${escapeHtml(cantStr)}</td>
              <td>${escapeHtml(unidadStr)}</td>
              ${saldoCell}
              <td>${escapeHtml(m.cod || "")}</td>
            </tr>
          `;
        });

        html += `</tbody></table>`;
        return html;
      }

      // Imprime el módulo Saldo entero en ventana aparte (tabla en el modo actual).
      function printSaldo(){
        const cuerpo = buildSaldoHtml(false); // sin botones de control
        const win = window.open("", "_blank", "width=900,height=700");
        if (!win) { alert("El navegador bloqueó la ventana de impresión. Permití pop-ups para imprimir."); return; }
        win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
          <title>${escapeHtml(title)}</title>
          <style>
            *{box-sizing:border-box}
            body{font-family:Arial,sans-serif;padding:18px;color:#111}
            h2{font-size:18px;margin:0 0 12px}
            table{width:100%;border-collapse:collapse}
            th,td{border:1px solid #111;padding:6px 8px;font-size:12px;text-align:center;font-variant-numeric:tabular-nums}
            thead th{background:#eee;-webkit-print-color-adjust:exact;print-color-adjust:exact}
            tr.saldo-inicio{font-weight:700;background:#fafbfc}
            tr.saldo-devolucion td{background:#fef3c7;-webkit-print-color-adjust:exact;print-color-adjust:exact}
            td.saldo-neg-cell{background:#fee2e2;color:#991b1b;font-weight:800}
            td.saldo-sobra-cell{background:#2563eb;color:#fff;font-weight:800}
            .saldo-motivos{border:1px solid #dc2626;background:#fef2f2;color:#7f1d1d;padding:8px 12px;margin-bottom:10px;font-size:12px}
            .saldo-motivos-title{font-weight:800;margin-bottom:4px}
            .saldo-leyenda-azul{border:1px solid #2563eb;background:#eff6ff;color:#1e3a8a;padding:8px 12px;margin-bottom:10px;font-size:12px}
            tr{page-break-inside:avoid}
            thead{display:table-header-group}
            @page{margin:14mm}
          </style></head><body>
          <h2>${escapeHtml(title)} — Saldo en ${modoSaldo === "kg" ? "Kg" : "Unidades"}</h2>
          ${cuerpo}
          </body></html>`);
        win.document.close();
        win.focus();
        win.onload = () => { win.print(); };
        // Fallback si onload no dispara (documento ya cargado)
        setTimeout(() => { try { win.print(); } catch(e){} }, 300);
      }

      function renderSaldo(){
        popupBody.innerHTML = buildSaldoHtml(true);
        popupBody.querySelectorAll(".saldo-toggle-btn").forEach(b => {
          b.addEventListener("click", () => {
            if (b.disabled) return;
            modoSaldo = b.dataset.modo;
            renderSaldo();
          });
        });
        const btnImp = popupBody.querySelector("#btnImprimirSaldo");
        if (btnImp) btnImp.addEventListener("click", printSaldo);
      }

      popupTitle.textContent = title;
      renderSaldo();
      popupBox.classList.add("popup-box-saldo");
      popupOverlay.classList.remove("hidden");
    });
  });

  popupClose.addEventListener("click", () => {
    popupOverlay.classList.add("hidden");
    popupBox.classList.remove("popup-box-saldo");
  });

  popupOverlay.addEventListener("click", e => {
    if (e.target === popupOverlay){
      popupOverlay.classList.add("hidden");
      popupBox.classList.remove("popup-box-saldo");
    }
  });

  historialClose.addEventListener("click", () => {
    historialOverlay.classList.add("hidden");
  });

  historialOverlay.addEventListener("click", e => {
    if (e.target === historialOverlay){
      historialOverlay.classList.add("hidden");
    }
  });
}
txtBuscarTall.addEventListener("input", () => {
  if (talleristaActivo === "__TODOS__") renderTodosFiltrados();
  else if (talleristaActivo) renderFilasFiltradas(talleristaActivo);
});

document.addEventListener("DOMContentLoaded", () => {
  // Precalienta cache GRJ_Componentes en background (no bloqueante).
  // Si falla, buscar() lo retentara y mostrara error explicito al usuario.
  cargarGRJDesdeBD().catch(() => {});
  cargarSectoresCrudoMartin().catch(() => {});
  // Cargar flags de Talleristas antes para que cargarTalleristas use el set correcto.
  cargarTalleristasFlags().finally(() => cargarTalleristas());
});
cargarGRJDesdeBD().catch(() => {});
cargarSectoresCrudoMartin().catch(() => {});
cargarTalleristasFlags().finally(() => cargarTalleristas());
