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
      { key: "rollo1_nro", label: "Cant Rollos 1", plantas: ["Cervantes"] },
      { key: "rollo1_kg", label: "Kg c/u 1", plantas: ["Cervantes"] },
      { key: "rollo2_nro", label: "Cant Rollos 2", plantas: ["Cervantes"] },
      { key: "rollo2_kg", label: "Kg c/u 2", plantas: ["Cervantes"] },
      { key: "rollo3_nro", label: "Cant Rollos 3", plantas: ["Cervantes"] },
      { key: "rollo3_kg", label: "Kg c/u 3", plantas: ["Cervantes"] },
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

  // Columnas CALCULADAS (no editables; se guardan solas). Flejes Cervantes: Total Kg = suma de los kg de rollos.
  const COMPUTED = {
    flejes: [{
      // Total Kg = suma de (cantidad de rollos x kg por rollo) de los 3 slots.
      // Varios slots porque puede haber rollos partidos (usados un poco) con pesos distintos.
      key: "total_kg", label: "Total Kg", plantas: ["Cervantes"],
      compute: (v) => {
        const num = (k) => { const x = parseFloat(String(v && v[k] != null ? v[k] : "").replace(",", ".")); return isNaN(x) ? 0 : x; };
        const pares = [["rollo1_nro", "rollo1_kg"], ["rollo2_nro", "rollo2_kg"], ["rollo3_nro", "rollo3_kg"]];
        const hayAlgo = pares.some(([n, k]) => String(v && v[n] != null ? v[n] : "").trim() !== "" || String(v && v[k] != null ? v[k] : "").trim() !== "");
        if (!hayAlgo) return "";
        const total = pares.reduce((acc, [n, k]) => acc + num(n) * num(k), 0);
        return String(Math.round(total * 1000) / 1000);
      }
    }],
  };
  const computedFor = (tipo, planta) => (COMPUTED[tipo] || []).filter(c => !c.plantas || c.plantas.includes(planta));

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
    const last = {};
    for (const t of TIPOS) last[t.key] = {};
    for (const r of RELS) {
      if (!last[r.tipo]) continue;
      const cur = last[r.tipo][r.planta];
      if (!cur || r.fecha > cur.fecha) last[r.tipo][r.planta] = { fecha: r.fecha, encargado: r.encargado }; // 'YYYY-MM-DD' compara bien
    }
    let html = `<table><thead><tr><th>Tipo</th>`;
    for (const p of PLANTAS) html += `<th>${p}</th>`;
    html += `</tr></thead><tbody>`;
    for (const t of TIPOS) {
      html += `<tr><td class="tipo">${t.label}</td>`;
      for (const p of PLANTAS) {
        const aplica = (PLANTAS_TIPO[t.key] || []).includes(p);
        const f = last[t.key][p];
        let cell = `<span class="muted" title="No aplica">·</span>`;
        if (aplica) cell = f
          ? `${fmtFecha(f.fecha)}${f.encargado ? `<div class="muted" style="font-size:14px">${esc(f.encargado)}</div>` : ""}`
          : `<span class="muted">—</span>`;
        html += `<td class="cell">${cell}</td>`;
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
            <button class="btn btn-dark sm" data-act="cargar" data-id="${r.id}">Cargar</button>
            <button class="btn btn-red sm" data-act="borrar" data-id="${r.id}" title="Borrar este lugar">✕</button>
          </span>
        </div>`;
      }).join("");
      return `<div class="grupo ${grp.completo ? "" : "incompleto"}" data-grupo="${grp.g}">
        <div class="grupo-head">
          <span class="tag">${esc(TIPO_LABEL[grp.tipo] || grp.tipo)}</span>
          <span class="fecha">${fmtFecha(grp.maxFecha)}</span>
          <span class="bar"><i style="width:${pct}%"></i></span>
          <span class="prog">${grp.cargados}/${grp.items}${grp.completo ? "" : ` · <b style="color:#c00">incompleto</b>`}</span>
          <span class="rel-actions">
            ${faltan.length ? `<button class="btn btn-green sm" data-act="agregar" data-grupo="${grp.g}" data-tipo="${grp.tipo}">+ Agregar lugar</button>` : ""}
          </span>
        </div>
        <div class="grupo-lugares">${chips}</div>
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
    if (act === "agregar") { abrirAgregar(Number(b.dataset.grupo), b.dataset.tipo); return; }
    const id = Number(b.dataset.id);
    if (act === "cargar") { abrirDetalle(id); return; }
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
  function abrirAgregar(grupo, tipo) {
    AG = { grupo, tipo };
    const enGrupo = RELS.filter(r => (r.grupo_id || r.id) === grupo).map(r => r.planta);
    const faltan = (PLANTAS_TIPO[tipo] || []).filter(p => !enGrupo.includes(p));
    if (!faltan.length) { showMsg("Ya están todos los lugares en ese relevamiento.", "ok"); return; }
    $("agTitulo").textContent = `Agregar lugar — ${TIPO_LABEL[tipo] || tipo}`;
    $("agPlanta").innerHTML = faltan.map(p => `<option value="${p}">${p}</option>`).join("");
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

  async function abrirDetalle(relId) {
    const rel = RELS.find(x => x.id === relId) || (await refetchRel(relId));
    if (!rel) { showMsg("No se encontró el relevamiento.", "err"); return; }
    const { data, error } = await sb
      .from("v_rc_detalle").select("*")
      .eq("relevamiento_id", relId)
      .order("orden", { ascending: true });
    if (error) { showMsg("Error leyendo detalle: " + error.message, "err"); return; }
    DET = { rel, rows: data || [], cols: colsFor(rel.tipo, rel.planta), dirty: new Set() };
    $("vistaLista").style.display = "none";
    $("vistaDetalle").style.display = "";
    $("detTitulo").textContent = `${TIPO_LABEL[rel.tipo]} · ${rel.planta} · ${fmtFecha(rel.fecha)}${rel.encargado ? " · " + rel.encargado : ""}`;
    renderDetalle();
    updateGuardarState();
  }

  async function refetchRel(relId) {
    const { data } = await sb.from("v_rc_relevamientos").select("*").eq("id", relId).maybeSingle();
    return data || null;
  }

  function renderDetalle() {
    const { rel, rows, cols } = DET;
    const info = INFO_COLS[rel.tipo] || [];
    const comps = computedFor(rel.tipo, rel.planta);

    // Columnas congeladas lateralmente (identificadores): Descripción + Sector + info
    // Ancho de Sector = al máximo de caracteres del contenido (mín. 5), con la letra grande del contenido (22px).
    const secLens = rows.map(r => String(r.sector == null ? "" : r.sector).length);
    const maxSec = Math.max(5, secLens.length ? Math.max.apply(null, secLens) : 5);
    const W_DESC = 165, W_SECTOR = Math.min(190, maxSec * 15 + 20), W_INFO = 92;

    // Columnas congeladas lateralmente (identificadores). Descripción es opcional (se oculta en cajas).
    const fcols = [];
    if (!HIDE_DESC[rel.tipo]) fcols.push({ w: W_DESC, head: "Descripción", cls: "desc", val: r => esc(r.descripcion) });
    fcols.push({ w: W_SECTOR, head: "Sector", big: true, val: r => esc(r.sector) });
    info.forEach(([k, lbl]) => fcols.push({ w: W_INFO, head: lbl, big: true, val: r => (k === "cod") ? dashBreak(r.info ? r.info[k] : "") : esc(r.info ? r.info[k] : "") }));
    let accL = 0; fcols.forEach(f => { f.left = accL; accL += f.w; });
    const lastFz = fcols.length - 1;
    const fz = (f, i, head) => {
      let s = `position:sticky;left:${f.left}px;width:${f.w}px;min-width:${f.w}px;max-width:${f.w}px;white-space:normal;word-break:break-word;line-height:1.15;background:${head ? "#e9eef3" : "#fff"};z-index:${head ? 6 : 2};`;
      if (head) s += "top:0;";
      if (!head && f.big) s += "font-size:22px;font-weight:700;";
      if (i === lastFz) s += "border-right:2px solid #6b7885;";
      return s;
    };

    let head = "<tr>";
    fcols.forEach((f, i) => head += `<th style="${fz(f, i, true)}">${titleBreak(f.head)}</th>`);
    for (const c of cols) head += `<th style="text-align:center">${titleBreak(c.label)}</th>`;
    for (const c of comps) head += `<th style="text-align:center">${titleBreak(c.label)}</th>`;
    head += `</tr>`;
    $("detHead").innerHTML = head;

    $("detBody").innerHTML = rows.map(r => {
      let froz = fcols.map((f, i) => `<td class="${f.cls || ""}" style="${fz(f, i, false)}">${f.val(r)}</td>`).join("");
      const inputs = cols.map(c => {
        const v = r.conteo && r.conteo[c.key] != null ? r.conteo[c.key] : "";
        const tb = c.tandas ? `<button class="ci-tandas" data-det="${r.det_id}" data-key="${c.key}" type="button" title="Cargar por tandas">T</button>` : "";
        return `<td style="text-align:center;white-space:nowrap"><input class="ci" data-det="${r.det_id}" data-key="${c.key}" type="number" inputmode="decimal" step="any" value="${esc(v)}">${tb}</td>`;
      }).join("");
      const compCells = comps.map(c =>
        `<td class="computed" data-key="${c.key}" style="text-align:center;font-weight:800;color:#0a7a2f">${esc(c.compute(r.conteo || {}))}</td>`
      ).join("");
      return `<tr data-det="${r.det_id}" class="${r.cargado ? "loaded" : ""}">${froz}${inputs}${compCells}</tr>`;
    }).join("");
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
    updateGuardarState();
  });

  // Botón "T": cargar por tandas (uni sueltas de cartones/cajas). La suma cae en el input.
  $("detBody").addEventListener("click", (e) => {
    const b = e.target.closest(".ci-tandas"); if (!b) return;
    const detId = b.dataset.det, key = b.dataset.key;
    const inp = document.querySelector(`#detBody input.ci[data-det="${detId}"][data-key="${key}"]`);
    if (!inp || !window.tandasPopup) return;
    const cur = parseFloat(String(inp.value).replace(",", ".")) || 0;
    window.tandasPopup.open({
      titulo: "Tandas — Uni sueltas",
      pedirCaj: false, pedirKg: false, pedirUni: true, unidadUni: "uni",
      initial: cur > 0 ? [{ uni: cur }] : [],
      onConfirm: (t, totales) => {
        inp.value = totales.uni || "";
        inp.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  });

  function updateGuardarState() {
    const n = DET.dirty.size;
    const btn = $("btnGuardar");
    if (btn) { btn.disabled = n === 0; btn.textContent = n ? `Guardar (${n})` : "Guardar"; }
    const ind = $("detUnsaved");
    if (ind) ind.textContent = n ? `${n} sin guardar` : "";
  }

  async function guardarTodo() {
    if (!DET.dirty.size) return;
    const btn = $("btnGuardar"); btn.disabled = true;
    const comps = computedFor(DET.rel.tipo, DET.rel.planta);
    let ok = 0, fail = 0;
    for (const detId of [...DET.dirty]) {
      const tr = document.querySelector(`#detBody tr[data-det="${detId}"]`);
      if (!tr) { DET.dirty.delete(detId); continue; }
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
    if (fail) showMsg(`Guardado con errores: ${ok} ok, ${fail} fallaron (¿estás logueado?).`, "err");
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
