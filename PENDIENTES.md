# Pendientes / Mejoras

> Anotaciones de cosas a implementar/revisar. Última actualización: 2026-08-25.

## Mejora: usuario / PC en tablas de movimientos
Hoy las tablas de movimientos **no guardan qué usuario ni qué computadora** hizo cada
carga — solo `created_at`. Únicas excepciones: `db_n8n_espejo.Legajo` (0 = prueba) y
`Entregas Tallerista Cervantes.Nombre_Tall` (el tallerista, no quién carga).

Tablas afectadas: `Recepcion_Insumos`, `Envios a PS`, `Entregas PS`,
`Envios a Talleristas`, `Entregas Tallerista Cervantes`, `db_n8n_espejo`.

**Propuesta:** agregar columna `usuario` (y opcional `pc`) tomada del login /
sessionStorage al insertar cada movimiento, para poder trazar/filtrar por quién y desde
qué máquina (ej. distinguir cargas de prueba de las reales). Nota: `db_n8n_espejo` usa
soft-delete (`Eliminar='S'`); el resto son DELETE físico — evaluar soft-delete uniforme.

## Falta fin de ruta: enblistado (garage → Oscar/Yabrán)
`Causa-Efecto` termina en el **armado GRJ** (garage). Falta modelar el paso posterior:
el garage entrega el producto **armado suelto (sin cartón)** y luego se manda **junto al
cartón a Oscar (= Yabrán)**, que lo **enblista** → recién ahí es producto terminado → stock.
- **Oscar** ya existe como tallerista (tiene 500, 506, 510, bombillas, mangas, cepillos).
- **Yabrán** no está cargado aparte (es el mismo Oscar).
- No existe proceso "enblistado" en Causa-Efecto ni Partes x PS.
- Afecta a **todos los productos que pasan por garage** (en Verificación/Trazado cortan en el GRJ).
- **Excepciones a confirmar** (no van por Oscar / o van encartonados): 510 y 705(¿706?),
  palos de amasar, despolvillador — falta aclarar cuáles quedan dentro/fuera.

## Control Tall (Martin): duplicado E15 + 11 "sin match"
- **E15 duplicado** (Cuchufli): en `Articulos Virgilio X Tallerista` la misma pieza figura con
  2 descripciones — "Cuchufli Zinc." (art 520, coincide con SP Kg) y "Cuchufli Zincado"
  (arts 530/067/730). Unificar a una sola descripción (el trigger reconstruye Partes x Tallerista).
- **Panel "sin match" (11):** F7, X1, 103, C10, V9, C1, A10, BOM8, BOMB12, CCV2B, GRJ5.
  Las piezas existen en `Partes x Tallerista` por `sector_proce`, pero el panel matchea las
  entregas por `cod_articulos`/descripción → falsos "sin match". Revisar la lógica del panel
  (`renderPanelSinMatch` en `ControlTall.js`) para que matchee también por sector.

## 506 / cajas — estado
- `Uni_x_Articulo_x_Caja` (tabla nueva, LK/CH) cargada del Excel "Art. terminado x caja".
- 506 = **12 u/caja · caja 29** (confirmado). Despiece `GRJ7` corregido a `Uni_x_Caja=12`.
- El `uni_x_caja` se usará en el **encartonado** (cuando se modele), NO en la entrega del
  tallerista (el garage entrega suelto).

## Sacafuente gastronómico / ergonómico — flejes y rutas (2026-09-11)
Estado del corte de la **pza chica sacafuente gastronómico** (Mat 152, "Corte Pza Chica Sacaf Gast"):
- **Fleje 6** (`Mgo Plano Marip / Perfora 3 en 1`, 18,5 x 1,9, FB3, Basconia) = fleje **actual/definitivo**.
- **Fleje 69** (`Sacapizzero Pza Chica`, 18.5 x 2.5, FD2, Hermac) = fleje **anterior**. Se encontraron
  **252 kg** en stock y se produce con él **momentáneamente** hasta consumirlos.
- `Causa-Efecto` quedó con **las dos** filas apuntando a `Mat 152`: `Fleje 6 → Mat 152` (era `Fleje 17`,
  corregida) y `Fleje 69 → Mat 152` (nueva). Sigue vigente `Fleje 69 → Z6` (Mat 364, pizzero).
- **Al agotarse los 252 kg de Fleje 69: borrar la fila `Fleje 69 → Mat 152`** (dejar solo Fleje 6).
- Opcional: la `Descripción` del Fleje 6 en `Flejes` no menciona "Pza Chica Sacaf Gast" — evaluar
  agregarlo (no se tocó).

**Pendiente: ruta del Fleje 17 (sacafuente ERGONÓMICO).**
`Fleje 17` (`Pieza Chica Sacaf`, 95 x 1,4, FF4, Basconia) es del **ergonómico**, no del gastronómico.
Hoy quedó **sin ruta** en `Causa-Efecto`. No existe ninguna matriz de sacafuente ergonómico
(las matrices 239/378/380 "ergonómico" son de **pelador**). Falta que el usuario indique el
**N° de matriz de corte** y la cadena de sectores para dar de alta la ruta.
