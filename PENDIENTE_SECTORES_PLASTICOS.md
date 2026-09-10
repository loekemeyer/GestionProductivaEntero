# Pendiente: renumeracion de sectores en `Partes_Plasticas`

Fecha de deteccion: 2026-09-04
Fuente: `Conteo_y_Pedido_Sector_Plastico_VACIO.xls` (hojas `Pedido VACIO`,
`Conteo Cervantes VACIO`, `Conteo Virgilio VACIO`).

## Que pasa

Cuatro fuentes coinciden entre si sobre la numeracion de sectores plasticos:

- Hoja `Pedido VACIO` (filas 1-105)
- Hoja `Conteo Cervantes VACIO`
- Hoja `Conteo Virgilio VACIO`
- Tabla `SectorPlasticos` (tabla madre)

**`Partes_Plasticas` es la unica que discrepa.** Confirmado por el usuario el
2026-09-04: la numeracion del Conteo es la correcta.

## Colisiones detectadas

### 1. Familia PV (permutacion completa)

| Sector | Correcto (Conteo/Pedido/SectorPlasticos) | `Partes_Plasticas` dice |
|---|---|---|
| PV1  | Pisa Papa Nylon         | Cuchara Fideos 1 Pz Ny |
| PV2  | Cucharon 1 Pz Ny        | — (lo tiene en PV6)    |
| PV3  | Espatula Lisa 1 Pz      | — (lo tiene en PV9)    |
| PV5  | Cuchara Fideos 1 Pz Ny  | Pisa papa Nylon        |
| PV6  | Cuchara Calada 1 Pz Ny  | Cucharon 1 Pz Ny       |
| PV7  | Espatula Cal. 1 Pz Ny   | Picos Reposteros       |
| PV8  | Corta Torta             | Espatula Cal. 1 Pz Ny  |
| PV14 | Picos Reposteros        | — (lo tiene en PV7)    |
| PV17 | Pela Naranjas           | — (lo tiene en PV12)   |

Remapeo necesario en `Partes_Plasticas` (por id):

    id 99  PV1  -> PV5     (Cuchara Fideos)
    id 21  PV5  -> PV1     (Pisa papa Nylon)
    id 97  PV6  -> PV2     (Cucharon)
    id 95  PV7  -> PV14    (Picos Reposteros)
    id 101 PV8  -> PV7     (Espatula Cal.)
    id 98  PV9  -> PV3     (Espatula Lisa)
    id 23  PV10 -> PV8     (Corta Torta)
    id 100 PV11 -> PV6     (Cuchara Calada)
    id 96  PV12 -> PV17    (Pela Naranjas)

Es una permutacion limpia (no genera duplicados), pero hay que aplicarla en una
sola transaccion o via sectores temporales para no violar unicidad a mitad de camino.

### 2. PC1/PC2 invertidos

| Sector | Correcto | `Partes_Plasticas` dice |
|---|---|---|
| PC1A | Mgo Pelapapa 505 **Calado**   | Mgo Pelapapa 505 s/Calar |
| PC2A | Mgo Pelapapa 505 **s/calar**  | Mgo Pelapapa 505 Calado  |
| PC1B | Mgo Pelapapa 123 **Calado**   | Mgo Pelapapa 123 s/Calar |
| PC2B | Mgo Pelapapa 123 **s/calar**  | Mgo Pelapapa 123 Calado  |

(ids 102/103/44/46). El proveedor ya quedo bien en los 4 — es Rafael Pettofrezza
en ambos casos — asi que esto NO afecta a Recepcion, solo a la trazabilidad.

### 3. PB8 / PB8A (corregido en los codigos, falta el sector)

El Pedido fila 35 dice `PB8 = "Mango Sacacorcho Plast (581)"` (LK 3826 / CH 1186), y
el Conteo fila 29 llama `PB8` a "Mgo Sacac Plast" — o sea el MANGO. En
`Partes_Plasticas` ese articulo vive en `PB8A`, y `PB8` lo ocupa "Cpo Sacacorcho
Plast" (el CUERPO), que no figura en la hoja Pedido.

Los codigos ya se corrigieron el 2026-09-04: `PB8A` quedo con 3826/1186 y `PB8` con
ambos en NULL. Falta decidir el sector: al renumerar, `PB8A` deberia pasar a `PB8`, y
hay que ver que se hace con "Cpo Sacacorcho Plast" (aparece como "Cuerpo Sacacorcho
Plastico 523" en la hoja `Stock CD` f173/f174, asi que es una pieza real).

### 4. PEP5 ocupado

- Correcto: `PEP5` = "Mang. Mad. Cuchi Untar" (proveedor Pintos).
- `Partes_Plasticas`: `PEP5` = "Mango Pelador LK 586 C/S" (id 118), y mete
  "Mang. Mad. Cuchi Untar" en `PLL5` (id 122), sector que no existe en ninguna
  otra fuente.

Decision tomada: se asigno Pintos a `PLL5` (donde vive hoy el articulo real) y
`PEP5` quedo en Pat Bet Plast. Al renumerar hay que fusionar PLL5 -> PEP5 y
decidir que pasa con "Mango Pelador LK 586 C/S".

## Asignaciones de codigo hechas por criterio, no por texto literal

De las 64 filas con codigo cargado desde el Excel, 44 matchearon por descripcion
exacta y 20 por equivalencia de redaccion. De esas 20, 14 tienen el mismo sector en
la BD y en el Excel (solo cambia como esta escrito: "Mangos Lk" vs "Mangos f 10 lk",
"Corta Queso" vs "Cilindro Corta Queso", etc.) y son de bajo riesgo.

Las otras 6 asignan un mismo articulo del Excel a mas de una fila de la BD, o cruzan
de sector. Una ya se corrigio (PB8). Quedan por revisar:

| Filas BD | Reciben el codigo de | Codigo | Duda |
|---|---|---|---|
| `PC15A` + `PC15B` | Excel `PC15` | 3346 / 1126 | el Excel tiene una sola fila con LK **y** CH; quizas PC15A deberia llevar solo el LK y PC15B solo el CH |
| `PEP4` + `PEP4A` + `PEP4B` | Excel `PEP4A` | 1876 / 0526 | PEP4A y PEP4B si estan en el Excel (ambas con 1876/0526). `PEP4` "Afila Caladas" a secas NO esta |
| `PEP2` + `PEP3` | Excel `PEP2` | 1846 | `PEP3` "c/Serig" no esta en el Excel |
| `PLL5` | Excel `PEP5` | 1766 / 0586 | ver punto 4 (PEP5 ocupado) |

Ademas `CP15` ("Cpo Doble Aleta Plast") duplica a `PC15A` con el mismo codigo.

## Sectores del Conteo que NO existen en `Partes_Plasticas`

    PC15    Cuerpo Doble Aleta Plast    (existe como CP15 / PC15A / PC15B)
    PEST2   Insertos Pisa Papas
    PGRJ12  Ñoquera                     (existe como GRJ12, sin prefijo P)
    PGRJ12B Ñoquera Redonda             (existe como GRJ12B, sin prefijo P)
    PC3     Mangos Corta Queso

RESUELTO 2026-09-04: `PIEA` y `PIEB` (Ing. Barbetta Alberto) se dieron de alta en
`Partes_Plasticas` (ids 125 y 126) tomando descripcion y Uni_x_Bolsa de
`SectorPlasticos` y Pedido_Min de la hoja `Pedido VACIO`. `Cod_ISIS` quedo en
`1100` (PIEA) y `6100` (PIEB), que es el `codigo_interno` de `Codigos_ISIS_Map`
para LK 0017 y LK 2017 — la misma convencion que el resto de la tabla.
`Cons_Mensual` quedo en 0 — el Excel dice 0,3 pero la columna es integer.
Con eso el proveedor entro a la botonera de Recepcion.

Ojo: la fila LK `2017` del map tiene descripcion "Rueda Recta 945*48*70", que son
las medidas de PIEA, no de PIEB. Se asigno igual a PIEB porque el Excel es
explicito (PIEB = LK 2017 / CH 0627) y la fila CH `0627` del map dice
"Rueda Recta 710*48*50.8", que coincide con PIEB. La descripcion del map LK esta
desactualizada; no se toco.

## Por que no se hizo ahora

`Partes_Plasticas` la leen ademas de Recepcion:

- `StockFlejes/plasticos.js` (Stock Plasticos)
- `Prov Serv/Control/ControlPS.js`
- `Despiece/Despiece.js`
- `Facturas/EntregaProveedoresCervantes.html`

Renumerar mueve stock de articulo en los cuatro a la vez. Se hace como pedido
aparte, con backup y revision modulo por modulo.

## Backup disponible

Tabla `Partes_Plasticas_bkp_proveedor_20260904` (75 filas: id, Sector,
Descripcion, Proveedor previos al cambio de proveedores del 2026-09-04).

## Nota: direccion del match contra `Codigos_ISIS_Map`

Detectado 2026-09-04 al importar OCs en PDF. Las tablas de rubro no guardan todas
el mismo lado del map:

| Tabla | Columna | Formato | Lado del map |
|---|---|---|---|
| `Flejes` | `Cod_ISIS` | 4 digitos | `nuevo_codigo` |
| `Partes_Plasticas` | `Cod_ISIS` | 7 digitos | `codigo_interno` |
| `Cajas` | `Cod_ISIS_LK` | 7 digitos | `codigo_interno` |

`enriquecerLineasOC` en `StockFlejes/recepcion.html` traducia el codigo del PDF a
`nuevo_codigo` y buscaba SOLO por ese valor, asi que en Plasticos y Cajas no
matcheaba nunca. Ahora prueba ambos lados (nuevo primero, para no alterar Flejes).
RESUELTO 2026-09-04 para Plasticos: `Partes_Plasticas.Cod_ISIS` se renombro a
`Cod_ISIS_LK` y se agrego `Cod_ISIS_CH`, siguiendo el modelo de `Cajas`. Se
cargaron 64 filas desde la hoja `Pedido VACIO` usando el **Nuevo Codigo** (4
digitos), que es el que maneja la planilla del operario. Backup de los valores
previos en `Partes_Plasticas_bkp_codisis_20260904`.

Estado: 57 filas con `Cod_ISIS_LK`, 35 con `Cod_ISIS_CH`, 12 sin ninguno de los
dos (no figuran en el Excel: KP1, PA4, PA5, PB4, PB5, PB8A, PB8B, PB9, PC5, PEP5,
PEP6, PIP4) y 1 (`PB3`) que conserva el codigo interno viejo de 7 digitos porque
tampoco esta en el Excel. `buscarIsis` tolera los dos formatos.

Los codigos ISIS NO son unicos: el mismo codigo cubre varios sectores (0626 en
PA10/PA13/PA15/PA18, 1876 en PEP4/PEP4A/PEP4B, 3346 en CP15/PC15A/PC15B, etc.).
No poner una constraint UNIQUE sobre esas columnas.

Queda pendiente decidir si se unifica el formato entre las demas tablas: `Flejes`
guarda el Nuevo Codigo (4 digitos) y `Cajas` el codigo interno (7 digitos).
