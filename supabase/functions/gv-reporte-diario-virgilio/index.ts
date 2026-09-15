// Reporte diario de Logistica Virgilio para Juan, por WhatsApp.
//
// Espejo de la edge function `reporte-diario-rendimiento` (la de Damian): arma un PDF,
// lo sube al bucket `reportes` de Storage y lo manda como header tipo `document` de una
// plantilla de WhatsApp Cloud API. Lo que cambia es la fuente de datos (Virgilio en vez
// de Cervantes) y el formato del PDF (el Excel que paso Damian: Picking, Armado, Mov y
// S/Reg., las horas de la jornada que nadie registro).
//
// LOS NUMEROS SALEN DE calculo.js, COPIADO AL DEPLOY.
// El archivo Produccion/InformesVirgilio/calculo.js se sube como segundo archivo de esta
// funcion tal cual esta, con UNA sola linea agregada al final:
//     export { procesar, CONFIG };
// (el archivo del repo es un <script> comun del navegador y no puede llevar `export`).
// De esa forma el PDF y la pantalla no pueden dar distinto. Si alguien edita calculo.js,
// hay que redeployar esta funcion o los numeros se separan. Ver README.md de esta carpeta.
//
// NO necesita que se le carguen secrets.
//
// Autenticacion: se deploya con verify_jwt = true, asi que el gateway de Supabase exige un
// JWT valido del proyecto en el header `Authorization: Bearer <service_role>`. El cron lo
// saca de lecturacvs.app_secrets, igual que ya hacen gv-ppp-web-tandas-diarias,
// gv-geocodificar y gv-sync-padron-direcciones.
//
// Token de Meta: viaja en el body como `wa_token`, tambien resuelto por el SQL del cron
// desde app_secrets. Es el mismo token que usa la funcion de Damian.
//
// Invocacion (siempre con el header Authorization):
//   { "wa_token": "..." }                      -> hoy, a los numeros de prueba
//   { "wa_token": "...", "fecha": "2026-09-08" } -> un dia anterior, a prueba
//   { "wa_token": "...", "test": false }       -> hoy, a Juan
//   { "solo_pdf": true }                       -> sube el PDF y no manda nada
//   { "solo_pdf": true, "desde": "2026-09-08", "hasta": "2026-09-14" }  -> un rango
//   { "diag": true, "desde": "...", "hasta": "..." }  -> auditoria de m3 por tanda, sin PDF
//
// OJO: manda a Juan SOLO con "test": false explicito. El default es el numero de prueba.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.2";
// @ts-ignore: copia verbatim del calculo.js del repo, sin tipos
import { procesar, CONFIG } from "./calculo.js";

const SUPABASE_URL = "https://hrxfctzncixxqmpfhskv.supabase.co";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Identificador publico del numero emisor, no es una credencial (mismo que usa la de Damian).
const WA_PHONE_ID = Deno.env.get("WA_PHONE_ID") || "918089688061759";
// Plantilla creada por Elias en Meta, categoria Utilidad, idioma Spanish (ARG) = es_AR.
// Header: contenido multimedia tipo Documento (ahi va el PDF).
// Cuerpo:  "Tu reporte de produccion del {{1}} esta listo."  -> 1 variable posicional.
const WA_TEMPLATE = Deno.env.get("WA_TEMPLATE") || "informe_produccion_virgilio";
const WA_IDIOMA = "es_AR";

const DESTINATARIOS_PROD = ["5491126161913"];  // Juan
const DESTINATARIOS_TEST = ["5491156517686"];  // pruebas

const BUCKET = "reportes";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const DIAS_HACIA_ATRAS = 7;   // margen para los pares que cruzan dia (findes y feriados)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Fechas. Todo el calculo trabaja en hora de Argentina, igual que el navegador.
// ---------------------------------------------------------------------------
const TZ = "America/Argentina/Buenos_Aires";

function partesAR(iso: string | null): { fecha: string; hora: string } {
  if (!iso) return { fecha: "", hora: "" };
  const d = new Date(iso);
  if (isNaN(+d)) return { fecha: "", hora: "" };
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat("es-AR", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(d).forEach((x) => { p[x.type] = x.value; });
  return { fecha: `${p.day}/${p.month}/${p.year}`, hora: `${p.hour}:${p.minute}:${p.second}` };
}

function hoyAR(): string {
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat("es-AR", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return `${p.year}-${p.month}-${p.day}`;
}

function horaAR(): string {
  const p: Record<string, string> = {};
  new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(new Date()).forEach((x) => { p[x.type] = x.value; });
  return `${p.hour}:${p.minute}`;
}

const isoARestando = (iso: string, dias: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - dias);
  return dt.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------------------
// Formato de celdas. El cero siempre se muestra como "-" (pedido de Elias).
// ---------------------------------------------------------------------------

// Ratio M3 x Hs: NO es un tiempo, es metros cubicos por hora. Va con coma decimal.
function celda(v: number, dec = 2): string {
  if (!v || !isFinite(v) || Math.abs(v) < 5e-3) return "-";
  return v.toFixed(dec).replace(".", ",");
}

// Columnas de Hs: tiempo trabajado, en H:MM (o HH:MM si llega a dos digitos de hora).
// La hora no se rellena con cero a la izquierda: una jornada es de 9 hs, asi que en la
// practica casi siempre sale H:MM, y HH:MM aparece solo si alguien pasa las 10 hs.
// Se redondea al minuto; si el redondeo da 60 minutos, sube la hora.
function celdaHs(v: number): string {
  if (!v || !isFinite(v) || v <= 0) return "-";
  let h = Math.floor(v);
  let m = Math.round((v - h) * 60);
  if (m === 60) { h++; m = 0; }
  if (h === 0 && m === 0) return "-";
  return `${h}:${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Lectura de datos. Mismas tablas y mismas columnas que Produccion/InformesVirgilio.
// ---------------------------------------------------------------------------
async function paginar(sb: any, tabla: string, cols: string, filtrar?: (q: any) => any) {
  const SIZE = 1000;
  const todo: any[] = [];
  let desde = 0;
  while (true) {
    let q = sb.from(tabla).select(cols);
    if (filtrar) q = filtrar(q);
    const { data, error } = await q.range(desde, desde + SIZE - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    if (!data || !data.length) break;
    todo.push(...data);
    if (data.length < SIZE) break;
    desde += SIZE;
  }
  return todo;
}

async function traerProduccion(sb: any, desdeIso: string, hasta: string) {
  // Se traen dias previos porque un par puede abrirse un dia y cerrarse al siguiente
  // habil; calculo.js despues recorta los segmentos al rango pedido.
  const desde = isoARestando(desdeIso, DIAS_HACIA_ATRAS);
  const fecha = hasta;
  const filas = await paginar(
    sb, "Registros_Produccion_Virgilio",
    "legajo, opcion, descripcion, texto, ts_cliente, ts_inicio",
    (q: any) => q.gte("ts_cliente", `${desde}T00:00:00-03:00`)
                 .lte("ts_cliente", `${fecha}T23:59:59-03:00`)
                 .order("ts_cliente", { ascending: true }),
  );
  return filas.map((r: any) => {
    const a = partesAR(r.ts_cliente);
    const b = partesAR(r.ts_inicio);
    return {
      fecha: a.fecha, hora: a.hora,
      fechaIni: b.fecha, horaIni: b.hora,
      legajo: String(r.legajo || "").trim(),
      opcion: String(r.opcion || "").trim(),
      descripcion: String(r.descripcion || "").trim(),
      codigo: String(r.texto || "").trim(),
    };
  });
}

async function traerEmpleados(sb: any) {
  // Sin filtro de Sede ni de Activo: esto solo resuelve legajo -> nombre, y hay gente
  // que trabaja en Virgilio con otra sede asignada (277 Cartaya hace todo el picking).
  const filas = await paginar(sb, "Empleados", "Legajo, Empleado");
  const m = new Map<string, string>();
  filas.forEach((r: any) => {
    const leg = String(r.Legajo || "").trim();
    if (leg) m.set(leg, String(r.Empleado || "").trim());
  });
  return m;
}

async function traerPpp(sb: any) {
  const norm = (v: any) => String(v ?? "").trim().toUpperCase();
  const seguro = async (tabla: string) => {
    try { return await paginar(sb, tabla, "tanda,m3,razon_social"); }
    catch (e) { console.error(`PPP: ${tabla} fallo -> ${e}`); return []; }
  };
  const [entregados, webProg, progDiaria] = await Promise.all([
    seguro("vista_ppp_pedidos_entregados"),
    seguro("PPP_Web_Programacion"),
    seguro("GV_PPP_Programacion_Diaria"),   // ojo: lleva prefijo GV_, la otra no existe
  ]);

  // `origen` es solo para el modo diag: calculo.js ignora los campos que no conoce.
  const ppp = entregados.map((r: any) => ({
    tanda: norm(r.tanda), mt3: 0, mt3fc: Number(r.m3) || 0,
    razon: String(r.razon_social || "").trim(), origen: "facturado",
  })).filter((p: any) => p.tanda);

  const aEst = (origen: string) => (r: any) => ({
    tanda: norm(r.tanda), mt3: Number(r.m3) || 0, mt3fc: 0,
    razon: String(r.razon_social || "").trim(), origen,
  });
  const pppProgDiaria = webProg.map(aEst("web")).filter((p: any) => p.tanda);
  const yaEsta = new Set(pppProgDiaria.map((p: any) => p.tanda));
  progDiaria.map(aEst("diaria")).forEach((p: any) => {
    if (p.tanda && !yaEsta.has(p.tanda)) pppProgDiaria.push(p);
  });
  return { ppp, pppProgDiaria };
}

// ---------------------------------------------------------------------------
// PDF. Formato del Excel de Damian: contenido centrado en horizontal y vertical,
// titulo 16 y contenido 14, borde exterior y encabezados gruesos, interior fino.
// ---------------------------------------------------------------------------
type Fila = {
  nombre: string;
  m3Pick: number; m3Arm: number;      // bloque "M3 x Hs"
  dias: number;                       // solo se dibuja si el reporte abarca varios dias
  hsPick: number; hsArm: number; mov: number; sinReg: number;   // bloque "Hs"
};

// Grosor de linea, en mm. La relacion importa mas que el valor: con 0,6 contra 0,15
// el marco exterior no se distinguia del interior. 0,9 contra 0,18 es 5 a 1 y se ve.
const GRUESO = 0.9;   // marco exterior de las tablas y de los encabezados (2,5pt)
const FINO = 0.18;    // divisiones internas (0,5pt)

type Bloque = {
  subtitulo: string;   // "" cuando el PDF tiene una sola tabla (el de un dia suelto)
  filas: Fila[];
  conDias: boolean;    // la columna Dias solo tiene sentido si la fila resume varios dias
};

// Alto fijo de fila cuando el PDF lleva varios bloques. Con el alto elastico del PDF de
// un dia (hasta 10mm) entrarian dos dias por hoja y el informe de una semana saldria de
// cinco carillas.
const H_FILA_MULTI = 8;
const H_SUBTITULO = 7;
const H_PIE = 22;       // las 5 lineas de la nota al pie
const ALTO_A4 = 297;

function construirPdf(titulo: string, bloques: Bloque[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margen = 15;

  // Bloque 1: Empleado + M3 x Hs (Pick, Arm).  Bloque 2: Hs (Pick, Arm, Mov, S/Reg.).
  // Las celdas de numero entran justo 4 digitos ("0,63"): 18mm a 14pt, y "S/Reg." mide
  // 15,1mm. Ancho total 46+18+18 + 4 + 18*4 = 158mm contra los 180mm utiles de un A4.
  // Con la columna Dias (14mm) son 172mm, que siguen entrando.
  const anchosA = [46, 18, 18];
  const HUECO = 4;
  const anchoA = anchosA.reduce((a, b) => a + b, 0);
  const hEnc = 9;
  const xA = margen;
  const xB = xA + anchoA + HUECO;
  const cortesA: number[] = [xA];
  anchosA.forEach((w) => cortesA.push(cortesA[cortesA.length - 1] + w));
  const medioCol = (c: number[], i: number) => (c[i] + c[i + 1]) / 2;
  // 14pt ~ 4.94mm: media altura de mayuscula son ~1.7mm para centrar en vertical
  const medioFila = (yTop: number, h: number) => yTop + h / 2 + 1.7;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(titulo, margen, margen + 6);

  let y = margen + 14;

  // El PDF de UN dia -el que manda el cron- es un solo bloque sin subtitulo, y mantiene
  // el alto de fila elastico de siempre para que salga identico al de antes.
  const unico = bloques.length === 1 && !bloques[0].subtitulo;
  const hayFilas = bloques.some((b) => b.filas.length);

  if (!hayFilas) {
    doc.setFontSize(14); doc.setFont("helvetica", "normal");
    doc.text("Sin registros de produccion para la fecha.", margen, y + 6);
    return doc;
  }

  bloques.forEach((b) => {
    if (!b.filas.length) return;
    const anchosB = b.conDias ? [14, 18, 18, 18, 18] : [18, 18, 18, 18];
    const nB = anchosB.length;
    const anchoB = anchosB.reduce((a, c) => a + c, 0);
    const cortesB: number[] = [xB];
    anchosB.forEach((w) => cortesB.push(cortesB[cortesB.length - 1] + w));

    // Virgilio nunca paso de 7 operarios en un dia; si algun dia crece, la fila del PDF
    // de un dia se achica sola en vez de derramarse fuera de la hoja.
    const hFila = unico
      ? Math.max(6, Math.min(10,
          (ALTO_A4 - margen * 2 - 14 - hEnc * 2 - H_PIE) / b.filas.length))
      : H_FILA_MULTI;

    const alto = (b.subtitulo ? H_SUBTITULO : 0) + hEnc * 2 + b.filas.length * hFila + 6;
    // Salto de pagina SOLO si el bloque entero no entra en lo que queda de hoja: un dia
    // por hoja desperdicia papel, y una tabla cortada al medio no se lee.
    if (!unico && y > margen + 14 && y + alto > ALTO_A4 - margen) {
      doc.addPage();
      y = margen + 6;
    }

    if (b.subtitulo) {
      doc.setFontSize(12); doc.setFont("helvetica", "bold");
      doc.text(b.subtitulo, xA, y + 5);
      y += H_SUBTITULO;
    }

    // --- Encabezados ---
    doc.setFontSize(14); doc.setFont("helvetica", "bold");
    doc.text("Empleado", medioCol(cortesA, 0), medioFila(y, hEnc * 2), { align: "center" });
    doc.text("M3 x Hs", (cortesA[1] + cortesA[3]) / 2, medioFila(y, hEnc), { align: "center" });
    doc.text("Pick", medioCol(cortesA, 1), medioFila(y + hEnc, hEnc), { align: "center" });
    doc.text("Arm", medioCol(cortesA, 2), medioFila(y + hEnc, hEnc), { align: "center" });

    doc.text("Hs", (cortesB[0] + cortesB[nB]) / 2, medioFila(y, hEnc), { align: "center" });
    (b.conDias ? ["Dias", "Pick", "Arm", "Mov", "S/Reg."] : ["Pick", "Arm", "Mov", "S/Reg."])
      .forEach((t, i) =>
        doc.text(t, medioCol(cortesB, i), medioFila(y + hEnc, hEnc), { align: "center" }));

    // Los encabezados van con borde grueso, en los dos bloques
    doc.setDrawColor(0, 0, 0); doc.setLineWidth(GRUESO);
    doc.rect(xA, y, anchoA, hEnc * 2);
    doc.line(cortesA[1], y + hEnc, cortesA[3], y + hEnc);
    doc.line(cortesA[1], y, cortesA[1], y + hEnc * 2);
    doc.line(cortesA[2], y + hEnc, cortesA[2], y + hEnc * 2);

    doc.rect(xB, y, anchoB, hEnc * 2);
    doc.line(cortesB[0], y + hEnc, cortesB[nB], y + hEnc);
    for (let i = 1; i < nB; i++) doc.line(cortesB[i], y + hEnc, cortesB[i], y + hEnc * 2);
    y += hEnc * 2;

    // --- Cuerpo ---
    const yCuerpo = y;
    doc.setFont("helvetica", "normal");
    b.filas.forEach((f) => {
      [f.nombre, celda(f.m3Pick), celda(f.m3Arm)].forEach((v, i) =>
        doc.text(v, medioCol(cortesA, i), medioFila(y, hFila), { align: "center" }));
      const colsB = [celdaHs(f.hsPick), celdaHs(f.hsArm), celdaHs(f.mov), celdaHs(f.sinReg)];
      if (b.conDias) colsB.unshift(String(f.dias));
      colsB.forEach((v, i) =>
        doc.text(v, medioCol(cortesB, i), medioFila(y, hFila), { align: "center" }));
      y += hFila;
    });

    // Lineas internas finas
    doc.setLineWidth(FINO);
    for (let i = 1; i < b.filas.length; i++) {
      const yy = yCuerpo + i * hFila;
      doc.line(xA, yy, xA + anchoA, yy);
      doc.line(xB, yy, xB + anchoB, yy);
    }
    [1, 2].forEach((i) => doc.line(cortesA[i], yCuerpo, cortesA[i], y));
    for (let i = 1; i < nB; i++) doc.line(cortesB[i], yCuerpo, cortesB[i], y);

    // Borde exterior grueso
    doc.setLineWidth(GRUESO);
    doc.rect(xA, yCuerpo, anchoA, y - yCuerpo);
    doc.rect(xB, yCuerpo, anchoB, y - yCuerpo);

    y += 6;   // aire antes del dia siguiente
  });

  // --- Nota al pie, una sola vez, abajo del ultimo bloque ---
  y -= 6;
  if (y + H_PIE > ALTO_A4 - margen) { doc.addPage(); y = margen + 6; }
  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Horas en HH:MM. Mov = todo lo que no es Picking ni Armado (Carga Camion, Control",
           xA, y + 7);
  doc.text("Remitos, Recepciones, Gondola, Conteo, Timbre, Bano, Almuerzo, Limpieza y Permiso).",
           xA, y + 11);
  doc.text("S/Reg. = lo que no quedo registrado dentro de la jornada de 08:00 a 17:00.",
           xA, y + 15);
  doc.text(bloques.some((b) => b.conDias)
    ? "Pick + Arm + Mov + S/Reg. = 9:00 por cada dia trabajado (columna Dias)."
    : "Pick + Arm + Mov + S/Reg. = 9:00 en todas las filas.", xA, y + 19);
  if (bloques.length > 1) {
    doc.text("Una tanda que cruza dos dias lleva su m3 a los dos, asi que los M3 x Hs de los dias "
             + "no suman el del total.", xA, y + 23);
  }
  return doc;
}

// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const responder = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* sin body */ }
    const esTest = body?.test !== false;            // manda a Juan SOLO con test:false explicito
    const soloPdf = body?.solo_pdf === true;
    const soloDiag = body?.diag === true;           // auditoria de m3 por tanda, sin PDF
    // Un solo dia (lo que manda el cron) o un rango. `fecha` sigue andando igual que antes.
    const fecha = body?.fecha || hoyAR();
    const desde = body?.desde || fecha;
    const hasta = body?.hasta || (body?.desde ? hoyAR() : fecha);
    const variosDias = desde !== hasta;

    if (!SUPABASE_SERVICE_KEY) return responder({ error: "falta SUPABASE_SERVICE_ROLE_KEY" }, 500);

    // AUTENTICACION: la hace Supabase, no esta funcion.
    //
    // Se deploya con verify_jwt = true, asi que el gateway exige un JWT valido del proyecto
    // en el header Authorization y rechaza todo lo demas antes de que corra una linea de
    // aca. El que llama manda `Authorization: Bearer <service_role>`, que es exactamente lo
    // que ya hacen los crons gv-ppp-web-tandas-diarias, gv-geocodificar y
    // gv-sync-padron-direcciones de este mismo proyecto.
    //
    // Se intento antes comparar un token contra SUPABASE_SERVICE_ROLE_KEY o contra
    // SEND_WA_TOKEN, y NINGUNO de los dos coincidia con lo que Supabase inyecta en la
    // funcion (dio 401 con los dos valores guardados en lecturacvs.app_secrets). Comparar
    // a mano contra una clave que no se controla es fragil; verify_jwt no tiene ese problema.
    //
    // `token` sigue aceptandose en el body por compatibilidad, pero ya no decide nada.

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // --- Datos ---
    const [produccion, empMap, pppRes] = await Promise.all([
      traerProduccion(sb, desde, hasta), traerEmpleados(sb), traerPpp(sb),
    ]);

    const r = procesar(
      { produccion, ppp: pppRes.ppp, pppProgDiaria: pppRes.pppProgDiaria },
      desde, hasta,
    );

    // --- Auditoria de m3 por tanda (solo con "diag": true) ---------------------
    // Pregunta que contesta: de las tandas que la gente efectivamente trabajo en el
    // rango, cuales NO tienen m3 en ninguna de las tres fuentes. Esas son las que
    // hacen bajar el ratio M3 x Hs sin que se note, porque las horas si se cuentan.
    //
    // NO reimplementa getMt3 de calculo.js: es una busqueda de presencia sobre los
    // MISMOS arrays que se le pasaron a procesar(), que es justo lo que se pregunta.
    if (soloDiag) {
      const porTanda = new Map<string, any>();
      (r.reportes || []).forEach((rep: any) => {
        ([["pick", rep.pickPairs], ["arm", rep.armPairs], ["cc", rep.ccPairs]] as any[])
          .forEach(([tipo, pares]) => (pares || []).forEach((par: any) => {
            if (!par.tanda) return;
            const t = porTanda.get(par.tanda) ||
              { tanda: par.tanda, hs: 0, tipos: new Set<string>(), dias: new Set<string>(),
                legajos: new Set<string>() };
            t.hs += par.hs; t.tipos.add(tipo); t.dias.add(rep.fecha); t.legajos.add(rep.legajo);
            porTanda.set(par.tanda, t);
          }));
      });
      const fuentes = [...pppRes.ppp, ...pppRes.pppProgDiaria];
      const detalle = [...porTanda.values()].map((t: any) => {
        const hits = fuentes.filter((p: any) => p.tanda === t.tanda);
        const m3 = hits.reduce((x: number, p: any) => x + (p.mt3fc || p.mt3 || 0), 0);
        return {
          tanda: t.tanda, hs: +t.hs.toFixed(3),
          tipos: [...t.tipos].join("+"), dias: [...t.dias].join(" "),
          legajos: [...t.legajos].join(","),
          m3: +m3.toFixed(3),
          origen: [...new Set(hits.map((p: any) => p.origen))].join("+") || "-",
          razon: hits.length ? hits[0].razon : "",
        };
      }).sort((a, b) => (a.m3 === 0 ? 0 : 1) - (b.m3 === 0 ? 0 : 1) || b.hs - a.hs);
      const perdidas = detalle.filter((d) => d.m3 === 0);
      return responder({
        diag: true, desde, hasta,
        tandas: detalle.length,
        conM3: detalle.length - perdidas.length,
        sinM3: perdidas.length,
        hsTotal: +detalle.reduce((x, d) => x + d.hs, 0).toFixed(2),
        hsSinM3: +perdidas.reduce((x, d) => x + d.hs, 0).toFixed(2),
        m3Total: +detalle.reduce((x, d) => x + d.m3, 0).toFixed(3),
        detalle,
      });
    }

    // Una fila del PDF a partir de un resumen de calculo.js. Sirve igual para un dia
    // suelto (r.reportes, una fila por fecha+legajo) y para el acumulado del periodo
    // (r.porPersona, que ademas deduplica las tandas que cruzan dia).
    const aFila = (p: any, dias: number): Fila => ({
      nombre: empMap.get(String(p.legajo).trim()) || `Legajo ${p.legajo}`,
      m3Pick: p.pickHs > 0 ? p.pickMt3 / p.pickHs : 0,
      m3Arm: p.armHs > 0 ? p.armMt3 / p.armHs : 0,
      hsPick: p.pickHs,
      hsArm: p.armHs,
      // Mov = todo lo que no es picking ni armado: carga de camion, control de remitos,
      // recepciones, gondola, conteo, timbre y los tiempos muertos.
      //
      // Se saca restando del TOTAL. calculo.js reparte el dia con LIFO, o sea que cada
      // instante se le imputa a UNA sola tarea (la ultima abierta), asi que la suma de
      // todos los netos es igual al TOTAL y esta resta da exactamente el resto.
      // Verificado el 11/09 rubro por rubro: Moncayo 2,58 Control Remitos + 1,37 Recep.
      // Mercaderia + 0,47 Almuerzo + 0,15 Carga Camion = 4,57 = totHs - pick - arm.
      //
      // NO usar (opHs - pick - arm) + muertoHs: opHs es una UNION de intervalos y
      // muertoHs son netos LIFO, asi que mezclarlos cuenta dos veces lo que se solapa.
      mov: Math.max(0, p.totHs - p.pickHs - p.armHs),
      // S/Reg. = las horas de la jornada que NO quedaron registradas, contadas hasta las
      // 17:00. calculo.js ya recorta los segmentos a la ventana 08:00-17:00, asi que
      // totHs nunca pasa de 9 y la resta no da negativo aunque alguien siga despues de
      // hora. Entra todo lo que deja hueco: llegar tarde, irse temprano y los baches del
      // medio. Con varios dias son 9 hs por cada dia que la persona registro algo; los
      // dias que no aparecio no se le cuentan (mide huecos, no ausencias).
      sinReg: Math.max(0, CONFIG.jornadaHs * dias - p.totHs),
      dias,
    });
    // Mayor carga de trabajo arriba; entre los que no hicieron picking ni armado, por Mov
    const ordenar = (f: Fila[]) =>
      f.sort((a, b) => (b.hsPick + b.hsArm) - (a.hsPick + a.hsArm) || b.mov - a.mov);

    const filas: Fila[] = ordenar((r.porPersona || []).map((p: any) => aFila(p, p.dias || 1)));

    // Un bloque por dia dentro del MISMO PDF (no una hoja por dia), y al final el
    // acumulado del periodo. Con un solo dia queda un unico bloque sin subtitulo, que es
    // exactamente el PDF que manda el cron.
    const bloques: Bloque[] = [];
    if (variosDias) {
      const porDia = new Map<string, any[]>();
      (r.reportes || []).forEach((rep: any) => {
        const dia = porDia.get(rep.fecha) || [];
        dia.push(rep);
        porDia.set(rep.fecha, dia);
      });
      // r.reportes ordena por fecha con localeCompare sobre DD/MM/YYYY, que se desordena
      // apenas el rango cruza de mes. Aca se ordena por la fecha de verdad.
      const aIso = (f: string) => f.slice(6, 10) + f.slice(3, 5) + f.slice(0, 2);
      [...porDia.keys()].sort((a, b) => aIso(a).localeCompare(aIso(b))).forEach((fechaDia) => {
        bloques.push({
          subtitulo: fechaDia,
          filas: ordenar((porDia.get(fechaDia) || []).map((rep: any) => aFila(rep, 1))),
          conDias: false,
        });
      });
      bloques.push({ subtitulo: "Total del periodo", filas, conDias: true });
    } else {
      bloques.push({ subtitulo: "", filas, conDias: false });
    }

    const corto = (iso: string) => iso.slice(8, 10) + "/" + iso.slice(5, 7);
    const fechaLinda = hasta.split("-").reverse().join("/");
    const titulo = variosDias
      ? `Logistica Virgilio - ${corto(desde)} al ${corto(hasta)}/${hasta.slice(0, 4)}`
      : `Logistica Virgilio - ${fechaLinda}`;
    const doc = construirPdf(titulo, bloques);

    const archivo = `virgilio_${variosDias ? desde + "_a_" + hasta : fecha}_${Date.now()}.pdf`;
    const bytes = new Uint8Array(doc.output("arraybuffer"));
    const { error: errUp } = await sb.storage.from(BUCKET)
      .upload(archivo, bytes, { contentType: "application/pdf", upsert: true });
    if (errUp) throw new Error("subiendo el PDF: " + errUp.message);
    const pdfUrl = sb.storage.from(BUCKET).getPublicUrl(archivo).data.publicUrl;

    if (soloPdf) {
      // Ademas del link de Storage, el PDF vuelve en base64 y las filas ya formateadas.
      // El link no siempre se puede abrir desde donde se revisa el reporte; con el base64
      // el archivo se reconstruye tal cual, sin depender de la red ni de que el objeto
      // siga en el bucket (el cron limpiar-reportes-viejos los borra a los 3 dias).
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return responder({
        solo_pdf: true, fecha, desde, hasta, operarios: filas.length, pdfUrl,
        pdf_bytes: bytes.length, pdf_base64: btoa(bin),
        legajosExcluidos: CONFIG.legajosTest,
        bloques: bloques.map((b) => ({
          subtitulo: b.subtitulo || "(unico)",
          filas: b.filas.map((f) => ({
            nombre: f.nombre, dias: f.dias,
            m3Pick: celda(f.m3Pick), m3Arm: celda(f.m3Arm),
            hsPick: celdaHs(f.hsPick), hsArm: celdaHs(f.hsArm), mov: celdaHs(f.mov),
            sinReg: celdaHs(f.sinReg),
          })),
        })),
      });
    }

    // --- WhatsApp ---
    const numeros = esTest ? DESTINATARIOS_TEST : DESTINATARIOS_PROD;
    // Token de Meta: tampoco se guarda aca. Lo manda el que llama, sacandolo de
    // lecturacvs.app_secrets en el SQL del cron. Si algun dia se carga como secret de la
    // funcion (WA_TOKEN), ese gana y el cron ya no necesita mandarlo.
    const waToken = Deno.env.get("WA_TOKEN") || String(body?.wa_token || "");
    if (!waToken) {
      // El PDF ya quedo subido, asi que se devuelve el link igual: la corrida no se pierde.
      return responder({ error: "falta el token de Meta (body.wa_token o secret WA_TOKEN)",
                         pdfUrl }, 500);
    }

    const waUrl = `https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`;
    // {{1}} del cuerpo: "Tu reporte de produccion del 11/09/2026 esta listo."
    // Va solo la fecha; con la hora al lado la frase queda rara.
    const param1 = fechaLinda;
    const resultados: any[] = [];

    for (const numero of numeros) {
      let ultimo: any = { numero, ok: false, error: "sin intentos" };
      for (let intento = 1; intento <= MAX_RETRIES; intento++) {
        try {
          const res = await fetch(waUrl, {
            method: "POST",
            headers: { Authorization: `Bearer ${waToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              messaging_product: "whatsapp", to: numero, type: "template",
              template: {
                name: WA_TEMPLATE, language: { code: WA_IDIOMA },
                components: [
                  { type: "header", parameters: [{ type: "document",
                      document: { link: pdfUrl, filename: `Virgilio_${fecha}.pdf` } }] },
                  { type: "body", parameters: [{ type: "text", text: param1 }] },
                ],
              },
            }),
          });
          const data = await res.json();
          ultimo = { numero, ok: res.ok, intentos: intento, error: res.ok ? undefined : data?.error?.message };
          if (res.ok) break;
        } catch (err) {
          ultimo = { numero, ok: false, intentos: intento, error: String(err) };
        }
        if (intento < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
      }
      resultados.push(ultimo);
    }

    return responder({
      test: esTest, fecha, hora: horaAR(), plantilla: WA_TEMPLATE,
      operarios: filas.length, eventos: produccion.length,
      enviados: resultados.filter((x) => x.ok).length, total: numeros.length,
      pdfUrl, resultados,
    });
  } catch (err) {
    console.error(err);
    return responder({ error: String(err) }, 500);
  }
});
