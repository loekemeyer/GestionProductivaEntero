// Control Carga Remitos - Gestion Productiva
// Lee tabla Control_Carga_Remitos (populada por https://loekemeyer.github.io/Control-Carga-Remitos-FC/)

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const elStatus = document.getElementById("status");
const elTbody  = document.getElementById("tbody");
const elDesde  = document.getElementById("fDesde");
const elHasta  = document.getElementById("fHasta");
const elTall   = document.getElementById("selTall");
const elLinea  = document.getElementById("selLinea");
const elEstado = document.getElementById("selEstado");

let allRows = [];

function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function fmtFecha(d){
  if(!d) return "";
  const [y,m,day] = String(d).split("-");
  if(!day) return d;
  return `${day}/${m}/${y.slice(2)}`;
}
function fmtHora(h){
  if(!h) return "";
  return String(h).slice(0,5);
}
function fmtHoraCarga(ts, fechaRemito){
  // ts es ISO timestamptz, ej "2026-05-12T14:35:21.123+00:00"
  if(!ts) return "";
  const d = new Date(ts);
  if(isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  const isoDate = d.toISOString().slice(0,10); // YYYY-MM-DD
  // Si la fecha de carga != fecha del remito, marcar con diferencia en dias
  let suffix = "";
  if(fechaRemito && isoDate !== fechaRemito){
    const fr = new Date(fechaRemito + "T00:00:00");
    const diffMs = d.getTime() - fr.getTime();
    const diffDias = Math.round(diffMs / (1000*60*60*24));
    if(diffDias > 0) suffix = ` <span class="demora">(+${diffDias}d)</span>`;
  }
  return `${hh}:${mm}${suffix}`;
}

function tickHtml(b){
  return b ? '<span class="tick-ok">✓</span>' : '<span class="tick-no">✗</span>';
}

function clasificarRow(r){
  // ok: ISIS + foto / bad: falta algo
  return (r.tick_isis && r.tiene_foto) ? "row-ok" : "row-bad";
}

function render(rows){
  if(!rows.length){
    elTbody.innerHTML = `<tr><td colspan="9" class="empty">Sin registros</td></tr>`;
    elStatus.textContent = "0 remitos";
    return;
  }
  let html = "";
  for(const r of rows){
    const klass = clasificarRow(r);
    html += `<tr class="${klass}">
      <td>${esc(fmtFecha(r.fecha))}</td>
      <td>${esc(fmtHora(r.hora_envio_foto))}</td>
      <td title="${esc(r.created_at || "")}">${fmtHoraCarga(r.created_at, r.fecha)}</td>
      <td>${esc(r.codigo_tall)}</td>
      <td style="text-align:left;padding-left:10px">${esc(r.nombre_tall)}</td>
      <td>${esc(r.linea)}</td>
      <td>${tickHtml(r.tick_isis)}</td>
      <td>${tickHtml(r.tiene_foto)}</td>
      <td><span class="cod-envio">${esc(r.codigo_envio || "—")}</span></td>
    </tr>`;
  }
  elTbody.innerHTML = html;
  elStatus.textContent = `${rows.length} remito${rows.length===1?"":"s"}`;
}

function aplicarFiltros(){
  let rows = allRows.slice();
  const d = elDesde.value;
  const h = elHasta.value;
  const t = elTall.value;
  const l = elLinea.value;
  const e = elEstado.value;

  if(d) rows = rows.filter(r => r.fecha >= d);
  if(h) rows = rows.filter(r => r.fecha <= h);
  if(t !== "todos") rows = rows.filter(r => r.nombre_tall === t);
  if(l !== "todos") rows = rows.filter(r => r.linea === l);
  if(e === "completo"){
    rows = rows.filter(r => r.tick_isis && r.tiene_foto);
  } else if(e === "incompleto"){
    rows = rows.filter(r => !(r.tick_isis && r.tiene_foto));
  } else if(e === "sinFoto"){
    rows = rows.filter(r => !r.tiene_foto);
  }
  render(rows);
}

async function cargar(){
  elStatus.textContent = "Cargando...";
  const { data, error } = await sb
    .from("Control_Carga_Remitos")
    .select("*")
    .order("fecha", { ascending: false })
    .order("hora_envio_foto", { ascending: false })
    .limit(500);
  if(error){
    elStatus.textContent = `Error: ${error.message}`;
    console.error(error);
    return;
  }
  allRows = data || [];
  // poblar selector de talleristas
  const setTall = new Set(allRows.map(r => r.nombre_tall).filter(Boolean));
  const sortedTall = [...setTall].sort();
  elTall.innerHTML = '<option value="todos">Todos</option>' +
    sortedTall.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join("");
  aplicarFiltros();
}

// fecha default: hoy y 30 dias atras
(function initFechas(){
  const hoy = new Date();
  const atras = new Date(); atras.setDate(hoy.getDate() - 30);
  const toIso = d => d.toISOString().slice(0,10);
  elDesde.value = toIso(atras);
  elHasta.value = toIso(hoy);
})();

elDesde.addEventListener("change", aplicarFiltros);
elHasta.addEventListener("change", aplicarFiltros);
elTall.addEventListener("change", aplicarFiltros);
elLinea.addEventListener("change", aplicarFiltros);
elEstado.addEventListener("change", aplicarFiltros);

cargar();
