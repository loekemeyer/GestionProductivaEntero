# Modelo de datos — Despiece y flujo de artículos (Gestión Productiva)

Documento base para **educar a un proyecto de Claude**. Explica el dominio, el vocabulario y la
lógica con la que se arma cada artículo y se traza el origen de cada una de sus partes.
Está acompañado de:

- **`Despiece_por_Articulo.md`** — listado completo, artículo por artículo (los 213), con sus partes y el flujo de cada una.
- **`despiece_articulos.json`** — los mismos datos en formato estructurado (para consultar con precisión).
- **`despiece_plano.csv`** — una fila por rama de proceso (para Excel / tablas dinámicas).

Todo se generó replicando **exactamente** el algoritmo del módulo **“Despiece x Artículo”** de Gestión
Productiva, leyendo la base Supabase del proyecto (`hrxfctzncixxqmpfhskv.supabase.co`).

---

## 1. El negocio en una frase

Es una fábrica metalúrgica / de plásticos de **utensilios de cocina y herramientas** (pinzas, espátulas,
afiladores, pisapapas, bombillas, etc.). Cada **artículo** terminado se **arma a partir de varias partes**.
Cada parte tiene un **origen** (materia prima propia, compra a proveedor, o semielaborado) y atraviesa una
**sucesión de procesos** (matrices internas de corte/estampado + servicios externos como cromado, zincado,
niquelado, pulido…) hasta quedar lista. Finalmente un **tallerista** arma el artículo y se **encaja**.

```
MATERIA PRIMA / COMPRA  →  [procesos: matrices internas + PS]  →  PARTE terminada
                                                                      ╲
         (todas las partes)  →  TALLERISTA (arma)  →  CAJA (packaging)  →  ARTÍCULO terminado
```

---

## 2. Concepto central: Artículo → Partes → Flujo

- **Artículo (`COD`)**: producto terminado. Ej. `043 — 3 en 1 CH`. Hay **213 artículos**.
- **Parte**: cada fila del despiece de ese artículo. Un artículo tiene entre **1 y 12 partes** (promedio ≈ 3).
- **Flujo de la parte**: la cadena de pasos, desde el origen hasta la parte. Se **lee de izquierda
  (origen / materia prima) a derecha (la parte, marcada con ▣)**. Los pasos entre `〔 〕` son **procesos**.

Ejemplo real (artículo 043, parte “3 En 1 Sin Marca”, sector `C3`):

```
Fleje 6 → 〔Mat 32 (Corte Cuerpo 3 en 1)〕 → Mat 32 → 〔Mat 33 (Estampado Cuerpo 3 en 1)〕 → JF12 → 〔Pedernera (Cromado)〕 → C3 ▣
```

Lectura: del **Fleje 6** (fleje de acero) se **corta** con la matriz 32 (queda el semielaborado `Mat 32`),
se **estampa** con la matriz 33 (queda `JF12`), se manda al PS **Pedernera** que lo **cromó**, y resulta la
parte `C3`. Esa parte, junto con las otras 5 del artículo 043, la arma el tallerista **Martin** y se encaja.

---

## 3. Glosario de entidades

| Término | Qué es |
|---|---|
| **COD / Artículo** | Código y nombre del producto terminado. Clave de `Despiece x Articulo`. |
| **Parte** | Cada componente del artículo. Se identifica por su **Sector** (`Sector Proce`). |
| **Sector (`Sector Proce`)** | Código del estado/ubicación productiva de una pieza. Puede ser una pieza terminada, un semielaborado, un fleje, etc. Es la “moneda” con la que se traza el origen. |
| **Partes x uni** | Cuántas unidades de esa parte lleva **una** unidad del artículo (ej. 2 remaches, 8 arandelas). |
| **Rubro** | Clasificación de la parte: `Cartones`, `Plásticos`, `Remaches`, `Importados`, `Intermedios`, `Otros`. |
| **KGxUni** | Peso (kg) por unidad, cuando aplica. |
| **Fleje** | **Materia prima**: fleje/cinta de acero. Origen primario de las piezas metálicas. Tiene Nº, descripción y proveedor. |
| **Matriz** | Herramienta interna de **corte / estampado / doblado**. Produce un sector consumiendo otro (fabricación **interna**). |
| **PS (Prestador de Servicio)** | Taller **externo** que aplica un **proceso** a una pieza (cromado, zincado, niquelado, pulido, templado, etc.). Recibe una entrada (`SC`) y devuelve una salida (`SP`). |
| **SP / SC** | Las dos categorías de **semielaborado en stock** (módulos *StockSP* y *StockSC*). En `Partes x PS`: **SC = lo que la fábrica entrega** al PS; **SP = lo que el PS devuelve**. Cada uno puede tener proveedor (cuando se compra en vez de producirse). |
| **ST** | **“Tránsito”**: sector genérico de pieza en circulación entre procesos. Al trazar, se resuelve buscando *quién produjo ST* para esa misma parte. |
| **GRJ** | Sector **compuesto** (un ensamble de varios componentes). Se expande en sus componentes (`GRJ_Componentes`) y cada uno se traza por separado. |
| **CC… (prefijo)** | **Cartón comprado**: sector que arranca con `CC`. Es compra directa, sin ruta productiva (se le quita el prefijo para mostrar). |
| **Tallerista** | Quien **arma** el artículo terminado con todas sus partes (destino del despiece). |
| **Caja** | Packaging final del artículo: nº de caja, sector, medidas y unidades por caja. |
| **Proveedor** | De dónde se compra un fleje o un sector comprado. |

---

## 4. Cómo se traza el origen de cada parte (algoritmo)

Para una parte con sector `S`, se busca **hacia atrás** quién lo produce, recursivamente, hasta llegar a
materia prima o compra. Reglas (en orden), idénticas al módulo:

1. **`S` empieza con `CC`** → **cartón comprado**. Fin (compra).
2. **`S` es “Fleje …”** → **materia prima** (fleje). Fin.
3. **`S` es un GRJ** (está en `GRJ_Componentes`) → es un **ensamble**: se expande en sus componentes y cada componente se traza por separado.
4. **Producción por matriz** (`Causa-Efecto` con `Aumenta = S`): una o varias **matrices internas** lo producen consumiendo el sector `Descuenta`. Se sigue trazando `Descuenta`.
   - Si `Descuenta` está vacío o es `Fabr` → **fabricación interna** (no se traza más atrás).
5. **Producción por PS** (`Partes x PS` con `SP = S`): un **PS** lo produce aplicando `Proceso`, consumiendo `SC`. Se sigue trazando `SC`.
   - Si `SC = ST` → **tránsito**: se busca quién produjo `ST` para esa misma `Parte` y se continúa por ahí.
6. **Si nadie lo produce** → es **origen** (hoja):
   - Si `S` **no** está en `SP Kg` y existe un **Fleje homónimo** → sale de ese **fleje**.
   - Si no → **compra**. El proveedor se resuelve buscando el sector, **en este orden**: `SectorPlasticos` → `SP Kg` → `SC Kg` → `Remaches SP` → `Remaches SC` → `BOMB` → `Cepillos`. Si es remache, se marca como *Comprado (Remaches)*.

> **Regla fina importante:** un sector que existe en **`SP Kg` nunca sale de Fleje**, aunque exista un
> Fleje con el mismo nombre (ej. `D9-SP` vs `D9-Fleje`). Los SP sin matriz en la cadena vienen de **compra**.

### Destino (tallerista) y tipo

- Los talleristas del artículo salen de **`Articulos Virgilio X Tallerista`** (`Cod_Art`).
- **Tipo de destino**:
  - **Prov Art Terminado** → si **todos** los talleristas tienen el flag `prov_at`.
  - **Fabricación interna** → si **alguno** tiene el flag `interno` (ej. `Log/ Fabr`).
  - **Tallerista** → en cualquier otro caso.
- Los flags salen de **`Tall_ProvAT_PS`** (`prov_at`, `interno`, `activo`).

### Caja (packaging)

`Articulos_Cajas` (artículo → Nº de caja + unidades por caja) + `Cajas` (Nº → sector, medidas).

---

## 5. Catálogos reales (estado actual de la base)

### PS — Prestadores de Servicio (procesos externos)
`AJ Adhesivos`, `Charcas`, `Chormium`, `Daniel`, `Esther`, `FAAT`, `Gaston Almafuerte`, `Guazzaroni`,
`Jade`, `New Metal`, `Pedernera`, `Rec Color`, `Scor`, `Valeria`, `Ximpa`.

### Procesos aplicados por los PS
Adhesivado · Armado · Calado · Cementado · Cortado · Cromado · Niquelado · Pavonado · Pintado · Pulido ·
Rectificado · Serigrafiado · Templado · Templado y Revenido · Zincado.

### Talleristas / proveedores (registro `Tall_ProvAT_PS`, activos)

| Rol | Nombres |
|---|---|
| **Prov. Art. Terminado** (`prov_at`) | Carriero, Kuffo, Lopez Jose, Manfer, Maspoli, Melinox, Paternal Goma, Pettofrezza, Pintos, Rafael, The Plast |
| **Interno** (`interno`) | Log/ Fabr, **Rafael** (también prov_at) |
| **Tallerista de armado** (sin flag) | Blist-Pack, Carlos, Daniel, Esther, FAAT, Garcia, German, Guazzaroni, Jade, Lucho, Martin, New Metal, Oscar, Pedernera, Poly, Rec Color, Scor, Valeria, Ximpa |
| **Carga por unidades / sin cajones** | AJ Adhesivos, Charcas |

> Nota: muchos nombres (Guazzaroni, Pedernera, FAAT, Jade…) aparecen tanto como **PS** (en `Partes x PS`)
> como en este registro. `Tall_ProvAT_PS` es el padrón unificado de terceros; los flags definen el rol.

### Proveedores de materia prima / compra
- **Flejes (acero):** Altrak, Aperam, Basconia, Brawin, EstaMetal, Hermac, JL Metales, Szapiro.
- **SP Kg:** Bella Vista, Cimarrón, Importado, Roster (+ “PENDIENTE…”).
- **SC Kg:** Bella Vista, Importado, Pettofrezza.

### Cajas
14 cajas. Sectores y medidas (mm): A1 240×167×113 · A2 320×215×100 · A3 285×170×140 · A4 405×218×210 ·
A5 410×225×145 · A6 280×247×162 · A7 145×370×150 · A7B 145×370×150 · A8 270×165×115 · A9 100×165×210 ·
A9B 140×470×150 · A10 · A11 210×140×80 · Z9 540×205×100.

### Distribución de partes por artículo
1 parte: **71** art · 2: **46** · 3: **12** · 4: **46** · 5: **5** · 6: **12** · 7: **10** · 8: **2** ·
9: **5** · 10: **1** · 11: **1** · 12: **2**.

---

## 6. Tablas fuente (Supabase, esquema `public`)

| Tabla | Para qué | Columnas usadas |
|---|---|---|
| `Despiece x Articulo` | Artículos y sus partes | COD, ARTICULO, Sector Proce, Descripcion de partes, Partes x uni, Rubro, KGxUni |
| `Causa-Efecto` | Matrices internas (producción) | Matriz, Descripcion Matriz, Descuenta (consume), Aumenta (produce) |
| `Matrices` | Nombres de matrices | N_Matriz, Matriz |
| `Partes x PS` | Procesos externos | PS, Proceso, SC (entrada), SP (salida), Parte |
| `Articulos Virgilio X Tallerista` | Destino / armado | Cod_Art, Desc, Tallerista, Uni_x_Caja |
| `Tall_ProvAT_PS` | Padrón de terceros + flags | nombre, prov_at, interno, activo, carga_por_unidades, sin_cajones |
| `Articulos_Cajas` + `Cajas` | Packaging | Cod_Art, N_Caja, Uni_x_Caja / N_Caja, Sector, Medidas |
| `Flejes` | Materia prima acero | N Fleje, Sector, Descripción, Proveedor |
| `GRJ_Componentes` | Ensambles compuestos | cod_grj, componente, orden |
| `SP Kg` / `SC Kg` | Semielaborados + proveedor | Sp/SC, Parte/Descripcion, Proveedor |
| `SectorPlasticos`, `Remaches SP`, `Remaches SC`, `BOMB`, `Cepillos` | Mapas sector → proveedor (compra) | Sector/SP/SC, Proveedor |

---

## 7. Anomalías de datos conocidas (al leer el listado)

- **`(loop: XXX)`** — definición **circular** de un GRJ (ej. `Toch`/`JF1`: un componente se contiene a sí
  mismo). El algoritmo corta el ciclo y lo marca. Conviene corregir el dato en `GRJ_Componentes`.
- **`ST (sin origen)`** — se usó `ST` (tránsito) pero no se encontró quién produce `ST` para esa parte.
- **`— sin trazado`** — el sector no tiene productor ni proveedor cargado (falta dato).
- **Sectores intermedios tipo `Mat 32`** — algunos semielaborados están codificados con el nombre de la
  matriz que los genera; por eso un paso `〔Mat 32 (Corte…)〕` puede dejar un material `Mat 32`. Es correcto.
- **Typos en `Proceso`** — conviven `Serigrafiado`/`Serigafiado`, `Templado`/`Templado ␣`. Son el mismo proceso.
- Algunos artículos tienen **nombre vacío** y/o partes con descripción heredada (ej. “Cartón”).

---

## 8. Cómo leer el listado (`Despiece_por_Articulo.md`)

Por cada artículo se muestra: cantidad de partes, destino (tallerista) y tipo, caja, **PS** y **matrices**
que intervienen, **orígenes** (materia prima/compra), y una **tabla de partes**. En cada parte, la última
columna es el **flujo del proceso** leído `origen → 〔proceso〕 → … → parte ▣`. Si una parte tiene varias
rutas posibles, aparece **una fila por rama**.
