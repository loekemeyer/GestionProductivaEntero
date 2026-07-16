// ============================================================================
// CONFIG MOTOR 7-SEGMENTOS — Cervantes-v1.0
// Derivado del template remito_v1.html (A4 landscape, fiduciales 8x8mm)
// ============================================================================

export const PLANTILLA_VERSION = "Cervantes-v1.0";

// Canvas de referencia tras warpPerspective (A4 landscape a 10 px/mm)
export const CANVAS_REF = {
  width:  2970,    // 297mm * 10
  height: 2100,    // 210mm * 10
  pxPerMm: 10,
};

// Marcas fiduciales (cuadrados negros 8x8mm). Coords del CENTRO en canvas ref.
// CSS: .fiducial { width:8mm; height:8mm; top:8mm; left/right/bottom:8mm }
//      => centro a 8+4 = 12mm del borde
export const FIDUCIALES = {
  tl: { x: 120,  y: 120  },
  tr: { x: 2850, y: 120  },
  bl: { x: 120,  y: 1980 },
  br: { x: 2850, y: 1980 },
  sizeMm: 8,
  // Tolerancia de busqueda en pixeles (radio alrededor de la posicion ideal)
  toleranciaPx: 200,
};

// Dimension de cada casilla (cuadradito de 7 segmentos)
export const CASILLA_MM = { w: 7, h: 11 };
export const CASILLA_PX = { w: 70, h: 110 };  // a 10 px/mm

// Posiciones relativas (0..1) de los 7 segmentos dentro de una casilla.
// Numeracion estandar 7-seg: a=top, b=top-right, c=bot-right, d=bottom,
//                            e=bot-left, f=top-left, g=middle.
// Extraido del SVG viewBox 70x110 del template.
export const SEGMENTOS_RELATIVOS = {
  a: { x0: 15/70, y0: 10/110, x1: 55/70, y1: 16/110 },
  b: { x0: 56/70, y0: 17/110, x1: 62/70, y1: 52/110 },
  c: { x0: 56/70, y0: 58/110, x1: 62/70, y1: 93/110 },
  d: { x0: 15/70, y0: 94/110, x1: 55/70, y1: 100/110 },
  e: { x0:  8/70, y0: 58/110, x1: 14/70, y1: 93/110 },
  f: { x0:  8/70, y0: 17/110, x1: 14/70, y1: 52/110 },
  g: { x0: 15/70, y0: 52/110, x1: 55/70, y1: 58/110 },
};

// Mapeo digito -> patron de 7 bits (a,b,c,d,e,f,g)
export const DIGITOS_A_PATRON = {
  0: [1,1,1,1,1,1,0],
  1: [0,1,1,0,0,0,0],
  2: [1,1,0,1,1,0,1],
  3: [1,1,1,1,0,0,1],
  4: [0,1,1,0,0,1,1],
  5: [1,0,1,1,0,1,1],
  6: [1,0,1,1,1,1,1],
  7: [1,1,1,0,0,0,0],
  8: [1,1,1,1,1,1,1],
  9: [1,1,1,1,0,1,1],
};

// Umbrales (Anexo B del prompt)
//   UMBRAL_SEGMENTO: ratio de pixeles oscuros dentro de la zona del segmento (0..1)
//   UMBRAL_TINTA:    oscuridad absoluta promedio del trazo (0..1, 1=negro puro)
//   UMBRAL_CONFIANZA: minimo para estado "leida"; debajo de eso -> "revisar"
// Un segmento se considera "encendido" SOLO si pasa AMBOS umbrales.
// Esto distingue fibron negro (cumple ambos) del "8" gris preimpreso (no cumple tinta).
export const UMBRAL_SEGMENTO  = 0.35;
export const UMBRAL_TINTA     = 0.50;
export const UMBRAL_CONFIANZA = 0.70;

// Color del "8" preimpreso (gris #c8c8c8 = ~0.78 oscuridad => por debajo del UMBRAL_TINTA)
export const PREIMPRESO_GRIS = 0xc8;

// ============================================================================
// LAYOUT ESPECIFICO POR TALLERISTA
// Se mide UNA VEZ con ocr-segmentos/medir-template.html cargando el HTML
// del template correspondiente, y se pega aca el output.
//
// Por ahora solo Lucho. Otros talleristas se agregan a medida.
// ============================================================================

// LUCHO: 20 codes en grid 4 columnas x 5 filas
// Orden visual = orden de lectura izq->der, arriba->abajo dentro de cada columna
export const LAYOUT_LUCHO = {
  tallerista: "LUCHO",
  cod_lk: "3806",

  // Codes pre-impresos en orden visual (col-major: bloque1 entero, luego bloque2, etc.)
  // Tomado del sheet "Lucho" del Excel Remito Talleristas.xlsx
  cods: [
    "099", "505", "513", "518", "542",   // bloque 1 (col izq)
    "543", "546E", "546", "574", "569",  // bloque 2
    "586", "587", "587T", "720", "722",  // bloque 3
    "809", "186", "123", "119", "574",   // bloque 4 (col der)  ← 574 typo
  ],

  // Posiciones de casillas en mm en canvas de referencia (2970x2100).
  // Centro de la casilla. Se completan via medir-template.html.
  // Formato: { x, y } centro de la casilla.
  encabezado: {
    // 4 casillas DD/MM (separador "/" entre 2da y 3ra)
    fecha: [
      { x: 1603, y: 277 },
      { x: 1682, y: 277 },
      { x: 1796, y: 277 },
      { x: 1876, y: 277 },
    ],
    // 4 casillas Cod CH (segunda fila del encabezado)
    cod_ch: [
      { x: 390, y: 431 },
      { x: 470, y: 431 },
      { x: 550, y: 431 },
      { x: 630, y: 431 },
    ],
    // 4 casillas N° Carga Portal
    ncp: [
      { x: 2426, y: 277 },
      { x: 2506, y: 277 },
      { x: 2586, y: 277 },
      { x: 2666, y: 277 },
    ],
  },
  // 60 cajas = 20 cods x 3 digitos (centenas, decenas, unidades)
  // Orden col-major: cods[0..4] col1, cods[5..9] col2, cods[10..14] col3, cods[15..19] col4
  // Cada cod ocupa cajas[i*3 .. i*3+2]
  cajas: [
    // cods[0] "099"
    { x: 546, y: 679 }, { x: 624, y: 679 }, { x: 702, y: 679 },
    // cods[1] "505"
    { x: 546, y: 819 }, { x: 624, y: 819 }, { x: 702, y: 819 },
    // cods[2] "513"
    { x: 546, y: 959 }, { x: 624, y: 959 }, { x: 702, y: 959 },
    // cods[3] "518"
    { x: 546, y: 1099 }, { x: 624, y: 1099 }, { x: 702, y: 1099 },
    // cods[4] "542"
    { x: 546, y: 1240 }, { x: 624, y: 1240 }, { x: 702, y: 1240 },
    // cods[5] "543"
    { x: 1193, y: 679 }, { x: 1271, y: 679 }, { x: 1349, y: 679 },
    // cods[6] "546E"
    { x: 1193, y: 819 }, { x: 1271, y: 819 }, { x: 1349, y: 819 },
    // cods[7] "546"
    { x: 1193, y: 959 }, { x: 1271, y: 959 }, { x: 1349, y: 959 },
    // cods[8] "574"
    { x: 1193, y: 1099 }, { x: 1271, y: 1099 }, { x: 1349, y: 1099 },
    // cods[9] "569"
    { x: 1193, y: 1240 }, { x: 1271, y: 1240 }, { x: 1349, y: 1240 },
    // cods[10] "586"
    { x: 1841, y: 679 }, { x: 1919, y: 679 }, { x: 1997, y: 679 },
    // cods[11] "587"
    { x: 1841, y: 819 }, { x: 1919, y: 819 }, { x: 1997, y: 819 },
    // cods[12] "587T"
    { x: 1841, y: 959 }, { x: 1919, y: 959 }, { x: 1997, y: 959 },
    // cods[13] "720"
    { x: 1841, y: 1099 }, { x: 1919, y: 1099 }, { x: 1997, y: 1099 },
    // cods[14] "722"
    { x: 1841, y: 1240 }, { x: 1919, y: 1240 }, { x: 1997, y: 1240 },
    // cods[15] "809"
    { x: 2488, y: 679 }, { x: 2566, y: 679 }, { x: 2644, y: 679 },
    // cods[16] "186"
    { x: 2488, y: 819 }, { x: 2566, y: 819 }, { x: 2644, y: 819 },
    // cods[17] "123"
    { x: 2488, y: 959 }, { x: 2566, y: 959 }, { x: 2644, y: 959 },
    // cods[18] "119"
    { x: 2488, y: 1099 }, { x: 2566, y: 1099 }, { x: 2644, y: 1099 },
    // cods[19] "574"
    { x: 2488, y: 1240 }, { x: 2566, y: 1240 }, { x: 2644, y: 1240 },
  ],
};
