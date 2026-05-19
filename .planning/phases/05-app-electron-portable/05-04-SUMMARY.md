---
phase: 05-app-electron-portable
plan: 04
subsystem: electron-shell
tags: [electron, electron-builder, main-process, preload, contextBridge, portable, wave-2]
requires:
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\node_modules\\electron@42.0.0 (de 05-01)"
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\node_modules\\electron-builder@26.8.1 (de 05-01)"
provides:
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\main.js (BrowserWindow + IPC handler)"
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\preload.js (contextBridge openExternal)"
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\package.json (electron-builder config target portable)"
affects: []
tech_stack_added: []
patterns_established:
  - "Pattern 1 RESEARCH: main.js minimo BrowserWindow con contextIsolation:true / nodeIntegration:false"
  - "Pattern 2 RESEARCH: preload.js contextBridge minimo (solo openExternal)"
  - "Pattern 3 RESEARCH: package.json con build.win.target=portable + 15 exclusiones"
key_files_created:
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\main.js (31 lineas, 786 bytes)"
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\preload.js (5 lineas, 179 bytes)"
key_files_modified:
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\package.json (sobrescrito: 17 -> 53 lineas, defaults npm-init -> electron-builder config completa)"
decisions:
  - "main.js usa sandbox:false (preload con require de electron necesita node context; sandbox:true habria roto contextBridge segun docs Electron)"
  - "main.js setMenuBarVisibility(false) para ocultar menu File/Edit/View default de Electron (cumple D-14 sin branding sin agregar branding)"
  - "preload.js NO expone print() — window.print() funciona directo desde renderer sin IPC (D-07)"
  - "preload.js NO expone fs/child_process/exec — D-08 estricto, solo openExternal"
  - "package.json devDependencies declara ^42.0.0 / ^26.0.0 (semver), npm respeta lo ya instalado (42.0.0 / 26.8.1) — no downgrade"
  - "build.files glob incluye main.js, preload.js, app/**/* + 15 exclusiones (sumadas .vscode, .claude, A Agregar, *.sql respecto a Pattern 3 base)"
  - "asar:true (recomendado, empaqueta app/ en blob unico)"
  - "portable.unpackDirName:false (extrae a %TEMP%\\<uuid>\\ sin conflicto multi-launch)"
metrics:
  duration: "~1 min (write 3 archivos + npm install reconciliacion + validaciones)"
  completed_date: "2026-05-07"
  tasks_total: 2
  tasks_completed: 2
  files_created: 2
  files_modified: 1
requirements: [SC-1, SC-3, SC-4]
---

# Phase 5 Plan 04: main.js + preload.js + package.json Summary

Shell Electron creado: BrowserWindow con contextIsolation, preload contextBridge minimo (solo openExternal), package.json con electron-builder target portable Win x64 y artifactName fijo.

## Que se hizo

### Task 1: main.js + preload.js

**main.js** (31 lineas, contenido literal):

```javascript
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
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'app', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('open-external', (_evt, url) => shell.openExternal(url));
```

**preload.js** (5 lineas, contenido literal):

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gpPortable', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url)
});
```

Validaciones que pasaron:
- `node --check main.js` -> exit 0 (SYNTAX OK)
- `node --check preload.js` -> exit 0 (SYNTAX OK)
- `grep 'contextIsolation: true' main.js` -> match (ctxIso OK)
- `grep 'nodeIntegration: false' main.js` -> match (nodeInt OK)
- `grep 'loadFile.*app.*index\.html' main.js` -> match (loadFile OK)
- `grep "ipcMain.handle('open-external'" main.js` -> match (ipc OK)
- `grep 'contextBridge.exposeInMainWorld' preload.js` -> match (ctxBridge OK)
- `grep 'openExternal' preload.js` -> match (openExt OK)
- NOT `webSecurity: false` en main.js -> confirmed absent
- NOT `nodeIntegration: true` en main.js -> confirmed absent

### Task 2: package.json sobrescrito

**Estado anterior:** 17 lineas, defaults `npm init -y` (`name: prueba_apliaciones_en_local`, `main: index.js`, scripts solo `test` placeholder).

**Estado nuevo:** 53 lineas, electron-builder config completa.

Shape clave del package.json:

| Campo | Valor |
|-------|-------|
| name | `gestion-productiva-portable` |
| productName | `Gestion Productiva Portable` |
| version | `1.0.0` |
| main | `main.js` |
| scripts.start | `electron .` |
| scripts.build | `electron-builder --win portable --x64` |
| devDependencies.electron | `^42.0.0` |
| devDependencies.electron-builder | `^26.0.0` |
| build.appId | `com.loeke.gestionproductiva.portable` |
| build.productName | `Gestion Productiva Portable` |
| build.directories.output | `dist` |
| build.files | array con `main.js`, `preload.js`, `app/**/*` + 15 exclusiones |
| build.asar | `true` |
| build.win.target[0].target | `portable` |
| build.win.target[0].arch[0] | `x64` |
| build.win.artifactName | `gestion-productiva-portable.exe` |
| build.portable.artifactName | `gestion-productiva-portable.exe` |
| build.portable.unpackDirName | `false` |

Lista completa de exclusiones (15) en `build.files`:
```
!app/.planning/**
!app/node_modules/**
!app/.git/**
!app/.vscode/**
!app/.claude/**
!app/A Agregar/**
!app/LOCKS.txt
!app/*.md
!app/*.bas
!app/*.py
!app/*.sh
!app/*.lnk
!app/*.xls
!app/*.xlsx
!app/*.sql
```

Validaciones que pasaron:
- `npm install --silent` -> exit 0, sin output (lockfile ya consistente con devDeps declaradas)
- `JSON.parse(package.json)` -> OK
- `p.main === 'main.js'` -> true
- `p.scripts.build.includes('portable')` -> true
- `p.build.win.target[0].target === 'portable'` -> true
- `p.build.win.target[0].arch[0] === 'x64'` -> true
- `p.build.files.includes('main.js' / 'preload.js' / 'app/**/*')` -> all true
- `p.build.portable.artifactName === 'gestion-productiva-portable.exe'` -> true
- `p.build.appId === 'com.loeke.gestionproductiva.portable'` -> true

Output script: `PKG OK`.

## Acceptance criteria

### Task 1
- [x] `node --check main.js` exit 0
- [x] `node --check preload.js` exit 0
- [x] main.js contiene `contextIsolation: true`
- [x] main.js contiene `nodeIntegration: false`
- [x] main.js contiene `loadFile(...app...index.html)`
- [x] main.js contiene `ipcMain.handle('open-external'`
- [x] preload.js contiene `contextBridge.exposeInMainWorld`
- [x] preload.js contiene `openExternal`
- [x] main.js NO contiene `webSecurity: false`
- [x] main.js NO contiene `nodeIntegration: true`

### Task 2
- [x] package.json parseable como JSON valido
- [x] `main` = `main.js`
- [x] `scripts.build` contiene `portable`
- [x] `build.win.target[0].target` = `portable`
- [x] `build.win.target[0].arch[0]` = `x64`
- [x] `build.files` incluye main.js + preload.js + app/**/* + exclusiones (.planning, .git, *.bas, *.py, *.xls, *.xlsx, LOCKS.txt, etc)
- [x] `build.portable.artifactName` = `gestion-productiva-portable.exe`
- [x] `build.appId` = `com.loeke.gestionproductiva.portable`

### must_haves frontmatter (PLAN)
- [x] main.js: BrowserWindow con contextIsolation:true + nodeIntegration:false
- [x] main.js: loadFile a app/index.html
- [x] preload.js: contextBridge expone solo openExternal (D-08)
- [x] package.json: main + scripts.build + build.win.target=portable + build.files con exclusiones
- [x] node --check OK en main.js y preload.js
- [x] Artefactos: main.js (31 lineas, >=25 OK), preload.js (5 lineas, >=5 OK), package.json contiene "portable"
- [x] Key links: preload via webPreferences.preload path.join, app/index.html via loadFile, build.files glob app/**/*

## Success criteria phase

- [x] **SC-1 (precondicion):** build config completa en package.json
- [x] **SC-3:** CSP via webPreferences default — `contextIsolation:true` + `nodeIntegration:false` + meta tag CSP del plan 05-03
- [x] **SC-4:** window.print() funciona out-of-box (Chromium nativo, dialog OS) — no requiere config en main.js
- [x] **D-08:** IPC minimo (solo `open-external` handler, solo `openExternal` expuesto al renderer)
- [x] **D-13:** sin firma (no se configuro `forceCodeSigning`, no se incluyo cert)
- [x] **D-14:** sin branding (sin `icon`, sin `splashScreen`, productName generico)

## Threat surface scan

Sin nuevos surfaces fuera del threat_model del plan:
- T-05-04 (E elevation, preload bridge): mitigado — `contextIsolation:true`, solo `openExternal` expuesto, NO `fs`/`child_process`/`require`
- T-05-05 (T tampering, shell.openExternal): aceptado — URLs hardcodeadas, sin user input
- T-05-06 (S spoofing, URL desconocida): aceptado — renderer solo invoca con paths file:// internos

Sin Threat Flags nuevos.

## Deviations from Plan

None - plan executed exactly as written.

Notas menores (no son deviations):
- `npm install --silent` no produjo output (lockfile ya en sync porque 05-01 instalo las mismas semver ranges). No requirio cambios.
- Las exclusiones del Pattern 3 base (RESEARCH lineas 311-326) se ampliaron en el plan 05-04 con `.vscode`, `.claude`, `A Agregar`, `*.sql` (8 -> 15 exclusiones). Todas declaradas en el plan, ejecutadas literal.

## Notas para wave 2 siguiente (build)

- `npm start` (desde `$BUILD`) deberia abrir Electron apuntando a `app/index.html` cuando wave 1 haya copiado la web a `app/`.
- `npm run build` (= `electron-builder --win portable --x64`) generara `dist/gestion-productiva-portable.exe`.
- Si surge issue de paths con espacios (Pitfall 1 RESEARCH), validar con `npx asar list dist/win-unpacked/resources/app.asar` post-build.

## Self-Check: PASSED

Verified files exist:
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\main.js — FOUND (786 bytes, 31 lines)
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\preload.js — FOUND (179 bytes, 5 lines)
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\package.json — FOUND (1264 bytes, 53 lines)

Validations executed and passed:
- `node --check main.js` -> exit 0
- `node --check preload.js` -> exit 0
- `node -e "JSON.parse(...)"` shape script -> `PKG OK`

No git commits this plan (build temp folder NOT a git repo, mismo criterio que 05-01).
