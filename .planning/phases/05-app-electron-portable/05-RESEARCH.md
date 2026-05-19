# Phase 5: App Electron Portable (piloto admins) - Research

**Researched:** 2026-05-06
**Domain:** Electron desktop packaging (vanilla HTML/JS web app -> .exe portable Windows)
**Confidence:** HIGH

## Summary

Empaquetar la web actual (`Gestion Productiva/`) como `.exe` portable Windows con
Electron + electron-builder target `portable`. Stack ya verificado: vanilla HTML/JS
+ Supabase via CDN funciona dentro del renderer Electron sin cambios de codigo —
solo hace falta `main.js`, `package.json` con `build` config, y un fork de
`Inicio/index.html` para deshabilitar modulos no-piloto. Build temporal en
`C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\`, salida final un unico
`.exe` (~80-150 MB) en `Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\`.

Riesgo principal: nombres de carpeta con espacios (`Prov Art Terminado`,
`Stocks General`, `Ventas Chat`) — funcionan bajo `file://` y en `files` glob
de electron-builder, pero requieren cuidado en comandos shell (`robocopy`/`xcopy`
con quoting). Login Supabase funciona igual porque renderer no tiene origen `http`,
no hay CORS, y el CDN `cdn.jsdelivr.net` se permite via meta CSP tag explicito
o `webPreferences.webSecurity:false` (ultimo no recomendado).

**Primary recommendation:** Electron 42.x + electron-builder 26.x. main.js minimo
(BrowserWindow + `loadFile('index.html')`), preload con contextBridge solo para
`print()` y `openExternal()`, fork de `Inicio/index.html` con clase `.disabled`
en 14 botones no-piloto. Build con `npx electron-builder --win portable --x64`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Modulos piloto (6 grupos):**
- **D-01:** Modulos piloto: PS (Entregas, Envios, Control), Talleristas (Recepcion
  Cervantes/Virgilio, Envios, Control, Proporciones, ABM Articulos), Prov Art
  Terminado (Entregas, Envios, Control), Stocks (StockFlejes incl. flejes/cajas/
  cartones/plasticos/recepcion, StockSP, StockSC, StockMovimiento, StockTransitoPS,
  Stocks General), Produccion (maestro, tiempos, abm, monitor, monitor2,
  RegistroApp), e Informes.
- **D-02:** Modulos NO-piloto (Compras, Facturas, Verificacion, VerifMadres,
  Despiece, Despiece x Articulo, Disruptivas, Alertas, Preavisos, Ventas Chat)
  fuera del piloto.

**Menu Inicio:**
- **D-03:** No-piloto visibles pero deshabilitados (gris no clickeable + tooltip
  "No disponible en piloto").
- **D-04:** Forkear `Inicio/index.html` dentro del Portable. Carpeta web
  original NO se modifica.
- **D-05:** Sin shortcut oculto para no-piloto.

**Origen del codigo:**
- **D-06:** Snapshot embebido en `.exe` (no live read de `\\loeke-svr` en runtime).
  Cada cambio en la web requiere rebuild.

**Impresion:**
- **D-07:** Dialog del sistema (`silent: false`). Admin elige impresora/copias.

**IPC minimo:**
- **D-08:** Solo (1) impresion, (2) sesion, (3) `openExternal` para URLs.
  NO Excel local, NO `envios_excel.py`, NO COM/macros, NO acceso `\\loeke-svr`
  desde renderer.

**Login y sesion:**
- **D-09:** Login Supabase igual que web. `sessionStorage.gp_auth=ok` durante la
  corrida. Se limpia al cerrar.
- **D-10:** Sin biometria en desktop.

**Configuracion:**
- **D-11:** Config (si surge) en `app.getPath('userData')` =
  `%APPDATA%\GestionProductivaPortable\`.

**Distribucion:**
- **D-12:** Sin auto-update. Logistica1 copia .exe nuevo a destino y avisa por
  WhatsApp.
- **D-13:** Sin firma digital (SmartScreen warning aceptado).

**Branding:**
- **D-14:** Defaults de electron-builder. Sin icono/splash custom.

**Build temporal:**
- **D-15:** Todo el build (`node_modules`, `dist/`, intermedios) en
  `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\`. La carpeta
  `Gestion Productiva Portable\` solo recibe el `.exe`.
- **D-16:** Borrar `C:\...\Prueba_Apliaciones_en_Local\` al finalizar Phase 5.

**Aislamiento:**
- **D-17:** Cero modificaciones a `\Gestion Productiva\` (web operativa).
  Verificar al final.

### Claude's Discretion
- D-06, D-07, D-08, D-11 son defaults donde el usuario delego eleccion. Revisables
  en plan/ejecucion sin re-discutir si surge razon concreta.
- Naming del `.exe` (sugerencia: `gestion-productiva-portable.exe`).

### Deferred Ideas (OUT OF SCOPE)
- Acceso a Excel local desde la app (`exceljs` + IPC) — futuro phase
- Ejecucion de `MACRO_ENTREGAS_SUPABASE.bas` via Excel COM (`winax`) — futuro
- Auto-update (`electron-updater`) — para mas de 2 admins
- Branding (icono Loeke, splash, nombre custom) — despues del piloto
- Firma digital (evitar SmartScreen) — despues del piloto
- Modo offline real — phase mayor
- App movil / PWA — separado
- Modulos no-piloto habilitados — siguiente piloto
- Impresion silenciosa — si surge necesidad
- Mac/Linux — no aplica
</user_constraints>

## Project Constraints (from CLAUDE.md)

- **LOCKS.txt obligatorio antes de Edit/Write** en `\Gestion Productiva\` (web
  original). NO aplica a `\Gestion Productiva Portable\` ni a build temporal
  (carpetas nuevas, sin otros editores).
- **Tablas MADRE/DERIVADAS:** NO aplica a Phase 5 (no toca Supabase ni esquema).
- **Caveman mode default:** respuestas concisas en docs y commits.
- **Ediciones minimas:** plan no debe reformatear codigo no pedido.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Carga de HTML/JS de los 6 modulos piloto | Renderer (Chromium en Electron) | — | Renderer = navegador, los modulos vanilla se cargan via `file://` sin cambios |
| Login Supabase | Renderer | — | `login.html` reusa `supabase-js` desde CDN. Llamadas HTTPS van directo, no pasan por main |
| Persistencia de sesion (`sessionStorage gp_auth`) | Renderer (BrowserWindow lifecycle) | — | sessionStorage muere al cerrar la ventana = D-09 satisfecho automatico |
| Impresion remitos/facturas | Renderer (`window.print()`) | Main (opcional `webContents.print`) | Renderer dispara dialog del sistema sin IPC. Main solo si se quiere control fino |
| Ventana principal y menu | Main (`BrowserWindow`) | — | Crear/configurar ventana, control de webPreferences, dev tools |
| Apertura de URLs externas | Main (`shell.openExternal`) | Preload bridge | Solo el main puede abrir URLs en navegador OS; preload expone via IPC |
| Acceso a `\\loeke-svr` | Renderer (paths absolutos en codigo existente) | — | Codigo actual ya hace fetch a paths SMB; Electron lo permite via `file://` y rutas Windows |
| Datos persistentes (Supabase) | Externo (HTTPS al hosting Supabase) | — | No cambia respecto a la web actual |
| Config local (si surge) | Main (`app.getPath('userData')`) | — | D-11. Renderer no escribe disco directo |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron` | ^42.0.0 | Runtime Chromium + Node | LTS actual, soporta Windows 10/11 sin issues `[VERIFIED: npm view electron version -> 42.0.0]` |
| `electron-builder` | ^26.0.0 | Empaquetado a `.exe portable` | Estandar de facto para distribuir Electron en Windows. Soporta target `portable` nativo `[VERIFIED: npm view electron-builder version -> 26.8.1]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` | (CDN) | Cliente Supabase | Ya cargado via CDN en cada modulo. NO instalar como dep del Electron — el codigo actual lo trae de jsdelivr `[VERIFIED: existing login.html line 130]` |

### NO instalar en el Electron portable
- `exceljs` — esta en el `package.json` web original pero ningun modulo piloto la
  usa en runtime (solo el flujo `envios_excel.py`, fuera de scope D-08).
- `winax` / `node-ffi` — descartado por D-08.

### Alternativas consideradas
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Electron | Tauri (Rust + WebView2) | .exe ~10 MB vs ~100 MB. Pero requiere Rust toolchain, WebView2 runtime y reescribir IPC. Para piloto de 2 admins, no justifica. `[ASSUMED]` — no investigado a fondo |
| electron-builder portable | NSIS installer | Portable no requiere instalar (cumple D-12 manual copy). Installer pediria UAC y deja entradas en registry. `[CITED: electron.build/nsis.html]` |
| target portable | Squirrel.Windows | Squirrel implica auto-update server (descartado D-12) `[ASSUMED]` |

**Installation (en build temporal):**
```bash
cd C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\
npm init -y
npm install --save-dev electron@^42 electron-builder@^26
```

**Version verification (2026-05-06):**
- `npm view electron version` -> `42.0.0` `[VERIFIED]`
- `npm view electron-builder version` -> `26.8.1` `[VERIFIED]`

## Architecture Patterns

### System Architecture Diagram

```
+------------------------------------------------------------------+
| .exe portable (Windows x64)                                      |
|                                                                  |
|  +--------------------+      IPC (contextBridge)                 |
|  |  Main Process      | <----------------------------+           |
|  |  (Node.js)         |                              |           |
|  |  - main.js         |                              |           |
|  |  - BrowserWindow   |       +--------------------+ |           |
|  |  - shell.openExt   |------>|  Preload Script    | |           |
|  |  - app.getPath     |       |  - contextBridge   | |           |
|  +--------------------+       |  - print()         | |           |
|         |                     |  - openExternal()  | |           |
|         | loadFile()          +--------------------+ |           |
|         v                              ^             |           |
|  +-------------------------------------|-----------------+       |
|  |  Renderer (Chromium)                |             |   |       |
|  |  file:///C:/.../app.asar/Gestion Productiva/index.html |       |
|  |                                                         |       |
|  |  +---------+   +----------+   +---------+   +-------+   |       |
|  |  | login   |-->| Inicio   |-->| Modulos |-->| Print |   |       |
|  |  | .html   |   | index    |   | piloto  |   | dialog|   |       |
|  |  | (CDN    |   | (forked, |   | (PS,    |   |(system|   |       |
|  |  | supabase|   |  14 btn  |   | Tall,   |   | OS)   |   |       |
|  |  | -js)    |   | disabled)|   | etc)    |   +-------+   |       |
|  |  +---------+   +----------+   +---------+               |       |
|  +---------------------------------------------------------+       |
|         |                              |                           |
+---------|------------------------------|---------------------------+
          | HTTPS                        | SMB (file:// // UNC)
          v                              v
  +----------------+              +-------------------+
  | Supabase       |              | \\loeke-svr\...   |
  | (cloud, REST)  |              | (Excel, archivos) |
  +----------------+              +-------------------+
```

### Recommended Project Structure

Build temporal (`C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\`):
```
Prueba_Apliaciones_en_Local/
├── package.json              # ELECTRON build config (NO el de la web)
├── main.js                   # Main process: BrowserWindow + IPC handlers
├── preload.js                # contextBridge: print, openExternal
├── node_modules/             # electron + electron-builder (pesado, descartable)
├── dist/                     # output de electron-builder (.exe queda aqui)
└── app/                      # snapshot de la web (copia desde Gestion Productiva)
    ├── index.html            # entry (igual que web)
    ├── login.html            # igual que web
    ├── auth-guard.js         # igual que web
    ├── helpers.js            # igual que web
    ├── Inicio/
    │   └── index.html        # FORKED: 14 botones no-piloto con .disabled
    ├── Prov Serv/...
    ├── Talleristas/...
    ├── Prov Art Terminado/...
    ├── StockFlejes/...
    ├── StockSP/, StockSC/, StockMovimiento/, StockTransitoPS/, Stocks General/
    ├── Produccion/
    └── Informes/
```

Final destino (`Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\`):
```
Gestion Productiva Portable/
└── gestion-productiva-portable.exe   # unico archivo (todo embebido en asar)
```

### Pattern 1: main.js minimo

```javascript
// Source: https://www.electronjs.org/docs/latest/tutorial/quick-start [CITED]
const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // webSecurity: true (default) — la CSP la maneja el meta tag en HTMLs
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  // Dev: F12 abre DevTools (default en Electron sin shortcuts custom)
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('open-external', (_evt, url) => shell.openExternal(url));
```

### Pattern 2: preload.js con contextBridge (IPC seguro)

```javascript
// Source: https://www.electronjs.org/docs/latest/tutorial/context-isolation [CITED]
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gpPortable', {
  // Impresion: el renderer puede llamar window.print() directo (dialog OS).
  // No hace falta IPC. Pero exponemos un helper por si se usa desde codigo
  // legacy.
  print: () => window.print(),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
```

### Pattern 3: package.json (en build temporal)

```json
{
  "name": "gestion-productiva-portable",
  "productName": "Gestion Productiva Portable",
  "version": "1.0.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder --win portable --x64"
  },
  "devDependencies": {
    "electron": "^42.0.0",
    "electron-builder": "^26.0.0"
  },
  "build": {
    "appId": "com.loeke.gestionproductiva.portable",
    "productName": "Gestion Productiva Portable",
    "directories": {
      "output": "dist"
    },
    "files": [
      "main.js",
      "preload.js",
      "app/**/*",
      "!app/.planning/**",
      "!app/node_modules/**",
      "!app/.git/**",
      "!app/LOCKS.txt",
      "!app/*.md",
      "!app/*.bas",
      "!app/*.py",
      "!app/*.sh",
      "!app/*.lnk",
      "!app/*.xls",
      "!app/*.xlsx"
    ],
    "asar": true,
    "win": {
      "target": [{ "target": "portable", "arch": ["x64"] }],
      "artifactName": "gestion-productiva-portable.exe"
    },
    "portable": {
      "artifactName": "gestion-productiva-portable.exe",
      "unpackDirName": false
    }
  }
}
```

Notas:
- `unpackDirName: false` -> usa temp dir UUID por launch (evita conflicto si dos
  admins corren la misma sesion). `[CITED: electron.build PortableOptions]`
- `asar: true` -> empaqueta `app/` en un solo blob (recomendado).
- `files` exclude `*.md`, `*.bas`, `*.py`, `*.xlsx` — no aportan al runtime y
  reducen el `.exe`.

### Pattern 4: CSP meta tag (renderer)

`login.html` y cualquier HTML que cargue Supabase via CDN necesita CSP que
permita `cdn.jsdelivr.net`. Como ya esta hardcodeado el script tag, lo simple
es agregar meta tag en cada entry HTML:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;
               script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net;
               style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
               font-src 'self' https://fonts.gstatic.com data:;
               connect-src 'self' https://*.supabase.co https://hrxfctzncixxqmpfhskv.supabase.co wss://*.supabase.co;
               img-src 'self' data: blob: https:;">
```

Source: https://content-security-policy.com/examples/electron/ `[CITED]`

**Alternativa:** `webPreferences.webSecurity: false` en main.js. NO recomendado
(deshabilita TODA security web). El meta tag es preferible.

### Anti-Patterns to Avoid

- **NO usar `nodeIntegration: true`** en renderer. Habilita `require()` desde
  HTMLs cargados, que es vector de ataque si Supabase llegase a tener XSS.
  Usar `contextIsolation: true` + preload (Pattern 2). `[CITED: Electron security docs]`
- **NO modificar `\Gestion Productiva\`** — D-17. El plan debe COPIAR a la
  carpeta build, nunca symlink ni junction.
- **NO incluir `node_modules/` de la web original** en el `.exe`. `package.json`
  de la web tiene `exceljs` que pesa y no se usa en piloto.
- **NO desactivar DevTools** en piloto — D-09 deja F12 habilitado para que
  admins puedan reportar errores.
- **NO usar `shell.openExternal` con URLs no validadas** — para piloto solo
  abrira URLs hardcodeadas (Supabase Studio, web original). No hay user input.

## Don't Hand-Roll

| Problema | NO construir | Usar | Por que |
|----------|-------------|------|---------|
| Empaquetado .exe | NSIS scripts a mano | `electron-builder --win portable` | electron-builder maneja firma, asar, icono, signing futuro, version metadata |
| Print dialog | UI custom de impresion | `window.print()` (renderer) | Es nativo del OS, soporta print preview, copias, impresora — D-07 cumplido en una linea |
| Auth | Reescribir login | Reusar `login.html` + `auth-guard.js` tal cual | Funciona en `file://` igual que en Live Server. supabase-js no diferencia origen `file://` de `http://` para llamadas HTTPS |
| Forking de menu | Mantener dos copias divergentes | Script idempotente que aplica `.disabled` a 14 selectores especificos | El fork debe ser regenerable: cuando la web original cambia, re-correr script |
| Copia de codigo | xcopy con flags raros | `robocopy` con `/MIR` + `/XD` exclusiones | robocopy maneja paths con espacios, multi-threaded, idempotente, codigos de salida claros |
| Verificacion no-modificacion | hash a mano | `Get-FileHash` PowerShell o git status | Confirma D-17 sin ambiguedad |

**Key insight:** todo el valor de Phase 5 esta en NO inventar nada nuevo —
reusar HTML/JS existente sin tocarlo y dejar que Electron + electron-builder
hagan el trabajo. Cada hand-roll incrementa el riesgo de divergencia con la web.

## Runtime State Inventory

Phase 5 introduce un nuevo runtime (.exe), no renombra ni refactoriza la web.
La inventory aplica al binario y a archivos auxiliares que el .exe deja.

| Categoria | Items encontrados | Accion requerida |
|-----------|-------------------|------------------|
| **Stored data** | `sessionStorage gp_auth=ok` — vive en partition de la BrowserWindow. Se limpia al cerrar (D-09 cumplido por default Electron) | Ninguna. Verificar en wave de pruebas |
| **Live service config** | Ninguna nueva. Supabase URL/anon key estan hardcodeados en cada HTML (igual que web hoy) | Ninguna |
| **OS-registered state** | El portable .exe NO se registra en Windows (no installer, no registry, no Start Menu entry — eso es feature del target portable) `[CITED: electron-builder portable doc]` | Ninguna. Esto cumple D-12 (manual copy) |
| **Secrets/env vars** | Supabase anon key publico. Password Supabase via `check_app_password` RPC — NO se persiste local | Ninguna. Mismo modelo que web |
| **Build artifacts** | `node_modules/` y `dist/` en build temporal. Borrar al finalizar (D-16) | Documentar comando de limpieza en plan final |
| **Per-launch state** | Con `unpackDirName: false`, el portable extrae a `%TEMP%\<uuid>\` y se autolimpia. NO deja residuo entre runs `[CITED: electron-builder portable]` | Ninguna |
| **userData** | `app.getPath('userData')` = `%APPDATA%\Gestion Productiva Portable\` se crea al primer launch (DevTools state, cookies). Vacio mientras no usemos D-11 | Documentar para futuros admins (lo pueden borrar sin perder nada) |

## Common Pitfalls

### Pitfall 1: Carpetas con espacios rompen `files` glob
**Que falla:** `files: ["Prov Art Terminado/**/*"]` puede fallar segun parser.
**Por que:** electron-builder usa minimatch; los espacios son legales pero
algunos shells los expanden mal en CLI.
**Como evitar:** Usar comillas dobles en el JSON (ya las tiene). En CLI usar
`npx electron-builder` (no expande). Verificar en preview que `dist/win-unpacked/`
contenga las carpetas con espacios. `[ASSUMED]` — confirmar en plan task.
**Senal temprana:** post-build, abrir `dist/win-unpacked/resources/app.asar` y
listar (`npx asar list app.asar`) para confirmar que `Prov Art Terminado/` esta.

### Pitfall 2: Supabase CDN bloqueado por CSP default
**Que falla:** `Refused to load script from cdn.jsdelivr.net`. Login no anda.
**Por que:** Electron por defecto NO envia CSP, pero algunos modulos web ya
pueden tener meta tag restrictivo. El default-src 'self' bloquearia CDN.
**Como evitar:** Agregar meta tag CSP permisivo en cada HTML que cargue
supabase-js (ver Pattern 4). Como minimo: `login.html`, `Inicio/index.html`,
y todos los modulos piloto. Si ya tienen CSP, MERGE no replace.
**Senal temprana:** DevTools console muestra "Refused to load" -> falta CDN
en `script-src`. `[VERIFIED: github.com/orgs/supabase/discussions/13987]`

### Pitfall 3: Paths relativos con `..` no resuelven en .asar
**Que falla:** `../Talleristas/...` desde `Inicio/index.html` puede fallar si
`asar: true` y el paquete entra a un mount virtual.
**Por que:** En realidad Electron resuelve `file://` dentro de asar como un
filesystem normal y `..` funciona. Pero hay edge cases con symlinks.
**Como evitar:** Mantener estructura plana (todo bajo `app/`). Probar despues
de build que todos los links funcionan (test manual: clic en cada uno).
`[ASSUMED]` — historicamente funciona pero confirmar en wave de pruebas.

### Pitfall 4: SmartScreen bloquea primer launch
**Que falla:** Windows muestra "Windows protegio tu PC". Admins no saben que
hacer.
**Por que:** .exe no firmado digitalmente (D-13 acepta este tradeoff).
**Como evitar:** Documentar en README/whatsapp inicial: "Mas info -> Ejecutar
de todos modos". Una sola vez por PC.
**Senal temprana:** Primer launch en PC limpia.

### Pitfall 5: sessionStorage NO sobrevive reload de window
**Que falla:** Login OK, va a Inicio, refresca con F5 -> pide login otra vez.
**Por que:** sessionStorage en Electron persiste solo dentro de la misma
BrowserWindow session. Reload conserva. Cerrar la ventana NO conserva.
**Como evitar:** Comportamiento es el deseado (D-09). NO cambiar.
**Senal temprana:** N/A — es by design.

### Pitfall 6: window.print() no muestra dialog si webContents tiene focus mal
**Que falla:** Imprime sin preguntar (silencioso) o no imprime.
**Por que:** Algunos modulos podrian llamar `webContents.print({silent: true})`
en lugar de `window.print()`. La web actual usa `window.print()` -> verificar.
**Como evitar:** Grep en codigo piloto por `print(` -> deberia ser solo
`window.print()`. Si hay `webContents.print` en algun modulo, revisar `silent`.
**Senal temprana:** En wave de pruebas, imprimir un remito real.

### Pitfall 7: `Get-FileHash` lento en `\Gestion Productiva\` con miles de archivos
**Que falla:** Verificacion D-17 tarda 10+ minutos.
**Por que:** PowerShell calcula SHA256 sobre cada file individual.
**Como evitar:** Hashear solo archivos clave (`index.html`, `login.html`,
`Inicio/index.html`, `auth-guard.js`, `package.json`, `helpers.js`) o usar
`robocopy /L /MIR` (dry-run que reporta diferencias) entre snapshot pre-build
y post-build.
**Senal temprana:** Usar `robocopy /L` que es instantaneo.

### Pitfall 8: Supabase realtime (websocket) puede fallar bajo CSP estricta
**Que falla:** `wss://*.supabase.co` bloqueado.
**Por que:** CSP `connect-src` necesita `wss:` ademas de `https:`.
**Como evitar:** Pattern 4 ya incluye `wss://*.supabase.co` en `connect-src`.
**Senal temprana:** Si algun modulo piloto usa subscriptions de Supabase,
console.error "WebSocket connection failed".

## Code Examples

### Imprimir desde renderer (D-07)

```javascript
// Source: https://www.electronjs.org/docs/latest/api/web-contents [VERIFIED]
// Desde cualquier HTML del Portable:
function imprimirRemito() {
  // Dialog del sistema OS — admin elige impresora, copias, etc.
  window.print();
}
```

No requiere IPC. Es lo mismo que en navegador. Funciona en Electron renderer
out of the box.

### Abrir URL externa (modulo no-piloto -> web original)

```javascript
// En el fork de Inicio/index.html (renderer):
async function abrirEnNavegador(rutaModulo) {
  // rutaModulo = ej. "../Compras/cajas.html"
  // Resolver al path real de la web original:
  const urlWeb = `file:///Z:/AA%20IT/Gestion%20Productiva%20(4)/Gestion%20Productiva%20(3)/Gestion%20Productiva%20(3)/Gestion%20Productiva/Gestion%20Productiva/${rutaModulo.replace('../','')}`;
  await window.gpPortable.openExternal(urlWeb);
}
```

Nota: Para D-05 (sin shortcut oculto), esta funcion NO se invoca desde el
boton deshabilitado. Solo seria util si se decide agregar un boton "abrir en
navegador" — fuera de scope actual.

### Botones no-piloto deshabilitados (fork de Inicio/index.html)

```html
<!-- ANTES (web original) -->
<button class="btn-opcion" data-link="../Compras/cajas.html">Cajas</button>

<!-- DESPUES (Portable, fork) -->
<button class="btn-opcion disabled"
        title="No disponible en piloto"
        data-link="#"
        disabled>Cajas</button>
```

CSS adicional en el fork:
```css
.btn-opcion.disabled,
.btn-opcion:disabled {
  background: #e2e8f0 !important;
  color: #94a3b8 !important;
  cursor: not-allowed !important;
  opacity: 0.6;
  border-color: #cbd5e1 !important;
}
.btn-opcion.disabled:hover {
  background: #e2e8f0 !important;
  color: #94a3b8 !important;
  transform: none !important;
  box-shadow: none !important;
}
```

Click handler ya filtra naturalmente (boton `disabled` no dispara click). Si
es necesario reforzar:
```javascript
document.querySelectorAll(".btn-opcion").forEach(btn => {
  btn.addEventListener("click", (e) => {
    if (btn.classList.contains('disabled')) {
      e.preventDefault();
      return;
    }
    window.location.href = btn.dataset.link;
  });
});
```

### Build commands (workflow temporal)

```powershell
# 1. Setup build temporal (PowerShell)
$BUILD = "C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local"
$WEB   = "Z:\AA IT\Gestion Productiva (4)\Gestion Productiva (3)\Gestion Productiva (3)\Gestion Productiva\Gestion Productiva"
$DEST  = "Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable"

New-Item -ItemType Directory -Force -Path $BUILD
New-Item -ItemType Directory -Force -Path "$BUILD\app"
New-Item -ItemType Directory -Force -Path $DEST

# 2. Copiar codigo web -> $BUILD\app (excluye lo que no aporta)
robocopy "$WEB" "$BUILD\app" /MIR `
  /XD ".planning" "node_modules" ".git" "A Agregar" `
  /XF "*.bas" "*.py" "*.sh" "*.lnk" "*.xls" "*.xlsx" "LOCKS.txt" "*.md" "*.txt" "*.sql"

# 3. Crear fork de Inicio/index.html dentro de $BUILD\app\Inicio
# (script de plan task aplica .disabled a 14 botones)

# 4. Crear main.js, preload.js, package.json (Pattern 1, 2, 3) en $BUILD\

# 5. Install y build
cd $BUILD
npm install
npx electron-builder --win portable --x64

# 6. Mover .exe a destino
Move-Item "$BUILD\dist\gestion-productiva-portable.exe" "$DEST\" -Force

# 7. Verificar D-17 (web sin cambios) — comparar pre/post
robocopy "$WEB" "$BUILD\snapshot-post" /L /MIR `
  /XD ".planning" "node_modules" ".git" `
  /XF "LOCKS.txt"  # LOCKS puede haber cambiado por la sesion
# Esperado: "0 archivos copiados" en summary

# 8. Cleanup (D-16)
Remove-Item -Recurse -Force $BUILD
```

Source: comandos verificados manualmente — robocopy es nativo Windows desde
W7. `[VERIFIED: docs.microsoft.com/windows-server/administration/windows-commands/robocopy]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `nodeIntegration: true` | `contextIsolation: true` + preload | Electron 12+ | Default seguro. NO usar nodeIntegration salvo legacy |
| `remote` module | `ipcMain.handle` + `ipcRenderer.invoke` | Electron 14 (deprecado) / 22 (removido) | Pattern 2 ya usa el modelo nuevo |
| NSIS installer estandar | NSIS portable (target `portable`) | electron-builder 19+ | Cumple D-12 sin servidor de updates |
| `app.getAppPath()` para userData | `app.getPath('userData')` | Electron 1.x+ estable | D-11 lo usa correctamente |

**Deprecated/outdated:**
- `webview` tag — descartado, usar `<iframe>` o BrowserView. NO aplica aqui.
- `enableRemoteModule` — removido en Electron 14. NO usar.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Carpetas con espacios funcionan en `files` glob de electron-builder sin escape extra | Pitfall 1 | Build falla silenciosamente, falta carpeta en .exe -> modulo 404. Mitigacion: `npx asar list` post-build |
| A2 | Paths relativos `../X/...` desde un HTML bajo asar resuelven correcto | Pitfall 3 | Modulo no carga. Mitigacion: probar manual cada link en wave de pruebas |
| A3 | `window.print()` desde renderer Electron muestra dialog OS sin config extra | Pattern 1 / Pitfall 6 | D-07 no se cumple. Mitigacion: probar imprimir un remito en wave |
| A4 | Tamaño esperado del .exe portable ~80-150 MB (Chromium + asar) | Specifics CONTEXT | Si supera 200 MB, revisar `files` exclude. Mitigacion: post-build, medir con `Get-Item` |
| A5 | Tauri tradeoff descartado por toolchain Rust — no investigado | Alternatives | Si admins piden algo mas liviano en futuro, evaluar Tauri |
| A6 | Squirrel.Windows requiere update server | Alternatives | No critico, descartado por D-12 |
| A7 | `app.getPath('userData')` se crea solo en primer launch | Runtime State | Mitigacion: documentar para que admins sepan que hace `%APPDATA%` |
| A8 | DevTools F12 habilitado por default en Electron sin shortcut custom | Pattern 1 | Si no, agregar `mainWindow.webContents.openDevTools({mode:'detach'})` opcional |

**Si el plan o discuss surface estos como concerns reales:** confirmar con usuario
o validar empiricamente en wave 0 antes de comprometerse.

## Open Questions

1. **Naming exacto del .exe**
   - Que sabemos: convencion `gestion-productiva-portable.exe` (sugerencia
     CONTEXT specifics).
   - Que falta: el usuario lo confirme o pida otro (`GP_Portable.exe`,
     `Loeke_GP.exe`).
   - Recomendacion: planner usa `gestion-productiva-portable.exe` como default,
     marcar como discretion.

2. **Tamaño aceptable del .exe**
   - Que sabemos: Chromium runtime ~80-100 MB, codigo web ~5-15 MB. Total
     estimado 90-150 MB.
   - Que falta: limite duro? (red de oficina, copia por USB).
   - Recomendacion: aceptar lo que salga del build default. Si supera 200 MB,
     revisar `files` exclude.

3. **DevTools en piloto: abrir cerrado o desplegado?**
   - Que sabemos: D-09 menciona F12 disponible.
   - Que falta: abrir auto en error vs solo on-demand.
   - Recomendacion: F12 manual (default). Si admins reportan error, les
     pedimos screenshot de DevTools console.

4. **Verificacion D-17: hash o robocopy /L?**
   - Recomendacion: robocopy /L (mas rapido y confiable que hash a mano sobre
     cientos de archivos).

5. **Si la red `\\loeke-svr` cae mientras la app corre, que hace?**
   - Que sabemos: codigo web actual ya tolera esto (algunos modulos hacen
     fetch a `\\loeke-svr` para Excels, fallan grace).
   - Que falta: caso especifico en piloto.
   - Recomendacion: scope D-08 explicitamente excluye acceso a `\\loeke-svr`
     desde renderer. Si algun modulo piloto lo hace -> documentar como
     dependencia externa, no fix en Phase 5.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | npm install electron, electron-builder | ✓ asumido (Logistica1 dev box) | >= 18 LTS | Si falta: `winget install OpenJS.NodeJS.LTS` |
| npm | install deps | ✓ con Node | viene con Node | — |
| robocopy | Copia codigo web -> build | ✓ nativo Windows | Win7+ | xcopy / Copy-Item PowerShell (peor manejo de errores) |
| PowerShell | scripts de build | ✓ nativo | 5.1+ | cmd.exe (peor) |
| Internet | Descargar electron, supabase CDN | ✓ asumido | — | Sin fallback (Electron require descarga binarios la primera vez) |
| Acceso `Z:\AA IT\Gestion Productiva (4)\` | leer web, escribir Portable | ✓ Logistica1 tiene SMB mount | — | — |
| Acceso `C:\Users\Logistica1\Desktop\` | build temporal | ✓ user local | — | — |
| Windows x64 | target del build | ✓ asumido (admins) | Win10/11 | — |

**Missing dependencies with no fallback:**
- Ninguna detectada (todo asumido disponible en PC Logistica1).

**Missing dependencies with fallback:**
- Ninguna.

**Verificacion sugerida en plan wave 0:**
```powershell
node --version    # >= v18
npm --version
robocopy /?       # confirma disponible
Test-Path "Z:\AA IT\Gestion Productiva (4)\"
Test-Path "C:\Users\Logistica1\Desktop\"
```

## Validation Architecture

> Phase 5 es validacion mayormente manual (no hay test suite Node automatizable
> para una app vanilla HTML/JS sin framework). Plan debe documentar checklist
> manual.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Manual smoke testing (no automated tests existen en el repo web) |
| Config file | none — checklist en plan |
| Quick run command | `cd $BUILD && npm start` (corre Electron sin empaquetar) |
| Full suite command | Build + abrir .exe final + checklist de modulos piloto |

### Phase Requirements -> Test Map

| Req | Behavior | Test Type | Comando | File Exists? |
|-----|----------|-----------|---------|-------------|
| SC-1 (.exe en destino) | gestion-productiva-portable.exe presente en $DEST | smoke | `Test-Path "$DEST\gestion-productiva-portable.exe"` | ❌ Wave 0 |
| SC-2 (6 modulos piloto cargan) | Click en cada boton piloto desde Inicio carga el modulo sin error | manual smoke | Checklist de 21 modulos | ❌ checklist |
| SC-3 (Login Supabase) | Password correcto -> Inicio. Incorrecto -> mensaje | manual | Test con password real | ❌ |
| SC-4 (Impresion) | Imprimir un remito real -> dialog OS aparece | manual | Imprimir desde Entregas PS | ❌ |
| SC-5 (Acceso `\\loeke-svr`) | Modulos piloto que leen `\\loeke-svr` lo hacen sin error | manual | Smoke en modulo afectado | ❌ |
| SC-6 (web original sin cambios) | robocopy /L pre/post no reporta diferencias | automated | `robocopy "$WEB" snapshot /L /MIR` | ❌ Wave 0 |
| SC-7 (build temporal borrado) | Path no existe post-cleanup | automated | `Test-Path $BUILD` -> False | ❌ |
| D-03 (botones disabled) | 14 botones no-piloto tienen clase `.disabled` y no responden a click | manual | Inspeccionar Inicio/index.html del fork | ❌ |
| D-09 (sesion limpia al cerrar) | Cerrar app, reabrir -> pide login otra vez | manual | Test manual | ❌ |

### Sampling Rate
- **Per task commit:** N/A (no hay automated tests)
- **Per wave merge:** smoke manual de modulos afectados
- **Phase gate:** checklist completo de los 9 SC + D-03 + D-09 antes de
  `/gsd-verify-work`

### Wave 0 Gaps
- [ ] Crear `tests/smoke-checklist.md` con los 9 SC enumerados (manual)
- [ ] Crear script PowerShell `verify-no-changes.ps1` que compare `$WEB` pre/post
- [ ] Crear script `enumerate-pilot-modules.ps1` que liste los 21 paths piloto
  para confirmar que existen en `$BUILD\app\` post-copia

## Lista exhaustiva de modulos a deshabilitar en fork de Inicio/index.html

> Critica para D-03/D-04. El planner usa esta lista verbatim.

Botones a marcar `.disabled` (basado en grep de `Inicio/index.html` line 1099-1221):

| Linea (web orig) | Card | Boton | data-link actual |
|------------------|------|-------|------------------|
| 1159 | Stocks | Verificacion Integridad | `../Verificacion/verificacion.html` |
| 1160 | Stocks | Verificacion Madres | `../VerifMadres/VerifMadres.html` |
| 1171 | Producción | Producciones Disruptivas | `../Disruptivas/index.html` |
| 1185 | Despiece | Despiece x Articulo | `../Despiece/Despiece.html` |
| 1194 | Facturas | Lectura de Facturas Entrantes | `../Facturas/index.html` |
| 1196 | Facturas | Entrega Proveedores Cervantes | `../Facturas/EntregaProveedoresCervantes.html` |
| 1206 | Insumos | Cajas (Compras) | `../StockFlejes/cajas.html` *(*) |
| 1207 | Insumos | Flejes (Compras) | `../StockFlejes/flejes.html` *(*) |
| 1208 | Insumos | Cartones (Compras) | `../StockFlejes/cartones.html` *(*) |
| 1209 | Insumos | Partes Plásticas (Compras) | `../StockFlejes/plasticos.html` *(*) |
| 1210 | Insumos | Remaches | `#` (no existe modulo) |
| 1211 | Insumos | Bombillas | `#` |
| 1212 | Insumos | Garage | `#` |
| 1221 | Ventas | Chat Bot Ventas | `../Ventas Chat/index.html` |

Tambien deshabilitar floating alerts:
| 1084 | (top-right) | alertBell -> Alertas | `../Alertas/` |
| 1089 | (top-right) | alertInsumos -> Compras | `../Compras/cajas.html` |

**(*)** **AMBIGUEDAD CRITICA:** los botones del card "Insumos"
(`../StockFlejes/cajas.html`, `flejes.html`, `cartones.html`, `plasticos.html`,
`recepcion.html`) apuntan a archivos en `StockFlejes/` que SI son piloto
segun D-01 ("Stocks ... StockFlejes incl. flejes/cajas/cartones/plasticos/
recepcion"). Pero el card del menu se titula "Insumos" / "Compras".
**Resolucion para el planner:** los archivos `StockFlejes/*.html` SON piloto
(D-01 explicita). El card "Insumos" debe quedar **HABILITADO** para esos 5
botones (`cajas.html`, `flejes.html`, `cartones.html`, `plasticos.html`,
`recepcion.html`). Solo deshabilitar Remaches/Bombillas/Garage (data-link `#`).
**Lineas 1206-1209 TACHADAS de la lista de disabled.** Confirmar con usuario
en wave 0.

**Lista corregida final (12 botones a deshabilitar):**
1. Verificacion Integridad (1159)
2. Verificacion Madres (1160)
3. Producciones Disruptivas (1171)
4. Despiece x Articulo (1185)
5. Lectura de Facturas Entrantes (1194)
6. Entrega Proveedores Cervantes (1196)
7. Remaches (1210)
8. Bombillas (1211)
9. Garage (1212)
10. Chat Bot Ventas (1221)
11. alertBell -> Alertas (1084)
12. alertInsumos -> Compras (1089)

Cards completos a NO mostrar (opcional, alternativo a deshabilitar boton-por-boton):
- Card "Despiece" (linea 1182) — solo tiene 1 boton no-piloto
- Card "Facturas" (linea 1191) — solo tiene 2 botones, ambos no-piloto
- Card "Ventas" (linea 1218) — solo tiene 1 boton no-piloto

**Recomendacion:** planner decide si oculta el card entero o deshabilita boton-
por-boton. D-03 dice "visibles pero deshabilitados" -> mantener cards visibles
con sus botones disabled (preserva paridad visual con la web).

## Sources

### Primary (HIGH confidence)
- Electron docs `webContents.print()` — https://www.electronjs.org/docs/latest/api/web-contents `[VERIFIED: WebFetch]`
- electron-builder portable target — https://www.electron.build/electron-builder.Interface.PortableOptions.html `[CITED]`
- Electron security tutorial — https://www.electronjs.org/docs/latest/tutorial/security `[CITED]`
- Electron CSP examples — https://content-security-policy.com/examples/electron/ `[CITED]`
- npm view (versiones actuales) — `electron@42.0.0`, `electron-builder@26.8.1` `[VERIFIED 2026-05-06]`
- Codigo web actual: `Inicio/index.html`, `login.html`, `index.html`, `auth-guard.js`, `package.json` `[VERIFIED: Read tool]`

### Secondary (MEDIUM confidence)
- BigBinary blog "Building Electron with electron-builder" — https://www.bigbinary.com/blog/publish-electron-application
- DEV.to "Adding splash screen to portable" — https://dev.to/montoyaaguirre/adding-a-splash-screen-to-portable-electron-builder-apps-34d3
- Supabase + CSP discussion — https://github.com/orgs/supabase/discussions/13987

### Tertiary (LOW confidence — needs validation)
- Tamaño exacto del .exe (90-150 MB asumido, validar post-build)
- Comportamiento exacto de paths con espacios en `files` glob (validar post-build con `npx asar list`)

## Metadata

**Confidence breakdown:**
- Standard stack (Electron + electron-builder): **HIGH** — versiones verificadas via npm, target portable es producto core
- Architecture (main/preload/renderer): **HIGH** — patrones canonicos, docs oficiales
- CSP / Supabase CDN: **HIGH** — issue conocido, solucion documentada
- Print pattern: **HIGH** — API estable, `window.print()` funciona desde Chromium nativo
- Carpetas con espacios en glob: **MEDIUM** — funciona en theory, validar empirico
- Lista de modulos a deshabilitar: **HIGH** — derivada de grep directo del archivo
- Naming/branding: **LOW** — discretion del usuario, no investigado a fondo
- Tamaño del .exe: **LOW (estimado)** — depende del build real

**Research date:** 2026-05-06
**Valid until:** 2026-06-06 (Electron releases mensuales; revalidar si phase
empieza despues)
