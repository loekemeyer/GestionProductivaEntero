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
  const PLANTAS = ["Cervantes", "Virgilio", "San Roque"];
  const ABREV_PLANTA = { "Cervantes": "Cerv.", "Virgilio": "Virg.", "San Roque": "San R." };

  // Plantas donde aplica cada tipo (espejo de rc_plantas_tipo)
  const PLANTAS_TIPO = {
    flejes: ["Cervantes", "Virgilio", "San Roque"],
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
    bombillas: [],
    garage:    [],
  };

  // Columnas de CONTEO (input). plantas => solo se muestra en esas plantas.
  const CONTEO_COLS = {
    cajas: [
      { key: "conteo_paq", label: "Paquetes", plantas: ["Cervantes"] },
      { key: "uni_suelta", label: "Uni sueltas", plantas: ["Cervantes"], tandas: true },
      { key: "uni", label: "Unidades", plantas: ["Virgilio"] },
    ],
    flejes: [
      // Cervantes: cada fleje puede tener varios rollos (algunos usados a distinto peso) -> se cargan POR TANDAS
      // (Cant rollos x Kg c/u); el Total Kg = suma de (cant x kg) cae en esta celda. Boton "T" abre el popup.
      { key: "total_kg", label: "Total Kg", plantas: ["Cervantes"], tandas: true, flejeTandas: true },
      { key: "stock_kg", label: "Stock Kg", plantas: ["Virgilio", "San Roque"] },
    ],
    cartones: [
      { key: "conteo_paquete", label: "Paquetes" },
      { key: "uni_suelta", label: "Uni sueltas", tandas: true },
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
    ],
  };

  // Columnas CALCULADAS (no editables; se guardan solas). Flejes Cervantes ya no calcula acá:
  // el Total Kg se ingresa directo o por tandas (Cant rollos x Kg c/u) desde el popup.
  const COMPUTED = {};
  const computedFor = (tipo, planta) => (COMPUTED[tipo] || []).filter(c => !c.plantas || c.plantas.includes(planta));

  // Unidad base para el TOTAL de la vista combinada, y aporte de cada lugar en esa unidad.
  const BASE_UNIT = { flejes: "kg", cajas: "uni", plasticos: "uni" };
  function aporteBase(tipo, planta, conteo, info) {
    const num = x => { const n = parseFloat(String(x == null ? "" : x).replace(",", ".")); return isNaN(n) ? 0 : n; };
    const c = conteo || {}, i = info || {};
    if (tipo === "flejes") return planta === "Cervantes" ? num(c.total_kg) : num(c.stock_kg);
    if (tipo === "cajas") return planta === "Virgilio" ? num(c.uni) : num(c.conteo_paq) * num(i.uni_x_paq) + num(c.uni_suelta);
    if (tipo === "plasticos") return num(c.stock_relev_bolsa) * num(i.uni_x_bolsa) + num(c.uni_suelta);
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
  const natKey = (s) => String(s == null ? "" : s).toUpperCase().match(/\d+|\D+/g) || [];
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
      const b = num(c.stock_relev_bolsa), ub = num(i.uni_x_bolsa), sub = b * ub, sueltas = num(c.uni_suelta);
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
    if (tipo === "garage") return { lineas: [L("Cajones", num(c.stock_actual_cajon))], total: num(c.stock_actual_cajon), unidad: "cajón" };
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
    renderResumen();
    renderList();
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
  $("relActual").addEventListener("click", onListClick);
  $("relList").addEventListener("click", onListClick);

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
    const filas = (data || []).slice().sort(cmpSector);  // ordenado por sector
    DET = { rel, rows: filas, cols: colsFor(rel.tipo, rel.planta), dirty: new Set(), readonly: !!readonly, onBack: onBack || null, rollos: {} };
    // Flejes: cargar el desglose de rollos guardado (para reabrir las tandas sin combinar).
    filas.forEach(row => {
      const rj = row.conteo && row.conteo.rollos_json;
      if (Array.isArray(rj) && rj.length) DET.rollos[row.det_id] = rj;
    });
    $("vistaLista").style.display = "none";
    $("vistaDetalle").style.display = "";
    $("detTitulo").textContent = `${TIPO_LABEL[rel.tipo]} · ${rel.planta} · ${fmtFecha(rel.fecha)}${rel.encargado ? " · " + rel.encargado : ""}${readonly ? " · (solo ver)" : ""}`;
    $("btnGuardar").style.display = readonly ? "none" : "";
    $("guardarBottomWrap").style.display = readonly ? "none" : "";
    $("detUnsaved").style.display = readonly ? "none" : "";
    $("detLugares").style.display = "none";
    renderDetalle();
    updateGuardarState();
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
    const byRel = {};
    (data || []).forEach(d => { (byRel[d.relevamiento_id] = byRel[d.relevamiento_id] || []).push(d); });
    // Ordenar cada lugar por SECTOR (mismo criterio) para que las filas queden alineadas por indice.
    Object.values(byRel).forEach(arr => arr.sort(cmpSector));
    const base = byRel[ids[0]] || [];
    const items = base.map((row, idx) => {
      const porLugar = {};
      rels.forEach(rel => { const rows = byRel[rel.id] || []; porLugar[rel.planta] = rows[idx] ? rows[idx].conteo : {}; });
      return { ident: { descripcion: row.descripcion, sector: row.sector, info: row.info }, porLugar };
    });
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
        <button class="btn btn-ghost sm" data-act="ver-lugar" data-id="${r.id}">Detalle</button>
        <button class="btn btn-red sm" data-act="borrar" data-id="${r.id}" title="Borrar este lugar">✕</button></span>`;
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

    // Columnas congeladas lateralmente (identificadores): Descripción + Sector + info
    // Ancho de Sector = al máximo de caracteres del contenido (mín. 5), con la letra grande del contenido (22px).
    const secLens = rows.map(r => String(r.sector == null ? "" : r.sector).length);
    const maxSec = Math.max(5, secLens.length ? Math.max.apply(null, secLens) : 5);
    // Plasticos: la descripcion se corta por palabra al pasar 10 chars -> ancho natural = a la linea mas larga.
    const descChunk = rel.tipo === "plasticos";
    let W_DESC_NAT = 165;
    if (descChunk) {
      const maxLine = rows.reduce((m, r) => { const ls = wrapLines(r.descripcion, 10); return ls.reduce((mm, l) => Math.max(mm, l.length), m); }, 8);
      W_DESC_NAT = Math.min(210, Math.max(90, maxLine * 10 + 18));
    }
    const W_SECTOR = Math.min(190, maxSec * 15 + 20);
    // Ancho de cada columna de info = al token mas largo (tras partir en espacio/guion, ya que el contenido va en doble linea).
    const wInfo = (k, lbl) => {
      const toks = [];
      String(lbl == null ? "" : lbl).split(/[\s-]+/).forEach(t => toks.push(t.length));
      rows.forEach(r => { const v = String((r.info && r.info[k] != null) ? r.info[k] : ""); v.split(k === "cod" ? "-" : /\s+/).forEach(t => toks.push(t.length)); });
      const max = Math.max(3, toks.length ? Math.max.apply(null, toks) : 3);
      return Math.min(140, max * 14 + 18);
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
      if (!head && f.big) s += "font-size:22px;font-weight:700;";
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
    cargarLista();
  }
  $("btnVolver").addEventListener("click", volverAtras);
  $("btnAtrasBottom").addEventListener("click", volverAtras);

  $("btnGuardar").addEventListener("click", guardarTodo);
  $("btnGuardarBottom").addEventListener("click", guardarTodo);

  // "Último Relevamiento": clic en el TIPO -> resumen del relevamiento; clic en una celda -> ese lugar. (solo lectura)
  $("resumenBox").addEventListener("click", (e) => {
    const tipoTd = e.target.closest("td[data-grupo]");
    if (tipoTd) {
      const g = Number(tipoTd.dataset.grupo);
      const rels = RELS.filter(r => (r.grupo_id || r.id) === g);
      if (rels.length === 1) abrirDetalle(rels[0].id, true); else abrirCombinado(g);
      return;
    }
    const td = e.target.closest("td[data-relid]");
    if (td) abrirDetalle(Number(td.dataset.relid), true);
  });

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
  initNuevo();
  cargarLista();
})();
