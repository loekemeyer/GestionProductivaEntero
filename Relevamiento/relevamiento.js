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
  const norm = (s) => String(s == null ? "" : s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const fmtFecha = (f) => { if (!f) return ""; const [y, m, d] = String(f).slice(0, 10).split("-"); return `${d}/${m}/${y}`; };

  function colsFor(tipo, planta) {
    return (CONTEO_COLS[tipo] || []).filter(c => !c.plantas || c.plantas.includes(planta));
  }

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

  // Totales y por lugar: por cada tipo x planta muestra la FECHA del último relevamiento (sin columna Total)
  function renderResumen() {
    const box = $("resumenBox");
    // Agrupar por tanda (grupo_id) y quedarse con la ÚLTIMA tanda de cada tipo (mayor fecha).
    const groups = new Map();
    for (const r of RELS) { const g = r.grupo_id || r.id; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(r); }
    const ultima = {}; // tipo -> { g, rels, maxFecha }
    for (const [g, rels] of groups) {
      const tipo = rels[0].tipo;
      const maxFecha = rels.reduce((m, r) => (r.fecha > m ? r.fecha : m), rels[0].fecha);
      const cur = ultima[tipo];
      if (!cur || maxFecha > cur.maxFecha || (maxFecha === cur.maxFecha && g > cur.g)) ultima[tipo] = { g, rels, maxFecha };
    }

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
        let cell = `<span class="muted" title="No aplica">·</span>`, attr = "";
        if (aplica) {
          if (rel) {
            cell = `${fmtFecha(rel.fecha)}${rel.encargado ? `<div class="enc">${esc(rel.encargado)}</div>` : ""}`;
            attr = ` data-relid="${rel.id}" style="cursor:pointer" title="Ver este lugar"`;
          } else cell = `<span class="muted">—</span>`;
        }
        html += `<td class="cell"${attr}>${cell}</td>`;
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

  function renderList() {
    const box = $("relList");
    if (!RELS.length) { box.innerHTML = `<div class="empty">Todavía no hay relevamientos. Generá uno arriba.</div>`; return; }
    const groups = new Map();
    for (const r of RELS) {
      const g = r.grupo_id || r.id;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
    const arr = [...groups.entries()].map(([g, rels]) => Object.assign({ g }, grupoDeRels(rels)));
    arr.sort((a, b) => (a.maxFecha < b.maxFecha ? 1 : a.maxFecha > b.maxFecha ? -1 : b.g - a.g));

    box.innerHTML = arr.map(grp => {
      const pct = grp.items ? Math.round((grp.cargados / grp.items) * 100) : 0;
      const plantasEn = grp.rels.map(r => r.planta);
      const faltan = (PLANTAS_TIPO[grp.tipo] || []).filter(p => !plantasEn.includes(p));
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
    }).join("");
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
  $("relList").addEventListener("click", async (e) => {
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
  });

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

  async function abrirDetalle(relId, readonly) {
    const rel = RELS.find(x => x.id === relId) || (await refetchRel(relId));
    if (!rel) { showMsg("No se encontró el relevamiento.", "err"); return; }
    const { data, error } = await sb
      .from("v_rc_detalle").select("*")
      .eq("relevamiento_id", relId)
      .order("orden", { ascending: true });
    if (error) { showMsg("Error leyendo detalle: " + error.message, "err"); return; }
    DET = { rel, rows: data || [], cols: colsFor(rel.tipo, rel.planta), dirty: new Set(), readonly: !!readonly };
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
    $("detTable").classList.add("combined");
    const info = INFO_COLS[tipo] || [];
    const showDesc = !HIDE_DESC[tipo];
    const unit = BASE_UNIT[tipo] || "";
    let head = "<tr>";
    if (showDesc) head += "<th>Descripción</th>";
    head += "<th>Sector</th>";
    info.forEach(([, lbl]) => head += `<th>${titleBreak(lbl)}</th>`);
    rels.forEach(r => head += `<th>${esc(ABREV_PLANTA[r.planta] || r.planta)}</th>`);
    head += `<th>${titleBreak(`Total${unit ? ` (${unit})` : ""}`)}</th></tr>`;
    $("detHead").innerHTML = head;

    const body = items.map(it => {
      let tds = "";
      if (showDesc) tds += `<td>${esc(it.ident.descripcion)}</td>`;
      tds += `<td style="font-weight:800;font-size:22px">${esc(it.ident.sector)}</td>`;
      info.forEach(([k]) => { const raw = it.ident.info ? it.ident.info[k] : ""; tds += `<td style="font-weight:800;font-size:22px">${k === "cod" ? dashBreak(raw) : titleBreak(raw)}</td>`; });
      let sum = 0;
      rels.forEach(r => {
        const v = aporteBase(tipo, r.planta, it.porLugar[r.planta], it.ident.info);
        sum += v;
        tds += `<td class="num">${fmtNum(v, tipo)}</td>`;
      });
      tds += `<td class="num" style="font-weight:800">${fmtNum(sum, tipo)}</td>`;
      return `<tr>${tds}</tr>`;
    }).join("");
    // Sin fila de TOTAL general: sumar piezas distintas no tiene sentido. El "Total" por fila = misma pieza entre lugares.
    $("detBody").innerHTML = body;
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
    const W_DESC = 165, W_SECTOR = Math.min(190, maxSec * 15 + 20);
    // Ancho de cada columna de info = al token mas largo (tras partir en espacio/guion, ya que el contenido va en doble linea).
    const wInfo = (k, lbl) => {
      const toks = [];
      String(lbl == null ? "" : lbl).split(/[\s-]+/).forEach(t => toks.push(t.length));
      rows.forEach(r => { const v = String((r.info && r.info[k] != null) ? r.info[k] : ""); v.split(k === "cod" ? "-" : /\s+/).forEach(t => toks.push(t.length)); });
      const max = Math.max(3, toks.length ? Math.max.apply(null, toks) : 3);
      return Math.min(140, max * 14 + 18);
    };

    // Columnas congeladas lateralmente (identificadores). Descripción es opcional (se oculta en cajas).
    const fcols = [];
    if (!HIDE_DESC[rel.tipo]) fcols.push({ w: W_DESC, head: "Descripción", cls: "desc", val: r => esc(r.descripcion) });
    fcols.push({ w: W_SECTOR, head: "Sector", big: true, val: r => esc(r.sector) });
    info.forEach(([k, lbl]) => fcols.push({ w: wInfo(k, lbl), head: lbl, big: true, val: r => (k === "cod") ? dashBreak(r.info ? r.info[k] : "") : titleBreak(r.info ? r.info[k] : "") }));
    let accL = 0; fcols.forEach(f => { f.left = accL; accL += f.w; });
    const lastFz = fcols.length - 1;
    const fz = (f, i, head) => {
      let s = `position:sticky;left:${f.left}px;width:${f.w}px;min-width:${f.w}px;max-width:${f.w}px;white-space:normal;word-break:break-word;line-height:1.15;background:${head ? "#e9eef3" : "#fff"};z-index:${head ? 6 : 2};`;
      if (head) s += "top:0;";
      if (!head && f.big) s += "font-size:22px;font-weight:700;";
      if (i === lastFz) s += "border-right:2px solid #6b7885;";
      return s;
    };

    // Ancho ajustado de las columnas de conteo: input (82px) + padding, y espacio extra si tiene botón "T" de tandas.
    const cW = c => (c.tandas ? 150 : 104);
    const compW = 104;

    let head = "<tr>";
    fcols.forEach((f, i) => head += `<th style="${fz(f, i, true)}">${titleBreak(f.head)}</th>`);
    for (const c of cols) head += `<th style="text-align:center;width:${cW(c)}px;min-width:${cW(c)}px">${titleBreak(c.label)}</th>`;
    for (const c of comps) head += `<th style="text-align:center;width:${compW}px;min-width:${compW}px">${titleBreak(c.label)}</th>`;
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
      return `<tr data-det="${r.det_id}" class="${r.cargado ? "loaded" : ""}">${froz}${inputs}${compCells}</tr>`;
    }).join("");
    if (PAIR_VALID[rel.tipo]) document.querySelectorAll("#detBody tr").forEach(marcarErroresPar);
    updateProg();
  }

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
      window.tandasPopup.open({
        titulo: "Tandas — Rollos (Cant × Kg c/u)",
        pedirCaj: true, pedirKg: true, pedirUni: false, multiplicar: true,
        exigirCompletos: true, grande: true,
        unidadCaj: "Cant rollos", unidadKg: "Kg c/u",
        initial: cur > 0 ? [{ caj: 1, kg: cur }] : [],
        onConfirm: (t, totales) => {
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
    const b = e.target.closest(".ci-tandas");
    if (b) { abrirTandasDet(b.dataset.det, b.dataset.key); return; }
    const inp = e.target.closest("input.ci-tanda-only");
    if (inp && !DET.readonly) abrirTandasDet(inp.dataset.det, inp.dataset.key);
  });

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

  $("btnVolver").addEventListener("click", () => {
    if (DET.dirty.size && !confirm(`Hay ${DET.dirty.size} fila(s) sin guardar. ¿Salir sin guardar?`)) return;
    $("vistaDetalle").style.display = "none";
    $("vistaLista").style.display = "";
    cargarLista();
  });

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
    if (act === "ver-lugar") { abrirDetalle(id, true); return; }
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
