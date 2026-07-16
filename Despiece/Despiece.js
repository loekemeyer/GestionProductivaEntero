"use strict";

/* =========================================================
   BLOQUE: CONFIG SUPABASE
========================================================= */
const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLA = "Despiece x Articulo";

/* =========================================================
   BLOQUE: DOM
========================================================= */
const statusEl      = document.getElementById("status");
const resultEl      = document.getElementById("result");
const searchInput   = document.getElementById("searchInput");
const filtroRubro   = document.getElementById("filtroRubro");
const btnAgregar    = document.getElementById("btnAgregar");

const modalOverlay  = document.getElementById("modalOverlay");
const modalTitle    = document.getElementById("modalTitle");
const modalClose    = document.getElementById("modalClose");
const fCod          = document.getElementById("fCod");
const fArticulo     = document.getElementById("fArticulo");
const fSector       = document.getElementById("fSector");
const fDescripcion  = document.getElementById("fDescripcion");
const fPartesUni    = document.getElementById("fPartesUni");
const fPartesCja    = document.getElementById("fPartesCja");
const fUniCja       = document.getElementById("fUniCja");
// N° Caja removed from form
const formError     = document.getElementById("formError");
const btnGuardar    = document.getElementById("btnGuardar");
const btnCancelarForm = document.getElementById("btnCancelarForm");

const confirmOverlay     = document.getElementById("confirmOverlay");
const confirmClose       = document.getElementById("confirmClose");
const confirmMsg         = document.getElementById("confirmMsg");
const btnConfirmEliminar = document.getElementById("btnConfirmEliminar");
const btnConfirmCancelar = document.getElementById("btnConfirmCancelar");

/* =========================================================
   BLOQUE: ESTADO
========================================================= */
let todosLosRows = [];
let editandoId   = null;
let lkSet        = new Set();
let chSet        = new Set();

/* =========================================================
   BLOQUE: HELPERS
========================================================= */
function setStatus(texto) {
  statusEl.textContent = texto || "";
}

function escapeHtml(texto) {
  return String(texto ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normCod(v) {
  return String(v ?? "").trim().toUpperCase();
}

function formatNum(n) {
  const num = Number(n ?? 0);
  if (!Number.isFinite(num) || num === 0) return "";
  return num.toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

function getRubro(sector, descripcion) {
  const d = String(descripcion ?? "").trim().toLowerCase();

  // Cajas por descripción
  if (d.startsWith("caja n") || d.startsWith("caja ")) {
    return "Cajas";
  }

  // Cartones por descripción
  if (d.startsWith("cartón") || d.startsWith("carton")) {
    return "Cartones";
  }

  const s = String(sector ?? "").trim().toUpperCase();

  // Plásticos
  if (s.startsWith("P") || s.startsWith("GRJ")) {
    return "Plásticos";
  }

  // Remaches SP
  if (["V13", "W4", "W6", "W8"].includes(s)) {
    return "Remaches SP";
  }

  // SC
  if (["ABPM", "LLF1", "LLF2", "LLF3", "LLF4", "N7", "N8", "W9"].includes(s)) {
    return "SC";
  }

  // SP (letras solas o patrones específicos)
  if (/^[A-E](\d+|$)/.test(s) ||
      /^[FM]\d+/.test(s) ||
      ["W1B", "W1P", "W2P", "W3P", "W7P", "W9P"].includes(s) ||
      /^[XZ]/.test(s)) {
    return "SP";
  }

  // Fleje
  if (s.startsWith("F")) {
    return "Fleje";
  }

  return "Otros";
}

/* =========================================================
   BLOQUE: CARGA E. MADRE (para columna Marca)
========================================================= */
let lkDescMap = new Map();
let chDescMap = new Map();

function normDesc(v) {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.\s]+/g, " ")
    .trim();
}

async function cargarEMadre() {
  const [resLK, resCH] = await Promise.all([
    supabaseClient.from("E. Madre LK").select(`"Cod","Desc"`),
    supabaseClient.from("E. Madre CH").select(`"Cod","Desc"`),
  ]);
  if (resLK.error) throw new Error("Error E. Madre LK: " + resLK.error.message);
  if (resCH.error) throw new Error("Error E. Madre CH: " + resCH.error.message);

  lkSet = new Set();
  chSet = new Set();
  lkDescMap = new Map();
  chDescMap = new Map();

  (resLK.data || []).forEach(r => {
    const cod = normCod(r["Cod"]);
    if (cod) {
      lkSet.add(cod);
      lkDescMap.set(cod, normDesc(r["Desc"]));
    }
  });

  (resCH.data || []).forEach(r => {
    const cod = normCod(r["Cod"]);
    if (cod) {
      chSet.add(cod);
      chDescMap.set(cod, normDesc(r["Desc"]));
    }
  });
}

/* =========================================================
   BLOQUE: MAPA SECTOR → DESCRIPCION DE PARTE
========================================================= */
let sectorDescMap = new Map();

async function cargarSectorDesc() {
  const [resSP, resSC, resPP, resRSC, resRSP, resBOMB] = await Promise.all([
    supabaseClient.from("SP Kg").select('"Sp","Parte"'),
    supabaseClient.from("SC Kg").select('"SC","Descripcion"'),
    supabaseClient.from("Partes_Plasticas").select('"Sector","Descripcion"'),
    supabaseClient.from("Remaches SC").select("*"),
    supabaseClient.from("Remaches SP").select("*"),
    supabaseClient.from("BOMB").select('"Sector","Descripcion"'),
  ]);

  sectorDescMap = new Map();

  (resSP.data || []).forEach(r => {
    const s = (r["Sp"] || "").trim().toUpperCase();
    if (s) sectorDescMap.set(s, (r["Parte"] || "").trim());
  });
  (resSC.data || []).forEach(r => {
    const s = (r["SC"] || "").trim().toUpperCase();
    if (s) sectorDescMap.set(s, (r["Descripcion"] || "").trim());
  });
  (resPP.data || []).forEach(r => {
    const s = (r["Sector"] || "").trim().toUpperCase();
    if (s) sectorDescMap.set(s, (r["Descripcion"] || "").trim());
  });
  (resRSC.data || []).forEach(r => {
    const s = (r["SC"] || "").trim().toUpperCase();
    if (s && !sectorDescMap.has(s)) sectorDescMap.set(s, (r["Descripción"] || "").trim());
  });
  (resRSP.data || []).forEach(r => {
    const s = (r["SP"] || "").trim().toUpperCase();
    if (s && !sectorDescMap.has(s)) sectorDescMap.set(s, (r["Descripción"] || "").trim());
  });
  (resBOMB.data || []).forEach(r => {
    const s = (r["Sector"] || "").trim().toUpperCase();
    if (s) sectorDescMap.set(s, (r["Descripcion"] || "").trim());
  });
}

/* =========================================================
   BLOQUE: CAUSA-EFECTO (cadena de fabricación)
   Lógica: recorre Causa-Efecto hacia atrás desde un sector SP
   hasta llegar a Fleje (materia prima). Usa Partes x PS para
   identificar qué proveedor de servicio realiza cada paso PS.
========================================================= */
let causaEfectoRows = [];
let partesXPSRows   = [];

async function fetchAllRows(tabla) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabaseClient
      .from(tabla)
      .select("*")
      .range(from, from + PAGE - 1);
    if (error) { console.error("ERROR " + tabla + ":", error); break; }
    if (!data || !data.length) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function cargarCausaEfecto() {
  causaEfectoRows = await fetchAllRows("Causa-Efecto");
  console.log("[Causa-Efecto]", causaEfectoRows.length, "filas");

  partesXPSRows = await fetchAllRows("Partes x PS");
  console.log("[Partes x PS]", partesXPSRows.length, "filas");
}

/**
 * Busca en Partes x PS qué proveedores procesan un sector SC→SP dado.
 * Devuelve { proveedores: ["Daniel","Jade",...], proceso: "Pintado" }
 */
function buscarProveedoresPS(sectorSC, sectorSP) {
  const matches = partesXPSRows.filter(r => {
    const sc = (r["SC"] || "").trim();
    const sp = (r["SP"] || "").trim();
    // Matchear por SC→SP o solo por SP si no tiene SC
    if (sectorSC && sc === sectorSC && sp === sectorSP) return true;
    if (!sectorSC && sp === sectorSP) return true;
    return false;
  });

  if (!matches.length) return null;

  const proveedores = [...new Set(matches.map(r => (r["PS"] || "").trim()).filter(Boolean))];
  const proceso = (matches[0]["Proceso"] || "").trim();
  return { proveedores, proceso };
}

/**
 * Traza la cadena completa hacia atrás desde un sector.
 * Devuelve un array lineal de pasos, de materia prima a SP final.
 * Cada paso: { tipo, sector, descSector, matriz, matrizDesc, proveedores, proceso }
 *
 * Maneja ramas: si un sector tiene múltiples insumos (ej: remachado usa 2 partes),
 * genera una rama por cada insumo.
 */
function trazarCadena(sectorFinal) {
  const cadenas = _trazarRecursivo(sectorFinal, new Set());
  // cadenas es un array de ramas. Cada rama es un array de pasos (de MP a SP).
  return cadenas;
}

function _trazarRecursivo(sector, visitados) {
  if (!sector || visitados.has(sector)) return [[{ tipo: _tipoNodo(sector), sector, descSector: sectorDescMap.get((sector||"").toUpperCase()) || "" }]];
  visitados.add(sector);

  // Buscar qué produce este sector
  const productores = causaEfectoRows.filter(r => (r["Aumenta"] || "").trim() === sector);

  if (!productores.length) {
    // Nodo hoja: materia prima (fleje) o sin datos
    return [[{ tipo: _tipoNodo(sector), sector, descSector: sectorDescMap.get(sector.toUpperCase()) || "" }]];
  }

  // Agrupar por matriz (una matriz puede consumir varios insumos)
  const porMatriz = new Map();
  productores.forEach(r => {
    const mat  = (r["Matriz"] || "").trim();
    const desc = (r["Descripcion Matriz"] || "").trim();
    const desc_ = (r["Descuenta"] || "").trim();
    if (!porMatriz.has(mat)) porMatriz.set(mat, { matrizDesc: desc, insumos: [] });
    if (desc_) porMatriz.get(mat).insumos.push(desc_);
  });

  const todasLasRamas = [];

  for (const [matriz, info] of porMatriz) {
    const esPS = matriz === "Prov Servicio";

    // Para cada insumo de esta matriz, trazar hacia atrás
    const insumos = info.insumos.length ? info.insumos : [null];

    for (const insumo of insumos) {
      // Trazar recursivamente el insumo
      const ramasInsumo = insumo ? _trazarRecursivo(insumo, new Set(visitados)) : [[]];

      for (const rama of ramasInsumo) {
        // Agregar el paso de la matriz
        const pasoMatriz = {
          tipo: esPS ? "ps" : "matriz",
          sector: sector,
          descSector: sectorDescMap.get(sector.toUpperCase()) || "",
          matriz: matriz,
          matrizDesc: info.matrizDesc,
          proveedores: null,
          proceso: null,
        };

        // Si es Prov Servicio, buscar quién lo hace
        if (esPS) {
          const psInfo = buscarProveedoresPS(insumo, sector);
          if (psInfo) {
            pasoMatriz.proveedores = psInfo.proveedores;
            pasoMatriz.proceso = psInfo.proceso;
          }
        }

        todasLasRamas.push([...rama, pasoMatriz]);
      }
    }
  }

  return todasLasRamas;
}

function _tipoNodo(sector) {
  const s = (sector || "").trim();
  if (s.startsWith("Fleje ")) return "fleje";
  return "sector";
}

/**
 * Convierte una rama en una cadena lineal de nodos para mostrar horizontal.
 * Cada nodo: { label, sub, color }
 */
function ramaANodos(rama, sectorFinal) {
  const nodos = [];

  rama.forEach(paso => {
    if (paso.tipo === "fleje") {
      nodos.push({ label: paso.sector, sub: "", color: "fleje" });
    } else if (paso.tipo === "matriz") {
      nodos.push({ label: "Matriz " + paso.matriz, sub: paso.matrizDesc, color: "matriz" });
      // Resultado intermedio
      nodos.push({ label: paso.sector, sub: paso.descSector, color: "inter" });
    } else if (paso.tipo === "ps") {
      const prov = paso.proveedores && paso.proveedores.length
        ? paso.proveedores.join(" / ")
        : "Prov. Servicio";
      const sub = paso.proceso ? paso.proceso : "";
      nodos.push({ label: "PS " + prov, sub: sub, color: "ps" });
    } else {
      nodos.push({ label: paso.sector, sub: paso.descSector, color: "inter" });
    }
  });

  // Agregar nodo final SP
  const descFinal = sectorDescMap.get(sectorFinal.toUpperCase()) || "";
  nodos.push({ label: sectorFinal, sub: descFinal, color: "sp" });

  return nodos;
}

function renderCadenaHTML(ramas, sectorFinal) {
  if (!ramas || !ramas.length) return '<div class="cadena-vacia">No se encontraron pasos en Causa-Efecto para este sector.</div>';

  const descFinal = sectorDescMap.get(sectorFinal.toUpperCase()) || "";
  let html = "";

  // Encabezado: sector al principio
  html += `<div class="cadena-header"><strong>${escapeHtml(sectorFinal)}</strong>${descFinal ? " — " + escapeHtml(descFinal) : ""}</div>`;

  ramas.forEach((rama, idx) => {
    if (ramas.length > 1) {
      html += `<div class="cadena-rama-label">Rama ${idx + 1}</div>`;
    }

    const nodos = ramaANodos(rama, sectorFinal);

    html += '<div class="cadena-flow">';
    nodos.forEach((nodo, i) => {
      if (i > 0) {
        html += '<div class="cadena-arrow">→</div>';
      }
      html += `<div class="cadena-nodo cadena-nodo-${nodo.color}">`;
      html += `<div class="cadena-nodo-label">${escapeHtml(nodo.label)}</div>`;
      if (nodo.sub) {
        html += `<div class="cadena-nodo-sub">${escapeHtml(nodo.sub)}</div>`;
      }
      html += '</div>';
    });
    html += '</div>';
  });

  return html;
}

function abrirCadena(sector) {
  const overlay = document.getElementById("cadenaOverlay");
  const title   = document.getElementById("cadenaTitle");
  const body    = document.getElementById("cadenaBody");

  title.textContent = "Cadena de fabricación";

  body.innerHTML = '<div class="cadena-loading">Trazando cadena...</div>';
  overlay.classList.remove("hidden");

  setTimeout(() => {
    const ramas = trazarCadena(sector);
    body.innerHTML = renderCadenaHTML(ramas, sector);
  }, 50);
}

function cerrarCadena() {
  document.getElementById("cadenaOverlay").classList.add("hidden");
}

document.getElementById("cadenaClose").addEventListener("click", cerrarCadena);
document.getElementById("cadenaOverlay").addEventListener("click", (e) => {
  if (e.target === document.getElementById("cadenaOverlay")) cerrarCadena();
});

/* =========================================================
   BLOQUE: CARGA TABLA
========================================================= */
async function cargarTabla() {
  setStatus("Cargando…");
  resultEl.innerHTML = "";

  const [despieceRes] = await Promise.all([
    supabaseClient
      .from(TABLA)
      .select(`id, "COD", "ARTICULO", "Sector Proce", "Descripcion de partes", "Partes x uni", "Partes x Cja", "Uni x Cja", "N_Caja"`)
      .order("COD", { ascending: true }),
    cargarEMadre(),
    cargarSectorDesc(),
  ]);

  // Cargar Causa-Efecto aparte para aislar errores
  await cargarCausaEfecto();
  console.log("[DEBUG] causaEfectoRows:", causaEfectoRows.length, "| partesXPSRows:", partesXPSRows.length);
  if (!causaEfectoRows.length) {
    console.warn("ATENCION: Causa-Efecto vacía. La cadena no va a funcionar.");
  }

  const { data, error } = despieceRes;

  if (error) {
    console.error(error);
    setStatus("Error al cargar datos: " + error.message);
    return;
  }

  todosLosRows = data || [];
  poblarFiltroRubro();
  setStatus(`${todosLosRows.length} registros cargados`);
  aplicarFiltros();
}

/* =========================================================
   BLOQUE: FILTRO
========================================================= */
function poblarFiltroRubro() {
  const rubros = new Set();
  todosLosRows.forEach(r => {
    const rubro = getRubro(r["Sector Proce"], r["Descripcion de partes"]);
    if (rubro) rubros.add(rubro);
    if (r["N_Caja"] != null) rubros.add("Cajas");
  });
  const sorted = [...rubros].sort();
  filtroRubro.innerHTML = '<option value="">Todos los rubros</option>';
  sorted.forEach(r => {
    filtroRubro.innerHTML += `<option value="${r}">${r}</option>`;
  });
}

function aplicarFiltros() {
  let rows = todosLosRows;
  const rubroSel = filtroRubro.value;
  if (rubroSel) {
    rows = rows.filter(r => getRubro(r["Sector Proce"], r["Descripcion de partes"]) === rubroSel);
    if (rubroSel === "Cajas") {
      // Para cajas, generar filas virtuales a partir de N_Caja
      const cajasVistas = new Set();
      const filasVirtuales = [];
      todosLosRows.forEach(r => {
        const cod = normCod(r["COD"]);
        if (r["N_Caja"] != null && !cajasVistas.has(cod)) {
          cajasVistas.add(cod);
          filasVirtuales.push({
            ...r,
            "Sector Proce": "",
            "Descripcion de partes": "Caja N° " + r["N_Caja"],
            "Partes x uni": null,
            "Partes x Cja": 1,
            "_esCajaVirtual": true,
            "_cajaCod": cod,
            "_cajaNum": r["N_Caja"]
          });
        }
      });
      rows = filasVirtuales;
    }
  }
  const q = normalizeText(searchInput.value);
  if (q) {
    rows = rows.filter((r) => {
      const cod    = normalizeText(r["COD"]);
      const sector = normalizeText(r["Sector Proce"]);
      const desc   = normalizeText(r["Descripcion de partes"]);
      const rubro  = normalizeText(getRubro(r["Sector Proce"], r["Descripcion de partes"]));
      return cod.includes(q) || sector.includes(q) || desc.includes(q) || rubro.includes(q);
    });
  }
  // Ordenar por COD, luego por rubro: SP, Otros, Plásticos, Cartones, Cajas
  const ORDEN_RUBRO = { "SP": 0, "Otros": 1, "Plásticos": 2, "Cartones": 3, "Cajas": 4, "SC": 5, "Fleje": 6, "Remaches SP": 7 };
  rows.sort((a, b) => {
    const codA = normCod(a["COD"]), codB = normCod(b["COD"]);
    if (codA !== codB) return codA.localeCompare(codB);
    const ra = ORDEN_RUBRO[getRubro(a["Sector Proce"], a["Descripcion de partes"])] ?? 99;
    const rb = ORDEN_RUBRO[getRubro(b["Sector Proce"], b["Descripcion de partes"])] ?? 99;
    return ra - rb;
  });

  renderTabla(rows);
}

/* =========================================================
   BLOQUE: RENDER TABLA
========================================================= */
function renderTabla(rows) {
  if (!rows.length) {
    resultEl.innerHTML = `<div class="no-results">Sin resultados</div>`;
    return;
  }

  let tbodyHtml = "";
  const cajasInsertadas = new Set();
  // Auto-anexar fila Caja solo si:
  // - no hay busqueda de texto, o
  // - el cod actual matchea la busqueda por COD (no por descripcion de pieza de otro cod)
  const qBusqueda = normalizeText(searchInput?.value || "");
  const hayBusquedaTexto = !!qBusqueda;

  rows.forEach((r, idx) => {
    const cod    = escapeHtml(r["COD"]);
    const art    = escapeHtml(r["ARTICULO"]);
    const sector = escapeHtml(r["Sector Proce"]);
    const desc   = escapeHtml(r["Descripcion de partes"]);
    const rubro  = escapeHtml(getRubro(r["Sector Proce"], r["Descripcion de partes"]));
    const puni   = escapeHtml(formatNum(r["Partes x uni"]));
    const pcja   = escapeHtml(formatNum(r["Partes x Cja"]));
    const ucja   = escapeHtml(formatNum(r["Uni x Cja"]));
    const id     = r.id;

    const codNorm = normCod(r["COD"]);
    const enLK = lkSet.has(codNorm);
    const enCH = chSet.has(codNorm);
    let marcaHtml = "";
    if (enLK && enCH) {
      const descLK = lkDescMap.get(codNorm) || "";
      const descCH = chDescMap.get(codNorm) || "";
      if (descLK && descCH && descLK === descCH) {
        marcaHtml = `<span class="marca marca-both">LK+CH</span>`;
      } else {
        marcaHtml = `<span class="marca marca-lk">LK</span> <span class="marca marca-ch">CH</span>`;
      }
    }
    else if (enLK)    marcaHtml = `<span class="marca marca-lk">LK</span>`;
    else if (enCH)    marcaHtml = `<span class="marca marca-ch">CH</span>`;

    // Si es fila virtual de caja, renderizar como caja
    if (r._esCajaVirtual) {
      const uniCajaFmt = escapeHtml(formatNum(r["Uni x Cja"]));
      tbodyHtml += `
        <tr>
          <td class="col-marca center" data-label="Marca">${marcaHtml}</td>
          <td class="col-cod mono" data-label="Cod">${cod}</td>
          <td class="col-articulo" data-label="Artículo">${art}</td>
          <td class="col-sector" data-label="Sector"></td>
          <td class="col-rubro" data-label="Rubro">Cajas</td>
          <td class="col-desc" data-label="Descripción">${desc}</td>
          <td class="col-pxuni right" data-label="P x Uni"></td>
          <td class="col-pxcja right" data-label="P x Cja">1</td>
          <td class="col-uxcja right" data-label="U x Cja">${uniCajaFmt}</td>
          <td class="col-acciones" data-label="">
            <div class="cell-actions">
              <button type="button" class="btn-row btn-row-edit" data-caja-cod="${escapeHtml(r._cajaCod)}" data-caja-actual="${escapeHtml(r._cajaNum)}" title="Editar caja">✏️</button>
              <button type="button" class="btn-row btn-row-del" data-del-caja-cod="${escapeHtml(r._cajaCod)}" title="Eliminar caja">🗑</button>
            </div>
          </td>
        </tr>
      `;
    } else {
      const sectorRaw = (r["Sector Proce"] || "").trim();
      const btnCadena = sectorRaw
        ? `<button type="button" class="btn-row btn-row-cadena" data-sector="${escapeHtml(sectorRaw)}" title="Ver cadena">+</button>`
        : "";
      tbodyHtml += `
        <tr>
          <td class="col-marca center" data-label="Marca">${marcaHtml}</td>
          <td class="col-cod mono"    data-label="Cod">${cod}</td>
          <td class="col-articulo"    data-label="Artículo">${art}</td>
          <td class="col-sector"      data-label="Sector">${sector}</td>
          <td class="col-rubro"       data-label="Rubro">${rubro}</td>
          <td class="col-desc"        data-label="Descripción">${desc}</td>
          <td class="col-pxuni right" data-label="P x Uni">${puni}</td>
          <td class="col-pxcja right" data-label="P x Cja">${pcja}</td>
          <td class="col-uxcja right" data-label="U x Cja">${ucja}</td>
          <td class="col-acciones" data-label="">
            <div class="cell-actions">
              ${btnCadena}
              <button type="button" class="btn-row btn-row-edit" data-id="${escapeHtml(id)}" title="Editar">✏️</button>
              <button type="button" class="btn-row btn-row-del"  data-id="${escapeHtml(id)}" title="Eliminar">🗑</button>
            </div>
          </td>
        </tr>
      `;
    }

    // Insertar fila de caja como una parte más al final de cada grupo de código
    // (siempre que no haya busqueda, o que la busqueda matchee con el COD de este articulo)
    const sigCod = idx < rows.length - 1 ? normCod(rows[idx + 1]["COD"]) : null;
    const codMatcheaBusqueda = hayBusquedaTexto && normalizeText(r["COD"] || "").includes(qBusqueda);
    if ((!hayBusquedaTexto || codMatcheaBusqueda) && !r._esCajaVirtual && codNorm !== sigCod && r["N_Caja"] != null && !cajasInsertadas.has(codNorm)) {
      cajasInsertadas.add(codNorm);
      // Buscar Uni_x_Caja del artículo (cuántas unidades entran en la caja)
      const uniEnCaja = rows.find(x => normCod(x["COD"]) === codNorm && x["Uni_x_Caja"] != null);
      const uniCajaVal = uniEnCaja ? uniEnCaja["Uni_x_Caja"] : (r["Uni x Cja"] || "");
      const uniCajaFmt = escapeHtml(formatNum(uniCajaVal));
      tbodyHtml += `
        <tr>
          <td class="col-marca center">${marcaHtml}</td>
          <td class="col-cod mono">${cod}</td>
          <td class="col-articulo">${art}</td>
          <td class="col-sector"></td>
          <td class="col-rubro">Cajas</td>
          <td class="col-desc" data-label="Descripción">Caja N° ${escapeHtml(r["N_Caja"])}</td>
          <td class="col-pxuni right"></td>
          <td class="col-pxcja right">1</td>
          <td class="col-uxcja right">${uniCajaFmt}</td>
          <td class="col-acciones" data-label="">
            <div class="cell-actions">
              <button type="button" class="btn-row btn-row-edit" data-caja-cod="${escapeHtml(codNorm)}" data-caja-actual="${escapeHtml(r["N_Caja"])}" title="Editar caja">✏️</button>
              <button type="button" class="btn-row btn-row-del" data-del-caja-cod="${escapeHtml(codNorm)}" title="Eliminar caja">🗑</button>
            </div>
          </td>
        </tr>
      `;
    }
  });

  resultEl.innerHTML = `
    <div class="articulo">
      <div class="articulo-header">Despiece x Artículo</div>
      <div class="table-scroll">
        <table class="table">
          <thead>
            <tr>
              <th class="col-marca">Marca</th>
              <th class="col-cod">Cod</th>
              <th class="col-articulo">Artículo</th>
              <th class="col-sector">Sector Proce</th>
              <th class="col-rubro">Rubro</th>
              <th class="col-desc">Descripción de partes</th>
              <th class="col-pxuni">P x Uni</th>
              <th class="col-pxcja">P x Cja</th>
              <th class="col-uxcja">U x Cja</th>
              <th class="col-acciones">Acc.</th>
            </tr>
          </thead>
          <tbody>${tbodyHtml}</tbody>
        </table>
      </div>
    </div>
  `;

  resultEl.querySelectorAll(".btn-row-cadena").forEach((btn) => {
    btn.addEventListener("click", () => abrirCadena(btn.dataset.sector));
  });

  resultEl.querySelectorAll(".btn-row-edit").forEach((btn) => {
    if (btn.dataset.cajaCod) {
      btn.addEventListener("click", () => editarCaja(btn.dataset.cajaCod, btn.dataset.cajaActual));
    } else {
      btn.addEventListener("click", () => abrirEditar(btn.dataset.id));
    }
  });

  resultEl.querySelectorAll(".btn-row-del").forEach((btn) => {
    if (btn.dataset.delCajaCod) {
      btn.addEventListener("click", () => eliminarCaja(btn.dataset.delCajaCod));
    } else {
      btn.addEventListener("click", () => abrirConfirmEliminar(btn.dataset.id));
    }
  });
}

/* =========================================================
   BLOQUE: MODAL ABM - ABRIR
========================================================= */
function limpiarForm() {
  fCod.value        = "";
  fArticulo.value   = "";
  fSector.value     = "";
  fDescripcion.value = "";
  fPartesUni.value  = "";
  fPartesCja.value  = "";
  fUniCja.value     = "";
  formError.textContent = "";
  formError.classList.add("hidden");
  btnGuardar.disabled = false;
}

function buscarArticuloPorCod(cod) {
  const c = normCod(cod);
  if (!c) return "";
  // Buscar en registros existentes del despiece
  const existente = todosLosRows.find(r => normCod(r["COD"]) === c && r["ARTICULO"]);
  if (existente) return existente["ARTICULO"];
  // Buscar en E. Madre LK / CH
  if (lkDescMap.has(c)) return lkDescMap.get(c);
  if (chDescMap.has(c)) return chDescMap.get(c);
  return "";
}

function autocompletarArticulo() {
  const art = buscarArticuloPorCod(fCod.value);
  if (art) fArticulo.value = art;
}

fCod.addEventListener("blur", autocompletarArticulo);
fCod.addEventListener("input", () => {
  if (fCod.value.trim().length >= 3) autocompletarArticulo();
});

function autocompletarDescripcion() {
  const s = fSector.value.trim().toUpperCase();
  if (!s) return;
  const desc = sectorDescMap.get(s);
  if (desc) {
    fDescripcion.value = desc;
  } else {
    fDescripcion.value = "";
  }
}

fSector.addEventListener("blur", autocompletarDescripcion);
fSector.addEventListener("input", autocompletarDescripcion);

function calcularUniCja() {
  const pxu = parseFloat(fPartesUni.value);
  const pxc = parseFloat(fPartesCja.value);
  if (pxu > 0 && pxc > 0) {
    fUniCja.value = Math.floor(pxc / pxu);
  } else {
    fUniCja.value = "";
  }
}

fPartesUni.addEventListener("input", calcularUniCja);
fPartesCja.addEventListener("input", calcularUniCja);

function abrirAgregar() {
  editandoId = null;
  limpiarForm();
  modalTitle.textContent = "Agregar parte";
  modalOverlay.classList.remove("hidden");
  fCod.focus();
}

function abrirEditar(id) {
  const row = todosLosRows.find((r) => String(r.id) === String(id));
  if (!row) return;

  editandoId = id;
  limpiarForm();
  fCod.value        = row["COD"] ?? "";
  fArticulo.value   = row["ARTICULO"] ?? buscarArticuloPorCod(row["COD"]);
  fSector.value     = row["Sector Proce"] ?? "";
  fDescripcion.value = row["Descripcion de partes"] ?? "";
  fPartesUni.value  = row["Partes x uni"] ?? "";
  fPartesCja.value  = row["Partes x Cja"] ?? "";
  fUniCja.value     = row["Uni x Cja"] ?? "";

  modalTitle.textContent = "Editar parte";
  modalOverlay.classList.remove("hidden");
  fSector.focus();
}

function cerrarModal() {
  modalOverlay.classList.add("hidden");
  editandoId = null;
  editandoCajaCod = null;
  fCod.readOnly = false;
  fDescripcion.setAttribute("readonly", "");
  fDescripcion.style.background = "#f3f5f8";
  fDescripcion.style.color = "#555";
}

/* =========================================================
   BLOQUE: GUARDAR (INSERT / UPDATE)
========================================================= */
async function guardar() {
  const cod  = fCod.value.trim();
  const desc = fDescripcion.value.trim();

  if (!cod) {
    mostrarErrorForm("El campo Cod es obligatorio.");
    return;
  }
  if (!desc) {
    mostrarErrorForm("El campo Descripción de partes es obligatorio.");
    return;
  }

  btnGuardar.disabled = true;
  formError.classList.add("hidden");

  let error;

  // Guardar caja
  if (editandoCajaCod) {
    const match = desc.match(/(\d+)/);
    const nCaja = match ? parseInt(match[1]) : null;
    const uniCja = fUniCja.value !== "" ? Number(fUniCja.value) : null;

    const res = await supabaseClient.from(TABLA)
      .update({ "N_Caja": nCaja, "Uni x Cja": uniCja })
      .eq("COD", editandoCajaCod);
    error = res.error;
    editandoCajaCod = null;
  } else {
    const payload = {
      "COD":                  cod,
      "ARTICULO":             fArticulo.value.trim() || null,
      "Sector Proce":         fSector.value.trim() || null,
      "Descripcion de partes": desc,
      "Partes x uni":         fPartesUni.value !== "" ? Number(fPartesUni.value) : null,
      "Partes x Cja":         fPartesCja.value !== "" ? Number(fPartesCja.value) : null,
      "Uni x Cja":            fUniCja.value    !== "" ? Number(fUniCja.value)    : null,
    };

    if (editandoId === null) {
      const res = await supabaseClient.from(TABLA).insert([payload]);
      error = res.error;
    } else {
      const res = await supabaseClient.from(TABLA).update(payload).eq("id", editandoId);
      error = res.error;
    }
  }

  if (error) {
    console.error(error);
    mostrarErrorForm("Error al guardar: " + error.message);
    btnGuardar.disabled = false;
    return;
  }

  cerrarModal();
  await cargarTabla();
}

function mostrarErrorForm(msg) {
  formError.textContent = msg;
  formError.classList.remove("hidden");
}

/* =========================================================
   BLOQUE: EDITAR / ELIMINAR CAJA
========================================================= */
let editandoCajaCod = null;

function editarCaja(cod, cajaActual) {
  editandoCajaCod = cod;
  editandoId = null;
  limpiarForm();

  // Buscar datos del artículo
  const row = todosLosRows.find(r => normCod(r["COD"]) === cod);
  fCod.value = cod;
  fArticulo.value = row ? (row["ARTICULO"] || "") : "";
  fDescripcion.value = "Caja N° " + (cajaActual || "");
  fPartesUni.value = "";
  fPartesCja.value = 1;
  fUniCja.value = row ? (row["Uni x Cja"] || "") : "";

  fCod.readOnly = true;
  fSector.value = "";
  modalTitle.textContent = "Editar caja";
  modalOverlay.classList.remove("hidden");
  fDescripcion.removeAttribute("readonly");
  fDescripcion.style.background = "";
  fDescripcion.style.color = "";
  fDescripcion.focus();
}

async function eliminarCaja(cod) {
  if (!confirm(`¿Eliminar la caja del artículo ${cod}? Se quita el N° de caja de todas sus partes.`)) return;

  const { error } = await supabaseClient
    .from(TABLA)
    .update({ "N_Caja": null })
    .eq("COD", cod);

  if (error) { alert("Error: " + error.message); return; }
  await cargarTabla();
}

/* =========================================================
   BLOQUE: ELIMINAR
========================================================= */
let eliminandoId = null;

function abrirConfirmEliminar(id) {
  const row = todosLosRows.find((r) => String(r.id) === String(id));
  if (!row) return;

  eliminandoId = id;
  const desc = row["Descripcion de partes"] || row["COD"] || String(id);
  confirmMsg.textContent = `¿Eliminar "${desc}"? Esta acción no se puede deshacer.`;
  btnConfirmEliminar.disabled = false;
  confirmOverlay.classList.remove("hidden");
}

function cerrarConfirm() {
  confirmOverlay.classList.add("hidden");
  eliminandoId = null;
}

async function eliminar() {
  if (eliminandoId === null) return;
  btnConfirmEliminar.disabled = true;

  const { error } = await supabaseClient
    .from(TABLA)
    .delete()
    .eq("id", eliminandoId);

  if (error) {
    console.error(error);
    confirmMsg.textContent = "Error al eliminar: " + error.message;
    btnConfirmEliminar.disabled = false;
    return;
  }

  cerrarConfirm();
  await cargarTabla();
}

/* =========================================================
   BLOQUE: EVENTOS
========================================================= */
searchInput.addEventListener("input", aplicarFiltros);
filtroRubro.addEventListener("change", aplicarFiltros);

btnAgregar.addEventListener("click", abrirAgregar);

modalClose.addEventListener("click", cerrarModal);
btnCancelarForm.addEventListener("click", cerrarModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) cerrarModal();
});

btnGuardar.addEventListener("click", guardar);

confirmClose.addEventListener("click", cerrarConfirm);
btnConfirmCancelar.addEventListener("click", cerrarConfirm);
btnConfirmEliminar.addEventListener("click", eliminar);
confirmOverlay.addEventListener("click", (e) => {
  if (e.target === confirmOverlay) cerrarConfirm();
});

/* =========================================================
   BLOQUE: EXPORTAR DATOS
========================================================= */
function getRowsParaExportar() {
  // Replica la logica de aplicarFiltros (rubro + busqueda) sobre todosLosRows.
  let rows = todosLosRows;
  const rubroSel = filtroRubro.value;
  if (rubroSel) {
    rows = rows.filter(r => getRubro(r["Sector Proce"], r["Descripcion de partes"]) === rubroSel);
  }
  const q = normalizeText(searchInput.value);
  if (q) {
    rows = rows.filter((r) => {
      const cod    = normalizeText(r["COD"]);
      const sector = normalizeText(r["Sector Proce"]);
      const desc   = normalizeText(r["Descripcion de partes"]);
      const rubro  = normalizeText(getRubro(r["Sector Proce"], r["Descripcion de partes"]));
      return cod.includes(q) || sector.includes(q) || desc.includes(q) || rubro.includes(q);
    });
  }
  return rows.map(r => ({
    "Marca": (() => {
      const c = normCod(r["COD"]);
      const lk = lkSet.has(c), ch = chSet.has(c);
      if (lk && ch) return "LK+CH";
      if (lk) return "LK";
      if (ch) return "CH";
      return "";
    })(),
    "Cod": r["COD"] || "",
    "Articulo": r["ARTICULO"] || "",
    "Sector Proce": r["Sector Proce"] || "",
    "Rubro": getRubro(r["Sector Proce"], r["Descripcion de partes"]),
    "Descripcion de partes": r["Descripcion de partes"] || "",
    "Partes x Uni": r["Partes x uni"] ?? "",
    "Partes x Cja": r["Partes x Cja"] ?? "",
    "Uni x Cja": r["Uni x Cja"] ?? "",
    "Caja": r["N_Caja"] ?? ""
  }));
}

function getFiltroTexto() {
  const q = searchInput.value.trim();
  return q ? " (filtro: " + q + ")" : "";
}

document.getElementById("btnExcel").addEventListener("click", () => {
  const rows = getRowsParaExportar();
  if (!rows.length) return;
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Despiece");
  XLSX.writeFile(wb, "Despiece" + getFiltroTexto() + ".xlsx");
});

document.getElementById("btnPDF").addEventListener("click", () => {
  try {
    const rows = getRowsParaExportar();
    if (!rows.length) return;

    const jsPDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPDFClass) { alert("Error: libreria jsPDF no cargada. Recarga la pagina."); return; }
    const doc = new jsPDFClass({ orientation: "landscape", unit: "mm", format: "a4" });

    doc.setFontSize(14);
    doc.text("Despiece x Articulo" + getFiltroTexto(), 14, 15);
    doc.setFontSize(9);
    doc.text("Generado: " + new Date().toLocaleString("es-AR"), 14, 21);

    const cols = ["Marca", "Cod", "Articulo", "Sector Proce", "Rubro", "Descripcion de partes", "Partes x Uni", "Partes x Cja", "Uni x Cja", "Caja"];
    const body = rows.map(r => cols.map(c => String(r[c] ?? "")));

    doc.autoTable({
      head: [cols],
      body: body,
      startY: 25,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [17, 17, 17], fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 16 },
        1: { cellWidth: 18 },
        6: { halign: "right", cellWidth: 18 },
        7: { halign: "right", cellWidth: 18 },
        8: { halign: "right", cellWidth: 16 }
      }
    });

    doc.save("Despiece" + getFiltroTexto() + ".pdf");
  } catch (err) {
    console.error("Error PDF:", err);
    alert("Error al generar PDF: " + err.message);
  }
});

/* =========================================================
   BLOQUE: DUPLICAR DESPIECE
========================================================= */
const dupOverlay     = document.getElementById("dupOverlay");
const dupClose       = document.getElementById("dupClose");
const dupStep1       = document.getElementById("dupStep1");
const dupStep2       = document.getElementById("dupStep2");
const dupStep3       = document.getElementById("dupStep3");
const dupCodOrigen   = document.getElementById("dupCodOrigen");
const dupCodDestino  = document.getElementById("dupCodDestino");
const dupArtDestino  = document.getElementById("dupArtDestino");
const dupInfo        = document.getElementById("dupInfo");
const dupPreviewTable = document.getElementById("dupPreviewTable");
const dupError       = document.getElementById("dupError");
const dupResultado   = document.getElementById("dupResultado");

let dupRowsOrigen = [];

function abrirDuplicar() {
  dupCodOrigen.value  = "";
  dupCodDestino.value = "";
  dupArtDestino.value = "";
  dupRowsOrigen = [];
  dupError.classList.add("hidden");
  dupStep1.classList.remove("hidden");
  dupStep2.classList.add("hidden");
  dupStep3.classList.add("hidden");
  dupOverlay.classList.remove("hidden");
  dupCodOrigen.focus();
}

function cerrarDuplicar() {
  dupOverlay.classList.add("hidden");
}

async function buscarOrigen() {
  const cod = dupCodOrigen.value.trim().toUpperCase();
  if (!cod) return;

  dupRowsOrigen = todosLosRows.filter(r => normCod(r["COD"]) === cod);

  if (!dupRowsOrigen.length) {
    alert("No se encontraron partes para el código: " + cod);
    return;
  }

  // Mostrar preview
  const artNombre = dupRowsOrigen[0]["ARTICULO"] || "";
  dupInfo.textContent = `Artículo ${cod} — ${artNombre} (${dupRowsOrigen.length} partes)`;

  let html = `<thead><tr>
    <th>Sector</th><th>Descripción</th><th>P x Uni</th><th>P x Cja</th><th>U x Cja</th>
  </tr></thead><tbody>`;

  dupRowsOrigen.forEach(r => {
    html += `<tr>
      <td>${escapeHtml(r["Sector Proce"])}</td>
      <td>${escapeHtml(r["Descripcion de partes"])}</td>
      <td style="text-align:right">${escapeHtml(formatNum(r["Partes x uni"]))}</td>
      <td style="text-align:right">${escapeHtml(formatNum(r["Partes x Cja"]))}</td>
      <td style="text-align:right">${escapeHtml(formatNum(r["Uni x Cja"]))}</td>
    </tr>`;
  });

  html += "</tbody>";
  dupPreviewTable.innerHTML = html;

  dupStep1.classList.add("hidden");
  dupStep2.classList.remove("hidden");
  dupCodDestino.focus();
}

async function ejecutarDuplicado() {
  const nuevoCod = dupCodDestino.value.trim().toUpperCase();
  const nuevoArt = dupArtDestino.value.trim();

  if (!nuevoCod) {
    dupError.textContent = "Ingresá el nuevo código.";
    dupError.classList.remove("hidden");
    return;
  }

  // Verificar que no exista ya
  const existe = todosLosRows.some(r => normCod(r["COD"]) === nuevoCod);
  if (existe) {
    dupError.textContent = `Ya existe el código ${nuevoCod} en el despiece. Elegí otro.`;
    dupError.classList.remove("hidden");
    return;
  }

  dupError.classList.add("hidden");
  document.getElementById("btnDupEjecutar").disabled = true;

  const payloads = dupRowsOrigen.map(r => ({
    "COD":                   nuevoCod,
    "ARTICULO":              nuevoArt || r["ARTICULO"] || null,
    "Sector Proce":          r["Sector Proce"] || null,
    "Descripcion de partes": r["Descripcion de partes"] || null,
    "Partes x uni":          r["Partes x uni"] ?? null,
    "Partes x Cja":          r["Partes x Cja"] ?? null,
    "Uni x Cja":             r["Uni x Cja"] ?? null,
    "N_Caja":                r["N_Caja"] ?? null,
  }));

  const { error } = await supabaseClient.from(TABLA).insert(payloads);

  document.getElementById("btnDupEjecutar").disabled = false;

  if (error) {
    dupError.textContent = "Error al duplicar: " + error.message;
    dupError.classList.remove("hidden");
    return;
  }

  dupStep2.classList.add("hidden");
  dupResultado.textContent =
    `Se duplicaron ${payloads.length} partes del artículo ${normCod(dupRowsOrigen[0]["COD"])} al nuevo código ${nuevoCod}.`;
  dupStep3.classList.remove("hidden");

  await cargarTabla();
}

// Eventos duplicar
document.getElementById("btnDuplicar").addEventListener("click", abrirDuplicar);
dupClose.addEventListener("click", cerrarDuplicar);
document.getElementById("btnDupCancelar1").addEventListener("click", cerrarDuplicar);
document.getElementById("btnDupBuscar").addEventListener("click", buscarOrigen);
document.getElementById("btnDupVolver").addEventListener("click", () => {
  dupStep2.classList.add("hidden");
  dupStep1.classList.remove("hidden");
  dupCodOrigen.focus();
});
document.getElementById("btnDupEjecutar").addEventListener("click", ejecutarDuplicado);
document.getElementById("btnDupCerrar").addEventListener("click", () => {
  cerrarDuplicar();
});
dupOverlay.addEventListener("click", (e) => {
  if (e.target === dupOverlay) cerrarDuplicar();
});

// Enter para buscar en paso 1
dupCodOrigen.addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarOrigen();
});

/* =========================================================
   BLOQUE: INICIO
========================================================= */
document.addEventListener("DOMContentLoaded", cargarTabla);
