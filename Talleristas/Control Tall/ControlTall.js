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
let sectoresCache = null;
let stockTalleristaCache = null;
let entregasCache = null;
let enviosCache = null;
let sectoresPorTalleristaCache = null;
let articulosCajasCache = null;
let cajasCache = null;

let talleristaActivo = "";
let listaTalleristas = [];
let filasRenderizadas = [];
let datosParaFiltro = [];

// Mapeo de artículos GRJ a sus componentes (entrega = descuento de componentes)
const GRJ_COMPONENTES = {
  GRJ7: ["A10","C10","V9"],
  GRJ9: ["A15","C10","V9"],
  GRJ1: ["C1","C10","V9"],
  GRJ10: ["Fleje31","Fleje32","LLF7B","LLF8"]
};

// Partes crudas de Martin: el consumo se infiere del consumo (E. Madre) de los artículos finales
// que las usan. KF2 y V3C son comunes a 520 y 521. KF8 solo va al 521. LF16 solo al 520.
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
  return Number(n || 0).toLocaleString("es-AR");
}

function formatDecimal(n){
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
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

  const m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
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
          <td class="center"><b>${escapeHtml(formatDecimal(d.kgXCajon))}</b></td>
        </tr>`;
    });
  }

  setStatus(`${filtrados.length} piezas en ${porTall.size} talleristas`);

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

      const cod = normalizeCode(codRaw);
      const consumo = parseConsumo(consumoRaw);

      if (!cod) return;
      mapDestino.set(cod, consumo);
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
  return finalMap;
}

async function cargarSectores(){
  if (sectoresCache) return sectoresCache;

  const { data, error } = await supabaseClient
    .from("Despiece x Articulo")
    .select("*")
    .limit(20000);

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
    codsPorSector,
    rubroBySector,
    rubroByPart
  };

  return sectoresCache;
}

async function cargarStockTallerista(){
  if (stockTalleristaCache) return stockTalleristaCache;

  const { data, error } = await supabaseClient
    .from("Articulos Virgilio X Tallerista")
    .select("*")
    .limit(20000);

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

  const [respEntregas, respPartes] = await Promise.all([
    supabaseClient.from("Entregas Tallerista Virgilio").select("*").limit(20000),
    supabaseClient.from("Partes x Tallerista").select("*").limit(20000)
  ]);

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
  const stockInicialByTallAndSector = new Map(); // tallerista__sector → kg (primer valor no-cero)
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

      // stock_inicial por sector (para talleristas sin stock en la vista)
      const stockIni = parseDecimal(pick(r, ["stock_inicial", "Stock_Inicial"]));
      const siKey = `${nombreTall}__${sectorProce}`;
      if (stockIni > 0 && !stockInicialByTallAndSector.has(siKey)) {
        stockInicialByTallAndSector.set(siKey, stockIni);
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

    if (!detalleByNombreTallAndCod.has(key)) detalleByNombreTallAndCod.set(key, []);
    detalleByNombreTallAndCod.get(key).push({
      fecha,
      cajas,
      cod,
      codGrj,
      kgGrj
    });
  });

  for (const [key, arr] of detalleByNombreTallAndCod.entries()){
    arr.sort((a, b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));
    detalleByNombreTallAndCod.set(key, arr);
  }

  entregasCache = {
    detalleByNombreTallAndCod,
    uniXCajaByNombreTallAndCod,
    uniXCajaBySector,
    sectorByTallAndCod,
    stockInicialByTallAndSector
  };

  return entregasCache;
}

async function cargarEnvios(){
  if (enviosCache) return enviosCache;

  const { data, error } = await supabaseClient
    .from("Envios a Talleristas")
    .select("*")
    .limit(20000);

  if (error){
    console.error(error);
    throw new Error("Error al leer Envios a Talleristas");
  }

  const detalleMap = new Map();
  const totalKgMap = new Map();
  const totalUnidadesMap = new Map();
  const totalUniMap = new Map();

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
  });

  for (const [key, arr] of detalleMap.entries()){
    arr.sort((a, b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));
    detalleMap.set(key, arr);
  }

  enviosCache = {
    detalleMap,
    totalKgMap,
    totalUnidadesMap,
    totalUniMap
  };

  return enviosCache;
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

function obtenerCajasPorTallerista(filasTallerista, articulosCajas, cajasData){
  const codsDelTallerista = new Set();
  filasTallerista.forEach(r => {
    const codsRaw = String(pick(r, ["cod_articulos", "Cod_articulos", "COD_ARTICULOS"]) || "");
    splitCodes(codsRaw).forEach(c => codsDelTallerista.add(c));
  });

  // Mapear N_Caja → Set de Cod_Art que usan esa caja (del tallerista)
  const codsPorCaja = new Map();
  const nCajasSet = new Set();
  (articulosCajas || []).forEach(ac => {
    const cod = normalizeCode(String(ac.Cod_Art || ""));
    if (codsDelTallerista.has(cod)){
      const nCaja = Number(ac.N_Caja || 0);
      if (nCaja > 0) {
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
    if (maxUni <= 0) return;
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

  // Expandir códigos GRJ a sus componentes
  const codigosExpandidos = [];
  for (const cod of codigos){
    codigosExpandidos.push(cod);
    if (GRJ_COMPONENTES[cod]) {
      codigosExpandidos.push(...GRJ_COMPONENTES[cod]);
    }
  }

  for (const cod of codigosExpandidos){
    const key = `${nombreTallNorm}__${cod}`;

    const arr = entregasData.detalleByNombreTallAndCod.get(key) || [];
    arr.forEach(x => {
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

  detalle.sort((a, b) => sortKeyFechaDDMM(a.fecha) - sortKeyFechaDDMM(b.fecha));

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

  const filasTallerista = (data || []).filter(r => {
    const t = String(pick(r, ["Tallerista", "tallerista", "TALLERISTA"]) || "").trim();
    return t === nombre;
  });

  if (!filasTallerista.length){
    setStatus("No encontré resultados");
    return;
  }

  let consumoMap, sectoresData, stockMap, entregasData, enviosData, articulosCajas, cajasData;

  try{
    [consumoMap, sectoresData, stockMap, entregasData, enviosData, articulosCajas, cajasData] = await Promise.all([
      cargarConsumos(),
      cargarSectores(),
      cargarStockTallerista(),
      cargarEntregas(),
      cargarEnvios(),
      cargarArticulosCajas(),
      cargarCajas()
    ]);
  }catch (err){
    console.error(err);
    setStatus(err.message || "Error al cargar datos");
    return;
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

    const kgXCajon = obtenerKgXCajon(descripcion, codigos, sectoresData);
    const kgXUni = obtenerKgXUni(descripcion, codigos, sectoresData);
    const partesXUni = obtenerPartesXUni(descripcion, codigos, sectoresData);

    let consumoTotal = 0;
    codigos.forEach(cod => {
      consumoTotal += Number(consumoMap.get(cod) || 0);
    });
    // Si consumo es 0 y tenemos sector, buscar consumo via artículos que usan ese sector
    if (consumoTotal === 0 && sectorProce && sectoresData.codsPorSector) {
      const codsDelSector = sectoresData.codsPorSector.get(sectorProce);
      if (codsDelSector) {
        codsDelSector.forEach(cod => {
          consumoTotal += Number(consumoMap.get(cod) || 0);
        });
      }
    }

    const esCarton = normalizeText(descripcion).startsWith("carton");
    const maxCajones = esCarton
      ? (consumoTotal > 0 ? consumoTotal / 1000 : 0)
      : calcularCajones(consumoTotal, kgXUni, partesXUni, kgXCajon);

    let stockInicialKg = parseDecimal(
      pick(r, [
        "Stock Inicial",
        "stock_inicial",
        "stock inicial",
        "Stock_Inicial"
      ])
    );
    if (!stockInicialKg && sectorProce && entregasData.stockInicialByTallAndSector) {
      const siKey = `${normalizeText(nombre)}__${sectorProce}`;
      stockInicialKg = entregasData.stockInicialByTallAndSector.get(siKey) || 0;
    }

    const enviosInfo = obtenerEnviosTallerista(nombre, sectorProce, descripcion, enviosData, kgXUni);
    const totalEnviosUni = enviosInfo.totalUni;

    const entregasInfo = obtenerEntregasTallerista(nombre, codigos, entregasData, sectorProce, esCarton ? 1 : undefined);
    const totalEntregasUni = entregasInfo.totalUnidades;

    let onlineUni, onlineKg, onlineCaj;
    if (esCarton) {
      // Cartones se cuentan en unidades (no tienen kgXUni ni kgXCajon)
      onlineUni = totalEnviosUni - totalEntregasUni;
      onlineKg = 0;
      onlineCaj = onlineUni;
    } else if (kgXUni > 0) {
      onlineUni = (stockInicialKg / kgXUni) + totalEnviosUni - totalEntregasUni;
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
          .map(x => `${x.fecha} - ${formatDecimal(x.kg)} kg - ${formatCajones(x.cajones)} caj - ${formatNumber(x.unidades)} uni`)
          .join("|")
      : "Sin envíos";

    const popupEntregasItems = entregasInfo.detalle.length
      ? entregasInfo.detalle.map(x =>
          x.codGrj
            ? `${x.codGrj} - ${formatDecimal(x.kgGrj)} Kg - ${formatNumber(x.unidades)} uni`
            : `${x.fecha} - Cod ${x.cod} - ${formatNumber(x.unidades)} uni`
        ).join("|")
      : "Sin entregas";

    const codsDisplay = TALLERISTAS_MOSTRAR_GRJ.includes(nombre)
      ? convertirCodsAGrj(sectorProce, codsRaw, sectoresData)
      : codsRaw;

    const rubro = (sectoresData.rubroBySector && sectoresData.rubroBySector.get(sectorProce))
                || (sectoresData.rubroByPart && sectoresData.rubroByPart.get(normalizeText(descripcion)))
                || "";

    datosParaFiltro.push({
      sectorProce, descripcion, codsRaw: codsDisplay, rubro,
      onlineKg, onlineCaj, onlineUni, cajonesEnviar,
      totalEnviosUni, totalEntregasUni,
      popupEnviosItems, popupEntregasItems,
      stockInicialKg, kgXUni, kgXCajon, consumoTotal, maxCajones
    });
  });

  // Agregar cajas (se envían en unidades como cartones)
  const cajasItems = obtenerCajasPorTallerista(filasTallerista, articulosCajas, cajasData);
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
            : `${x.fecha} - Cod ${x.cod} - ${formatNumber(x.unidades)} uni`
        ).join("|")
      : "Sin entregas";

    datosParaFiltro.push({
      sectorProce: c.sector,
      descripcion: c.descripcion,
      codsRaw: "",
      onlineKg: 0,
      onlineCaj: c.stockVirg,
      onlineUni,
      cajonesEnviar,
      totalEnviosUni,
      totalEntregasUni,
      popupEnviosItems: enviosInfo.detalle.length
        ? enviosInfo.detalle.map(x => `${x.fecha} - ${formatNumber(x.unidades)} uni`).join("|")
        : "Sin envíos",
      popupEntregasItems,
      stockInicialKg: 0,
      kgXUni: 0,
      kgXCajon: 0,
      consumoTotal: c.maxUni,
      maxCajones: c.maxUni
    });
  });

  renderFilasFiltradas(nombre);

  renderResultado(nombre, datosParaFiltro);
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
  if (rubro === "Remaches") return "Remaches";
  if (rubro === "Plásticos" || rubro === "Plasticos") return "Partes Plásticas";
  if (sec.startsWith("GRJ") || sec.startsWith("CP")) return "Garaje";
  if (sec.startsWith("P")) return "Partes Plásticas";
  // Fallback remaches: sectores V seguidos de dígito (V1, V3, V14, V3C, V16C, etc.)
  if (/^V\d+[A-Z]?$/.test(sec)) return "Remaches";
  if (["W4","W6","W8","S/S","SR","BOM7","BOM8"].includes(sec)) return "Remaches";
  if (SECTORES_CRUDO_MARTIN.has(sec)) return "Sector Crudo";
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
            <span class="cell-total">${escapeHtml(formatNumber(d.totalEntregasUni))}</span>
            <button
              type="button"
              class="mini-popup-btn"
              data-popup-title="${escapeHtml(`Entregas (Uni) - ${d.descripcion}`)}"
              data-popup-items="${escapeHtml(d.popupEntregasItems)}"
            >+</button>
          </div>
        </td>

        <td class="center"><b>${escapeHtml(formatDecimal(d.stockInicialKg))}</b></td>
        <td class="center"><b>${escapeHtml(formatKgUni(d.kgXUni))}</b></td>
        <td class="center"><b>${escapeHtml(formatDecimal(d.kgXCajon))}</b></td>
        <td class="center"><b>${escapeHtml(formatNumber(d.consumoTotal))}</b></td>
        <td class="center"><b>${escapeHtml(formatCajones(d.maxCajones))}</b></td>
        <td class="mono">${d.codsRaw ? escapeHtml(d.codsRaw) : '<span class="zero">Sin códigos</span>'}</td>
      </tr>
    `;
}

// Sectores crudos (SC) que recibe Martin
const SECTORES_CRUDO_MARTIN = new Set(["KF2", "LF16", "KF8"]);

// Proveedores de artículo terminado — no son talleristas de partes, no deben aparecer en Control
const PROVEEDORES_ART_TERMINADO = new Set([
  "Carriero", "Lopez Jose", "Manfer", "Maspoli", "Melinox",
  "Paternal Goma", "Pintos", "The Plast"
]);

// Talleristas que solo reciben GRJ (producto armado) + cartones + cajas, no partes sueltas
const TALLERISTAS_SOLO_GRJ_CART_CAJAS = ["Blist-Pack", "Oscar"];
// Talleristas que arman GRJ: en columna Codigos mostrar el GRJ destino en vez de cod artículo
const TALLERISTAS_MOSTRAR_GRJ = ["Martin", "Carlos"];

function convertirCodsAGrj(sectorProce, codsRaw, sectoresData) {
  if (!sectoresData || !sectoresData.grjPorSector) return codsRaw;
  const grjs = sectoresData.grjPorSector.get(sectorProce);
  if (grjs && grjs.size > 0) return [...grjs].sort().join(", ");
  return codsRaw;
}

function renderResultado(nombre, datos){
  const grupos = ["Sector Procesado", "Sector Crudo", "Partes Plásticas", "Garaje", "Remaches", "Cartones", "Cajas"];
  const soloGrjCartCajas = TALLERISTAS_SOLO_GRJ_CART_CAJAS.includes(nombre);
  const categoriasPermitidas = soloGrjCartCajas ? new Set(["Garaje", "Cartones", "Cajas"]) : null;
  const agrupados = {};
  grupos.forEach(g => agrupados[g] = []);

  datos.forEach(d => {
    const cat = clasificarParte(d);
    if (categoriasPermitidas && !categoriasPermitidas.has(cat)) return;
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

  setStatus(`Encontradas ${datos.length} piezas`);

  resultEl.innerHTML = `
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
        <tbody>
          ${rows}
        </tbody>
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

  resultEl.querySelectorAll(".mini-popup-btn").forEach(btn => {
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

  popupClose.addEventListener("click", () => {
    popupOverlay.classList.add("hidden");
  });

  popupOverlay.addEventListener("click", e => {
    if (e.target === popupOverlay){
      popupOverlay.classList.add("hidden");
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
  cargarTalleristas();
});
cargarTalleristas();
