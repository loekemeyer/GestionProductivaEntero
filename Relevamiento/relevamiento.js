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
      { key: "uni_suelta", label: "Uni sueltas", plantas: ["Cervantes"] },
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
      { key: "uni_suelta", label: "Uni sueltas" },
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

  function renderResumen() {
    const box = $("resumenBox");
    // Agrupar por tipo x planta: {tipo: {planta: {n, cargados, items}}}
    const agg = {};
    for (const t of TIPOS) { agg[t.key] = {}; for (const p of PLANTAS) agg[t.key][p] = { n: 0, cargados: 0, items: 0 }; }
    for (const r of RELS) {
      if (!agg[r.tipo] || !agg[r.tipo][r.planta]) continue;
      const a = agg[r.tipo][r.planta];
      a.n++; a.cargados += r.cargados || 0; a.items += r.items || 0;
    }
    const cell = (a) => {
      if (!a.n) return `<span class="pill zero">—</span>`;
      const kind = a.cargados >= a.items && a.items > 0 ? "full" : (a.cargados > 0 ? "part" : "zero");
      return `<span class="pill ${kind}">${a.cargados}/${a.items}</span><div class="muted" style="font-size:11px">${a.n} relev.</div>`;
    };
    let html = `<table><thead><tr><th>Tipo</th>`;
    for (const p of PLANTAS) html += `<th style="text-align:center">${p}</th>`;
    html += `<th style="text-align:center">Total</th></tr></thead><tbody>`;
    for (const t of TIPOS) {
      let tot = { n: 0, cargados: 0, items: 0 };
      html += `<tr><td class="tipo">${t.label}</td>`;
      for (const p of PLANTAS) {
        const a = agg[t.key][p];
        tot.n += a.n; tot.cargados += a.cargados; tot.items += a.items;
        const aplica = (PLANTAS_TIPO[t.key] || []).includes(p);
        html += `<td class="cell">${aplica ? cell(a) : `<span class="muted" title="No aplica">·</span>`}</td>`;
      }
      html += `<td class="cell">${cell(tot)}</td></tr>`;
    }
    html += `</tbody></table>`;
    box.innerHTML = html;
  }

  function renderList() {
    const box = $("relList");
    if (!RELS.length) { box.innerHTML = `<div class="empty">Todavía no hay relevamientos. Generá uno arriba.</div>`; return; }
    // Marcar cuál es el "último" por tipo (para el botón Completar plantas)
    const ultimoPorTipo = {};
    for (const r of RELS) { if (!(r.tipo in ultimoPorTipo)) ultimoPorTipo[r.tipo] = r.id; }

    box.innerHTML = RELS.map(r => {
      const pct = r.items ? Math.round((r.cargados / r.items) * 100) : 0;
      const faltanPlantas = (PLANTAS_TIPO[r.tipo] || []).filter(p =>
        !RELS.some(x => x.tipo === r.tipo && x.fecha === r.fecha && x.planta === p));
      const puedeCompletar = faltanPlantas.length > 0;
      return `<div class="rel" data-id="${r.id}">
        <span class="tag">${esc(TIPO_LABEL[r.tipo] || r.tipo)}</span>
        <span class="lugar">${esc(r.planta)}</span>
        <span class="fecha">${fmtFecha(r.fecha)}${r.encargado ? " · " + esc(r.encargado) : ""}</span>
        <span class="bar"><i style="width:${pct}%"></i></span>
        <span class="prog">${r.cargados}/${r.items}</span>
        <span class="rel-actions">
          <button class="btn btn-dark sm" data-act="cargar" data-id="${r.id}">Cargar</button>
          ${puedeCompletar ? `<button class="btn btn-green sm" data-act="completar" data-id="${r.id}" title="Faltan: ${esc(faltanPlantas.join(", "))}">Completar plantas</button>` : ""}
          <button class="btn btn-red sm" data-act="borrar" data-id="${r.id}">✕</button>
        </span>
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
    const id = Number(b.dataset.id), act = b.dataset.act;
    if (act === "cargar") { abrirDetalle(id); return; }
    if (act === "borrar") {
      const r = RELS.find(x => x.id === id);
      if (!confirm(`¿Borrar el relevamiento de ${TIPO_LABEL[r.tipo]} en ${r.planta} (${fmtFecha(r.fecha)})? Se pierde su conteo.`)) return;
      const { error } = await sb.rpc("rc_borrar", { p_relevamiento_id: id });
      if (error) { showMsg("No se pudo borrar: " + error.message, "err"); return; }
      showMsg("Relevamiento borrado.", "ok"); cargarLista(); return;
    }
    if (act === "completar") {
      const r = RELS.find(x => x.id === id);
      b.disabled = true;
      const { data, error } = await sb.rpc("rc_completar_plantas", { p_relevamiento_id: id });
      b.disabled = false;
      if (error) { showMsg("No se pudo completar: " + error.message, "err"); return; }
      const n = Array.isArray(data) ? data.length : 0;
      showMsg(n ? `Se generó el relevamiento en ${n} planta(s) que faltaban.` : "No faltaban plantas.", "ok");
      cargarLista(); return;
    }
  });

  // ---------------------------------------------------------------------------
  // DETALLE (carga de conteo)
  // ---------------------------------------------------------------------------
  let DET = { rel: null, rows: [], cols: [] };

  async function abrirDetalle(relId) {
    const rel = RELS.find(x => x.id === relId) || (await refetchRel(relId));
    if (!rel) { showMsg("No se encontró el relevamiento.", "err"); return; }
    const { data, error } = await sb
      .from("v_rc_detalle").select("*")
      .eq("relevamiento_id", relId)
      .order("orden", { ascending: true });
    if (error) { showMsg("Error leyendo detalle: " + error.message, "err"); return; }
    DET = { rel, rows: data || [], cols: colsFor(rel.tipo, rel.planta) };
    $("vistaLista").style.display = "none";
    $("vistaDetalle").style.display = "";
    $("detTitulo").textContent = `${TIPO_LABEL[rel.tipo]} · ${rel.planta} · ${fmtFecha(rel.fecha)}${rel.encargado ? " · " + rel.encargado : ""}`;
    renderDetalle();
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
    const W_DESC = 165, W_SECTOR = 60, W_INFO = 92;
    const frozen = [{ w: W_DESC }, { w: W_SECTOR }].concat(info.map(() => ({ w: W_INFO })));
    let accL = 0; frozen.forEach(f => { f.left = accL; accL += f.w; });
    const lastFz = frozen.length - 1;
    const fz = (i, head) => {
      const f = frozen[i];
      let s = `position:sticky;left:${f.left}px;width:${f.w}px;min-width:${f.w}px;max-width:${f.w}px;white-space:normal;word-break:break-word;line-height:1.15;background:${head ? "#e9eef3" : "#fff"};z-index:${head ? 6 : 2};`;
      if (head) s += "top:0;";
      // contenido (valores) de Sector y de las columnas de info: texto mas grande
      if (!head && i >= 1) s += "font-size:22px;font-weight:700;";
      if (i === lastFz) s += "border-right:2px solid #6b7885;";
      return s;
    };

    let head = `<tr><th style="${fz(0, true)}">Descripción</th><th style="${fz(1, true)}">Sector</th>`;
    info.forEach(([, lbl], i) => head += `<th style="${fz(2 + i, true)}">${titleBreak(lbl)}</th>`);
    for (const c of cols) head += `<th style="text-align:center">${titleBreak(c.label)}</th>`;
    for (const c of comps) head += `<th style="text-align:center">${titleBreak(c.label)}</th>`;
    head += `</tr>`;
    $("detHead").innerHTML = head;

    $("detBody").innerHTML = rows.map(r => {
      let froz = `<td class="desc" style="${fz(0, false)}">${esc(r.descripcion)}</td>`;
      froz += `<td style="${fz(1, false)}">${esc(r.sector)}</td>`;
      info.forEach(([k], i) => {
        const raw = r.info ? r.info[k] : "";
        froz += `<td style="${fz(2 + i, false)}">${k === "cod" ? dashBreak(raw) : esc(raw)}</td>`;
      });
      const inputs = cols.map(c => {
        const v = r.conteo && r.conteo[c.key] != null ? r.conteo[c.key] : "";
        return `<td style="text-align:center"><input class="ci" data-det="${r.det_id}" data-key="${c.key}" type="number" inputmode="decimal" step="any" value="${esc(v)}"></td>`;
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

  // Guardar al salir del input (blur/change)
  $("detBody").addEventListener("change", async (e) => {
    const inp = e.target.closest("input.ci"); if (!inp) return;
    const detId = Number(inp.dataset.det);
    const tr = inp.closest("tr");
    // Juntar todos los valores de conteo de esa fila
    const vals = {};
    tr.querySelectorAll("input.ci").forEach(i => { vals[i.dataset.key] = i.value.trim(); });
    // Columnas calculadas (ej. flejes total_kg): se calculan y persisten solas
    const comps = computedFor(DET.rel.tipo, DET.rel.planta);
    comps.forEach(c => { vals[c.key] = c.compute(vals); });
    tr.classList.add("saving");
    const { error } = await sb.rpc("rc_set_conteo", { p_tipo: DET.rel.tipo, p_det_id: detId, p_vals: vals });
    tr.classList.remove("saving");
    if (error) { showMsg("No se pudo guardar (¿estás logueado?): " + error.message, "err"); return; }
    // Reflejar las calculadas en su celda
    comps.forEach(c => { const cell = tr.querySelector(`td.computed[data-key="${c.key}"]`); if (cell) cell.textContent = vals[c.key]; });
    // Actualizar estado local "cargado"
    const row = DET.rows.find(r => r.det_id === detId);
    if (row) {
      row.conteo = row.conteo || {};
      DET.cols.forEach(c => { row.conteo[c.key] = vals[c.key] === "" ? null : vals[c.key]; });
      comps.forEach(c => { row.conteo[c.key] = vals[c.key] === "" ? null : vals[c.key]; });
      row.cargado = DET.cols.some(c => vals[c.key] !== "" && vals[c.key] != null);
      tr.classList.toggle("loaded", row.cargado);
    }
    updateProg();
  });

  $("detSearch").addEventListener("input", (e) => {
    const q = norm(e.target.value).split(/\s+/).filter(Boolean);
    document.querySelectorAll("#detBody tr").forEach(tr => {
      const txt = norm(tr.textContent);
      tr.classList.toggle("hidden", !q.every(w => txt.includes(w)));
    });
  });

  $("btnVolver").addEventListener("click", () => {
    $("vistaDetalle").style.display = "none";
    $("vistaLista").style.display = "";
    cargarLista();
  });

  // ---------------------------------------------------------------------------
  initNuevo();
  cargarLista();
})();
