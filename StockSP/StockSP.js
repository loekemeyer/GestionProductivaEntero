   "use strict";
   
   /* =========================================================
      BLOQUE: CONFIG SUPABASE
   ========================================================= */
   const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
   const SUPABASE_KEY =
     "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";
   
   const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
   
   /* =========================================================
      BLOQUE: DOM
   ========================================================= */
   const statusEl    = document.getElementById("status");
   const resultEl    = document.getElementById("result");
   const searchInput = document.getElementById("searchInput");

   /* =========================================================
      BLOQUE: ESTADO GLOBAL (para búsqueda)
   ========================================================= */
   let todosLosSP      = [];
   let entregasPSDataG = null;
   let enviosTallDataG = null;
   let entregasLogDataG = null;
   let consumoMapG     = new Map();
   let fabricacionSPG  = { sectorMap: new Map() };
   let entregasGRJDataG = { totalMap: new Map(), detalleMap: new Map() };
   let spPorPSMap      = new Map(); // ps → Set de SP normalizados
   let spPorProvServMap = new Map(); // provServ → Set de SP normalizados
   const filtroPS      = document.getElementById("filtroPS");
   const filtroProvServ = document.getElementById("filtroProvServ");
   
   /* =========================================================
      BLOQUE: HELPERS
   ========================================================= */
   function setStatus(texto) {
     statusEl.textContent = texto || "";
   }
   
   function escapeHtml(texto) {
     return String(texto || "")
       .replaceAll("&", "&amp;")
       .replaceAll("<", "&lt;")
       .replaceAll(">", "&gt;");
   }
   
   function normalizeText(value) {
     return String(value || "")
       .trim()
       .toLowerCase()
       .normalize("NFD")
       .replace(/[\u0300-\u036f]/g, "")
       .replace(/\s+/g, " ");
   }
   function normalizeCod3(value) {
     let s = String(value || "").trim().toUpperCase();
     if (!s) return "";
   
     const m = s.match(/^(\d+)(.*)$/);
     if (!m) return s;
   
     const numero = m[1].padStart(3, "0");
     const resto = String(m[2] || "").trim().toUpperCase();
   
     return `${numero}${resto}`;
   }
   
   function parseDecimal(value) {
     if (value === null || value === undefined || value === "") return 0;
   
     if (typeof value === "number") {
       return Number.isFinite(value) ? value : 0;
     }
   
     let s = String(value).trim();
     if (!s || s === "-" || s === "—") return 0;
   
     s = s.replace(/[^\d,.-]/g, "");
   
     if (s.includes(",") && !s.includes(".")) {
       s = s.replace(",", ".");
     } else {
       s = s.replace(/,/g, "");
     }
   
     const n = Number(s);
     return Number.isFinite(n) ? n : 0;
   }
   
   function formatNumber(n) {
     return Math.round(Number(n || 0)).toLocaleString("es-AR", {
       maximumFractionDigits: 0,
     });
   }
   
   function formatDecimal(n) {
     return Number(n || 0).toLocaleString("es-AR", {
       minimumFractionDigits: 0,
       maximumFractionDigits: 3,
     });
   }
   
   function sortKeyFechaDDMM(value) {
     const s = String(value || "").trim();
     const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{4})?$/);
     if (!m) return 9999;
     return Number(m[2]) * 100 + Number(m[1]);
   }
   
   /* =========================================================
      BLOQUE: CARGA BASE SP Kg
   ========================================================= */
   async function cargarBaseSPKg() {
     const { data, error } = await supabaseClient
       .from("SP Kg")
       .select("*")
       .order("Sp", { ascending: true });
   
     if (error) {
       console.error(error);
       throw new Error(`Error al leer SP Kg: ${error.message}`);
     }
   
     return data || [];
   }
   
   /* =========================================================
      BLOQUE: CARGA ENTREGAS PS
      Toma KG por Sector SP
   ========================================================= */
   async function fetchAllPaginated(table, selectCols = "*") {
     const out = [];
     const PAGE = 1000;
     const MAX_PAGES = 100; // safety net
     let from = 0;
     for (let page = 0; page < MAX_PAGES; page++) {
       const { data, error } = await supabaseClient.from(table).select(selectCols).range(from, from + PAGE - 1);
       if (error) { console.error(error); throw new Error(`${table}: ${error.message}`); }
       if (!data || !data.length) return out;
       out.push(...data);
       if (data.length < PAGE) return out;
       from += PAGE;
       if (page === MAX_PAGES - 1) console.warn(`[fetchAllPaginated] ${table}: MAX_PAGES alcanzado, filas: ${out.length}`);
     }
     return out;
   }

   async function cargarEntregasPS() {
     return await fetchAllPaginated("Entregas PS", `"Dia-mes","Sector SP","Parte","KG","Prov_Serv"`);
   }
   
   /* =========================================================
      BLOQUE: CARGA ENVIOS A TALLERISTAS
      Toma KG por Sector
   ========================================================= */
   async function cargarEnviosTalleristas() {
     return await fetchAllPaginated("Envios a Talleristas", `"Dia-mes","Sector","Descripcion","KG","Tallerista"`);
   }
   
   /* =========================================================
      BLOQUE: CARGA ENTREGAS LOG/FABRICA (Virgilio)
   ========================================================= */
   async function cargarEntregasTallVirgilioFull() {
     const all = [];
     const PAGE = 1000;
     let from = 0;
     while (true) {
       const { data, error } = await supabaseClient
         .from("Entregas_Tall_Todas")
         .select("*")
         .range(from, from + PAGE - 1);
       if (error) throw new Error("Error Entregas Tall Virgilio: " + error.message);
       if (!data || !data.length) break;
       all.push(...data);
       if (data.length < PAGE) break;
       from += PAGE;
     }
     return all;
   }

   function armarMapaEntregasLog(rows, despieceRows) {
     // Construir mapa COD -> Sector SP desde despiece
     const codToSector = new Map();
     despieceRows.forEach(r => {
       const cod = normalizeCod3(r["COD"]);
       const sector = normalizeText(r["Sector Proce"]);
       if (cod && sector) codToSector.set(cod, sector);
     });

     const totalMap = new Map();
     const detalleMap = new Map();

     rows.forEach(r => {
       const cod = String(r["Cod"] || "").trim();
       const cajas = Number(r["Cajas"] || 0);
       const fecha = String(r["Fecha"] || "").trim();
       if (!cod || !cajas) return;

       // Buscar sector SP por código
       const codNorm = normalizeCod3(cod);
       const sector = codToSector.get(codNorm);
       if (!sector) return;

       totalMap.set(sector, (totalMap.get(sector) || 0) + cajas);

       if (!detalleMap.has(sector)) detalleMap.set(sector, []);
       detalleMap.get(sector).push({ fecha, kg: cajas, descripcion: `Log/Fab cod ${cod}` });
     });

     return { totalMap, detalleMap };
   }

   /* =========================================================
      BLOQUE: CARGA ENVIOS A PS
      Registros donde un SP se envía a un PS como input
   ========================================================= */
   async function cargarEnviosAPS() {
     return await fetchAllPaginated("Envios a PS", `"Dia-mes","Prov_Serv","Sector SC","Sector SP","Parte","KG"`);
   }

   function armarMapaEnviosAPS(rows, spRows) {
     const totalMap = new Map();
     const detalleMap = new Map();

     // Set de sectores SP válidos (normalizados)
     const spValidos = new Set();
     (spRows || []).forEach((r) => {
       const sp = normalizeText(r["Sp"]);
       if (sp) spValidos.add(sp);
     });

     rows.forEach((r) => {
       const kg = parseDecimal(r["KG"]);
       const fecha = String(r["Dia-mes"] || "").trim();
       const sectorSC = normalizeText(r["Sector SC"]);
       const provServ = String(r["Prov_Serv"] || "").trim();

       if (!kg || !sectorSC) return;
       if (!spValidos.has(sectorSC)) return; // Solo si el input es un SP válido

       totalMap.set(sectorSC, (totalMap.get(sectorSC) || 0) + kg);

       if (!detalleMap.has(sectorSC)) detalleMap.set(sectorSC, []);
       detalleMap.get(sectorSC).push({ fecha, kg, descripcion: `→ PS ${provServ}` });
     });

     for (const [key, arr] of detalleMap.entries()) {
       arr.sort((a, b) => sortKeyFechaDDMM(b.fecha) - sortKeyFechaDDMM(a.fecha));
     }

     return { totalMap, detalleMap };
   }

   /* =========================================================
      BLOQUE: CARGA GRJ_Componentes + MAPA ENTREGAS GRJ
      Para sectores GRJ: muestra entregas tallerista en col "Entregas PS"
   ========================================================= */
   async function cargarGRJComponentes() {
     const { data, error } = await supabaseClient
       .from("GRJ_Componentes")
       .select("cod_grj, componente, orden")
       .order("cod_grj")
       .order("orden");
     if (error) throw new Error("Error GRJ_Componentes: " + error.message);
     return data || [];
   }

   function armarMapaEntregasGRJ(allRows, grjComps, spRows) {
     // Set de sectores GRJ válidos en SP Kg
     const grjSectores = new Set();
     (spRows || []).forEach(r => {
       const sp = String(r["Sp"] || "").trim();
       if (/^GRJ\d/i.test(sp)) grjSectores.add(sp);
     });
     if (grjSectores.size === 0) return { totalMap: new Map(), detalleMap: new Map() };

     // Marker por GRJ (componente orden=1) para evitar doble-conteo
     const compsByGRJ = new Map();
     (grjComps || []).forEach(c => {
       const cg = String(c.cod_grj || "").trim();
       if (!grjSectores.has(cg)) return;
       if (!compsByGRJ.has(cg)) compsByGRJ.set(cg, []);
       compsByGRJ.get(cg).push({ comp: c.componente, orden: c.orden || 0 });
     });
     const markerByGRJ = new Map();
     compsByGRJ.forEach((comps, cg) => {
       const marker = comps.find(c => c.orden === 1) || comps[0];
       if (marker) markerByGRJ.set(cg, marker.comp);
     });

     const totalMap = new Map();
     const detalleMap = new Map();

     for (const e of allRows) {
       const codGRJ = String(e["Cod_GRJ"] || "").trim();
       const cod = String(e["Cod"] || "").trim();
       if (!grjSectores.has(codGRJ)) continue;
       if (cod !== codGRJ && cod !== markerByGRJ.get(codGRJ)) continue;

       const key = normalizeText(codGRJ);
       const kg = parseDecimal(e["Kg_GRJ"]);
       const tall = String(e["Nombre_Tall"] || "").trim();
       const fechaRaw = String(e["Fecha"] || "").trim();
       // Convertir ISO YYYY-MM-DD → DD/MM
       const mf = fechaRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
       const fecha = mf ? `${mf[3]}/${mf[2]}` : fechaRaw;

       totalMap.set(key, (totalMap.get(key) || 0) + kg);
       if (!detalleMap.has(key)) detalleMap.set(key, []);
       detalleMap.get(key).push({ fecha, kg, parte: tall || "Tallerista" });
     }

     for (const [, arr] of detalleMap.entries()) {
       arr.sort((a, b) => sortKeyFechaDDMM(b.fecha) - sortKeyFechaDDMM(a.fecha));
     }

     return { totalMap, detalleMap };
   }

   /* =========================================================
      BLOQUE: CARGA db_n8n_espejo (PAGINADA)
   ========================================================= */
   async function cargarDBEspejo() {
     const all = [];
     const PAGE = 1000;
     let from = 0;
     while (true) {
       const { data, error } = await supabaseClient
         .from("db_n8n_espejo")
         .select("*")
         .neq("Legajo", "1")  // excluir registros de Pruebas (Legajo 1)
         .range(from, from + PAGE - 1);
       if (error) throw new Error("Error db_n8n_espejo: " + error.message);
       if (!data || !data.length) break;
       all.push(...data);
       if (data.length < PAGE) break;
       from += PAGE;
     }
     return all;
   }

   /* =========================================================
      BLOQUE: MAPA FABRICACIÓN SP (CE × db_n8n_espejo)
      Para cada sector SP que aparece en Causa-Efecto:
        aumenta  = uni producidas que generan este sector
        descuenta = uni consumidas que gastan este sector
   ========================================================= */
   function armarMapaFabricacionSP(dbRows, causaEfectoRows, spKgRows) {
     // Set de sectores SP válidos
     const spSet = new Set();
     (spKgRows || []).forEach(r => {
       const sp = String(r["Sp"] || "").trim().toUpperCase();
       if (sp) spSet.add(sp);
     });

     // Mapa kgXUni por sector SP
     const kgXUniMap = new Map();
     (spKgRows || []).forEach(r => {
       const sp = String(r["Sp"] || "").trim().toUpperCase();
       const kg = parseDecimal(r["Kg X Uni"]);
       if (sp && kg > 0) kgXUniMap.set(sp, kg);
     });

     // Causa-Efecto: Matriz → [{ descuenta, aumenta }]
     const causaMap = new Map();
     causaEfectoRows.forEach(r => {
       const matriz = String(r["Matriz"] || "").trim();
       if (!matriz) return;
       const desc = String(r["Descuenta"] || "").trim().toUpperCase();
       const aum = String(r["Aumenta"] || "").trim().toUpperCase();
       // Solo si al menos uno es un sector SP
       if (!spSet.has(desc) && !spSet.has(aum)) return;
       if (!causaMap.has(matriz)) causaMap.set(matriz, []);
       causaMap.get(matriz).push({ descuenta: desc, aumenta: aum });
     });

     if (causaMap.size === 0) return { sectorMap: new Map() };

     // Agrupar producción por Matriz+Fecha+Legajo
     const prodMap = new Map();
     dbRows.forEach(r => {
       const matriz = String(r["Matriz"] || "").trim();
       const uni = parseDecimal(r["Uni"]);
       if (!matriz || !uni) return;
       if (!causaMap.has(matriz)) return;
       const mes = String(r["Mes"] || "").padStart(2, "0");
       const dia = String(r["Dia"] || "").padStart(2, "0");
       const fecha = (r["Mes"] && r["Dia"]) ? `${dia}-${mes}` : "";
       const legajo = String(r["Legajo"] || "").trim();
       const nombre = String(r["Nombre_Empleado"] || "").trim();
       const key = `${matriz}|||${fecha}|||${legajo}`;
       if (!prodMap.has(key)) prodMap.set(key, { matriz, fecha, legajo, nombre, uni: 0 });
       prodMap.get(key).uni += uni;
     });

     // Construir mapa por sector SP
     const sectorMap = new Map();
     const ensure = (sector) => {
       const k = normalizeText(sector);
       if (!sectorMap.has(k)) sectorMap.set(k, { aumenta: 0, descuenta: 0, detalleAumenta: [], detalleDescuenta: [] });
       return sectorMap.get(k);
     };

     for (const [, { matriz, fecha, legajo, nombre, uni }] of prodMap.entries()) {
       const efectos = causaMap.get(matriz) || [];
       for (const ef of efectos) {
         if (spSet.has(ef.aumenta)) {
           const e = ensure(ef.aumenta);
           const kgU = kgXUniMap.get(ef.aumenta) || 0;
           e.aumenta += uni * kgU;
           e.detalleAumenta.push({ fecha, matriz, legajo, nombre, uni });
         }
         if (spSet.has(ef.descuenta)) {
           const e = ensure(ef.descuenta);
           const kgU = kgXUniMap.get(ef.descuenta) || 0;
           e.descuenta += uni * kgU;
           e.detalleDescuenta.push({ fecha, matriz, legajo, nombre, uni });
         }
       }
     }

     return { sectorMap };
   }

   /* =========================================================
      BLOQUE: MAPA ENTREGAS PS POR SECTOR
   ========================================================= */
   function armarMapaEntregasPS(rows) {
     const totalMap = new Map();
     const detalleMap = new Map();
   
     rows.forEach((r) => {
       const sector = normalizeText(r["Sector SP"]);
       const kg = parseDecimal(r["KG"]);
       const fecha = String(r["Dia-mes"] || "").trim();
       const parte = String(r["Parte"] || "").trim();
       const prov = String(r["Prov_Serv"] || "").trim();

       if (!sector) return;
       if (!kg) return;

       const key = sector;

       totalMap.set(key, (totalMap.get(key) || 0) + kg);

       if (!detalleMap.has(key)) detalleMap.set(key, []);
       detalleMap.get(key).push({ fecha, kg, parte: prov ? `${prov} → ${parte}` : parte });
     });
   
     for (const [key, arr] of detalleMap.entries()) {
       arr.sort((a, b) => sortKeyFechaDDMM(b.fecha) - sortKeyFechaDDMM(a.fecha));
       detalleMap.set(key, arr);
     }

     return { totalMap, detalleMap };
   }

   /* =========================================================
      BLOQUE: MAPA ENVIOS TALLERISTAS POR SECTOR SP
      Mapea descripción del producto a Sector SP desde tabla SP Kg
   ========================================================= */
   function armarMapaEnviosTalleristas(rows, spRows) {
     const totalMap = new Map();
     const detalleMap = new Map();

     // Set de sectores SP válidos (normalizados)
     const spValidos = new Set();
     (spRows || []).forEach((r) => {
       const sector = normalizeText(r["Sp"]);
       if (sector) spValidos.add(sector);
     });

     rows.forEach((r) => {
       const kg = parseDecimal(r["KG"]);
       const fecha = String(r["Dia-mes"] || "").trim();
       const descripcion = String(r["Descripcion"] || "").trim();
       const tallerista = String(r["Tallerista"] || "").trim();
       const sector = normalizeText(r["Sector"]);

       if (!kg || !sector) return;
       if (!spValidos.has(sector)) return; // Solo sectores SP válidos

       const key = sector;

       totalMap.set(key, (totalMap.get(key) || 0) + kg);

       if (!detalleMap.has(key)) detalleMap.set(key, []);
       detalleMap.get(key).push({ fecha, kg, descripcion: tallerista ? `${tallerista} → ${descripcion}` : descripcion });
     });

     for (const [key, arr] of detalleMap.entries()) {
       arr.sort((a, b) => sortKeyFechaDDMM(b.fecha) - sortKeyFechaDDMM(a.fecha));
       detalleMap.set(key, arr);
     }

     return { totalMap, detalleMap };
   }
   
   /* =========================================================
      BLOQUE: POPUP
   ========================================================= */
   function detalleToPopup(detalle, etiqueta, campoTexto) {
     if (!detalle.length) return `Sin ${etiqueta}`;

     return detalle
       .map((x) => {
         const extra = x[campoTexto] ? ` - ${x[campoTexto]}` : "";
         const fechaRaw = (x.fecha || "").trim();
         const fechaTxt = fechaRaw.match(/^\d{1,2}\/\d{1,2}$/)
           ? `${fechaRaw}/${new Date().getFullYear()}`
           : (fechaRaw || "Sin fecha");
         return `${fechaTxt}${extra} - ${formatDecimal(x.kg)} kg`;
       })
       .join("|");
   }
   
   /* =========================================================
      BLOQUE: RENDER TABLA
   ========================================================= */
   function renderTabla(spRows, entregasPSData, enviosTallData, entregasLogData, consumoMap, fabricacionSP, entregasGRJData) {
      
     let rows = "";
   
     spRows.forEach((r) => {
       const sector = String(r["Sp"] || "").trim();
       const descripcion = String(r["Parte"] || "").trim();
       const key = normalizeText(sector);
   
       const consData = consumoMap.get(key) || { codigos: new Set(), consumo: 0 };
   
       const consXParte = consData.consumo;
       const codigos = Array.from(consData.codigos).join(", ");
   
       const stockInicial = parseDecimal(r["Stock Inicial"]);
       const kgXUni = parseDecimal(r["Kg X Uni"]);
       const kgXCajon = parseDecimal(r["KG x Cajon"]); // 👈 ESTE ES EL IMPORTANTE
       const maxCajones = parseDecimal(r["Max Cajon SP Total"]);
   
       const isGRJ = /^GRJ\d/i.test(sector);
       const entregasPSKg = isGRJ
         ? Number((entregasGRJData && entregasGRJData.totalMap.get(key)) || 0)
         : Number(entregasPSData.totalMap.get(key) || 0);
       const enviosTallKg = Number(enviosTallData.totalMap.get(key) || 0);
       const entregasLogCajas = Number((entregasLogData && entregasLogData.totalMap.get(key)) || 0);
       const entregasLogKg = entregasLogCajas * kgXCajon;

       /* =========================================================
          BLOQUE: FABRICACIÓN SP (CE × db_n8n_espejo)
       ========================================================= */
       const fabMap = (fabricacionSP && fabricacionSP.sectorMap) || new Map();
       const fabData = fabMap.get(key) || { aumenta: 0, descuenta: 0, detalleAumenta: [], detalleDescuenta: [] };
       const fabricacionNetaKg = fabData.aumenta - fabData.descuenta;

       /* =========================================================
          BLOQUE: MOVIMIENTOS EN UNIDADES
       ========================================================= */
       const entregasPSUni = kgXUni > 0 ? entregasPSKg / kgXUni : 0;
       const enviosTallUni = kgXUni > 0 ? enviosTallKg / kgXUni : 0;
       const fabricacionNetaUni = kgXUni > 0 ? fabricacionNetaKg / kgXUni : 0;

       /* =========================================================
          BLOQUE: ONLINE KG
          Descuenta entregas Log/Fabrica (cajas × Kg x Cajon)
       ========================================================= */
       const onlineKg = stockInicial + entregasPSKg + fabricacionNetaKg - enviosTallKg - entregasLogKg;
   
       /* =========================================================
          BLOQUE: ONLINE UNI
          Uni = Online KG / Kg x Uni
       ========================================================= */
       const onlineUni = kgXUni > 0 ? onlineKg / kgXUni : 0;
   
       /* =========================================================
          BLOQUE: ONLINE CAJ
          Por ahora lo dejamos en 0
       ========================================================= */
       const onlineCaj = kgXCajon > 0 ? onlineKg / kgXCajon : 0;
   
       const detalleEntregasPS = isGRJ
         ? ((entregasGRJData && entregasGRJData.detalleMap.get(key)) || [])
         : (entregasPSData.detalleMap.get(key) || []);
       const detalleEnviosTall = enviosTallData.detalleMap.get(key) || [];

       const popupEntregasPS = detalleToPopup(
         detalleEntregasPS,
         isGRJ ? "entregas Tallerista" : "entregas PS",
         "parte",
       );

       const popupEnviosTall = detalleToPopup(
         detalleEnviosTall,
         "envíos a talleristas",
         "descripcion",
       );

       // Popup fabricación SP
       const fabPopupLineas = [];
       const sortFechaDesc = (a, b) => {
         const pa = (a.fecha || "").split("-"), pb = (b.fecha || "").split("-");
         const ka = (pa[1] || "00") + (pa[0] || "00"), kb = (pb[1] || "00") + (pb[0] || "00");
         return kb.localeCompare(ka);
       };
       const fmtFechaFab = (f) => {
         const p = (f || "").split("-");
         return p.length === 2 ? `${p[0]}/${p[1]}/${new Date().getFullYear()}` : f || "?";
       };
       [...fabData.detalleDescuenta].sort(sortFechaDesc).forEach(d =>
         fabPopupLineas.push(`▼ ${fmtFechaFab(d.fecha)} - Mtz ${d.matriz} - Leg ${d.legajo} ${d.nombre}: ${formatNumber(Math.round(d.uni))} uni`)
       );
       [...fabData.detalleAumenta].sort(sortFechaDesc).forEach(d =>
         fabPopupLineas.push(`▲ ${fmtFechaFab(d.fecha)} - Mtz ${d.matriz} - Leg ${d.legajo} ${d.nombre}: ${formatNumber(Math.round(d.uni))} uni`)
       );
       const popupFabricacion = fabPopupLineas.length ? fabPopupLineas.join("|") : "Sin fabricación";

       rows += `
         <tr>
           <td>${escapeHtml(sector)}</td>
           <td>${escapeHtml(descripcion)}</td>

           <td class="right"><b>${escapeHtml(formatDecimal(onlineKg))}</b></td>
           <td class="right"><b>${escapeHtml((onlineCaj ? Number(onlineCaj).toLocaleString("es-AR",{minimumFractionDigits:1,maximumFractionDigits:1}) : "0"))}</b></td>
           <td class="right"><b>${escapeHtml(formatNumber(onlineUni))}</b></td>

           <td class="center">
             <div class="cell-combo">
               <span class="cell-total">${escapeHtml(formatNumber(entregasPSUni))}</span>
               <button
                 type="button"
                 class="mini-popup-btn"
                 data-popup-title="${escapeHtml(isGRJ ? `Entregas Tall - ${descripcion}` : `Entregas PS - ${descripcion}`)}"
                 data-popup-items="${escapeHtml(popupEntregasPS)}"
               >+</button>
             </div>
           </td>

           <td class="center">
             <div class="cell-combo">
               <span class="cell-total">${escapeHtml(formatNumber(Math.abs(fabricacionNetaUni)))}</span>
               <button
                 type="button"
                 class="mini-popup-btn"
                 data-popup-title="${escapeHtml(`Fabricación - ${descripcion}`)}"
                 data-popup-items="${escapeHtml(popupFabricacion)}"
               >+</button>
             </div>
           </td>

           <td class="center">
             <div class="cell-combo">
               <span class="cell-total">${escapeHtml(formatNumber(enviosTallUni))}</span>
               <button
                 type="button"
                 class="mini-popup-btn"
                 data-popup-title="${escapeHtml(`Envíos a Talleristas - ${descripcion}`)}"
                 data-popup-items="${escapeHtml(popupEnviosTall)}"
               >+</button>
             </div>
           </td>
   
           <td class="right"><b>${escapeHtml(formatDecimal(stockInicial))}</b></td>
           <td class="right"><b>${escapeHtml(formatDecimal(kgXUni))}</b></td>
           <td class="right"><b>${escapeHtml(formatDecimal(kgXCajon))}</b></td>
           <td class="right"><b>${escapeHtml(formatNumber(consXParte))}</b></td>
           <td class="right"><b>${escapeHtml(formatDecimal(maxCajones))}</b></td>
           <td class="mono">${escapeHtml(codigos)}</td>
         </tr>
       `;
     });
   
     resultEl.innerHTML = `
       <div class="articulo">
         <div class="articulo-header">SP Kg</div>
         <div class="table-scroll">
         <table class="table">
           <thead>
             <tr>
               <th colspan="2">Base</th>
               <th colspan="3" class="right">Online</th>
               <th colspan="3" class="center">Movimientos (Uni)</th>
               <th colspan="6" class="right">Info</th>
             </tr>
             <tr>
               <th>Sector</th>
               <th>Descripción</th>

               <th class="right">Kg</th>
               <th class="right">Caj</th>
               <th class="right">Uni</th>

               <th class="center">Entregas<br>PS</th>
               <th class="center">Fabricación</th>
               <th class="center">Envíos<br>Tallerista</th>
   
               <th class="right">Stock Inicial</th>
               <th class="right">Kg x Uni</th>
               <th class="right">Kg x Cajon</th>
               <th class="right">Cons x Parte</th>
               <th class="right">Max Cajones</th>
               <th class="right">Codigos</th>
             </tr>
           </thead>
           <tbody>
             ${rows}
           </tbody>
         </table>
         </div>
       </div>

       <div id="popupOverlay" class="popup-overlay hidden">
         <div class="popup-box">
           <div class="popup-head">
             <div id="popupTitle" class="popup-title"></div>
             <button id="popupClose" type="button" class="popup-close">✕</button>
           </div>
           <div id="popupBody" class="popup-body"></div>
         </div>
       </div>

       <div id="historialOverlay" class="popup-overlay hidden">
         <div class="historial-modal">
           <div class="popup-head">
             <div id="historialTitle" class="popup-title"></div>
             <button id="historialClose" type="button" class="popup-close">✕</button>
           </div>
           <div id="historialBody" class="historial-body"></div>
         </div>
       </div>
     `;
   
     const popupOverlay = document.getElementById("popupOverlay");
     const popupTitle = document.getElementById("popupTitle");
     const popupBody = document.getElementById("popupBody");
     const popupClose = document.getElementById("popupClose");

     const historialOverlay = document.getElementById("historialOverlay");
     const historialTitle = document.getElementById("historialTitle");
     const historialBody = document.getElementById("historialBody");
     const historialClose = document.getElementById("historialClose");

     resultEl.querySelectorAll(".mini-popup-btn").forEach((btn) => {
       btn.addEventListener("click", () => {
         const title = btn.dataset.popupTitle || "";
         const allItems = String(btn.dataset.popupItems || "").split("|").filter(x => x.trim());

         // Mostrar primeras 5 (ya ordenadas de reciente a antiguo)
         const ultimasCinco = allItems.slice(0, 5);

         popupTitle.textContent = title;
         popupBody.innerHTML = ultimasCinco
           .map((x) => `<div class="popup-line">${escapeHtml(x)}</div>`)
           .join("");

         // Agregar botón "Ver Historial" si hay más de 5 items
         if (allItems.length > 5) {
           popupBody.innerHTML += `
             <div style="margin-top:12px; text-align:center;">
               <button id="btnVerHistorial" type="button" class="btn-ver-historial">Ver Historial</button>
             </div>
           `;

           // Event listener para botón Ver Historial
           document.getElementById("btnVerHistorial").addEventListener("click", () => {
             popupOverlay.classList.add("hidden");
             mostrarHistorialCompleto(title, allItems);
           });
         }

         popupOverlay.classList.remove("hidden");
       });
     });

     function mostrarHistorialCompleto(title, items) {
       historialTitle.textContent = title;
       historialBody.innerHTML = items
         .map((x) => `<div class="popup-line">${escapeHtml(x)}</div>`)
         .join("");
       historialOverlay.classList.remove("hidden");
     }

     popupClose.addEventListener("click", () => {
       popupOverlay.classList.add("hidden");
     });

     popupOverlay.addEventListener("click", (e) => {
       if (e.target === popupOverlay) {
         popupOverlay.classList.add("hidden");
       }
     });

     historialClose.addEventListener("click", () => {
       historialOverlay.classList.add("hidden");
     });

     historialOverlay.addEventListener("click", (e) => {
       if (e.target === historialOverlay) {
         historialOverlay.classList.add("hidden");
       }
     });
   }
   
   /* =========================================================
      BLOQUE: MAIN
   ========================================================= */
   async function cargarTodo() {
     try {
       setStatus("Cargando datos...");
       resultEl.innerHTML = "";
   
       const [
        spRows,
        entregasPSRows,
        enviosTallRows,
        enviosPSRows,
        allEntregasTallRows,
        despieceRows,
        eMadreRows,
        partesPS,
        partesPSProvServ,
        causaEfectoRows,
        grjCompsRows
      ] = await Promise.all([
        cargarBaseSPKg(),
        cargarEntregasPS(),
        cargarEnviosTalleristas(),
        cargarEnviosAPS(),
        cargarEntregasTallVirgilioFull(),
        cargarDespiece(),
        cargarEMadre(),
        supabaseClient.from("Partes x Tallerista").select("tallerista, sector_proce").then(r => r.data || []),
        supabaseClient.from("Partes x PS").select('"PS", "SP"').then(r => r.data || []),
        supabaseClient.from("Causa-Efecto").select("*").then(r => r.data || []),
        cargarGRJComponentes(),
      ]);

       // Filtrar entregas Log/Fabrica de los datos completos
       const entregasLogRows = allEntregasTallRows.filter(r => {
         const codTall = String(r["Cod_Tall"] || "").trim();
         const nombre = String(r["Nombre_Tall"] || "").trim().toLowerCase();
         return codTall === "0001" || nombre.includes("log");
       });

       // Cargar db_n8n_espejo paginado (después del Promise.all para no bloquear)
       const dbEspejoRows = await cargarDBEspejo();

   const consumoMap = armarMapaConsumo(despieceRows, eMadreRows);

       const entregasPSData = armarMapaEntregasPS(entregasPSRows);
       const enviosTallData = armarMapaEnviosTalleristas(enviosTallRows, spRows);
       const enviosPSData = armarMapaEnviosAPS(enviosPSRows, spRows);
       const entregasLogData = armarMapaEntregasLog(entregasLogRows, despieceRows);
       const fabricacionSP = armarMapaFabricacionSP(dbEspejoRows, causaEfectoRows, spRows);
       const entregasGRJData = armarMapaEntregasGRJ(allEntregasTallRows, grjCompsRows, spRows);

       // Mergear envíos a PS dentro de envíos tallerista (misma columna)
       for (const [key, kg] of enviosPSData.totalMap.entries()) {
         enviosTallData.totalMap.set(key, (enviosTallData.totalMap.get(key) || 0) + kg);
       }
       for (const [key, arr] of enviosPSData.detalleMap.entries()) {
         if (!enviosTallData.detalleMap.has(key)) enviosTallData.detalleMap.set(key, []);
         enviosTallData.detalleMap.get(key).push(...arr);
         enviosTallData.detalleMap.get(key).sort((a, b) => sortKeyFechaDDMM(b.fecha) - sortKeyFechaDDMM(a.fecha));
       }

       entregasPSDataG  = entregasPSData;
       enviosTallDataG  = enviosTallData;
       entregasLogDataG = entregasLogData;
       consumoMapG      = consumoMap;
       fabricacionSPG   = fabricacionSP;
       entregasGRJDataG = entregasGRJData;
       todosLosSP       = spRows;

       // Armar mapa Tallerista → Set de SP (sector_proce)
       spPorPSMap = new Map();
       const psSet = new Set();
       for (const p of partesPS) {
         const tall = String(p["tallerista"] || "").trim();
         const sp = normalizeText(p["sector_proce"]);
         if (!tall || !sp) continue;
         psSet.add(tall);
         if (!spPorPSMap.has(tall)) spPorPSMap.set(tall, new Set());
         spPorPSMap.get(tall).add(sp);
       }
       // Llenar filtro Talleristas
       const psOrdenados = [...psSet].sort((a, b) => a.localeCompare(b, "es"));
       filtroPS.innerHTML = '<option value="">Todos los Talleristas</option>' +
         psOrdenados.map(p => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join("");

       // Armar mapa ProvServ → Set de SP
       spPorProvServMap = new Map();
       const provServSet = new Set();
       for (const p of partesPSProvServ) {
         const ps = String(p["PS"] || "").trim();
         const sp = normalizeText(p["SP"]);
         if (!ps || !sp) continue;
         provServSet.add(ps);
         if (!spPorProvServMap.has(ps)) spPorProvServMap.set(ps, new Set());
         spPorProvServMap.get(ps).add(sp);
       }
       const provServOrdenados = [...provServSet].sort((a, b) => a.localeCompare(b, "es"));
       filtroProvServ.innerHTML = '<option value="">Todos los Prov Serv</option>' +
         provServOrdenados.map(p => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join("");

       filtrarYRender();
       setStatus(`Encontradas ${spRows.length} piezas`);
     } catch (err) {
       console.error(err);
       setStatus(err.message || "Error al cargar datos");
     }
   }

   function filtrarYRender() {
     const q = normalizeText(searchInput.value);
     const psVal = filtroPS.value;
     const spDelPS = psVal ? spPorPSMap.get(psVal) : null;
     const provServVal = filtroProvServ.value;
     const spDelProvServ = provServVal ? spPorProvServMap.get(provServVal) : null;

     const filas = todosLosSP.filter((r) => {
       const sector = normalizeText(r["Sp"]);
       const desc   = normalizeText(r["Parte"]);
       if (q && !sector.includes(q) && !desc.includes(q)) return false;
       if (spDelPS && !spDelPS.has(sector)) return false;
       if (spDelProvServ && !spDelProvServ.has(sector)) return false;
       return true;
     });
     renderTabla(filas, entregasPSDataG, enviosTallDataG, entregasLogDataG, consumoMapG, fabricacionSPG, entregasGRJDataG);
   }

   async function cargarDespiece() {
     const { data, error } = await supabaseClient
       .from("Despiece x Articulo")
       .select(`
         "COD",
         "ARTICULO",
         "Sector Proce",
         "Partes x uni"
       `);
   
     if (error) throw new Error(error.message);
     return data || [];
   }
   
   async function cargarEMadre() {
     const [lk, ch] = await Promise.all([
       supabaseClient.from("E. Madre LK").select(`*`),
       supabaseClient.from("E. Madre CH").select(`*`),
     ]);
   
     if (lk.error) throw new Error(lk.error.message);
     if (ch.error) throw new Error(ch.error.message);
   
     return [...(lk.data || []), ...(ch.data || [])];
   }
   function armarMapaConsumo(despieceRows, eMadreRows) {
     const map = new Map();
   
     const eMadreMap = new Map();
   
     eMadreRows.forEach((r) => {
       const codNorm = normalizeCod3(r["Cod"]);
       const eMadre = Number(r["E. Madre"]) || 0;
   
       if (!codNorm) return;
   
       eMadreMap.set(codNorm, eMadre);
     });
   
     despieceRows.forEach((r) => {
       const sector = normalizeText(r["Sector Proce"]);
       const codNorm = normalizeCod3(r["COD"]);
       const partesXUni = Number(r["Partes x uni"]) || 0;
   
       if (!sector || !codNorm) return;
   
       if (!map.has(sector)) {
         map.set(sector, {
           codigos: new Set(),
           consumo: 0,
         });
       }
   
       const entry = map.get(sector);
   
       entry.codigos.add(codNorm);
   
       const eMadre = eMadreMap.get(codNorm) || 0;
   
       entry.consumo += eMadre * partesXUni;
     });
   
     return map;
   }
   /* =========================================================
      BLOQUE: INICIO
   ========================================================= */
   searchInput.addEventListener("input", filtrarYRender);
   filtroPS.addEventListener("change", filtrarYRender);
   filtroProvServ.addEventListener("change", filtrarYRender);
   document.addEventListener("DOMContentLoaded", cargarTodo);
