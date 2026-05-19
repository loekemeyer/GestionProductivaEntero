---
phase: 05-app-electron-portable
plan: 02
subsystem: build-snapshot
tags: [robocopy, snapshot, web-copy, wave-1, exclusions]
requires:
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\ (vacia, creada en 05-01)"
  - "Z:\\AA IT\\Gestion Productiva (4)\\Gestion Productiva (Snapshot AI 2026-05-07)\\ (snapshot congelado de la web)"
provides:
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\ (108 archivos / 1.57 MB / 23 dirs top-level)"
  - "$BUILD\\app\\Inicio\\index.html (sera forkeado en 05-05)"
  - "$BUILD\\app\\login.html (login Supabase, D-09)"
  - "$BUILD\\app\\auth-guard.js (guard de sesion)"
  - "$BUILD\\app\\index.html (entry point)"
  - "6 grupos piloto: Prov Serv, Talleristas, Prov Art Terminado, StockFlejes, StockSP, Produccion + Informes"
affects: []
tech_stack_added: []
patterns_established:
  - "robocopy /MIR con /XD y /XF para snapshot read-only de la web (D-17 baseline)"
  - "Origen = Snapshot AI 2026-05-07 (congelado), no la web operativa (D-17 hardening)"
key_files_created:
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\login.html"
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\index.html"
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\auth-guard.js"
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\Inicio\\index.html"
  - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\* (108 archivos total en 23 dirs top-level)"
key_files_modified: []
decisions:
  - "Origen = SNAPSHOT congelado (Z:\\...\\Gestion Productiva (Snapshot AI 2026-05-07)), NO la web operativa — protege contra modificaciones concurrentes durante build"
  - "Exclusiones aplicadas (D-17 + tamaño): /XD .planning, node_modules, .git, .vscode, .claude, 'A Agregar' / /XF *.bas, *.py, *.sh, *.lnk, *.xls, *.xlsx, LOCKS.txt, *.md, *.sql, AUDITORIA*, AUDIT*, INFORME*, PERFILES*"
  - "robocopy /MIR es read-only desde origen — mtime del snapshot fuente queda intacto"
metrics:
  duration: "~1 segundo (robocopy)"
  completed_date: "2026-05-07"
  tasks_total: 1
  tasks_completed: 1
  files_created: 108
  files_modified: 0
requirements: [SC-1, SC-2, SC-6]
---

# Phase 5 Plan 02: Snapshot Web -> $BUILD/app Summary

Robocopy /MIR copio 108 archivos (1.57 MB) del snapshot congelado a `$BUILD\app` con exclusiones aplicadas. Web operativa intocada (D-17). Los 6 grupos piloto + login + Inicio + auth-guard.js verificados.

## Que se hizo

### Task 1: Robocopy snapshot -> $BUILD/app

Comando ejecutado (envuelto en .ps1 para evitar expansion bash de `$WEB`/`$BUILD`):

```powershell
$WEB = "Z:\AA IT\Gestion Productiva (4)\Gestion Productiva (Snapshot AI 2026-05-07)"
$BUILD = "C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local"
robocopy "$WEB" "$BUILD\app" /MIR `
  /XD ".planning" "node_modules" ".git" ".vscode" ".claude" "A Agregar" `
  /XF "*.bas" "*.py" "*.sh" "*.lnk" "*.xls" "*.xlsx" "LOCKS.txt" "*.md" "*.sql" `
      "AUDITORIA*" "AUDIT*" "INFORME*" "PERFILES*" `
  /NFL /NDL /NP
```

Resultado robocopy:

| Metrica           | Valor    |
|-------------------|----------|
| Directorios total | 44       |
| Directorios copiados | 37    |
| Directorios omitidos | 7 (exclusiones) |
| Archivos total    | 129      |
| Archivos copiados | 108      |
| Archivos omitidos | 21 (exclusiones por patron) |
| Bytes copiados    | 1.57 MB  |
| ExitCode          | **1** (OK — `1` = archivos copiados, `< 8` = sin error) |
| Tiempo            | < 1 seg  |

## Verificacion 11 paths piloto (post-robocopy)

```
True  login.html
True  index.html
True  auth-guard.js
True  Inicio\index.html
True  Prov Serv\Entregas\EntregaPS.html
True  Talleristas\Recepcion\Recepcion Cervantes.html
True  Prov Art Terminado\Entregas\EntregasAT.html
True  StockFlejes\flejes.html
True  StockSP\StockSP.html
True  Produccion\maestro.html
True  Informes\index.html
```

Todos True (11/11).

## Verificacion exclusiones (must be False / count 0)

### Directorios excluidos (`/XD`)

```
False .planning
False .git
False node_modules
False .vscode
False .claude
False A Agregar
```

### Archivos excluidos (`/XF`) — patron count en $BUILD\app:

| Patron   | Count en $BUILD\app |
|----------|---------------------|
| *.bas    | 0                   |
| *.xlsx   | 0                   |
| *.py     | 0                   |
| *.md     | 0                   |
| LOCKS.txt | (False, no existe)  |

Exclusiones efectivas — ningun archivo no-runtime se filtro.

## Top-level directories en $BUILD\app (23)

```
Alertas, Compras, Despiece, Despiece x Articulo, Disruptivas,
Facturas, Gestion Productiva, Informes, Inicio, Preavisos,
Produccion, Prov Art Terminado, Prov Serv, StockFlejes,
StockMovimiento, Stocks General, StockSC, StockSP,
StockTransitoPS, Talleristas, Ventas Chat, Verificacion, VerifMadres
```

Incluye los **6 grupos piloto** + **Informes** + auxiliares (Alertas/Compras/Despiece/etc.) que comparten links/recursos cruzados.

## Tamaño total / count

- **Archivos:** 108
- **Bytes:** 1,650,800 (1.57 MB)
- **Dirs top-level:** 23

## mtime de $WEB\Inicio\index.html (para usar en plan 05-07)

| Momento              | LastWriteTime           |
|----------------------|-------------------------|
| Pre-robocopy         | 2026-04-30 11:10:32     |
| Post-robocopy        | 2026-04-30 11:10:32     |

**Identico** — robocopy /MIR es read-only desde origen. D-17 cumplido tambien sobre el snapshot fuente.

mtime adicionales del snapshot fuente (referencia para 05-07):
- `$WEB\login.html` — 2026-04-20 14:12:25
- `$WEB\index.html` — 2026-04-20 14:12:21

## Acceptance criteria

- [x] 11 paths piloto Test-Path = True (login, index, auth-guard.js, Inicio, 6 grupos modulares + Informes)
- [x] Exclusiones efectivas: .planning/, .git/, LOCKS.txt, *.bas, *.xlsx ausentes en $BUILD\app
- [x] Robocopy exit code < 8 (= 1, OK)
- [x] Snapshot fuente sin modificaciones de mtime (robocopy /MIR es read-source)

## Success criteria phase

- [x] **SC-1:** codigo listo para empaquetar (snapshot completo en $BUILD\app).
- [x] **SC-2:** 6 grupos piloto presentes (path checks True).
- [x] **SC-6 (precondicion):** copia es read-only desde web (D-17 sobre snapshot).

## Aislamiento web original (D-17)

- Origen del robocopy = `Z:\...\Gestion Productiva (Snapshot AI 2026-05-07)` (snapshot congelado).
- La web operativa real (`Z:\...\Gestion Productiva (3)\(3)\...\Gestion Productiva`) NO se toco en este plan.
- mtime del snapshot fuente intacto post-robocopy (verificado).
- Verificacion exhaustiva D-17 (`robocopy /L`) se hace al final del phase (plan posterior).

## Deviations from Plan

None - plan executed exactly as written.

Nota tecnica (no es deviation, no requirio fix):
- Los comandos `powershell -Command` invocados via Bash tool sufren expansion de `$VAR` por bash antes de pasar a PS. Solucionado envolviendo en `.ps1` ejecutado con `-ExecutionPolicy Bypass -File`. Los `.ps1` temporales se borraron al final.

## Notas para wave 2 (siguiente plan)

- `$BUILD\app\` listo para `electron-builder` (plan 05-04 sobrescribe `package.json` con `build.files = ["app/**"]`).
- `$BUILD\app\Inicio\index.html` se forkea en plan 05-05 (cambio de version label, banner electron, etc.).
- mtime de archivos copiados refleja el del snapshot fuente — util para detectar drift en 05-07.

## Self-Check: PASSED

Verified files exist:
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\login.html — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\index.html — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\auth-guard.js — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Inicio\index.html — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Prov Serv\Entregas\EntregaPS.html — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Talleristas\Recepcion\Recepcion Cervantes.html — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Prov Art Terminado\Entregas\EntregasAT.html — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\StockFlejes\flejes.html — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\StockSP\StockSP.html — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Produccion\maestro.html — FOUND
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Informes\index.html — FOUND

Verified exclusions absent:
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\.planning — ABSENT (correct)
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\.git — ABSENT (correct)
- C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\node_modules — ABSENT (correct)
- *.bas / *.xlsx / *.py / *.md count = 0 in tree (correct)

No git commits this plan (build temp folder NOT a git repo, per CLAUDE.md note "NO ejecutes commits git").
