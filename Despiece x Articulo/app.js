"use strict";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const esc = (s) => { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; };
const setStatus = (t, cls) => {
  const el = $("status");
  if (!el) return;
  el.textContent = t || "";
  el.className = "status" + (cls ? " " + cls : "");
};

const PROV_AT = new Set(["Carriero","Lopez Jose","Manfer","Maspoli","Melinox","Paternal Goma","Pintos","The Plast"]);
const INTERNO = new Set(["Log/ Fabr","TN"]);

let CACHE = {
  articulos: [],
  ce: [],
  pxps: [],
  pxtall: [],
  articulos_cajas: [],
  cajas: []
};

async function cargarInicio() {
  setStatus("Cargando datos maestros…");
  const [arts, ce, pxps, pxtall, ac, cajas] = await Promise.all([
    sb.from("Despiece x Articulo").select('"COD","ARTICULO"').then(r => r.data || []),
    sb.from("Causa-Efecto").select('"Matriz","Descripcion Matriz","Descuenta","Aumenta"').then(r => r.data || []),
    sb.from("Partes x PS").select('"PS","Proceso","SC","SP","Parte"').then(r => r.data || []),
    sb.from("Articulos Virgilio X Tallerista").select('"Cod_Art","Desc","Tallerista","Uni_x_Caja"').then(r => r.data || []),
    sb.from("Articulos_Cajas").select('"Cod_Art","N_Caja","Uni_x_Caja","Descripcion"').then(r => r.data || []),
    sb.from("Cajas").select('"N_Caja","Sector","Descripcion","Medidas"').then(r => r.data || [])
  ]);
  CACHE.ce = ce;
  CACHE.pxps = pxps;
  CACHE.pxtall = pxtall;
  CACHE.articulos_cajas = ac;
  CACHE.cajas = cajas;

  // Armar lista única de artículos desde Despiece
  const seen = new Map();
  for (const a of arts) {
    if (!a.COD) continue;
    if (!seen.has(a.COD)) seen.set(a.COD, String(a.ARTICULO || "").trim());
  }
  CACHE.articulos = Array.from(seen.entries()).sort((a,b) => String(a[0]).localeCompare(String(b[0]),'es',{numeric:true}));

  const sel = $("selArt");
  sel.innerHTML = '<option value="">— elegí un artículo —</option>';
  for (const [cod, desc] of CACHE.articulos) {
    const opt = document.createElement("option");
    opt.value = cod;
    opt.textContent = `${cod} — ${desc}`;
    sel.appendChild(opt);
  }
  setStatus(`${CACHE.articulos.length} artículos cargados. Elegí uno y presioná "Trazar".`);
}

// Traza hacia atrás un sector. Devuelve array de pasos.
// Cada paso: { tipo: 'matriz'|'ps'|'fleje'|'compra', label, sector_prev, matriz, ps, proceso }
function trazarSector(sector, visitados = new Set(), profundidad = 0) {
  if (!sector || profundidad > 15) return [];
  if (visitados.has(sector)) return [{ tipo: 'loop', label: `(loop: ${sector})` }];
  visitados = new Set([...visitados, sector]);

  if (/^Fleje\s/i.test(sector)) {
    return [{ tipo: 'fleje', label: sector }];
  }

  // Buscar producción por Causa-Efecto (matriz interna) y agrupar por (Descuenta, DescripcionMatriz)
  const ceProduce = CACHE.ce.filter(r => r.Aumenta === sector);
  // Buscar producción por Partes x PS y agrupar por (SC, Proceso)
  const pxpsProduce = CACHE.pxps.filter(r => r.SP === sector);

  const pasos = [];

  // Agrupar CE: múltiples matrices con misma descripción + misma Descuenta -> 1 paso con lista de matrices
  const ceGrouped = new Map();
  for (const r of ceProduce) {
    const key = (r.Descuenta || '') + '|' + (r["Descripcion Matriz"] || '');
    if (!ceGrouped.has(key)) ceGrouped.set(key, []);
    ceGrouped.get(key).push(r);
  }
  for (const [, grupo] of ceGrouped) {
    const r0 = grupo[0];
    const descuenta = r0.Descuenta;
    const matrices = grupo.map(x => `Mat ${x.Matriz}`).join(' / ');
    const descMat = r0["Descripcion Matriz"] ? ' ' + r0["Descripcion Matriz"] : '';
    const label = matrices + descMat;
    if (!descuenta || descuenta === 'Fabr') {
      pasos.push({ tipo: 'fabr', label, sector_prev: 'Fabricación interna' });
      continue;
    }
    const prev = trazarSector(descuenta, visitados, profundidad + 1);
    pasos.push({ tipo: 'matriz', label, sector_prev: descuenta, ramas: prev });
  }

  // Agrupar PS: múltiples PS con mismo Proceso + mismo SC -> 1 paso con lista de PS apilados
  const psGrouped = new Map();
  for (const r of pxpsProduce) {
    const key = (r.SC || '') + '|' + (r.Proceso || '');
    if (!psGrouped.has(key)) psGrouped.set(key, []);
    psGrouped.get(key).push(r);
  }
  for (const [, grupo] of psGrouped) {
    const r0 = grupo[0];
    const sc = r0.SC;
    const parte = r0.Parte;
    const psList = grupo.map(x => x.PS);
    const procTxt = r0.Proceso ? ' (' + r0.Proceso + ')' : '';
    const label = psList.join(' / ') + procTxt;
    if (!sc) { pasos.push({ tipo: 'ps', label }); continue; }
    if (sc === 'ST') {
      // Buscar quién produjo ST con la misma Parte. Así resolvemos el "tránsito".
      const stProducers = CACHE.pxps.filter(p => p.SP === 'ST' && p.Parte === parte);
      if (stProducers.length === 0) {
        pasos.push({ tipo: 'ps_st', label, sector_prev: 'ST (sin origen)', nota: 'No se encontró quién produce ST para "' + parte + '"' });
        continue;
      }
      // Agrupar productores de ST
      const stGrouped = new Map();
      for (const sp of stProducers) {
        const k = (sp.SC || '') + '|' + (sp.Proceso || '');
        if (!stGrouped.has(k)) stGrouped.set(k, []);
        stGrouped.get(k).push(sp);
      }
      // Por cada productor de ST, construir ramificación: productor_ST -> su SC (y continuar)
      const ramasST = [];
      for (const [, g] of stGrouped) {
        const p0 = g[0];
        const psListST = g.map(x => x.PS);
        const labelST = psListST.join(' / ') + (p0.Proceso ? ' (' + p0.Proceso + ')' : '');
        const prevST = trazarSector(p0.SC, visitados, profundidad + 1);
        ramasST.push({ tipo: 'ps', label: labelST, sector_prev: p0.SC, ramas: prevST });
      }
      pasos.push({ tipo: 'ps', label, sector_prev: 'ST', ramas: ramasST });
      continue;
    }
    const prev = trazarSector(sc, visitados, profundidad + 1);
    pasos.push({ tipo: 'ps', label, sector_prev: sc, psList, ramas: prev });
  }

  // Si no hay productor interno, es compra o materia de otro origen
  if (pasos.length === 0) {
    pasos.push({ tipo: 'compra', label: 'Compra / materia externa', sector_prev: sector });
  }

  return pasos;
}

// Aplanar pasos en array de celdas lineal (cada "paso" = una columna)
function aplanar(pasos, acum = []) {
  const res = [];
  for (const p of pasos) {
    const cadena = [...acum, p];
    if (p.ramas && p.ramas.length > 0) {
      res.push(...aplanar(p.ramas, cadena));
    } else {
      res.push(cadena);
    }
  }
  return res;
}

function talleristasDe(cod) {
  return CACHE.pxtall
    .filter(t => t.Cod_Art === cod)
    .map(t => t.Tallerista)
    .filter(Boolean);
}

function resolverCaja(cod) {
  const ac = CACHE.articulos_cajas.find(a => a.Cod_Art === cod);
  if (!ac) return null;
  const caja = CACHE.cajas.find(c => c.N_Caja === ac.N_Caja);
  return {
    n_caja: ac.N_Caja,
    uni_x_caja: ac.Uni_x_Caja,
    sector: caja ? caja.Sector : null,
    medidas: caja ? caja.Medidas : null
  };
}

function renderTrace(cod) {
  const articulo = CACHE.articulos.find(([c]) => c === cod)?.[1] || "";
  const partesDespiece = [];
  sb.from("Despiece x Articulo")
    .select('"Sector Proce","Descripcion de partes","Partes x uni","Rubro","KGxUni"')
    .eq("COD", cod)
    .then(r => {
      const partes = r.data || [];
      const talleristas = talleristasDe(cod);
      const talTxt = talleristas.length ? talleristas.join(" / ") : "— sin asignar —";
      const caja = resolverCaja(cod);

      const destinoTipo = talleristas.every(t => PROV_AT.has(t)) && talleristas.length
        ? "Prov Art Terminado"
        : talleristas.some(t => INTERNO.has(t))
          ? "Fabricación interna"
          : "Tallerista";

      let html = `<div class="resumen">
        <b>Artículo ${esc(cod)}</b>: ${esc(articulo)}<br>
        <b>Destino:</b> ${esc(talTxt)} <span style="color:#64748b">(${destinoTipo})</span>
        ${caja ? `<br><b>Caja:</b> Nº${esc(caja.n_caja)} · sector ${esc(caja.sector || "?")} · ${esc(caja.medidas || "?")} · ${esc(caja.uni_x_caja)} uni/caja` : ""}
      </div>`;

      html += `<table class="trace"><thead><tr>
        <th>Item</th>
        <th>Descripción parte</th>
        <th>Sector</th>
        <th>Partes/uni</th>
        <th>Tallerista (destino)</th>
        <th>Paso anterior (proceso + entrada)</th>
      </tr></thead><tbody>`;

      let n = 1;
      for (const p of partes) {
        const sector = p["Sector Proce"];
        const desc = p["Descripcion de partes"] || "";
        const pxu = p["Partes x uni"] || "1";
        const rubro = p.Rubro || "";

        if (!sector) {
          // Cartón o sin sector
          html += `<tr>
            <td class="item-num">${n++}</td>
            <td>${esc(desc)}</td>
            <td class="cod">—</td>
            <td>${esc(pxu)}</td>
            <td class="tall">${esc(talTxt)}</td>
            <td class="origen">Compra (${esc(rubro || "packaging")})</td>
          </tr>`;
          continue;
        }

        const pasos = trazarSector(sector);
        const ramas = aplanar(pasos);

        if (ramas.length === 0) {
          html += `<tr>
            <td class="item-num">${n++}</td>
            <td>${esc(desc)}</td>
            <td class="cod">${esc(sector)}</td>
            <td>${esc(pxu)}</td>
            <td class="tall">${esc(talTxt)}</td>
            <td class="origen">Sin trazado</td>
          </tr>`;
          continue;
        }

        // Una fila por rama, con la cadena concatenada en última columna.
        // Dentro de cada paso, los PS/matrices multiples se apilan con <br> (ej "Rec Color / Jade / Daniel" -> vertical).
        for (let i = 0; i < ramas.length; i++) {
          const cadena = ramas[i];
          const cadenaHtml = cadena.map(c => {
            let txt = esc(c.label);
            if (c.sector_prev) txt += ' <span style="color:#94a3b8">←</span> <b>' + esc(c.sector_prev) + '</b>';
            return '<div class="paso-cell">' + txt + '</div>';
          }).join('<div class="paso-sep">⇐</div>');
          html += `<tr>
            <td class="item-num">${i === 0 ? n : ""}</td>
            <td>${i === 0 ? esc(desc) : '<span style="color:#94a3b8">(mismo item, otra rama)</span>'}</td>
            <td class="cod">${i === 0 ? esc(sector) : ""}</td>
            <td>${i === 0 ? esc(pxu) : ""}</td>
            <td class="tall">${i === 0 ? esc(talTxt) : ""}</td>
            <td class="origen"><div class="paso-row">${cadenaHtml}</div></td>
          </tr>`;
        }
        n++;
      }

      if (caja) {
        html += `<tr>
          <td class="item-num">${n++}</td>
          <td>Caja Nº${esc(caja.n_caja)}</td>
          <td class="cod">${esc(caja.sector || "—")}</td>
          <td>1/${esc(caja.uni_x_caja)}</td>
          <td class="tall">${esc(talTxt)}</td>
          <td class="origen">Compra (Caja ${esc(caja.medidas || "")})</td>
        </tr>`;
      }

      html += `</tbody></table>`;
      $("tablaWrap").innerHTML = html;
      setStatus(`Trazado de ${cod} listo (${n - 1} items).`, "ok");
      $("btnExport").disabled = false;
    });
}

function exportarCSV() {
  const filas = [];
  document.querySelectorAll("table.trace tr").forEach(tr => {
    const cells = Array.from(tr.children).map(td => '"' + td.innerText.replace(/"/g, '""') + '"');
    filas.push(cells.join(","));
  });
  const csv = "\ufeff" + filas.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `despiece_${$("selArt").value || "articulo"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.addEventListener("DOMContentLoaded", () => {
  $("btnTrazar").addEventListener("click", () => {
    const cod = $("selArt").value;
    if (!cod) { setStatus("Elegí un artículo primero.", "err"); return; }
    setStatus(`Trazando ${cod}…`);
    $("btnExport").disabled = true;
    renderTrace(cod);
  });
  $("btnExport").addEventListener("click", exportarCSV);
  cargarInicio().catch(e => { setStatus("Error cargando: " + e.message, "err"); });
});
