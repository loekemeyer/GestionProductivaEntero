# Phase 5: App Electron Portable (piloto admins) - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Empaquetar el sistema web actual (HTML/JS vanilla + Supabase) como `.exe`
portable de Windows para 2 administrativos. La app envuelve los modulos
**piloto**: PS, Talleristas, Prov Art Terminado, Stocks, Produccion **e
Informes** (6 grupos). Login Supabase como hoy. Impresion de remitos/facturas
operativa. La carpeta web original (`Z:\AA IT\Gestion Productiva (4)\
Gestion Productiva (3)\...\Gestion Productiva\`) NO se modifica — el codigo
se copia a `Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\`
y se empaqueta desde alli con `electron-builder` target portable.

Build temporal en `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\`
y se borra al finalizar el phase.

</domain>

<decisions>
## Implementation Decisions

### Modulos piloto (6 grupos)
- **D-01:** Modulos piloto incluidos: **PS** (Prov Serv: Entregas, Envios,
  Control), **Talleristas** (Recepcion Cervantes/Virgilio, Envios, Control,
  Proporciones, ABM Articulos), **Prov Art Terminado** (Entregas, Envios,
  Control), **Stocks** (StockFlejes incl. flejes/cajas/cartones/plasticos/
  recepcion, StockSP, StockSC, StockMovimiento, StockTransitoPS, Stocks
  General), **Produccion** (maestro, tiempos, abm, monitor, monitor2,
  RegistroApp), e **Informes**.
- **D-02:** Modulos NO-piloto (Compras, Facturas, Verificacion, VerifMadres,
  Despiece, Despiece x Articulo, Disruptivas, Alertas, Preavisos, Ventas
  Chat) quedan **fuera** del piloto.

### Menu Inicio: tratamiento de no-piloto
- **D-03:** Modulos no-piloto se muestran **visibles pero deshabilitados**
  (gris no clickeable + tooltip "No disponible en piloto"). Mantiene paridad
  visual con la web y deja claro que el alcance es piloto.
- **D-04:** Implementacion: **forkear `Inicio/index.html`** dentro del
  portable (`Gestion Productiva Portable\Inicio\index.html`). Agregar clase
  CSS `disabled` a los botones no-piloto + tooltip. La carpeta web original
  NO se modifica.
- **D-05:** No hay modo "shortcut oculto" para acceder a no-piloto. Si un
  admin necesita un modulo no-piloto, abre la web original en navegador.

### Origen del codigo (Claude's Discretion — defaults)
- **D-06 [discretion]:** **Snapshot** del codigo en build time, embebido en
  el `.exe`. La app es autocontenida y no depende de `\\loeke-svr` para
  cargar el HTML/JS. Razones:
    1. Confiabilidad: si la red compartida cae, la app sigue abriendo.
    2. Portabilidad: el `.exe` corre desde un USB si hace falta.
    3. Versionado: el snapshot del codigo queda atado al `.exe` distribuido.
  - Trade-off: cada cambio en la web requiere rebuild + redistribucion del
    `.exe`. Para 2 admins esto es manejable.
  - Datos siguen viviendo en Supabase + `\\loeke-svr` (Excel compartidos),
    se accede en runtime — solo el codigo es snapshot.

### Impresion remitos/facturas (Claude's Discretion — defaults)
- **D-07 [discretion]:** **Dialog del sistema** cada vez que se imprime
  (default Electron `BrowserWindow.print()` con `silent: false`). Admin
  elige impresora, cantidad de copias, etc. Mas seguro que silenciosa para
  un piloto.
  - Si en uso real piden silenciosa a impresora default → cambio menor en
    proximos plans, no requiere re-arquitectura.

### Acceso filesystem nativo / IPC (Claude's Discretion — defaults)
- **D-08 [discretion]:** **IPC minimo** en este piloto. Solo se expone:
    1. API de impresion (Electron native).
    2. Persistencia de sesion (sessionStorage / app.getPath('userData')).
    3. Apertura de URLs externas en navegador default (Supabase Studio,
       links a la web original para modulos no-piloto).
  - **NO se expone** en este piloto: lectura/escritura de Excel local via
    `exceljs`, ejecucion de `envios_excel.py` via `child_process`,
    invocacion de Excel COM para correr `MACRO_ENTREGAS_SUPABASE.bas`,
    acceso directo a `\\loeke-svr` desde renderer. Estos quedan **deferred**
    (ver seccion al final).
  - Razon: los modulos piloto en la web actual **no usan** estas funciones
    en el flujo administrativo principal. Excel/macro/python son flujos
    paralelos que los admins pueden seguir usando desde Excel directo. Si
    surge necesidad concreta, se evalua phase aparte.

### Login y sesion
- **D-09:** Login Supabase **igual que la web** — `login.html` reusado tal
  cual. `sessionStorage.gp_auth = "ok"` se mantiene durante la corrida del
  `.exe`. Se limpia al cerrar la app (no persiste entre runs).
- **D-10:** Sin biometria en desktop (la actual `login.html` ya filtra
  biometria por `isMobile` — desktop nunca la mostraba).

### Configuracion app
- **D-11 [discretion]:** Datos de configuracion app (si surgen) viven en
  `app.getPath('userData')` (= `%APPDATA%\GestionProductivaPortable\`),
  NO junto al `.exe`. Es portable en el sentido "no requiere instalador",
  pero no portable estilo USB-pluggable. Trade-off aceptado para 2 admins
  que corren siempre desde sus PCs.

### Distribucion y updates
- **D-12:** **Sin auto-update** en este piloto. Cuando hay version nueva,
  Logistica1 copia el `.exe` nuevo a `Z:\AA IT\Gestion Productiva (4)\
  Gestion Productiva Portable\` y avisa a los admins via WhatsApp. Solo 2
  admins, copia manual es suficiente.
- **D-13:** Sin firmar digitalmente el `.exe` en este piloto (Windows
  SmartScreen va a alertar la primera vez — admins aprenden a aceptar).

### Branding
- **D-14:** Sin branding personalizado (icono custom, splash, nombre de
  ventana especifico). Defaults de `electron-builder`. Se evalua despues
  del piloto.

### Build temporal y limpieza
- **D-15:** Todo el trabajo de build (instalacion de `electron`/
  `electron-builder`, `node_modules` pesados, archivos intermedios) ocurre
  en `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\`. La
  carpeta `Gestion Productiva Portable\` **solo** recibe el `.exe`
  resultante (y opcionalmente `package.json`/`assets/` si son necesarios
  en runtime).
- **D-16:** Al finalizar Phase 5 (success criteria validados), borrar
  `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\`.

### Aislamiento de la carpeta web actual
- **D-17:** **Cero modificaciones** a archivos dentro de `\Gestion
  Productiva\` (la carpeta web operativa). La copia para empaquetar se
  hace **read-only** desde la web a la carpeta Portable. Verificar al final
  que no haya cambios en la web (LOCKS.txt + git status si aplica).

### Claude's Discretion
- D-06, D-07, D-08, D-11 son decisiones por defecto donde el usuario
  delego eleccion. Cualquiera de estas puede revisarse en plan o ejecucion
  sin re-discutir si surge una razon concreta.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Goal y constraints del phase
- `.planning/ROADMAP.md` §"Phase 5: App Electron Portable (piloto admins)" — Goal, Scope, Success Criteria
- `.planning/PROJECT.md` §"Constraints" — vanilla HTML/JS, sin framework, multi-PC

### Estructura web actual a empaquetar
- `index.html` — entry point que redirige a login o Inicio segun sessionStorage
- `login.html` — login Supabase con password compartido + sessionStorage.gp_auth
- `auth-guard.js` — guarda de sesion en cada modulo
- `Inicio/index.html` — menu principal con 38 links a modulos (a forkear)
- `package.json` — ya tiene `@supabase/supabase-js` y `exceljs` como deps

### Modulos piloto (paths exactos)
- `Prov Serv/Entregas/EntregaPS.html`, `Prov Serv/Envios/EnviosPS.html`, `Prov Serv/Control/ControlPS.html`
- `Talleristas/Recepcion/Recepcion Cervantes.html`, `Talleristas/Recepcion/Recepcion Virgilio.html`, `Talleristas/Recepcion/Entrega Cervantes Fotos.html`, `Talleristas/Envios/EnviosTall.html`, `Talleristas/Control Tall/ControlTall.html`, `Talleristas/Proporciones/index.html`, `Talleristas/ABM Articulos/ABMArticulosTall.html`
- `Prov Art Terminado/Entregas/EntregasAT.html`, `Prov Art Terminado/Envios/EnviosAT.html`, `Prov Art Terminado/Control/ControlAT.html`
- `StockFlejes/flejes.html`, `StockFlejes/cajas.html`, `StockFlejes/cartones.html`, `StockFlejes/plasticos.html`, `StockFlejes/recepcion.html`, `StockSP/StockSP.html`, `StockSC/StockSC.html`, `StockMovimiento/StockMovimiento.html`, `StockTransitoPS/index.html`, `Stocks General/StocksGeneral.html`
- `Produccion/maestro.html`, `Produccion/tiempos.html`, `Produccion/abm.html`, `Produccion/monitor.html`, `Produccion/monitor2.html`, `Produccion/import.html`, `Produccion/RegistroApp/index.html`
- `Informes/index.html`

### Modulos NO-piloto (a deshabilitar visualmente en menu)
- `Compras/cajas.html` (y otros HTML del directorio Compras)
- `Facturas/index.html`, `Facturas/EntregaProveedoresCervantes.html`
- `Verificacion/verificacion.html`, `VerifMadres/VerifMadres.html`
- `Despiece/Despiece.html`, `Despiece x Articulo/app.js` (modulo)
- `Disruptivas/index.html`
- `Alertas/`, `Preavisos/`, `Ventas Chat/index.html`

### Locks y reglas del repo
- `CLAUDE.md` — REGLA #1 LOCKS.txt antes de Edit/Write; tablas MADRE/DERIVADAS
- `LOCKS.txt` — sistema multi-usuario en uso

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Login flow** (`login.html`): supabase-js v2 desde CDN, password contra
  Supabase, sessionStorage `gp_auth=ok`. Se reusa **tal cual** dentro del
  Electron renderer.
- **auth-guard.js**: protege cada modulo. No requiere cambios.
- **package.json** ya declara `@supabase/supabase-js` y `exceljs` como
  dependencies — `node_modules` actual NO se incluye en el `.exe` (se
  reinstala en build temporal y `electron-builder` lo copia segun
  `files`).

### Established Patterns
- **Vanilla HTML/JS sin build step** — Electron carga `file://` directamente,
  igual que Live Server hoy. No hace falta bundler/transpiler.
- **Supabase via CDN** (`cdn.jsdelivr.net`). Requiere internet en runtime.
  En Electron carga igual via CSP default.
- **sessionStorage para auth**: persiste mientras la `BrowserWindow` viva.
  Cierra app → se limpia. Coherente con D-09.
- **Paths relativos** entre modulos (`../Talleristas/...`). Funcionan
  identico bajo `file://` en Electron.

### Integration Points
- **Entry point**: `main.js` de Electron crea `BrowserWindow` que carga
  `file:///.../index.html` (que redirige a login o Inicio segun session).
- **Renderer = navegador**: la mayoria del codigo no necesita cambios.
- **Forks de archivos**: solo `Inicio/index.html` se modifica en el portable
  (clase disabled + tooltip + cortar links no-piloto). Resto se copia
  literal.
- **electron-builder config**: target `portable` (NSIS portable), salida
  a `C:\...\Prueba_Apliaciones_en_Local\dist\`, despues mover el `.exe`
  unico a `Z:\...\Gestion Productiva Portable\`.

### Riesgos detectados
- **Supabase CDN requiere internet** — si la red de oficina cae, la app
  no loguea. Mismo problema que la web hoy. No es regresion.
- **CSP estricta de Electron** puede bloquear el CDN — habra que setear
  `webPreferences.webSecurity` o agregar CSP meta tag permisivo. Plan
  task explicita.
- **fetch a Supabase** funciona normal en renderer Electron sin CORS
  porque renderer no es origen `http`.
- **F12 / DevTools**: por default Electron habilita `Ctrl+Shift+I` en
  dev. Para piloto se permite (ayuda a debuggear). Si surge problema,
  se cierra en plan posterior.

</code_context>

<specifics>
## Specific Ideas

- **Naming del .exe**: por default `electron-builder` usa el `name` del
  `package.json`. Sugerir `gestion-productiva-portable.exe` o similar.
  No discutido — Claude discretion en plan.
- **Tamaño esperado**: Electron portable runtime ~80–120 MB (Chromium
  embebido). Es el costo conocido de Electron, aceptado en la decision
  inicial vs PWA.
- **Flujo de update**: build local → `Z:\...\Gestion Productiva Portable\
  gestion-productiva-portable.exe` (sobreescribe) → admins re-abren.

</specifics>

<deferred>
## Deferred Ideas

Items que aparecieron pero no son piloto. Capturados aca para no perderse:

- **Acceso a Excel local** desde la app (lectura/escritura de
  `Envios_Talleristas_KG_Cajones.xlsx`). Hoy se hace via `envios_excel.py`
  fuera de la app. Si se necesita integrado, futuro phase con `exceljs`
  + IPC.
- **Ejecucion de macros .bas** (`MACRO_ENTREGAS_SUPABASE.bas`) desde la
  app via Excel COM (`winax`). Futuro phase si los admins lo piden.
- **Auto-update** del `.exe` (electron-updater). Para mas de 2 admins.
- **Branding** (icono Loeke, splash, nombre custom). Despues del piloto.
- **Firma digital del .exe** (evitar SmartScreen warning). Despues del
  piloto.
- **Modo offline real** (cache de datos para operar sin internet).
  Requiere repensar Supabase calls — phase mayor.
- **App movil / PWA** para operarios en planta (separado del piloto
  admins).
- **Modulos no-piloto** (Compras, Facturas, Verificacion, etc.):
  habilitarlos en proximo piloto si los admins necesitan.
- **Push notifications / impresion silenciosa** — si surge necesidad.
- **Empaquetado para Mac/Linux** — no aplica (admins son Windows).

</deferred>

---

*Phase: 05-app-electron-portable*
*Context gathered: 2026-05-06*
