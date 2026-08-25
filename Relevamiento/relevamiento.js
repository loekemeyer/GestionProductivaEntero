/* =========================================================
   Módulo Relevamiento — schema relevamiento_cervantes
   Lee/escribe vía API pública (vistas v_rc_* + RPC rc_* en public).
   - Nuevo relevamiento (genera cabecera + detalle desde el catálogo)
   - Ver anteriores + resumen (total y por lugar/planta)
   - Cargar el conteo de cada relevamiento
   - Completar el mismo relevamiento en las plantas donde no se cargó
========================================================= */
(function () {
  "use strict";

  const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
  const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Tipos de relevamiento (orden A1..A7)
  const TIPOS = [
    { key: "cajas",     label: "Cajas" },
    { key: "flejes",    label: "Flejes" },
    { key: "cartones",  label: "Cartones" },
    { key: "plasticos", label: "Plásticos" },
    { key: "remaches",  label: "Remaches" },
    { key: "bombillas", label: "Bombillas" },
    { key: "garage",    label: "Garage" },
  ];
  const TIPO_LABEL = Object.fromEntries(TIPOS.map(t => [t.key, t.label]));
  const PLANTAS = ["Cervantes", "Virgilio"];
  const ABREV_PLANTA = { "Cervantes": "Cerv.", "Virgilio": "Virg." };

  // Plantas donde aplica cada tipo (espejo de rc_plantas_tipo)
  const PLANTAS_TIPO = {
    flejes: ["Cervantes", "Virgilio"],
    cajas: ["Cervantes", "Virgilio"],
    plasticos: ["Cervantes", "Virgilio"],
    cartones: ["Cervantes"],
    remaches: ["Cervantes"],
    bombillas: ["Cervantes"],
    garage: ["Cervantes"],
  };

  // Tipos donde NO se muestra la columna Descripción (cajas: "Caja N" redundante; cartones: no se necesita)
  const HIDE_DESC = { cajas: true, cartones: true };

  // Columnas de INFO a mostrar (claves del jsonb "info")
  const INFO_COLS = {
    cajas:     [["n_caja", "N° Caja"]],
    flejes:    [["n_fleje", "N° Fleje"]],
    cartones:  [["cod", "Cód"], ["linea", "Linea"]],
    plasticos: [],
    remaches:  [["sector_crudo", "S.Crudo"]],
    bombillas: [["uni_x_bc", "Uni x B/C"]],
    garage:    [],
  };

  // Columnas de CONTEO (input). plantas => solo se muestra en esas plantas.
  const CONTEO_COLS = {
    cajas: [
      { key: "conteo_paq", label: "Paquetes", plantas: ["Cervantes"] },
      { key: "uni_suelta", label: "Uni sueltas", plantas: ["Cervantes"], tandas: true, tandasPaqKey: "conteo_paq", tandasPaqLabel: "Paquetes" },
      { key: "uni", label: "Unidades", plantas: ["Virgilio"] },
    ],
    flejes: [
      // Cervantes: cada fleje puede tener varios rollos (algunos usados a distinto peso) -> se cargan POR TANDAS
      // (Cant rollos x Kg c/u); el Total Kg = suma de (cant x kg) cae en esta celda. Boton "T" abre el popup.
      { key: "total_kg", label: "Total Kg", plantas: ["Cervantes"], tandas: true, flejeTandas: true },
      { key: "stock_kg", label: "Stock Kg", plantas: ["Virgilio"] },
    ],
    cartones: [
      { key: "conteo_paquete", label: "Paquetes" },
      { key: "uni_suelta", label: "Uni sueltas", tandas: true, tandasPaqKey: "conteo_paquete", tandasPaqLabel: "Paquetes" },
    ],
    plasticos: [
      { key: "stock_relev_bolsa", label: "Bolsas" },
      { key: "uni_suelta", label: "Uni sueltas" },
    ],
    remaches: [
      { key: "bolsas_niquel", label: "Bolsas niquel" },
      { key: "stock_crudo_kg", label: "Stock crudo Kg" },
    ],
    bombillas: [
      { key: "stock_bolsa_caj_rollo", label: "Bolsa/Caj/Rollo" },
      { key: "uni_suelta", label: "Uni sueltas" },
    ],
    garage: [
      { key: "stock_actual_cajon", label: "Cajones" },
      { key: "uni_suelta", label: "Uni sueltas" },
    ],
  };

  // Columnas CALCULADAS (no editables; se guardan solas). Flejes Cervantes ya no calcula acá:
  // el Total Kg se ingresa directo o por tandas (Cant rollos x Kg c/u) desde el popup.
  const COMPUTED = {};
  const computedFor = (tipo, planta) => (COMPUTED[tipo] || []).filter(c => !c.plantas || c.plantas.includes(planta));

  // Unidad base para el TOTAL de la vista combinada, y aporte de cada lugar en esa unidad.
  const BASE_UNIT = { flejes: "kg", cajas: "uni", plasticos: "uni", garage: "uni" };
  function aporteBase(tipo, planta, conteo, info) {
    const num = x => { const n = parseFloat(String(x == null ? "" : x).replace(",", ".")); return isNaN(n) ? 0 : n; };
    const c = conteo || {}, i = info || {};
    if (tipo === "flejes") return planta === "Cervantes" ? num(c.total_kg) : num(c.stock_kg);
    if (tipo === "cajas") return planta === "Virgilio" ? num(c.uni) : num(c.conteo_paq) * num(i.uni_x_paq) + num(c.uni_suelta);
    // Si el ítem no tiene "uni x bolsa" (Master Bach, materias primas, etc.), la cuenta es
    // por BOLSA: 1 bolsa = 1 (no multiplicar por 0, que borraba lo cargado).
    if (tipo === "plasticos") { const ub = num(i.uni_x_bolsa); return num(c.stock_relev_bolsa) * (ub || 1) + num(c.uni_suelta); }
    // Garage: cepillos con "uni x caja" -> cajones × uni_x_caja + uni sueltas. Si no tiene uni_x_caja
    // (ensambles GRJ), el total es el conteo de cajones.
    if (tipo === "garage") { const uc = num(i.uni_x_caja); return num(c.stock_actual_cajon) * (uc || 1) + num(c.uni_suelta); }
    return 0;
  }
  function fmtNum(n, tipo) {
    const dec = BASE_UNIT[tipo] === "kg" ? 3 : 0;
    return Number(n || 0).toLocaleString("es-AR", { maximumFractionDigits: dec });
  }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
  // Titulo de columna: si tiene un espacio, se parte en dos lineas (en el primer espacio)
  const titleBreak = (s) => { s = String(s == null ? "" : s); const i = s.indexOf(" "); return i < 0 ? esc(s) : esc(s.slice(0, i)) + "<br>" + esc(s.slice(i + 1)); };
  // Parte un valor por "-" en varias lineas (ej. cod "Bomb-CH" -> "Bomb"/"CH")
  const dashBreak = (s) => String(s == null ? "" : s).split("-").map(esc).join("<br>");
  // Envuelve por PALABRAS: acumula palabras y corta en el espacio cuando la linea pasa de n caracteres
  // (no parte palabras al medio). Ej. n=10: "Cuchilla Pelapapa Curva" -> "Cuchilla Pelapapa" / "Curva".
  const wrapLines = (s, n) => {
    s = String(s == null ? "" : s).trim();
    if (!s) return [];
    const words = s.split(/\s+/), lines = [];
    let cur = "";
    for (const w of words) {
      cur = cur ? cur + " " + w : w;
      if (cur.length >= n) { lines.push(cur); cur = ""; }
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const wrapBreak = (s, n) => wrapLines(s, n).map(esc).join("<br>");
  const norm = (s) => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const fmtFecha = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };
  // Orden NATURAL (A1 < A2 < A10 < B1). Se parte en tramos de letras/numeros y se comparan por tramo.
  // Se ignoran los espacios para que "GRJ 1" y "GRJ18" ordenen juntos (garage tiene espaciado inconsistente).
  const natKey = (s) => String(s == null ? "" : s).toUpperCase().replace(/\s+/g, "").match(/\d+|\D+/g) || [];
  function cmpNat(a, b) {
    const ka = natKey(a), kb = natKey(b), n = Math.min(ka.length, kb.length);
    for (let i = 0; i < n; i++) {
      const x = ka[i], y = kb[i], nx = parseInt(x, 10), ny = parseInt(y, 10);
      if (!isNaN(nx) && !isNaN(ny)) { if (nx !== ny) return nx - ny; }
      else if (x !== y) return x < y ? -1 : 1;
    }
    return ka.length - kb.length;
  }
  // Ordena las filas del relevamiento por SECTOR (natural), con el orden del catalogo como desempate.
  const cmpSector = (a, b) => cmpNat(a.sector, b.sector) || ((a.orden || 0) - (b.orden || 0));
  // Remaches ordena por sector CRUDO; los "sin sector" (S/S o vacío) van al FINAL.
  const esSinSector = (s) => { const v = String(s == null ? "" : s).trim().toUpperCase(); return v === "" || v === "S/S"; };
  const cmpSectorRow = (a, b) => {
    if (a.tipo === "remaches") {
      const ka = (a.info && a.info.sector_crudo) || "", kb = (b.info && b.info.sector_crudo) || "";
      const va = esSinSector(ka), vb = esSinSector(kb);
      if (va !== vb) return va ? 1 : -1;                    // sin sector -> al final
      if (va && vb) return (a.orden || 0) - (b.orden || 0); // ambos sin sector -> por orden de catálogo
      return cmpNat(ka, kb) || ((a.orden || 0) - (b.orden || 0));
    }
    // Todos los tipos: sin sector al final
    const sa = esSinSector(a.sector), sb = esSinSector(b.sector);
    if (sa !== sb) return sa ? 1 : -1;
    if (sa && sb) return (a.orden || 0) - (b.orden || 0);
    return cmpNat(a.sector, b.sector) || ((a.orden || 0) - (b.orden || 0));
  };

  function colsFor(tipo, planta) {
    return (CONTEO_COLS[tipo] || []).filter(c => !c.plantas || c.plantas.includes(planta));
  }

  // Composición de un valor: cómo se calculó (renglones intermedios + resultado final).
  function composicion(tipo, planta, info, conteo) {
    const num = x => { const n = parseFloat(String(x == null ? "" : x).replace(",", ".")); return isNaN(n) ? 0 : n; };
    const c = conteo || {}, i = info || {};
    const L = (label, val, tipoFila) => ({ label, val, tipoFila });
    if (tipo === "cajas") {
      if (planta === "Virgilio") return { lineas: [L("Unidades", num(c.uni))], total: num(c.uni), unidad: "uni" };
      const paq = num(c.conteo_paq), upp = num(i.uni_x_paq), sub = paq * upp, sueltas = num(c.uni_suelta);
      return { lineas: [L("Paquetes", paq), L("Uni x paquete", upp), L("Paquetes × Uni/paq", sub, "sub"), L("Uni sueltas", sueltas)], total: sub + sueltas, unidad: "uni" };
    }
    if (tipo === "cartones") {
      const paq = num(c.conteo_paquete), upp = num(i.uni_x_paq), sub = paq * upp, sueltas = num(c.uni_suelta);
      return { lineas: [L("Paquetes", paq), L("Uni x paquete", upp), L("Paquetes × Uni/paq", sub, "sub"), L("Uni sueltas", sueltas)], total: sub + sueltas, unidad: "uni" };
    }
    if (tipo === "plasticos") {
      const b = num(c.stock_relev_bolsa), ub = num(i.uni_x_bolsa), sueltas = num(c.uni_suelta);
      // Sin "uni x bolsa": se cuenta por bolsa (no hay conversión a unidades).
      if (!ub) return { lineas: [L("Bolsas", b), L("Uni sueltas", sueltas)], total: b + sueltas, unidad: "uni" };
      const sub = b * ub;
      return { lineas: [L("Bolsas", b), L("Uni x bolsa", ub), L("Bolsas × Uni/bolsa", sub, "sub"), L("Uni sueltas", sueltas)], total: sub + sueltas, unidad: "uni" };
    }
    if (tipo === "bombillas") {
      const s = num(c.stock_bolsa_caj_rollo), ub = num(i.uni_x_bc), sub = s * ub, sueltas = num(c.uni_suelta);
      return { lineas: [L("Bolsa/Caj/Rollo", s), L("Uni x b/c", ub), L("× Uni", sub, "sub"), L("Uni sueltas", sueltas)], total: sub + sueltas, unidad: "uni" };
    }
    if (tipo === "flejes") {
      if (planta !== "Cervantes") return { lineas: [L("Stock Kg", num(c.stock_kg))], total: num(c.stock_kg), unidad: "kg" };
      const rollos = Array.isArray(c.rollos_json) ? c.rollos_json : [];
      const lineas = rollos.length
        ? rollos.map(r => L(`${num(r.caj)} rollo(s) × ${num(r.kg)} kg`, num(r.caj) * num(r.kg)))
        : [L("Total Kg", num(c.total_kg))];
      return { lineas, total: num(c.total_kg), unidad: "kg" };
    }
    if (tipo === "remaches") {
      return { lineas: [L("Bolsas níquel", num(c.bolsas_niquel)), L("Stock crudo Kg", num(c.stock_crudo_kg))], total: null };
    }
    if (tipo === "garage") {
      const caj = num(c.stock_actual_cajon), uc = num(i.uni_x_caja), sueltas = num(c.uni_suelta);
      // Sin "uni x caja" (ensambles GRJ): se cuenta por cajón. Con uni_x_caja (cepillos): cajones × uni/caja + sueltas.
      if (!uc) return { lineas: [L("Cajones", caj)], total: caj, unidad: "cajón" };
      const sub = caj * uc;
      return { lineas: [L("Cajones", caj), L("Uni x caja", uc), L("Cajones × Uni/caja", sub, "sub"), L("Uni sueltas", sueltas)], total: sub + sueltas, unidad: "uni" };
    }
    return { lineas: [], total: null };
  }

  function fmtComp(v) { return Number(v || 0).toLocaleString("es-AR", { maximumFractionDigits: 3 }); }

  function mostrarComposicion(tipo, planta, info, conteo, descripcion, sector) {
    const comp = composicion(tipo, planta, info, conteo);
    const filas = comp.lineas.map(l =>
      `<tr class="${l.tipoFila === "sub" ? "sub" : ""}"><td class="lbl">${esc(l.label)}</td><td class="val">${fmtComp(l.val)}</td></tr>`
    ).join("");
    const totFila = comp.total == null ? "" :
      `<tr class="tot"><td class="lbl">Total</td><td class="val">${fmtComp(comp.total)}${comp.unidad ? " " + esc(comp.unidad) : ""}</td></tr>`;
    $("compTitulo").textContent = `${TIPO_LABEL[tipo] || tipo} · ${planta}`;
    $("compBody").innerHTML =
      `<div class="comp-sub">${esc(sector || "")}${descripcion ? " — " + esc(descripcion) : ""}</div>
       <table class="comp-tabla">${filas}${totFila}</table>`;
    $("modalComp").style.display = "flex";
  }
  function cerrarComposicion() { $("modalComp").style.display = "none"; }

  // Pares que van juntos: si uno tiene valor, el otro también. (Flejes ya no usa pares: carga por tandas.)
  const PAIR_VALID = {};
  // Marca en rojo el input que falta de un par y devuelve las claves con error de esa fila.
  function marcarErroresPar(tr) {
    tr.querySelectorAll("input.ci").forEach(i => i.classList.remove("ci-error"));
    const pairs = PAIR_VALID[DET.rel && DET.rel.tipo]; if (!pairs) return [];
    const get = k => tr.querySelector(`input.ci[data-key="${k}"]`);
    const errs = [];
    for (const [a, b] of pairs) {
      const ia = get(a), ib = get(b);
      if (!ia || !ib) continue; // el par no está en esta planta
      const fa = ia.value.trim() !== "", fb = ib.value.trim() !== "";
      if (fa !== fb) errs.push(fa ? b : a); // el que falta
    }
    errs.forEach(k => { const i = get(k); if (i) i.classList.add("ci-error"); });
    return errs;
  }

  function showMsg(text, kind) {
    const m = $("msg");
    if (!text) { m.innerHTML = ""; return; }
    m.innerHTML = `<div class="msg ${kind || "ok"}">${esc(text)}</div>`;
    if (kind === "ok") setTimeout(() => { if (m.firstChild) m.innerHTML = ""; }, 3500);
  }

  // ---------------------------------------------------------------------------
  // LISTA + RESUMEN
  // ---------------------------------------------------------------------------
  let RELS = [];

  async function cargarLista() {
    const { data, error } = await sb
      .from("v_rc_relevamientos")
      .select("*")
      .order("fecha", { ascending: false })
      .order("id", { ascending: false });
    if (error) { showMsg("Error leyendo relevamientos: " + error.message, "err"); return; }
    RELS = data || [];
    renderCronograma();
  }

  // Última tanda (grupo) de cada tipo: tipo -> { g, rels, maxFecha }. Es el "relevamiento actual" de cada tipo.
  // Se elige la tanda CREADA MÁS RECIENTEMENTE (mayor grupo_id), no la de mayor fecha: una tanda nueva
  // "pisa" a las anteriores aunque tenga fecha anterior (p.ej. una tanda vieja con un lugar post-fechado).
  function ultimasTandasPorTipo() {
    const groups = new Map();
    for (const r of RELS) { const g = r.grupo_id || r.id; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
    const ultima = {};
    for (const [g, rels] of groups) {
      const tipo = rels[0].tipo;
      const maxFecha = rels.reduce((m, r) => (r.fecha > m ? r.fecha : m), rels[0].fecha);
      const cur = ultima[tipo];
      if (!cur || g > cur.g) ultima[tipo] = { g, rels, maxFecha };
    }
    return ultima;
  }

  // ===========================================================================
  // CRONOGRAMA — cada relevamiento se hace cada X días, contando desde una fecha
  // ancla (grilla fija). Si la fecha cae sábado/domingo/feriado, se corre al
  // próximo día hábil. Los feriados se traen por API (con cache y fallback).
  // ===========================================================================
  const CRONOGRAMA = {
    garage:    { frecuencia: 7,  ancla: "2026-07-24" },
    remaches:  { frecuencia: 40, ancla: "2026-06-25" }, // ancla + 40 = 04/08 (próximo, aún sin hacer)
    bombillas: { frecuencia: 30, ancla: "2026-07-16" },
    cajas:     { frecuencia: 40, ancla: "2026-07-13" },
    flejes:    { frecuencia: 40, ancla: "2026-07-04" }, // 2026-07-04 + 40 = 2026-08-13 (proxima)
    plasticos: { frecuencia: 30, ancla: "2026-07-28" },
    cartones:  { frecuencia: 40, ancla: "2026-07-23" },
  };
  const PLASTICO_LUGAR = { Cervantes: "partes", Virgilio: "bolsas" };

  let FERIADOS = new Set();
  // Fallback (nacionales AR, trasladables ya corridos) por si la API/CORS falla:
  const FERIADOS_FALLBACK = [
    "2026-01-01","2026-02-16","2026-02-17","2026-03-24","2026-04-02","2026-05-01",
    "2026-05-25","2026-06-15","2026-06-20","2026-07-09","2026-08-17","2026-10-12",
    "2026-11-23","2026-12-08","2026-12-25",
    "2027-01-01","2027-02-15","2027-02-16","2027-03-24","2027-04-02","2027-05-01",
    "2027-05-25","2027-06-21","2027-07-09","2027-08-16","2027-10-11","2027-11-22",
    "2027-12-08","2027-12-25",
  ];
  async function cargarFeriados() {
    FERIADOS = new Set(FERIADOS_FALLBACK);
    const hoy = new Date();
    for (const y of [hoy.getFullYear(), hoy.getFullYear() + 1]) {
      try {
        const ck = "rc_feriados_" + y;
        let arr = null;
        try { const c = localStorage.getItem(ck); if (c) arr = JSON.parse(c); } catch (e) {}
        if (!arr) {
          const resp = await fetch("https://api.argentinadatos.com/v1/feriados/" + y);
          if (resp.ok) { arr = await resp.json(); try { localStorage.setItem(ck, JSON.stringify(arr)); } catch (e) {} }
        }
        if (Array.isArray(arr)) arr.forEach(f => { if (f && f.fecha) FERIADOS.add(String(f.fecha).slice(0, 10)); });
      } catch (e) { /* queda el fallback */ }
    }
  }

  // Utils de fecha (sin hora)
  const parseYmd = (s) => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); };
  const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const addDias = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  const esNoHabil = (d) => { const w = d.getDay(); return w === 0 || w === 6 || FERIADOS.has(toYmd(d)); };
  const proxHabil = (d) => { let x = d, g = 0; while (esNoHabil(x) && g++ < 40) x = addDias(x, 1); return x; };
  const hoyDate = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

  // Último relevamiento COMPLETADO (cargados>=items) de un tipo+lugar
  function ultimaCompletada(tipo, planta) {
    const done = RELS.filter(r => r.tipo === tipo && r.planta === planta && r.items > 0 && r.cargados >= r.items);
    return done.length ? done.reduce((a, b) => (a.fecha > b.fecha ? a : b)) : null;
  }

  // Próxima fecha a realizar (grilla fija desde ancla) tomando Cervantes como referencia
  function proximaCervantes(tipo) {
    const cfg = CRONOGRAMA[tipo]; if (!cfg) return null;
    const ancla = parseYmd(cfg.ancla), X = cfg.frecuencia, MS = 86400000;
    let ref = ancla;
    const doneCerv = ultimaCompletada(tipo, "Cervantes");
    if (doneCerv) { const fd = parseYmd(doneCerv.fecha); if (fd > ref) ref = fd; }
    let k = Math.floor((ref - ancla) / (X * MS)) + 1; if (k < 1) k = 1;
    let raw = addDias(ancla, k * X);
    while (raw <= ref) { k++; raw = addDias(ancla, k * X); }
    return { raw, adj: proxHabil(raw), cicloInicio: addDias(ancla, (k - 1) * X) };
  }

  // Meses hacia adelante que cubre el cálculo de fechas (para que TODOS los tipos —incluido
  // garage, semanal— aparezcan en cualquier mes que se navegue en el calendario).
  const MESES_HORIZONTE = 15;

  // Fechas de TODOS los tipos con ANTI-COLISIÓN, hasta la fecha límite `hasta`: dos relevamientos
  // NO pueden caer el mismo día. Se generan todas las ocurrencias de cada tipo (grilla fija desde
  // ancla) hasta `hasta`, se procesan en orden cronológico (desempate por orden de TIPOS) y a cada
  // una se le asigna el primer día HÁBIL >= su fecha que no esté ocupado por otro relevamiento.
  // Devuelve { tipo: [fecha0, fecha1, ...] } (fecha0 = próxima a realizar).
  function fechasGlobales(hasta) {
    const tipos = TIPOS.filter(t => CRONOGRAMA[t.key]);
    const orderIdx = {}; tipos.forEach((t, idx) => orderIdx[t.key] = idx);
    const MS = 86400000, events = [];
    tipos.forEach(t => {
      const cfg = CRONOGRAMA[t.key], ancla = parseYmd(cfg.ancla), X = cfg.frecuencia;
      const k0 = Math.round((proximaCervantes(t.key).raw - ancla) / (X * MS));
      let i = 0, raw = addDias(ancla, k0 * X);
      // Al menos la próxima; después todas las que entren hasta `hasta`.
      while (i === 0 || (raw <= hasta && i < 5000)) { events.push({ tipo: t.key, raw }); i++; raw = addDias(ancla, (k0 + i) * X); }
    });
    events.sort((a, b) => (a.raw - b.raw) || (orderIdx[a.tipo] - orderIdx[b.tipo]));
    const taken = new Set(), res = {}; tipos.forEach(t => res[t.key] = []);
    events.forEach(ev => {
      let d = proxHabil(ev.raw), g = 0;
      while (taken.has(toYmd(d)) && g++ < 400) d = proxHabil(addDias(d, 1));
      taken.add(toYmd(d)); res[ev.tipo].push(d);
    });
    return res;
  }
  // Fecha límite del horizonte de cálculo (hoy + MESES_HORIZONTE meses).
  function horizonteFechas() { const h = hoyDate(); return new Date(h.getFullYear(), h.getMonth() + MESES_HORIZONTE, h.getDate()); }

  // Estado de un lugar para el ciclo actual. HECHO solo si se COMPLETÓ el relevamiento de este ciclo
  // (fecha estrictamente posterior al inicio del ciclo). El ancla NO cuenta como hecho para la fecha que viene.
  function estadoLugar(tipo, planta, cicloInicio) {
    const done = ultimaCompletada(tipo, planta);
    const last = done ? parseYmd(done.fecha) : null;
    return { hecho: !!(last && last > cicloInicio), encargado: done ? done.encargado : null };
  }

  // Días HÁBILES desde hoy hasta target (0 si es hoy o ya pasó -> urgente).
  function bizDiasHasta(target) {
    const hoy = hoyDate();
    if (target <= hoy) return 0;
    let n = 0, d = hoy, g = 0;
    while (d < target && g++ < 999) { d = addDias(d, 1); if (!esNoHabil(d)) n++; }
    return n;
  }

  // Cronograma LÍNEA POR LÍNEA. Muestra: (a) cada tanda YA GUARDADA (hecha=verde ✓, o en
  // progreso) y (b) la PRÓXIMA a realizar por tipo (si no hay una en progreso). Todo ordenado
  // por FECHA. La fecha "a realizar" vibra/colorea según urgencia (rojo/naranja/amarillo).
  function renderCronograma() {
    const box = $("cronoBox"); if (!box) return;
    const glob = fechasGlobales(horizonteFechas());   // fechas sin colisión (2 tipos no caen el mismo día)
    const hoy = hoyDate();
    const chip = (tipo, planta, hecho, encargado) => {
      const extra = tipo === "plasticos" ? " " + (PLASTICO_LUGAR[planta] || "") : "";
      return `<span class="crono-chip ${hecho ? "ok" : "falta"}">${esc((ABREV_PLANTA[planta] || planta) + extra)} ${hecho ? "✓" : "✗"}${encargado ? `<span class="crono-enc">${esc(encargado)}</span>` : ""}</span>`;
    };
    const urg = (f) => (f < hoy ? "rojo" : (+f === +hoy ? "naranja" : (bizDiasHasta(f) <= 3 ? "amarillo" : "")));
    const lineas = []; // { fecha: Date, html }

    // (a) Tandas ya guardadas: una línea por grupo.
    const grupos = new Map();
    for (const r of RELS) { const g = r.grupo_id || r.id; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(r); }
    const enProgresoTipo = {};
    for (const [g, rels] of grupos) {
      const tipo = rels[0].tipo, label = TIPO_LABEL[tipo] || tipo;
      const req = PLANTAS_TIPO[tipo] || ["Cervantes"];
      const maxFecha = rels.reduce((m, r) => (r.fecha > m ? r.fecha : m), rels[0].fecha);
      const chips = req.map(p => { const rel = rels.find(r => r.planta === p); return chip(tipo, p, !!(rel && rel.items > 0 && rel.cargados >= rel.items), rel ? rel.encargado : null); }).join("");
      const completo = req.every(p => { const rel = rels.find(r => r.planta === p); return rel && rel.items > 0 && rel.cargados >= rel.items; });
      if (!completo) enProgresoTipo[tipo] = true;
      const est = completo ? "verde" : urg(parseYmd(maxFecha));
      lineas.push({ fecha: parseYmd(maxFecha), done: completo, html:
        `<div class="crono-linea${completo ? " completo" : ""}" data-grupo="${g}" title="Ver el total (por lugar)">
          <div class="cl-tipo">${esc(label)}</div>
          <div class="cl-fecha${est ? " est-" + est : ""}"><span class="cl-lbl">${completo ? "Hecho" : "En progreso"}</span>${fmtFecha(maxFecha)}</div>
          <div class="cl-chips">${chips}</div>
          ${completo ? "" : `<button class="btn btn-green sm cl-btn" data-realizar="${tipo}">Continuar</button>`}
        </div>` });
    }

    // (b) Próxima a realizar por tipo (salvo que ya haya una en progreso).
    TIPOS.filter(t => CRONOGRAMA[t.key]).forEach(t => {
      if (enProgresoTipo[t.key]) return;
      const adj = (glob[t.key] || [])[0]; if (!adj) return;
      const req = PLANTAS_TIPO[t.key] || ["Cervantes"];
      const est = urg(adj);
      const chips = req.map(p => chip(t.key, p, false, null)).join("");
      lineas.push({ fecha: adj, done: false, html:
        `<div class="crono-linea" data-tipo="${t.key}" title="Próximo relevamiento (aún sin cargar)">
          <div class="cl-tipo">${esc(t.label)}</div>
          <div class="cl-fecha${est ? " est-" + est : ""}"><span class="cl-lbl">A realizar</span>${fmtFecha(toYmd(adj))}</div>
          <div class="cl-chips">${chips}</div>
          <button class="btn btn-green sm cl-btn" data-realizar="${t.key}">Realizar</button>
        </div>` });
    });

    // PENDIENTE ("lo que falta") primero, por fecha más próxima; las HECHAS al fondo (más reciente arriba).
    lineas.sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : (a.done ? b.fecha - a.fecha : a.fecha - b.fecha)));
    box.innerHTML = lineas.map(l => l.html).join("") || `<div class="empty">Sin cronograma.</div>`;
  }

  // Calendario en formato MES: grilla con los días; cada día marca los relevamientos
  // programados (grilla fija). La PRÓXIMA de cada tipo se pinta con su color de estado.
  const CAL_MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  const CAL_DOW = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  const CAL_ABBR = { garage: "Garage", remaches: "Remach.", flejes: "Flejes", bombillas: "Bombil.", cajas: "Cajas", plasticos: "Plástic.", cartones: "Cartón" };
  let CAL = { y: 0, m: 0, map: null };

  // Mapa ymd -> [{abbr, est}] con las próximas ocurrencias de cada tipo, ya SIN colisión
  // (mismas fechas que el cronograma: dos relevamientos no caen el mismo día).
  function calcCalMap(glob) {
    const map = {}, hoy = hoyDate();
    TIPOS.filter(t => CRONOGRAMA[t.key]).forEach(t => {
      const px = proximaCervantes(t.key);
      const plantas = PLANTAS_TIPO[t.key] || ["Cervantes"];
      const todosHechos = plantas.every(p => estadoLugar(t.key, p, px.cicloInicio).hecho);
      (glob[t.key] || []).forEach((f, i) => {
        let est = "";
        if (i === 0) {
          if (todosHechos) est = "verde";
          else if (f < hoy) est = "rojo";
          else if (+f === +hoy) est = "naranja";
          else if (bizDiasHasta(f) <= 3) est = "amarillo";
        }
        const ymd = toYmd(f);
        (map[ymd] = map[ymd] || []).push({ abbr: CAL_ABBR[t.key] || t.label, est });
      });
    });
    return map;
  }

  function drawCal() {
    const y = CAL.y, m = CAL.m, hoyY = toYmd(hoyDate());
    const primero = new Date(y, m, 1);
    const offset = (primero.getDay() + 6) % 7;               // 0 = lunes
    const dias = new Date(y, m + 1, 0).getDate();
    const celdas = Math.ceil((offset + dias) / 7) * 7;
    let cells = "";
    for (let i = 0; i < celdas; i++) {
      const dnum = i - offset + 1;
      if (dnum < 1 || dnum > dias) { cells += `<div class="cal-dia cal-vacio"></div>`; continue; }
      const ymd = toYmd(new Date(y, m, dnum));
      const evs = (CAL.map[ymd] || []).map(e => `<span class="cal-ev${e.est ? " est-" + e.est : ""}" title="${esc(e.abbr)}">${esc(e.abbr)}</span>`).join("");
      cells += `<div class="cal-dia${ymd === hoyY ? " cal-hoy" : ""}"><span class="cal-dnum">${dnum}</span>${evs}</div>`;
    }
    $("calBody").innerHTML =
      `<div class="cal-head">
         <button class="cal-nav" data-cal="prev">‹</button>
         <span class="cal-mes">${CAL_MESES[m]} ${y}</span>
         <button class="cal-nav" data-cal="next">›</button>
       </div>
       <div class="cal-dowrow">${CAL_DOW.map(d => `<div class="cal-dow">${d}</div>`).join("")}</div>
       <div class="cal-grid">${cells}</div>`;
  }

  function renderCalendario() {
    const glob = fechasGlobales(horizonteFechas());
    CAL.map = calcCalMap(glob);
    // Empezar en el mes de la próxima fecha más cercana (o el mes actual si no hay).
    const primeras = TIPOS.filter(t => CRONOGRAMA[t.key]).map(t => (glob[t.key] || [])[0]).filter(Boolean);
    const base = primeras.length ? primeras.reduce((a, b) => (a < b ? a : b)) : hoyDate();
    CAL.y = base.getFullYear(); CAL.m = base.getMonth();
    drawCal();
    $("modalCalendario").style.display = "flex";
  }

  // Flujo "Realizar": elegir lugar + encargado -> crea (o retoma) el relevamiento y abre la carga.
  let RZ = { tipo: null };
  function abrirRealizar(tipo) {
    RZ = { tipo };
    $("rzTitulo").textContent = "Realizar — " + (TIPO_LABEL[tipo] || tipo);
    const ps = PLANTAS_TIPO[tipo] || ["Cervantes"];
    $("rzPlanta").innerHTML = ps.map(p => `<option value="${p}">${p}${tipo === "plasticos" ? " (" + (PLASTICO_LUGAR[p] || "") + ")" : ""}</option>`).join("");
    $("rzEncargado").value = "";
    $("rzEncargado").style.borderColor = "";
    $("modalRealizar").style.display = "flex";
    setTimeout(() => $("rzEncargado").focus(), 50);
  }
  function cerrarRealizar() { $("modalRealizar").style.display = "none"; }
  async function confirmarRealizar() {
    const tipo = RZ.tipo, planta = $("rzPlanta").value;
    const encargado = $("rzEncargado").value.trim();
    if (!encargado) { $("rzEncargado").style.borderColor = "#c00"; $("rzEncargado").focus(); return; }
    // No se puede hacer 2 veces el mismo tipo+lugar en el MISMO día.
    const hoy = toYmd(hoyDate());
    const hoyMismo = RELS.find(r => r.tipo === tipo && r.planta === planta && String(r.fecha).slice(0, 10) === hoy);
    if (hoyMismo) {
      const completo = hoyMismo.items > 0 && hoyMismo.cargados >= hoyMismo.items;
      // El de hoy sin terminar se retoma. Si ya está completo, se PERMITE crear otro el mismo día
      // (para poder ver/testear cambios; antes se bloqueaba).
      if (!completo) { cerrarRealizar(); abrirDetalle(hoyMismo.id, false); return; }
    }
    // Si ya hay un relevamiento de este tipo+lugar SIN completar (de otro día), lo retomamos (no duplicar).
    const pendiente = RELS.find(r => r.tipo === tipo && r.planta === planta && !(r.items > 0 && r.cargados >= r.items));
    if (pendiente) { cerrarRealizar(); abrirDetalle(pendiente.id, false); return; }
    // El "ciclo" del tipo abarca TODAS sus plantas (ej. plásticos = Cervantes + Virgilio).
    // Se suma este lugar a la tanda actual mientras el ciclo no esté completo y no tenga ya
    // este lugar; si no, tanda nueva. NO se crea nada en la base todavía: el relevamiento se
    // crea recién al apretar Guardar (guardarTodo). Acá sólo se decide el grupo destino.
    const req = PLANTAS_TIPO[tipo] || [];
    const ult = ultimasTandasPorTipo()[tipo];
    const cicloCompleto = !!ult && req.every(p => { const r = ult.rels.find(x => x.planta === p); return r && r.items > 0 && r.cargados >= r.items; });
    const yaTiene = !!ult && ult.rels.some(r => r.planta === planta);
    const enProgreso = !!ult && !cicloCompleto && !yaTiene;
    cerrarRealizar();
    abrirDetalleNuevo(tipo, planta, encargado, enProgreso ? ult.g : null);
  }

  // Totales y por lugar: por cada tipo x planta muestra la FECHA del último relevamiento (sin columna Total)
  function renderResumen() {
    const box = $("resumenBox");
    // Quedarse con la ÚLTIMA tanda de cada tipo (mayor fecha).
    const ultima = ultimasTandasPorTipo();

    let html = `<table><thead><tr><th>Tipo</th>`;
    for (const p of PLANTAS) html += `<th>${p}</th>`;
    html += `</tr></thead><tbody>`;
    for (const t of TIPOS) {
      const u = ultima[t.key];
      const grpAttr = u ? ` data-grupo="${u.g}" style="cursor:pointer" title="Ver resumen del relevamiento"` : "";
      html += `<tr><td class="tipo"${grpAttr}>${t.label}</td>`;
      for (const p of PLANTAS) {
        const aplica = (PLANTAS_TIPO[t.key] || []).includes(p);
        const rel = u ? u.rels.find(r => r.planta === p) : null;
        let cell = `<span class="muted" title="No aplica">·</span>`, attr = "", cls = "cell";
        if (aplica) {
          if (rel) {
            const completo = rel.items > 0 && rel.cargados >= rel.items;
            cls += completo ? " cell-ok" : " cell-inc";
            const estado = completo ? "Completo" : `Falta terminar (${rel.cargados}/${rel.items})`;
            cell = `${fmtFecha(rel.fecha)}${rel.encargado ? `<div class="enc">${esc(rel.encargado)}</div>` : ""}`;
            attr = ` data-relid="${rel.id}" style="cursor:pointer" title="${estado} — Ver este lugar"`;
          } else {
            // Aplica pero no se cargó este lugar -> falta hacer (rojo).
            cls += " cell-falta";
            cell = `<span class="falta">Falta</span>`;
            attr = ` title="Falta hacer este lugar"`;
          }
        }
        html += `<td class="${cls}"${attr}>${cell}</td>`;
      }
      html += `</tr>`;
    }
    html += `</tbody></table>`;
    box.innerHTML = html;
  }

  // Un "relevamiento" agrupa sus lugares por grupo_id. El total = suma de los lugares.
  function grupoDeRels(rels) {
    const items = rels.reduce((a, r) => a + (r.items || 0), 0);
    const cargados = rels.reduce((a, r) => a + (r.cargados || 0), 0);
    const maxFecha = rels.reduce((m, r) => (r.fecha > m ? r.fecha : m), rels[0].fecha);
    return { rels, tipo: rels[0].tipo, items, cargados, maxFecha, completo: items > 0 && cargados >= items };
  }

  // HTML de una tarjeta de grupo (relevamiento = varios lugares). Se usa en "actual" y en "anteriores".
  function renderGrupoCard(grp) {
    const pct = grp.items ? Math.round((grp.cargados / grp.items) * 100) : 0;
    const chips = grp.rels.slice().sort((a, b) => PLANTAS.indexOf(a.planta) - PLANTAS.indexOf(b.planta)).map(r => {
      const rojo = !(r.items > 0 && r.cargados >= r.items);
      return `<div class="lugar-chip ${rojo ? "incompleto" : "ok"}">
        <span class="lc-info"><b>${esc(r.planta)}</b> <span class="cnt">${r.cargados}/${r.items}</span>
          <span class="lc-fecha">${fmtFecha(r.fecha)}${r.encargado ? " · " + esc(r.encargado) : ""}</span></span>
        <span class="lc-acts">
          <button class="btn btn-ghost sm" data-act="ver-lugar" data-id="${r.id}">Ver</button>
          <button class="btn btn-red sm" data-act="borrar" data-id="${r.id}" title="Borrar este lugar">✕</button>
        </span>
      </div>`;
    }).join("");
    // Botón "Cargar <lugar>" por cada planta que falta cargar (no existe, o existe pero incompleta)
    const pendientes = (PLANTAS_TIPO[grp.tipo] || []).map(p => {
      const rel = grp.rels.find(r => r.planta === p);
      const completo = rel && rel.items > 0 && rel.cargados >= rel.items;
      if (completo) return "";
      if (rel) return `<button class="btn btn-green sm" data-act="editar" data-id="${rel.id}">Cargar ${esc(p)}</button>`;
      return `<button class="btn btn-green sm" data-act="cargar-falta" data-grupo="${grp.g}" data-tipo="${grp.tipo}" data-planta="${esc(p)}">Cargar ${esc(p)}</button>`;
    }).join("");
    return `<div class="grupo ${grp.completo ? "" : "incompleto"}" data-grupo="${grp.g}">
      <div class="grupo-head">
        <span class="tag">${esc(TIPO_LABEL[grp.tipo] || grp.tipo)}</span>
        <span class="fecha">${fmtFecha(grp.maxFecha)}</span>
        <span class="bar"><i style="width:${pct}%"></i></span>
        <span class="prog">${grp.cargados}/${grp.items}${grp.completo ? "" : ` · <b style="color:#c00">incompleto</b>`}</span>
        <span class="rel-actions">
          <button class="btn btn-ghost sm" data-act="ver" data-grupo="${grp.g}">Ver</button>
          ${pendientes}
        </span>
      </div>
      <div class="grupo-lugares" data-grupo="${grp.g}" style="display:none">${chips}</div>
    </div>`;
  }

  function renderList() {
    const boxAct = $("relActual"), boxAnt = $("relList");
    if (!RELS.length) {
      boxAct.innerHTML = `<div class="empty">Todavía no hay relevamientos. Generá uno arriba.</div>`;
      boxAnt.innerHTML = `<div class="empty">No hay relevamientos anteriores.</div>`;
      return;
    }
    // "Actual" = la última tanda de cada tipo (lo mismo que muestra "Último Relevamiento").
    const actualSet = new Set(Object.values(ultimasTandasPorTipo()).map(u => u.g));
    const groups = new Map();
    for (const r of RELS) {
      const g = r.grupo_id || r.id;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    const arr = [...groups.entries()].map(([g, rels]) => Object.assign({ g }, grupoDeRels(rels)));
    arr.sort((a, b) => (a.maxFecha < b.maxFecha ? 1 : a.maxFecha > b.maxFecha ? -1 : b.g - a.g));

    const actuales = arr.filter(grp => actualSet.has(grp.g));
    // En "actual": los COMPLETADOS van al final (los que faltan terminar, primero). Sort estable: conserva el orden por fecha dentro de cada grupo.
    actuales.sort((a, b) => (a.completo === b.completo ? 0 : a.completo ? 1 : -1));
    const anteriores = arr.filter(grp => !actualSet.has(grp.g));
    boxAct.innerHTML = actuales.length ? actuales.map(renderGrupoCard).join("") : `<div class="empty">No hay relevamiento actual.</div>`;
    boxAnt.innerHTML = anteriores.length ? anteriores.map(renderGrupoCard).join("") : `<div class="empty">No hay relevamientos anteriores.</div>`;
  }

  // ---------------------------------------------------------------------------
  // NUEVO
  // ---------------------------------------------------------------------------
  function initNuevo() {
    const selT = $("nvTipo"), selP = $("nvPlanta");
    selT.innerHTML = TIPOS.map(t => `<option value="${t.key}">${t.label}</option>`).join("");
    const refreshPlantas = () => {
      const tipo = selT.value;
      const ps = PLANTAS_TIPO[tipo] || ["Cervantes"];
      selP.innerHTML = ps.map(p => `<option value="${p}">${p}</option>`).join("");
    };
    selT.addEventListener("change", refreshPlantas);
    refreshPlantas();
    $("nvFecha").value = new Date().toISOString().slice(0, 10);
    $("btnGenerar").addEventListener("click", generar);
  }

  async function generar() {
    const tipo = $("nvTipo").value, planta = $("nvPlanta").value;
    const fecha = $("nvFecha").value || new Date().toISOString().slice(0, 10);
    const encargado = $("nvEncargado").value.trim();
    if (!encargado) { showMsg("El encargado es obligatorio.", "err"); $("nvEncargado").focus(); return; }
    // Evitar duplicado exacto (tipo+planta+fecha)
    if (RELS.some(r => r.tipo === tipo && r.planta === planta && r.fecha === fecha)) {
      if (!confirm("Ya existe un relevamiento de " + TIPO_LABEL[tipo] + " en " + planta + " para esa fecha. ¿Generar otro igual?")) return;
    }
    const btn = $("btnGenerar"); btn.disabled = true;
    const { data, error } = await sb.rpc("rc_generar", { p_tipo: tipo, p_planta: planta, p_fecha: fecha, p_encargado: encargado });
    btn.disabled = false;
    if (error) { showMsg("No se pudo generar (¿estás logueado?): " + error.message, "err"); return; }
    showMsg("Relevamiento generado.", "ok");
    await cargarLista();
    abrirDetalle(data);
  }

  // ---------------------------------------------------------------------------
  // ACCIONES lista
  // ---------------------------------------------------------------------------
  async function onListClick(e) {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const act = b.dataset.act;
    if (act === "ver") {
      const g = Number(b.dataset.grupo);
      const rels = RELS.filter(r => (r.grupo_id || r.id) === g);
      if (rels.length === 1) { abrirDetalle(rels[0].id, true); return; } // 1 lugar: solo lectura directo
      abrirCombinado(g); return; // varios lugares: vista por lugar + total
    }
    if (act === "cargar-falta") { abrirAgregar(Number(b.dataset.grupo), b.dataset.tipo, b.dataset.planta); return; }
    const id = Number(b.dataset.id);
    if (act === "ver-lugar") { abrirDetalle(id, true); return; }   // solo lectura
    if (act === "editar") { abrirDetalle(id, false); return; }     // editable
    if (act === "borrar") {
      const r = RELS.find(x => x.id === id);
      if (!confirm(`¿Borrar el lugar ${r.planta} del relevamiento de ${TIPO_LABEL[r.tipo]} (${fmtFecha(r.fecha)})? Se pierde su conteo.`)) return;
      const { error } = await sb.rpc("rc_borrar", { p_relevamiento_id: id });
      if (error) { showMsg("No se pudo borrar: " + error.message, "err"); return; }
      showMsg("Lugar borrado.", "ok"); cargarLista(); return;
    }
  }
  // (Listas "actual"/"anteriores" removidas: el cronograma es la vista única.)

  // ---------------------------------------------------------------------------
  // AGREGAR LUGAR (otro lugar al mismo relevamiento, con su encargado y fecha)
  // ---------------------------------------------------------------------------
  let AG = { grupo: null, tipo: null };
  function abrirAgregar(grupo, tipo, prePlanta) {
    AG = { grupo, tipo };
    const enGrupo = RELS.filter(r => (r.grupo_id || r.id) === grupo).map(r => r.planta);
    const faltan = (PLANTAS_TIPO[tipo] || []).filter(p => !enGrupo.includes(p));
    if (!faltan.length) { showMsg("Ya están todos los lugares en ese relevamiento.", "ok"); return; }
    $("agTitulo").textContent = `Cargar ${prePlanta || "lugar"} — ${TIPO_LABEL[tipo] || tipo}`;
    $("agPlanta").innerHTML = faltan.map(p => `<option value="${p}"${p === prePlanta ? " selected" : ""}>${p}</option>`).join("");
    $("agFecha").value = new Date().toISOString().slice(0, 10);
    $("agEncargado").value = "";
    $("modalAgregar").style.display = "flex";
    $("agEncargado").focus();
  }
  function cerrarAgregar() { $("modalAgregar").style.display = "none"; }

  async function confirmarAgregar() {
    const planta = $("agPlanta").value;
    const fecha = $("agFecha").value || new Date().toISOString().slice(0, 10);
    const encargado = $("agEncargado").value.trim();
    if (!encargado) { $("agEncargado").focus(); $("agEncargado").style.borderColor = "#c00"; return; }
    const btn = $("agConfirmar"); btn.disabled = true;
    const { data, error } = await sb.rpc("rc_agregar_lugar", { p_grupo_id: AG.grupo, p_planta: planta, p_fecha: fecha, p_encargado: encargado });
    btn.disabled = false;
    if (error) { showMsg("No se pudo agregar el lugar: " + error.message, "err"); return; }
    cerrarAgregar();
    showMsg(`Lugar ${planta} agregado.`, "ok");
    await cargarLista();
    abrirDetalle(data);
  }

  // ---------------------------------------------------------------------------
  // DETALLE (carga de conteo)
  // ---------------------------------------------------------------------------
  let DET = { rel: null, rows: [], cols: [], dirty: new Set() };
  let COMB = {}; // datos de la vista combinada para el popup de composición

  async function abrirDetalle(relId, readonly, onBack) {
    const rel = RELS.find(x => x.id === relId) || (await refetchRel(relId));
    if (!rel) { showMsg("No se encontró el relevamiento.", "err"); return; }
    const { data, error } = await sb
      .from("v_rc_detalle").select("*")
      .eq("relevamiento_id", relId)
      .order("orden", { ascending: true });
    if (error) { showMsg("Error leyendo detalle: " + error.message, "err"); return; }
    const filas = (data || []).slice().sort(cmpSectorRow);  // ordenado por sector (remaches: por crudo)
    DET = { rel, rows: filas, cols: colsFor(rel.tipo, rel.planta), dirty: new Set(), readonly: !!readonly, onBack: onBack || null, rollos: {} };
    // Flejes: cargar el desglose de rollos guardado (para reabrir las tandas sin combinar).
    filas.forEach(row => {
      const rj = row.conteo && row.conteo.rollos_json;
      if (Array.isArray(rj) && rj.length) DET.rollos[row.det_id] = rj;
    });
    pintarDetalle();
  }

  // Tail de render de la tabla de carga (compartido por abrirDetalle y abrirDetalleNuevo).
  function pintarDetalle() {
    const { rel, readonly } = DET;
    $("vistaLista").style.display = "none";
    $("vistaDetalle").style.display = "";
    $("detTitulo").textContent = `${TIPO_LABEL[rel.tipo]} · ${rel.planta} · ${fmtFecha(rel.fecha)}${rel.encargado ? " · " + rel.encargado : ""}${readonly ? " · (solo ver)" : (rel.nuevo ? " · (nuevo — se guarda al apretar Guardar)" : "")}`;
    $("btnGuardar").style.display = readonly ? "none" : "";
    $("guardarBottomWrap").style.display = readonly ? "none" : "";
    $("detUnsaved").style.display = readonly ? "none" : "";
    $("btnExcelFlejes").classList.toggle("hidden", !(rel.tipo === "flejes" && rel.planta === "Cervantes"));
    $("detLugares").style.display = "none";
    renderDetalle();
    updateGuardarState();
  }

  // Abrir un relevamiento NUEVO sin crearlo en la base: la tabla se arma desde el catálogo
  // (v_rc_catalogo). El relevamiento se crea recién al apretar Guardar (ver guardarTodo).
  async function abrirDetalleNuevo(tipo, planta, encargado, grupoId) {
    const { data, error } = await sb.from("v_rc_catalogo").select("*").eq("tipo", tipo).order("orden", { ascending: true });
    if (error) { showMsg("Error leyendo el catálogo: " + error.message, "err"); return; }
    let filas = data || [];
    if (tipo === "plasticos") filas = filas.filter(r => planta === "Cervantes" ? r.en_cervantes : (planta === "Virgilio" ? r.en_virgilio : true));
    filas = filas.map(r => ({ det_id: -r.cat_id, cat_id: r.cat_id, relevamiento_id: null, tipo, orden: r.orden, descripcion: r.descripcion, sector: r.sector, info: r.info, conteo: {}, cargado: false })).sort(cmpSectorRow);
    const rel = { id: null, nuevo: true, grupoId: grupoId || null, tipo, planta, fecha: toYmd(hoyDate()), encargado, items: filas.length, cargados: 0 };
    DET = { rel, rows: filas, cols: colsFor(tipo, planta), dirty: new Set(), readonly: false, onBack: null, rollos: {} };
    pintarDetalle();
  }

  async function refetchRel(relId) {
    const { data } = await sb.from("v_rc_relevamientos").select("*").eq("id", relId).maybeSingle();
    return data || null;
  }

  // ---------------------------------------------------------------------------
  // VISTA COMBINADA (solo lectura): por cada pieza, el valor de cada lugar + el total
  // ---------------------------------------------------------------------------
  async function abrirCombinado(grupoId) {
    const rels = RELS.filter(r => (r.grupo_id || r.id) === grupoId)
      .slice().sort((a, b) => PLANTAS.indexOf(a.planta) - PLANTAS.indexOf(b.planta));
    if (!rels.length) return;
    const ids = rels.map(r => r.id);
    const { data, error } = await sb.from("v_rc_detalle").select("*")
      .in("relevamiento_id", ids).order("relevamiento_id", { ascending: true }).order("orden", { ascending: true });
    if (error) { showMsg("Error leyendo detalle: " + error.message, "err"); return; }
    // Alinear por ITEM del catálogo (cat_id), no por posición: en plásticos cada lugar
    // (Cervantes=partes, Virgilio=bolsas) tiene su propia lista y no coinciden por índice.
    const relPlanta = {}; rels.forEach(r => relPlanta[r.id] = r.planta);
    const byItem = new Map(); const items = [];
    (data || []).forEach(row => {
      let it = byItem.get(row.cat_id);
      if (!it) {
        it = { cat_id: row.cat_id, ident: { descripcion: row.descripcion, sector: row.sector, info: row.info }, sort: { sector: row.sector, orden: row.orden }, porLugar: {} };
        byItem.set(row.cat_id, it); items.push(it);
      }
      it.porLugar[relPlanta[row.relevamiento_id]] = row.conteo;
    });
    // Cada item sin dato en algún lugar -> conteo vacío; ordenar por SECTOR (natural).
    items.forEach(it => rels.forEach(rel => { if (!(rel.planta in it.porLugar)) it.porLugar[rel.planta] = {}; }));
    items.sort((a, b) => cmpSector(a.sort, b.sort));
    DET = { rel: rels[0], rows: [], cols: [], dirty: new Set(), readonly: true, combined: true };
    $("vistaLista").style.display = "none";
    $("vistaDetalle").style.display = "";
    const maxFecha = rels.reduce((m, r) => (r.fecha > m ? r.fecha : m), rels[0].fecha);
    $("detTitulo").textContent = `${TIPO_LABEL[rels[0].tipo]} · Total por lugar · ${fmtFecha(maxFecha)}`;
    $("btnGuardar").style.display = "none";
    $("guardarBottomWrap").style.display = "none";
    $("detUnsaved").style.display = "none";
    $("detProg").textContent = `${rels.length} lugares`;
    // toolbar por lugar (ver detalle / borrar)
    $("detLugares").innerHTML = rels.map(r => {
      const rojo = !(r.items > 0 && r.cargados >= r.items);
      return `<span class="lug-tag ${rojo ? "incompleto" : "ok"}"><b>${esc(r.planta)}</b> <span class="cnt">${r.cargados}/${r.items}</span>
        <button class="btn btn-ghost sm" data-act="ver-lugar" data-id="${r.id}">Detalle</button></span>`;
    }).join("");
    $("detLugares").style.display = "flex";
    renderCombinado(rels[0].tipo, rels, items);
  }

  function renderCombinado(tipo, rels, items) {
    COMB = { tipo, rels, items };
    $("detTable").classList.add("combined");
    const info = INFO_COLS[tipo] || [];
    const showDesc = !HIDE_DESC[tipo];
    const unit = BASE_UNIT[tipo] || "";
    let head = "<tr>";
    if (showDesc) head += '<th class="desc-col">Descripción</th>';
    head += "<th>Sector</th>";
    info.forEach(([, lbl]) => head += `<th>${titleBreak(lbl)}</th>`);
    rels.forEach(r => head += `<th>${esc(ABREV_PLANTA[r.planta] || r.planta)}</th>`);
    head += `<th>${titleBreak(`Total${unit ? ` (${unit})` : ""}`)}</th></tr>`;
    $("detHead").innerHTML = head;

    const body = items.map((it, idx) => {
      let tds = "";
      if (showDesc) tds += `<td class="desc-col">${tipo === "plasticos" ? wrapBreak(it.ident.descripcion, 10) : esc(it.ident.descripcion)}</td>`;
      tds += `<td style="font-weight:800;font-size:22px">${esc(it.ident.sector)}</td>`;
      info.forEach(([k]) => { const raw = it.ident.info ? it.ident.info[k] : ""; tds += `<td style="font-weight:800;font-size:22px">${k === "cod" ? dashBreak(raw) : titleBreak(raw)}</td>`; });
      let sum = 0;
      rels.forEach(r => {
        const v = aporteBase(tipo, r.planta, it.porLugar[r.planta], it.ident.info);
        sum += v;
        // Celda clickable -> popup de composición (cómo se calculó el valor de ese lugar).
        tds += `<td class="num comp-cell" data-i="${idx}" data-planta="${esc(r.planta)}" title="Ver composición">${fmtNum(v, tipo)}</td>`;
      });
      tds += `<td class="num" style="font-weight:800">${fmtNum(sum, tipo)}</td>`;
      return `<tr>${tds}</tr>`;
    }).join("");
    // Sin fila de TOTAL general: sumar piezas distintas no tiene sentido. El "Total" por fila = misma pieza entre lugares.
    $("detBody").innerHTML = body;
    fitDescCombinada();
    ajustarAnchoTabla();
  }

  // Zoom minimo: la letra no se achica por debajo de esto. Si la tabla no entra a este tamaño,
  // primero se ENVUELVE la descripcion (columna flexible); el zoom es el ultimo recurso.
  const MIN_ZOOM = 0.72;

  // Ajusta la tabla para que ENTRE COMPLETA a lo ancho del contenedor (sin scroll horizontal),
  // sin bajar la letra de MIN_ZOOM (para eso la descripcion ya se angosto antes).
  function ajustarAnchoTabla() {
    const t = $("detTable"); if (!t) return;
    const wrap = t.closest(".tbl-scroll"); if (!wrap) return;
    t.style.zoom = "1";
    const avail = wrap.clientWidth, need = t.scrollWidth;
    if (need > 0 && avail > 0 && need > avail) t.style.zoom = String(Math.max(MIN_ZOOM, (avail - 1) / need));
  }

  // Vista combinada: angosta la columna Descripcion (envolviendo el texto) hasta que la tabla
  // entre a lo ancho, para no tener que achicar la letra. Minimo 90px de ancho de descripcion.
  function fitDescCombinada() {
    const t = $("detTable"); const wrap = t && t.closest(".tbl-scroll"); if (!wrap) return;
    const cells = t.querySelectorAll(".desc-col"); if (!cells.length) return;
    const avail = wrap.clientWidth; if (!avail) return;
    const setW = w => cells.forEach(el => {
      el.style.whiteSpace = "normal"; el.style.wordBreak = "break-word";
      el.style.width = w == null ? "" : (w + "px"); el.style.maxWidth = w == null ? "" : (w + "px");
    });
    setW(null);
    if (t.scrollWidth <= avail) return; // ya entra
    let w = 300, guard = 0; setW(w);
    while (t.scrollWidth > avail && w > 90 && guard++ < 60) { w -= 10; setW(w); }
  }

  function renderDetalle() {
    $("detTable").classList.remove("combined");
    const { rel, rows, cols } = DET;
    const info = INFO_COLS[rel.tipo] || [];
    const comps = computedFor(rel.tipo, rel.planta);
    // Remaches: Sector y S.Crudo más chicos (letra 15px) para dar más lugar a Descripción.
    const compact = rel.tipo === "remaches";

    // Columnas congeladas lateralmente (identificadores): Descripción + Sector + info
    // Ancho de Sector = al máximo de caracteres del contenido (mín. 5), con la letra grande del contenido (22px).
    const secLens = rows.map(r => String(r.sector == null ? "" : r.sector).length);
    // El ancho se calcula por el CONTENIDO (no por el encabezado). En compact (remaches) el piso baja.
    const maxSec = Math.max(compact ? 3 : 5, secLens.length ? Math.max.apply(null, secLens) : 3);
    // Plasticos: la descripcion se corta por palabra al pasar 10 chars -> ancho natural = a la linea mas larga.
    const descChunk = rel.tipo === "plasticos";
    let W_DESC_NAT = 165;
    if (descChunk) {
      const maxLine = rows.reduce((m, r) => { const ls = wrapLines(r.descripcion, 10); return ls.reduce((mm, l) => Math.max(mm, l.length), m); }, 8);
      W_DESC_NAT = Math.min(210, Math.max(90, maxLine * 10 + 18));
    }
    const W_SECTOR = compact ? Math.min(110, maxSec * 11 + 12) : Math.min(190, maxSec * 15 + 20);
    // Ancho de cada columna de info = al token mas largo (tras partir en espacio/guion, ya que el contenido va en doble linea).
    const wInfo = (k, lbl) => {
      const toks = [];
      // En compact (remaches) el ancho va SOLO por el contenido, no por el encabezado.
      if (!compact) String(lbl == null ? "" : lbl).split(/[\s-]+/).forEach(t => toks.push(t.length));
      rows.forEach(r => { const v = String((r.info && r.info[k] != null) ? r.info[k] : ""); v.split(k === "cod" ? "-" : /\s+/).forEach(t => toks.push(t.length)); });
      const max = Math.max(3, toks.length ? Math.max.apply(null, toks) : 3);
      return Math.min(compact ? 92 : 140, max * (compact ? 11 : 14) + (compact ? 12 : 18));
    };
    // Anchos de columnas de conteo/calculadas (input 82 + padding; +tandas).
    const cW = c => (c.tandas ? 150 : 104);
    const compW = 104;
    // Boton "0" (poner el renglon en cero) en relevamientos de mas de 1 input o por tandas.
    const showZero = !DET.readonly && (cols.length > 1 || cols.some(c => c.tandas));
    const W_ZERO = 60;

    // La DESCRIPCION es la columna FLEXIBLE: toma el ancho que sobra para que la tabla entre a lo
    // ancho SIN achicar la letra (envuelve el texto en mas lineas). Minimo legible 90px.
    const otrasW = W_SECTOR + info.reduce((a, [k, lbl]) => a + wInfo(k, lbl), 0) + cols.reduce((a, c) => a + cW(c), 0) + comps.length * compW + (showZero ? W_ZERO : 0);
    const wrapEl0 = $("detTable").closest(".tbl-scroll");
    const avail0 = wrapEl0 ? wrapEl0.clientWidth : 0;
    let W_DESC = W_DESC_NAT;
    if (!HIDE_DESC[rel.tipo] && avail0 > 0) {
      const sobra = avail0 - otrasW - 8;
      W_DESC = Math.max(90, Math.min(W_DESC_NAT, sobra));
    }

    // Columnas congeladas lateralmente (identificadores). Descripción es opcional (se oculta en cajas).
    const fcols = [];
    if (!HIDE_DESC[rel.tipo]) fcols.push({ w: W_DESC, head: "Descripción", cls: "desc", val: r => descChunk ? wrapBreak(r.descripcion, 10) : esc(r.descripcion) });
    fcols.push({ w: W_SECTOR, head: "Sector", big: true, val: r => esc(r.sector) });
    info.forEach(([k, lbl]) => fcols.push({ w: wInfo(k, lbl), head: lbl, big: true, val: r => (k === "cod") ? dashBreak(r.info ? r.info[k] : "") : titleBreak(r.info ? r.info[k] : "") }));
    let accL = 0; fcols.forEach(f => { f.left = accL; accL += f.w; });
    const lastFz = fcols.length - 1;
    const fz = (f, i, head) => {
      let s = `position:sticky;left:${f.left}px;width:${f.w}px;min-width:${f.w}px;max-width:${f.w}px;white-space:normal;word-break:break-word;line-height:1.15;background:${head ? "#e9eef3" : "#fff"};z-index:${head ? 6 : 2};`;
      if (head) s += "top:0;";
      if (!head && f.big) s += `font-size:${compact ? 15 : 22}px;font-weight:700;`;
      if (!head && f.cls === "desc") s += "font-size:16px;"; // descripción un poco más grande
      if (i === lastFz) s += "border-right:2px solid #111;";
      return s;
    };

    let head = "<tr>";
    fcols.forEach((f, i) => head += `<th style="${fz(f, i, true)}">${titleBreak(f.head)}</th>`);
    for (const c of cols) head += `<th style="text-align:center;width:${cW(c)}px;min-width:${cW(c)}px">${titleBreak(c.label)}</th>`;
    for (const c of comps) head += `<th style="text-align:center;width:${compW}px;min-width:${compW}px">${titleBreak(c.label)}</th>`;
    if (showZero) head += `<th style="text-align:center;width:${W_ZERO}px;min-width:${W_ZERO}px" title="Sin stock">0</th>`;
    head += `</tr>`;
    $("detHead").innerHTML = head;

    $("detBody").innerHTML = rows.map(r => {
      let froz = fcols.map((f, i) => `<td class="${f.cls || ""}" style="${fz(f, i, false)}">${f.val(r)}</td>`).join("");
      const inputs = cols.map(c => {
        const v = r.conteo && r.conteo[c.key] != null ? r.conteo[c.key] : "";
        const tb = (c.tandas && !DET.readonly) ? `<button class="ci-tandas" data-det="${r.det_id}" data-key="${c.key}" type="button" title="Cargar por tandas">T</button>` : "";
        // Flejes Cervantes: el Total Kg NO se tipea, solo se carga por tandas (input readonly, se llena con "T").
        const ro = (c.flejeTandas && !DET.readonly);
        return `<td style="text-align:center;white-space:nowrap;width:${cW(c)}px;min-width:${cW(c)}px"><input class="ci${ro ? " ci-tanda-only" : ""}" data-det="${r.det_id}" data-key="${c.key}" type="number" inputmode="decimal" step="any" value="${esc(v)}"${DET.readonly ? " disabled" : ""}${ro ? ' readonly title="Cargar por tandas (botón T)"' : ""}>${tb}</td>`;
      }).join("");
      const compCells = comps.map(c =>
        `<td class="computed" data-key="${c.key}" style="text-align:center;font-weight:800;color:#0a7a2f;width:${compW}px;min-width:${compW}px">${esc(c.compute(r.conteo || {}))}</td>`
      ).join("");
      // Boton "0": pone TODO el renglón en cero (sin stock). Solo cuando showZero.
      const zeroCell = showZero ? `<td style="text-align:center;width:${W_ZERO}px;min-width:${W_ZERO}px"><button class="ci-zero" data-det="${r.det_id}" type="button" title="Sin stock (poner el renglón en 0)">0</button></td>` : "";
      // En solo-lectura la fila es clickable -> popup de composición de esa pieza.
      return `<tr data-det="${r.det_id}" class="${r.cargado ? "loaded" : ""}${DET.readonly ? " ro-row" : ""}"${DET.readonly ? ' title="Ver composición"' : ""}>${froz}${inputs}${compCells}${zeroCell}</tr>`;
    }).join("");
    if (PAIR_VALID[rel.tipo]) document.querySelectorAll("#detBody tr").forEach(marcarErroresPar);
    updateProg();
    ajustarAnchoTabla();
  }

  // Al cambiar el tamaño de la ventana, reajustar la tabla si el detalle está visible.
  let _rzT = null;
  window.addEventListener("resize", () => {
    if ($("vistaDetalle").style.display === "none") return;
    clearTimeout(_rzT); _rzT = setTimeout(() => { if (DET.combined) fitDescCombinada(); ajustarAnchoTabla(); }, 120);
  });

  function updateProg() {
    const total = DET.rows.length;
    const cargados = DET.rows.filter(r => r.cargado).length;
    $("detProg").textContent = `${cargados}/${total} cargados`;
  }

  // SIN autoguardado: al tocar un input se marca la fila como "sin guardar" y se recalculan las columnas calculadas en vivo
  $("detBody").addEventListener("input", (e) => {
    const inp = e.target.closest("input.ci"); if (!inp) return;
    const tr = inp.closest("tr");
    DET.dirty.add(Number(inp.dataset.det));
    tr.classList.add("dirty");
    const comps = computedFor(DET.rel.tipo, DET.rel.planta);
    if (comps.length) {
      const vals = {};
      tr.querySelectorAll("input.ci").forEach(i => { vals[i.dataset.key] = i.value.trim(); });
      comps.forEach(c => { const cell = tr.querySelector(`td.computed[data-key="${c.key}"]`); if (cell) cell.textContent = c.compute(vals); });
    }
    marcarErroresPar(tr);
    updateGuardarState();
  });

  // Abre el popup de tandas para una celda. Uni sueltas (cajas/cartones) -> suma de unidades.
  // Flejes Cervantes (Total Kg) -> cada tanda es Cant rollos x Kg c/u; el total ponderado cae en el input.
  function abrirTandasDet(detId, key) {
    const inp = document.querySelector(`#detBody input.ci[data-det="${detId}"][data-key="${key}"]`);
    if (!inp || !window.tandasPopup) return;
    const col = (DET.cols || []).find(c => c.key === key) || {};
    const cur = parseFloat(String(inp.value).replace(",", ".")) || 0;
    if (col.flejeTandas) {
      const detNum = Number(detId);
      // El desglose real de rollos si ya se cargó; si no hay pero sí un total viejo, un solo rollo como respaldo.
      const guardado = DET.rollos && DET.rollos[detNum];
      const initial = (Array.isArray(guardado) && guardado.length)
        ? guardado.map(t => ({ caj: t.caj, kg: t.kg }))
        : (cur > 0 ? [{ caj: 1, kg: cur }] : []);
      window.tandasPopup.open({
        titulo: "Tandas — Rollos (Cant × Kg c/u)",
        pedirCaj: true, pedirKg: true, pedirUni: false, multiplicar: true,
        exigirCompletos: true, grande: true,
        unidadCaj: "Cant rollos", unidadKg: "Kg c/u",
        initial,
        onConfirm: (tandas, totales) => {
          // Guardar el desglose (cada rollo con su cant y kg) para que no se combinen al reabrir.
          if (DET.rollos) DET.rollos[detNum] = tandas.map(t => ({ caj: Number(t.caj) || 0, kg: parseFloat(String(t.kg).replace(",", ".")) || 0 }));
          inp.value = totales.kg ? (Math.round(totales.kg * 1000) / 1000) : "";
          inp.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      return;
    }
    // Cajas/Cartones: la tanda carga LOS 2 INPUTS (Paquetes + Uni sueltas); cada suma cae en su input.
    if (col.tandasPaqKey) {
      const inpPaq = document.querySelector(`#detBody input.ci[data-det="${detId}"][data-key="${col.tandasPaqKey}"]`);
      const curPaq = inpPaq ? (parseFloat(String(inpPaq.value).replace(",", ".")) || 0) : 0;
      window.tandasPopup.open({
        titulo: `Tandas — ${col.tandasPaqLabel} + Uni sueltas`,
        pedirCaj: true, pedirKg: false, pedirUni: true, grande: true,
        unidadCaj: col.tandasPaqLabel, unidadUni: "Uni sueltas",
        initial: (curPaq > 0 || cur > 0) ? [{ caj: curPaq, uni: cur }] : [],
        onConfirm: (t, totales) => {
          if (inpPaq) { inpPaq.value = totales.caj || ""; inpPaq.dispatchEvent(new Event("input", { bubbles: true })); }
          inp.value = totales.uni || "";
          inp.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
      return;
    }
    window.tandasPopup.open({
      titulo: "Tandas — Uni sueltas",
      pedirCaj: false, pedirKg: false, pedirUni: true, unidadUni: "uni", grande: true,
      initial: cur > 0 ? [{ uni: cur }] : [],
      onConfirm: (t, totales) => {
        inp.value = totales.uni || "";
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  }

  // "T" o clic sobre el input de solo-tandas (flejes) abren el popup.
  $("detBody").addEventListener("click", (e) => {
    // Boton "0": poner TODO el renglón en cero (sin stock). Flejes: además limpia los rollos.
    const z = e.target.closest(".ci-zero");
    if (z) {
      const tr = z.closest("tr"); if (!tr) return;
      if (DET.rollos) DET.rollos[Number(z.dataset.det)] = [];
      tr.querySelectorAll("input.ci").forEach(i => { i.value = "0"; i.dispatchEvent(new Event("input", { bubbles: true })); });
      return;
    }
    const b = e.target.closest(".ci-tandas");
    if (b) { abrirTandasDet(b.dataset.det, b.dataset.key); return; }
    const inp = e.target.closest("input.ci-tanda-only");
    if (inp && !DET.readonly) abrirTandasDet(inp.dataset.det, inp.dataset.key);
  });

  // Composición: click en celda de la vista combinada (por lugar) o en fila del detalle solo-lectura.
  $("detBody").addEventListener("click", (e) => {
    if (DET.combined) {
      const cell = e.target.closest("td.comp-cell"); if (!cell) return;
      const it = (COMB.items || [])[Number(cell.dataset.i)]; if (!it) return;
      const planta = cell.dataset.planta;
      mostrarComposicion(COMB.tipo, planta, it.ident.info, it.porLugar[planta], it.ident.descripcion, it.ident.sector);
      return;
    }
    if (DET.readonly) {
      const tr = e.target.closest("tr[data-det]"); if (!tr) return;
      const row = DET.rows.find(r => r.det_id === Number(tr.dataset.det)); if (!row) return;
      mostrarComposicion(DET.rel.tipo, DET.rel.planta, row.info, row.conteo, row.descripcion, row.sector);
    }
  });
  $("compCerrar").addEventListener("click", cerrarComposicion);
  $("modalComp").addEventListener("click", (e) => { if (e.target.id === "modalComp") cerrarComposicion(); });

  // Cuenta renglones sin ningún dato y pares incompletos (flejes) en el estado actual de la tabla.
  function estadoCarga() {
    const trs = document.querySelectorAll("#detBody tr");
    const checkPairs = !!PAIR_VALID[DET.rel && DET.rel.tipo];
    let sinDato = 0, errPar = 0;
    trs.forEach(tr => {
      const algun = Array.from(tr.querySelectorAll("input.ci")).some(i => i.value.trim() !== "");
      if (!algun) sinDato++;
      if (checkPairs && marcarErroresPar(tr).length) errPar++;
    });
    return { sinDato, errPar };
  }

  // Guardar SOLO se habilita cuando el lugar está completo (todos los renglones con dato y sin pares a medias).
  function updateGuardarState() {
    const btns = [$("btnGuardar"), $("btnGuardarBottom")], ind = $("detUnsaved");
    if (DET.readonly) { btns.forEach(b => { if (b) b.disabled = true; }); if (ind) ind.textContent = ""; return; }
    const n = DET.dirty.size;
    const { sinDato, errPar } = estadoCarga();
    const completo = sinDato === 0 && errPar === 0;
    btns.forEach(btn => {
      if (!btn) return;
      btn.disabled = !(completo && n > 0);
      btn.textContent = n ? `Guardar (${n})` : "Guardar";
      btn.title = completo ? "" : "Completá todos los renglones para poder guardar";
    });
    // "Atrás" (abajo): se habilita solo cuando está todo guardado (completo y sin cambios pendientes).
    const back = $("btnAtrasBottom");
    if (back) { back.disabled = !(completo && n === 0); back.title = back.disabled ? "Guardá para poder salir" : ""; }
    if (ind) {
      if (sinDato) ind.textContent = `Faltan ${sinDato} renglón${sinDato === 1 ? "" : "es"}`;
      else if (errPar) ind.textContent = `${errPar} par${errPar === 1 ? "" : "es"} incompleto${errPar === 1 ? "" : "s"}`;
      else ind.textContent = n ? `${n} sin guardar` : "";
    }
  }

  async function guardarTodo() {
    if (!DET.dirty.size) return;
    const btn = $("btnGuardar"); btn.disabled = true;
    // GUARDADO DIFERIDO: si el relevamiento es nuevo, recién ahora se crea en la base
    // (al apretar Guardar). Antes no existía ninguna fila -> no quedan relevamientos vacíos.
    let creadoAhora = false;
    if (DET.rel.nuevo) {
      const r = DET.rel;
      const { data: newId, error: cErr } = r.grupoId
        ? await sb.rpc("rc_agregar_lugar", { p_grupo_id: r.grupoId, p_planta: r.planta, p_fecha: r.fecha, p_encargado: r.encargado })
        : await sb.rpc("rc_generar", { p_tipo: r.tipo, p_planta: r.planta, p_fecha: r.fecha, p_encargado: r.encargado });
      if (cErr || newId == null) { showMsg("No se pudo crear el relevamiento (¿estás logueado?): " + (cErr ? cErr.message : ""), "err"); btn.disabled = false; return; }
      // Mapear cat_id -> det_id real del relevamiento recién creado.
      const { data: nd, error: ndErr } = await sb.from("v_rc_detalle").select("det_id,cat_id").eq("relevamiento_id", newId).order("cat_id", { ascending: true });
      if (ndErr) { showMsg("Error preparando el relevamiento: " + ndErr.message, "err"); btn.disabled = false; return; }
      const byCat = {}; (nd || []).forEach(x => byCat[x.cat_id] = x.det_id);
      const nuevoDirty = new Set(), nuevoRollos = {};
      DET.rows.forEach(row => {
        const real = byCat[row.cat_id]; if (real == null) return;
        const old = row.det_id;
        const tr = document.querySelector(`#detBody tr[data-det="${old}"]`); if (tr) tr.dataset.det = real;
        if (DET.dirty.has(old)) nuevoDirty.add(real);
        if (DET.rollos[old]) nuevoRollos[real] = DET.rollos[old];
        row.det_id = real; row.relevamiento_id = newId;
      });
      DET.dirty = nuevoDirty; DET.rollos = nuevoRollos;
      DET.rel.id = newId; DET.rel.nuevo = false; creadoAhora = true;
    }
    const comps = computedFor(DET.rel.tipo, DET.rel.planta);
    let ok = 0, fail = 0, invalid = 0;
    for (const detId of [...DET.dirty]) {
      const tr = document.querySelector(`#detBody tr[data-det="${detId}"]`);
      if (!tr) { DET.dirty.delete(detId); continue; }
      if (marcarErroresPar(tr).length) { invalid++; continue; } // par incompleto: no se guarda
      const vals = {};
      tr.querySelectorAll("input.ci").forEach(i => { vals[i.dataset.key] = i.value.trim(); });
      comps.forEach(c => { vals[c.key] = c.compute(vals); });
      // Flejes: adjuntar el desglose de rollos (array de {caj,kg}) o null si se vació.
      DET.cols.forEach(c => { if (c.flejeTandas) vals.rollos_json = (DET.rollos && DET.rollos[detId] && DET.rollos[detId].length) ? DET.rollos[detId] : null; });
      tr.classList.add("saving");
      const { error } = await sb.rpc("rc_set_conteo", { p_tipo: DET.rel.tipo, p_det_id: detId, p_vals: vals });
      tr.classList.remove("saving");
      if (error) { fail++; continue; }
      ok++; DET.dirty.delete(detId); tr.classList.remove("dirty");
      comps.forEach(c => { const cell = tr.querySelector(`td.computed[data-key="${c.key}"]`); if (cell) cell.textContent = vals[c.key]; });
      const row = DET.rows.find(r => r.det_id === detId);
      if (row) {
        row.conteo = row.conteo || {};
        DET.cols.forEach(c => { row.conteo[c.key] = vals[c.key] === "" ? null : vals[c.key]; });
        comps.forEach(c => { row.conteo[c.key] = vals[c.key] === "" ? null : vals[c.key]; });
        if (vals.rollos_json !== undefined) row.conteo.rollos_json = vals.rollos_json;
        row.cargado = DET.cols.some(c => vals[c.key] !== "" && vals[c.key] != null);
        tr.classList.toggle("loaded", row.cargado);
      }
    }
    // Si se creó el relevamiento en este Guardar pero NO se pudo guardar ninguna fila,
    // se borra para no dejar un relevamiento vacío (vuelve al estado "nuevo" para reintentar).
    if (creadoAhora && ok === 0) {
      await sb.rpc("rc_borrar", { p_relevamiento_id: DET.rel.id });
      DET.rows.forEach(row => {
        const old = row.det_id, neg = -row.cat_id;
        const tr = document.querySelector(`#detBody tr[data-det="${old}"]`); if (tr) tr.dataset.det = neg;
        if (DET.dirty.has(old)) { DET.dirty.delete(old); DET.dirty.add(neg); }
        if (DET.rollos[old]) { DET.rollos[neg] = DET.rollos[old]; delete DET.rollos[old]; }
        row.det_id = neg; row.relevamiento_id = null;
      });
      DET.rel.id = null; DET.rel.nuevo = true;
    }
    btn.disabled = false;
    updateProg(); updateGuardarState();
    if (invalid) showMsg(`Guardado ${ok}. ${invalid} fila(s) con par incompleto (cargá cantidad Y kg) quedaron en rojo, sin guardar.`, "err");
    else if (fail) showMsg(`Guardado con errores: ${ok} ok, ${fail} fallaron (¿estás logueado?).`, "err");
    else showMsg(`Guardado (${ok} fila${ok === 1 ? "" : "s"}).`, "ok");
  }

  $("detSearch").addEventListener("input", (e) => {
    const q = norm(e.target.value).split(/\s+/).filter(Boolean);
    document.querySelectorAll("#detBody tr").forEach(tr => {
      const txt = norm(tr.textContent);
      tr.classList.toggle("hidden", !q.every(w => txt.includes(w)));
    });
  });

  function volverAtras() {
    if (DET.dirty.size && !confirm(`Hay ${DET.dirty.size} fila(s) sin guardar. ¿Salir sin guardar?`)) return;
    // Si venimos de la vista combinada (abrimos un lugar desde ahí), volver a ella; si no, a la lista.
    if (typeof DET.onBack === "function") { const cb = DET.onBack; DET.onBack = null; cb(); return; }
    $("vistaDetalle").style.display = "none";
    $("vistaLista").style.display = "";
    $("btnExcelFlejes").classList.add("hidden");
    cargarLista();
  }
  $("btnVolver").addEventListener("click", volverAtras);
  $("btnAtrasBottom").addEventListener("click", volverAtras);

  $("btnGuardar").addEventListener("click", guardarTodo);
  $("btnGuardarBottom").addEventListener("click", guardarTodo);

  // Descargar Excel flejes (Cervantes): columnas por rollo según el fleje con más variantes
  function descargarExcelFlejes() {
    const rows = DET.rows;
    // Determinar máximo de grupos de rollos (distintos pesos) en cualquier fleje
    let maxRollos = 0;
    rows.forEach(row => {
      const rollos = DET.rollos[row.det_id] || (row.conteo && row.conteo.rollos_json) || [];
      if (rollos.length > maxRollos) maxRollos = rollos.length;
    });
    if (!maxRollos) maxRollos = 1;

    // Encabezado
    const header = ["N° Orden", "Sector", "Descripción", "N° Fleje", "Proveedor", "Medida mm"];
    for (let i = 1; i <= maxRollos; i++) header.push("Cant Rollo " + i, "Kg Rollo " + i);
    header.push("Kg Total");

    // Filas ordenadas por sector
    const sorted = rows.slice().sort(cmpSectorRow);
    const dataRows = [];
    sorted.forEach(row => {
      const info = row.info || {};
      const conteo = row.conteo || {};
      const rollos = DET.rollos[row.det_id] || conteo.rollos_json || [];
      const kgTotal = parseFloat(conteo.total_kg) || 0;
      const cells = [
        info.n_orden != null ? info.n_orden : "",
        row.sector || "",
        row.descripcion || "",
        info.n_fleje != null ? info.n_fleje : "",
        info.prov || "",
        (info.medida_mm || "").replace(/,/g, ".")
      ];
      for (let i = 0; i < maxRollos; i++) {
        cells.push(rollos[i] != null ? (rollos[i].caj != null ? rollos[i].caj : "") : "");
        cells.push(rollos[i] != null ? (rollos[i].kg  != null ? rollos[i].kg  : "") : "");
      }
      cells.push(kgTotal || "");
      dataRows.push(cells);
    });

    // Generar SpreadsheetML (XML de Excel 2003) — sin librería externa
    const nCols = header.length;
    const nData = dataRows.length;

    // Escape XML
    const xe = s => String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    // Detectar numérico
    const isNum = v => v !== "" && v !== null && v !== undefined && isFinite(parseFloat(v));

    // Registro de estilos dinámico (evita duplicados)
    // key: "l|r|t|b|bold|sz"  (l/r/t/b = peso borde 1=fino 2=grueso)
    const styleReg = new Map();
    let sCtr = 0;
    const regStyle = (l, r, t, b, bold, sz) => {
      const k = `${l}|${r}|${t}|${b}|${bold}|${sz}`;
      if (!styleReg.has(k)) styleReg.set(k, "s" + sCtr++);
      return styleReg.get(k);
    };

    // Pre-registrar todos los estilos que se van a usar
    const M = 2, TH = 1; // Medium=grueso, Thin=fino
    const hdrSid = regStyle(M, M, M, M, true, 18);
    const getSid = (r, c) => {
      if (r === 0) return hdrSid;
      return regStyle(
        c === 0        ? M : TH,
        c === nCols-1  ? M : TH,
        r === 1        ? M : TH,
        r === nData    ? M : TH,
        false, 14
      );
    };
    for (let r = 0; r <= nData; r++)
      for (let c = 0; c < nCols; c++) getSid(r, c);

    // Bloque <Styles>
    const brdXml = (l, r, t, b) =>
      `<Border ss:Position="Left"   ss:LineStyle="Continuous" ss:Weight="${l}"/>` +
      `<Border ss:Position="Right"  ss:LineStyle="Continuous" ss:Weight="${r}"/>` +
      `<Border ss:Position="Top"    ss:LineStyle="Continuous" ss:Weight="${t}"/>` +
      `<Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="${b}"/>`;

    let stylesXml = "";
    for (const [k, sid] of styleReg.entries()) {
      const [l, r, t, b, bold, sz] = k.split("|");
      stylesXml +=
        `<Style ss:ID="${sid}">` +
        `<Font ss:Size="${sz}"${bold === "true" ? ' ss:Bold="1"' : ""}/>` +
        `<Alignment ss:Horizontal="Center" ss:Vertical="Center" ss:WrapText="1"/>` +
        `<Borders>${brdXml(l, r, t, b)}</Borders>` +
        `</Style>`;
    }

    // Anchos de columna (pts ≈ chars × 7.5)
    const colWidths = header.map((_, i) => i === 2 ? 240 : i === 4 ? 110 : i === 5 ? 100 : 90);
    const colsXml  = colWidths.map(w => `<Column ss:AutoFitWidth="0" ss:Width="${w}"/>`).join("");

    // Filas
    const allRows = [header, ...dataRows];
    let rowsXml = "";
    for (let r = 0; r <= nData; r++) {
      rowsXml += r === 0 ? `<Row ss:Height="36">` : `<Row>`;
      for (let c = 0; c < nCols; c++) {
        const v   = allRows[r][c];
        const num = isNum(v);
        rowsXml +=
          `<Cell ss:StyleID="${getSid(r, c)}">` +
          `<Data ss:Type="${num ? "Number" : "String"}">${xe(num ? parseFloat(v) : v)}</Data>` +
          `</Cell>`;
      }
      rowsXml += `</Row>`;
    }

    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<?mso-application progid="Excel.Sheet"?>\n` +
      `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n` +
      ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\n` +
      ` xmlns:x="urn:schemas-microsoft-com:office:excel">\n` +
      ` <Styles>${stylesXml}</Styles>\n` +
      ` <Worksheet ss:Name="Flejes"><Table>${colsXml}${rowsXml}</Table></Worksheet>\n` +
      `</Workbook>`;

    const blob = new Blob(["﻿" + xml], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "flejes_" + (DET.rel.fecha || "").replace(/-/g, "") + "_" + (DET.rel.planta || "") + ".xls"
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  $("btnExcelFlejes").addEventListener("click", descargarExcelFlejes);

  // Calendario: abre el modal con las fechas próximas y siguientes de cada relevamiento.
  $("btnCalendario").addEventListener("click", renderCalendario);
  $("calCerrar").addEventListener("click", () => { $("modalCalendario").style.display = "none"; });
  $("modalCalendario").addEventListener("click", (e) => { if (e.target.id === "modalCalendario") $("modalCalendario").style.display = "none"; });
  $("calBody").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-cal]"); if (!b) return;
    CAL.m += (b.dataset.cal === "next" ? 1 : -1);
    if (CAL.m > 11) { CAL.m = 0; CAL.y++; } else if (CAL.m < 0) { CAL.m = 11; CAL.y--; }
    drawCal();
  });

  // Cronograma: botón "Realizar" -> elegir lugar + encargado y abrir la carga.
  // Click en el resto de la línea -> ver el TOTAL (combinada por lugar, o detalle
  // solo-lectura si es un solo lugar) de la última tanda de ese tipo.
  $("cronoBox").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-realizar]");
    if (b) { abrirRealizar(b.dataset.realizar); return; }
    // Línea de una tanda YA guardada -> ver su total (por lugar) de ESE grupo.
    const done = e.target.closest(".crono-linea[data-grupo]");
    if (done) {
      const g = Number(done.dataset.grupo);
      const rels = RELS.filter(r => (r.grupo_id || r.id) === g);
      if (rels.length === 1) abrirDetalle(rels[0].id, true);
      else if (rels.length > 1) abrirCombinado(g);
      return;
    }
    // Línea "a realizar" (aún sin cargar) -> no hay total que mostrar.
  });
  $("rzConfirmar").addEventListener("click", confirmarRealizar);
  $("rzCancelar").addEventListener("click", cerrarRealizar);
  $("modalRealizar").addEventListener("click", (e) => { if (e.target.id === "modalRealizar") cerrarRealizar(); });
  $("rzEncargado").addEventListener("input", () => { $("rzEncargado").style.borderColor = ""; });

  // Barra por-lugar de la vista combinada: Detalle (solo lectura) / borrar lugar
  $("detLugares").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const id = Number(b.dataset.id), act = b.dataset.act;
    if (act === "ver-lugar") {
      // Volver desde este lugar debe regresar a la vista combinada de su grupo, no a la lista.
      const r = RELS.find(x => x.id === id);
      const g = r ? (r.grupo_id || r.id) : null;
      abrirDetalle(id, true, g != null ? () => abrirCombinado(g) : null);
      return;
    }
    if (act === "borrar") {
      const r = RELS.find(x => x.id === id);
      if (!confirm(`¿Borrar el lugar ${r ? r.planta : ""}? Se pierde su conteo.`)) return;
      const { error } = await sb.rpc("rc_borrar", { p_relevamiento_id: id });
      if (error) { showMsg("No se pudo borrar: " + error.message, "err"); return; }
      showMsg("Lugar borrado.", "ok");
      $("vistaDetalle").style.display = "none"; $("vistaLista").style.display = "";
      $("btnExcelFlejes").classList.add("hidden");
      cargarLista();
    }
  });

  // Modal Agregar lugar
  $("agConfirmar").addEventListener("click", confirmarAgregar);
  $("agCancelar").addEventListener("click", cerrarAgregar);
  $("modalAgregar").addEventListener("click", (e) => { if (e.target.id === "modalAgregar") cerrarAgregar(); });
  $("agEncargado").addEventListener("input", () => { $("agEncargado").style.borderColor = ""; });

  // Aviso del navegador si hay cambios sin guardar
  window.addEventListener("beforeunload", (e) => {
    if (DET.dirty && DET.dirty.size) { e.preventDefault(); e.returnValue = ""; }
  });

  // ---------------------------------------------------------------------------
  cargarFeriados().then(cargarLista);
})();
