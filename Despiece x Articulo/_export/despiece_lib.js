"use strict";
// Port fiel del algoritmo de "Despiece x Articulo/app.js" (trazarSector + aplanar).
const BASE = "https://hrxfctzncixxqmpfhskv.supabase.co";
const KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhyeGZjdHpuY2l4eHFtcGZoc2t2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MjQyNjEsImV4cCI6MjA4ODMwMDI2MX0.4L6wguch8UZGhC2VpzrWcCjJGUV-IkYsl9JoCWrOLUs";

async function fetchAll(table){
  const out = [];
  let from = 0; const step = 1000;
  while(true){
    const url = BASE + "/rest/v1/" + encodeURIComponent(table) + "?select=*";
    const res = await fetch(url,{headers:{apikey:KEY,Authorization:"Bearer "+KEY,Range:from+"-"+(from+step-1),Prefer:"count=exact"}});
    if(!res.ok) throw new Error(table+": "+res.status+" "+await res.text());
    const rows = await res.json();
    out.push(...rows);
    const cr = res.headers.get("content-range")||"";
    const total = parseInt((cr.split("/")[1]||"0"),10);
    if(out.length>=total || rows.length===0) break;
    from += step;
  }
  return out;
}

async function loadAll(){
  const tables = {
    despiece:"Despiece x Articulo", ce:"Causa-Efecto", pxps:"Partes x PS",
    pxtall:"Articulos Virgilio X Tallerista", artcajas:"Articulos_Cajas", cajas:"Cajas",
    grj:"GRJ_Componentes", flejes:"Flejes", spkg:"SP Kg", sckg:"SC Kg",
    plast:"SectorPlasticos", remSP:"Remaches SP", remSC:"Remaches SC", bomb:"BOMB",
    cep:"Cepillos", mat:"Matrices", tall:"Tall_ProvAT_PS"
  };
  const D = {};
  await Promise.all(Object.entries(tables).map(async ([k,t])=>{ D[k]=await fetchAll(t); }));
  return D;
}

function buildCtx(D){
  const C = {
    ce:D.ce, pxps:D.pxps, pxtall:D.pxtall, artcajas:D.artcajas, cajas:D.cajas,
    grj:D.grj, flejes:D.flejes,
    sp_kg_desc:new Map(D.spkg.map(r=>[r.Sp,r.Parte])),
    sc_kg_desc:new Map(D.sckg.map(r=>[r.SC,r.Descripcion])),
    prov_sectorplasticos:new Map(D.plast.filter(r=>r.Sector).map(r=>[r.Sector,r.Proveedor||""])),
    prov_spkg:new Map(D.spkg.filter(r=>r.Sp).map(r=>[r.Sp,r.Proveedor||""])),
    prov_sckg:new Map(D.sckg.filter(r=>r.SC).map(r=>[r.SC,r.Proveedor||""])),
    prov_remachessp:new Map(D.remSP.filter(r=>r.SP).map(r=>[r.SP,r.Proveedor||""])),
    prov_remachessc:new Map(D.remSC.filter(r=>r.SC).map(r=>[r.SC,r.Proveedor||""])),
    prov_bomb:new Map(D.bomb.filter(r=>r.Sector).map(r=>[r.Sector,r.Proveedor||""])),
    prov_cepillos:new Map(D.cep.filter(r=>r.Sector).map(r=>[r.Sector,r.Proveedor||""])),
    matrices_nombres:new Map(D.mat.filter(r=>r.N_Matriz!=null).map(r=>[String(r.N_Matriz),String(r.Matriz||"").trim()])),
  };
  C.PROV_AT = new Set(); C.INTERNO = new Set();
  D.tall.filter(r=>r.activo).forEach(r=>{ const n=String(r.nombre||"").trim(); if(!n)return; if(r.prov_at)C.PROV_AT.add(n); if(r.interno)C.INTERNO.add(n); });
  return C;
}

function getProveedor(C,sector){
  for(const m of [C.prov_sectorplasticos,C.prov_spkg,C.prov_sckg,C.prov_remachessp,C.prov_remachessc,C.prov_bomb,C.prov_cepillos]){
    if(m.has(sector)){ const p=m.get(sector); if(p) return p; }
  }
  return "";
}

function trazarSector(C,sector,visitados=new Set(),prof=0){
  if(!sector||prof>15) return [];
  if(sector.startsWith("CC")) return [];
  if(visitados.has(sector)) return [{tipo:"loop",label:"(loop: "+sector+")"}];
  visitados = new Set([...visitados,sector]);
  if(/^Fleje\s/i.test(sector)) return [{tipo:"fleje",label:sector}];

  const grjComp = C.grj.filter(g=>g.cod_grj===sector);
  if(grjComp.length>0){
    const compTexto = grjComp.slice().sort((a,b)=>a.orden-b.orden).map(g=>g.componente).join(" + ");
    const ceGrj = C.ce.filter(r=>r.Aumenta===sector);
    let tallGrj="";
    for(const r of ceGrj){ const m=String(r.Matriz||"").trim(); if(m&&isNaN(Number(m))&&m!=="Fabr"){tallGrj=m;break;} }
    const ramasGRJ=[];
    for(const g of grjComp.slice().sort((a,b)=>a.orden-b.orden)){
      const prev = trazarSector(C,g.componente,visitados,prof+1);
      ramasGRJ.push({tipo:"grj_comp",label:g.componente,ramas:prev});
    }
    const tallLabel = tallGrj||"Tallerista";
    return [{tipo:"grj",label:sector+" ← "+tallLabel+" ← "+compTexto,ramas:ramasGRJ}];
  }

  const ceProduce = C.ce.filter(r=>r.Aumenta===sector);
  const pxpsProduce = C.pxps.filter(r=>r.SP===sector);
  const pasos=[];

  const ceGrouped=new Map();
  for(const r of ceProduce){ const key=(r.Descuenta||"")+"|"+(r["Descripcion Matriz"]||""); if(!ceGrouped.has(key))ceGrouped.set(key,[]); ceGrouped.get(key).push(r); }
  for(const [,grupo] of ceGrouped){
    const r0=grupo[0]; const descuenta=r0.Descuenta;
    const matrices=grupo.map(x=>{ const n=String(x.Matriz).trim(); const nombre=C.matrices_nombres.get(n)||""; const red=!nombre||/^Matriz\s/i.test(nombre); return red?("Mat "+n):("Mat "+n+" ("+nombre+")"); }).join(" / ");
    const label=matrices;
    if(!descuenta||descuenta==="Fabr"){ pasos.push({tipo:"fabr",label,sector_prev:"Fabricación interna"}); continue; }
    const prev=trazarSector(C,descuenta,visitados,prof+1);
    if(prev.length===1&&(prev[0].tipo==="fleje"||prev[0].tipo==="compra")){ pasos.push({tipo:"matriz",label,sector_prev:prev[0].label,ramas:[]}); }
    else { pasos.push({tipo:"matriz",label,sector_prev:descuenta,ramas:prev}); }
  }

  const psGrouped=new Map();
  for(const r of pxpsProduce){ const key=(r.SC||"")+"|"+(r.Proceso||""); if(!psGrouped.has(key))psGrouped.set(key,[]); psGrouped.get(key).push(r); }
  for(const [,grupo] of psGrouped){
    const r0=grupo[0]; const sc=r0.SC; const parte=r0.Parte;
    const psList=[...new Set(grupo.map(x=>(x.PS||"").trim()).filter(Boolean))];
    const procTxt=r0.Proceso?(" ("+r0.Proceso+")"):"";
    const label=psList.join(" / ")+procTxt;
    if(!sc){ pasos.push({tipo:"ps",label,psList}); continue; }
    if(sc==="ST"){
      const stProducers=C.pxps.filter(p=>p.SP==="ST"&&p.Parte===parte);
      if(stProducers.length===0){ pasos.push({tipo:"ps_st",label,psList,sector_prev:"ST (sin origen)",nota:"No se encontró quién produce ST para \""+parte+"\""}); continue; }
      const stGrouped=new Map();
      for(const sp of stProducers){ const k=(sp.SC||"")+"|"+(sp.Proceso||""); if(!stGrouped.has(k))stGrouped.set(k,[]); stGrouped.get(k).push(sp); }
      const ramasST=[];
      for(const [,g] of stGrouped){
        const p0=g[0]; const psListST=[...new Set(g.map(x=>(x.PS||"").trim()).filter(Boolean))];
        const labelST=psListST.join(" / ")+(p0.Proceso?(" ("+p0.Proceso+")"):"");
        const prevST=trazarSector(C,p0.SC,visitados,prof+1);
        if(prevST.length===1&&(prevST[0].tipo==="fleje"||prevST[0].tipo==="compra")){ ramasST.push({tipo:"ps",label:labelST,psList:psListST,sector_prev:prevST[0].label,ramas:[]}); }
        else { ramasST.push({tipo:"ps",label:labelST,psList:psListST,sector_prev:p0.SC,ramas:prevST}); }
      }
      pasos.push({tipo:"ps",label,psList,sector_prev:"ST",ramas:ramasST}); continue;
    }
    const prev=trazarSector(C,sc,visitados,prof+1);
    if(prev.length===1&&(prev[0].tipo==="fleje"||prev[0].tipo==="compra")){ pasos.push({tipo:"ps",label,sector_prev:prev[0].label,psList,ramas:[]}); }
    else { pasos.push({tipo:"ps",label,sector_prev:sc,psList,ramas:prev}); }
  }

  if(pasos.length===0){
    const spDesc=C.sp_kg_desc.get(sector);
    if(!spDesc){
      const fd=C.flejes.find(f=>f.Sector===sector);
      if(fd){ const nF=fd["N Fleje"]||sector; const desc=fd["Descripción"]||""; const prov=fd["Proveedor"]||"sin proveedor"; const label=desc?("Fleje "+nF+" ("+desc+") — "+prov):("Fleje "+nF+" — "+prov); pasos.push({tipo:"fleje",label}); return pasos; }
    }
    const prov=getProveedor(C,sector)||"sin proveedor";
    const isRem=C.prov_remachessp.has(sector)||C.prov_remachessc.has(sector);
    if(isRem) pasos.push({tipo:"compra_remache",label:"📦 Comprado (Remaches) — "+prov});
    else pasos.push({tipo:"compra",label:sector+" ("+prov+")"});
  }
  return pasos;
}

function aplanar(pasos,acum=[]){
  const res=[];
  for(const p of pasos){
    const cadena=[...acum,p];
    if(p.ramas&&p.ramas.length>0) res.push(...aplanar(p.ramas,cadena));
    else res.push(cadena);
  }
  return res;
}

module.exports = { loadAll, buildCtx, trazarSector, aplanar, getProveedor };
