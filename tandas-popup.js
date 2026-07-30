/*
 * tandas-popup.js — popup reutilizable para cargar "tandas" (cargas parciales).
 *
 * API:
 *   tandasPopup.open({
 *     titulo: "Tandas — Martin A10",
 *     initial: [{caj: 10, kg: 250, uni: 0}, ...],  // opcional
 *     pedirCaj: true,    // si false, esconde columna Caj
 *     pedirKg: true,     // si false, esconde columna Kg
 *     pedirUni: false,   // si true, agrega columna Uni
 *     unidadCaj: "caj",  // label
 *     unidadKg: "kg",
 *     unidadUni: "uni",
 *     onConfirm: (tandas, totales) => { ... }
 *   });
 *
 * tandas = [{caj, kg, uni}, ...]
 * totales = { caj, kg, uni }
 */
(function(){
  "use strict";

  let overlay = null;
  let config = null;
  let tandas = [];

  function ensureDom(){
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "tandas-overlay";
    overlay.id = "tandasOverlay";
    overlay.innerHTML = `
      <div class="tandas-modal">
        <div class="tandas-head">
          <div class="titulo" id="tandasTitulo">Tandas</div>
          <button class="close-btn" id="tandasClose" type="button">✕</button>
        </div>
        <div class="tandas-body" id="tandasBody"></div>
        <div class="tandas-footer">
          <div class="tandas-msg" id="tandasMsg"></div>
          <button class="btn-ok" id="tandasOk" type="button">Listo</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", e => {
      if (e.target === overlay) cerrar();
    });
    document.getElementById("tandasClose").addEventListener("click", cerrar);
    document.getElementById("tandasOk").addEventListener("click", confirmar);
  }

  function abrirInner(opts){
    ensureDom();
    config = Object.assign({
      titulo: "Tandas",
      initial: [],
      pedirCaj: true,
      pedirKg: true,
      pedirUni: false,
      unidadCaj: "caj",
      unidadKg: "kg",
      unidadUni: "uni",
      multiplicar: false,   // si true, el total Kg = suma de (caj x kg) por tanda (ej. flejes: cant rollos x kg c/u)
      exigirCompletos: false, // si true, cada tanda con algún dato debe tener TODOS sus campos > 0 (nada vacío)
      grande: false,        // si true, popup y contenido más grandes (tablet)
      onConfirm: null
    }, opts || {});
    tandas = (config.initial || []).map(t => ({
      caj: Number(t.caj) || 0,
      kg: parseDecimal(t.kg),
      uni: Number(t.uni) || 0
    }));
    if (!tandas.length) tandas.push({ caj: 0, kg: 0, uni: 0 });
    document.getElementById("tandasTitulo").textContent = config.titulo;
    overlay.classList.toggle("tandas-lg", !!config.grande);
    mostrarMsg("");
    render();
    overlay.classList.add("open");
  }

  function mostrarMsg(txt){
    const m = document.getElementById("tandasMsg");
    if (m) m.textContent = txt || "";
  }

  function cerrar(){
    if (overlay) overlay.classList.remove("open");
  }

  function confirmar(){
    // Sincronizar valores del DOM antes de confirmar
    sincronizarInputs();
    // Campos pedidos en este popup
    const req = [];
    if (config.pedirCaj) req.push("caj");
    if (config.pedirKg) req.push("kg");
    if (config.pedirUni) req.push("uni");
    const val = (t, f) => f === "kg" ? (parseDecimal(t.kg) || 0) : (Number(t[f]) || 0);
    if (config.exigirCompletos){
      // Ninguna tanda que tenga algún dato puede dejar otro campo pedido vacío.
      const hayIncompleta = tandas.some(t => {
        const algo = req.some(f => val(t, f) > 0);
        return algo && req.some(f => !(val(t, f) > 0));
      });
      if (hayIncompleta){ mostrarMsg("Completá todos los campos de cada tanda (ninguno vacío)."); return; }
      const completas = tandas.filter(t => req.every(f => val(t, f) > 0));
      if (!completas.length){ mostrarMsg("Cargá al menos una tanda completa."); return; }
    }
    // Filtrar tandas vacias (todo 0); con exigirCompletos, solo las completas.
    const validas = config.exigirCompletos
      ? tandas.filter(t => req.every(f => val(t, f) > 0))
      : tandas.filter(t => t.caj > 0 || t.kg > 0 || t.uni > 0);
    const totales = {
      caj: validas.reduce((s, t) => s + (Number(t.caj) || 0), 0),
      kg: validas.reduce((s, t) => s + kgDe(t), 0),
      uni: validas.reduce((s, t) => s + (Number(t.uni) || 0), 0)
    };
    if (typeof config.onConfirm === "function"){
      config.onConfirm(validas, totales);
    }
    cerrar();
  }

  function sincronizarInputs(){
    const rows = overlay.querySelectorAll(".tanda-row");
    rows.forEach((row, i) => {
      if (!tandas[i]) return;
      const inputCaj = row.querySelector('input[data-fld="caj"]');
      const inputKg = row.querySelector('input[data-fld="kg"]');
      const inputUni = row.querySelector('input[data-fld="uni"]');
      if (inputCaj) tandas[i].caj = parseInt(inputCaj.value, 10) || 0;
      if (inputKg) tandas[i].kg = parseDecimal(inputKg.value);
      if (inputUni) tandas[i].uni = parseInt(inputUni.value, 10) || 0;
    });
  }

  // Kg que aporta una tanda: normal = su kg; con multiplicar = cant x kg (ej. flejes)
  function kgDe(t){
    const kg = parseDecimal(t.kg) || 0;
    return (config && config.multiplicar) ? (Number(t.caj) || 0) * kg : kg;
  }

  function parseDecimal(v){
    if (v == null || v === "") return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    let s = String(v).trim().replace(/[^\d,.-]/g, "");
    if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
  }

  function render(){
    const body = document.getElementById("tandasBody");
    // Calcular cuántas columnas activas (para grid)
    const cols = ["50px"]; // num
    const headers = ["#"];
    if (config.pedirCaj) { cols.push("1fr"); headers.push(config.unidadCaj.toUpperCase()); }
    if (config.pedirKg) { cols.push("1fr"); headers.push(config.unidadKg.toUpperCase()); }
    if (config.pedirUni) { cols.push("1fr"); headers.push(config.unidadUni.toUpperCase()); }
    cols.push("40px"); headers.push("");
    const gridCols = cols.join(" ");

    // Headers
    let html = `<div class="tandas-headers" style="grid-template-columns:${gridCols}">
      ${headers.map(h => `<div>${h}</div>`).join("")}
    </div>`;

    // Rows
    tandas.forEach((t, i) => {
      const cells = [`<div class="num">${i + 1}</div>`];
      if (config.pedirCaj) cells.push(`<input type="text" inputmode="numeric" data-idx="${i}" data-fld="caj" value="${t.caj || ''}" placeholder="0">`);
      if (config.pedirKg) cells.push(`<input type="text" inputmode="decimal" data-idx="${i}" data-fld="kg" value="${t.kg || ''}" placeholder="0,0">`);
      if (config.pedirUni) cells.push(`<input type="text" inputmode="numeric" data-idx="${i}" data-fld="uni" value="${t.uni || ''}" placeholder="0">`);
      cells.push(`<button class="del-btn" data-idx="${i}" type="button" title="Quitar tanda">✕</button>`);
      html += `<div class="tanda-row" style="grid-template-columns:${gridCols}">${cells.join("")}</div>`;
    });

    // Botón agregar
    html += `<div class="tandas-add-row"><button class="tandas-add-btn" id="tandasAddBtn" type="button">+ Agregar tanda</button></div>`;

    // Totales
    const totales = { caj: 0, kg: 0, uni: 0 };
    tandas.forEach(t => {
      totales.caj += Number(t.caj) || 0;
      totales.kg += kgDe(t);
      totales.uni += Number(t.uni) || 0;
    });
    const totalCells = [`<div class="lbl">Total</div>`];
    if (config.pedirCaj) totalCells.push(`<div>${totales.caj}</div>`);
    if (config.pedirKg) totalCells.push(`<div>${totales.kg.toLocaleString('es-AR', { maximumFractionDigits: 3 })}</div>`);
    if (config.pedirUni) totalCells.push(`<div>${totales.uni}</div>`);
    totalCells.push(`<div></div>`);
    html += `<div class="tandas-totales" style="grid-template-columns:${gridCols}">${totalCells.join("")}</div>`;

    body.innerHTML = html;

    // Wire events
    body.querySelectorAll("input").forEach(inp => {
      inp.addEventListener("input", () => {
        const fld = inp.dataset.fld;
        if (fld === "caj" || fld === "uni") inp.value = inp.value.replace(/\D/g, "");
        else inp.value = inp.value.replace(/[^0-9,.\-]/g, "");
        mostrarMsg("");
      });
      inp.addEventListener("change", () => {
        sincronizarInputs();
        renderTotales();
      });
      // Enter avanza a la siguiente tanda
      inp.addEventListener("keydown", e => {
        if (e.key === "Enter"){
          e.preventDefault();
          const idx = Number(inp.dataset.idx);
          const fld = inp.dataset.fld;
          // Buscar siguiente input mismo campo
          const next = body.querySelector(`input[data-fld="${fld}"][data-idx="${idx + 1}"]`);
          if (next) next.focus();
          else addTanda();
        }
      });
    });
    body.querySelectorAll(".del-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        sincronizarInputs();
        tandas.splice(idx, 1);
        if (!tandas.length) tandas.push({ caj: 0, kg: 0, uni: 0 });
        render();
      });
    });
    document.getElementById("tandasAddBtn").addEventListener("click", addTanda);
  }

  function renderTotales(){
    // Recalcula solo el bloque .tandas-totales
    const body = document.getElementById("tandasBody");
    const tot = body.querySelector(".tandas-totales");
    if (!tot) return render();
    const totales = { caj: 0, kg: 0, uni: 0 };
    tandas.forEach(t => {
      totales.caj += Number(t.caj) || 0;
      totales.kg += kgDe(t);
      totales.uni += Number(t.uni) || 0;
    });
    const cells = [`<div class="lbl">Total</div>`];
    if (config.pedirCaj) cells.push(`<div>${totales.caj}</div>`);
    if (config.pedirKg) cells.push(`<div>${totales.kg.toLocaleString('es-AR', { maximumFractionDigits: 3 })}</div>`);
    if (config.pedirUni) cells.push(`<div>${totales.uni}</div>`);
    cells.push(`<div></div>`);
    tot.innerHTML = cells.join("");
  }

  function addTanda(){
    sincronizarInputs();
    tandas.push({ caj: 0, kg: 0, uni: 0 });
    render();
    // Foco en el primer input de la nueva tanda
    setTimeout(() => {
      const lastRow = overlay.querySelectorAll(".tanda-row");
      const last = lastRow[lastRow.length - 1];
      const inp = last?.querySelector("input");
      if (inp) inp.focus();
    }, 0);
  }

  window.tandasPopup = { open: abrirInner };
})();
