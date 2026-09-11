# ⚠️ ANTES DE CUALQUIER EDIT/WRITE: LEER LOCKS.txt Y REGISTRAR LockX. SIN EXCEPCIONES. ⚠️

# Gestion Productiva - Instrucciones para Claude

## ⚠ REGLA: preguntar QUIÉN habla y dejar cada pedido como tarea en su Planify

**Vale para TODOS los repos** (LK, Gestión Virgilio, Planify y cualquiera nuevo: copiar este
bloque al `CLAUDE.md` del repo nuevo). Objetivo del dueño: que ninguna tarea quede a medio
hacer sin figurar en la agenda de alguien.

1. **Al empezar la sesión, preguntar quién está hablando** (antes de hacer nada):
   *"¿Quién sos? (Thomas, Marianela, Luis, Gastón, …)"*. Si el mensaje ya lo dice, no repreguntar.
2. **Cada pedido de trabajo se registra como tarea en el Planify de esa persona**, apenas se
   empieza, con nombre MUY resumido (≤ 60 caracteres) y una nota de 1–3 líneas con el
   contexto. Queda `done=false` hasta que se cierre (punto 4). Si la sesión termina sin
   cerrar, la tarea queda en la agenda: ése es el objetivo.
3. **Excepción del dueño:** Thomas Loekemeyer NO usa Planify. Sus pedidos se cargan en el
   Planify de **Tomás Beviglia (employee_id 20)** con el nombre antepuesto por **`Th `**
   (ej. `Th Fecha estimada de entrega por zona`).

**Dónde:** proyecto Supabase de Gestión Virgilio `hrxfctzncixxqmpfhskv`, schema `planify`.
Empleados activos con Planify (`planify.employees`): Marianela Becker **38**, Luis Rial Otero
**52**, Gastón Dalponte **61**, Tomás Beviglia **20**, Gonzalez Tomas 16, Elías Irace 1,
Nazareno Rodríguez 27, Angely Asuaje 22, Viviana Gauna 4, Alan Gonzalez 5, Diego Mollo 44,
Nora Heredia 33, Juan Cruz Karaygan 51, Pablo Martos 6, Martín Cornejo 34, Martín Pregelj 15,
Romina Maturano 55, Iván Meta 58, Jhonny Cartaya 46. Si el nombre no está, buscar:
`select id, nombre from planify.employees where activo and nombre ilike '%<apellido>%'`.

```sql
-- alta (al empezar el pedido)
insert into planify.tasks (name, type, prio, time, date, note, rec, done, assignment_type,
  employee_id, department_id, system_generated, broadcast, created_at, updated_at)
values ('<resumen ≤60>', 'tarea', 'normal', '09:00', to_char(now() at time zone
  'America/Argentina/Buenos_Aires', 'YYYY-MM-DD'), '<contexto 1-3 líneas> — cargado desde
  sesión de Claude', 'none', false, 'employee', <employee_id>, null, false, false, now(), now())
returning id;
-- cierre (cuando la persona la da por terminada)
update planify.tasks set done = true, updated_at = now() where id = <id>;
```

Avisar en el chat el **nombre** de la tarea al crearla y al cerrarla, NO el número de id
(ej. *"Te registré la tarea «Schema auditoría de errores por repo»"*, no *"tarea 3118"*). El id
se usa sólo para el SQL de cierre; a la persona no le dice nada. No crear tareas para preguntas
o consultas que se responden en el momento; sólo para pedidos que implican hacer algo.

4. **Cierre por criterio propio, no sólo por "listo".** Claude evalúa si el objetivo del
   pedido se cumplió (lo entregado funciona, está commiteado/aplicado, y no quedó ninguna
   parte del pedido sin hacer). Cuando lo considere cumplido, pregunta **"¿Falta algo más
   para dar por cerrada la tarea?"** — si la persona dice que no (o no pide nada más
   dentro de esa tarea), `done=true`. Si dice "listo" antes, también se cierra. Lo que se
   pidió y quedó a medias NO se cierra: se deja abierta con la nota actualizada
   ("queda pendiente: …").

5. **Alerta de inactividad (1 hora).** Si hay tareas abiertas de esta sesión y pasa una
   hora sin mensajes, Claude escribe: *"Te estoy registrando estas tareas pendientes:
   … ¿Querés continuar alguna o damos por cerrada la charla?"* Cómo: al terminar un turno
   con tareas abiertas, si la sesión tiene `send_later` (Claude Code web/remoto) o
   `ScheduleWakeup`, armar UN recordatorio a 60 min (borrar el anterior si existía); al
   dispararse, si sigue habiendo tareas abiertas, mandar la alerta; si no, no decir nada.
   En una sesión local sin esas herramientas no hay forma de despertarse sola: en ese
   caso, al cerrar cada turno con tareas abiertas, dejar la lista escrita en el chat.

6. **Propagar la regla a todo repo nuevo.** Si en una charla se agrega o se toca por
   primera vez un repo que NO tiene este bloque en su `CLAUDE.md` (se lo trae de referencia,
   se lo crea, o se le hace un cambio), copiarle este bloque entero (creando el `CLAUDE.md`
   si no existe) y commitearlo en ese repo, avisando en el chat. Así el dueño no tiene que
   pedirlo cada vez. Fuente canónica del bloque: `CLAUDE.md` de `loekemeyer/pagina-LK-copia`.

## REGLA: auditar en Supabase cada problema del repo y su solucion

**Vale para TODOS los repos** (igual que la regla de Planify: copiar este bloque al `CLAUDE.md`
de cualquier repo nuevo). Objetivo: que cada error que tuvo un repositorio quede con su causa,
su correccion y el/los commits donde se arreglo, para no volver a pisar el mismo pozo.

**Donde:** proyecto Supabase `hrxfctzncixxqmpfhskv`, schema `github_repo_problemas`.
Se escribe con el MCP de Supabase (`execute_sql`), no con la anon key.

### Que se audita y que NO

Regla corta: **si ya estaba pusheado y andaba mal, se audita.** Si es trabajo nuevo, no.

| Se registra | NO se registra |
|---|---|
| Bug en codigo ya pusheado que llego al usuario | Feature nueva o pedido de cambio |
| Dato corrupto o mal migrado en la base | Refactor pedido por el usuario |
| Config o credencial rota o filtrada | Bug que introducis y arreglas antes de pushear |
| Performance degradada, query que no escala | Duda o consulta que se responde en el momento |
| Tabla derivada desincronizada de su madre | Ajuste de estilo o texto |

### Cuando

1. **Al detectar el problema** (antes de tocar nada): `registrar_problema` devuelve el id.
2. **Al pushear el fix**: `cerrar_problema` con el sha del commit.
3. **Si el fix necesita mas commits**: `agregar_commit` por cada uno. Un problema puede tener N
   commits; NO abrir un problema nuevo por el segundo pase del mismo fix.
4. Una sesion de Claude puede abarcar **varios** problemas: `sesion_id` no es unico.

### SQL

```sql
-- 1) al detectar
select github_repo_problemas.registrar_problema(
  p_repo          => 'owner/repo',            -- en minuscula
  p_titulo        => '<sintoma en <=120 chars>',
  p_descripcion   => '<que se rompio y como se manifesto>',
  p_categoria     => 'bug',                   -- bug|datos|seguridad|performance|config|ux|deuda_tecnica|documentacion
  p_severidad     => 'alto',                  -- critico|alto|medio|bajo
  p_modulo        => 'Carpeta/Modulo',
  p_archivos      => array['ruta/relativa.html'],
  p_sesion_id     => '<id de la sesion de Claude>',
  p_detectado_por => '<usuario> (claude-remote)',
  p_detectado_en  => now()                    -- fecha REAL si es carga historica
);

-- 2) al pushear el fix
select github_repo_problemas.cerrar_problema(
  p_id            => <id>,
  p_correccion    => '<que se cambio>',
  p_commit_sha    => '<sha corto>',
  p_branch        => '<branch>',
  p_commit_url    => 'https://github.com/owner/repo/commit/<sha>',
  p_causa_raiz    => '<por que paso, no que paso>',
  p_corregido_por => '<usuario> (claude-remote)',
  p_mensaje       => '<subject del commit>'
);

-- 3) commits extra del mismo problema
select github_repo_problemas.agregar_commit(<id>, '<sha>', '<branch>', '<url>', '<mensaje>', '<autor>');

-- lectura
select * from github_repo_problemas.v_problemas order by detectado_en desc;
```

**Avisar en el chat el titulo del problema** al registrarlo y al cerrarlo, no el numero de id
(mismo criterio que Planify).

**Si el problema se detecta pero NO se arregla, queda en `estado='abierto'`.** Ese es el punto:
que quede anotado. Estados: `abierto` | `en_curso` | `corregido` | `no_corregible` | `descartado`.
Para pasar a `corregido` la base exige `correccion` y `corregido_en` cargados (constraint).

**La auditoria no se borra.** El rol `anon` tiene SELECT/INSERT/UPDATE pero NO DELETE ni
TRUNCATE en las tres tablas. Si una fila esta mal, se corrige o se pasa a `descartado`.


## REGLA: claves de Supabase - migrar a las nuevas, NO apagar las legacy todavia

Estado al 2026-09-11. Supabase cambio el sistema de claves. Conviven dos juegos y **los dos
funcionan a la vez**, asi que se migra cliente por cliente sin downtime.

| Sistema | Claves | Se rota de a una |
|---|---|---|
| Nuevo | `sb_publishable_...` (frontend) + `sb_secret_...` (backend) | si |
| Legacy (JWT) | `anon` + `service_role` | NO: las dos derivan del JWT secret del proyecto |

Doc: `supabase.com/docs/guides/getting-started/migrating-to-new-api-keys`. Textual: *"The
legacy anon and service_role keys are based on your project's JWT secret, which makes them
hard to rotate without downtime."* **No existe boton "Roll" para las legacy.**

### 1. Lo filtrado vive en el HISTORIAL de git, y el historial no se arregla

Una `service_role` legacy quedo expuesta en el historial de un repo publico (ver `LOCKS.txt`
de `GestionProductivaEntero`, entrada 2026-09-04). El arbol de trabajo ya esta limpio, pero
eso no alcanza: lo que estuvo en un repo publico pudo clonarlo cualquiera y reescribir el
historial NO lo des-filtra. **El unico arreglo real es invalidar la clave.**

Precision importante: lo que se filtro es la **`service_role` key** (un JWT firmado con el
secret), NO el JWT secret. De un HS256 no se deriva la clave, asi que **apagar las legacy
alcanza** para matar lo filtrado. Rotar el JWT secret es un paso extra, no el obligatorio.

### 2. Como se invalida (y por que todavia no)

Dashboard -> Settings -> API Keys -> pestana **"Legacy anon, service_role API keys"** ->
boton **`Disable JWT-based API keys`**. Apaga `anon` y `service_role` de una sola vez. Es
reversible. Es lo que la doc pide para este caso: *"Make sure you also switch to publishable
and secret API keys and disable the anon and service_role keys."*

**NO apretarlo todavia:** apaga TAMBIEN la `anon`, que es la que usa el frontend. Hoy eso
tira abajo la app entera.

### 3. EXCEPCION MEDIDA: Storage rechaza las claves nuevas al ESCRIBIR

Comprobado en vivo el 2026-09-11 contra los dos proyectos (hrxfctzncixxqmpfhskv y
kwkclwhmoygunqmlegrg). El Storage API de estos proyectos NO entiende el formato nuevo
cuando la operacion escribe:

| Operacion | Clave legacy (JWT) | Clave nueva (`sb_publishable_` / `sb_secret_`) |
|---|---|---|
| `GET /storage/v1/object/...` | anda | anda |
| `POST /storage/v1/object/...` (upload) | anda | **403 `Invalid Compact JWS` / AccessDenied** |
| `POST /rest/v1/rpc/...` (PostgREST) | anda | anda |
| Edge Functions con `verify_jwt` | anda | anda |

`Invalid Compact JWS` = el Storage intento parsear el token como JWT y no pudo. No es la
clave equivocada ni un permiso faltante: el servicio no soporta el formato. Repro exacta:

```sql
select r.status, r.content from public.http((
  'POST','https://<ref>.supabase.co/storage/v1/object/__no_existe__/x.txt',
  array[public.http_header('Authorization','Bearer <clave>')],
  'text/plain','x')::public.http_request) r;
```

**Consecuencia:** cualquier cosa que SUBA a Storage tiene que seguir con la
`service_role` legacy hasta que Supabase actualice el Storage de estos proyectos. Caso
real: el workflow `build-deploy.yml` de `loekemeyer/Planify` sube el `Planify.exe` a
`planify_updates`; al cambiarle el secret `SUPABASE_SERVICE_KEY` por una `sb_secret_`
empezo a fallar el paso "Upload to Supabase Storage" en 2 segundos, con el `.exe` ya
compilado (runs 112, 113 y 114 del 2026-09-11).

**Antes de apagar las legacy, buscar todo lo que escriba en Storage** (`storage/v1/object`
con POST/PUT, `.storage.from(...).upload(`, `.upload(`) y confirmar que ese camino sigue
andando. Si no anda, NO se apagan las legacy todavia.

### Orden obligatorio

1. Contar donde esta escrita la clave legacy en este repo:
   ```
   grep -rl 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' . --exclude-dir=.git | wc -l
   ```
   (Referencia: `GestionProductivaEntero` tenia 66 archivos y 0 con la clave nueva.)
2. Reemplazar esa cadena por la `sb_publishable_...` del proyecto Supabase de ESTE repo
   (cada proyecto tiene la suya; no mezclar).
3. Migrar todo backend que use `service_role` (Edge Functions, n8n, scripts) a `sb_secret_...`.
4. Inventariar lo que escribe en Storage (ver la excepcion de arriba) y dejarlo con la
   `service_role` legacy; si algo de eso ya se paso a `sb_secret_`, volverlo atras.
5. Recien con 1-4 hechos en TODOS los repos que peguen contra ese proyecto:
   `Disable JWT-based API keys`. Mientras exista un upload a Storage vivo, este paso
   queda bloqueado.

### Paso opcional: rotar el JWT secret

Sirve si ademas se sospecha del secret en si. Va en **Settings -> JWT Keys**
(`/dashboard/project/_/settings/jwt`), NO en la pagina de API Keys:

1. `Migrate JWT secret` - importa el secret viejo y crea una clave asimetrica standby. Sin downtime.
2. `Rotate keys` - la standby firma los JWT nuevos. NO desloguea a nadie: los tokens no
   vencidos se siguen aceptando.
3. Revocar el secret legacy, que queda en *Previously used*.

Dos avisos de la doc antes del paso 2:
- *"Make sure your app does not directly rely on the legacy JWT secret. If it's verifying every
  JWT against the legacy JWT secret (using a library like jose, jsonwebtoken or similar),
  continuing with the rotation might break those components."*
- *"If you're using Edge Functions that have the Verify JWT setting, continuing with the
  rotation might break your app. You will need to turn off this setting."*

Cuando revocar: esperar el tiempo de expiracion del access token + 15 min (1 h 15 min si es de
1 h) para no desloguear a nadie; en un incidente activo, revocar de inmediato.

**Al tocar cualquier archivo con una clave de Supabase, dejarlo en el sistema nuevo. Nunca
escribir codigo nuevo con la clave legacy.**

## 🪨 Modo Caveman (SIEMPRE activo)

**Cada conversación abre con caveman activo por defecto.** Responder en modo **caveman**:
frases cortas, directas, mínimas palabras, sin relleno. Solo aplica al **chat** (no al
código, comentarios ni mensajes de commit).

- **`desactiva caveman`** = responder solo el **próximo mensaje** normal/completo, y después **volver solo** a caveman.
- **`caveman desactivacion total`** = apagar caveman por completo (queda desactivado hasta que se reactive).

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

## OC Insumos (Ordenes_Compra) - direccion futura

- **HOY**: las OC se cargan importando el PDF del proveedor desde `StockFlejes/recepcion.html`
  (parser local con pdf.js, sin IA).
- **FUTURO**: las OC van a **generarse directamente desde el sistema** (no se van a importar
  mas desde PDFs de proveedores). O sea, la app va a decidir que comprar en base a stocks
  y consumo, generar la OC internamente, y despues (opcional) mandarsela al proveedor
  ya armada. Al planificar cambios en `Ordenes_Compra` o en el modulo de OC, priorizar
  que el flujo sea limpio para escritura interna (no solo importacion externa).

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
