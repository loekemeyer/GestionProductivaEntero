# Problemas de códigos — Pedernera vs nueva codificación ISIS

Fecha: 2026-07-15

## Contexto

Cruce de `Partes x PS` (filas de Pedernera) contra los 3 Excel de nueva codificación:

- `codigos nuevos LK procesos 29-6-26.xlsx` — 512 mapeos
- `codigos nuevos LK Insumos 29-6-26.xlsx` — 205 mapeos
- `codigos nuevos LK materia prima 29-6-26.xlsx` — 298 mapeos

Ruta: `Z:\AA IT\AA Tablas Supabase\Tablas Supabase Gestion Productiva Vieja\Nueva Codificacion\`

Formato: código interno de 7 dígitos → código nuevo de 4 dígitos. Último dígito = familia
(6 = procesos, 7 = insumos, 5 = materia prima). Pedernera cae todo en **procesos**.

El cruce es match exacto de `Código Interno` (Excel) contra `Cod_Prov_Externo` (`Partes x PS`).

**34 de 39 filas mapean sin problema.** Las 5 restantes + 2 códigos compartidos, abajo.

Nota: ISIS trunca las descripciones a 30 caracteres (103 de 512 miden exactamente 30).
Las diferencias de nombre entre GP e ISIS ya fueron revisadas y son la misma pieza
(ej. `5095600` "Mgo Pelador LK" = "Manguito Pelapapas", `5135600` "Vastagos Cortos" =
"Vastago de Espatula").

## Problemas

| Código viejo | Pieza en GP | Código nuevo | Problema |
|---|---|---|---|
| 5160600 | Pza Grande Sacaf Art CH Crom. | `1616` ⚠ | **Colisión.** La lista nueva dice que `1616` es "Bombillas Niqueladas", no la Pza Grande Sacaf CH. El código viejo salió de `Listado Codigos.xlsx` el 2026-06-17, que decía Pza Grande Sacaf CH. Los dos Excel son de ISIS y se contradicen. |
| 5204600 | Mgo Pelador CH | — | **No existe** en los 1015 mapeos. |
| 5206600 | Mgo Plano 701 Crom. | — | **No existe** en los 1015 mapeos. |
| (sin código) | Plancha de Niquel | — | Sin `Cod_Prov_Externo` desde el 2026-06-17 y tampoco figura en la lista nueva. Nunca tuvo código. |
| (sin código) | Destapador Pie Cromado | — | Ídem: sin código viejo ni nuevo. |
| 5118600 | 3 En 1 LK / 3 En 1 Ch | `1186` | **Compartido.** Dos filas, un código. Ambas → `1186` "3 en 1 C/ Y S/MARCA". Decidido el 2026-06-17; la lista nueva lo mantiene. |
| 5124600 | Rompenuez Cerrado LK / Rompenuez Abierto LK | `1246` | **Compartido.** Dos filas, un código. Ambas → `1246` "Rompenueces". Ídem. |

## Causa raíz de los 3 primeros

Son el mismo caso: el gemelo CH (o serie 701) de un par LK/CH no aparece en la lista nueva.

| Pieza | GP línea LK | GP línea CH | Lista nueva |
|---|---|---|---|
| Mgo Pelador | 5095600 (M6→M5) | 5204600 (M8→M7) | solo 5095600 "Manguito Pelapapas" |
| Mgo Plano | 5091600 · 502 (IF6→B9) | 5206600 · 701 (IF11→A7) | solo 5091600 "…502 Cr" |
| Pza Gde Sacaf | 5115600 (Z2B→Z2A) | 5160600 (Z3B→Z3A) | solo 5115600 "Sacafuentes - Pieza Grande" |

Evidencia extra sobre `5160600`: en la lista nueva sus vecinos son bombillas
(`5050600` "Bombilla Autolimpiante Inox.", `5161600` "Resorte Bombilla Niquelado"),
o sea que el código es coherente con su propia familia — no parece error de tipeo.
Los sacafuentes viven en `5115600` / `5116600`, y hay una sola pieza grande cromada.

## Pregunta para ISIS

¿Los pares LK/CH ahora comparten un código único, o cada CH tiene código propio?

Los problemas 6 y 7 muestran que ISIS **ya colapsa pares en un código único**
(3 En 1 → `1186`, Rompenuez → `1246`). Si ese criterio aplica a los otros 3, se resuelven
solos: cada CH toma el código de su gemelo LK. Si no, faltan 3 códigos en la lista.

## Estado

- Los 34 mapeos confirmados van a una columna nueva `Cod_ISIS` en `Partes x PS` (decidido).
  El botón de Entrega Pedernera mostrará solo el código nuevo.
- Nada cargado todavía: pendiente la respuesta de ISIS.
- `Listado Codigos.xlsx` no está en `Z:\AA IT` (buscado, sin match). La comparación del
  `5160600` sale del historial de `LOCKS.txt` (2026-06-17) + los valores actuales en la DB.
