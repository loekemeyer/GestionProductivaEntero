"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const statusEl = document.getElementById("status");
const contenedorEl = document.getElementById("contenedor");
const txtBuscar = document.getElementById("txtBuscar");
const btnRefrescar = document.getElementById("btnRefrescar");

// Estado en memoria por articulo:
//   articulosCompartidos[cod_art] = {
//     cod_art, descripcion, talleristas: [{tallerista, porcentaje, dirty}], dirty
//   }
let articulosCompartidos = {};
let proporcionesBD = new Map(); // (cod_art, tallerista) → fila BD para upsert/delete tracking

function setStatus(msg, tipo){
  statusEl.textContent = msg || "";
  statusEl.className = "status" + (tipo ? " " + tipo : "");
}

function esc(s){ return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function normalizeText(s){
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().trim();
}

async function fetchAll(tabla){
  const out = []; const PAGE = 1000; let from = 0;
  while (true){
    const { data, error } = await sb.from(tabla).select("*").range(from, from + PAGE - 1);
    if (error) throw new Error(tabla + ": " + error.message);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function init(){
  setStatus("Cargando datos...");
  try {
    const [articulosVxT, despiece, proporciones] = await Promise.all([
      fetchAll("Articulos Virgilio X Tallerista"),
      fetchAll("Despiece x Articulo"),
      fetchAll("Proporcion_Articulo_Tallerista")
    ]);

    // Construir articuloPorGrj desde Despiece (sector Proce GRJ + COD numerico → articulo armado)
    const articuloPorGrj = new Map(); // grj → Set<cod_articulo numerico>
    despiece.forEach(r => {
      const cod = String(r["COD"] || "").trim();
      const sector = String(r["Sector Proce"] || "").trim();
      if (!cod || !sector) return;
      if (sector.toUpperCase().startsWith("GRJ") && /^\d+$/.test(cod)) {
        if (!articuloPorGrj.has(sector)) articuloPorGrj.set(sector, new Set());
        articuloPorGrj.get(sector).add(cod);
      }
    });

    // Descripcion por cod_articulo (de Despiece, primer ARTICULO encontrado)
    const descPorCod = new Map();
    despiece.forEach(r => {
      const cod = String(r["COD"] || "").trim();
      const art = String(r["ARTICULO"] || "").trim();
      if (cod && art && !descPorCod.has(cod)) descPorCod.set(cod, art);
    });

    // talleristasPorArticulo: cod numerico → Set<tallerista>
    const talleristasPorArticulo = new Map();
    articulosVxT.forEach(r => {
      const tallerista = String(r["Tallerista"] || "").trim();
      const codArt = String(r["Cod_Art"] || "").trim();
      if (!tallerista || !codArt) return;

      if (/^\d+$/.test(codArt)) {
        // Cod_Art numerico directo
        if (!talleristasPorArticulo.has(codArt)) talleristasPorArticulo.set(codArt, new Set());
        talleristasPorArticulo.get(codArt).add(tallerista);
      } else if (/^(GRJ|CP)/i.test(codArt)) {
        // GRJ → mapea a uno o mas articulos numericos
        const arts = articuloPorGrj.get(codArt);
        if (arts && arts.size) {
          arts.forEach(art => {
            if (!talleristasPorArticulo.has(art)) talleristasPorArticulo.set(art, new Set());
            talleristasPorArticulo.get(art).add(tallerista);
          });
        }
      }
    });

    // Filtrar a solo compartidos (≥2 talleristas)
    articulosCompartidos = {};
    for (const [cod, tallSet] of talleristasPorArticulo.entries()) {
      if (tallSet.size >= 2) {
        articulosCompartidos[cod] = {
          cod_art: cod,
          descripcion: descPorCod.get(cod) || "",
          talleristas: [...tallSet].sort().map(t => ({
            tallerista: t,
            porcentaje: 0, // se llenara abajo si hay fila en proporcionesBD
            dirty: false,
            existeEnBD: false
          })),
          dirty: false
        };
      }
    }

    // Aplicar proporciones existentes
    proporcionesBD = new Map();
    proporciones.forEach(r => {
      const cod = String(r.cod_art || "").trim();
      const tall = String(r.tallerista || "").trim();
      const prop = Number(r.proporcion || 0);
      proporcionesBD.set(`${cod}__${tall}`, r);
      if (articulosCompartidos[cod]) {
        const fila = articulosCompartidos[cod].talleristas.find(x => x.tallerista === tall);
        if (fila) {
          fila.porcentaje = prop * 100;
          fila.existeEnBD = true;
        } else {
          // Tallerista en BD pero no detectado como compartido (posible drift) — agregar igual
          articulosCompartidos[cod].talleristas.push({
            tallerista: tall,
            porcentaje: prop * 100,
            dirty: false,
            existeEnBD: true
          });
        }
      }
    });

    const totalArticulos = Object.keys(articulosCompartidos).length;
    setStatus(`${totalArticulos} articulos compartidos`, "ok");
    renderTodos();
  } catch (err){
    console.error(err);
    setStatus("Error cargando datos: " + err.message, "bad");
  }
}

function renderTodos(){
  const q = normalizeText(txtBuscar.value);
  const cods = Object.keys(articulosCompartidos).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a.localeCompare(b);
  });

  const filtrados = q
    ? cods.filter(cod => {
        const a = articulosCompartidos[cod];
        return normalizeText(cod).includes(q) || normalizeText(a.descripcion).includes(q);
      })
    : cods;

  if (!filtrados.length) {
    contenedorEl.innerHTML = '<div class="empty">No hay articulos compartidos para mostrar.</div>';
    return;
  }

  contenedorEl.innerHTML = filtrados.map(cod => renderCard(articulosCompartidos[cod])).join("");
  bindCardEvents();
}

function renderCard(a){
  const sumaPct = a.talleristas.reduce((s, t) => s + Number(t.porcentaje || 0), 0);
  const claseSum = sumaPct === 0
    ? "sum-zero"
    : (Math.abs(sumaPct - 100) < 0.01 ? "sum-100" : "sum-not-100");
  const iconSum = sumaPct === 0 ? "❌" : (Math.abs(sumaPct - 100) < 0.01 ? "✅" : "⚠️");

  const filas = a.talleristas.map((t, idx) => `
    <div class="tallerista-row">
      <div class="tallerista-nombre" title="${esc(t.tallerista)}">${esc(t.tallerista)}${t.dirty ? '<span class="dirty-mark"> ●</span>' : ""}</div>
      <div class="tallerista-bar"><div class="tallerista-bar-fill" style="width:${Math.min(100, Math.max(0, t.porcentaje))}%"></div></div>
      <input type="number" class="input-pct" min="0" max="100" step="0.1"
        value="${t.porcentaje}"
        data-cod="${esc(a.cod_art)}" data-idx="${idx}">
      <span style="font-size:14px;color:#666;font-weight:500">%</span>
    </div>
  `).join("");

  return `
    <div class="articulo-card" data-cod="${esc(a.cod_art)}">
      <div class="articulo-header">
        <div class="articulo-titulo">
          <span class="cod">${esc(a.cod_art)}</span>
          ${esc(a.descripcion || "(sin descripcion)")}
        </div>
        <div class="articulo-total ${claseSum}">${iconSum} Suma: ${sumaPct.toFixed(1)}%</div>
      </div>
      ${filas}
      <div class="articulo-actions">
        <button class="btn-secondary" data-action="reset" data-cod="${esc(a.cod_art)}">Resetear</button>
        <button class="btn-primary" data-action="save" data-cod="${esc(a.cod_art)}" ${a.dirty ? "" : "disabled"}>Guardar</button>
      </div>
    </div>
  `;
}

function bindCardEvents(){
  contenedorEl.querySelectorAll(".input-pct").forEach(input => {
    input.addEventListener("input", e => {
      const cod = e.target.dataset.cod;
      const idx = Number(e.target.dataset.idx);
      let v = Number(e.target.value);
      if (isNaN(v) || v < 0) v = 0;
      if (v > 100) v = 100;
      const a = articulosCompartidos[cod];
      if (!a) return;
      a.talleristas[idx].porcentaje = v;
      a.talleristas[idx].dirty = true;
      a.dirty = true;
      // Re-render solo esa card para mantener foco
      const cardEl = contenedorEl.querySelector(`.articulo-card[data-cod="${CSS.escape(cod)}"]`);
      if (cardEl) {
        cardEl.outerHTML = renderCard(a);
        bindCardEvents();
        // Restaurar foco al input
        const sel = `.input-pct[data-cod="${CSS.escape(cod)}"][data-idx="${idx}"]`;
        const restored = contenedorEl.querySelector(sel);
        if (restored) {
          restored.focus();
          restored.setSelectionRange(restored.value.length, restored.value.length);
        }
      }
    });
  });

  contenedorEl.querySelectorAll('[data-action="save"]').forEach(btn => {
    btn.addEventListener("click", () => guardarArticulo(btn.dataset.cod));
  });

  contenedorEl.querySelectorAll('[data-action="reset"]').forEach(btn => {
    btn.addEventListener("click", () => resetearArticulo(btn.dataset.cod));
  });
}

async function guardarArticulo(cod){
  const a = articulosCompartidos[cod];
  if (!a) return;

  const sumaPct = a.talleristas.reduce((s, t) => s + Number(t.porcentaje || 0), 0);
  if (Math.abs(sumaPct - 100) >= 0.01 && sumaPct !== 0) {
    if (!confirm(`Suma de proporciones es ${sumaPct.toFixed(1)}% (deberia ser 100%). Guardar igual?`)) return;
  }

  setStatus(`Guardando ${cod}...`);

  // Upsert por cada tallerista con porcentaje > 0
  // Delete las que tenian fila en BD pero ahora 0%
  const upserts = [];
  const deletes = [];
  for (const t of a.talleristas) {
    const key = `${cod}__${t.tallerista}`;
    const filaBD = proporcionesBD.get(key);
    if (Number(t.porcentaje) > 0) {
      upserts.push({
        cod_art: cod,
        tallerista: t.tallerista,
        proporcion: Number(t.porcentaje) / 100,
        notas: filaBD ? filaBD.notas : null,
        updated_at: new Date().toISOString()
      });
    } else if (filaBD) {
      deletes.push(filaBD.id);
    }
  }

  try {
    if (upserts.length) {
      const { error } = await sb.from("Proporcion_Articulo_Tallerista").upsert(upserts, { onConflict: "cod_art,tallerista" });
      if (error) throw error;
    }
    if (deletes.length) {
      const { error } = await sb.from("Proporcion_Articulo_Tallerista").delete().in("id", deletes);
      if (error) throw error;
    }

    // Marcar como limpio y recargar la fila
    a.dirty = false;
    a.talleristas.forEach(t => { t.dirty = false; t.existeEnBD = Number(t.porcentaje) > 0; });
    setStatus(`${cod} guardado.`, "ok");
    renderTodos();
    // refrescar proporcionesBD localmente
    await refreshProporcionesBD();
  } catch (err){
    console.error(err);
    setStatus(`Error guardando ${cod}: ${err.message}`, "bad");
  }
}

async function refreshProporcionesBD(){
  const proporciones = await fetchAll("Proporcion_Articulo_Tallerista");
  proporcionesBD = new Map();
  proporciones.forEach(r => {
    const cod = String(r.cod_art || "").trim();
    const tall = String(r.tallerista || "").trim();
    proporcionesBD.set(`${cod}__${tall}`, r);
  });
}

async function resetearArticulo(cod){
  const a = articulosCompartidos[cod];
  if (!a) return;

  // Detectar si hay filas en BD para este articulo
  const filasBD = a.talleristas
    .map(t => proporcionesBD.get(`${cod}__${t.tallerista}`))
    .filter(Boolean);

  if (filasBD.length) {
    if (!confirm(`Borrar las proporciones guardadas de ${cod} (${filasBD.length} fila(s))? Esta accion es definitiva.`)) return;
    // DELETE en BD
    const { error } = await sb.from("Proporcion_Articulo_Tallerista").delete().eq("cod_art", cod);
    if (error) {
      alert("Error borrando en BD: " + error.message);
      return;
    }
    // Limpiar cache local
    a.talleristas.forEach(t => proporcionesBD.delete(`${cod}__${t.tallerista}`));
  }

  // Reset visual: todos a 0
  a.talleristas.forEach(t => {
    t.porcentaje = 0;
    t.dirty = false;
    t.existeEnBD = false;
  });
  a.dirty = false;
  renderTodos();
  setStatus(filasBD.length ? `Proporciones de ${cod} borradas.` : `${cod} reseteado.`, "ok");
}

txtBuscar.addEventListener("input", renderTodos);
btnRefrescar.addEventListener("click", init);

init();
