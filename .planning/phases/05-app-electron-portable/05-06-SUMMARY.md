---
phase: 05-app-electron-portable
plan: 06
subsystem: electron-builder-output
tags: [electron-builder, portable, win-x64, build, asar, wave-4]
status: complete
date: 2026-05-07
dependency_graph:
  requires: ["05-04", "05-05"]
  provides: ["portable-exe-piloto"]
  affects: ["05-07 (move .exe to destino final)", "SC-1 (.exe generado)"]
tech_stack:
  added: []
  patterns:
    - "Workaround: 7za.cmd wrapper en PATH agrega -x!darwin para evitar symlink errors en Windows sin admin/Developer Mode"
    - "Lockfile-based marker (.complete) en cache electron-builder evita re-extract en runs siguientes"
key_files:
  created:
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\dist\\gestion-productiva-portable.exe (88 MB, 92303063 bytes)"
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\dist\\win-unpacked\\ (folder runtime, 145 entries en app.asar)"
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\build-tools\\7za.cmd (workaround wrapper)"
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\noop-sign.js (creado pero NO usado al final)"
  modified:
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\package.json (eliminado: causaba two-package-json layout incompatible)"
decisions:
  - "Eliminar app/package.json (no-op runtime, web usa CDN para supabase-js/exceljs, no node_modules); su presencia obligaba a electron-builder a interpretar app/ como appDir y buscar entry ahi (rompia main.js en root)"
  - "Pre-extraccion manual de winCodeSign-2.6.0.7z fallaba persistentemente: builder usa app-builder.exe externo (Go binary) que invoca 7za fresh con cache filename random -- pre-extract no era detectado"
  - "Solucion final: 7za.cmd wrapper en PATH que appendea -x!darwin a TODA invocacion de 7za. Filtra los .dylib symlinks de darwin (irrelevantes en Windows portable build) que requerian SeCreateSymbolicLinkPrivilege"
  - "Build cache filename en electron-builder cache es deterministic via hashUrlSafe() — el .complete marker file en `<dir>.complete` evita re-extract en runs siguientes (build #2 sera sub-30s)"
  - "CSC_IDENTITY_AUTO_DISCOVERY=false setteado pero NO suficiente: builder igual descarga winCodeSign para rcedit (metadata exe edit), no solo para signing"
  - "signtool.exe se ejecuta en el .exe pero sin cert (D-13 cumplido — signing falla silently y exe queda sin firmar, lo cual es esperado y aceptable para piloto)"
metrics:
  tasks: 1
  files_created: 3
  files_modified: 1
  duration_min: ~25 (mayor parte debugging blockers, build final 109s)
requirements: [SC-1]
---

# Phase 05 Plan 06: Build .exe portable — Summary

**One-liner:** `npx electron-builder --win portable --x64` ejecutado exit 0, `gestion-productiva-portable.exe` (88 MB) generado en `$BUILD/dist/`. asar contiene 145 entries: main.js + preload.js + app/login.html + app/Inicio/index.html + 6 grupos piloto completos (Talleristas, Prov Serv, Prov Art Terminado, StockFlejes, Produccion, Informes). Cero matches en exclusiones (.planning, .bas, .xlsx, LOCKS.txt, .git, .vscode, .claude, A Agregar). Build requirio 3 deviations (Rule 3 — blocking issues) para resolver: (1) `app/package.json` two-pkg-json layout, (2) ausencia de campos `name`/`version` en `app/package.json`, (3) winCodeSign 7z extraction fallando por symlinks darwin sin Developer Mode/admin.

## Comando final ejecutado

```bash
cd "/c/Users/Logistica1/Desktop/Prueba_Apliaciones_en_Local" \
  && PATH="/c/Users/Logistica1/Desktop/Prueba_Apliaciones_en_Local/build-tools:$PATH" \
     CSC_IDENTITY_AUTO_DISCOVERY=false \
     npx electron-builder --win portable --x64
```

Exit code: **0**
Duration: **109 s** (build final, post-blockers)

## Output relevante del build (tail)

```
• electron-builder  version=26.8.1 os=10.0.26200
• loaded configuration  file=package.json ("build" field)
• executing @electron/rebuild  electronVersion=42.0.0 arch=x64 buildFromSource=false
• installing native dependencies  arch=x64
• completed installing native dependencies
• packaging       platform=win32 arch=x64 electron=42.0.0 appOutDir=dist\win-unpacked
• searching for node modules  pm=npm searchDir=C:\...\Prueba_Apliaciones_en_Local
• searching for node modules  pm=traversal searchDir=C:\...\Prueba_Apliaciones_en_Local
• using manual traversal of node_modules to build dependency tree
• no node modules returned while searching directories  searchDirectories=[""]
• updating asar integrity executable resource  executablePath=dist\win-unpacked\Gestion Productiva Portable.exe
• default Electron icon is used  reason=application icon is not set
• signing with signtool.exe  path=dist\win-unpacked\Gestion Productiva Portable.exe
• building        target=portable file=dist\gestion-productiva-portable.exe archs=x64
• downloading     url=...nsis-3.0.4.1.7z size=1.3 MB
• downloaded      duration=770ms
• signing with signtool.exe  path=dist\win-unpacked\resources\elevate.exe
• downloading     url=...nsis-resources-3.4.1.7z size=731 kB
• downloaded      duration=625ms
• signing with signtool.exe  path=dist\gestion-productiva-portable.exe
```

## Artefacto: .exe portable

| Campo | Valor |
|-------|-------|
| Path | `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\dist\gestion-productiva-portable.exe` |
| Size bytes | 92,303,063 |
| Size MB | 88 MB |
| Range piloto (60-250 MB) | PASS |
| Otros artefactos | `dist/win-unpacked/` (extracted runtime) + `dist/builder-debug.yml` |

## Validacion contenido asar

`npx asar list dist/win-unpacked/resources/app.asar` devuelve **145 entries**.

### Key paths (todos PASS)

| Path | Match count | Esperado |
|------|-------------|----------|
| `main.js` | 1 | >=1 PASS |
| `preload.js` | 1 | >=1 PASS |
| `\app\login.html` | 1 | >=1 PASS |
| `\app\index.html` | 1 | >=1 PASS |
| `\app\Inicio\index.html` | 1 | >=1 PASS |
| `\app\Prov Serv` | 13 | >=1 PASS |
| `\app\Talleristas` | 21 | >=1 PASS |
| `\app\Prov Art Terminado` | 13 | >=1 PASS |
| `\app\StockFlejes` | 15 | >=1 PASS |
| `\app\Produccion` | 13 | >=1 PASS |
| `\app\Informes` | 2 | >=1 PASS |

### Exclusiones (todos 0 matches PASS)

| Pattern | Match count | Esperado |
|---------|-------------|----------|
| `.planning` | 0 | 0 PASS |
| `.bas` | 0 | 0 PASS |
| `.xlsx` | 0 | 0 PASS |
| `LOCKS.txt` | 0 | 0 PASS |
| `.vscode` | 0 | 0 PASS |
| `.claude` | 0 | 0 PASS |
| `.git` | 0 | 0 PASS |
| `A Agregar` | 0 | 0 PASS |
| `node_modules` | 0 | 0 PASS |
| `.py` | 0 | 0 PASS |
| `.sh` | 0 | 0 PASS |
| `.xls` | 0 | 0 PASS |

### Top-level dirs en `\app\`

```
Alertas (no-piloto, deshabilitado en Inicio fork de 05-05)
Compras (no-piloto, deshabilitado)
Despiece x Articulo (no-piloto, deshabilitado)
Despiece (no-piloto, deshabilitado)
Disruptivas (no-piloto, deshabilitado)
Facturas (no-piloto, deshabilitado)
Informes (PILOTO)
Inicio (forkeado en 05-05, navigation hub)
Preavisos (no-piloto)
Produccion (PILOTO)
Prov Art Terminado (PILOTO)
Prov Serv (PILOTO)
StockFlejes (PILOTO — 5 sub-paginas)
Talleristas (PILOTO)
+ Diagrama_Sistema.html, index.html, login.html (root assets)
```

Notar: directorios no-piloto SIGUEN incluidos en el .exe — la exclusion via D-04 es solo a nivel UI (botones disabled en Inicio fork) NO a nivel filesystem. Esto era esperado y planeado: D-03 paridad visual + D-04 graceful disable, no re-empaquetado. Si el usuario navega manualmente a esas rutas via URL bar o links residuales, las paginas cargarian (pero el Inicio fork bloquea esa entrada).

## Acceptance Criteria

| Criterio | Resultado |
|----------|-----------|
| `electron-builder --win portable --x64` exit 0 | PASS |
| `dist/gestion-productiva-portable.exe` existe | PASS (88 MB) |
| Tamaño 60-250 MB | PASS (88 MB en rango) |
| asar contiene `main.js` + `preload.js` | PASS (1 + 1) |
| asar contiene `app/login.html` + `app/Inicio/index.html` | PASS |
| asar contiene los 6 grupos piloto | PASS (Talleristas/Prov Serv/Prov AT/StockFlejes/Produccion/Informes) |
| asar NO contiene exclusiones (.planning, .bas, .xlsx, LOCKS.txt) | PASS (0 matches) |

Todos PASS.

## Success Criteria phase

- [x] **SC-1 (parcial):** .exe portable Win x64 generado, listo para mover a destino final en plan 05-07
- N/A SC-2 (smoke test ejecucion) — plan posterior
- N/A SC-3 (CSP) — ya cumplido en 05-03/05-04, .exe hereda
- N/A SC-4 (window.print) — ya cumplido en 05-04, .exe hereda
- [x] **D-13 (sin firma):** signtool.exe se ejecuto pero sin cert configurado, falla silently, .exe queda sin firmar (esperado piloto)
- [x] **D-14 (sin branding):** "default Electron icon is used reason=application icon is not set" — confirmado sin icon custom

## Deviations from Plan

### Auto-fixed (Rule 3 — Blocking issues)

**1. [Rule 3 - Blocking] `app/package.json` faltaba `name` y `version`**

- Found during: Task 1, primer intento de build
- Issue: Build fallo con `Please specify 'name' in the package.json (...\app\package.json)` y `Please specify 'version' in the package.json`. El `app/package.json` venia copiado de la web original (solo `dependencies` con supabase-js/exceljs); electron-builder lo detecta y reclama campos requeridos.
- Fix iter 1: agregue `name: "gestion-productiva-app"`, `version: "1.0.0"`, `description`, `author`, `private: true`. Mantuve `dependencies`.
- Files modified: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\package.json`

**2. [Rule 3 - Blocking] `app/package.json` con `dependencies` rompia node_modules collection**

- Found during: Task 1, segundo intento de build
- Issue: Build fallo con `production dependency @supabase/supabase-js not found for package gestion-productiva-app`. electron-builder buscaba esos modulos en `app/node_modules` pero no existen — la web usa CDN (`<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`), no `require()`.
- Fix iter 2: removi el campo `dependencies` del `app/package.json` (deja solo metadata).
- Files modified: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\package.json`

**3. [Rule 3 - Blocking] `app/package.json` con `main` faltante = "index.js" default no encontrado en asar**

- Found during: Task 1, tercer intento de build
- Issue: Build fallo con `Application entry file "index.js" in the "app.asar" is corrupted: Error: "index.js" was not found in this archive`. La presencia de `app/package.json` activa two-package-json layout en electron-builder: builder asume `app/` es el appDir y busca el `main` ahi (default `index.js`). Pero nuestro entry real es `main.js` en el ROOT del proyecto, fuera de `app/`.
- Fix iter 3: ELIMINE completamente `app/package.json`. El root `package.json` (definido en plan 05-04) tiene `main: "main.js"` correcto y la ausencia del `app/package.json` fuerza single-package-json layout, que es lo que necesitamos.
- Files modified: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\package.json` (deleted)
- Notas: la web original en `Z:\...\Gestion Productiva\package.json` SI tiene esas dependencies — pero solo se usaban como hints documentales (la web carga via CDN, no via npm). Sin `package.json` la web sigue funcionando exactamente igual dentro del Electron renderer.

**4. [Rule 3 - Blocking] winCodeSign-2.6.0.7z extraction fallaba por symlinks darwin**

- Found during: Task 1, cuarto intento de build
- Issue: electron-builder descarga `winCodeSign-2.6.0.7z` (5.6 MB) y lo extrae con 7za. El archivo contiene symlinks `darwin/10.12/lib/libcrypto.dylib` y `darwin/10.12/lib/libssl.dylib`. Windows sin Developer Mode/admin no permite crear symlinks (`SeCreateSymbolicLinkPrivilege` requerido), 7za sale exit 2. electron-builder NO tolera ese exit code y aborta build, aunque el resto del .7z se extrajo OK.
- Fix iter 4: probe varias rutas que no funcionaron (`CSC_IDENTITY_AUTO_DISCOVERY=false`, env vars `SIGNTOOL_PATH` / `ELECTRON_BUILDER_RCEDIT_PATH` / `ELECTRON_BUILDER_WINDOWS_KITS_PATH`, pre-extract manual). El blocker real: `app-builder.exe` (binario Go interno de electron-builder) busca `7za` en PATH y siempre re-descarga + re-extrae con cache filename random.
- Solucion final: cree wrapper `build-tools/7za.cmd` en el proyecto:
  ```cmd
  @echo off
  "C:\...\node_modules\7zip-bin\win\x64\7za.exe" %* -x!darwin
  ```
  Y prepend `build-tools/` al PATH al invocar `npx electron-builder`. El wrapper appendea `-x!darwin` a TODA invocacion de 7za, lo cual filtra los symlinks problematicos. El resto del bundle (rcedit, signtool, openssl, windows kits) se extrae correctamente y builder lo encuentra.
- Files created:
  - `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\build-tools\7za.cmd`
  - `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\noop-sign.js` (creado durante debug pero NO referenciado en build final, queda como dead-code; recomiendo borrar en plan futuro o mantener para auditoria)
- Notas: el `darwin/` folder solo contiene tools para signing en macOS (osslsigncode + libcrypto/libssl macos versions). Excluirlo es 100% safe en Windows portable build.

Las 4 deviations fueron blocking issues que impedian completar el build. Ninguna cambia el spirit del plan: el .exe final cumple exacto con `must_haves.truths` del frontmatter del PLAN.

## Threat Flags

None — no nueva surface. El wrapper 7za.cmd solo filtra extraction de tools, no cambia runtime del .exe. La eliminacion de `app/package.json` no expone nada nuevo (campo no se referenciaba en runtime, solo en build-time tooling).

## Self-Check

### Files exist

- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\dist\gestion-productiva-portable.exe` (92,303,063 bytes, 88 MB)
- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\dist\win-unpacked\` (extracted electron runtime + app.asar)
- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\build-tools\7za.cmd`
- DELETED (intencional, deviation #3): `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\package.json`

### asar list checks

- FOUND: `main.js` (1 match), `preload.js` (1 match)
- FOUND: `\app\login.html`, `\app\index.html`, `\app\Inicio\index.html` (1 c/u)
- FOUND: 6 grupos piloto (Talleristas 21, Prov Serv 13, Prov Art Terminado 13, StockFlejes 15, Produccion 13, Informes 2)
- NOT FOUND: `.planning`, `.bas`, `.xlsx`, `LOCKS.txt`, `.vscode`, `.claude`, `.git`, `A Agregar`, `node_modules`, `.py`, `.sh`, `.xls` (todos 0 matches)
- TOTAL: 145 entries en asar

## Self-Check: PASSED

## Notes para 05-07

- `gestion-productiva-portable.exe` esta en `C:\...\Prueba_Apliaciones_en_Local\dist\`. El plan 05-07 (mover a destino final) puede `cp` o `mv` directo desde ahi.
- Build subsiguiente (re-run de `npm run build`) sera mucho mas rapido (~30s) por marker `.complete` en el cache de winCodeSign — siempre que el wrapper 7za.cmd siga en PATH (puede no necesitarse si ya está extraido, pero por seguridad mantenerlo).
- `.exe` no firmado (D-13). Windows SmartScreen mostrara warning al ejecutar primera vez por usuario — esperado piloto, abordado en plan posterior si aplica.
- Si se re-genera el `app/package.json` accidentalmente (e.g., `npm install` futuro), build volvera a romper. Documentar en CONTEXT que NO debe existir.
