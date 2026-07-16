"use strict";
const fs = require("fs");
const path = require("path");
const { loadAll, buildCtx, trazarSector, aplanar } = require("./despiece_lib.js");

const OUT = __dirname;

// ---------- helpers de render de flujo ----------
function forwardNodes(cadena, partSector){
  const rev = [...cadena].reverse(); // inner..outer
  const nodes = [];
  const inner = rev[0];
  if(inner && inner.sector_prev){
    nodes.push({k:"mat", v: inner.sector_prev});
    rev.forEach((el,i)=>{
      nodes.push({k:"proc", v: el.label, tipo: el.tipo});
      const out = (i<rev.length-1) ? (rev[i+1].sector_prev||null) : partSector;
      if(out) nodes.push({k:"mat", v: out});
    });
  } else if(inner){
    nodes.push({k:"mat", v: inner.label, tipo: inner.tipo});
    rev.slice(1).forEach((el,i)=>{
      const idx=i+1;
      nodes.push({k:"proc", v: el.label, tipo: el.tipo});
      const out = (idx<rev.length-1) ? (rev[idx+1].sector_prev||null) : partSector;
      if(out) nodes.push({k:"mat", v: out});
    });
    if(rev.length===1 && partSector) nodes.push({k:"mat", v: partSector});
  }
  // marcar la parte final
  if(nodes.length && nodes[nodes.length-1].k==="mat" && nodes[nodes.length-1].v===partSector){
    nodes[nodes.length-1].esParte = true;
  }
  return nodes;
}
function forwardText(cadena, partSector){
  const nodes = forwardNodes(cadena, partSector);
  return nodes.map(n=>{
    if(n.k==="proc") return "〔"+n.v+"〕";
    return n.esParte ? (n.v+" ▣") : n.v;
  }).join(" → ").replace(/\s+/g," ").trim();
}
function leafOrigin(cadena){
  const inner = cadena[cadena.length-1];
  if(!inner) return {label:"(vacío)", tipo:"vacio"};
  return { label: inner.sector_prev ? inner.sector_prev : inner.label, tipo: inner.tipo };
}

// ---------- main ----------
(async () => {
  const D = await loadAll();
  const C = buildCtx(D);

  // articulos únicos (igual que la app)
  const seen = new Map();
  for(const a of D.despiece){ if(!a.COD) continue; if(!seen.has(a.COD)) seen.set(a.COD, String(a.ARTICULO||"").trim()); }
  const articulos = [...seen.entries()].sort((a,b)=>String(a[0]).localeCompare(String(b[0]),"es",{numeric:true}));

  function talleristasDe(cod){ return D.pxtall.filter(t=>t.Cod_Art===cod).map(t=>t.Tallerista).filter(Boolean); }
  function uniXCajaDe(cod){ const t=D.pxtall.find(t=>t.Cod_Art===cod); return t?t.Uni_x_Caja:null; }
  function resolverCaja(cod){
    const ac = D.artcajas.find(a=>a.Cod_Art===cod); if(!ac) return null;
    const caja = D.cajas.find(c=>c.N_Caja===ac.N_Caja);
    return { n_caja:ac.N_Caja, uni_x_caja:ac.Uni_x_Caja, sector:caja?caja.Sector:null, medidas:caja?caja.Medidas:null, descripcion:caja?caja.Descripcion:(ac.Descripcion||null) };
  }
  function destinoTipo(tall){
    if(tall.length && tall.every(t=>C.PROV_AT.has(t))) return "Prov Art Terminado";
    if(tall.some(t=>C.INTERNO.has(t))) return "Fabricación interna";
    return "Tallerista";
  }

  const articulosOut = [];

  for(const [cod, articulo] of articulos){
    const partesRaw = D.despiece.filter(r=>r.COD===cod);
    const talleristas = talleristasDe(cod);
    const caja = resolverCaja(cod);
    const dTipo = destinoTipo(talleristas);

    const psSet = new Set();
    const matSet = new Set();
    const origenSet = new Set();   // labels de origen (compra/fleje/fabr)
    const partesOut = [];
    let item = 0;

    for(const p of partesRaw){
      item++;
      const sector = p["Sector Proce"];
      const parteObj = {
        item,
        sector: sector||null,
        descripcion: p["Descripcion de partes"]||"",
        partes_x_uni: p["Partes x uni"]!=null ? p["Partes x uni"] : (p["Partes x uni"]===0?0:null),
        rubro: p.Rubro||"",
        kg_x_uni: p.KGxUni!=null ? p.KGxUni : null,
        origen_tipo: null,
        ramas: []
      };

      if(!sector){
        parteObj.origen_tipo = "compra_directa";
        parteObj.ramas.push({ flujo: "Compra ("+(p.Rubro||"packaging")+") → "+(p["Descripcion de partes"]||"parte")+" ▣", origen:"Compra "+(p.Rubro||"packaging"), origen_tipo:"compra" });
        origenSet.add("Compra: "+(p["Descripcion de partes"]||p.Rubro||"packaging"));
        partesOut.push(parteObj); continue;
      }
      if(sector.startsWith("CC")){
        parteObj.origen_tipo = "carton_comprado";
        const disp = sector.slice(2);
        parteObj.ramas.push({ flujo: "📦 Comprado ("+(p.Rubro||"Cartones")+") → "+disp+" ▣", origen:"Comprado "+(p.Rubro||"Cartones"), origen_tipo:"compra" });
        origenSet.add("Compra: "+disp+" ("+(p.Rubro||"Cartones")+")");
        partesOut.push(parteObj); continue;
      }

      const pasos = trazarSector(C, sector);
      const ramas = aplanar(pasos);
      const tiposLeaf = new Set();
      if(ramas.length===0){
        parteObj.origen_tipo = "sin_trazado";
        parteObj.ramas.push({ flujo: sector+" — sin trazado", origen:sector, origen_tipo:"sin_trazado" });
      } else {
        for(const cad of ramas){
          const lo = leafOrigin(cad);
          tiposLeaf.add(lo.tipo);
          if(lo.tipo==="fleje"||lo.tipo==="compra"||lo.tipo==="compra_remache") origenSet.add(lo.label);
          else if(lo.tipo==="fabr") origenSet.add("Fabricación interna");
          // recolectar PS y matrices de toda la cadena
          for(const step of cad){
            if((step.tipo==="ps"||step.tipo==="ps_st") && step.psList) step.psList.forEach(x=>psSet.add(x));
            if(step.tipo==="matriz"||step.tipo==="fabr") matSet.add(step.label);
          }
          parteObj.ramas.push({
            flujo: forwardText(cad, sector),
            origen: lo.label,
            origen_tipo: lo.tipo,
            pasos_backward: cad.map(s=>({tipo:s.tipo,label:s.label,sector_prev:s.sector_prev||null}))
          });
        }
        // clasificar origen_tipo del item
        if(tiposLeaf.size===1) parteObj.origen_tipo = [...tiposLeaf][0];
        else parteObj.origen_tipo = "mixto";
      }
      partesOut.push(parteObj);
    }

    articulosOut.push({
      cod, articulo,
      n_partes: partesRaw.length,
      destino: { talleristas, tipo: dTipo },
      uni_x_caja_tall: uniXCajaDe(cod),
      caja,
      ps_involucrados: [...psSet].sort(),
      matrices_involucradas: [...matSet].sort(),
      origenes: [...origenSet].sort(),
      partes: partesOut
    });
  }

  // ---------- JSON ----------
  fs.writeFileSync(path.join(OUT,"despiece_articulos.json"), JSON.stringify({
    generado: "Gestion Productiva — Despiece x Articulo (export para proyecto Claude)",
    total_articulos: articulosOut.length,
    fuente_db: "hrxfctzncixxqmpfhskv.supabase.co",
    articulos: articulosOut
  }, null, 2), "utf8");

  // ---------- CSV plano (una fila por rama) ----------
  const csv = [];
  csv.push(["COD","Articulo","Destino_Talleristas","Destino_Tipo","Caja","Item","Sector_Parte","Descripcion_Parte","Partes_x_uni","Rubro","Origen","Origen_Tipo","Flujo_proceso"]
    .map(s=>'"'+s+'"').join(","));
  for(const a of articulosOut){
    for(const p of a.partes){
      for(const r of p.ramas){
        csv.push([
          a.cod, a.articulo, a.destino.talleristas.join(" / "), a.destino.tipo,
          a.caja?("N"+a.caja.n_caja):"", p.item, p.sector||"", p.descripcion, p.partes_x_uni==null?"":p.partes_x_uni,
          p.rubro, r.origen||"", r.origen_tipo||"", r.flujo||""
        ].map(s=>'"'+String(s==null?"":s).replace(/"/g,'""')+'"').join(","));
      }
    }
  }
  fs.writeFileSync(path.join(OUT,"despiece_plano.csv"), "﻿"+csv.join("\r\n"), "utf8");

  // ---------- Markdown por artículo ----------
  const md = [];
  md.push("# Despiece por Artículo — Gestión Productiva");
  md.push("");
  md.push("> Generado automáticamente desde la base (`Despiece x Articulo` y tablas relacionadas), replicando el");
  md.push("> mismo algoritmo de trazado del módulo **Despiece x Artículo**. Leer primero `00_MODELO_DE_DATOS.md`.");
  md.push("");
  md.push("**Total de artículos:** "+articulosOut.length+"  ·  **Convención del flujo:** se lee de **izquierda (origen / materia prima)** a **derecha (la parte ▣)**. Los pasos entre `〔 〕` son procesos (matriz interna o Prestador de Servicio/PS).");
  md.push("");

  // índice
  md.push("## Índice");
  md.push("");
  for(const a of articulosOut){
    md.push("- ["+a.cod+" — "+(a.articulo||"(sin nombre)")+"](#"+slug(a.cod)+") · "+a.n_partes+" parte(s)");
  }
  md.push("");
  md.push("---");
  md.push("");

  for(const a of articulosOut){
    md.push('<a id="'+slug(a.cod)+'"></a>');
    md.push("## "+a.cod+" — "+(a.articulo||"(sin nombre)"));
    md.push("");
    md.push("- **Cantidad de partes:** "+a.n_partes);
    md.push("- **Destino (tallerista):** "+(a.destino.talleristas.length?a.destino.talleristas.join(" / "):"— sin asignar —")+"  _("+a.destino.tipo+")_");
    if(a.caja) md.push("- **Caja:** Nº"+a.caja.n_caja+" · sector "+(a.caja.sector||"?")+" · "+(a.caja.medidas||"?")+" · "+(a.caja.uni_x_caja!=null?a.caja.uni_x_caja:"?")+" uni/caja");
    if(a.ps_involucrados.length) md.push("- **PS (Prestadores de Servicio) en la cadena:** "+a.ps_involucrados.join(", "));
    if(a.matrices_involucradas.length) md.push("- **Matrices / fabricación interna:** "+a.matrices_involucradas.join(" · "));
    if(a.origenes.length) md.push("- **Orígenes (materia prima / compra):** "+a.origenes.join(" · "));
    md.push("");
    md.push("| # | Parte (sector) | Descripción | Partes/uni | Rubro | Origen | Flujo del proceso (origen → … → parte ▣) |");
    md.push("|---|---|---|---|---|---|---|");
    for(const p of a.partes){
      if(p.ramas.length<=1){
        const r = p.ramas[0]||{flujo:"",origen:""};
        md.push("| "+p.item+" | "+mdc(p.sector||"—")+" | "+mdc(p.descripcion)+" | "+mdc(p.partes_x_uni==null?"":p.partes_x_uni)+" | "+mdc(p.rubro)+" | "+mdc(r.origen||"")+" | "+mdc(r.flujo||"")+" |");
      } else {
        p.ramas.forEach((r,i)=>{
          md.push("| "+(i===0?p.item:"")+" | "+(i===0?mdc(p.sector||"—"):"")+" | "+(i===0?mdc(p.descripcion):"_(misma parte, otra rama)_")+" | "+(i===0?mdc(p.partes_x_uni==null?"":p.partes_x_uni):"")+" | "+(i===0?mdc(p.rubro):"")+" | "+mdc(r.origen||"")+" | "+mdc(r.flujo||"")+" |");
        });
      }
    }
    if(a.caja){
      md.push("| "+(a.partes.length+1)+" | "+mdc(a.caja.sector||"—")+" | Caja Nº"+a.caja.n_caja+" | 1/"+(a.caja.uni_x_caja!=null?a.caja.uni_x_caja:"?")+" | Packaging | Compra | Compra (Caja "+(a.caja.medidas||"")+") ▣ |");
    }
    md.push("");
  }

  fs.writeFileSync(path.join(OUT,"Despiece_por_Articulo.md"), md.join("\n"), "utf8");

  // resumen consola
  const conParts = articulosOut.map(a=>a.n_partes);
  console.log("OK — artículos:", articulosOut.length);
  console.log("partes totales (filas despiece):", D.despiece.length);
  console.log("ramas/flujos en CSV:", csv.length-1);
  console.log("archivos: despiece_articulos.json, despiece_plano.csv, Despiece_por_Articulo.md");

  function slug(s){ return "art-"+String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-"); }
})().catch(e=>{ console.error("ERR", e); process.exit(1); });

function mdc(s){ return String(s==null?"":s).replace(/\|/g,"\\|").replace(/\n/g," "); }
function slug(s){ return "art-"+String(s).toLowerCase().replace(/[^a-z0-9]+/g,"-"); }
