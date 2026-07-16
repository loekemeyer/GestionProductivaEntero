# Auditoría de Rutas e Integridad — 2026-04-18

Reporte automático generado durante la sesión nocturna.
**No se modificó nada** — solo reporta inconsistencias para que las revises.

---

## 1) Sectores SP sin peso (`SP Kg.Kg X Uni` NULL o 0)

| Sp | Parte | Acción sugerida |
|---|---|---|
| ~~D15~~ | ~~Pinza Chica Cromada~~ | ~~cargar peso~~ → **ELIMINADA 2026-04-18** (huérfana, sin uso) |
| ~~G11~~ | ~~Mango plano sin marca para doblar~~ | ~~cargar peso~~ → **ELIMINADA 2026-04-18** (mal clasificada en SP, va en SC — ya existe en SC Kg con peso 0.03903) |
| ~~G13~~ | ~~Mango plano sin marca doblado~~ | ~~cargar peso~~ → **ELIMINADA 2026-04-18** (mal clasificada en SP, va en SC — ya existe en SC Kg con peso 0.039633) |
| GRJ13 | Bowls 330ml | cargar peso |
| **GRJ16** | **Batidor Mini 580** | **recién creado por mí, falta peso + componentes (ver punto 7)** |

## 2) Sectores SC sin peso (`SC Kg.Kg X Uni` NULL o vacío)

| SC | Descripción | Acción sugerida |
|---|---|---|
| ~~KF3~~ | ~~Cpo Sacacorcho Zincado p/pintar~~ | ~~cargar peso~~ → **CARGADO 2026-04-18** (0.03075, igual que KF2) |
| Toch | Tochos p/Ajustar | cargar peso o eliminar si no se usa |

## 3) `Partes x PS` con código SC inválido (no existe en SC Kg / Plásticos / Remaches / Carton)

| id | SC | PS | Proceso | Parte | Nota |
|---|---|---|---|---|---|
| ~~211~~ | ~~A2E~~ | ~~AJ Adhesivos~~ | ~~Adhesivado~~ | ~~Pliego Abr. Uña Crom 510~~ | ~~crear A2E en SC Kg o cambiar SC~~ → **RESUELTO 2026-04-19**: SC cambiado a V2B (Pliego Sin Adhes 510 en Sector Carton), SP a CAPL2G (Pliego Adhes 510). Idem ids 209 (V3A→V2A) y 210 (V2C→A2A). |
| 293 | C2 | Ximpa | Serigrafiado | Abrelata Pie Uña | **OK 2026-04-19**: C2 en SP Kg (Abrelata Pie Uña Pint., 0.0294) es correcto. Patrón válido: un SP es input de otro proceso. No requiere acción. |
| 354 | ST | Guazzaroni | Pulido | Resorte U | ST genérico (Sector Tránsito), aceptable pero confuso |
| 242 | ST | Guazzaroni | Niquelado | Buje Abrelata Manija | idem ST |
| 203 | ST | Gaston Almafuerte | Pavonado | Cuchilla Pelapapa | idem |
| 355 | ST | New Metal | Templado | Cuchilla Pelapapa | idem |
| 257 | ST | Guazzaroni | Zincado | Uña | idem |
| 260 | ST | Guazzaroni | Zincado | Arandela Grd Afila | idem |
| 254 | ST | Guazzaroni | Pulido | Cuchilla Abrelata | idem |
| 185 | ST | Pedernera | Cromado | Engranaje Gde Crom. | idem |
| 186 | ST | Pedernera | Cromado | Engranaje Chico Crom | idem |
| 238 | ST | Guazzaroni | Niquelado | Resorte 520 Nuevo | idem |
| 202 | ST | Chormium | Pavonado | Cuchilla Pelapapa | idem |
| 166 | ST | Pedernera | Cromado | Resorte U Crom | idem |
| 344 | V14 | Guazzaroni | Niquelado | Rem Pinza Chica | V14 está en SP Kg pero no en Remaches SC — revisar |

> **ST como SC**: esperable porque ST es Sector Tránsito (lo que devuelve un PS sin SP definitivo). No es un bug, pero el sistema lo considera "no encontrado" para pesos. El JS de Verificación ya lo trata especial mostrando descripción del paso anterior.

## 4) `Partes x Tallerista` con sector_proce inválido

| Tallerista | Sector | Descripción |
|---|---|---|
| ~~Poly~~ | ~~FB3B~~ | ~~Alambre Filtro Café Gast~~ → **RESUELTO 2026-04-18**: INSERT Fleje 90B en tabla Flejes (mismo alambre que 90 pero corte 14cm, peso 0.01162 kg/uni). |
| ~~Poly~~ | ~~FC3~~ | ~~Alambre Filtro Café~~ → **RESUELTO 2026-04-18**: Flejes N°90 re-clasificado de C3 (que colisionaba con "3 En 1 S/M Crom.") a FC3. Causa-Efecto Charcas tambien actualizado. Despiece 031/836 ya usaban FC3, ahora todo consistente. |

## 5) `Causa-Efecto` con valores no estándar

Algunos códigos en `Descuenta` o `Aumenta` no son sectores ni Flejes ni "Mat N":

- ~~**`Fabr (Interno)`**: variante con paréntesis. El sistema reconoce `Fabr` (sin paréntesis). Normalizar para que la UI lo trate igual.~~ → **NORMALIZADO 2026-04-19** (1 fila).
- ~~**`IF2T`, `LF13T`, `Z12`**~~: **RESUELTOS 2026-04-19**. IF2T/LF13T eliminados con matriz 25. Z12 eliminado (fila en Causa-Efecto borrada) — matriz 112 "Cortar Ganchito Red/Cuadr" queda sin ruta hasta que alguien de planta defina fleje y sector correcto.
- ~~**`Matriz 114`, `Matriz 152`, `Matriz 153`, etc.**: usadas como Aumenta o Descuenta (en lugar del formato `Mat N` con espacio).~~ → **NORMALIZADO 2026-04-19** (43 filas, 18 matrices: 32/37/38/60/68/73/114/152/153/154/156/165/347/350/355/361/365/375 pasaron a formato `Mat N`).
- ~~**`Rafael`**: aparece como Aumenta en alguna fila.~~ → **RESUELTO 2026-04-19**: eran 11 filas de matriz 25 "Armado con Engranajes 501", proceso ejecutado por tallerista Rafael (no por la fabrica). Eliminadas, no corresponde trazarlas.

## 6) Otras observaciones

- **Causa-Efecto con Aumenta = Fabr**: 3 filas (F9, F10, C9) que insertamos para armar Pinza Fiambre vía Mat 306. Validar si todas se confirman o pasan a problemas.
- **Triggers de sincronización SP Kg → Despiece**: si cambiás peso en SP Kg, se propaga a Despiece x Articulo. Si trabajás en peso de D15/G11/G13, recordá que `Partes x Tallerista` también se actualiza.

## 7) Pendiente explícito: GRJ16 Batidor Mini 580

Creé la fila en `SP Kg.GRJ16` con peso NULL. **Falta**:

1. **Componentes** que arma Carlos: confirmar cuáles. Hipótesis: ABPM + EP10 + FVCBM + FVLBM + LLF7? (no existe LLF7 puro, hay LLF7A "Vastago Pelapapa" y LLF7B "Arandela Batidor Pera").
2. **Causa-Efecto**: una fila por componente, todas con Aumenta=GRJ16, Matriz=Carlos.
3. **Articulos Virgilio X Tallerista**: una fila por componente con Cod_Art=GRJ16, Tallerista=Carlos.
4. **Despiece x Articulo cod 580**: agregar fila Sector Proce=GRJ16 al despiece existente (que hoy tiene ABPM, EP10, FVCBM, FVLBM, Cartón).
5. **Recepcion Cervantes.html GRJ_COMPONENTES + GRJ_PESOS**: agregar GRJ16 con sus componentes y peso.

Cuando me digas qué componentes van, lo armo en una pasada.

---

## Resumen accionable

| Prioridad | Tarea | Tiempo estimado |
|---|---|---|
| Alta | Cargar peso a GRJ13 (D15/G11/G13 eliminadas, KF3 cargado 18-04) | 5 min con balanza |
| Alta | Confirmar componentes GRJ16 + completar | 15 min charla con Carlos |
| Media | Decidir si Poly debe tener FB3B y FC3 | 5 min |
| Media | Decidir A2E y C2 (faltan en SC Kg o están mal asignadas) | 10 min |
| Baja | Limpiar Causa-Efecto (Matriz N → Mat N, Fabr (Interno) → Fabr, eliminar IF2T/LF13T/Z12 si no van) | 15 min |
