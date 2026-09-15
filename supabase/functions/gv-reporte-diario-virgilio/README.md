# gv-reporte-diario-virgilio

Reporte diario de Logistica Virgilio: arma un PDF, lo sube al bucket `reportes` y lo manda
por WhatsApp como documento adjunto.

## calculo.js NO se edita aca

`calculo.js` de esta carpeta es **generado**. La fuente unica es
`Produccion/InformesVirgilio/calculo.js`, que es el archivo que carga la pagina; la copia de
la funcion es esa misma fuente mas una linea (`export { procesar, CONFIG };`), porque la
pagina la carga con `<script src>` y no puede llevar `export`.

```bash
./scripts/sync-calculo-virgilio.sh          # regenera la copia
./scripts/sync-calculo-virgilio.sh --check  # falla si divergieron (corre en el CI)
```

**Por que existe la regla.** El 15/09/2026 las dos copias ya habian divergido: la pagina
contaba el legajo 0 (`Thomas Loke(TESTING)`, 775 registros en 58 dias) y el 600
(entrevistas), que la funcion excluia a proposito. Mismo dato, dos numeros distintos segun
por donde se mirara. El `--check` del workflow existe para que no vuelva a pasar.

## Como se deploya (sin CLI y sin token)

Lo que se publica en Supabase **no es este `index.ts`**: es un arranque de tres lineas.

```ts
// SHA 0dd0b37 - 15/09/2026
import "https://raw.githubusercontent.com/loekemeyer/GestionProductivaEntero/0dd0b37/supabase/functions/gv-reporte-diario-virgilio/index.ts";
```

El bundler de Deno se baja ese `index.ts` y el `calculo.js` de al lado -el import relativo
resuelve contra la misma URL- y los deja **adentro** del bundle. En runtime la funcion no
depende de GitHub: es la misma clase de dependencia que ya tenia con `esm.sh` por jspdf.

**Por que asi.** La API de deploy recibe el contenido de cada archivo inline y reemplaza el
bundle entero. Cambiar dos lineas obligaba a re-emitir 68 KB a mano, las 985 lineas del
motor de calculo incluidas: la forma mas facil de meter un error silencioso en numeros de
produccion. Con el arranque, publicar un cambio son tres lineas y otro SHA.

**Con el SHA clavado la URL es inmutable**, asi que nadie puede cambiar el codigo por
debajo, y en el Dashboard queda escrito que version esta corriendo.

> **OJO:** commitear NO publica nada. Si cambias este archivo o `calculo.js`, hay que
> redeployar el arranque con el SHA nuevo o en Supabase sigue corriendo la version vieja.


## Autenticacion

`verify_jwt = true` **no alcanza**: la clave `sb_publishable_...` esta escrita en todas las
paginas del sistema, es publica por diseno y pasa el gateway. Medido el 15/09: con esa clave
sola se obtenia el reporte nominal completo.

Por eso la funcion exige ademas `REPORTES_TRIGGER_TOKEN`, que sale de
`lecturacvs.server_secrets` a traves de la RPC `public.server_secret` (SECURITY DEFINER, solo
`service_role`). Sin ese token contesta 401 y no genera ni sube nada.

```jsonc
// body
{ "token": "<REPORTES_TRIGGER_TOKEN>", "test": false }   // a Juan
{ "token": "...", "solo_pdf": true }                      // sube el PDF, no manda WhatsApp
```

## El PDF va con URL firmada

El PDF lleva nombre y apellido, horas y m3 de cada operario. Se sirve con
`createSignedUrl` a 3 dias (lo mismo que retiene el cron `limpiar-reportes-viejos`), no con
`getPublicUrl`. Meta acepta la URL firmada y WhatsApp **adjunta el archivo** al mensaje, asi
que al destinatario no se le vence nada.

## Secretos

Ninguno vive en el codigo. Todos en `lecturacvs.server_secrets`:

| clave | para que |
|---|---|
| `REPORTES_TRIGGER_TOKEN` | autoriza la invocacion |
| `REPORTES_WA_TOKEN` | token de Meta (app "Reporte Produccion Cervantes") |
| `REPORTES_WA_PHONE_ID` | Phone Number ID emisor |
