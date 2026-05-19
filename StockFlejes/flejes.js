"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const fechaEl = document.getElementById("fecha");
const sedeEl = document.getElementById("sede");
const buscarEl = document.getElementById("buscar");
const statusEl = document.getElementById("status");
const tblBody = document.getElementById("tblBody");

let flejesCache = [];

function esc(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* ================= INIT ================= */
async function init() {
  fechaEl.value = new Date().toISOString().slice(0, 10);

  statusEl.textContent = "Cargando flejes...";
  const { data, error } = await sb.from("Flejes").select("*");
  if (error) { statusEl.textContent = "Error: " + error.message; return; }

  flejesCache = (data || []).sort((a, b) => {
    const sa = String(a.Sector || "").toLowerCase();
    const sb2 = String(b.Sector || "").toLowerCase();
    if (sa !== sb2) return sa.localeCompare(sb2);
    return String(a["Descripción"] || "").localeCompare(String(b["Descripción"] || ""), "es");
  });

  renderTabla();
  statusEl.textContent = `${flejesCache.length} flejes cargados`;

  buscarEl.addEventListener("input", renderTabla);
}

/* ================= RENDER ================= */
function renderTabla() {
  const filtro = (buscarEl.value || "").trim().toLowerCase();

  let items = flejesCache;
  if (filtro) {
    items = items.filter(f => {
      const nf = String(f["N Fleje"] || "").toLowerCase();
      const desc = String(f["Descripción"] || "").toLowerCase();
      const sector = String(f.Sector || "").toLowerCase();
      const prov = String(f.Proveedor || "").toLowerCase();
      return nf.includes(filtro) || desc.includes(filtro) || sector.includes(filtro) || prov.includes(filtro);
    });
  }

  // Agrupar por proveedor
  const byProv = new Map();
  items.forEach(f => {
    const prov = f.Proveedor || "Sin proveedor";
    if (!byProv.has(prov)) byProv.set(prov, []);
    byProv.get(prov).push(f);
  });

  let html = "";
  byProv.forEach((flejes, prov) => {
    html += `<tr class="prov-header"><td colspan="10">${esc(prov)}</td></tr>`;
    flejes.forEach(f => {
      const nf = esc(f["N Fleje"] || "");
      const id = esc(f.id);
      html += `<tr data-id="${id}">
        <td class="col-nfleje">${nf}</td>
        <td class="col-desc" title="${esc(f["Descripción"] || "")}">${esc(f["Descripción"] || "")}</td>
        <td class="col-medida">${esc(f["Medida mm"] || "")}</td>
        <td class="col-prov">${esc(prov)}</td>
        <td class="rollo-cell">
          <div class="rollo-pair">
            <input class="rollo-input inp-num" data-f="${nf}" data-r="1n" placeholder="N°" />
            <input class="rollo-input inp-kg"  data-f="${nf}" data-r="1k" placeholder="Kg" />
          </div>
        </td>
        <td class="rollo-cell">
          <div class="rollo-pair">
            <input class="rollo-input inp-num" data-f="${nf}" data-r="2n" placeholder="N°" />
            <input class="rollo-input inp-kg"  data-f="${nf}" data-r="2k" placeholder="Kg" />
          </div>
        </td>
        <td class="rollo-cell">
          <div class="rollo-pair">
            <input class="rollo-input inp-num" data-f="${nf}" data-r="3n" placeholder="N°" />
            <input class="rollo-input inp-kg"  data-f="${nf}" data-r="3k" placeholder="Kg" />
          </div>
        </td>
        <td class="col-total" id="total-${nf}">0</td>
        <td><button class="btn-guardar" onclick="guardarFila('${nf}')">Guardar</button></td>
      </tr>`;
    });
  });

  tblBody.innerHTML = html;

  // Listeners para calcular total en tiempo real
  tblBody.querySelectorAll(".inp-kg").forEach(inp => {
    inp.addEventListener("input", () => {
      const nf = inp.dataset.f;
      calcularTotal(nf);
    });
  });
}

function calcularTotal(nf) {
  let total = 0;
  tblBody.querySelectorAll(`.inp-kg[data-f="${nf}"]`).forEach(inp => {
    const v = parseFloat(inp.value);
    if (!isNaN(v)) total += v;
  });
  const el = document.getElementById(`total-${nf}`);
  if (el) {
    el.textContent = total > 0 ? total.toLocaleString("es-AR", { maximumFractionDigits: 1 }) : "0";
    el.classList.toggle("has-value", total > 0);
  }
}

/* ================= GUARDAR ================= */
async function guardarFila(nf) {
  const fecha = fechaEl.value;
  const sede = sedeEl.value;
  if (!fecha) { alert("Selecciona una fecha"); return; }

  // Recopilar rollos con kg > 0
  const entradas = [];
  for (let i = 1; i <= 3; i++) {
    const numEl = tblBody.querySelector(`.inp-num[data-f="${nf}"][data-r="${i}n"]`);
    const kgEl = tblBody.querySelector(`.inp-kg[data-f="${nf}"][data-r="${i}k"]`);
    const kg = parseFloat(kgEl?.value);
    if (!isNaN(kg) && kg > 0) {
      entradas.push({
        N_Fleje: nf,
        fecha: fecha,
        sede: sede,
        kg: kg,
        n_orden: numEl?.value || null,
        nota: `Rollo ${i}`
      });
    }
  }

  if (!entradas.length) { alert("No hay kg cargados para este fleje"); return; }

  const btn = tblBody.querySelector(`tr[data-id] button.btn-guardar`);

  try {
    const { error } = await sb.from("Flejes_Entradas").insert(entradas);
    if (error) throw new Error(error.message);

    // Limpiar inputs y marcar fila
    const row = tblBody.querySelector(`[data-id] .inp-kg[data-f="${nf}"]`)?.closest("tr");
    if (row) {
      row.classList.add("row-saved");
      row.querySelectorAll(".rollo-input").forEach(inp => inp.value = "");
      calcularTotal(nf);
      setTimeout(() => row.classList.remove("row-saved"), 2000);
    }

    statusEl.textContent = `${entradas.length} rollo(s) de fleje ${nf} guardado(s)`;
  } catch (err) { alert("Error: " + err.message); }
}

/* ================= START ================= */
init();
