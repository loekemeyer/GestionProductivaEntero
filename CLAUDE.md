# ⚠️ ANTES DE CUALQUIER EDIT/WRITE: LEER LOCKS.txt Y REGISTRAR LockX. SIN EXCEPCIONES. ⚠️

# Gestion Productiva - Instrucciones para Claude

## Perfiles de Usuario (LEER AL INICIO)

**Al arrancar cada sesión, leer `PERFILES.md` para saber con quién estás trabajando.**
El usuario se identifica por el nombre de usuario de Windows (mismo que usa el sistema de locks).
Adaptar el trato, nivel de detalle y módulos según el perfil del usuario.

## Renombres de Sectores (carga de stock_inicial)

**Al cargar `stock_inicial` desde Excel a `Partes x Tallerista`, leer `Renombres_Sectores.md`** —
contiene mapeos confirmados de codigos viejos del Excel a sectores actuales en BD
(p.ej. E11→D1, A2→PA2, EP2/3→PEP4). Antes de preguntar por discrepancias, chequear ahí
si ya existe el mapeo. Cuando el usuario confirme un renombre nuevo, agregarlo al archivo.

## Sistema de LOCKS (OBLIGATORIO - LEER PRIMERO)

**REGLA #1: NUNCA usar Edit ni Write sin antes leer LOCKS.txt y registrar tu LockX.**
**REGLA #2: NUNCA liberar un LockX sin revisar la WAIT QUEUE.**
**REGLA #3: Si te olvidas de los locks, el usuario te va a corregir. No dejes que pase.**

**Esta carpeta es compartida entre varias personas con Visual Studio Code + Claude.**
**Antes de tocar cualquier archivo, usar el sistema de locks en `LOCKS.txt`.**

### Protocolo de locks (como SQL Server):

| Lock | Significado | Compatible con |
|------|------------|----------------|
| LockS | Lectura/analisis para planificar cambios | Otros LockS (NO con LockX) |
| LockX | Edicion exclusiva del archivo | NADA (ni LockS ni LockX) |

### Identificacion: usar el nombre del usuario de Windows como identificador en los locks.

### Flujo NORMAL (archivo libre):

1. **Leer `LOCKS.txt`** seccion [LOCKS] - Verificar que el archivo NO tenga locks ajenos.
2. **Registrar tu LockX** en [LOCKS]: `LockX | ruta/archivo | tu-id | fecha hora | que vas a hacer`
3. **Re-leer el archivo** justo antes de editarlo (puede haber cambios recientes).
4. **Hacer la edicion** con Edit tool (ediciones minimas, nunca reescribir completo).
5. **Al terminar:**
   a. Revisar si hay alguien en [WAIT QUEUE] esperando por tu archivo.
   b. Si hay alguien esperando: cambiar su linea WAIT a READY.
   c. Borrar tu LockX de [LOCKS].
   d. Agregar linea en [HISTORIAL] con lo que hiciste (mantener max 10).

### Flujo con ESPERA (archivo bloqueado):

1. **Leer `LOCKS.txt`** -> El archivo tiene un LockX ajeno.
2. **Registrar WAIT** en [WAIT QUEUE]: `WAIT | ruta/archivo | tu-id | fecha hora | que necesitas hacer`
3. **Informar al usuario** que el archivo esta bloqueado y que quedo en cola de espera.
4. **Si hay otros archivos libres** del mismo pedido, trabajar en esos mientras tanto.
5. **Revisar periodicamente** (cada vez que termines otra tarea) si tu WAIT cambio a READY.
6. **Cuando veas READY:**
   a. **RE-LEER el archivo completo** (tiene cambios del lock anterior!).
   b. **Adaptar tu trabajo** a los cambios nuevos que encuentres.
   c. Borrar la linea READY, registrar tu LockX en [LOCKS].
   d. Ejecutar tu edicion.
   e. Repetir el paso 5 del flujo normal (revisar wait queue, liberar, historial).

### Reglas adicionales:
- Editar solo lo minimo necesario. No reformatear, no reordenar, no "mejorar" codigo no pedido.
- No tocar archivos fuera del alcance del pedido.
- Prioridad en wait queue: FIFO (primero en registrarse, primero en ejecutar).
- Si un lock lleva mucho tiempo (>30 min), avisar al usuario que puede estar obsoleto.
- NUNCA borrar lineas de locks ajenos sin autorizacion del usuario.

## Tablas Madre y Derivadas (OBLIGATORIO - LEER ANTES DE TOCAR SUPABASE)

**Antes de hacer INSERT, UPDATE o DELETE en Supabase, verificar en esta seccion si la tabla es MADRE o DERIVADA.**
**Si es DERIVADA, NO modificarla directamente. Ir a la tabla MADRE correspondiente.**
**Si no estas seguro, PREGUNTAR al usuario antes de ejecutar.**
**Referencia completa: `Tablas_Madre_y_Dependencias.xls` en la raiz del proyecto.**

### Cadena de Pesos (Kg x Uni / Kg x Cajon)

```
TABLAS MADRE (donde se carga):
  SP Kg          → sectores procesados (Sp, Kg X Uni, KG x Cajon)
  SC Kg          → sectores crudos (SC, Kg X Uni, KG x Cajon)
  SectorPlasticos → plásticos (Sector, Kg x Uni, Uni x Bolsa)
  Remaches SP/SC → remaches

TABLAS DERIVADAS (se sincronizan solas, NUNCA modificar directo):
  Despiece x Articulo  → KGxUni, Kg x Caj (sincronizado por funcion actualizar_despiece)
  Partes x Tallerista  → kgxuni, kg_x_caj (sincronizado por trigger desde Despiece)
```

**⚠️ Si alguien pide cargar pesos en `Despiece x Articulo` o `Partes x Tallerista`, AVISAR que se van a sobreescribir. Cargar en SP Kg o SC Kg segun corresponda.**

**⚠️ NUNCA vaciar (DELETE masivo / TRUNCATE) tablas madre.** Las tablas madre contienen datos maestros que alimentan tablas derivadas via triggers. Vaciarlas rompe toda la cadena de sincronizacion. Tablas madre protegidas: `SP Kg`, `SC Kg`, `SectorPlasticos`, `Matrices`, `Articulos Virgilio X Tallerista`, `Partes x PS`. Si el usuario pide vaciar alguna, ADVERTIR el impacto antes de ejecutar.

Orden de busqueda de `resolver_pesos_por_sector`: SP Kg → SC Kg → SectorPlasticos → Flejes → Remaches SP → Remaches SC (LIMIT 1, el primero que encuentre gana).

### Cadena de Talleristas

```
TABLA MADRE: Articulos Virgilio X Tallerista (Tallerista, Cod_Art, Desc)
DERIVADA:    Partes x Tallerista (se reconstruye por trigger INSERT/UPDATE/DELETE)
VISTAS:      v_piezas_por_tallerista → v_piezas_por_tallerista_resumen
```

### Cadena de Produccion

```
TABLA MADRE: Matrices (N_Matriz, Tiempo_Historico)
DERIVADA:    db_n8n_espejo → Segundos_Historico, Premio (via RPC recalcular_matriz)
AUDITORIA:   Matrices_audit (trigger fn_audit_matrices)
```

### Tablas de Movimientos (NO son derivadas, se escriben directamente)

| Tabla | Modulo que escribe |
|---|---|
| Envios a PS | Control PS, Facturas (carga manual) |
| Entregas PS | Control PS, Facturas (carga auto/manual) |
| Envios a Talleristas | Envio Talleristas |
| Entregas Tallerista Virgilio | Recepcion Cervantes/Virgilio |
| db_n8n_espejo | App Produccion, n8n |

### Partes x PS (tabla de configuracion, se modifica directamente)

Al modificar SC o SP en `Partes x PS`:
1. Verificar que el nuevo sector exista en SP Kg y/o SC Kg con sus pesos
2. Si no existe, CREARLO en la tabla madre antes de hacer el cambio
3. Revisar impacto en: Control PS, Stock SC, Stock SP, Stock Transito, Stock General, Plasticos

## Stack tecnologico

- Frontend: HTML/CSS/JS vanilla (sin framework)
- Backend/DB: Supabase (PostgreSQL) con JS client v2 desde CDN
- Auth: login.html + auth-guard.js con sessionStorage
- Tablas principales: `db_n8n_espejo`, `Empleados`, `Matrices`, `Registros Produccion Cervantes`
- Edge Functions: WhatsApp alertas, lectura facturas
- Server: Live Server en puerto 5501

## Estructura de carpetas

Cada modulo es una carpeta con su propio HTML/JS/CSS. Los modulos principales:
- `Produccion/` - Registro de produccion (app.js, maestro.html, abm.html)
- `Disruptivas/` - Producciones con premio anomalo (disruptivas.js)
- `Informes/` - Reportes
- `Inicio/` - Dashboard principal
- `Verificacion/` - Trazado de Rutas (REESCRITO 2026-04-18, ver abajo)

## Verificacion - Trazado de Rutas (reescrito 2026-04-18)

Modulo unificado para trazar rutas productivas y validar integridad. Reemplaza el viejo
sistema con multiples botones (Ejecutar Verificacion, Constructor, Rutas Nuevo, etc.)
por un unico flujo:

**Logica de trazado** (DFS desde cada Fleje):
1. Sigue `Causa-Efecto` (Descuenta -> Aumenta via Matriz). Si Matriz es nombre de
   tallerista (Carlos, Martin, "Martin, Carlos"), se trata como tallerista no matriz.
2. Sigue `Partes x PS` (SC -> PS via Proceso, devuelve SP). Agrupa PS que hacen mismo
   proceso al mismo SP (ej. "Daniel / Jade").
3. Termina en `Partes x Tallerista` cuando sector_proce coincide con un tallerista.
4. ST como SP devuelto (Sector Transito): muestra descripcion del paso anterior +
   nombres de PS en transito (ej. "Cuchilla Pelapapa Doblada + New Metal/FAAT").
5. Aumenta=Fabr indica fabricacion interna (terminacion de ruta).

**4 tabs**:
- Trazar Rutas: rutas nuevas pendientes de revision.
- Rutas Confirmadas: las que diste OK. Persistidas en tabla `Rutas_Confirmadas`.
- Revisar despues: marcadas con boton 📌 sin describir motivo. Tabla `Rutas_Problemas`
  con `problema = '(pendiente de revisar)'`.
- Problemas: reportadas con ⚠ y descripcion. Misma tabla, otro filtro.

**Tablas auxiliares** (creadas 2026-04-18):
- `Rutas_Confirmadas` (id, fleje, descripcion, ruta_json, firma UNIQUE, confirmado_por,
  confirmado_en).
- `Rutas_Problemas` (id, fleje, descripcion_fleje, ruta_json, firma, problema,
  estado pendiente|resuelto, reportado_por, reportado_en, resuelto_en).
- Firma = "F:<fleje>|tipo:label|tipo:label|..." sirve para deduplicar rutas iguales
  entre re-trazados.

**Reportes/auditorias**:
- `AUDITORIA_RUTAS_2026-04-18.md` (raiz proyecto): inconsistencias detectadas.

## Patron de armado de productos: GRJ (Garaje)

Los GRJ (GRJ1, GRJ7, GRJ9, GRJ10, etc.) son productos intermedios armados por talleristas
(generalmente Martin y/o Carlos). Cada GRJ tiene componentes que se descuentan al
entregarlo en `Recepcion Cervantes.html`.

Configuracion en 2 lugares (mantener sincronizadas):

1. **`Talleristas/Recepcion/Recepcion Cervantes.html`**:
   - `GRJ_COMPONENTES = { GRJ7: ["A10","C10","V9"], GRJ10: ["Fleje31","Fleje32","LLF7B","LLF8"], ... }`
   - `GRJ_PESOS = { GRJ7: 0.033567, GRJ10: 0.068882, ... }`
   - `ARTICULOS_EMPRESA = { CARLOS: { LK: ["GRJ7","GRJ9","GRJ10"] }, MARTIN: ... }`

2. **Supabase**:
   - `Articulos Virgilio X Tallerista`: una fila por (Tallerista, Cod_Art=GRJX, Desc=componente)
   - `SP Kg`: el GRJ como Sp con peso total
   - `Despiece x Articulo`: el GRJ aparece como Sector Proce en el cod_art final

**Pendiente al 2026-04-18**: GRJ16 (Batidor Mini 580) creado en SP Kg pero falta
componentes/CE/asignacion (ver AUDITORIA_RUTAS_2026-04-18.md punto 7).

## Causa-Efecto: convenciones

- `Descuenta` y `Aumenta` deben ser sectores conocidos o "Fleje N" o "Mat N".
- `Matriz` puede ser:
  - Numero (ej. "62"): se renderiza como "Matriz 62" y busca su nombre en `Matrices.N_Matriz`.
  - Nombre de tallerista (ej. "Carlos", "Martin, Carlos"): el JS de trazado lo reconoce y
    lo pinta como 👷 tallerista (no como ⚙️ matriz).
  - "Fabr": fabricacion interna (sin tallerista ni matriz especifica).
- **NO usar formato "Matriz N" en Descuenta/Aumenta** — usar "Mat N" para que el sistema lo
  trate como nodo intermedio. Si aparece "Matriz N" como nodo, son inconsistencias (ver
  AUDITORIA_RUTAS_2026-04-18.md punto 5).

## Reglas para trabajar en este proyecto

- ANTES de tocar tablas madre, leer LOCKS.txt, registrar LockX.
- Triggers de sincronizacion: ver Tablas_Madre_y_Dependencias.xls.
- ST como sector SC en Partes x PS = Sector Transito (PS recibe pero no devuelve SP final,
  se manda al siguiente PS). Es valido pero el codigo "ST" se usa en muchos contextos —
  no asumir descripcion generica.

## Supabase

- URL: `https://hrxfctzncixxqmpfhskv.supabase.co`
- La tabla `db_n8n_espejo` es la principal de produccion. Campos clave:
  - `Legajo`, `Matriz`, `Nombre_Matriz`, `Uni`, `Fecha`
  - `Hora_Inicio`, `Hora_Fin`, `Segundos_Trabajados`, `Segundos_Tiempo_Muerto`
  - `Segundos_Historico`, `Premio`, `Tiempo_Toma`, `Tiempo_Historico`
  - `Eliminar` (soft delete = 'S'), `Revisado`, `Anular_Tiempo`
  - `ID_Ejecucion`, `Dia`, `Mes`
- La tabla `Empleados` tiene campo `Activo` (valor "SI" para activos)
- La tabla `Matrices` tiene `N_Matriz`, `Matriz` (nombre), `Tiempo_Historico`
