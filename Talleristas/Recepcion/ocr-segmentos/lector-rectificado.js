// ============================================================================
// MOTOR RECTIFICADO — Cervantes-v1.0
// Pipeline cliente: foto -> fiduciales -> warpPerspective -> limpieza -> crops
//                   -> tile compuesto -> POST a Edge Function paso 3 (GPT-4o vision)
//
// Reemplaza al motor 7-segmentos (lector-segmentos.js, deprecado en _archivo/),
// que asumia que el tallerista repintaba segmentos exactos. Como en la practica
// el tallerista escribe el digito completo dentro del cuadradito (sin respetar
// segmentos), conviene rectificar + limpiar el "8" guia gris y pasar las casillas
// crudas a un modelo de vision para que decida el digito 0-9.
//
// Requiere opencv.js cargado en window.cv.
// API: window.LectorRectificado.* (mismo patron que el motor viejo)
// ============================================================================

import {
  CANVAS_REF, FIDUCIALES, CASILLA_PX,
} from "./config.js";

// ============================================================================
// 1. Cargar imagen (file input | HTMLImageElement | dataURL string) a cv.Mat
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
// 2. Detectar las 4 fiduciales (cuadrados negros 8x8mm en las esquinas)
// Identico al motor viejo: GaussianBlur + Otsu + MORPH_CLOSE, filtra por area/
// ratio/solidez, selecciona los 4 PUNTOS EXTREMOS (tl=min(x+y), tr=max(x-y),
// br=max(x+y), bl=min(x-y)) y valida separacion > 30% del lado.
// ============================================================================
export function detectarFiduciales(src) {
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
    if (area < imgArea * 0.0005 || area > imgArea * 0.03) { c.delete(); continue; }
    const rect = cv.boundingRect(c);
    const ratio = rect.width / rect.height;
    if (ratio < 0.65 || ratio > 1.55) { c.delete(); continue; }
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

  let tl = candidatos[0], tr = candidatos[0], br = candidatos[0], bl = candidatos[0];
  for (const c of candidatos) {
    if (c.cx + c.cy < tl.cx + tl.cy) tl = c;
    if (c.cx - c.cy > tr.cx - tr.cy) tr = c;
    if (c.cx + c.cy > br.cx + br.cy) br = c;
    if (c.cx - c.cy < bl.cx - bl.cy) bl = c;
  }

  const ids = new Set([tl, tr, br, bl].map(c => `${c.cx},${c.cy}`));
  if (ids.size !== 4) {
    throw new Error(`Fiduciales detectadas son duplicadas. ${candidatos.length} candidatos, ` +
                    `pero el set extremo colapsa. Foto muy oblicua o muy zoom (no se ve la hoja entera)?`);
  }

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
// 3. Rectificar perspectiva: warpPerspective desde 4 fiduciales -> canvas ref
// Devuelve cv.Mat 2970x2100. El caller hace .delete().
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
// 4. limpiarGris(warpedMat, [opts]) -> cv.Mat binaria
//    Quita el "8" gris pre-impreso (#c8c8c8 ~= 200 de luminancia) dejando solo
//    el trazo oscuro del tallerista (fibron negro ~= 0-50).
//    Threshold agresivo: pixel < UMBRAL_NEGRO -> negro, else -> blanco.
//    UMBRAL_NEGRO default 80. Si el fibron es muy claro, subir a 100-120.
//    Si el "8" guia se cuela, bajar a 60-70.
//    Devuelve Mat 8UC1 binaria 0/255 (caller .delete()).
// ============================================================================
export function limpiarGris(warpedMat, opts) {
  const UMBRAL_NEGRO = (opts && typeof opts.umbral === "number") ? opts.umbral : 80;
  const gray  = new cv.Mat();
  const clean = new cv.Mat();
  // Soportar entrada RGBA o ya gris
  if (warpedMat.channels() >= 3) {
    cv.cvtColor(warpedMat, gray, cv.COLOR_RGBA2GRAY);
  } else {
    warpedMat.copyTo(gray);
  }
  cv.threshold(gray, clean, UMBRAL_NEGRO, 255, cv.THRESH_BINARY);
  gray.delete();
  return clean;
}

// ============================================================================
// 5. recortarCasilla(mat, centerXY) -> sub-Mat 70x110
//    Mismo que el motor viejo: ROI centrado en la casilla.
//    Caller .delete().
// ============================================================================
export function recortarCasilla(mat, centerXY) {
  const { w: cw, h: ch } = CASILLA_PX;
  const x = Math.max(0, Math.round(centerXY.x - cw / 2));
  const y = Math.max(0, Math.round(centerXY.y - ch / 2));
  const w = Math.min(cw, mat.cols - x);
  const h = Math.min(ch, mat.rows - y);
  const rect = new cv.Rect(x, y, w, h);
  return mat.roi(rect);
}

// ============================================================================
// 6. recortarCasillas(cleanMat, layout) -> Array<CropMeta>
//    Devuelve los 72 crops en orden estable + metadata por cada uno.
//    CropMeta = {
//      idx: 1..72,        // numero global para etiqueta en el tile
//      tipo: "fecha" | "cod_ch" | "ncp" | "cajas",
//      sub_idx: 0..n,     // posicion dentro del grupo (ej. 0..3 fecha, 0..59 cajas)
//      cod: "099" | null, // codigo del articulo si tipo=cajas
//      pos: "C"|"D"|"U",  // centena/decena/unidad si tipo=cajas
//      mat: cv.Mat,       // sub-Mat 70x110 (caller .delete() de cada uno)
//    }
//    Orden: fecha (4) -> cod_ch (4) -> ncp (4) -> cajas (60 ordenadas por cod).
// ============================================================================
export function recortarCasillas(cleanMat, layout) {
  const crops = [];
  let globalIdx = 1;
  const empuja = (tipo, sub_idx, centerXY, extra) => {
    crops.push({
      idx: globalIdx++,
      tipo,
      sub_idx,
      cod: (extra && extra.cod) || null,
      pos: (extra && extra.pos) || null,
      mat: recortarCasilla(cleanMat, centerXY),
    });
  };

  layout.encabezado.fecha.forEach((p, i)  => empuja("fecha",  i, p));
  layout.encabezado.cod_ch.forEach((p, i) => empuja("cod_ch", i, p));
  layout.encabezado.ncp.forEach((p, i)    => empuja("ncp",    i, p));

  // Cajas: 3 casillas por cod, en orden de layout.cods
  const POS = ["C", "D", "U"];
  layout.cods.forEach((cod, ci) => {
    for (let k = 0; k < 3; k++) {
      const centerXY = layout.cajas[ci * 3 + k];
      empuja("cajas", ci * 3 + k, centerXY, { cod, pos: POS[k] });
    }
  });

  return crops;
}

// ============================================================================
// 7. tilearCasillas(crops, [opts]) -> { dataURL, rows, cols, tileW, tileH, labels }
//    Compone una imagen unica con grilla de crops para enviar al modelo.
//    Cada celda: label arriba (texto en negro grueso) + crop debajo (escalado x2).
//    Default 9 filas x 8 columnas = 72. Si crops.length != 72, ajusta.
//    Devuelve dataURL JPEG q=0.95 + meta para que el caller arme el prompt.
// ============================================================================
export function tilearCasillas(crops, opts) {
  const cols = (opts && opts.cols) || 8;
  const rows = Math.ceil(crops.length / cols);
  const escala = (opts && opts.escala) || 2;     // casilla 70x110 -> 140x220
  const labelH  = 50;                              // alto de la etiqueta
  const padX    = 12;
  const padY    = 8;
  const cellW   = CASILLA_PX.w * escala + padX * 2;
  const cellH   = labelH + CASILLA_PX.h * escala + padY * 2;
  const canvasW = cellW * cols;
  const canvasH = cellH * rows;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  ctx.font = "bold 26px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const labels = [];

  // Tmp canvas reutilizable para volcar cada cv.Mat a ImageData
  const tmpCv = document.createElement("canvas");
  tmpCv.width  = CASILLA_PX.w;
  tmpCv.height = CASILLA_PX.h;

  for (let i = 0; i < crops.length; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x0 = c * cellW;
    const y0 = r * cellH;

    const crop = crops[i];
    const labelTexto = formatLabel(crop);
    labels.push({ idx: crop.idx, tipo: crop.tipo, sub_idx: crop.sub_idx, cod: crop.cod, pos: crop.pos, label: labelTexto });

    // Label
    ctx.fillStyle = "#000000";
    ctx.fillText(labelTexto, x0 + padX, y0 + 6);
    // Separador visual fino arriba del crop
    ctx.fillStyle = "#cccccc";
    ctx.fillRect(x0, y0 + cellH - 1, cellW, 1);
    ctx.fillRect(x0 + cellW - 1, y0, 1, cellH);

    // Dibujar el crop binario (cv.Mat -> tmp canvas -> escalado al cellH)
    try {
      // cv.imshow maneja 8UC1 binaria volcandola como gris en RGBA
      cv.imshow(tmpCv, crop.mat);
      ctx.drawImage(
        tmpCv,
        0, 0, tmpCv.width, tmpCv.height,
        x0 + padX, y0 + labelH + padY,
        CASILLA_PX.w * escala, CASILLA_PX.h * escala
      );
    } catch (e) {
      // si algun crop fallo (off-canvas), dejar la celda en blanco con marca
      ctx.fillStyle = "#ffcccc";
      ctx.fillRect(x0 + padX, y0 + labelH + padY, CASILLA_PX.w * escala, CASILLA_PX.h * escala);
    }
  }

  return {
    dataURL: canvas.toDataURL("image/jpeg", 0.95),
    rows, cols,
    cellW, cellH,
    canvasW, canvasH,
    labels,
  };
}

function formatLabel(crop) {
  // Formatos cortos legibles por el modelo:
  //   "1 F1"  (fecha posicion 1)
  //   "5 CH1" (cod CH posicion 1)
  //   "9 NCP1"
  //   "13 099-C" (cajas cod 099 centena)
  const num = String(crop.idx).padStart(2, "0");
  if (crop.tipo === "fecha")  return `${num} F${crop.sub_idx + 1}`;
  if (crop.tipo === "cod_ch") return `${num} CH${crop.sub_idx + 1}`;
  if (crop.tipo === "ncp")    return `${num} NCP${crop.sub_idx + 1}`;
  if (crop.tipo === "cajas")  return `${num} ${crop.cod}-${crop.pos}`;
  return num;
}

// ============================================================================
// 8. enviarAEdgeFn(dataURL_tile, labels_meta, edgeUrl, supabaseKey)
//    POST a la Edge Function (paso:3) con la imagen compuesta y los labels.
//    Devuelve { fecha, cod_ch, ncp, articulos:[{cod, cajas, confianza}], _raw }
//    Confianza por casilla en {"alta","media","baja"}. Frontend pinta segun nivel.
// ============================================================================
export async function enviarAEdgeFn(dataURL_tile, labelsMeta, edgeUrl, supabaseKey, opts) {
  const modelo = (opts && opts.modelo) || "claude";  // default claude (mejor en manuscrito que gpt-4o)
  const res = await fetch(edgeUrl, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + supabaseKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      paso: 3,
      imagen: dataURL_tile,
      mime: "image/jpeg",
      labels: labelsMeta,
      modelo,
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Error Edge Fn paso 3");
  return data;
}

// ============================================================================
// 9. Pipeline completo: imagen -> resultado del modelo
//    leerRemito(imgElement, layout, edgeUrl, supabaseKey, [opts])
//    opts: { umbralLimpieza?: number, debug?: boolean }
//    Devuelve { fecha, cod_ch, ncp, articulos[], _debug? }
//    El caller se encarga de combinarlo con paso:1 (tallerista + cod LK).
// ============================================================================
export async function leerRemito(imgElement, layout, edgeUrl, supabaseKey, opts) {
  if (typeof cv === "undefined" || !cv.Mat) {
    throw new Error("OpenCV.js no cargado. Asegurate de incluirlo en el HTML antes que este script.");
  }
  const debug = !!(opts && opts.debug);

  const src = await cargarImagen(imgElement);
  let warped = null, clean = null;
  const crops = [];
  try {
    const fids = detectarFiduciales(src);
    warped = rectificar(src, fids);
    clean  = limpiarGris(warped, { umbral: (opts && opts.umbralLimpieza) || 80 });

    const cropsArr = recortarCasillas(clean, layout);
    crops.push(...cropsArr);

    const tile = tilearCasillas(cropsArr);
    const resp = await enviarAEdgeFn(tile.dataURL, tile.labels, edgeUrl, supabaseKey, { modelo: opts && opts.modelo });

    return {
      tallerista: layout.tallerista,
      cod_lk: layout.cod_lk,
      fecha: resp.fecha || null,
      cod_ch: resp.cod_ch || null,
      ncp: resp.ncp || null,
      articulos: resp.articulos || [],
      plantilla_version: layout.plantilla_version || "Cervantes-v1.0",
      _debug: debug ? {
        fiduciales: fids,
        canvasRef: { w: CANVAS_REF.width, h: CANVAS_REF.height },
        tileDataURL: tile.dataURL,
        tileMeta: { rows: tile.rows, cols: tile.cols, canvasW: tile.canvasW, canvasH: tile.canvasH },
        respModelo: resp,
      } : undefined,
    };
  } finally {
    src.delete();
    if (warped) warped.delete();
    if (clean)  clean.delete();
    crops.forEach(c => { try { c.mat.delete(); } catch(e){} });
  }
}

// ============================================================================
// Helper de debug: solo rectificar + limpiar, devuelve dataURL para inspeccion
// visual (sirve para tunear el UMBRAL_NEGRO en la pagina de test).
// ============================================================================
export async function debugRectificarYLimpiar(imgElement, opts) {
  if (typeof cv === "undefined" || !cv.Mat) {
    throw new Error("OpenCV.js no cargado.");
  }
  const src = await cargarImagen(imgElement);
  let warped = null, clean = null;
  try {
    const fids = detectarFiduciales(src);
    warped = rectificar(src, fids);
    clean  = limpiarGris(warped, opts || { umbral: 80 });
    const canvasW = document.createElement("canvas");
    const canvasC = document.createElement("canvas");
    cv.imshow(canvasW, warped);
    cv.imshow(canvasC, clean);
    return {
      fiduciales: fids,
      warpedDataURL: canvasW.toDataURL("image/jpeg", 0.9),
      cleanDataURL:  canvasC.toDataURL("image/jpeg", 0.9),
    };
  } finally {
    src.delete();
    if (warped) warped.delete();
    if (clean) clean.delete();
  }
}

// Exponer en window para uso desde HTML que no usa modulos
if (typeof window !== "undefined") {
  window.LectorRectificado = {
    cargarImagen, detectarFiduciales, rectificar, limpiarGris,
    recortarCasilla, recortarCasillas, tilearCasillas,
    enviarAEdgeFn, leerRemito, debugRectificarYLimpiar,
  };
}
