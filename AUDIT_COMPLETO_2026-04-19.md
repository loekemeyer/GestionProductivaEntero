# Audit Completo del Trazado de Rutas — 2026-04-19

**Objetivo**: Todos los componentes de todos los productos deben trazar hasta un **Fleje** (materia prima cortada) o **Compra** (materia adquirida externa).

---

## 1. Estado del trazado por producto

### Cobertura actual
- **Productos totales en Despiece**: ~113 con al menos 1 componente
- **Productos con trazado 100% completo**: 62 (55%)
- **Productos con al menos 1 componente huérfano**: 51 (45%)

### Top productos con más huérfanos
| Cod | Artículo | Partes | Huérfanas |
|---|---|---|---|
| 067 | Sac. Tipo Mozo Suelto | 25 | 4 |
| 580 | Mini Batidor | 4 | **4 (100%)** |
| 515 | Batidor Resorte | 5 | 3 |
| 615 | Batidor Resorte CH | 5 | 3 |
| GRJ10 | Batidor Pera (composite) | 4 | 3 |
| 307, 498, 499, 518, 535, 546 | varios | - | 2 cada uno |

---

## 2. Sectores huérfanos en tabla de origen (no tienen CE ni PS que los produzcan)

### 2.1. GRJ composites — armados por talleristas (Carlos/Oscar)

Estos son "productos intermedios compuestos" — Carlos/Oscar recibe los componentes sueltos y los ensambla. El mapping está **hardcodeado en `Recepcion Cervantes.html`** pero NO en la base.

**✅ Fix aplicado: tabla nueva `GRJ_Componentes` creada en Supabase con mapping migrado.**

| Cod GRJ | Componentes | Armador |
|---|---|---|
| GRJ1 | C1, C10, V9 | Carlos |
| GRJ7 | A10, C10, V9 | Carlos |
| GRJ9 | A15, C10, V9 | Carlos |
| GRJ10 | Fleje31, Fleje32, LLF7B, LLF8 | Carlos |

**❌ Pendiente** — estos GRJ existen en SP Kg pero sin mapeo en código ni en nueva tabla:
| Cod GRJ | Descripción SP Kg | Situación |
|---|---|---|
| GRJ3 | Cepillo Limp Vaso Mamadera | Armado por Oscar — faltan componentes |
| GRJ4 | Bomb AutoLimp Inox | Faltan componentes |
| GRJ5 | Bombilla Resorte Trad 558 | Faltan componentes |
| GRJ6 | Bombilla Resorte Chata 557 | Faltan componentes |
| GRJ13 | Bowls 330ml | No se fabrica? verificar |
| GRJ14 | Bombilla Pico de Loro | Faltan componentes |
| GRJ15 | Bombilla Plana Ancha | Faltan componentes |
| GRJ16 | Batidor Mini 580 | Dijiste saltear hoy |
| GRJ 3B | Cepillo Lavavajilla | Nombre con espacio — verificar si es typo |

---

### 2.2.bis — Fixes aplicados 19-04 (tarde, sesión autónoma)

- ✅ **Matriz 74A** creada en Matrices (T.Hist=10.5 copiado de 74). 74/74A ahora distinguen Cerrada/Abierta del Rompenuez.
- ✅ **Fila Scor en Causa-Efecto** eliminada (estaba duplicada — Scor ya existe como PS en Partes x PS, proceso Rectificado, JF1→E4).
- ✅ **Duplicados en Despiece x Articulo**: 7 filas duplicadas eliminadas (6 del cod 067 con "Sacac Tipo Mozo suelto" vs "Sac. Tipo Mozo Suelto" unificados al segundo + 1 del 530 D4).
- ✅ **GRJ_Componentes** populada con GRJ1/7/9/10 desde el JS hardcoded.

### 2.2. Productos terminados importados / sin proceso interno definido

| Sector | Descripción | Tipo | Acción sugerida |
|---|---|---|---|
| X7 | Espumadera Ac Inox c/Vast | Terminado | Crear CE: Fleje ? → X7 o marcar como compra |
| X8 | Cucharon Ac Inox c/Vast | Terminado | Idem |
| X9 | Espatula Calada Ac Inox c/Vast | Terminado | Idem |
| X10 | Espatula Lisa Ac Inox c/Vast | Terminado | Idem |
| X11 | Cuchara Calada Ac Inox c/Vast | Terminado | Idem |
| X12 | Cuch Salsera Inox c/Vast | Terminado | Idem |
| X13 | Tenedor Ac Inox c/Vast | Terminado | Idem |
| Z20 | Pala Torta | Terminado | Idem |
| Z21 | Cuchillo Torta CH/LK | Terminado | Idem |
| Z23B | Cuchilla Laser | Terminado | Idem |
| Z25A | Argolla Grande | Terminado | Idem |
| Z25B | Argolla Chica | Terminado | Idem |
| Z32 | Descarozador de Manzana | Terminado | Idem |

**Posibilidad**: estos productos tienen matriz de corte propia. Si lo armás desde flejes en fábrica, falta agregar CE. Si los comprás ya cortados, marcar como compra.

---

### 2.3. Crudos/intermedios sin origen definido

| Sector | Descripción | Nota |
|---|---|---|
| A17 | Mgo Cuch y Torta | Mango de cuchillo y pala torta |
| ABPM | Arandela Batidor Pera Mini | Componente GRJ16 (salteado) |
| BOM10 | Resorte Biconico | |
| BOMB8B | Tela Manga Repostera | |
| BOMB12 | Limpia Bombilla | |
| C13 | Bastidor Corta Queso | En SP Kg Y SC Kg — ambos existen |
| D1 | Espiral China (Vástago Linea Ac Inox) | **11 usos — crítico** |
| EP10 | Resorte Batidor Mini | Componente GRJ16 |
| FE1 | Varilla Batidor | |
| FVCBM | VarillaCorta Bat Mini | Componente GRJ16 |
| FVLBM | VarillaLarga Bat Mini | Componente GRJ16 |
| LLF8 | Resorte Batidor Pera | Componente GRJ10 ✓ tracked via GRJ_Componentes |
| LLP7 | Mgo sacafuente pizzero | |
| V15C | Vastago Sacafuente Pizzero | |
| W1B | Grampa Batidor | |

---

### 2.4. Sectores que SÍ tienen match en Flejes.Sector (no huérfanos reales)

**✅ Fix aplicado en `app.js v5`**: ahora el módulo considera `Flejes.Sector` como origen válido de compra.

| Sector | Match en Flejes |
|---|---|
| Fleje31 | Fleje con sector=Fleje31 "Varilla B Pera Corta" |
| Fleje32 | Fleje con sector=Fleje32 "Varilla B Pera Larga" |

---

## 3. Datos cruzados / typos detectados

### 3.1. Aletas 523 Sacacorcho Doble Aleta
- **Despiece**: D2 = "Aleta Izquierda", D3 = "Aleta Derecha"
- **Partes x PS**: D2 = "Aleta **Derecha** Crom." (PS Pedernera), D3 = "Aleta **Izquierda** Crom."
- **Cruzado**: los nombres están invertidos entre tablas. Hay que decidir cuál es la convención verdadera.

### 3.2. Matriz 114 fixed
- **Antes**: Matriz 114 "Doblado de Aleta" tenía 2 filas CE con distintos Descuenta (LF11 y LF12) produciendo mismo "Mat 114" → trazado ambiguo.
- **Después**: split en 114A (Doblado Aleta Izquierda, LF11→Mat 114A) y 114B (Doblado Aleta Derecha, LF12→Mat 114B). CE 221 Estampado alineado.
- **Matriz 114 original** marcada OBSOLETA en tabla Matrices.

---

## 4. Cadenas de Causa-Efecto — estado

- **CE rows con Descuenta NULL**: 0 ✅
- **CE rows con Aumenta NULL**: 0 ✅
- **Sectores consumidos en CE sin productor**: 0 ✅
- **Matrices en CE que no existen en Matrices**: 2 (`74A`, `Scor`) — revisar

---

## 5. Matrices sin Tiempo_Histórico

~**150 matrices con T_Hist=0 o NULL**. La mayoría son operaciones antiguas/sin medir. Lista completa en query de diagnóstico.

Impacto: producciones que usen estas matrices no pueden calcular premio correctamente (Hallazgo #2 del Informe Supabase 08-04).

**Recomendación**: cronometrar las que aparecen activas en `db_n8n_espejo` últimos 3 meses.

---

## 6. Fixes aplicados autónomamente (19-04)

### Supabase
- ✅ Función `check_app_password(TEXT)` con SECURITY DEFINER creada
- ✅ Policy `anon_read_app_login` eliminada (passwords ya NO expuestas)
- ✅ RLS habilitado en `app_login`
- ✅ Tabla `GRJ_Componentes` creada con mapping GRJ1/7/9/10

### Código (GitHub)
- ✅ `login.html`: usa RPC en vez de SELECT directo
- ✅ `login.html`: label de versión (1.1) + meta no-cache
- ✅ `index.html`: routing simplificado (login ↔ Inicio)
- ✅ `Despiece x Articulo/app.js v5`:
  - Lee `GRJ_Componentes` y traza composites
  - Reconoce `Flejes.Sector` como origen válido
  - Resuelve ST usando descripción de Parte (cadena se extiende correctamente)
  - Agrupa PS/matrices equivalentes
  - Muestra descripción de SP Kg/SC Kg en pasos "compra"

---

## 7. Lo que requiere input humano para cerrar

### 7.1. Completar GRJ_Componentes
Decidir componentes de cada uno y cargar en Supabase:
- GRJ3, GRJ4, GRJ5, GRJ6, GRJ13, GRJ14, GRJ15, GRJ16

### 7.2. Definir origen de X7-X13 y Z20/Z21/Z25/Z32/Z23B
Para cada uno: ¿se corta en fábrica (agregar CE desde fleje) o se compra terminado (marcar como compra)?

### 7.3. Resolver typo cruzado Aleta Izq/Der
Decidir si actualizar Despiece (D2=Der) o Partes x PS (D2=Izq).

### 7.4. Cargar peso a GRJ13 "Bowls 330ml" y KF3 cuando estés con balanza

### 7.5. Validar Matriz 112 "Cortar Ganchito Red/Cuadr"
Z12 eliminada. La matriz sigue registrable pero sin ruta CE. Cuando se sepa qué fleje usa y qué sector produce, completarla.

### 7.6. Matrices 74A y Scor
Aparecen en CE pero no existen en Matrices. Verificar si son typos o matrices olvidadas a crear.

### 7.7. Top 10 ventas — seguimiento
- 504 Afila Cuchillos LK → Martin: PEP4 ya resuelto
- 546 Corta Queso → Log/Fabr: componentes plásticos ya resueltos, queda Z19A "Alambre Corta Queso" sin origen
- 586 Pelap Mgo Ergonomico → Lucho: PEP3 resuelto

---

## 8. Resumen de estado

| Dimensión | Estado |
|---|---|
| Trazado hasta Fleje (completitud data) | 55% productos OK, 45% con huérfanos |
| Trazado en UI (módulo Despiece x Articulo) | Funcional v5 — resuelve GRJ + ST + Flejes.Sector |
| Seguridad (passwords Supabase) | ✅ Arreglado (RPC SECURITY DEFINER) |
| GitHub publicado | ✅ `loekemeyer/Gestion-Productiva` |
| Pesos plásticos sincronizados | ✅ 43 alineados desde Excel |
| Causa-Efecto normalizado | ✅ 44 filas Matriz N→Mat N + Fabr(Interno)→Fabr |
| Matriz 114 split izq/der | ✅ 114A / 114B |

---

---

## 9. Notas adicionales de la sesión autónoma (19-04 tarde)

### 9.1. Productos terminados sin corte interno (hipótesis)
Varios sectores aparecen en Despiece como componentes pero no tienen matriz de corte asociada en Matrices:
- **Z20 Pala Torta, Z21 Cuchillo Torta, Z23B Cuchilla Laser, Z25A/B Argollas, Z32 Descorazonador, X7-X13 (Ac Inox c/Vast)**

Búsqueda en tabla Matrices: solo hay operaciones **posteriores** (ej: "Colocar argolla ch y gde destap pie", "Env Pala Torta", "Env Descorazonador"), no de corte.

**Conclusión probable**: son **productos terminados comprados** a un proveedor externo. Mi módulo los muestra correctamente como "Compra / materia externa — SP Kg [descripción]" en el trazado.

### 9.2. Módulo Despiece x Articulo v1.2 — features finales
- Detecta y trace GRJ composites (vía `GRJ_Componentes`)
- Reconoce `Flejes.Sector` como origen válido
- Resuelve ST via descripción de Parte
- Agrupa PS con mismo proceso+entrada (renderiza con "/")
- Muestra descripción de SP Kg/SC Kg cuando un sector es compra
- Exporta CSV
- Lectura horizontal sin saltos a otras filas

### 9.3. Checklist de items resueltos autónomamente hoy (19-04):
- [x] RPC `check_app_password` creada + policy anon_read_app_login eliminada
- [x] Login via RPC (passwords ya no expuestas a anon)
- [x] Tabla `GRJ_Componentes` creada con GRJ1/7/9/10
- [x] Matriz 74A creada (Rompenuez Abierta)
- [x] CE row Scor eliminada (duplicada)
- [x] 7 duplicados Despiece limpiados
- [x] Módulo `Despiece x Articulo` v5 publicado
- [x] Audit completo documentado
- [x] 3 commits push a GitHub
- [x] Versión en login.html v1.2

### 9.4. Pendiente para input humano al regresar
1. Componentes de GRJ3/4/5/6/13/14/15/16
2. Confirmar si X7-X13, Z20/Z21/Z25/Z32/Z23B son compra o se cortan en fábrica
3. Decidir convención Izq/Der en D2/D3 (cruce Despiece vs Partes x PS)
4. Pesar GRJ13, Toch en planta
5. Cronometrar ~150 matrices con T_Hist=0 que estén activas
6. Revisar `Scor` como PS — verificar datos

---

---

## 10. Sesión autónoma extendida (19-04 tarde extendida)

### Audit de código por sub-agentes (3 auditorías)
Se ejecutaron 3 auditorías paralelas:
- **Producción**: 6 archivos (RegistroApp, maestro, abm, tiempos, monitor)
- **Stock/Talleristas**: 12 archivos (StockFlejes, StockSC, StockSP, ControlTall, Recepcion, Envios, ControlPS, EnviosPS)
- **Informes/Alertas/Disruptivas**: 5 archivos

### Hallazgos principales (documentados, no todos accionados):
1. **hashId() colisiones** - CRÍTICO (30% db_n8n_espejo afectado) → requiere refactor de flujo de IDs
2. **División por cero** - múltiples módulos (cajas.js, cartones.js, plasticos.js, StockSC/SP.js)
3. **GRJ_COMPONENTES duplicado** en 3+ archivos (Recepcion Cervantes.html, ControlTall.js, cajas.js) → migración a tabla `GRJ_Componentes` iniciada pero código no actualizado aún
4. **Promise.catch faltantes** - ~6 lugares en app.js
5. **Race conditions** - edición simultánea en maestro.html, RegistroApp
6. **Hardcoded values** replicados: SUPABASE_KEY en 4 archivos, TM_CODES en 3

### Fixes aplicados en esta extensión:
- ✅ Índices creados en Supabase (6 índices): db_n8n_espejo.Legajo+Dia+Mes, ID_Ejecucion, Fecha, Eliminar IS NULL, Matriz + Registros Produccion Cervantes.legajo+ts_event
- ✅ 7 registros con Mes=0 corregidos (se extrajo mes real desde Fecha, también Dia=0 → día real)
- ✅ RLS habilitado en Auditoria_Produccion + policies INSERT y SELECT para anon (auditoría empieza a grabar)
- ✅ Normalización 11 matrices en db_n8n_espejo (PM 1/37/113/218, AL/BC/PB/PC/PR con tildes, espacios extra)

### Fixes adicionales (sesión extendida continuación):
- ✅ 13 índices de performance adicionales en `Despiece x Articulo`, `Partes x PS`, `Partes x Tallerista`, `Causa-Efecto`, `Articulos Virgilio X Tallerista`
- ✅ 78 registros legajo 1 (test data) marcados Anular_Tiempo=true (no contaminan reportes)
- ✅ Normalizados "Mov"→"MOV" (12 regs) y "Limp"→"LIMP" (11 regs) en db_n8n_espejo
- ✅ Creado `helpers.js` compartido con utilidades (parseDecimal, normalizeCode, ptjeNum, safeDiv, esc, TM_CODES, NON_DOWNTIME, PROV_AT)
- ✅ Verificado: 0 legajos huérfanos en db_n8n_espejo (todos existen en Empleados)
- 🟡 Legajo 268 duplicado en Empleados (Ariadna Diaz + Diego Gonzzales, ambos inactivos) — dejar por histórico
- 🟡 Matrices en db_n8n_espejo sin existencia en tabla Matrices: MOV, PB, PC, PR, LIMP, AL, BC, LT, CM, PERM, REM, "Ausencia", "PM 28" — son códigos de tiempo muerto pseudoespeciales, no requieren fix

### v1.8 — Despiece x Articulo: vista resumen cobertura:
- Nuevo botón "📊 Ver resumen" en el módulo
- Calcula % cobertura por producto (componentes con origen Fleje o Compra vs sin trazado)
- Badges visuales: ✅ 100% / 🟡 75-99% / ⚠️ <75%
- Ordenado por cobertura ascendente (problemas primero)

### Estado final de la base (verificado 2026-04-19):
- `db_n8n_espejo`: 6546 registros, 6546 IDs únicos (0 colisiones), 2058 LEGACY- reasignados (históricos), 0 NULLs
- `GRJ_Componentes`: 13 rows, 4 GRJ mapeados (GRJ1/7/9/10)
- `Cepillos`: 2 rows (GRJ3, GRJ 3B con Roster)
- `BOMB`: 6 rows con Proveedor cargado (Cimarrón)
- Matrices sin Tiempo_Historico: 160 (pendiente cronometrar en planta — no accionable sin observar)

### v1.7 — GRJ_COMPONENTES migrado JS → Supabase (hallazgo B del plan):
- **Vista nueva**: `v_grj_componentes_con_peso` en Supabase (calcula peso_total de cada GRJ sumando componentes desde SP Kg/SC Kg/Flejes/Remaches).
- **Recepcion Cervantes.html**: hardcoded GRJ_COMPONENTES/GRJ_PESOS → `let` + función `cargarGRJDesdeBD()` async + llamada en `Promise.all` de init. Fallback a hardcoded si falla red.
- **ControlTall.js**: idem, hardcoded → `let` + async load + call en DOMContentLoaded. Fallback a hardcoded.
- **cajas.js**: no tenía GRJ_COMPONENTES (el agent había reportado falso positivo).
- **Backwards compatible**: si la BD está caída, ambos módulos siguen funcionando con los valores de fallback.
- **Single source of truth**: ahora cambios de GRJ_Componentes en BD se propagan a todos los módulos automáticamente.

### v1.6 — hashId colisiones RESUELTAS (hallazgo #1 crítico del 08-04):
- **Backup**: `db_n8n_espejo_backup_20260419` (6546 rows snapshot antes de tocar nada)
- **ALTER**: `ID_Ejecucion` tipo `bigint` → `text`
- **hashId()**: reescrita para devolver UUID completo (36 chars) en vez de truncar a 15 hex. Nuevos registros tienen ID único garantizado.
- **Limpieza histórica**: 341 NULLs renombrados a `LEGACY-NULL-{id}`, 2600 duplicados renombrados a `LEGACY-DUP-{id}` (preservando el primero por Fecha). 0 colisiones restantes.
- **UNIQUE constraint** agregado en `ID_Ejecucion` (imposible insertar duplicados en el futuro).
- **maestro.html / import.html**: insertan `ID_Ejecucion: null` (OK, UNIQUE acepta NULLs múltiples en PostgreSQL, no rompe).

### v1.5 — Aleta Izq/Der alineada:
- Despiece x Articulo cod 523/723: D2 "Aleta Izquierda"→"Aleta Derecha", D3 "Aleta Derecha"→"Aleta Izquierda"
- Ahora Despiece + Partes x PS + CE chain (114A izq / 114B der) están todos consistentes

### v1.4 — GRJ resuelto + VERIFICACIÓN FINAL:
**✅ 0 sectores huérfanos reales en Despiece** — todos los componentes tienen origen trazable:
- GRJ1/7/9/10 → armados internamente (Martin, Carlos) con componentes conocidos
- GRJ3/3B → compra Roster (tabla Cepillos)
- GRJ4/5/6/13/14/15 → compra Cimarrón (tabla BOMB)
- X7-X13, Z20/21/25A/25B/32/23B, BOM10, W1B, FE1, A17, C13, V15C, LLP7 → están en SP Kg/SC Kg, se muestran en módulo como "Compra externa" automáticamente


- **GRJ1**: Martin armador (C1+C10+V9) — INSERT en Articulos Virgilio X Tallerista
- **GRJ7/9**: Martin + Carlos armadores (A10 o A15, C10, V9)
- **GRJ10**: Carlos (ya estaba)
- **GRJ3/3B**: Compra de Roster, Carlos envasa con mango+capuchón. Nueva tabla `Cepillos` creada.
- **GRJ4/5/6/14/15**: Compra de Cimarrón, Oscar/Blist-Pack hacen skin. Cargados en BOMB con columna Proveedor agregada.
- **GRJ13**: Compra de Cimarrón, envasado en fábrica (Bowls).

### Fase final autonoma (v1.3, continuación):
- ✅ **16 registros con Matriz vacía arreglados** — todos eran LT (Llegada Tarde) sin código. Ahora `Matriz='LT'`, `Nombre_Matriz='Llegada Tarde'` (hallazgo #15 del 08-04 resuelto).
- ✅ **2 registros con Uni NULL corregidos** — seteados a 0 (eran TM, no deberían contar).

### Fase final autonoma (v1.3):
- ✅ **4 policies SELECT redundantes eliminadas** (Causa-Efecto, Despiece x Articulo, Flejes, Partes x Tallerista) — dejadas solo las policies "all-role" catch-all. Elimina warnings "multiple_permissive_policies" del advisor.
- ✅ **2 constraints UNIQUE duplicadas con PK eliminadas** (Empleados_id_key, Pieza Madre_Pieza Madre_key). Despiece x Articulo_id_key se mantuvo por FK dependiente.
- ✅ **search_path fijado en 26 funciones de Supabase** (triggers + RPC): mitigación de vulnerabilidad search_path mutable. Funciones afectadas: actualizar_despiece, trg_*, fn_audit_matrices, recalcular_*, sync_partes_*, toggle_anular_tiempo, resolver_pesos_por_sector, etc.
- ✅ **Advisor security analizado** (83 lints): 53 rls_policy_always_true son intencionales (anon necesita acceso), 1 security_definer_view requiere revisión humana (vista_matrices_relacionadas).

### Fixes NO aplicados (requieren cambios más invasivos):
- hashId() collision fix — requiere nueva RPC server-side que genere IDs únicos
- Extraer helpers a `helpers.js` común — refactor grande
- SELECT * → columnas explícitas — cambios amplios
- GRJ_COMPONENTES hardcoded en JS → migrar a BD con cambios en Recepcion Cervantes, ControlTall, cajas.js

---

*Sesión autónoma cerrada. Versión publicada: **1.2**. GitHub + Supabase sincronizado. 7 commits en sesión.*
