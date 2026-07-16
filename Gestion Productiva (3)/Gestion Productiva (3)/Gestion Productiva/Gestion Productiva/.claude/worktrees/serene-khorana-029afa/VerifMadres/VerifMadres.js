const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// PK por tabla para updates
const PK = {
  "SC Kg": { col: "SC", type: "text" },
  "SP Kg": { col: "Sp", type: "text" },
  "Remaches SC": { col: "id", type: "text" },
  "Remaches SP": { col: "id", type: "text" },
  "Matrices": { col: "id", type: "num" }
};

const TABLAS = {
  "SC Kg": {
    sector: "SC", desc: "Descripcion",
    cols: [
      { field: "Kg X Uni", label: "Kg x Uni", type: "num" },
      { field: "KG x Cajon", label: "Kg x Cajon", type: "num" },
      { field: "N Fleje", label: "N Fleje", type: "text", skip: true },
      { field: "Max Caj Cerv", label: "Max Caj Cerv", type: "num" },
      { field: "Pieza Madre", label: "Pieza Madre", type: "text" },
      { field: "cod_verificacion", label: "Cod Verif", type: "text" }
    ]
  },
  "SP Kg": {
    sector: "Sp", desc: "Parte",
    cols: [
      { field: "Kg X Uni", label: "Kg x Uni", type: "num" },
      { field: "KG x Cajon", label: "Kg x Cajon", type: "num" },
      { field: "Max Cajon SP Total", label: "Max Cajones", type: "num" },
      { field: "Pieza Madre", label: "Pieza Madre", type: "text" },
      { field: "cod_verificacion", label: "Cod Verif", type: "text" }
    ]
  },
  "Remaches SC": {
    sector: "SC", desc: "Descripción",
    cols: [
      { field: "Kg x Uni", label: "Kg x Uni", type: "num" },
      { field: "Kg x Bolsa", label: "Kg x Bolsa", type: "num" },
      { field: "Max Caj/Bolsa", label: "Max Caj/Bolsa", type: "num" },
      { field: "Proveedor", label: "Proveedor", type: "text" },
      { field: "Pieza Madre", label: "Pieza Madre", type: "text" },
      { field: "cod_verificacion", label: "Cod Verif", type: "text" }
    ]
  },
  "Remaches SP": {
    sector: "SP", desc: "Descripción",
    cols: [
      { field: "Kg x Uni", label: "Kg x Uni", type: "num" },
      { field: "Kg x Bolsa", label: "Kg x Bolsa", type: "num" },
      { field: "Max Caj/Bolsa", label: "Max Caj/Bolsa", type: "num" },
      { field: "Proveedor", label: "Proveedor", type: "text" },
      { field: "Pieza Madre", label: "Pieza Madre", type: "text" },
      { field: "cod_verificacion", label: "Cod Verif", type: "text" }
    ]
  },
  "Matrices": {
    sector: "N_Matriz", desc: "Matriz",
    cols: [
      { field: "Uni_X_Golpe", label: "Uni x Golpe", type: "num" },
      { field: "Uni_X_Cajon", label: "Uni x Cajon", type: "num" },
      { field: "Cajones_X_Sector", label: "Cajones x Sector", type: "num" },
      { field: "SC", label: "SC", type: "text" },
      { field: "SP", label: "SP", type: "text" },
      { field: "Familia", label: "Familia", type: "text" },
      { field: "Tipo", label: "Tipo", type: "text" }
    ]
  }
};

let tablaActual = "SC Kg";
let datosCache = {};

function norm(s) { return String(s || "").trim().toLowerCase(); }

function esFaltante(val, tipo) {
  if (val === null || val === undefined) return true;
  const s = String(val).trim();
  if (s === "") return true;
  if (tipo === "num") {
    const n = parseFloat(s);
    return isNaN(n) || n === 0;
  }
  return false;
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatVal(val, tipo) {
  if (val === null || val === undefined || String(val).trim() === "") return "";
  if (tipo === "num") {
    const n = parseFloat(val);
    if (isNaN(n)) return String(val);
    const dec = Math.abs(n) > 0 && Math.abs(n) < 0.001 ? 6 : 3;
    return n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: dec });
  }
  return String(val);
}

async function fetchAll(tabla) {
  let all = [], from = 0, size = 1000;
  while (true) {
    const { data, error } = await sb.from(tabla).select("*").range(from, from + size - 1);
    if (error) throw error;
    all = all.concat(data || []);
    if (!data || data.length < size) break;
    from += size;
  }
  return all;
}

async function cargarTabla(nombre) {
  if (datosCache[nombre]) return datosCache[nombre];
  document.getElementById("status").textContent = "Cargando " + nombre + "...";
  const rows = await fetchAll(nombre);
  datosCache[nombre] = rows;
  return rows;
}

function renderTabla(rows, config, search, soloFaltantes) {
  const sKey = norm(search);
  let totalFaltantes = 0;
  const sectorField = config.sector;
  rows.sort((a, b) => String(a[sectorField] || "").localeCompare(String(b[sectorField] || ""), "es", { numeric: true }));

  const filtradas = rows.filter(r => {
    const sector = norm(r[config.sector]);
    const desc = norm(r[config.desc]);
    if (sKey && !sector.includes(sKey) && !desc.includes(sKey)) return false;

    const tieneFaltante = config.cols.some(c => !c.skip && esFaltante(r[c.field], c.type));
    if (tieneFaltante) totalFaltantes++;
    if (soloFaltantes && !tieneFaltante) return false;
    return true;
  });

  let html = '<div class="articulo">';
  html += '<div class="articulo-header">' + escapeHtml(tablaActual) + '</div>';
  html += '<div class="table-scroll"><table class="table">';
  html += '<thead><tr>';
  html += '<th>Sector</th><th>Descripcion</th>';
  for (const c of config.cols) html += '<th class="right">' + escapeHtml(c.label) + '</th>';
  html += '<th class="center" style="width:36px"></th>';
  html += '</tr></thead><tbody>';

  const pk = PK[tablaActual];
  for (const r of filtradas) {
    const pkVal = r[pk.col];
    html += '<tr data-pk="' + escapeHtml(String(pkVal)) + '">';
    html += '<td>' + escapeHtml(r[config.sector] || "") + '</td>';
    html += '<td>' + escapeHtml(r[config.desc] || "") + '</td>';
    for (const c of config.cols) {
      const val = r[c.field];
      const falta = esFaltante(val, c.type);
      html += '<td class="right' + (falta ? ' faltante' : '') + '" data-field="' + escapeHtml(c.field) + '" data-type="' + c.type + '">' + escapeHtml(formatVal(val, c.type) || (falta ? "---" : "")) + '</td>';
    }
    html += '<td class="center"><button class="btn-edit" title="Editar fila">&#9998;</button></td>';
    html += '</tr>';
  }

  html += '</tbody></table></div></div>';

  document.getElementById("status").textContent = filtradas.length + " registros" + (totalFaltantes > 0 ? ", " + totalFaltantes + " con faltantes" : "") + ".";
  document.getElementById("result").innerHTML = html;

  // Boton editar fila
  document.querySelectorAll(".btn-edit").forEach(btn => {
    btn.addEventListener("click", function() {
      const tr = this.closest("tr");
      if (tr.classList.contains("editing")) return;
      tr.classList.add("editing");
      const pkVal = tr.dataset.pk;
      const celdas = tr.querySelectorAll("td[data-field]");

      // Hacer celdas contenteditable
      celdas.forEach(td => {
        const text = td.textContent === "---" ? "" : td.textContent.replace(/\./g, "").replace(",", ".");
        td.dataset.original = text;
        td.contentEditable = true;
        td.textContent = text;
      });
      celdas[0].focus();

      // Reemplazar boton editar por guardar/cancelar
      const tdBtn = this.parentElement;
      tdBtn.innerHTML = '';
      const btnGuardar = document.createElement("button");
      btnGuardar.className = "btn-save";
      btnGuardar.textContent = "✓";
      btnGuardar.title = "Guardar";
      const btnCancelar = document.createElement("button");
      btnCancelar.className = "btn-cancel";
      btnCancelar.textContent = "✕";
      btnCancelar.title = "Cancelar";
      tdBtn.appendChild(btnGuardar);
      tdBtn.appendChild(btnCancelar);

      // Keydown en celdas
      celdas.forEach(td => {
        td.addEventListener("keydown", e => {
          if (e.key === "Enter") { e.preventDefault(); btnGuardar.click(); }
          if (e.key === "Escape") btnCancelar.click();
        });
      });

      btnCancelar.addEventListener("click", () => {
        celdas.forEach(td => {
          td.contentEditable = false;
          const tipo = td.dataset.type;
          const orig = td.dataset.original;
          const val = orig === "" ? null : (tipo === "num" ? parseFloat(orig) : orig);
          const falta = esFaltante(val, tipo);
          td.classList.toggle("faltante", falta);
          td.textContent = formatVal(val, tipo) || (falta ? "---" : "");
        });
        tr.classList.remove("editing");
        tdBtn.innerHTML = '<button class="btn-edit" title="Editar fila">&#9998;</button>';
        tdBtn.querySelector(".btn-edit").addEventListener("click", function() { refrescar(); });
      });

      btnGuardar.addEventListener("click", async () => {
        const updateObj = {};
        const newVals = {};
        celdas.forEach(td => {
          const field = td.dataset.field;
          const tipo = td.dataset.type;
          const newVal = td.textContent.trim();
          const parsed = tipo === "num" ? (newVal === "" ? null : parseFloat(newVal)) : (newVal === "" ? null : newVal);
          updateObj[field] = parsed;
          newVals[field] = { val: parsed, tipo };
        });

        try {
          const pkInfo = PK[tablaActual];
          const pkFilter = pkInfo.type === "num" ? Number(pkVal) : pkVal;
          const { error } = await sb.from(tablaActual).update(updateObj).eq(pkInfo.col, pkFilter);
          if (error) throw error;

          // Actualizar cache
          const cached = datosCache[tablaActual];
          if (cached) {
            const row = cached.find(r => String(r[pkInfo.col]) === String(pkVal));
            if (row) { for (const [f, v] of Object.entries(updateObj)) row[f] = v; }
          }

          // Volver a modo lectura
          celdas.forEach(td => {
            td.contentEditable = false;
            const field = td.dataset.field;
            const { val, tipo } = newVals[field];
            const falta = esFaltante(val, tipo);
            td.classList.toggle("faltante", falta);
            td.textContent = formatVal(val, tipo) || (falta ? "---" : "");
          });
          tr.classList.remove("editing");
          datosCache[tablaActual] = null; // limpiar cache
          refrescar();
          tr.style.background = "#f0fdf4";
          setTimeout(() => tr.style.background = "", 1500);
        } catch (e) {
          alert("Error al guardar: " + e.message);
        }
      });
    });
  });
}

async function refrescar() {
  try {
    const config = TABLAS[tablaActual];
    const rows = await cargarTabla(tablaActual);
    const search = document.getElementById("searchInput").value;
    const soloFaltantes = document.getElementById("chkFaltantes").checked;
    renderTabla(rows, config, search, soloFaltantes);
  } catch (e) {
    document.getElementById("status").textContent = "Error: " + e.message;
  }
}

// Tabs
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    tablaActual = btn.dataset.tabla;
    refrescar();
  });
});

// Search + filtro
document.getElementById("searchInput").addEventListener("input", refrescar);
document.getElementById("chkFaltantes").addEventListener("change", refrescar);

// Init
refrescar();
