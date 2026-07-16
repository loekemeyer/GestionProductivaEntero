"use strict";
const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/*************************************************
 * TABLAS
 *************************************************/
const TABLA_SC_KG = "SC Kg";
const TABLA_SP_KG = "SP Kg";
const TABLA_REMACHES_SC = "Remaches SC";
const TABLA_REMACHES_SP = "Remaches SP";
const TABLA_PARTES_PS = "Partes x PS";
const TABLA_PARTES_TALL = "Partes x Tallerista";
const TABLA_ENTREGA_PS = "Entregas PS";
const TABLA_ENVIOS_TALL = "Envios a Talleristas";
const TABLA_PIEZA_MADRE = "Pieza Madre";
const TABLA_ENVIOS_PS = "Envios a PS";
const TABLA_CAUSA_EFECTO = "Causa-Efecto";
const TABLA_DB_ESPEJO = "db_n8n_espejo";
/*************************************************
 * DOM
 *************************************************/
const tbodyStocksGeneral = document.getElementById("tbodyStocksGeneral");
const txtBuscar = document.getElementById("txtBuscar");
const selSoloConStock = document.getElementById("selSoloConStock");
const selFormatoStock = document.getElementById("selFormatoStock");
const lblEstado = document.getElementById("lblEstado");
const btnInicio = document.getElementById("btnInicio");

/*************************************************
 * STATE
 *************************************************/
let rowsOriginal = [];
let rowsFiltradas = [];

/*************************************************
 * HELPERS
 *************************************************/
function num(n) {
  if (n === null || n === undefined || n === "") return 0;
  if (typeof n === "number") return Number.isFinite(n) ? n : 0;

  let s = String(n).trim();
  if (!s) return 0;

  s = s.replace(/[^\d,.-]/g, "");

  if (s.includes(",") && !s.includes(".")) {
    s = s.replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }

  const v = Number(s);
  return Number.isFinite(v) ? v : 0;
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
}

function formatKg(n) {
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function formatCaj(n) {
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      return obj[key];
    }
  }
  return "";
}

function getFormatoActual() {
  return selFormatoStock?.value || "kg";
}

function formatValorSegunFormato(valor, formato) {
  if (formato === "uni") return formatNumber(valor);
  if (formato === "caj") return formatCaj(valor);
  return formatKg(valor);
}

function convertirKgAFormato(kg, kgUni, kgCaj, formato) {
  const vKg = num(kg);
  const vKgUni = num(kgUni);
  const vKgCaj = num(kgCaj);

  if (formato === "uni") return vKgUni > 0 ? vKg / vKgUni : 0;
  if (formato === "caj") return vKgCaj > 0 ? vKg / vKgCaj : 0;
  return vKg;
}

function addToMap(map, key, value) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + num(value));
}

async function fetchTabla(nombre, columns = "*") {
  const all = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from(nombre)
      .select(columns)
      .range(from, from + PAGE - 1);

    if (error) {
      console.error(`Error en tabla ${nombre}:`, error);
      throw new Error(`${nombre}: ${error.message || "error sin detalle"}`);
    }
    if (!data || !data.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

let indicesPiezaMadreCache = null;

function formatPopupKg(n) {
  return Number(n || 0).toLocaleString("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1
  });
}

async function cargarIndicesPiezaMadre() {
  if (indicesPiezaMadreCache) return indicesPiezaMadreCache;

  const [piezaMadreRows, spRows, scRows] = await Promise.all([
    fetchTabla(TABLA_PIEZA_MADRE, 'id,"Pieza Madre"'),
    fetchTabla(TABLA_SP_KG, "*"),
    fetchTabla(TABLA_SC_KG, "*")
  ]);

  const spPorParte = new Map();
  const spPorSector = new Map();
  const scPorDescripcion = new Map();
  const scPorSector = new Map();
  const sectorPorPieza = new Map();

  function ensureSector(piezaMadre) {
    const key = normalizeText(piezaMadre);
    if (!sectorPorPieza.has(key)) {
      sectorPorPieza.set(key, {
        spSet: new Set(),
        scSet: new Set(),
        kgUni: 0,
        kgCaj: 0
      });
    }
    return sectorPorPieza.get(key);
  }

  (spRows || []).forEach(r => {
    const piezaMadre = String(pick(r, ["Pieza Madre", "pieza madre"])).trim();
    const parte = String(pick(r, ["Parte", "PARTE", "parte"])).trim();
    const sp = String(pick(r, ["Sp", "SP", "sp"])).trim();
    const kgUni = num(pick(r, ["Kg X Uni", "Kg x UNI", "Kg x Uni", "kg x uni", "Kg x UN", "Kg Uni"]));
    const kgCaj = num(pick(r, ["Kg Cajon", "Kg x Cajon", "kg cajon", "kg x cajon"]));

    if (!piezaMadre) return;

    const ref = { piezaMadre, sp, kgUni, kgCaj };

    if (parte) spPorParte.set(normalizeText(parte), ref);
    if (sp) spPorSector.set(normalizeText(sp), ref);

    const sec = ensureSector(piezaMadre);
    if (sp) sec.spSet.add(sp);
    if (!sec.kgUni && kgUni) sec.kgUni = kgUni;
    if (!sec.kgCaj && kgCaj) sec.kgCaj = kgCaj;
  });

  (scRows || []).forEach(r => {
    const piezaMadre = String(pick(r, ["Pieza Madre", "pieza madre"])).trim();
    const descripcion = String(pick(r, ["Descripcion", "Descripción", "descripcion"])).trim();
    const sc = String(pick(r, ["SC", "Sc", "sc"])).trim();
    const kgUni = num(pick(r, ["Kg X Uni", "Kg x Uni", "Kg X uni", "kg x uni"]));
    const kgCaj = num(pick(r, ["Max Caj Cerv", "Max Cajon Cerv", "max caj cerv"]));

    if (!piezaMadre) return;

    const ref = { piezaMadre, sc, kgUni, kgCaj };

    if (descripcion) scPorDescripcion.set(normalizeText(descripcion), ref);
    if (sc) scPorSector.set(normalizeText(sc), ref);

    const sec = ensureSector(piezaMadre);
    if (sc) sec.scSet.add(sc);
    if (!sec.kgUni && kgUni) sec.kgUni = kgUni;
    if (!sec.kgCaj && kgCaj) sec.kgCaj = kgCaj;
  });

  indicesPiezaMadreCache = {
    piezaMadreRows: piezaMadreRows || [],
    spPorParte,
    spPorSector,
    scPorDescripcion,
    scPorSector,
    sectorPorPieza
  };

  return indicesPiezaMadreCache;
}

function resolverRefSP(r, idx) {
  const sp = normalizeText(pick(r, ["Sector SP", "Sector_SP", "sector sp", "sector_sp", "SP", "Sp", "sp"]));
  const parte = normalizeText(pick(r, ["Parte", "PARTE", "parte"]));
  return idx.spPorSector.get(sp) || idx.spPorParte.get(parte) || null;
}

function resolverRefSC(r, idx) {
  const sc = normalizeText(pick(r, ["SC", "Sc", "sc"]));
  const descripcion = normalizeText(
    pick(r, ["Descripcion", "Descripción", "descripcion", "descripcion_parte", "Descripcion_parte", "Descripción_parte", "pieza", "Pieza"])
  );
  return idx.scPorSector.get(sc) || idx.scPorDescripcion.get(descripcion) || null;
}

// Busca en SC y SP (para tablas como Envios a Talleristas que usan "Sector" genérico)
function resolverRefGenerico(r, idx) {
  const sector = normalizeText(pick(r, ["Sector", "sector", "SECTOR", "SC", "Sc", "sc"]));
  const descripcion = normalizeText(
    pick(r, ["Descripcion", "Descripción", "descripcion", "pieza", "Pieza"])
  );
  return idx.scPorSector.get(sector) || idx.spPorSector.get(sector) || idx.scPorDescripcion.get(descripcion) || idx.spPorParte.get(descripcion) || null;
}

function ensurePopupStocks() {
  if (document.getElementById("stocksPopupOverlay")) return;

  const div = document.createElement("div");
  div.innerHTML = `
    <div id="stocksPopupOverlay" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.28);z-index:9999;align-items:center;justify-content:center;padding:16px;">
      <div style="width:min(520px,100%);max-height:80vh;overflow:auto;background:#fff;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.18);">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #e5e7eb;">
          <div id="stocksPopupTitle" style="font-weight:700;font-size:18px;"></div>
          <button id="stocksPopupClose" type="button" style="border:0;background:#fff;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div id="stocksPopupBody" style="padding:8px 0;"></div>
      </div>
    </div>
  `;
  document.body.appendChild(div.firstElementChild);

  const overlay = document.getElementById("stocksPopupOverlay");
  const close = document.getElementById("stocksPopupClose");

  close.addEventListener("click", () => {
    overlay.style.display = "none";
  });

  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.style.display = "none";
  });
}

function abrirPopupStocks(titulo, detalle, kgUni, kgCaj, tipo) {
  ensurePopupStocks();

  const overlay = document.getElementById("stocksPopupOverlay");
  const title = document.getElementById("stocksPopupTitle");
  const body = document.getElementById("stocksPopupBody");

  title.textContent = titulo || "Desglose";

  let items = Array.isArray(detalle) ? [...detalle] : [];

  if (tipo === "ps") {
    items.sort((a, b) => String(a.sector || "").localeCompare(String(b.sector || ""), "es"));
  }

  if (!items.length) {
    body.innerHTML = `<div style="padding:14px 16px;">Sin sectores asignados.</div>`;
    overlay.style.display = "flex";
    return;
  }

  // Preparar filas
  const filas = items.map(item => {
    const itemKgUni = num(item.kgUni || kgUni);
    const itemKgCaj = num(item.kgCaj || kgCaj);
    const kg = num(item.kg);
    const caj = item.cajones !== undefined && item.cajones !== null
      ? num(item.cajones)
      : (itemKgCaj > 0 ? kg / itemKgCaj : 0);
    const uni = itemKgUni > 0 ? Math.floor(kg / itemKgUni) : 0;

    let label;
    if (tipo === "ps") {
      label = [item.sector, item.provServ].filter(Boolean).join(" - ");
    } else {
      label = item.label || item.fecha || "";
    }
    return { label, kg, caj, uni };
  });

  function renderPopupTable(rows, showAll) {
    const visible = showAll ? rows : rows.slice(0, 5);
    const hay_mas = !showAll && rows.length > 5;

    return `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f5f5f5;position:sticky;top:0;">
            <th style="text-align:left;padding:8px 12px;font-weight:700;border-bottom:2px solid #ddd;">Sector</th>
            <th style="text-align:right;padding:8px 8px;font-weight:700;border-bottom:2px solid #ddd;">Kg</th>
            <th style="text-align:right;padding:8px 8px;font-weight:700;border-bottom:2px solid #ddd;">Caj</th>
            <th style="text-align:right;padding:8px 12px;font-weight:700;border-bottom:2px solid #ddd;">Uni</th>
          </tr>
        </thead>
        <tbody>
          ${visible.map(r => `
            <tr>
              <td style="padding:6px 12px;border-top:1px solid #eee;">${escapeHtml(r.label)}</td>
              <td style="text-align:right;padding:6px 8px;border-top:1px solid #eee;">${escapeHtml(formatPopupKg(r.kg))}</td>
              <td style="text-align:right;padding:6px 8px;border-top:1px solid #eee;">${escapeHtml(formatCaj(r.caj))}</td>
              <td style="text-align:right;padding:6px 12px;border-top:1px solid #eee;">${escapeHtml(formatNumber(r.uni))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${hay_mas ? `<div style="text-align:center;padding:8px;">
        <button id="stocksPopupVerMas" type="button" style="border:1px solid #ccc;background:#fff;padding:6px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;">Ver todo (${rows.length})</button>
      </div>` : ""}
    `;
  }

  body.style.maxHeight = "60vh";
  body.style.overflow = "auto";
  body.innerHTML = renderPopupTable(filas, false);

  const btnMas = document.getElementById("stocksPopupVerMas");
  if (btnMas) {
    btnMas.addEventListener("click", () => {
      body.innerHTML = renderPopupTable(filas, true);
    });
  }

  overlay.style.display = "flex";
}

function buildMovimientoCell(valorKg, detalle, rowIndex, tipo, kgUni, kgCaj, formato, filaIndicador) {
  let valorMostrado;

  if (Array.isArray(detalle) && detalle.length) {
    if (tipo === "ps") {
      valorMostrado = detalle.reduce((acc, item) => {
        return acc + convertirKgAFormato(
          item.kg,
          item.kgUni || kgUni,
          item.kgCaj || kgCaj,
          formato
        );
      }, 0);
    } else if (tipo === "sp" && formato === "caj") {
      valorMostrado = detalle.reduce((acc, item) => {
        if (item.cajones !== undefined && item.cajones !== null) {
          return acc + num(item.cajones);
        }
        return acc + convertirKgAFormato(item.kg, kgUni, kgCaj, formato);
      }, 0);
    } else {
      valorMostrado = detalle.reduce((acc, item) => {
        return acc + convertirKgAFormato(item.kg, kgUni, kgCaj, formato);
      }, 0);
    }
  } else {
    valorMostrado = convertirKgAFormato(valorKg, kgUni, kgCaj, formato);
  }

  const total = formatValorSegunFormato(valorMostrado, formato);
  const indicador = filaIndicador || (valorMostrado > 0 ? "+" : "-");

  return `
    <div style="display:inline-flex;align-items:center;gap:8px;justify-content:flex-end;">
      <span>${escapeHtml(total)}</span>
      <button
        type="button"
        class="mini-popup-btn-stock"
        data-row-index="${rowIndex}"
        data-tipo="${tipo}"
        style="width:22px;height:22px;border:1px solid #bfc5cc;border-radius:999px;background:#fff;cursor:pointer;font-weight:700;line-height:1;"
      >${indicador}</button>
    </div>
  `;
}

/*************************************************
 * BASE DESDE SC Kg + Pieza Madre
 * Descripción = Pieza Madre
 * Ubicación = SC
 *************************************************/
async function getBaseSP() {
  const [piezaMadreRows, scRows, spRows, remachesScRows, remachesSpRows] = await Promise.all([
    fetchTabla(TABLA_PIEZA_MADRE, 'id,"Pieza Madre"'),
    fetchTabla(TABLA_SC_KG, "*"),
    fetchTabla(TABLA_SP_KG, "*"),
    fetchTabla(TABLA_REMACHES_SC, "*"),
    fetchTabla(TABLA_REMACHES_SP, "*")
  ]);

  console.log("DEBUG getBaseSP:", {
    piezaMadreCount: piezaMadreRows?.length,
    scRowsCount: scRows?.length,
    spRowsCount: spRows?.length,
    remachesScCount: remachesScRows?.length,
    remachesSpCount: remachesSpRows?.length,
    scRowsSample: scRows?.[0]
  });

  const sectoresPorPieza = new Map();

  // Crear un mapa de búsqueda normalizada para Pieza Madre
  const piezaMadreMap = new Map();
  (piezaMadreRows || []).forEach(pm => {
    const pmText = String(pm["Pieza Madre"] || "").trim();
    if (pmText) {
      piezaMadreMap.set(normalizeText(pmText), pmText);
    }
  });

  function ensureItem(piezaMadre) {
    const key = normalizeText(piezaMadre);
    if (!sectoresPorPieza.has(key)) {
      sectoresPorPieza.set(key, {
        piezaMadreReal: piezaMadreMap.get(key) || piezaMadre,
        scSet: new Set(),
        spSet: new Set(),
        kgUni: 0,
        kgCaj: 0
      });
    }
    return sectoresPorPieza.get(key);
  }

  (scRows || []).forEach(r => {
    const piezaMadreRaw = String(pick(r, ["Pieza Madre", "pieza madre", "Pieza madre"])).trim();
    const sc = String(pick(r, ["SC", "Sc", "sc"])).trim();
    const kgUni = num(pick(r, ["Kg x Uni", "Kg X Uni", "kg x uni"]));
    const kgCaj = num(pick(r, ["Max Caj Cerv", "Max Cajon Cerv", "max caj cerv"]));

    if (!piezaMadreRaw) return;

    // Split por coma para múltiples Pieza Madre
    const piezasMadre = piezaMadreRaw.split(',').map(p => p.trim()).filter(Boolean);

    piezasMadre.forEach(piezaMadre => {
      // Buscar la Pieza Madre correcta en piezaMadreMap por búsqueda flexible
      const normKey = normalizeText(piezaMadre);
      const piezaMadreCorrecta = piezaMadreMap.get(normKey) || piezaMadre;

      const item = ensureItem(piezaMadreCorrecta);

      if (sc) item.scSet.add(sc);
      if (!item.kgUni && kgUni) item.kgUni = kgUni;
      if (!item.kgCaj && kgCaj) item.kgCaj = kgCaj;
    });
  });

  (spRows || []).forEach(r => {
    const piezaMadreRaw = String(pick(r, ["Pieza Madre"])).trim();
    const sp = String(pick(r, ["Sp", "SP", "sp"])).trim();
    const kgUni = num(pick(r, ["Kg X Uni", "Kg x UNI", "Kg x Uni", "kg x uni", "Kg x UN", "Kg Uni"]));
    const kgCaj = num(pick(r, ["Kg Cajon", "Kg x Cajon", "kg cajon", "kg x cajon"]));

    if (!piezaMadreRaw) return;

    // Split por coma para múltiples Pieza Madre
    const piezasMadre = piezaMadreRaw.split(',').map(p => p.trim()).filter(Boolean);

    piezasMadre.forEach(piezaMadre => {
      const item = ensureItem(piezaMadre);

      if (sp) item.spSet.add(sp);
      if (!item.kgUni && kgUni) item.kgUni = kgUni;
      if (!item.kgCaj && kgCaj) item.kgCaj = kgCaj;
    });
  });

  (remachesScRows || []).forEach(r => {
    const piezaMadreRaw = String(pick(r, ["Pieza Madre"])).trim();
    const sc = String(pick(r, ["SC", "Sc", "sc"])).trim();
    const kgUni = num(pick(r, ["Kg x Uni", "Kg X Uni", "kg x uni"]));

    if (!piezaMadreRaw || piezaMadreRaw === "NULL") return;

    // Split por coma para múltiples Pieza Madre
    const piezasMadre = piezaMadreRaw.split(',').map(p => p.trim()).filter(Boolean);

    piezasMadre.forEach(piezaMadre => {
      const item = ensureItem(piezaMadre);

      if (sc) item.scSet.add(sc);
      if (!item.kgUni && kgUni) item.kgUni = kgUni;
    });
  });

  (remachesSpRows || []).forEach(r => {
    const piezaMadreRaw = String(pick(r, ["Pieza Madre"])).trim();
    const sp = String(pick(r, ["SP", "Sp", "sp"])).trim();
    const kgUni = num(pick(r, ["Kg x Uni", "Kg X Uni", "kg x uni"]));

    if (!piezaMadreRaw || piezaMadreRaw === "NULL") return;

    // Split por coma para múltiples Pieza Madre
    const piezasMadre = piezaMadreRaw.split(',').map(p => p.trim()).filter(Boolean);

    piezasMadre.forEach(piezaMadre => {
      const item = ensureItem(piezaMadre);

      if (sp) item.spSet.add(sp);
      if (!item.kgUni && kgUni) item.kgUni = kgUni;
    });
  });

  // Construir mapa de SC y SP por Pieza Madre (búsqueda directa sin normalización)
  const scPorPM = new Map();
  const spPorPM = new Map();

  (scRows || []).forEach(r => {
    const pmRaw = String(pick(r, ["Pieza Madre", "pieza madre", "Pieza madre"])).trim();
    const sc = String(pick(r, ["SC", "Sc", "sc"])).trim();
    if (pmRaw && sc) {
      // Split por coma para soportar múltiples Pieza Madre
      const piezasMadre = pmRaw.split(',').map(p => p.trim()).filter(Boolean);
      piezasMadre.forEach(pm => {
        if (!scPorPM.has(pm)) scPorPM.set(pm, []);
        scPorPM.get(pm).push(sc);
      });
    }
  });

  (remachesScRows || []).forEach(r => {
    const pmRaw = String(pick(r, ["Pieza Madre"])).trim();
    const sc = String(pick(r, ["SC", "Sc", "sc"])).trim();
    if (pmRaw && sc && pmRaw !== "NULL") {
      const piezasMadre = pmRaw.split(',').map(p => p.trim()).filter(Boolean);
      piezasMadre.forEach(pm => {
        if (!scPorPM.has(pm)) scPorPM.set(pm, []);
        scPorPM.get(pm).push(sc);
      });
    }
  });

  (spRows || []).forEach(r => {
    const pmRaw = String(pick(r, ["Pieza Madre", "pieza madre", "Pieza madre"])).trim();
    const sp = String(pick(r, ["Sp", "SP", "sp"])).trim();
    if (pmRaw && sp) {
      const piezasMadre = pmRaw.split(',').map(p => p.trim()).filter(Boolean);
      piezasMadre.forEach(pm => {
        if (!spPorPM.has(pm)) spPorPM.set(pm, []);
        spPorPM.get(pm).push(sp);
      });
    }
  });

  (remachesSpRows || []).forEach(r => {
    const pmRaw = String(pick(r, ["Pieza Madre"])).trim();
    const sp = String(pick(r, ["SP", "Sp", "sp"])).trim();
    if (pmRaw && sp && pmRaw !== "NULL") {
      const piezasMadre = pmRaw.split(',').map(p => p.trim()).filter(Boolean);
      piezasMadre.forEach(pm => {
        if (!spPorPM.has(pm)) spPorPM.set(pm, []);
        spPorPM.get(pm).push(sp);
      });
    }
  });

  return (piezaMadreRows || []).map(r => {
    const descripcion = String(r["Pieza Madre"] || "").trim();

    // Buscar SC y SP directamente por descripción exacta
    const scs = scPorPM.get(descripcion) || [];
    const sps = spPorPM.get(descripcion) || [];

    const scUniq = [...new Set(scs)];
    const spUniq = [...new Set(sps)];

    // Buscar también en info (para valores de kgUni/kgCaj)
    const info = sectoresPorPieza.get(normalizeText(descripcion));

    return {
      key: normalizeText(descripcion),
      scList: scUniq,
      spList: spUniq,
      descripcion,
      kgUni: num(info?.kgUni),
      kgCaj: num(info?.kgCaj)
    };
  }).filter(r => r.key && r.descripcion);
}
async function getSCMap() {
  const [idx, scRows, enviosPSRows, causaRows, dbRows] = await Promise.all([
    cargarIndicesPiezaMadre(),
    fetchTabla(TABLA_SC_KG, "*"),
    fetchTabla(TABLA_ENVIOS_PS, "*"),
    fetchTabla(TABLA_CAUSA_EFECTO),
    fetchTabla(TABLA_DB_ESPEJO)
  ]);

  // Sumar KG enviados a PS por sector SC
  const enviosKgPorSector = new Map();
  (enviosPSRows || []).forEach(r => {
    const sector = normalizeText(String(pick(r, ["Sector SC", "sector sc", "sector_sc"]) || ""));
    const kg = num(pick(r, ["KG", "Kg", "kg"]));
    if (!sector || !kg) return;
    enviosKgPorSector.set(sector, (enviosKgPorSector.get(sector) || 0) + kg);
  });

  // Fabricación: qué matrices aumentan cada sector SC (no intermedias)
  function esUbicSM(v) { return /^mat(riz)?\s*\d+/i.test(String(v || "").trim()); }

  const aumentaPorMatriz = new Map(); // matriz → sector SC (solo destinos finales, no Mat/Matriz)
  (causaRows || []).forEach(r => {
    const mat = String(r["Matriz"] ?? "").trim();
    const aumenta = String(r["Aumenta"] ?? "").trim();
    if (!mat || !aumenta || esUbicSM(aumenta)) return;
    // aumenta es un sector SC directo
    if (!aumentaPorMatriz.has(mat)) aumentaPorMatriz.set(mat, []);
    aumentaPorMatriz.get(mat).push(aumenta.toUpperCase());
  });

  // Sumar unidades fabricadas por sector SC
  const fabUniPorSector = new Map();
  (dbRows || []).filter(r => String(r.Legajo || "").trim() !== "1").forEach(r => {
    const mat = String(r["Matriz"] ?? "").trim();
    const uni = num(r["Uni"]);
    if (!mat || !uni) return;
    const sectores = aumentaPorMatriz.get(mat) || [];
    sectores.forEach(sc => {
      const k = normalizeText(sc);
      fabUniPorSector.set(k, (fabUniPorSector.get(k) || 0) + uni);
    });
  });

  const detalleMap = new Map();

  (scRows || []).forEach(r => {
    const ref = resolverRefSC(r, idx);
    const key = normalizeText(ref?.piezaMadre || "");

    const sc = String(pick(r, ["SC", "Sc", "sc"])).trim() || "SC";
    const stockInicial = num(pick(r, ["Stock Inicial", "stock inicial", "Stock_Inicial"]));
    const kgXUni = num(pick(r, ["Kg X Uni", "Kg x Uni", "kg x uni"]));

    const enviosKg = enviosKgPorSector.get(normalizeText(sc)) || 0;
    const fabUni = fabUniPorSector.get(normalizeText(sc)) || 0;
    const fabKg = fabUni * kgXUni;
    const stockInicialKg = stockInicial * kgXUni;
    const onlineKg = stockInicialKg + fabKg - enviosKg;
    const onlineUni = kgXUni > 0 ? Math.round(onlineKg / kgXUni) : 0;

    if (!key) return;

    if (!detalleMap.has(key)) detalleMap.set(key, []);
    detalleMap.get(key).push({
      label: sc,
      kg: onlineKg
    });
  });

  const result = new Map();

  detalleMap.forEach((detalle, piezaKey) => {
    const totalKg = detalle.reduce((acc, x) => acc + num(x.kg), 0);
    result.set(piezaKey, { totalKg, detalle });
  });

  return result;
}
/*************************************************
 * SP = 0 + Entregas PS - Envios Tall
 *************************************************/
async function getSPMap() {
  const [idx, entregaPSRows, enviosTallRows] = await Promise.all([
    cargarIndicesPiezaMadre(),
    fetchTabla(TABLA_ENTREGA_PS, "*"),
    fetchTabla(TABLA_ENVIOS_TALL, "*")
  ]);

  const entregaPSMap = new Map();
  const enviosTallMap = new Map();
  const entregaPSDetalle = new Map();
  const enviosTallDetalle = new Map();

  (entregaPSRows || []).forEach(r => {
    const ref = resolverRefSP(r, idx);
    const key = normalizeText(ref?.piezaMadre || "");
    const kg = num(pick(r, ["KG", "Kg", "kg"]));
    const cajones = num(pick(r, ["Cajones", "cajones", "CAJONES"]));
    const prov = String(pick(r, ["Prov_Serv", "Prov Serv", "prov_serv"])).trim() || "Entrega PS";
    const fecha = String(pick(r, ["Dia-mes", "Dia_mes", "dia-mes", "dia_mes"])).trim();

    if (!key) return;

    addToMap(entregaPSMap, key, kg);

    if (!entregaPSDetalle.has(key)) entregaPSDetalle.set(key, []);
    entregaPSDetalle.get(key).push({ label: prov, fecha, kg, cajones });
  });

  (enviosTallRows || []).forEach(r => {
    const ref = resolverRefGenerico(r, idx);
    const key = normalizeText(ref?.piezaMadre || "");
    const kg = num(pick(r, ["KG", "Kg", "kg"]));
    const cajones = num(pick(r, ["Cajones", "cajones", "CAJONES"]));
    const tall = String(pick(r, ["Tallerista", "tallerista", "TALLERISTA"])).trim() || "Tallerista";
    const fecha = String(pick(r, ["Dia-mes", "Dia_mes", "dia-mes", "dia_mes"])).trim();

    if (!key) return;

    addToMap(enviosTallMap, key, kg);

    if (!enviosTallDetalle.has(key)) enviosTallDetalle.set(key, []);
    enviosTallDetalle.get(key).push({ label: tall, fecha, kg: -kg, cajones: -cajones });
  });

  const result = new Map();
  const keys = new Set([...entregaPSMap.keys(), ...enviosTallMap.keys()]);

  keys.forEach(key => {
    const totalKg = num(entregaPSMap.get(key)) - num(enviosTallMap.get(key));
    const detalle = [
      ...(entregaPSDetalle.get(key) || []),
      ...(enviosTallDetalle.get(key) || [])
    ];

    result.set(key, { totalKg, detalle });
  });

  return result;
}

/*************************************************
 * PS = KG Online PS
 * stockInicial + envios - entregas
 *************************************************/
async function getPSMap() {
  const [idx, partesRows, enviosPSRows, entregaPSRows] = await Promise.all([
    cargarIndicesPiezaMadre(),
    fetchTabla(TABLA_PARTES_PS, "*"),
    fetchTabla(TABLA_ENVIOS_PS, "*"),
    fetchTabla(TABLA_ENTREGA_PS, "*")
  ]);

  const grupos = new Map();

  function ensureGrupo(piezaKey, sector, provServ, kgUni, kgCaj, stockInicialUni) {
    const k = `${piezaKey}__${normalizeText(sector)}__${normalizeText(provServ)}`;

    if (!grupos.has(k)) {
      grupos.set(k, {
        piezaKey,
        sector: String(sector || "").trim(),
        provServ: String(provServ || "").trim(),
        kgUni: num(kgUni),
        kgCaj: num(kgCaj),
        stockInicialUni: num(stockInicialUni),
        envKg: 0,
        entKg: 0
      });
    }

    return grupos.get(k);
  }

  (partesRows || []).forEach(r => {
    const ref = resolverRefSP(r, idx);
    const piezaMadre = String(ref?.piezaMadre || "").trim();
    const piezaKey = normalizeText(piezaMadre);

    const sector = String(pick(r, ["SP", "Sp", "sp"])).trim();
    const provServ = String(pick(r, ["PS", "Ps", "ps"])).trim();
    const stockInicialUni = num(pick(r, ["Stock Inicial", "stock inicial", "Stock_Inicial"]));
    const kgUni = num(ref?.kgUni);
    const kgCaj = num(ref?.kgCaj);

    if (!piezaKey || !sector || !provServ) return;

    ensureGrupo(piezaKey, sector, provServ, kgUni, kgCaj, stockInicialUni);
  });

  (enviosPSRows || []).forEach(r => {
    const ref = resolverRefSP(r, idx);
    const piezaMadre = String(ref?.piezaMadre || "").trim();
    const piezaKey = normalizeText(piezaMadre);

    const sector = String(pick(r, ["Sector SP", "Sector_SP", "sector sp", "sector_sp"])).trim();
    const provServ = String(pick(r, ["Prov_Serv", "Prov Serv", "prov_serv"])).trim();
    const kg = num(pick(r, ["KG", "Kg", "kg"]));
    const kgUni = num(ref?.kgUni);
    const kgCaj = num(ref?.kgCaj);

    if (!piezaKey || !sector || !provServ) return;

    const grupo = ensureGrupo(piezaKey, sector, provServ, kgUni, kgCaj, 0);
    grupo.envKg += kg;
  });

  (entregaPSRows || []).forEach(r => {
    const ref = resolverRefSP(r, idx);
    const piezaMadre = String(ref?.piezaMadre || "").trim();
    const piezaKey = normalizeText(piezaMadre);

    const sector = String(pick(r, ["Sector SP", "Sector_SP", "sector sp", "sector_sp"])).trim();
    const provServ = String(pick(r, ["Prov_Serv", "Prov Serv", "prov_serv"])).trim();
    const kg = num(pick(r, ["KG", "Kg", "kg"]));
    const kgUni = num(ref?.kgUni);
    const kgCaj = num(ref?.kgCaj);

    if (!piezaKey || !sector || !provServ) return;

    const grupo = ensureGrupo(piezaKey, sector, provServ, kgUni, kgCaj, 0);
    grupo.entKg += kg;
  });

  const result = new Map();

  grupos.forEach(g => {
    const stockInicialKg = num(g.stockInicialUni) * num(g.kgUni);
    const totalKg = stockInicialKg + num(g.envKg) - num(g.entKg);

    if (!result.has(g.piezaKey)) {
      result.set(g.piezaKey, { totalKg: 0, detalle: [] });
    }

    const item = result.get(g.piezaKey);
    item.totalKg += totalKg;
    item.detalle.push({
      sector: g.sector,
      provServ: g.provServ,
      kg: totalKg,
      kgUni: g.kgUni,
      kgCaj: g.kgCaj
    });
  });

  result.forEach(item => {
    item.detalle.sort((a, b) =>
      String(a.sector || "").localeCompare(String(b.sector || ""), "es")
    );
  });

  return result;
}
/*************************************************
 * TALL = KG Online Tall
 * stockInicial + envios - entregas
 *************************************************/
async function getTallMap() {
  const [idx, enviosTallRows] = await Promise.all([
    cargarIndicesPiezaMadre(),
    fetchTabla(TABLA_ENVIOS_TALL, "*")
  ]);

  // Agrupar envíos por pieza madre + tallerista
  const detalleMap = new Map();

  (enviosTallRows || []).forEach(r => {
    const ref = resolverRefGenerico(r, idx);
    const key = normalizeText(ref?.piezaMadre || "");

    const tallerista = String(
      pick(r, ["Tallerista", "tallerista", "TALLERISTA"])
    ).trim() || "Tallerista";

    const kg = num(pick(r, ["KG", "Kg", "kg"]));

    if (!key) return;

    if (!detalleMap.has(key)) detalleMap.set(key, new Map());
    const tallMap = detalleMap.get(key);
    tallMap.set(tallerista, (tallMap.get(tallerista) || 0) + kg);
  });

  const result = new Map();

  detalleMap.forEach((tallMap, piezaKey) => {
    const detalle = [];
    let totalKg = 0;
    tallMap.forEach((kg, tallerista) => {
      detalle.push({ label: tallerista, kg });
      totalKg += kg;
    });
    detalle.sort((a, b) => String(a.label).localeCompare(String(b.label), "es"));
    result.set(piezaKey, { totalKg, detalle });
  });

  return result;
}

/*************************************************
 * SM = Stock en Movimiento (ubicaciones intermedias entre matrices)
 *************************************************/
async function getSMMap() {
  const [idx, causaRows, dbRows, scRows] = await Promise.all([
    cargarIndicesPiezaMadre(),
    fetchTabla(TABLA_CAUSA_EFECTO),
    fetchTabla(TABLA_DB_ESPEJO),
    fetchTabla(TABLA_SC_KG)
  ]);

  function esUbicSM(v) { return /^mat(riz)?\s*\d+/i.test(String(v || "").trim()); }
  function normUbic(v) { return String(v || "").trim().toUpperCase().replace(/\s+/g, " "); }

  // Mapa causa-efecto por matriz
  const causaPorMatriz = new Map();
  causaRows.forEach(r => {
    const mat = String(r["Matriz"] ?? "").trim();
    if (!mat) return;
    if (!causaPorMatriz.has(mat)) causaPorMatriz.set(mat, []);
    causaPorMatriz.get(mat).push({
      descuenta: String(r["Descuenta"] ?? "").trim(),
      aumenta: String(r["Aumenta"] ?? "").trim()
    });
  });

  // Identificar ubicaciones SM
  const ubicaciones = new Map();
  causaRows.forEach(r => {
    const aumenta = String(r["Aumenta"] ?? "").trim();
    if (!esUbicSM(aumenta)) return;
    const key = normUbic(aumenta);
    if (!ubicaciones.has(key)) {
      ubicaciones.set(key, { matrizProduce: String(r["Matriz"] ?? "").trim(), matrizPost: null });
    }
  });
  causaRows.forEach(r => {
    const desc = String(r["Descuenta"] ?? "").trim();
    const key = normUbic(desc);
    if (ubicaciones.has(key)) {
      ubicaciones.get(key).matrizPost = String(r["Matriz"] ?? "").trim();
    }
  });

  // Seguir cadena hasta encontrar SC destino
  function encontrarSC(ubicKey) {
    const visited = new Set();
    let current = ubicKey;
    for (let i = 0; i < 20; i++) {
      if (visited.has(current)) return null;
      visited.add(current);
      const ubic = ubicaciones.get(current);
      if (!ubic || !ubic.matrizPost) return null;
      const efectos = causaPorMatriz.get(ubic.matrizPost) || [];
      for (const ef of efectos) {
        if (normUbic(ef.descuenta) === current) {
          if (!esUbicSM(ef.aumenta)) return ef.aumenta.trim().toUpperCase();
          current = normUbic(ef.aumenta);
          break;
        }
      }
    }
    return null;
  }

  // SC → kgUni
  const scInfoMap = new Map();
  scRows.forEach(r => {
    const sc = String(r["SC"] ?? "").trim().toUpperCase();
    if (!sc) return;
    scInfoMap.set(sc, { kgUni: num(r["Kg X Uni"] || r["Kg x Uni"]) });
  });

  // Fabricación por matriz
  const fabPorMatriz = new Map();
  dbRows.filter(r => String(r.Legajo || "").trim() !== "1").forEach(r => {
    const mat = String(r["Matriz"] ?? "").trim();
    const uni = num(r["Uni"]);
    if (!mat || !uni) return;
    fabPorMatriz.set(mat, (fabPorMatriz.get(mat) || 0) + uni);
  });

  // Calcular SM por SC destino → agrupar por Pieza Madre
  // scSector → pieza madre (via idx)
  const smPorPieza = new Map();

  ubicaciones.forEach((ubic, key) => {
    const scDestino = encontrarSC(key);
    if (!scDestino) return;

    const scInfo = scInfoMap.get(scDestino) || { kgUni: 0 };
    const fabMat = fabPorMatriz.get(ubic.matrizProduce) || 0;
    const fabMatPost = ubic.matrizPost ? (fabPorMatriz.get(ubic.matrizPost) || 0) : 0;
    const uniOnline = fabMat - fabMatPost;
    const kgOnline = uniOnline * scInfo.kgUni;

    // Buscar pieza madre del SC destino
    const scNorm = normalizeText(scDestino);
    const ref = idx.scPorSector.get(scNorm);
    const piezaKey = normalizeText(ref?.piezaMadre || "");
    if (!piezaKey) return;

    if (!smPorPieza.has(piezaKey)) smPorPieza.set(piezaKey, { totalKg: 0, detalle: [] });
    const item = smPorPieza.get(piezaKey);
    item.totalKg += kgOnline;
    item.detalle.push({ label: key, kg: kgOnline });
  });

  return smPorPieza;
}

/*************************************************
 * ARMADO FINAL
 *************************************************/
async function construirStocks() {
  const [baseRows, scMap, spMap, psMap, tallMap, smMap] = await Promise.all([
    getBaseSP(),
    getSCMap(),
    getSPMap(),
    getPSMap(),
    getTallMap(),
    getSMMap()
  ]);

  return baseRows.map(base => {
    const scInfo = scMap.get(base.key) || { totalKg: 0, detalle: [] };
    const spInfo = spMap.get(base.key) || { totalKg: 0, detalle: [] };
    const psInfo = psMap.get(base.key) || { totalKg: 0, detalle: [] };
    const tallInfo = tallMap.get(base.key) || { totalKg: 0, detalle: [] };
    const smInfo = smMap.get(base.key) || { totalKg: 0, detalle: [] };

    // Completar detalleSC con sectores faltantes (mostrar 0)
    const scLabelsExistentes = new Set((scInfo.detalle || []).map(d => d.label));
    const detalleSCCompleto = [...(scInfo.detalle || [])];
    (base.scList || []).forEach(sc => {
      if (!scLabelsExistentes.has(sc)) {
        detalleSCCompleto.push({ label: sc, kg: 0 });
      }
    });
    detalleSCCompleto.sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), "es"));

    // Completar detalleSP con sectores SP faltantes (mostrar 0)
    const spLabelsExistentes = new Set((spInfo.detalle || []).map(d => d.label));
    const detalleSPCompleto = [...(spInfo.detalle || [])];
    (base.spList || []).forEach(sp => {
      if (!spLabelsExistentes.has(sp)) {
        detalleSPCompleto.push({ label: sp, kg: 0, cajones: 0 });
      }
    });

    return {
      key: base.key,
      scList: base.scList || [],
      spList: base.spList || [],
      descripcion: base.descripcion || "",
      kgUni: num(base.kgUni),
      kgCaj: num(base.kgCaj),
      stockSCKg: num(scInfo.totalKg),
      stockSPKg: num(spInfo.totalKg),
      stockPSKg: num(psInfo.totalKg),
      stockTallKg: num(tallInfo.totalKg),
      stockSMKg: num(smInfo.totalKg),
      detalleSC: detalleSCCompleto,
      detalleSP: detalleSPCompleto,
      detallePS: psInfo.detalle || [],
      detalleSM: smInfo.detalle || [],
      detalleTall: tallInfo.detalle || []
    };
  }).sort((a, b) =>
    String(a.descripcion || "").localeCompare(String(b.descripcion || ""), "es")
  );
}

/*************************************************
 * DESGLOSE
 *************************************************/
function mostrarDesglose(titulo, detalle, kgUni, kgCaj, formato) {
  if (!detalle || !detalle.length) {
    alert(`${titulo}\n\nSin desglose.`);
    return;
  }

  const texto = detalle.map(item => {
    const valor = convertirKgAFormato(item.kg, kgUni, kgCaj, formato);
    return `${item.label}: ${formatValorSegunFormato(valor, formato)}`;
  }).join("\n");

  alert(`${titulo}\n\n${texto}`);
}

function buildDetalleButton(valorKg, detalle, kgUni, kgCaj, formato, titulo) {
  const valorFormateado = formatValorSegunFormato(
    convertirKgAFormato(valorKg, kgUni, kgCaj, formato),
    formato
  );

  const tieneDetalle = Array.isArray(detalle) && detalle.length > 1;

  if (!tieneDetalle) {
    return `<span>${escapeHtml(valorFormateado)}</span>`;
  }

  return `
    <button
      type="button"
      class="stock-detail-btn"
      data-titulo="${escapeHtml(titulo)}"
      style="border:0;background:transparent;padding:0;margin:0;cursor:pointer;font:inherit;color:inherit;text-decoration:underline;"
    >
      ${escapeHtml(valorFormateado)}
    </button>
  `;
}

/*************************************************
 * SECTORES COMPACTO (max 2 por línea)
 *************************************************/
function formatSectoresCell(scList, spList) {
  const bloques = [];

  function buildBloque(label, codes) {
    if (!codes || !codes.length) return "";
    const lineas = [];
    for (let i = 0; i < codes.length; i += 2) {
      const grupo = codes.slice(i, i + 2).map(c => escapeHtml(c)).join(", ");
      if (i === 0) {
        lineas.push(`<span style="font-weight:700;font-size:9px;color:#999;">${label}</span> ${grupo}`);
      } else {
        lineas.push(grupo);
      }
    }
    return lineas.join("<br>");
  }

  if (scList.length) bloques.push(buildBloque("SC", scList));
  if (spList.length) bloques.push(buildBloque("SP", spList));

  if (!bloques.length) return "";
  return bloques.join('<hr style="margin:2px 0;border:0;border-top:2px solid #aaa;">');
}

/*************************************************
 * RENDER
 *************************************************/
function renderTable(rows) {
  if (!rows.length) {
    tbodyStocksGeneral.innerHTML = `
      <tr>
        <td colspan="7" class="empty">No se encontraron datos.</td>
      </tr>
    `;
    return;
  }

  const formato = getFormatoActual();

  tbodyStocksGeneral.innerHTML = rows.map((r, index) => {
    const totalAbs = Math.abs(num(r.stockSCKg)) + Math.abs(num(r.stockSPKg)) + Math.abs(num(r.stockPSKg)) + Math.abs(num(r.stockSMKg)) + Math.abs(num(r.stockTallKg));
    const filaIndicador = totalAbs > 0 ? "+" : "-";

    return `
  <tr>
    <td class="text-left col-sectores">${formatSectoresCell(r.scList, r.spList)}</td>
    <td class="text-left">${escapeHtml(r.descripcion || "")}</td>

    <td class="text-right ${r.stockSCKg < 0 ? "negativo" : ""}">
      ${buildMovimientoCell(r.stockSCKg, r.detalleSC, index, "sc", r.kgUni, r.kgCaj, formato, filaIndicador)}
    </td>

    <td class="text-right ${r.stockSPKg < 0 ? "negativo" : ""}">
      ${buildMovimientoCell(r.stockSPKg, r.detalleSP, index, "sp", r.kgUni, r.kgCaj, formato, filaIndicador)}
    </td>

    <td class="text-right col-ps ${r.stockPSKg < 0 ? "negativo" : ""}">
      ${buildMovimientoCell(r.stockPSKg, r.detallePS, index, "ps", r.kgUni, r.kgCaj, formato, filaIndicador)}
    </td>

    <td class="text-right ${r.stockSMKg < 0 ? "negativo" : ""}">
      ${buildMovimientoCell(r.stockSMKg, r.detalleSM, index, "sm", r.kgUni, r.kgCaj, formato, filaIndicador)}
    </td>

    <td class="text-right ${r.stockTallKg < 0 ? "negativo" : ""}">
      ${buildMovimientoCell(r.stockTallKg, r.detalleTall, index, "tall", r.kgUni, r.kgCaj, formato, filaIndicador)}
    </td>
  </tr>
`;
  }).join("");

  tbodyStocksGeneral.querySelectorAll(".mini-popup-btn-stock").forEach(btn => {
  btn.addEventListener("click", () => {
    const rowIndex = Number(btn.dataset.rowIndex);
    const tipo = btn.dataset.tipo;
    const row = rows[rowIndex];
    if (!row) return;

    if (tipo === "sc") {
      abrirPopupStocks(`SC: ${row.descripcion || ""}`, row.detalleSC, row.kgUni, row.kgCaj, "sc");
    } else if (tipo === "sp") {
      abrirPopupStocks(`SP: ${row.descripcion || ""}`, row.detalleSP, row.kgUni, row.kgCaj, "sp");
    } else if (tipo === "ps") {
      abrirPopupStocks(`PS: ${row.descripcion || ""}`, row.detallePS, row.kgUni, row.kgCaj, "ps");
    } else if (tipo === "sm") {
      abrirPopupStocks(`SM: ${row.descripcion || ""}`, row.detalleSM, row.kgUni, row.kgCaj, "sm");
    } else {
      abrirPopupStocks(`Tall: ${row.descripcion || ""}`, row.detalleTall, row.kgUni, row.kgCaj, "tall");
    }
  });
});
}

function aplicarFiltros() {
  const q = normalizeText(txtBuscar.value);
  const modo = selSoloConStock.value;
  const formato = getFormatoActual();

  rowsFiltradas = rowsOriginal.filter(r => {
    const matchBusqueda =
      !q ||
      normalizeText(r.descripcion).includes(q) ||
      normalizeText((r.scList || []).join(" ")).includes(q) ||
      normalizeText((r.spList || []).join(" ")).includes(q);

const totalAbs =
  Math.abs(convertirKgAFormato(r.stockSCKg, r.kgUni, r.kgCaj, formato)) +
  Math.abs(convertirKgAFormato(r.stockSPKg, r.kgUni, r.kgCaj, formato)) +
  Math.abs(convertirKgAFormato(r.stockPSKg, r.kgUni, r.kgCaj, formato)) +
  Math.abs(convertirKgAFormato(r.stockSMKg, r.kgUni, r.kgCaj, formato)) +
  Math.abs(convertirKgAFormato(r.stockTallKg, r.kgUni, r.kgCaj, formato));

    const tieneStock = totalAbs > 0;

    if (modo === "conStock" && !tieneStock) return false;
    if (modo === "sinStock" && tieneStock) return false;

    return matchBusqueda;
  });

  renderTable(rowsFiltradas);
  lblEstado.textContent = `${rowsFiltradas.length} registros`;
}

async function cargarStocksGeneral() {
  try {
    lblEstado.textContent = "Cargando...";
    tbodyStocksGeneral.innerHTML = `
      <tr>
        <td colspan="7" class="empty">Cargando datos...</td>
      </tr>
    `;

    rowsOriginal = await construirStocks();
    aplicarFiltros();
  } catch (error) {
    console.error("ERROR StocksGeneral:", error);
    lblEstado.textContent = `Error: ${error.message || error}`;
    tbodyStocksGeneral.innerHTML = `
      <tr>
        <td colspan="7" class="empty">Error al cargar datos.</td>
      </tr>
    `;
  }
}

/*************************************************
 * EVENTOS
 *************************************************/
txtBuscar.addEventListener("input", aplicarFiltros);
selSoloConStock.addEventListener("change", aplicarFiltros);
selFormatoStock.addEventListener("change", aplicarFiltros);

btnInicio.addEventListener("click", () => {
  window.location.href = "../Inicio/index.html";
});

cargarStocksGeneral();
