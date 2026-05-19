---
phase: 05-app-electron-portable
plan: 03
subsystem: electron-portable
tags: [csp, security, electron, supabase-cdn]
status: complete
date: 2026-05-07
dependency_graph:
  requires: ["05-02"]
  provides: ["meta-csp-injected"]
  affects: ["05-04 main.js BrowserWindow", "SC-3 login Supabase"]
tech_stack:
  added: []
  patterns: ["meta http-equiv CSP en HTML head"]
key_files:
  created: []
  modified:
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\login.html"
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\index.html"
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\Inicio\\index.html"
decisions:
  - "CSP inyectado solo en snapshot $BUILD\\app — web original Z:\\... NO modificada (D-17)"
  - "CSP permisivo con 'unsafe-inline' + 'unsafe-eval' por compat con codigo legacy. jsdelivr whitelist para supabase-js. Hardening estricto fuera de scope phase 05."
  - "Tag insertado como primer hijo de <head> (antes de charset en login/index, antes de auth-guard.js script en Inicio)"
metrics:
  tasks: 1
  files_modified: 3
  duration_min: 2
---

# Phase 05 Plan 03: Inyectar CSP meta tag — Summary

**One-liner:** CSP meta tag inyectado en los 3 entry HTMLs del snapshot Electron (`login.html`, `index.html`, `Inicio/index.html`) — habilita Supabase JS via CDN jsdelivr y conexiones HTTPS+WebSocket a `*.supabase.co`.

## Archivos modificados

| Archivo                                                                              | Posicion CSP                       |
| ------------------------------------------------------------------------------------ | ---------------------------------- |
| `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\login.html`             | primer hijo de `<head>` (linea 4)  |
| `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\index.html`             | primer hijo de `<head>` (linea 4)  |
| `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Inicio\index.html`      | primer hijo de `<head>` (linea 4)  |

## CSP Value Literal Inyectado

```
default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data: blob: https:;
```

Tag completo:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data: blob: https:;">
```

## Verificacion

### grep `Content-Security-Policy` count

```
C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\login.html:1
C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\index.html:1
C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Inicio\index.html:1
```

### CDN whitelist (`cdn.jsdelivr.net` en CSP)

Presente en los 3. `login.html` e `Inicio/index.html` reportan 2 occurrences (1 en CSP + 1 en `<script src=https://cdn.jsdelivr.net/...>` original) — comportamiento esperado.

### WebSocket Supabase (`wss://*.supabase.co` en connect-src)

Presente en los 3 archivos.

### D-17 Web original NO modificada

Mtimes pre/post identicos:

| Archivo                                             | mtime pre                       | mtime post                      |
| --------------------------------------------------- | ------------------------------- | ------------------------------- |
| `Z:\...\Gestion Productiva\login.html`              | 2026-04-20 14:12:25.712998600   | 2026-04-20 14:12:25.712998600   |
| `Z:\...\Gestion Productiva\index.html`              | 2026-04-20 14:12:21.681980400   | 2026-04-20 14:12:21.681980400   |
| `Z:\...\Gestion Productiva\Inicio\index.html`       | 2026-04-30 11:10:32.244832200   | 2026-04-30 11:10:32.244832200   |

Web original intacta. Solo `$BUILD\app` modificado.

## Acceptance Criteria

- [x] `grep -c "Content-Security-Policy"` >= 1 en cada uno de los 3 archivos (todos =1)
- [x] CSP contiene `cdn.jsdelivr.net` (script-src)
- [x] CSP contiene `wss://*.supabase.co` (connect-src realtime)
- [x] CSP contiene `https://*.supabase.co` (connect-src REST)
- [x] Web original sin cambios (mtime identico pre/post)

## Deviations from Plan

None — plan ejecutado exacto. Tag CSP literal coincide con `<interfaces>` del PLAN.

## Decisions Made

- **CSP permisivo (`unsafe-inline` + `unsafe-eval`)** — codigo legacy de la web tiene event handlers inline y eval. Hardening estricto = phase futura.
- **Tag como primer hijo de `<head>`** — best practice CSP (browser parsea CSP antes de cualquier otra cosa). En `Inicio/index.html` quedo antes de `<script src="../auth-guard.js">` que es lo correcto.
- **NO commit git** — proyecto sin repo (working dir no es git repo). Cambios persistidos en filesystem.

## Threat Flags

None — sin nueva surface. CSP es defense-in-depth para surface ya existente (CDN + Supabase HTTPS/wss documentados en threat model PLAN).

## Self-Check

### Files exist

- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\login.html`
- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\index.html`
- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Inicio\index.html`

### CSP grep

- FOUND: 1 occurrence en login.html
- FOUND: 1 occurrence en index.html
- FOUND: 1 occurrence en Inicio/index.html

## Self-Check: PASSED

## Next Plan

`05-04` — main.js Electron con `BrowserWindow({ webPreferences: { contextIsolation: true, nodeIntegration: false } })` apuntando a `app/index.html`.
