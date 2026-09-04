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

### 3. PEP5 ocupado

- Correcto: `PEP5` = "Mang. Mad. Cuchi Untar" (proveedor Pintos).
- `Partes_Plasticas`: `PEP5` = "Mango Pelador LK 586 C/S" (id 118), y mete
  "Mang. Mad. Cuchi Untar" en `PLL5` (id 122), sector que no existe en ninguna
  otra fuente.

Decision tomada: se asigno Pintos a `PLL5` (donde vive hoy el articulo real) y
`PEP5` quedo en Pat Bet Plast. Al renumerar hay que fusionar PLL5 -> PEP5 y
decidir que pasa con "Mango Pelador LK 586 C/S".

## Sectores del Conteo que NO existen en `Partes_Plasticas`

    PC15    Cuerpo Doble Aleta Plast    (existe como CP15 / PC15A / PC15B)
    PEST2   Insertos Pisa Papas
    PGRJ12  Ñoquera                     (existe como GRJ12, sin prefijo P)
    PGRJ12B Ñoquera Redonda             (existe como GRJ12B, sin prefijo P)
    PC3     Mangos Corta Queso

RESUELTO 2026-09-04: `PIEA` y `PIEB` (Ing. Barbetta Alberto) se dieron de alta en
`Partes_Plasticas` (ids 125 y 126) tomando descripcion y Uni_x_Bolsa de
`SectorPlasticos` y Pedido_Min de la hoja `Pedido VACIO`. `Cod_ISIS` quedo NULL:
los codigos del Excel (LK 0017 / 2017, CH 0617 / 0627) no tienen entrada en
`Codigos_ISIS_Map`, y desde el cambio de clave a Sector ya no hace falta.
`Cons_Mensual` quedo en 0 — el Excel dice 0,3 pero la columna es integer.
Con eso el proveedor entro a la botonera de Recepcion.

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
