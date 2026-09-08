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
