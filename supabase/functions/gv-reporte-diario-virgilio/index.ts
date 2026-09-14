// Reporte diario de Logistica Virgilio para Juan, por WhatsApp.
//
// Espejo de la edge function `reporte-diario-rendimiento` (la de Damian): arma un PDF,
// lo sube al bucket `reportes` de Storage y lo manda como header tipo `document` de una
// plantilla de WhatsApp Cloud API. Lo que cambia es la fuente de datos (Virgilio en vez
// de Cervantes) y el formato del PDF (el Excel que paso Damian: Picking, Armado y Mov).
//
// LOS NUMEROS SALEN DE calculo.js, COPIADO AL DEPLOY.
// El archivo Produccion/InformesVirgilio/calculo.js se sube como segundo archivo de esta
// funcion tal cual esta, con UNA sola linea agregada al final:
//     export { procesar, CONFIG };
// (el archivo del repo es un <script> comun del navegador y no puede llevar `export`).
// De esa forma el PDF y la pantalla no pueden dar distinto. Si alguien edita calculo.js,
// hay que redeployar esta funcion o los numeros se separan. Ver README.md de esta carpeta.
//
// Invocacion:
//   { "token": "<SEND_WA_TOKEN>" }                        -> hoy, a los numeros de prueba
//   { "token": "...", "fecha": "2026-09-11" }             -> un dia anterior, a prueba
//   { "token": "...", "test": false }                     -> hoy, a Juan
//   { "token": "...", "solo_pdf": true }                  -> genera y sube el PDF, no manda nada
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
// Numeros: coma decimal y cero mostrado como "-" (pedido de Elias).
// ---------------------------------------------------------------------------
function celda(v: number, dec = 2): string {
  if (!v || !isFinite(v) || Math.abs(v) < 5e-3) return "-";
  return v.toFixed(dec).replace(".", ",");
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

async function traerProduccion(sb: any, fecha: string) {
  // Se traen dias previos porque un par puede abrirse un dia y cerrarse al siguiente
  // habil; calculo.js despues recorta los segmentos al rango pedido.
  const desde = isoARestando(fecha, DIAS_HACIA_ATRAS);
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

  const ppp = entregados.map((r: any) => ({
    tanda: norm(r.tanda), mt3: 0, mt3fc: Number(r.m3) || 0,
    razon: String(r.razon_social || "").trim(),
  })).filter((p: any) => p.tanda);

  const aEst = (r: any) => ({
    tanda: norm(r.tanda), mt3: Number(r.m3) || 0, mt3fc: 0,
    razon: String(r.razon_social || "").trim(),
  });
  const pppProgDiaria = webProg.map(aEst).filter((p: any) => p.tanda);
  const yaEsta = new Set(pppProgDiaria.map((p: any) => p.tanda));
  progDiaria.map(aEst).forEach((p: any) => {
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
  hsPick: number; hsArm: number; mov: number;   // bloque "Hs"
};

// Grosor de linea, en mm. La relacion importa mas que el valor: con 0,6 contra 0,15
// el marco exterior no se distinguia del interior. 0,9 contra 0,18 es 5 a 1 y se ve.
const GRUESO = 0.9;   // marco exterior de las tablas y de los encabezados (2,5pt)
const FINO = 0.18;    // divisiones internas (0,5pt)

function construirPdf(titulo: string, filas: Fila[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const margen = 15;

  // Dos bloques separados por un hueco, como la columna angosta del Excel.
  // Bloque 1: Empleado + M3 x Hs (Pick, Arm).  Bloque 2: Hs (Pick, Arm, Mov).
  // Las celdas de numero entran justo 4 digitos ("0,63"): 18mm a 14pt.
  const anchosA = [46, 18, 18];
  const anchosB = [18, 18, 18];
  const HUECO = 4;
  const anchoA = anchosA.reduce((a, b) => a + b, 0);
  const anchoB = anchosB.reduce((a, b) => a + b, 0);
  const hEnc = 9;

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(16); doc.setFont("helvetica", "bold");
  doc.text(titulo, margen, margen + 6);

  let y = margen + 14;

  if (!filas.length) {
    doc.setFontSize(14); doc.setFont("helvetica", "normal");
    doc.text("Sin registros de produccion para la fecha.", margen, y + 6);
    return doc;
  }

  // Virgilio nunca paso de 7 operarios en un dia; si algun dia crece, la fila se achica
  // sola en vez de derramarse fuera de la hoja (A4: 297mm de alto).
  const disponible = 297 - margen * 2 - 14 - hEnc * 2 - 12;
  const hFila = Math.max(6, Math.min(10, disponible / filas.length));

  const xA = margen;
  const xB = xA + anchoA + HUECO;
  const cortesA: number[] = [xA]; anchosA.forEach((w) => cortesA.push(cortesA[cortesA.length - 1] + w));
  const cortesB: number[] = [xB]; anchosB.forEach((w) => cortesB.push(cortesB[cortesB.length - 1] + w));
  const medioCol = (c: number[], i: number) => (c[i] + c[i + 1]) / 2;
  // 14pt ~ 4.94mm: media altura de mayuscula son ~1.7mm para centrar en vertical
  const medioFila = (yTop: number, h: number) => yTop + h / 2 + 1.7;

  // --- Encabezados ---
  doc.setFontSize(14); doc.setFont("helvetica", "bold");
  doc.text("Empleado", medioCol(cortesA, 0), medioFila(y, hEnc * 2), { align: "center" });
  doc.text("M3 x Hs", (cortesA[1] + cortesA[3]) / 2, medioFila(y, hEnc), { align: "center" });
  doc.text("Pick", medioCol(cortesA, 1), medioFila(y + hEnc, hEnc), { align: "center" });
  doc.text("Arm", medioCol(cortesA, 2), medioFila(y + hEnc, hEnc), { align: "center" });

  doc.text("Hs", (cortesB[0] + cortesB[3]) / 2, medioFila(y, hEnc), { align: "center" });
  ["Pick", "Arm", "Mov"].forEach((t, i) =>
    doc.text(t, medioCol(cortesB, i), medioFila(y + hEnc, hEnc), { align: "center" }));

  // Los encabezados van con borde grueso, en los dos bloques
  doc.setDrawColor(0, 0, 0); doc.setLineWidth(GRUESO);
  doc.rect(xA, y, anchoA, hEnc * 2);
  doc.line(cortesA[1], y + hEnc, cortesA[3], y + hEnc);
  doc.line(cortesA[1], y, cortesA[1], y + hEnc * 2);
  doc.line(cortesA[2], y + hEnc, cortesA[2], y + hEnc * 2);

  doc.rect(xB, y, anchoB, hEnc * 2);
  doc.line(cortesB[0], y + hEnc, cortesB[3], y + hEnc);
  [1, 2].forEach((i) => doc.line(cortesB[i], y + hEnc, cortesB[i], y + hEnc * 2));
  y += hEnc * 2;

  // --- Cuerpo ---
  const yCuerpo = y;
  doc.setFont("helvetica", "normal");
  filas.forEach((f) => {
    [f.nombre, celda(f.m3Pick), celda(f.m3Arm)].forEach((v, i) =>
      doc.text(v, medioCol(cortesA, i), medioFila(y, hFila), { align: "center" }));
    [celda(f.hsPick), celda(f.hsArm), celda(f.mov)].forEach((v, i) =>
      doc.text(v, medioCol(cortesB, i), medioFila(y, hFila), { align: "center" }));
    y += hFila;
  });

  // Lineas internas finas
  doc.setLineWidth(FINO);
  for (let i = 1; i < filas.length; i++) {
    const yy = yCuerpo + i * hFila;
    doc.line(xA, yy, xA + anchoA, yy);
    doc.line(xB, yy, xB + anchoB, yy);
  }
  [1, 2].forEach((i) => doc.line(cortesA[i], yCuerpo, cortesA[i], y));
  [1, 2].forEach((i) => doc.line(cortesB[i], yCuerpo, cortesB[i], y));

  // Borde exterior grueso
  doc.setLineWidth(GRUESO);
  doc.rect(xA, yCuerpo, anchoA, y - yCuerpo);
  doc.rect(xB, yCuerpo, anchoB, y - yCuerpo);

  doc.setFontSize(9); doc.setFont("helvetica", "normal");
  doc.text("Horas en decimal. Mov = todo lo que no es Picking ni Armado (Carga Camion, Control",
           xA, y + 7);
  doc.text("Remitos, Recepciones, Gondola, Conteo, Timbre, Bano, Almuerzo, Limpieza y Permiso).",
           xA, y + 11);
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
    const url = new URL(req.url);
    const token = body?.token || url.searchParams.get("token") || "";
    const esTest = body?.test !== false;            // manda a Juan SOLO con test:false explicito
    const soloPdf = body?.solo_pdf === true;
    const fecha = body?.fecha || hoyAR();

    if (!SUPABASE_SERVICE_KEY) return responder({ error: "falta SUPABASE_SERVICE_ROLE_KEY" }, 500);

    // La funcion es publica (verify_jwt en false, porque pg_cron la llama sin Authorization),
    // asi que se valida con un token compartido. El schema lecturacvs NO esta expuesto a
    // PostgREST, asi que la funcion NO puede leer app_secrets: el secreto se resuelve en el
    // SQL del cron y viaja en el body, igual que en los crons planify_* y gv-* de este mismo
    // proyecto. Aca solo se compara contra el secret de la funcion.
    const esperado = Deno.env.get("SEND_WA_TOKEN") || "";
    if (!esperado) return responder({ error: "falta el secret SEND_WA_TOKEN de la funcion" }, 500);
    if (token !== esperado) return responder({ error: "token invalido" }, 401);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // --- Datos ---
    const [produccion, empMap, pppRes] = await Promise.all([
      traerProduccion(sb, fecha), traerEmpleados(sb), traerPpp(sb),
    ]);

    const r = procesar(
      { produccion, ppp: pppRes.ppp, pppProgDiaria: pppRes.pppProgDiaria },
      fecha, fecha,
    );

    const filas: Fila[] = (r.porPersona || [])
      .map((p: any) => ({
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
        // Ese camino le sumaba 0,47 hs de mas a Moncayo ese mismo dia.
        mov: Math.max(0, p.totHs - p.pickHs - p.armHs),
      }))
      // Mayor carga de trabajo arriba; entre los que no hicieron picking ni armado, por Mov
      .sort((a: Fila, b: Fila) => (b.hsPick + b.hsArm) - (a.hsPick + a.hsArm) || b.mov - a.mov);

    const fechaLinda = fecha.split("-").reverse().join("/");
    const doc = construirPdf(`Logistica Virgilio - ${fechaLinda}`, filas);

    const archivo = `virgilio_${fecha}_${Date.now()}.pdf`;
    const { error: errUp } = await sb.storage.from(BUCKET)
      .upload(archivo, doc.output("arraybuffer"), { contentType: "application/pdf", upsert: true });
    if (errUp) throw new Error("subiendo el PDF: " + errUp.message);
    const pdfUrl = sb.storage.from(BUCKET).getPublicUrl(archivo).data.publicUrl;

    if (soloPdf) {
      return responder({ solo_pdf: true, fecha, operarios: filas.length, pdfUrl,
                         legajosExcluidos: CONFIG.legajosTest });
    }

    // --- WhatsApp ---
    const numeros = esTest ? DESTINATARIOS_TEST : DESTINATARIOS_PROD;
    const waToken = Deno.env.get("WA_TOKEN") || "";
    if (!waToken) {
      // El PDF ya quedo subido, asi que se devuelve el link igual: la corrida no se pierde.
      return responder({ error: "falta el secret WA_TOKEN de la funcion", pdfUrl }, 500);
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
