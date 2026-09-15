# gv-reporte-diario-virgilio

Reporte diario de Logistica Virgilio para Juan, por WhatsApp. Es el espejo de
`reporte-diario-rendimiento` (la de Damian): arma un PDF, lo sube al bucket `reportes` de
Storage y lo manda como header tipo `document` de una plantilla de WhatsApp Cloud API.

| | Damian | Juan |
|---|---|---|
| Edge function | `reporte-diario-rendimiento` | `gv-reporte-diario-virgilio` |
| Datos | `db_n8n_espejo` (Cervantes) | `Registros_Produccion_Virgilio` |
| Contenido | Rendimiento x Matriz | Picking, Armado, Mov y S/Reg. por operario |
| Plantilla | `reporte_diario_rend_x_matriz` | `informe_produccion_virgilio` |
| Cron | `0 21 * * *` (18:00 ART) | `0 21 * * *` (18:00 ART) |

## Las columnas del PDF

| Columna | Que es |
|---|---|
| M3 x Hs Pick / Arm | Metros cubicos por hora. No es un tiempo: va con coma decimal. |
| Hs Pick / Arm | Tiempo neto de picking y de armado. |
| Hs Mov | Todo lo demas que SI quedo registrado: Carga Camion, Control Remitos, Recepciones, Gondola, Conteo, Timbre, Bano, Almuerzo, Limpieza y Permiso. Sale de `totHs - pickHs - armHs`. |
| Hs S/Reg. | Lo que NO quedo registrado dentro de la jornada de 08:00 a 17:00: `CONFIG.jornadaHs - totHs`. Suma llegar tarde, irse temprano y los baches del medio, todo junto. Con un rango son 9 hs por cada dia que la persona registro algo; los dias que no vino no se le cuentan. |
| Dias | Solo en el bloque "Total del periodo". Dias en que la persona registro algo, no dias habiles del rango. |

**Ojo con los M3 x Hs de los bloques por dia:** una tanda que se abre un dia y se cierra
al siguiente lleva su m3 a los dos, porque `reportes` agrupa por (fecha, legajo) y ahi no
hay forma de partir el volumen. `porPersona` -el bloque del total- si deduplica por tanda.
Por eso los dias no suman el total, y el pie del PDF lo dice.

`calculo.js` recorta cada segmento a la ventana 08:00-17:00, asi que `totHs` nunca pasa de 9
y S/Reg. no da negativo aunque alguien siga trabajando despues de hora. Y como Mov es el
resto del total, **cada fila cierra en 9:00**: `Pick + Arm + Mov + S/Reg. = 9:00`. Eso hace
de control: si una fila no da 9:00, hay un bug.

Un cero siempre se muestra como `-`.

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
| `wa_token` | Token de Meta para mandar el mensaje | En el body. Sale de `lecturacvs.app_secrets` con `k='RECRUIT_WA_TOKEN'` (confirmado por Elias: es el mismo token de Meta que usa la funcion de Damian, aunque la clave se llame RECRUIT por el flujo para el que se cargo primero). |

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

// Rango de fechas. Con mas de un dia el PDF lleva UN BLOQUE POR DIA, uno abajo del
// otro en la misma hoja (salta de pagina solo cuando el bloque entero no entra), y
// cierra con un bloque "Total del periodo" que ahi si trae la columna Dias, porque
// cada fila cierra en 9:00 por dia trabajado. El PDF de un solo dia queda igual que
// siempre: un bloque sin subtitulo, con el alto de fila elastico de antes.
{ "solo_pdf": true, "desde": "2026-09-08", "hasta": "2026-09-14" }

// Auditoria de m3: devuelve, tanda por tanda, las horas trabajadas y si esa tanda
// tiene m3 en alguna de las tres fuentes. Las de m3 = 0 son las que hunden el ratio
// M3 x Hs sin que se vea, porque las horas si se cuentan. No arma ni sube ningun PDF.
{ "diag": true, "desde": "2026-09-08", "hasta": "2026-09-14" }
```

**Manda a Juan solo con `"test": false` explicito.** El default es el numero de prueba, para
que no se escape un envio mientras se configura.

## El cron

Probado el 14/09: `{"fecha":"2026-09-08"}` al numero de prueba devolvio
`enviados: 1, ok: true, intentos: 1` sobre 1854 eventos y 4 operarios.

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
                                  where k = 'RECRUIT_WA_TOKEN'),
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
