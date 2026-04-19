/* =========================================================
   GP Helpers — utilidades compartidas
   Cargar con: <script src="../helpers.js"></script>
   Expone window.GP: parseDecimal, normalizeText, normalizeCode,
                    n, esc, pick, TM_CODES, NON_DOWNTIME, isTM
========================================================= */
(function (global) {
  "use strict";

  // --- Números ---

  // parseDecimal: acepta "1,23" o "1.23", retorna Number (o NaN)
  function parseDecimal(v) {
    if (v === null || v === undefined || v === "") return NaN;
    if (typeof v === "number") return v;
    const s = String(v).trim().replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // n: wrapper que retorna 0 si NaN
  function n(v) { const x = parseDecimal(v); return Number.isFinite(x) ? x : 0; }

  // safeDiv: divide con 0 como fallback (evita Infinity/NaN)
  function safeDiv(a, b, fallback = 0) {
    const bn = parseDecimal(b);
    if (!bn || !Number.isFinite(bn)) return fallback;
    const an = parseDecimal(a);
    if (!Number.isFinite(an)) return fallback;
    return an / bn;
  }

  // --- Strings ---

  // normalizeText: minúsculas, sin tildes, sin espacios extra
  function normalizeText(s) {
    return String(s == null ? "" : s)
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ").trim();
  }

  // normalizeCode: pad con ceros a N dígitos si es numérico; sino deja tal cual
  function normalizeCode(code, padLen = 3) {
    if (!code) return "";
    const s = String(code).trim();
    if (/^\d+$/.test(s)) return s.padStart(padLen, "0");
    return s;
  }

  // esc: escape HTML
  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  // --- Supabase helpers ---

  // pick: toma primer valor no vacío de la fila para cualquier de las claves listadas
  function pick(row, keys, fallback = "") {
    if (!row || !keys) return fallback;
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
    }
    return fallback;
  }

  // --- Constantes comunes ---

  // Códigos de Tiempo Muerto (no se cuentan como producción)
  const TM_CODES = ["PB", "BC", "MOV", "PC", "PR", "AL", "LT", "RD", "PM", "RM", "E", "C", "PERM"];

  // Set para búsqueda O(1)
  const NON_DOWNTIME = new Set(["E", "C", "RM", "PM", "RD", "LT"]);

  // Lista de talleristas que son proveedores de art terminado (no procesan internamente)
  const PROV_AT = new Set(["Carriero", "Lopez Jose", "Manfer", "Maspoli", "Melinox", "Paternal Goma", "Pintos", "The Plast"]);

  // isTM: ¿un código de matriz es tiempo muerto?
  function isTM(code) {
    return TM_CODES.includes(String(code || "").toUpperCase());
  }

  // --- Cálculos de premio ---

  // ptjeNum: cálculo de puntaje producción. Retorna 0 si hist inválido.
  function ptjeNum(segT, segH) {
    const st = parseDecimal(segT);
    const sh = parseDecimal(segH);
    if (!sh || !Number.isFinite(sh) || sh === 0) return 0;
    if (!Number.isFinite(st)) return 0;
    return (-(st / sh - 1)) * 10;
  }

  // --- Exponer ---
  global.GP = {
    parseDecimal, n, safeDiv,
    normalizeText, normalizeCode, esc,
    pick,
    TM_CODES, NON_DOWNTIME, PROV_AT,
    isTM, ptjeNum
  };
})(window);
