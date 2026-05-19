# Renombres de Sectores (mapeo Excel viejo → BD actual)

Cuando recibo listas de stock con codigos de sector que no coinciden con la BD,
consultar este archivo antes de preguntar. Cada entrada confirmada por el usuario.

## Sector Procesado

| Codigo viejo (Excel) | Sector BD actual | Descripcion | Cods asociados |
|---|---|---|---|
| E11 | D1 | Espiral 520 Chino | 067, 104, 520, 521, 530, 531, 581, 730, 731, 735 |
| E12 (Vast corta Pizza Gastro) | E9 | Vast corta Pizza Gast | 564, 863 |
| E12 (Vastago C/ Ravioles) | E9 | (misma parte que arriba) | suma a E9 |
| Z3B | Z3A | Pza Gde Sacaf. Articu. CH | 708 |
| E3 (Arandela Grande Afila) | F7 | Arandela Gde Afila Zinc. | F7, Toch |

## Partes Plasticas (codigos cambiaron — guiarse por descripcion)

| Codigo viejo (Excel) | Sector BD actual | Descripcion BD | Cods asociados |
|---|---|---|---|
| A2 | PA2 | Plaquita 3 - 1 Blan. | 043 |
| A1 | PA1 | Plaquita 3 en 1 LK | 511 |
| EP8 | PEP8 | Mgo Corta Pizza | 863 |
| A19 | PA19 | Mangos Chef | 856, 857, 859, 862 |
| A17 | PA17 | Mango LK Cuch y P Torta | 311, 312 |
| C10 (plastico) | PC10 | Mango LK Espatula | 116, 559, 562 |
| C7 | PC7 | Inserto Neg. Canelones | 859, 862 |
| B7 (plastico) | PB7 | Inser. Neg. Batidor | 856, 857 |
| EP2/3 | PEP4 | Afila Caladas | 504 |
| A13 | PA13 | Capuchon Batidor LK | 311, 312 |
| A18 | PA18 | Capuchon Espatula LK | 116, 559, 562 |

## Reglas

- Codigos C10 y B7 existen en dos contextos: Sector Procesado (C10=Uña Zincada, B7=Cpo Sacacorcho CH Serig) y Plasticos (PC10/PB7). En listas Excel hay que distinguir por descripcion.
- Stock cargado en cod mas bajo del sector (resto en 0). kg = uni × kgxuni de Despiece.
- Antes de cargar stock_inicial, verificar tabla `Partes x Tallerista` para confirmar sector y cods. Si no existe match, omitir.

## Pendientes

- **PB6 (Inser. Neg. Espat) en Martin** — usuario dice que Martin debe recibir PB6 porque va en "los disco corta pizza y eso" (cods 116/559/562/564 LK + 859/862/863 CH). Estado actual BD: Despiece x Articulo solo tiene PB6 vinculado a 615/630-636 (Batidor/Cucharon/Espumadera/Tenedor/Cuchara/Cuchara Calada/Espatula calada CH — entregados por Carlos). Acción pendiente (mañana sigue): agregar rows en Despiece x Articulo (COD 116/559/562/564/859/862/863, Sector Proce=PB6, Descripcion="Inser. Neg. Espat", KGxUni=0.005) — los cods ya están en Articulos VxT de Martin, así que el trigger sync_partes_from_articulo va a generar las filas Partes x Tallerista automáticamente. Antes de aplicar: confirmar con usuario qué cods exactamente llevan PB6 (todos los corta pizza/raviol o solo algunos).

## Historial de carga

- 2026-04-28: Martin stock_inicial cargado desde Excel (47 sectores). Origen del mapeo plasticos.
