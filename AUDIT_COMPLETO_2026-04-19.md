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

*Fin del audit. Continúa en próxima sesión con decisiones de negocio (GRJ3-15, X7-X13, etc.).*
