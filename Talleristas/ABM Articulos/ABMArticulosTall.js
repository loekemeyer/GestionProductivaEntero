const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const TABLA = "Articulos Virgilio X Tallerista";

const talleristasGrid = document.getElementById("talleristasGrid");
const statusEl        = document.getElementById("status");
const resultEl        = document.getElementById("result");
const btnVolver       = document.getElementById("btnVolver");
const toolsRow        = document.getElementById("toolsRow");
const txtBuscar       = document.getElementById("txtBuscar");
const btnAgregar      = document.getElementById("btnAgregar");

const modalAgregar       = document.getElementById("modalAgregar");
const modalAgregarClose  = document.getElementById("modalAgregarClose");
const btnCancelarAgregar = document.getElementById("btnCancelarAgregar");
const btnGuardarAgregar  = document.getElementById("btnGuardarAgregar");
const inpLinea           = document.getElementById("inpLinea");
const inpCodArt          = document.getElementById("inpCodArt");
const inpDesc            = document.getElementById("inpDesc");
const inpUniCaja         = document.getElementById("inpUniCaja");
const inpCodTall         = document.getElementById("inpCodTall");

const modalEliminar       = document.getElementById("modalEliminar");
const modalEliminarClose  = document.getElementById("modalEliminarClose");
const btnCancelarEliminar = document.getElementById("btnCancelarEliminar");
const btnConfirmarEliminar= document.getElementById("btnConfirmarEliminar");
const eliminarTexto       = document.getElementById("eliminarTexto");

let talleristaActivo = "";
let listaTalleristas = [];
let articulosTall    = [];
let eliminandoId     = null;

function setStatus(t){ statusEl.textContent = t || ""; }

function esc(s){
  return String(s || "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

function normalizeText(v){
  return String(v || "").trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ");
}

/* ── Talleristas ────────────────────────────────── */

function renderTalleristas(lista){
  talleristasGrid.innerHTML = "";
  lista.forEach(nombre => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tallerista-btn";
    btn.textContent = nombre;
    if(nombre === talleristaActivo) btn.classList.add("active");
    btn.addEventListener("click", () => seleccionarTallerista(nombre));
    talleristasGrid.appendChild(btn);
  });
}

async function cargarTalleristas(){
  setStatus("Cargando talleristas...");
  resultEl.innerHTML = "";

  const {data, error} = await sb.from(TABLA).select("Tallerista").limit(20000);

  if(error){
    setStatus("Error: " + (error.message || "sin detalle"));
    return;
  }

  listaTalleristas = [...new Set(
    (data || [])
      .map(r => String(r.Tallerista || "").trim())
      .filter(Boolean)
  )].sort((a,b) => a.localeCompare(b,"es"));

  renderTalleristas(listaTalleristas);
  setStatus(listaTalleristas.length ? "Selecciona un tallerista" : "No se encontraron talleristas");
}

function seleccionarTallerista(nombre){
  talleristaActivo = nombre;
  renderTalleristas([nombre]);
  btnVolver.classList.remove("hidden");
  toolsRow.classList.remove("hidden");
  txtBuscar.value = "";
  cargarArticulos();
}

function volverALista(){
  talleristaActivo = "";
  resultEl.innerHTML = "";
  articulosTall = [];
  setStatus("Selecciona un tallerista");
  btnVolver.classList.add("hidden");
  toolsRow.classList.add("hidden");
  txtBuscar.value = "";
  renderTalleristas(listaTalleristas);
}

btnVolver.addEventListener("click", volverALista);

/* ── Cargar y renderizar articulos ──────────────── */

async function cargarArticulos(){
  if(!talleristaActivo) return;
  setStatus("Cargando articulos...");
  resultEl.innerHTML = "";

  const {data, error} = await sb
    .from(TABLA)
    .select("*")
    .eq("Tallerista", talleristaActivo)
    .order("Linea", {ascending: true})
    .order("Cod_Art", {ascending: true})
    .limit(5000);

  if(error){
    setStatus("Error: " + (error.message || "sin detalle"));
    return;
  }

  articulosTall = data || [];
  renderArticulos();
}

function renderArticulos(){
  const q = normalizeText(txtBuscar.value);

  const filtrados = !q ? articulosTall : articulosTall.filter(r => {
    return normalizeText(r.Cod_Art).includes(q) ||
           normalizeText(r.Desc).includes(q) ||
           normalizeText(r.Linea).includes(q) ||
           normalizeText(r.Cod_Tallerista).includes(q);
  });

  setStatus(`${filtrados.length} articulo${filtrados.length !== 1 ? "s" : ""} de ${talleristaActivo}`);

  if(!filtrados.length){
    resultEl.innerHTML = "<p>Sin articulos asignados.</p>";
    return;
  }

  let rows = "";
  filtrados.forEach(r => {
    rows += `<tr>
      <td class="center">${esc(r.Linea)}</td>
      <td class="center">${esc(r.Cod_Art)}</td>
      <td>${esc(r.Desc)}</td>
      <td class="center">${r.Uni_x_Caja != null ? r.Uni_x_Caja : "-"}</td>
      <td class="center">${esc(r.Cod_Tallerista || "-")}</td>
      <td class="center">
        <button type="button" class="btn-eliminar" data-id="${r.id}" data-cod="${esc(r.Cod_Art)}" data-desc="${esc(r.Desc)}">Quitar</button>
      </td>
    </tr>`;
  });

  resultEl.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Linea</th>
          <th>Cod Art</th>
          <th>Descripcion</th>
          <th>Uni x Caja</th>
          <th>Cod Tall</th>
          <th>Accion</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  resultEl.querySelectorAll(".btn-eliminar").forEach(btn => {
    btn.addEventListener("click", () => {
      eliminandoId = Number(btn.dataset.id);
      eliminarTexto.innerHTML = `Vas a quitar el articulo <b>${esc(btn.dataset.cod)} - ${esc(btn.dataset.desc)}</b> de <b>${esc(talleristaActivo)}</b>.`;
      modalEliminar.classList.remove("hidden");
    });
  });
}

txtBuscar.addEventListener("input", renderArticulos);

/* ── Modal Agregar ──────────────────────────────── */

function abrirModalAgregar(){
  inpLinea.value = "LK";
  inpCodArt.value = "";
  inpDesc.value = "";
  inpUniCaja.value = "12";
  inpCodTall.value = "";
  btnGuardarAgregar.disabled = false;
  modalAgregar.classList.remove("hidden");
  inpCodArt.focus();
}

function cerrarModalAgregar(){
  modalAgregar.classList.add("hidden");
}

btnAgregar.addEventListener("click", abrirModalAgregar);
modalAgregarClose.addEventListener("click", cerrarModalAgregar);
btnCancelarAgregar.addEventListener("click", cerrarModalAgregar);
modalAgregar.addEventListener("click", e => { if(e.target === modalAgregar) cerrarModalAgregar(); });

btnGuardarAgregar.addEventListener("click", async () => {
  const linea   = inpLinea.value.trim();
  const codArt  = inpCodArt.value.trim();
  const desc    = inpDesc.value.trim();
  const uniCaja = parseInt(inpUniCaja.value) || 0;
  const codTall = inpCodTall.value.trim() || null;

  if(!codArt){
    alert("Ingresa el codigo de articulo.");
    inpCodArt.focus();
    return;
  }
  if(!desc){
    alert("Ingresa la descripcion.");
    inpDesc.focus();
    return;
  }
  if(uniCaja < 1){
    alert("Unidades x caja debe ser al menos 1.");
    inpUniCaja.focus();
    return;
  }

  btnGuardarAgregar.disabled = true;

  const {error} = await sb.from(TABLA).insert({
    Linea: linea,
    Cod_Art: codArt,
    Desc: desc,
    Tallerista: talleristaActivo,
    Uni_x_Caja: uniCaja,
    Cod_Tallerista: codTall,
    "Kg Recibido": 0
  });

  if(error){
    alert("Error al guardar: " + (error.message || "sin detalle"));
    btnGuardarAgregar.disabled = false;
    return;
  }

  cerrarModalAgregar();
  cargarArticulos();
});

/* ── Modal Eliminar ─────────────────────────────── */

function cerrarModalEliminar(){
  modalEliminar.classList.add("hidden");
  eliminandoId = null;
}

modalEliminarClose.addEventListener("click", cerrarModalEliminar);
btnCancelarEliminar.addEventListener("click", cerrarModalEliminar);
modalEliminar.addEventListener("click", e => { if(e.target === modalEliminar) cerrarModalEliminar(); });

btnConfirmarEliminar.addEventListener("click", async () => {
  if(!eliminandoId) return;

  btnConfirmarEliminar.disabled = true;

  const {error} = await sb.from(TABLA).delete().eq("id", eliminandoId);

  if(error){
    alert("Error al eliminar: " + (error.message || "sin detalle"));
    btnConfirmarEliminar.disabled = false;
    return;
  }

  btnConfirmarEliminar.disabled = false;
  cerrarModalEliminar();
  cargarArticulos();
});

/* ── Init ───────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", cargarTalleristas);
cargarTalleristas();
