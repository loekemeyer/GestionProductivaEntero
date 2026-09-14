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

## Secrets que necesita

Se cargan en Supabase: Edge Functions -> Secrets.

| Secret | Para que | De donde sacarlo |
|---|---|---|
| `WA_TOKEN` | Token de Meta para mandar el mensaje | **El mismo de la funcion de Damian**, que lo tiene hardcodeado en su `index.ts`. Se copia de ahi tal cual. |
| `SEND_WA_TOKEN` | Autentica a quien llama la funcion | Mismo valor que `lecturacvs.app_secrets` con `k='SEND_WA_TOKEN'` |

`SUPABASE_SERVICE_ROLE_KEY` lo inyecta Supabase solo, no hay que cargarlo.

Los secrets de Edge Functions son **del proyecto entero**, no de cada funcion: se cargan una
sola vez y los ve cualquier funcion del proyecto. Si alguna vez se rota el token de Meta,
conviene mover tambien a la de Damian a `WA_TOKEN` y borrarle el valor hardcodeado, asi hay
un solo lugar donde cambiarlo.

**Por que aca no va hardcodeado como en la de Damian:** el codigo de ella vive solo en
Supabase, pero esta funcion esta versionada en un repositorio **publico**. Un token de Meta
commiteado ahi queda en el historial de git para siempre, y eso no se arregla borrandolo
despues (ver la seccion de claves de Supabase en el `CLAUDE.md` de la raiz).

La funcion se deploya con `verify_jwt: false` porque `pg_cron` la llama sin header
`Authorization`. Por eso valida con `SEND_WA_TOKEN`: sin eso, cualquiera con la URL podria
dispararle un WhatsApp a Juan. La de Damian no tiene esa proteccion.

El schema `lecturacvs` **no** esta expuesto a PostgREST, asi que la funcion no puede leer
`app_secrets` por su cuenta: el secreto se resuelve en el SQL del cron y viaja en el body,
igual que en los crons `planify_*` y `gv-*` de este mismo proyecto.

## Como se invoca

```jsonc
{ "token": "<SEND_WA_TOKEN>" }                       // hoy, al numero de PRUEBA
{ "token": "...", "fecha": "2026-09-11" }            // un dia anterior, al de PRUEBA
{ "token": "...", "solo_pdf": true }                 // genera y sube el PDF, no manda nada
{ "token": "...", "test": false }                    // hoy, a JUAN
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
        headers := '{"Content-Type":"application/json"}'::jsonb,
        body    := jsonb_build_object(
                     'token', (select v from lecturacvs.app_secrets where k = 'SEND_WA_TOKEN'),
                     'test', false)
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
