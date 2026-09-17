# Traspaso — auditoría de secretos y reportes (15–17/09/2026)

**Para quién:** la sesión de Claude que continúe este trabajo, sin contexto previo.
**Quién pidió:** Elías Irace (Planify `employee_id` 1). No es Thomas: Thomas Loekemeyer es el
dueño y NO usa Planify (sus tareas van al de Tomás Beviglia, 20, con prefijo `Th `).
**Proyecto Supabase:** `hrxfctzncixxqmpfhskv` (Gestión Virgilio). Es **uno solo** y contiene los
schemas `public` (gestión), `planify`, `lecturacvs` y `github_repo_problemas`.

## 0. Antes de tocar nada

Leé el `CLAUDE.md` de este repo. Lo que más se olvida:

- **LOCKS.txt**: registrar `LockX` ANTES de cualquier Edit/Write, liberarlo después y dejar
  línea en `[HISTORIAL]` (máximo 10).
- **Auditoría**: todo problema de código ya pusheado que andaba mal se registra en
  `github_repo_problemas` (`registrar_problema` / `cerrar_problema` / `agregar_commit`).
  Se avisa el **título**, nunca el id.
- **Planify**: cada pedido de trabajo se registra como tarea. Se avisa el **nombre**, no el id.
- **Nunca** INSERT/UPDATE/DELETE sin un sí explícito en ese mismo momento, mostrando el SQL y
  el impacto en cadena. La palabra **"espera" cancela la autorización anterior**; no se retoma
  sola. Después de escribir, verificar con un SELECT.
- **No pegar claves nuevas en el chat.** Si hay que cargar un secreto, se le da a Elías el SQL
  para que lo corra él en el editor de Supabase.

## 1. Lo que quedó terminado y verificado

### Reportes diarios por WhatsApp (Gestión)

Dos funciones mandan un PDF **nominal** (nombre, apellido, horas y rendimiento por operario):

| función | qué manda | cron |
|---|---|---|
| `reporte-diario-rendimiento` | rendimiento por matriz (Cervantes) | jobid 2, 18:00 AR |
| `gv-reporte-diario-virgilio` | logística Virgilio | ninguno todavía |

Lo que se arregló, todo medido:

1. **URL firmada** — pasaban de `getPublicUrl` a `createSignedUrl` de 3 días (misma retención
   que el cron `limpiar-reportes-viejos`). WhatsApp **adjunta el archivo** al mensaje, así que
   al destinatario no se le vence nada.
2. **Bucket `reportes` ahora es PRIVADO.** Verificado: la URL pública da `400 Bucket not found`
   y la cadena completa sigue enviando.
3. **Token de invocación propio** (`REPORTES_TRIGGER_TOKEN`). Antes cualquiera con la URL hacía
   un POST y el body le devolvía el PDF. Medido: sin token **401**, con token 200.
4. **Secretos fuera del código** → tabla nueva `lecturacvs.server_secrets`.
5. **Token de Meta rotado y el viejo revocado.** Verificado contra Meta: el viejo da
   `is_valid: false`.

Corrida real del 15/09 18:00: **200, enviados 3/3**, URL firmada. Sin intervención.

### Otras dos funciones de WhatsApp

`send-whatsapp` (v53) y `send-rendimiento-matrices` (v44): tenían el mismo token hardcodeado y
**quedaron rotas al revocarlo**. Arregladas, leen de `server_secrets`.

Además `send-whatsapp` **era un relay abierto**: aceptaba `destinatario`/`destinatarios` desde
el body y su única protección era `verify_jwt=true`, que no protege nada. Cualquiera con la
clave pública podía mandar un mensaje con texto arbitrario, a cualquier teléfono, desde el
número verificado de la empresa. Los destinos ahora viven solo en el servidor; si alguien manda
esos campos, contesta **400** explicando qué usar.

### InformesVirgilio

`calculo.js` existía dos veces (la página y el bundle de la Edge Function) y **habían
divergido**: la página contaba el legajo 0 (`Thomas Loke(TESTING)`, 775 registros en 58 días) y
el 600 (entrevistas). Emparejado, más el legajo 1 (`Pruebas`), que salía como operario fantasma.

Ahora la copia de la función **se genera** con `scripts/sync-calculo-virgilio.sh`, y el workflow
`.github/workflows/deploy-edge-functions.yml` corre `--check` antes de publicar. No pueden
volver a divergir en silencio.

### Problemas cerrados

`147`, `229`, `242`, `254`, `296`. Tarea Planify **«Sacar el WA_TOKEN del codigo y firmar las
URL de reportes»** cerrada.

## 2. Lo que se está haciendo, y por qué

Tarea abierta: **«Sacar el servidor de LecturaCVs de adentro del .exe»** (Planify id 3458).

### El problema

El `.exe` de Planify trae adentro un **servidor Next completo** (LecturaCVs) que corre en la PC
del usuario. Al abrir el módulo de Reclutamiento, `recruiting-server.js` llama a la RPC
`lecturacvs.planify_recruiting_config(p_token)` y **inyecta el payload entero como environment
del proceso hijo** (`...secrets`, línea ~190).

Ese payload son **26 claves**, entre ellas:

| clave | qué abre |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | la base de Gestión entera, salteando RLS |
| `PLANIFY_SUPABASE_SERVICE_ROLE_KEY` | la base de Planify — sueldos, sanciones, chat |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | gasto ilimitado |
| `GOOGLE_CLIENT_SECRET`, `GMAIL_APP_PASSWORD`, `ADMIN_PANEL_PASSWORD`, `RECRUIT_WA_TOKEN` | … |

El `__bootstrap_token__` que abre esa RPC está **en texto plano en el código**:
`recruiting-server.js:30` y `admin-gate.js:11`. Verificado sobre **Planify v1.0.66**.

### Por qué NO se recorta el payload

Se midió: LecturaCVs usa de verdad esas claves. `lib/supabase.ts` y `lib/planify.ts` **crean los
clientes de base con `service_role`**, o sea que toda la capa de datos corre en modo dios.
Sacar una clave rompe la app.

### Por qué NO se vuelve a Vercel

LecturaCVs estuvo hosteado en Vercel y se unificó dentro de Planify **a propósito**: para que
quede cerca del admin que usa RRHH. Centralización. Volver rompe eso. Descartado por Elías.

### El camino elegido

Dejar la UI donde está y **dejar de usar `service_role`**: clave pública + sesión de usuario +
RLS. Es la forma idiomática de Supabase y el cambio de código es **un archivo**, no 46 llamadas.

| pieza | hoy | propuesto |
|---|---|---|
| Login | OTP casero en `lib/auth.ts` | **Supabase Auth con OTP por mail** (nativo) |
| `lib/supabase.ts` | cliente con `service_role` | clave pública + token del usuario |
| Permisos | ninguno | políticas RLS sobre 15 tablas de `lecturacvs` |
| `lib/planify.ts` | `service_role` cruzado | 12 RPC `security definer` |

**Superficie medida:** 18 archivos usan `supabaseAdmin()`, ~46 llamadas, 15 tablas
(`bot_sessions` 15, `interviews` 10, `candidates` 9, `app_settings` 9, `searches` 6…).
`lib/bot.ts` solo tiene 19 llamadas. `lib/planify.ts` ya es una API acotada de 12 funciones
sobre 4 tablas (`employees`, `tasks`, `whatsapp_pending`, `task_lists`).

Etapa 2, después: las API keys de IA, Google y Gmail salen por Edge Function.

## 3. Lo que falta, por gravedad

| # | problema | estado |
|---|---|---|
| 145 | `planify_whatsapp-webhook` no valida la firma de Meta: cualquiera manda WhatsApp desde el número de la empresa | **abierto, crítico** |
| 173 | `planify_get_update_url` entrega el `.exe` sin credencial, y el `.exe` lleva el bootstrap token | **abierto, crítico** |
| 207 | Planify no valida contraseñas: el RPC de login declara `p_password` y nunca lo usa | **abierto, crítico** |
| 208 | RLS de Planify no protege nada: políticas `USING (true)` para PUBLIC sobre sueldos | **abierto, crítico** |
| 20 | Credenciales de terceros en 11 Edge Functions (GV y LK) | **abierto, alto** — ya se arreglaron las 4 de WhatsApp de GV; faltan la key de OpenAI en `leer-factura` y `leer-produccion-foto`, y las 6 de LK |

Tareas Planify abiertas: **«Sacar el servidor de LecturaCVs de adentro del .exe»**, **«Rotar 14
claves expuestas por el .exe de Planify»**, **«Th Rescatar las 11 Edge Functions sin fuente»**.

**Ojo con el orden:** rotar las 14 claves ANTES de sacar el servidor del `.exe` no sirve — la
próxima ejecución se baja las nuevas. Primero la arquitectura, después la rotación. Elías ya lo
confirmó: *"1 si y despues rotarlas"*.

## 4. Trampas medidas (leer antes de tocar Edge Functions)

Esto costó un incidente cada una. No son teoría.

1. **`verify_jwt=true` NO es autenticación.** La clave `sb_publishable_…` está escrita en todas
   las páginas del sistema, es pública por diseño y pasa el gateway. Medido: con esa clave sola
   se obtenía el reporte nominal completo. Si una función devuelve datos de personas, necesita
   **su propio token** además.

2. **Un secret de Edge Function le gana a la base y es invisible desde SQL.** Al rotar el token
   de Meta, `gv-reporte-diario-virgilio` siguió agarrando el `WA_TOKEN` cargado como secret —ya
   muerto— porque `Deno.env.get()` estaba primero en el `||`. Contestaba `Authentication Error`
   con cero enviados. **Poner siempre `server_secrets` primero** y el secret de la función
   último. No hay forma de auditar esos secrets desde SQL.

3. **Un deploy reemplaza el bundle entero**, no conserva archivos que no mandes. Pero si falta
   una dependencia relativa **falla al bundlear y deja viva la versión anterior**: una emisión
   incompleta no puede romper una función.

4. **Se puede deployar sin CLI ni token de Supabase**, con un arranque de 3 líneas:

   ```ts
   // SHA clavado a propósito: la URL es inmutable y queda escrito qué versión corre.
   import "https://raw.githubusercontent.com/loekemeyer/GestionProductivaEntero/<SHA>/supabase/functions/<slug>/index.ts";
   ```

   El bundler de Deno baja ese archivo **y sus imports relativos** al deployar y los mete
   adentro del bundle; en runtime no depende de GitHub. Así se evita re-tipear 68 KB a mano.
   **Commitear no publica nada**: hay que redeployar el arranque con el SHA nuevo.
   Ver `supabase/functions/gv-reporte-diario-virgilio/README.md`.

5. **`net.http_post` es asíncrono.** `cron.job_run_details` marca `succeeded` por encolar, nunca
   ve el status HTTP de la función. Para saber si anduvo hay que leer `net._http_response`. Y
   **un timeout de pg_net no cancela el pedido**: la función corre igual (me mandó un reporte a
   dos personas de producción por bajar el timeout a 5 ms creyendo que así no se ejecutaba).

6. **"Success. No rows returned" en el editor SQL no dice si tocó filas.** Un UPDATE con guarda
   que no matchea muestra exactamente lo mismo que uno que sí. **Usar siempre `returning`** o
   una CTE que devuelva `filas_escritas`.

7. **El App Secret de Meta no es el access token.** El App Secret son 32 caracteres hex y sale
   de Configuración de la app → Básica. El token de envío arranca con `EAA`, mide ~200 y sale de
   **business.facebook.com → Configuración del negocio → Usuarios → Usuarios del sistema**.
   Rotar el App Secret **no invalida** los access tokens.

8. **"Revocar tokens" en un system user es todo o nada**: se lleva el viejo y el nuevo. La
   secuencia correcta es revocar → generar → cargar → verificar.

9. **`CREATE TABLE AS` no hereda RLS.** Ya está documentado en el `CLAUDE.md`, pero se repite
   porque costó 56 sueldos legibles durante 24 horas.

## 5. Identificadores útiles

**`lecturacvs.server_secrets`** (tabla nueva, RLS on, 0 políticas, solo `service_role`). Se lee
con la RPC `public.server_secret(p_k)`, `SECURITY DEFINER`, ejecutable solo por `service_role`.
A diferencia de `app_secrets`, **nunca** se expone por `planify_recruiting_config`.

| clave | para qué |
|---|---|
| `REPORTES_WA_TOKEN` | token de Meta, app "Reporte Produccion Cervantes" (App ID `1441069790941003`) |
| `REPORTES_WA_PHONE_ID` | `918089688061759` — número `+54 9 11 6864-8618` |
| `REPORTES_TRIGGER_TOKEN` | autoriza invocar las dos funciones de reporte |
| `REPORTES_WA_DEST_PROD` / `_TEST` | destinatarios, JSON array. Cambiar acá, sin redeploy |

**Apps de Meta y system users** (medido con `debug_token`):

| app | App ID | system user | token |
|---|---|---|---|
| Reporte Produccion Cervantes | `1441069790941003` | `n8n-system` | `REPORTES_WA_TOKEN` |
| LecturaCVs Reclutamiento | `1491460245634515` | `LecturaCvs Bot` | `RECRUIT_WA_TOKEN` (en `app_secrets`) |

`Gestopclientes-Bot` es un tercer system user que no corresponde a ningún token nuestro: está
sin identificar.

**Repos** (los tres se clonan con `add_repo`):
`loekemeyer/GestionProductivaEntero` (principal), `loekemeyer/Planify`,
`loekemeyer/LecturaCVs`. Los últimos dos son privados.

**Sin fuente en ningún repo:** `planify_send-wa`, `planify_recorrido-poli-preguntar`,
`planify_notificar-reprog`. No se pueden descargar (les falta `ezbr_sha256`) y tampoco están en
el repo de Planify. Para tocarlas hay que reescribirlas.

## 6. Decisiones abiertas de Elías

1. **¿Se va por Supabase Auth + RLS** para sacar las dos `service_role` del payload?
2. **¿Quién tiene que poder entrar a Reclutamiento** — solo RRHH (Angely Asuaje), o cualquier
   empleado con mail de la empresa? De eso dependen las políticas RLS.
3. **¿O el rol de base acotado** como contención rápida? Es peor —la clave sigue en la PC— pero
   se hace en el día.

## 7. Contradicción a corregir cuando se toque el archivo

`Planify/recruiting-server.js` se contradice solo: en la línea ~40 dice *"Gate de acceso ACTIVO…
NO se setea `RECRUIT_NO_AUTH`"* y en la ~197 setea **`RECRUIT_NO_AUTH: '1'`**. El login está
apagado y la documentación del propio archivo dice lo contrario. Hosteado, eso deja el módulo
abierto en internet.

Y en `LecturaCVs/lib/auth.ts` hay dos **fallas abiertas**: `authRequired()` devuelve `false` si
faltan las credenciales de mail, y `verifySessionToken()` devuelve `true` si no hay secreto de
firma. Además `AUTH_SECRET` cae por defecto a `GMAIL_APP_PASSWORD`.

## 8. Barrido final — lo que estaba SOLO en el chat

Antes de cerrar se revisó qué existía únicamente dicho en la conversación. Estos cinco pasaron
a la auditoría (todos **abiertos**, ninguno arreglado):

| problema | por qué importa |
|---|---|
| `admin-gate.js` recibe `ADMIN_PANEL_PASSWORD` en el cliente y compara la contraseña ahí | quien tiene el `.exe` tiene la contraseña del panel |
| El login de LecturaCVs falla **ABIERTO** por dos caminos, y firma con la clave del mail | una variable mal cargada deja Reclutamiento sin candado |
| Un archivo `recruiting.env` al lado del `.exe` pisa **TODOS** los secretos de Supabase | quien escriba un archivo ahí redirige las credenciales |
| `planify_recruiting_config` usa **lista negra**: cada secreto nuevo queda expuesto por defecto | el default es exponer; debería ser lista blanca |
| `OPENAI_API_KEY` quedó con el texto `PEGAR_ACA_LA_NUEVA` en vez de una clave | la transcripción de notas de voz no puede funcionar |

### El de OPENAI es el que más urge

`lecturacvs.app_secrets.OPENAI_API_KEY` vale literalmente `PEGAR_ACA_LA_NUEVA`, 18 caracteres.
Salió de un SQL con placeholder que se corrió sin reemplazar, en una sesión anterior — el UPDATE
no tenía guarda. **De ahí viene la costumbre de usar siempre `returning` y una guarda tipo
`and length(t) > 150`.** La `ANTHROPIC_API_KEY` de al lado sí es real.

### Cosas menores, no registradas como problema

- **`Gestopclientes-Bot`**: tercer system user de Meta que no corresponde a ningún token nuestro.
  O lo usa algo fuera de estos repos, o quedó huérfano. Un clic en "Activos asignados" lo aclara.
- **`n8n-system` tiene acceso a la cuenta de WhatsApp "Loekemeyer Selección"** y no lo necesita
  (n8n no se usa, confirmado por Elías). Es permiso de más; se saca con el tachito.
- **El número `+54 9 11 6864-8618` tiene `name_status: DECLINED`** — Meta rechazó el nombre para
  mostrar "N8N Loekemeyer". Los mensajes salen igual, calidad **GREEN**. No afecta nada hoy.
- **Existe `__bootstrap_token_next__`** en `app_secrets` (arranca `rec_2e`), creado en una sesión
  anterior para rotar el bootstrap token. La RPC acepta los dos. El `.exe` sigue usando el viejo
  (`rec_49`). Decidir: usarlo en el próximo release o borrarlo, pero no dejar dos vivos.

### Estado de la sesión al cerrar

- **Nada sin commitear ni sin pushear** en los tres repos.
- **Ningún recordatorio ni cron de Claude armado** — no queda nada esperando en una sesión muerta.
- **Los tres repos se clonaron y se leyeron, nada más.** Cero escrituras en Planify y LecturaCVs.
  Lo único que se escribió en la base de Planify fueron filas de `planify.tasks`.

### Cómo repetir este barrido

```bash
git -C <repo> status --porcelain           # nada sin commitear
git -C <repo> rev-list --count origin/main..HEAD   # nada sin pushear
```

```sql
-- problemas abiertos, por gravedad
select id, severidad, titulo from github_repo_problemas.v_problemas
 where estado in ('abierto','en_curso')
 order by array_position(array['critico','alto','medio','bajo']::text[], severidad), id;

-- tareas abiertas de Elias
select id, name, date from planify.tasks where employee_id = 1 and not done order by id desc;
```

Y en el chat: `list_triggers` para confirmar que no quedó ningún recordatorio armado.
