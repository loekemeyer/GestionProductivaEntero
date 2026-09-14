# gv-reporte-diario-virgilio

Reporte diario de Logistica Virgilio para Juan, por WhatsApp. Es el espejo de
`reporte-diario-rendimiento` (la de Damian): arma un PDF, lo sube al bucket `reportes` de
Storage y lo manda como header tipo `document` de una plantilla de WhatsApp Cloud API.

| | Damian | Juan |
|---|---|---|
| Edge function | `reporte-diario-rendimiento` | `gv-reporte-diario-virgilio` |
| Datos | `db_n8n_espejo` (Cervantes) | `Registros_Produccion_Virgilio` |
| Contenido | Rendimiento x Matriz | Picking, Armado y Mov por operario |
| Plantilla | `reporte_diario_rend_x_matriz` | `informe_produccion_virgilio` |
| Cron | `0 21 * * *` (18:00 ART) | `0 21 * * *` (18:00 ART) |

## De donde salen los numeros

**No hay una segunda implementacion del calculo.** Al deployar se sube, junto al
`index.ts`, una copia de `Produccion/InformesVirgilio/calculo.js` con **una** linea agregada
al final:

```js
export { procesar, CONFIG };
```

Esa linea no puede vivir en el archivo del repo porque ahi se carga como `<script>` comun
del navegador y `export` seria un error de sintaxis. Fuera de eso el archivo va tal cual,
para que el PDF y la pantalla de Informes Virgilio no puedan dar distinto.

> **Si alguien edita `calculo.js`, hay que redeployar esta funcion.** Si no, el PDF que
> recibe Juan y lo que se ve en pantalla se separan sin que nadie se entere.

## Secrets: no hay que cargar ninguno

Los dos valores que usa ya existen en la base y los resuelve el SQL del que la llama, que es
como funcionan los crons `gv-ppp-web-tandas-diarias`, `gv-geocodificar` y
`gv-sync-padron-direcciones` de este mismo proyecto.

| Valor | Que es | Como viaja |
|---|---|---|
| service_role | Autentica al que llama | Header `Authorization: Bearer <service_role>`. La funcion se deploya con **`verify_jwt = true`**, asi que valida Supabase antes de que corra una linea de codigo. El cron lo saca de `lecturacvs.app_secrets`. |
| `wa_token` | Token de Meta para mandar el mensaje | En el body. `lecturacvs.app_secrets`, el mismo token que usa la funcion de Damian. |

El schema `lecturacvs` **no** esta expuesto a PostgREST, asi que la funcion no puede leer
`app_secrets` por su cuenta: por eso los valores los resuelve el SQL del cron.

**Por que verify_jwt y no un token propio:** se probo comparar un token del body contra
`SUPABASE_SERVICE_ROLE_KEY` y contra `SEND_WA_TOKEN`, y ninguno de los dos valores guardados
en `app_secrets` coincidia con lo que Supabase inyecta en la funcion (401 con los dos).
Comparar a mano contra una clave que no se controla es fragil; `verify_jwt` no tiene ese
problema y ademas es el mecanismo que ya usan los demas crons `gv-*`.

**Por que el token de Meta no va hardcodeado como en la de Damian:** el codigo de ella vive
solo en Supabase, pero esta funcion esta versionada en un repositorio **publico**. Un token
commiteado ahi queda en el historial de git para siempre, y eso no se arregla borrandolo
despues (ver la seccion de claves de Supabase en el `CLAUDE.md` de la raiz).

Comparado con la de Damian, que va con `verify_jwt: false` y sin ninguna validacion: hoy
cualquiera que sepa su URL puede dispararle un WhatsApp. Esta no.

## Como se invoca

Siempre con el header `Authorization: Bearer <service_role>`.

```jsonc
{ "wa_token": "..." }                        // hoy, al numero de PRUEBA
{ "wa_token": "...", "fecha": "2026-09-08" } // un dia anterior, al de PRUEBA
{ "solo_pdf": true }                         // sube el PDF y no manda nada
{ "wa_token": "...", "test": false }         // hoy, a JUAN
```

**Manda a Juan solo con `"test": false` explicito.** El default es el numero de prueba, para
que no se escape un envio mientras se configura.

## El cron

No crearlo hasta que la plantilla este aprobada por Meta y la prueba salga bien.

```sql
select cron.schedule(
  'gv-reporte-diario-virgilio-18hs',
  '0 21 * * *',                                  -- 18:00 en Argentina
  $$
  do $do$
  declare cnt int;
  begin
    -- Igual que el de Damian: no dispara si no hubo actividad en el dia.
    select count(*) into cnt
    from public."Registros_Produccion_Virgilio"
    where (ts_cliente at time zone 'America/Argentina/Buenos_Aires')::date
          = (now() at time zone 'America/Argentina/Buenos_Aires')::date;
    if cnt > 0 then
      perform net.http_post(
        url     := 'https://hrxfctzncixxqmpfhskv.supabase.co/functions/v1/gv-reporte-diario-virgilio',
        headers := jsonb_build_object(
                     'Content-Type',  'application/json',
                     'Authorization', 'Bearer ' || (select v from lecturacvs.app_secrets
                                                    where k = 'SUPABASE_SERVICE_ROLE_KEY')),
        body    := jsonb_build_object(
                     'wa_token', (select v from lecturacvs.app_secrets
                                  where k = '<la clave que guarda el token de Meta>'),
                     'test',     false)
      );
    end if;
  end
  $do$;
  $$
);
```

El bucket `reportes` ya se limpia solo: el cron `limpiar-reportes-viejos` borra los PDF de
mas de 3 dias.

## Destinatarios

| | Numero |
|---|---|
| Juan (produccion) | 5491126161913 |
| Pruebas | 5491156517686 |
