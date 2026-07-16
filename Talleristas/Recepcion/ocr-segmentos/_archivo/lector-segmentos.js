// ============================================================================
// MOTOR 7-SEGMENTOS — Cervantes-v1.0
// Lee remitos con plantilla v1.0 (fiduciales 8x8mm + casillas pre-impresas "8" gris).
// Requiere opencv.js cargado en window.cv.
// API: window.LectorSegmentos.leerRemito(imgElement, layout)
// ============================================================================

import {
  CANVAS_REF, FIDUCIALES, CASILLA_PX,
  SEGMENTOS_RELATIVOS, DIGITOS_A_PATRON,
  UMBRAL_SEGMENTO, UMBRAL_TINTA, UMBRAL_CONFIANZA,
} from "./config.js";

// Cuando un pixel cuenta como "oscuro" en absoluto (0..255, menor = mas oscuro)
// El "8" preimpreso es gris #c8c8c8 (200). Fibron es ~0. Usamos 220 como corte
// inicial, el doble umbral filtra el gris despues.
const DARK_PIXEL_CUTOFF = 220;

// ============================================================================
// 1. Cargar imagen del input <input type="file"> a un cv.Mat
// ============================================================================
export async function cargarImagen(fileOrImg) {
  return new Promise((resolve, reject) => {
    if (fileOrImg instanceof HTMLImageElement) {
      if (fileOrImg.complete) resolve(cv.imread(fileOrImg));
      else {
        fileOrImg.onload = () => resolve(cv.imread(fileOrImg));
        fileOrImg.onerror = reject;
      }
    } else {
      const img = new Image();
      img.onload = () => resolve(cv.imread(img));
      img.onerror = reject;
      img.src = typeof fileOrImg === "string"
        ? fileOrImg
        : URL.createObjectURL(fileOrImg);
    }
  });
}

// ============================================================================
// 2. Detectar las 4 fiduciales (cuadrados negros) en la imagen del telefono
// Estrategia: threshold global Otsu, findContours, quedarse con cuadrilateros
// "negros y solidos" cercanos a las 4 esquinas de la imagen, ordenar por posicion.
// ============================================================================
export function detectarFiduciales(src) {
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const thr  = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  // Pequeno blur para limpiar ruido antes del threshold
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  cv.threshold(blur, thr, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  // Morfologia: close para llenar agujeros del fiducial, luego open para limpiar texto
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.morphologyEx(thr, thr, cv.MORPH_CLOSE, kernel);

  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thr, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  // Filtro estricto: cuadrados solidos con area en rango esperado
  const candidatos = [];
  const imgArea = src.rows * src.cols;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    // Fiducial 8x8mm. A 1m de distancia con celular = ~50-100px lado = ~2500-10000 px area
    // Rango generoso pero acotado: 0.0005 a 0.03 del area de la imagen
    if (area < imgArea * 0.0005 || area > imgArea * 0.03) { c.delete(); continue; }
    const rect = cv.boundingRect(c);
    // Cuadrado: ratio w/h cercano a 1
    const ratio = rect.width / rect.height;
    if (ratio < 0.65 || ratio > 1.55) { c.delete(); continue; }
    // Solidez: contorno llena su bounding box (cuadrado lleno, no texto)
    const solidez = area / (rect.width * rect.height);
    if (solidez < 0.80) { c.delete(); continue; }
    candidatos.push({
      cx: rect.x + rect.width / 2,
      cy: rect.y + rect.height / 2,
      area, w: rect.width, h: rect.height, solidez, ratio,
    });
    c.delete();
  }
  contours.delete(); hier.delete(); gray.delete(); blur.delete(); thr.delete(); kernel.delete();

  if (candidatos.length < 4) {
    throw new Error(`Solo ${candidatos.length} cuadrados solidos detectados (necesito 4 fiduciales). ` +
                    `Foto borrosa, sombra muy fuerte, o plantilla sin fiduciales impresos?`);
  }

  // Estrategia robusta: los 4 fiduciales son los 4 PUNTOS EXTREMOS del set
  //   tl = min(x+y)
  //   tr = max(x-y)   (mas a la derecha menos arriba = mas a la derecha)
  //   br = max(x+y)
  //   bl = min(x-y)
  // Esto funciona aunque la foto este rotada/oblicua: los 4 extremos siguen siendo
  // los 4 fiduciales, no manchitas centrales.
  let tl = candidatos[0], tr = candidatos[0], br = candidatos[0], bl = candidatos[0];
  for (const c of candidatos) {
    if (c.cx + c.cy < tl.cx + tl.cy) tl = c;
    if (c.cx - c.cy > tr.cx - tr.cy) tr = c;
    if (c.cx + c.cy > br.cx + br.cy) br = c;
    if (c.cx - c.cy < bl.cx - bl.cy) bl = c;
  }

  // Validacion: los 4 son distintos
  const ids = new Set([tl, tr, br, bl].map(c => `${c.cx},${c.cy}`));
  if (ids.size !== 4) {
    throw new Error(`Fiduciales detectadas son duplicadas. ${candidatos.length} candidatos, ` +
                    `pero el set extremo colapsa. Foto muy oblicua o muy zoom (no se ve la hoja entera)?`);
  }

  // Sanity check: la separacion vertical entre TL y BL debe ser > 30% del alto de la imagen
  // Si no, son cuatro puntitos juntos (no son los fiduciales de las esquinas)
  const sepY = Math.min(bl.cy, br.cy) - Math.max(tl.cy, tr.cy);
  const sepX = Math.min(tr.cx, br.cx) - Math.max(tl.cx, bl.cx);
  if (sepY < src.rows * 0.3 || sepX < src.cols * 0.3) {
    throw new Error(`Fiduciales muy juntos (sep ${sepX.toFixed(0)}x${sepY.toFixed(0)} px ` +
                    `vs imagen ${src.cols}x${src.rows}). La foto no muestra la hoja completa o ` +
                    `los puntos detectados son texto/sombras, no los cuadrados negros de esquina.`);
  }

  return {
    tl: { x: tl.cx, y: tl.cy },
    tr: { x: tr.cx, y: tr.cy },
    bl: { x: bl.cx, y: bl.cy },
    br: { x: br.cx, y: br.cy },
    _candidatos: candidatos.length,
  };
}

// ============================================================================
// 2b. Detectar fiduciales con debug: devuelve TODOS los candidatos + los 4 elegidos
// Sirve cuando la deteccion falla y queremos ver que vio.
// ============================================================================
export function detectarFiducialesDebug(src) {
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const thr  = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
  cv.threshold(blur, thr, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.morphologyEx(thr, thr, cv.MORPH_CLOSE, kernel);
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(thr, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const candidatos = [];
  const imgArea = src.rows * src.cols;
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const area = cv.contourArea(c);
    const rect = cv.boundingRect(c);
    const ratio = rect.width / rect.height;
    const solidez = area / (rect.width * rect.height);
    const cand = {
      cx: rect.x + rect.width / 2,
      cy: rect.y + rect.height / 2,
      area, w: rect.width, h: rect.height, ratio, solidez,
      pasaArea: area >= imgArea * 0.0005 && area <= imgArea * 0.03,
      pasaRatio: ratio >= 0.65 && ratio <= 1.55,
      pasaSolidez: solidez >= 0.80,
    };
    cand.aceptado = cand.pasaArea && cand.pasaRatio && cand.pasaSolidez;
    candidatos.push(cand);
    c.delete();
  }
  contours.delete(); hier.delete(); gray.delete(); blur.delete(); thr.delete(); kernel.delete();
  return { candidatos, imgArea, imgSize: { w: src.cols, h: src.rows } };
}

// ============================================================================
// 3. Rectificar perspectiva: warpPerspective desde 4 fiduciales -> canvas ref
// ============================================================================
export function rectificar(src, fiduciales) {
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    fiduciales.tl.x, fiduciales.tl.y,
    fiduciales.tr.x, fiduciales.tr.y,
    fiduciales.bl.x, fiduciales.bl.y,
    fiduciales.br.x, fiduciales.br.y,
  ]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    FIDUCIALES.tl.x, FIDUCIALES.tl.y,
    FIDUCIALES.tr.x, FIDUCIALES.tr.y,
    FIDUCIALES.bl.x, FIDUCIALES.bl.y,
    FIDUCIALES.br.x, FIDUCIALES.br.y,
  ]);
  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const warped = new cv.Mat();
  cv.warpPerspective(
    src, warped, M,
    new cv.Size(CANVAS_REF.width, CANVAS_REF.height),
    cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255)
  );
  srcPts.delete(); dstPts.delete(); M.delete();
  return warped;
}

// ============================================================================
// 4. Recortar UNA casilla del canvas rectificado (devuelve ImageData en grayscale)
// ============================================================================
export function recortarCasilla(warpedGray, centerXY) {
  const { w: cw, h: ch } = CASILLA_PX;
  const x = Math.round(centerXY.x - cw / 2);
  const y = Math.round(centerXY.y - ch / 2);
  const rect = new cv.Rect(x, y, cw, ch);
  return warpedGray.roi(rect);  // sub-Mat (devolver para que el caller delete)
}

// ============================================================================
// 5. Evaluar UN segmento dentro de una casilla recortada
// Devuelve {encendido, ratio, oscuridad, confianza}
// ============================================================================
export function evaluarSegmento(casillaMat, segDef) {
  const { w: cw, h: ch } = CASILLA_PX;
  const x0 = Math.round(segDef.x0 * cw);
  const x1 = Math.round(segDef.x1 * cw);
  const y0 = Math.round(segDef.y0 * ch);
  const y1 = Math.round(segDef.y1 * ch);
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);

  const zonaRect = new cv.Rect(x0, y0, w, h);
  const zona = casillaMat.roi(zonaRect);
  const data = zona.data;
  let darkCount = 0;
  let darkSum = 0;
  const total = data.length;
  for (let i = 0; i < total; i++) {
    const v = data[i];
    if (v < DARK_PIXEL_CUTOFF) {
      darkCount++;
      darkSum += v;
    }
  }
  zona.delete();

  const ratio = darkCount / total;
  // oscuridad promedio de los pixeles oscuros: 1 = negro puro, 0 = blanco
  const meanGray = darkCount > 0 ? darkSum / darkCount : 255;
  const oscuridad = 1 - meanGray / 255;

  const encendido = (ratio > UMBRAL_SEGMENTO) && (oscuridad > UMBRAL_TINTA);

  // Confianza por segmento: cuan lejos esta del umbral, mas confianza
  let confianza;
  if (encendido) {
    // Encendido: confianza alta si ratio y oscuridad estan bien por encima
    const margenRatio = Math.min(1, (ratio - UMBRAL_SEGMENTO) / (1 - UMBRAL_SEGMENTO));
    const margenOscur = Math.min(1, (oscuridad - UMBRAL_TINTA) / (1 - UMBRAL_TINTA));
    confianza = Math.min(margenRatio + 0.3, margenOscur + 0.3, 1);
  } else {
    // Apagado: confianza alta si bien por debajo de los umbrales
    if (ratio < UMBRAL_SEGMENTO * 0.5) confianza = 0.95;
    else if (ratio < UMBRAL_SEGMENTO * 0.9) confianza = 0.7;
    else confianza = 0.4;  // borderline apagado
  }
  return { encendido, ratio: +ratio.toFixed(3), oscuridad: +oscuridad.toFixed(3), confianza: +confianza.toFixed(3) };
}

// ============================================================================
// 6. Decidir digito a partir del patron de 7 bits encendidos/apagados
// Devuelve {digito, confianza, patron, vacia}
// ============================================================================
export function decidirDigito(patronBits) {
  // Si ningun segmento esta encendido -> vacia (no es "0", es "no completado")
  const totalOn = patronBits.reduce((s, b) => s + b, 0);
  if (totalOn === 0) {
    return { digito: null, confianza: 1.0, vacia: true, patron: patronBits, match: null };
  }

  // Comparar contra cada digito, contar diferencias por segmento
  let best = null, bestDiff = 8;
  for (const [digit, pat] of Object.entries(DIGITOS_A_PATRON)) {
    let diff = 0;
    for (let i = 0; i < 7; i++) if (pat[i] !== patronBits[i]) diff++;
    if (diff < bestDiff) { bestDiff = diff; best = +digit; }
  }
  // Confianza basada en cuantos segmentos coinciden: 7/7=1.0, 6/7=0.7, 5/7=0.4, ...
  const confianza = bestDiff === 0 ? 1.0
                  : bestDiff === 1 ? 0.6
                  : bestDiff === 2 ? 0.3
                  : 0.1;
  return { digito: best, confianza, vacia: false, patron: patronBits, match: bestDiff };
}

// ============================================================================
// 7. Leer UNA casilla: devuelve {valor, confianza, estado, segmentos, patron}
//    estado in {"vacia", "leida", "revisar"}
// ============================================================================
export function leerCasilla(warpedGray, centerXY) {
  const casilla = recortarCasilla(warpedGray, centerXY);
  const ordenSegs = ["a","b","c","d","e","f","g"];
  const segs = {};
  const patron = [];
  let confSegMin = 1;
  for (const s of ordenSegs) {
    const r = evaluarSegmento(casilla, SEGMENTOS_RELATIVOS[s]);
    segs[s] = r;
    patron.push(r.encendido ? 1 : 0);
    if (r.confianza < confSegMin) confSegMin = r.confianza;
  }
  casilla.delete();

  const dec = decidirDigito(patron);

  // Confianza final = min(confianza segmentos, confianza digito)
  const confFinal = Math.min(confSegMin, dec.confianza);

  let estado;
  if (dec.vacia) estado = "vacia";
  else if (confFinal >= UMBRAL_CONFIANZA) estado = "leida";
  else estado = "revisar";

  return {
    valor: dec.vacia ? null : dec.digito,
    confianza: +confFinal.toFixed(3),
    estado,
    patron,
    match_diff: dec.match,
    segmentos: segs,
  };
}

// ============================================================================
// 8. Leer un NUMERO formado por N casillas (ej. 3 para cajas, 2 para DD/MM)
// Si TODAS las casillas estan vacias -> vacia (null)
// Si alguna esta leida y otra vacia -> tratar vacia como 0 (instruccion del template)
//   ej: casilla1=vacia, casilla2=4, casilla3=5 -> "045" = 45
// Si alguna esta "revisar" -> el numero entero queda "revisar"
// ============================================================================
export function leerNumero(warpedGray, casillas) {
  const lecturas = casillas.map(c => leerCasilla(warpedGray, c));

  // Si todas vacias -> num vacio
  if (lecturas.every(l => l.estado === "vacia")) {
    return { valor: null, estado: "vacia", confianza: 1.0, casillas: lecturas };
  }
  // Si alguna a revisar -> el numero entero queda en revision
  const hayRevisar = lecturas.some(l => l.estado === "revisar");

  // Casilla vacia en posicion intermedia/final cuenta como 0
  // (el template dice: "Casillas en blanco se leen como cero")
  const digitos = lecturas.map(l => l.estado === "vacia" ? 0 : l.valor);
  const numStr = digitos.join("");
  const num = parseInt(numStr, 10);

  const confMin = Math.min(...lecturas.map(l => l.confianza));

  return {
    valor: num,
    estado: hayRevisar ? "revisar" : (confMin >= UMBRAL_CONFIANZA ? "leida" : "revisar"),
    confianza: +confMin.toFixed(3),
    casillas: lecturas,
  };
}

// ============================================================================
// 9. Leer EL REMITO COMPLETO
//    layout = LAYOUT_LUCHO (o el del tallerista que corresponda)
//    Devuelve: { fecha:"DD/MM", cod_ch, ncp, articulos:[{cod,cajas,confianza,estado}], requiere_revision[] }
// ============================================================================
export async function leerRemito(imgElement, layout) {
  // Esperar opencv.js
  if (typeof cv === "undefined" || !cv.Mat) {
    throw new Error("OpenCV.js no cargado. Asegurate de incluirlo en el HTML antes que este script.");
  }

  const src = await cargarImagen(imgElement);
  let fids, warped, warpedGray;
  try {
    fids = detectarFiduciales(src);
    warped = rectificar(src, fids);
    warpedGray = new cv.Mat();
    cv.cvtColor(warped, warpedGray, cv.COLOR_RGBA2GRAY);

    // Fecha: 4 casillas, primeras 2 = DD, ultimas 2 = MM
    const fechaLect = layout.encabezado.fecha.map(p => leerCasilla(warpedGray, p));
    const dd = formatearDosDigitos(fechaLect.slice(0, 2));
    const mm = formatearDosDigitos(fechaLect.slice(2, 4));
    const fechaStr = (dd && mm) ? `${dd}/${mm}` : null;

    // Cod CH (4 casillas) y NCP (4 casillas): leemos como numero entero
    const codChNum = leerNumero(warpedGray, layout.encabezado.cod_ch);
    const ncpNum   = leerNumero(warpedGray, layout.encabezado.ncp);

    // Cajas: 20 numeros de 3 digitos
    const articulos = [];
    const requiereRevision = [];
    for (let i = 0; i < layout.cods.length; i++) {
      const cod = layout.cods[i];
      const casillas3 = layout.cajas.slice(i * 3, i * 3 + 3);
      const num = leerNumero(warpedGray, casillas3);
      const art = {
        cod,
        cajas: num.valor,
        confianza: num.confianza,
        estado: num.estado,
        casillas: num.casillas.map(c => ({ valor: c.valor, confianza: c.confianza, estado: c.estado })),
      };
      articulos.push(art);
      if (num.estado === "revisar") requiereRevision.push(cod);
    }

    if (fechaLect.some(l => l.estado === "revisar")) requiereRevision.push("FECHA");
    if (codChNum.estado === "revisar") requiereRevision.push("COD_CH");
    if (ncpNum.estado === "revisar")   requiereRevision.push("NCP");

    return {
      tallerista: layout.tallerista,
      cod_lk: layout.cod_lk,
      fecha: fechaStr,
      fecha_estado: fechaLect.some(l => l.estado === "vacia")
        ? (fechaLect.every(l => l.estado === "vacia") ? "vacia" : "parcial")
        : "leida",
      cod_ch: codChNum.estado === "vacia" ? null : codChNum.valor,
      ncp: ncpNum.estado === "vacia" ? null : ncpNum.valor,
      articulos,
      requiere_revision: requiereRevision,
      plantilla_version: layout.plantilla_version || "Cervantes-v1.0",
      _debug: {
        fiduciales: fids,
        canvasRef: { w: CANVAS_REF.width, h: CANVAS_REF.height },
        warped,  // se devuelve para que el caller pueda mostrar; el caller debe delete despues
      },
    };
  } finally {
    src.delete();
    // warped/warpedGray los devolvemos en _debug; caller delete
    if (warpedGray) warpedGray.delete();
  }
}

// Formatea 2 casillas como string "DD" o "MM". Si ambas vacias -> null.
function formatearDosDigitos(lecturas) {
  if (lecturas.every(l => l.estado === "vacia")) return null;
  const dig = lecturas.map(l => l.estado === "vacia" ? "0" : String(l.valor));
  return dig.join("");
}

// Exponer en window para uso desde HTML que no usa modulos
if (typeof window !== "undefined") {
  window.LectorSegmentos = {
    cargarImagen, detectarFiduciales, detectarFiducialesDebug, rectificar,
    recortarCasilla, evaluarSegmento, decidirDigito,
    leerCasilla, leerNumero, leerRemito,
  };
}
