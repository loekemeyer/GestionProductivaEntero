"use strict";

/* =========================================================
   CONFIG SUPABASE
========================================================= */
const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

/* =========================================================
   HELPERS
========================================================= */
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const panelEl  = $("panelRutas");

function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
function norm(s) { return String(s == null ? "" : s).trim().toUpperCase(); }
function setStatus(t) { if (statusEl) statusEl.textContent = t || ""; }

function firmaRuta(fleje, pasos) {
  return "F:" + fleje + "|" + pasos.map(p => `${p.tipo}:${p.label}`).join("|");
}

async function fetchAll(tabla) {
  const all = [];
  const step = 1000;
  for (let off = 0; off < 100000; off += step) {
    const { data, error } = await sb.from(tabla).select("*").range(off, off + step - 1);
    if (error) throw new Error(`Error leyendo ${tabla}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < step) break;
  }
  return all;
}

/* =========================================================
   STATE
========================================================= */
const REVISAR_TAG = "(pendiente de revisar)";
let firmasConfirmadas = new Set();   // Set<string>
let firmasGeneradasActual = new Set(); // Todas las firmas del trazado actual (incluidas confirmadas)
let cardsTrazadas = [];              // rutas trazadas que NO están confirmadas
let tabActual = "trazar";            // "trazar" | "confirmadas" | "revisar" | "problemas"
let rutasListaCache = [];            // items de la tab actual: { data, matchText, llegaTall }
let renderItemFn = null;             // función que renderiza un item según tab

/* =========================================================
   SECCIONES (Rutas / Despiece x Articulo)
========================================================= */
function cambiarSeccion(sec) {
  const secRutasBtn = $("secRutas");
  const secDespieceBtn = $("secDespiece");
  const seccionRutas = $("seccionRutas");
  const seccionDespiece = $("seccionDespiece");
  const frame = $("despieceFrame");

  if (secRutasBtn) secRutasBtn.classList.toggle("sec-activo", sec === "rutas");
  if (secDespieceBtn) secDespieceBtn.classList.toggle("sec-activo", sec === "despiece");

  if (sec === "despiece") {
    if (seccionRutas) seccionRutas.style.display = "none";
    if (seccionDespiece) seccionDespiece.style.display = "";
    if (frame && !frame.dataset.loaded) {
      frame.src = "../Despiece x Articulo/index.html";
      frame.dataset.loaded = "1";
    }
  } else {
    if (seccionRutas) seccionRutas.style.display = "";
    if (seccionDespiece) seccionDespiece.style.display = "none";
  }
}

/* =========================================================
   TABS
========================================================= */
function cambiarTab(tab) {
  tabActual = tab;
  const btns = {
    trazar: $("tabTrazar"),
    confirmadas: $("tabConfirmadas"),
    revisar: $("tabRevisar"),
    problemas: $("tabProblemas")
  };
  for (const k of Object.keys(btns)) {
    if (btns[k]) btns[k].classList.toggle("tab-activo", k === tab);
  }

  if (tab === "trazar") renderListaTrazar();
  else if (tab === "confirmadas") renderListaConfirmadas();
  else if (tab === "revisar") renderListaRevisar();
  else if (tab === "problemas") renderListaProblemas();
}

/* =========================================================
   TRAZAR RUTAS
========================================================= */
async function trazarRutas() {
  const btn = $("btnRutas");
  if (btn) { btn.disabled = true; btn.textContent = "Trazando..."; }
  if (panelEl) { panelEl.style.display = ""; panelEl.innerHTML = '<p style="color:#888">Cargando...</p>'; }
  setStatus("Cargando tablas...");

  try {
    const [flejes, ceRows, psRows, tallRows, scRows, spRows, matrices, confirmadas, problemas] = await Promise.all([
      fetchAll("Flejes"),
      fetchAll("Causa-Efecto"),
      fetchAll("Partes x PS"),
      fetchAll("Partes x Tallerista"),
      fetchAll("SC Kg"),
      fetchAll("SP Kg"),
      fetchAll("Matrices"),
      fetchAll("Rutas_Confirmadas"),
      fetchAll("Rutas_Problemas"),
    ]);

    firmasConfirmadas = new Set(confirmadas.map(c => c.firma));
    // Firmas con problema o "revisar después" pendiente: tampoco aparecen en Trazar
    const firmasPendientes = new Set(
      (problemas || []).filter(p => p.estado === "pendiente").map(p => p.firma)
    );

    setStatus(`Procesando ${flejes.length} flejes...`);

    // ---- Descripciones ----
    const descPor = new Map();
    for (const f of flejes) descPor.set(norm("FLEJE " + (f["N Fleje"] || "")), f["Descripción"] || f["Descripcion"] || "");
    for (const s of scRows) descPor.set(norm(s["SC"]), s["Descripcion"] || "");
    for (const s of spRows) descPor.set(norm(s["Sp"]),  s["Parte"] || "");

    // ---- Nombre de matriz ----
    const matrizNombre = new Map();
    for (const m of matrices) {
      const n = String(m["N_Matriz"] || "").trim();
      if (n) matrizNombre.set(n, String(m["Matriz"] || "").trim());
    }

    // ---- Grafo Causa-Efecto ----
    const grafoCE = new Map();
    for (const r of ceRows) {
      const from = norm(r["Descuenta"]); const to = norm(r["Aumenta"]);
      if (!from || !to) continue;
      if (!grafoCE.has(from)) grafoCE.set(from, []);
      grafoCE.get(from).push({
        aumenta: to,
        aumentaRaw: String(r["Aumenta"] || "").trim(),
        matriz: String(r["Matriz"] || "").trim(),
        descMatriz: String(r["Descripcion Matriz"] || "").trim()
      });
    }

    // ---- Partes x PS ----
    const grafoPS = new Map();
    for (const r of psRows) {
      const sc = norm(r["SC"]); if (!sc) continue;
      if (!grafoPS.has(sc)) grafoPS.set(sc, []);
      grafoPS.get(sc).push({
        ps: String(r["PS"] || "").trim(),
        proceso: String(r["Proceso"] || "").trim(),
        sp: norm(r["SP"]),
        spRaw: String(r["SP"] || "").trim(),
        parte: String(r["Parte"] || "").trim()
      });
    }

    // ---- Partes x Tallerista ----
    const tallPor = new Map();
    const tallSet = new Set(); // nombres de talleristas conocidos
    for (const r of tallRows) {
      const sec = norm(r["sector_proce"]);
      const tall = String(r["tallerista"] || "").trim();
      if (!tall) continue;
      tallSet.add(norm(tall));
      if (!sec) continue;
      if (!tallPor.has(sec)) tallPor.set(sec, new Set());
      tallPor.get(sec).add(tall);
    }

    // Detecta si un valor de "Matriz" en Causa-Efecto es en realidad un tallerista
    // (soporta formato "Martin, Carlos").
    function esTall(name) {
      if (!name) return false;
      if (tallSet.has(norm(name))) return true;
      const parts = name.split(",").map(p => p.trim()).filter(Boolean);
      return parts.length > 0 && parts.every(p => tallSet.has(norm(p)));
    }

    // ---- DFS ----
    const MAX_PROF = 15;
    const scSet = new Set(scRows.map(r => norm(r["SC"])));
    const spSet = new Set(spRows.map(r => norm(r["Sp"])));
    function sectorTipo(n) {
      if (/^FLEJE\s*\d+/i.test(n)) return "fleje";
      if (n === "FABR") return "fabr";
      if (scSet.has(n)) return "sc";
      if (spSet.has(n)) return "sp";
      return "otro";
    }

    function dfs(nodo, camino, visitados, rutas) {
      if (camino.length > MAX_PROF) { rutas.push([...camino, { tipo:"dead", label:"(demasiado largo)" }]); return; }
      let tuvoContinuacion = false;

      const ceOuts = grafoCE.get(nodo) || [];
      for (const out of ceOuts) {
        if (visitados.has(out.aumenta)) continue;
        const nextVis = new Set(visitados); nextVis.add(out.aumenta);
        const pasos = [...camino];
        if (out.matriz) {
          const mNorm = norm(out.matriz);
          if (mNorm === "FABR") {
            pasos.push({ tipo: "fabr", label: "Fabr (interno)", desc: out.descMatriz });
          } else if (esTall(out.matriz)) {
            pasos.push({ tipo: "tall", label: out.matriz, desc: out.descMatriz || "Armado por tallerista" });
          } else {
            const lbl = /^\d+$/.test(out.matriz) ? "Matriz " + out.matriz : out.matriz;
            pasos.push({ tipo: "matriz", label: lbl, desc: matrizNombre.get(out.matriz) || out.descMatriz });
          }
        }
        pasos.push({ tipo: sectorTipo(out.aumenta), label: out.aumentaRaw, desc: descPor.get(out.aumenta) || "" });
        tuvoContinuacion = true;
        dfs(out.aumenta, pasos, nextVis, rutas);
      }

      const psOuts = grafoPS.get(nodo) || [];
      const grupos = new Map();
      for (const p of psOuts) {
        const k = p.proceso + "|" + p.sp;
        if (!grupos.has(k)) grupos.set(k, { psList: [], proceso: p.proceso, sp: p.sp, spRaw: p.spRaw, parte: p.parte });
        if (!grupos.get(k).psList.includes(p.ps)) grupos.get(k).psList.push(p.ps);
      }
      for (const g of grupos.values()) {
        const psLbl = g.psList.join(" / ");
        const pasos = [...camino];
        pasos.push({ tipo: "ps", label: psLbl + (g.proceso ? ` (${g.proceso})` : ""), desc: g.parte || "" });
        if (g.sp) {
          if (visitados.has(g.sp)) { rutas.push(pasos); continue; }
          // Caso especial: ST (Sector Tránsito) — genérico. No usar su descripción en SC Kg ("Resorte U"),
          // sino la descripción del sector enviado anteriormente + los PS que lo tienen en tránsito.
          let descDestino;
          if (g.sp === "ST") {
            const sectorAnt = camino[camino.length - 1];
            const descAnt = sectorAnt ? (sectorAnt.desc || sectorAnt.label) : "";
            descDestino = descAnt + " + " + g.psList.join(" / ");
          } else {
            descDestino = descPor.get(g.sp) || "";
          }
          pasos.push({ tipo: sectorTipo(g.sp), label: g.spRaw, desc: descDestino });
          const nextVis = new Set(visitados); nextVis.add(g.sp);
          tuvoContinuacion = true;
          dfs(g.sp, pasos, nextVis, rutas);
        } else {
          rutas.push(pasos);
        }
      }

      const tallsSet = tallPor.get(nodo);
      if (tallsSet && tallsSet.size > 0) {
        const pasos = [...camino];
        pasos.push({ tipo: "tall", label: [...tallsSet].join(" / "), desc: "" });
        rutas.push(pasos);
        tuvoContinuacion = true;
      }

      if (!tuvoContinuacion) rutas.push([...camino]);
    }

    // ---- Trazar desde cada Fleje ----
    const items = [];
    for (const f of flejes) {
      const n = String(f["N Fleje"] || "").trim();
      if (!n) continue;
      const inicioRaw = "Fleje " + n;
      const inicio = norm(inicioRaw);
      const desc = f["Descripción"] || f["Descripcion"] || "";
      const rutas = [];
      dfs(inicio, [{ tipo: "fleje", label: inicioRaw, desc }], new Set([inicio]), rutas);
      items.push({ fleje: n, desc, rutas });
    }

    // Aplanar y filtrar las que están en alguna otra tab (Confirmadas / Problemas / Revisar)
    firmasGeneradasActual = new Set();
    cardsTrazadas = [];
    for (const it of items) {
      if (!it.rutas.length) continue;
      for (const r of it.rutas) {
        const firma = firmaRuta(it.fleje, r);
        firmasGeneradasActual.add(firma);
        if (firmasConfirmadas.has(firma)) continue; // ya confirmada
        if (firmasPendientes.has(firma)) continue;  // ya en problemas/revisar
        cardsTrazadas.push({ fleje: it.fleje, desc: it.desc, ruta: r, firma });
      }
    }

    setStatus(`${cardsTrazadas.length} por revisar · ${firmasConfirmadas.size} confirmadas · ${firmasPendientes.size} en problemas/revisar`);
    renderTabs();
    cambiarTab("trazar");
    actualizarContadoresTabsAsync();
  } catch (err) {
    console.error(err);
    setStatus("Error: " + err.message);
    if (panelEl) panelEl.innerHTML = '<p style="color:#b42318">' + esc(err.message) + '</p>';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Trazar Rutas"; }
  }
}

/* =========================================================
   RENDER TABS + LISTA
========================================================= */
function renderTabs() {
  if (!panelEl) return;
  panelEl.innerHTML = `
    <div style="display:flex;border-bottom:2px solid #e2e8f0;margin:16px 0 12px">
      <button id="tabTrazar" class="tab-btn tab-activo" onclick="cambiarTab('trazar')"
        style="padding:10px 20px;background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;color:#334155">
        Trazar Rutas <span id="tabTrazarCount" style="background:#64748b;color:#fff;padding:1px 8px;border-radius:10px;font-size:11px;margin-left:4px"></span>
      </button>
      <button id="tabConfirmadas" class="tab-btn" onclick="cambiarTab('confirmadas')"
        style="padding:10px 20px;background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;color:#64748b">
        Rutas Confirmadas <span id="tabConfirmadasCount" style="background:#10b981;color:#fff;padding:1px 8px;border-radius:10px;font-size:11px;margin-left:4px"></span>
      </button>
      <button id="tabRevisar" class="tab-btn" onclick="cambiarTab('revisar')"
        style="padding:10px 20px;background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;color:#64748b">
        📌 Revisar después <span id="tabRevisarCount" style="background:#f59e0b;color:#fff;padding:1px 8px;border-radius:10px;font-size:11px;margin-left:4px">0</span>
      </button>
      <button id="tabProblemas" class="tab-btn" onclick="cambiarTab('problemas')"
        style="padding:10px 20px;background:none;border:none;cursor:pointer;font-size:14px;font-weight:600;color:#64748b">
        Problemas <span id="tabProblemasCount" style="background:#ef4444;color:#fff;padding:1px 8px;border-radius:10px;font-size:11px;margin-left:4px">0</span>
      </button>
    </div>

    <div style="display:flex;gap:12px;margin:12px 0;align-items:center;flex-wrap:wrap">
      <input id="rutasBuscar" type="text" placeholder="Buscar fleje, sector, tallerista..."
        oninput="filtrarUI()" style="flex:1;min-width:200px;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:14px" />
      <label id="lblIncompletas" style="font-size:13px;color:#334155;display:flex;gap:6px;align-items:center">
        <input id="rutasSoloIncompletas" type="checkbox" onchange="filtrarUI()" />
        Solo rutas incompletas
      </label>
      <button onclick="exportarCSV()" title="Exportar las rutas visibles a CSV"
        style="background:#fff;color:#334155;border:1px solid #cbd5e1;padding:8px 14px;border-radius:8px;font-size:13px;cursor:pointer">📥 CSV</button>
      <button id="btnConfirmarTodas" onclick="confirmarTodasOK()" title="Confirma todas las rutas OK visibles"
        style="background:#10b981;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:none">✓ Confirmar todas las OK</button>
    </div>

    <div id="rutasLista"></div>
  `;
  actualizarContadoresTabs();
}

function actualizarContadoresTabs() {
  const t = $("tabTrazarCount"); if (t) t.textContent = cardsTrazadas.length;
  const c = $("tabConfirmadasCount"); if (c) c.textContent = firmasConfirmadas.size;
}

function textoBuscable(fleje, desc, ruta, extra) {
  const partes = (ruta || []).map(p => (p.label || "") + " " + (p.desc || "")).join(" ");
  return norm(`Fleje ${fleje} ${desc || ""} ${extra || ""} ${partes}`);
}

function renderListaTrazar() {
  const lbl = $("lblIncompletas"); if (lbl) lbl.style.display = "";
  const btnTodas = $("btnConfirmarTodas"); if (btnTodas) btnTodas.style.display = "";
  rutasListaCache = cardsTrazadas.map(c => ({
    data: c,
    matchText: textoBuscable(c.fleje, c.desc, c.ruta),
    llegaTall: c.ruta.some(p => p.tipo === "tall" || p.tipo === "fabr")
  }));
  renderItemFn = (x) => renderCardRuta(x.data);
  filtrarUI();
}

function ocultarBtnTodas() {
  const btnTodas = $("btnConfirmarTodas"); if (btnTodas) btnTodas.style.display = "none";
}

async function renderListaConfirmadas() {
  const cont = $("rutasLista");
  if (!cont) return;
  const lbl = $("lblIncompletas"); if (lbl) lbl.style.display = "none";
  ocultarBtnTodas();
  cont.innerHTML = '<p style="color:#888">Cargando confirmadas...</p>';
  const { data, error } = await sb.from("Rutas_Confirmadas").select("*").order("confirmado_en", { ascending: false });
  if (error) { cont.innerHTML = '<p style="color:#b42318">Error: ' + esc(error.message) + '</p>'; return; }
  rutasListaCache = (data || []).map(r => ({
    data: r,
    matchText: textoBuscable(r.fleje, r.descripcion, r.ruta_json),
    llegaTall: true
  }));
  renderItemFn = (x) => renderCardConfirmada(x.data);
  if (!rutasListaCache.length) { cont.innerHTML = '<p style="color:#64748b;padding:20px;text-align:center">Sin rutas confirmadas aún.</p>'; return; }
  filtrarUI();
}

/* =========================================================
   FILTRO + RENDER CARDS
========================================================= */
function filtrarUI() {
  const q = norm(($("rutasBuscar") || {}).value || "");
  const soloIncompletas = ($("rutasSoloIncompletas") || {}).checked;
  const cont = $("rutasLista");
  if (!cont || !renderItemFn) return;
  const out = [];
  for (const x of rutasListaCache) {
    if (soloIncompletas && x.llegaTall) continue;
    if (q && !x.matchText.includes(q)) continue;
    out.push(renderItemFn(x));
  }
  cont.innerHTML = out.length ? out.join("") : '<p style="color:#64748b;padding:20px;text-align:center">Sin resultados.</p>';
}

function renderCardRuta(c) {
  const llegaTall = c.ruta.some(p => p.tipo === "tall" || p.tipo === "fabr");
  const badge = llegaTall
    ? '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px">OK</span>'
    : '<span style="background:#fee;color:#b42318;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px">Incompleta</span>';

  const btnConfirmar = llegaTall
    ? `<button onclick="confirmarRuta('${esc(c.firma)}')" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">✓ Confirmar</button>`
    : `<button disabled title="Solo se pueden confirmar rutas completas" style="background:#cbd5e1;color:#64748b;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:not-allowed">✓ Confirmar</button>`;

  const btnRevisar = `<button onclick="marcarRevisar('${esc(c.firma)}')" title="Marca esta ruta para revisar más tarde. Podés agregar el motivo desde la tab Problemas." style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;padding:6px 12px;border-radius:6px;font-size:12px;cursor:pointer;margin-right:6px">📌 Revisar después</button>`;
  const btnReportar = `<button onclick="abrirReporteProblema('${esc(c.firma)}')" style="background:#fef2f2;color:#b42318;border:1px solid #fecaca;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;margin-right:6px">⚠ Reportar problema</button>`;

  return `<div class="ruta-card" data-firma="${esc(c.firma)}"
       style="margin:10px 0;padding:12px 14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px${llegaTall ? '' : ';border-left:4px solid #fbbf24'}">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div>
        <b style="font-size:14px;color:#0f172a">Fleje ${esc(c.fleje)}</b>
        <span style="color:#64748b;font-size:12px;margin-left:8px">${esc(c.desc)}</span>
        ${badge}
      </div>
      <div>${btnRevisar}${btnReportar}${btnConfirmar}</div>
    </div>
    ${renderRuta(c.ruta)}
    ${renderMovimientosStock(c.ruta)}
  </div>`;
}

// Para cada tramo (PS / Tallerista), describe el movimiento esperado de stock.
// Esta es LA LÓGICA QUE SE CONFIRMA cuando el usuario aprueba la ruta.
function renderMovimientosStock(pasos) {
  const mov = [];
  for (let i = 0; i < pasos.length - 1; i++) {
    const actual = pasos[i];
    const siguiente = pasos[i + 1];

    // PS: el anterior es lo que se envía, el siguiente (después del PS) es lo que devuelve
    if (siguiente.tipo === "ps") {
      const sig2 = pasos[i + 2]; // destino después del PS
      const origen = actual.label;
      const psName = siguiente.label;
      if (sig2 && sig2.tipo !== "ps") {
        mov.push(`🏭 <b>Envío a ${esc(psName)}</b>: descuenta stock <b>${esc(origen)}</b> → suma stock PS.
                  <br>&nbsp;&nbsp;&nbsp;<b>Entrega de ${esc(psName)}</b>: descuenta stock PS → suma stock <b>${esc(sig2.label)}</b>.`);
      } else {
        mov.push(`🏭 <b>Envío a ${esc(psName)}</b>: descuenta stock <b>${esc(origen)}</b> → suma stock PS (tránsito).`);
      }
    }

    // Tallerista: el anterior es lo que se envía al taller
    if (siguiente.tipo === "tall") {
      mov.push(`👷 <b>Envío a ${esc(siguiente.label)}</b>: descuenta stock <b>${esc(actual.label)}</b> → suma stock Tallerista.
                <br>&nbsp;&nbsp;&nbsp;<b>Entrega del Tallerista</b>: descuenta stock Tallerista (producción terminada).`);
    }
  }
  if (!mov.length) return "";
  return `<details style="margin-top:10px;padding:8px 10px;background:#f8fafc;border-radius:6px;border:1px dashed #cbd5e1;font-size:12px;color:#334155">
    <summary style="cursor:pointer;font-weight:600;color:#475569">Ver movimientos de stock que implica esta ruta</summary>
    <div style="margin-top:6px;line-height:1.6">${mov.join("<br>")}</div>
  </details>`;
}

function renderCardConfirmada(r) {
  const ruta = r.ruta_json || [];
  // Si la firma confirmada no está más en las generadas = obsoleta (cambió Causa-Efecto/PS/Tall)
  const obsoleta = firmasGeneradasActual.size > 0 && !firmasGeneradasActual.has(r.firma);
  const badgeObsoleta = obsoleta
    ? '<span style="background:#fee;color:#b42318;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px" title="Esta ruta ya no se genera con el grafo actual. Cambió Causa-Efecto o Partes x PS/Tall.">⚠ Obsoleta</span>'
    : '';
  const borderColor = obsoleta ? '#b42318' : '#10b981';
  const bgColor = obsoleta ? '#fef2f2' : '#f0fdf4';
  return `<div class="ruta-card-confirmada"
       style="margin:10px 0;padding:12px 14px;background:${bgColor};border:1px solid ${obsoleta ? '#fecaca' : '#bbf7d0'};border-left:4px solid ${borderColor};border-radius:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div>
        <b style="font-size:14px;color:#0f172a">Fleje ${esc(r.fleje)}</b>
        <span style="color:#64748b;font-size:12px;margin-left:8px">${esc(r.descripcion || "")}</span>
        <span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px">✓ Confirmada</span>
        ${badgeObsoleta}
        <span style="color:#94a3b8;font-size:11px;margin-left:8px">${esc(formatFecha(r.confirmado_en))}</span>
      </div>
      <button onclick="desconfirmarRuta('${esc(r.id)}')" style="background:#fee;color:#b42318;border:1px solid #fecaca;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer">Desconfirmar</button>
    </div>
    ${renderRuta(ruta)}
  </div>`;
}

const COLORES = {
  fleje:  { bg: "#6366f1", icon: "🔩" },
  matriz: { bg: "#f59e0b", icon: "⚙️" },
  sc:     { bg: "#10b981", icon: "📦" },
  sp:     { bg: "#3b82f6", icon: "🔧" },
  ps:     { bg: "#f43f5e", icon: "🏭" },
  tall:   { bg: "#8b5cf6", icon: "👷" },
  fabr:   { bg: "#334155", icon: "🔨" },
  dead:   { bg: "#94a3b8", icon: "⚠️" },
  otro:   { bg: "#64748b", icon: "•"  }
};

function renderRuta(pasos) {
  const nodos = pasos.map(p => {
    const c = COLORES[p.tipo] || COLORES.otro;
    const descLine = p.desc
      ? `<span style="font-size:10px;opacity:0.9;font-weight:400">${esc(p.desc)}</span>`
      : "";
    return `<span style="display:inline-flex;flex-direction:column;align-items:flex-start;gap:1px;background:${c.bg};color:#fff;padding:4px 10px;border-radius:6px;line-height:1.2">
      <span style="font-size:12px;font-weight:600;white-space:nowrap">${c.icon} ${esc(p.label)}</span>
      ${descLine}
    </span>`;
  }).join('<span style="color:#64748b;margin:0 3px;align-self:center">›</span>');
  return `<div class="ruta-flow" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">${nodos}</div>`;
}

function formatFecha(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("es-AR") + " " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

/* =========================================================
   CONFIRMAR / DESCONFIRMAR
========================================================= */
async function confirmarRuta(firma) {
  const card = cardsTrazadas.find(c => c.firma === firma);
  if (!card) return;
  const { error } = await sb.from("Rutas_Confirmadas").insert({
    fleje: card.fleje,
    descripcion: card.desc,
    ruta_json: card.ruta,
    firma: card.firma,
    confirmado_por: "Thomas Personal"
  });
  if (error) { alert("Error al confirmar: " + error.message); return; }
  firmasConfirmadas.add(card.firma);
  cardsTrazadas = cardsTrazadas.filter(c => c.firma !== firma);
  actualizarContadoresTabs();
  filtrarUI();
  setStatus(`${cardsTrazadas.length} rutas por revisar · ${firmasConfirmadas.size} confirmadas`);
}

async function desconfirmarRuta(id) {
  if (!confirm("¿Seguro que querés desconfirmar esta ruta? Volverá a aparecer en Trazar Rutas.")) return;
  const { data, error } = await sb.from("Rutas_Confirmadas").delete().eq("id", id).select();
  if (error) { alert("Error: " + error.message); return; }
  if (data && data[0]) firmasConfirmadas.delete(data[0].firma);
  actualizarContadoresTabs();
  renderListaConfirmadas();
  setStatus(`${firmasConfirmadas.size} confirmadas`);
}

/* =========================================================
   PROBLEMAS
========================================================= */
async function abrirReporteProblema(firma) {
  const card = cardsTrazadas.find(c => c.firma === firma);
  if (!card) return;
  const problema = prompt(
    "¿Qué está mal en esta ruta? Describí el problema para que se arregle en Causa-Efecto / Partes x PS / Partes x Tallerista.\n\nEjemplos:\n- Falta el paso por Matriz X\n- El PS no debería ser Pedernera, es Daniel\n- Falta agregar tallerista Carlos además de Martin"
  );
  if (!problema || !problema.trim()) return;
  await guardarProblema(card, problema.trim());
  alert("Problema reportado. Se puede ver/resolver en la tab 'Problemas'.");
}

// Marca la ruta para revisar más tarde sin pedir motivo (atajo rápido).
async function marcarRevisar(firma) {
  const card = cardsTrazadas.find(c => c.firma === firma);
  if (!card) return;
  await guardarProblema(card, REVISAR_TAG);
}

async function guardarProblema(card, texto) {
  const { error } = await sb.from("Rutas_Problemas").insert({
    fleje: card.fleje,
    descripcion_fleje: card.desc,
    ruta_json: card.ruta,
    firma: card.firma,
    problema: texto,
    reportado_por: "Thomas Personal"
  });
  if (error) { alert("Error: " + error.message); return; }
  // Quitar de cards trazadas para que no aparezca más en "Trazar Rutas" hasta resolver.
  cardsTrazadas = cardsTrazadas.filter(c => c.firma !== card.firma);
  filtrarUI();
  actualizarContadoresTabsAsync();
  setStatus(`${cardsTrazadas.length} rutas por revisar · problema registrado`);
}

// Editar el texto del problema (para cuando sí querés explicar qué estaba mal).
async function editarProblema(id, textoActual) {
  const nuevo = prompt("Editar descripción del problema:", textoActual || "");
  if (nuevo === null) return; // cancelado
  const txt = nuevo.trim();
  if (!txt) { alert("No puede quedar vacío."); return; }
  const { error } = await sb.from("Rutas_Problemas").update({ problema: txt }).eq("id", id);
  if (error) { alert("Error: " + error.message); return; }
  renderListaProblemas();
}

async function renderListaProblemas() {
  const cont = $("rutasLista");
  if (!cont) return;
  const lbl = $("lblIncompletas"); if (lbl) lbl.style.display = "none";
  ocultarBtnTodas();
  cont.innerHTML = '<p style="color:#888">Cargando problemas...</p>';
  const { data, error } = await sb.from("Rutas_Problemas").select("*")
    .neq("problema", REVISAR_TAG)
    .order("estado", { ascending: true })
    .order("reportado_en", { ascending: false });
  if (error) { cont.innerHTML = '<p style="color:#b42318">Error: ' + esc(error.message) + '</p>'; return; }
  rutasListaCache = (data || []).map(p => ({
    data: p,
    matchText: textoBuscable(p.fleje, p.descripcion_fleje, p.ruta_json, p.problema),
    llegaTall: true
  }));
  renderItemFn = (x) => renderCardProblema(x.data);
  if (!rutasListaCache.length) { cont.innerHTML = '<p style="color:#64748b;padding:20px;text-align:center">Sin problemas reportados.</p>'; return; }
  filtrarUI();
}

async function renderListaRevisar() {
  const cont = $("rutasLista");
  if (!cont) return;
  const lbl = $("lblIncompletas"); if (lbl) lbl.style.display = "none";
  ocultarBtnTodas();
  cont.innerHTML = '<p style="color:#888">Cargando pendientes de revisar...</p>';
  const { data, error } = await sb.from("Rutas_Problemas").select("*")
    .eq("problema", REVISAR_TAG)
    .eq("estado", "pendiente")
    .order("reportado_en", { ascending: false });
  if (error) { cont.innerHTML = '<p style="color:#b42318">Error: ' + esc(error.message) + '</p>'; return; }
  rutasListaCache = (data || []).map(p => ({
    data: p,
    matchText: textoBuscable(p.fleje, p.descripcion_fleje, p.ruta_json),
    llegaTall: true
  }));
  renderItemFn = (x) => renderCardRevisar(x.data);
  if (!rutasListaCache.length) {
    cont.innerHTML = '<p style="color:#64748b;padding:20px;text-align:center">Nada para revisar. Usá el botón 📌 en Trazar Rutas para marcar una ruta y volver después.</p>';
    return;
  }
  filtrarUI();
}

function renderCardRevisar(p) {
  return `<div style="margin:10px 0;padding:12px 14px;background:#fffbeb;border:1px solid #fcd34d;border-left:4px solid #f59e0b;border-radius:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div>
        <b style="font-size:14px;color:#0f172a">📌 Fleje ${esc(p.fleje)}</b>
        <span style="color:#64748b;font-size:12px;margin-left:8px">${esc(p.descripcion_fleje || "")}</span>
        <span style="color:#94a3b8;font-size:11px;margin-left:8px">marcada ${esc(formatFecha(p.reportado_en))}</span>
      </div>
      <div>
        <button onclick="editarProblema('${esc(p.id)}', ${JSON.stringify("").replace(/"/g, '&quot;')})" title="Escribir motivo → pasa a Problemas" style="background:#fef2f2;color:#b42318;border:1px solid #fecaca;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;margin-right:6px">✎ Describir problema</button>
        <button onclick="descartarRevisar('${esc(p.id)}')" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer">✓ Estaba OK</button>
      </div>
    </div>
    ${renderRuta(p.ruta_json || [])}
  </div>`;
}

async function descartarRevisar(id) {
  if (!confirm("Marcar como revisada y OK. La ruta va a volver a aparecer en Trazar Rutas para que la confirmes ahí.")) return;
  const { error } = await sb.from("Rutas_Problemas").delete().eq("id", id);
  if (error) { alert("Error: " + error.message); return; }
  renderListaRevisar();
  actualizarContadoresTabsAsync();
}

function renderCardProblema(p) {
  const pendiente = p.estado === "pendiente";
  const color = pendiente ? "#fef2f2" : "#f0fdf4";
  const border = pendiente ? "#fecaca" : "#bbf7d0";
  const badgeEstado = pendiente
    ? '<span style="background:#ef4444;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px">Pendiente</span>'
    : '<span style="background:#10b981;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;margin-left:8px">Resuelto</span>';
  const btnAccion = pendiente
    ? `<button onclick="resolverProblema('${esc(p.id)}')" style="background:#10b981;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600">✓ Marcar resuelto</button>`
    : `<button onclick="reabrirProblema('${esc(p.id)}')" style="background:#f59e0b;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;cursor:pointer">Reabrir</button>`;
  const btnBorrar = `<button onclick="borrarProblema('${esc(p.id)}')" style="background:none;color:#b42318;border:1px solid #fecaca;padding:6px 10px;border-radius:6px;font-size:12px;cursor:pointer;margin-left:6px">🗑</button>`;

  return `<div style="margin:10px 0;padding:12px 14px;background:${color};border:1px solid ${border};border-radius:10px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div>
        <b style="font-size:14px;color:#0f172a">Fleje ${esc(p.fleje)}</b>
        <span style="color:#64748b;font-size:12px;margin-left:8px">${esc(p.descripcion_fleje || "")}</span>
        ${badgeEstado}
        <span style="color:#94a3b8;font-size:11px;margin-left:8px">${esc(formatFecha(p.reportado_en))}</span>
      </div>
      <div>${btnAccion}${btnBorrar}</div>
    </div>
    <div style="background:#fff;border:1px solid ${border};border-radius:6px;padding:8px 10px;margin-bottom:8px;font-size:13px;color:#7f1d1d;display:flex;justify-content:space-between;align-items:start;gap:8px">
      <div><b>Problema:</b> ${esc(p.problema)}</div>
      <button onclick="editarProblema('${esc(p.id)}', ${JSON.stringify(p.problema || "").replace(/"/g, '&quot;')})" style="background:none;color:#334155;border:1px solid #cbd5e1;padding:3px 10px;border-radius:6px;font-size:11px;cursor:pointer;flex-shrink:0">✎ Editar</button>
    </div>
    ${renderRuta(p.ruta_json || [])}
  </div>`;
}

async function resolverProblema(id) {
  const { error } = await sb.from("Rutas_Problemas").update({ estado: "resuelto", resuelto_en: new Date().toISOString() }).eq("id", id);
  if (error) { alert("Error: " + error.message); return; }
  renderListaProblemas();
  actualizarContadoresTabsAsync();
}

async function reabrirProblema(id) {
  const { error } = await sb.from("Rutas_Problemas").update({ estado: "pendiente", resuelto_en: null }).eq("id", id);
  if (error) { alert("Error: " + error.message); return; }
  renderListaProblemas();
  actualizarContadoresTabsAsync();
}

async function borrarProblema(id) {
  if (!confirm("¿Borrar este reporte de problema?")) return;
  const { error } = await sb.from("Rutas_Problemas").delete().eq("id", id);
  if (error) { alert("Error: " + error.message); return; }
  renderListaProblemas();
  actualizarContadoresTabsAsync();
}

async function actualizarContadoresTabsAsync() {
  actualizarContadoresTabs();
  const [pendRes, revRes] = await Promise.all([
    sb.from("Rutas_Problemas").select("*", { count: "exact", head: true }).eq("estado", "pendiente").neq("problema", REVISAR_TAG),
    sb.from("Rutas_Problemas").select("*", { count: "exact", head: true }).eq("problema", REVISAR_TAG).eq("estado", "pendiente")
  ]);
  const elP = $("tabProblemasCount");
  if (elP && pendRes.count != null) elP.textContent = pendRes.count;
  const elR = $("tabRevisarCount");
  if (elR && revRes.count != null) elR.textContent = revRes.count;
}

/* =========================================================
   BULK CONFIRM + EXPORTAR CSV
========================================================= */
async function confirmarTodasOK() {
  if (tabActual !== "trazar") return;
  // Tomar las visibles según filtro actual (mismas reglas que filtrarUI)
  const q = norm(($("rutasBuscar") || {}).value || "");
  const soloIncompletas = ($("rutasSoloIncompletas") || {}).checked;
  const candidatas = rutasListaCache.filter(x => {
    if (!x.llegaTall) return false;
    if (soloIncompletas) return false; // imposible llegaTall=true && soloIncompletas=true
    if (q && !x.matchText.includes(q)) return false;
    return true;
  });
  if (!candidatas.length) { alert("No hay rutas OK visibles para confirmar."); return; }
  if (!confirm(`Confirmar ${candidatas.length} rutas OK?\nVan a pasar a "Rutas Confirmadas".`)) return;
  const filas = candidatas.map(x => {
    const c = x.data;
    return {
      fleje: c.fleje,
      descripcion: c.desc,
      ruta_json: c.ruta,
      firma: c.firma,
      confirmado_por: "Thomas Personal"
    };
  });
  const { error } = await sb.from("Rutas_Confirmadas").insert(filas);
  if (error) { alert("Error al confirmar: " + error.message); return; }
  for (const f of filas) firmasConfirmadas.add(f.firma);
  cardsTrazadas = cardsTrazadas.filter(c => !firmasConfirmadas.has(c.firma));
  renderListaTrazar();
  actualizarContadoresTabsAsync();
  setStatus(`${candidatas.length} confirmadas en bloque · ${cardsTrazadas.length} restan en Trazar`);
}

function exportarCSV() {
  if (!rutasListaCache.length) { alert("No hay datos para exportar."); return; }
  // Aplicar el filtro actual antes de exportar
  const q = norm(($("rutasBuscar") || {}).value || "");
  const soloIncompletas = ($("rutasSoloIncompletas") || {}).checked;
  const items = rutasListaCache.filter(x => {
    if (soloIncompletas && x.llegaTall) return false;
    if (q && !x.matchText.includes(q)) return false;
    return true;
  });
  const filas = [["Fleje", "Descripcion", "Pasos", "Tipo", "Llega a Tallerista"]];
  for (const x of items) {
    const c = x.data;
    const ruta = c.ruta || c.ruta_json || [];
    const pasos = ruta.map(p => `${p.label}${p.desc ? " (" + p.desc + ")" : ""}`).join(" -> ");
    const fleje = c.fleje || "";
    const desc = c.desc || c.descripcion || c.descripcion_fleje || "";
    const tipo = c.problema ? "Problema" : (c.confirmado_en ? "Confirmada" : "Trazada");
    filas.push([fleje, desc, pasos, tipo, x.llegaTall ? "Si" : "No"]);
  }
  const csv = filas.map(row => row.map(v => {
    const s = String(v == null ? "" : v).replace(/"/g, '""');
    return `"${s}"`;
  }).join(",")).join("\r\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rutas_${tabActual}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* expose to HTML onclick */
window.trazarRutas = trazarRutas;
window.cambiarTab = cambiarTab;
window.filtrarUI = filtrarUI;
window.confirmarRuta = confirmarRuta;
window.desconfirmarRuta = desconfirmarRuta;
window.abrirReporteProblema = abrirReporteProblema;
window.marcarRevisar = marcarRevisar;
window.editarProblema = editarProblema;
window.descartarRevisar = descartarRevisar;
window.confirmarTodasOK = confirmarTodasOK;
window.exportarCSV = exportarCSV;
window.resolverProblema = resolverProblema;
window.reabrirProblema = reabrirProblema;
window.borrarProblema = borrarProblema;
