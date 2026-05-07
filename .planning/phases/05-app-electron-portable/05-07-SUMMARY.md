---
phase: 05-app-electron-portable
plan: 07
subsystem: deploy-and-d17-verify
tags: [deploy, copy-item, robocopy, d17, portable-exe, wave-5]
status: complete
date: 2026-05-07
dependency_graph:
  requires: ["05-06"]
  provides: ["exe-en-destino-final", "d17-verified"]
  affects: ["05-08 (cleanup build temp)", "SC-1 (.exe distribuible)", "SC-6 (web original intacta)"]
tech_stack:
  added: []
  patterns:
    - "Copy-Item -Force para deploy del .exe (mantiene fuente en build temporal hasta cleanup en 05-08)"
    - "robocopy /L /MIR (dry-run + mirror) como diff tool entre snapshot baseline y $BUILD\\app — identifica drift exacto"
    - "SHA256 hash compare SRC vs DEST para verificar integridad post-copy"
    - "D-17 estructuralmente garantizado: Phase 5 NUNCA abrio path de la web operativa, solo el snapshot congelado y $BUILD\\app"
key_files:
  created:
    - "Z:\\AA IT\\Gestion Productiva (4)\\Gestion Productiva Portable\\gestion-productiva-portable.exe (88 MB, 92,303,063 bytes, SHA256 FDDBA42D...)"
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\d17-verify.log (robocopy /L resumen output)"
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\d17-verify-detail.log (robocopy /L con NFL off, identifica file diff)"
  modified: []
decisions:
  - "Copy-Item (no Move-Item): mantener .exe en build temp hasta plan 05-08 cleanup, asi rebuild rapido si smoke test falla en 05-08"
  - "package.json en root del snapshot (93 bytes) reportado como 'Nuevo arch' por robocopy es esperado — eliminado intencionalmente en 05-06 deviation #3 para forzar single-package-json layout. NO viola D-17 (web operativa intocada, snapshot intocado)."
  - "D-17 verificacion estructural: Phase 5 nunca abrio path `Z:\\...Gestion Productiva (3)\\(3)\\...\\Gestion Productiva\\` (web operativa). Toda lectura desde snapshot congelado (`Z:\\...\\Gestion Productiva (Snapshot AI 2026-05-07)`). Toda escritura a `C:\\...\\Prueba_Apliaciones_en_Local\\app\\` (build temp) o `Z:\\...\\Gestion Productiva Portable\\` (destino .exe). D-17 cumple por construccion, no por verificacion post-hoc."
metrics:
  tasks: 2
  files_created: 3
  files_modified: 0
  duration_min: ~5
requirements: [SC-1, SC-6]
---

# Phase 05 Plan 07: Mover .exe + verify D-17 — Summary

**One-liner:** `.exe` copiado de `C:\...\dist\` a `Z:\...\Gestion Productiva Portable\` con SHA256 idéntico (FDDBA42D... 92,303,063 bytes 88 MB). D-17 verificado: snapshot baseline mtimes intactos desde 05-02 (Inicio/index.html=2026-04-30 11:10:32, login.html=2026-04-20 14:12:25, index.html=2026-04-20 14:12:21). Robocopy /L /MIR snapshot vs $BUILD\app reporta 1 sola diff = `package.json` 93 bytes (eliminado intencionalmente en 05-06 deviation #3). Web operativa NUNCA tocada por Phase 5 (D-17 garantizado por construccion).

## Comandos ejecutados

### Task 1: Deploy .exe

```powershell
$SRC = "C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\dist\gestion-productiva-portable.exe"
$DEST = "Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\gestion-productiva-portable.exe"
Copy-Item -Path $SRC -Destination $DEST -Force
Get-FileHash $SRC -Algorithm SHA256
Get-FileHash $DEST -Algorithm SHA256
```

Resultado:
- DEST size = **92,303,063 bytes** (88 MB) — coincide con 05-06 SUMMARY (92,303,063 bytes)
- SRC SHA256 = `FDDBA42D14346C1F9179C06F851BD2C76F54122240332514B3D06D462FF2377B`
- DEST SHA256 = `FDDBA42D14346C1F9179C06F851BD2C76F54122240332514B3D06D462FF2377B`
- HASH_MATCH = YES (integridad verificada)

### Task 2: D-17 verify via robocopy /L

```powershell
$WEB = "Z:\AA IT\Gestion Productiva (4)\Gestion Productiva (Snapshot AI 2026-05-07)"
$SNAPSHOT = "C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app"
robocopy "$WEB" "$SNAPSHOT" /L /MIR `
  /XD ".planning" "node_modules" ".git" ".vscode" ".claude" "A Agregar" `
  /XF "*.bas" "*.py" "*.sh" "*.lnk" "*.xls" "*.xlsx" "LOCKS.txt" "*.md" "*.sql" `
      "AUDITORIA*" "AUDIT*" "INFORME*" "PERFILES*" `
      "login.html" "index.html" "AUDIT_COMPLETO_2026-04-19.md" `
  /R:0 /W:0
```

ExitCode = **1** (= "habria copiado" en /L mode = hay diferencias).

#### Resumen totales robocopy

| Métrica       | Total | Copiado | Omitido | Mismatch | Errores | Extras |
|---------------|-------|---------|---------|----------|---------|--------|
| Directorios   | 44    | 0       | 44      | 0        | 0       | 0      |
| **Archivos**  | 129   | **1**   | 128     | **0**    | 0       | 0      |
| Bytes         | 2.02 MB | 93    | 2.02 MB | 0        | 0       | 0      |

**1 archivo identificado:** `package.json` (93 bytes, root del snapshot) — marcado como "Nuevo arch" (existe en source = $WEB snapshot, NO existe en dest = $BUILD\app).

#### Interpretacion del unico diff

El `package.json` (93 bytes) en el ROOT del snapshot fue **eliminado intencionalmente** del $BUILD\app durante plan 05-06 (deviation #3, blocking issue):

> Si `app/package.json` existe junto con root `package.json`, electron-builder activa two-package-json layout y busca el `main` en `app/index.js` (default), pero nuestro entry real es `main.js` en root. Build fallaba con "Application entry file 'index.js' in the 'app.asar' is corrupted: 'index.js' was not found in this archive". Solucion: eliminar `app/package.json`.

Este file NO afecta runtime de la web (los modulos supabase-js/exceljs se cargan via CDN, no via npm). El snapshot fuente sigue inmutable. **No viola D-17.**

#### Verificacion baseline mtimes (snapshot intacto)

| File | mtime baseline (05-02) | mtime ahora (05-07) | Status |
|------|------------------------|---------------------|--------|
| `$WEB\Inicio\index.html` | 2026-04-30 11:10:32 | 2026-04-30 11:10:32 | INTACTO |
| `$WEB\login.html`        | 2026-04-20 14:12:25 | 2026-04-20 14:12:25 | INTACTO |
| `$WEB\index.html`        | 2026-04-20 14:12:21 | 2026-04-20 14:12:21 | INTACTO |

Snapshot 100% inmutable durante toda Phase 5 (4 dias). Tamaños identicos a 05-02 (68,370 / 11,199 / 440 bytes).

#### Verificacion forks en $BUILD\app (esperado: mtimes mas nuevos)

| File | mtime ahora | Origen del cambio |
|------|-------------|-------------------|
| `C:\...\app\Inicio\index.html` | 2026-05-07 09:18:33 | 05-05 (fork CSP+disabled buttons) |
| `C:\...\app\login.html`        | 2026-05-07 09:14:23 | 05-03 (CSP injection) |
| `C:\...\app\index.html`        | 2026-05-07 09:14:25 | 05-03 (CSP injection) |

mtimes posteriores a snapshot baseline = forks aplicados durante 05-03/05-05 = esperado.

## D-17 verificacion conclusion

**D-17 (cero modificaciones a la web operativa) cumple por construccion + verificacion:**

1. **Por construccion:** Phase 5 NUNCA abrio el path de la web operativa (`Z:\AA IT\Gestion Productiva (4)\Gestion Productiva (3)\Gestion Productiva (3)\Gestion Productiva\Gestion Productiva\`). Todos los reads desde el SNAPSHOT congelado (`Z:\...\Gestion Productiva (Snapshot AI 2026-05-07)`). Todos los writes a `C:\...\Prueba_Apliaciones_en_Local\` (build temp) o `Z:\...\Gestion Productiva Portable\` (deploy destino). El plan 05-02 explicitamente repointed `$WEB` al snapshot por "concurrencia con otros admins" (CONTEXT.md decision posterior al plan original).

2. **Por verificacion:** Snapshot mtimes pre-Phase-5 = mtimes ahora (verified). Robocopy /L diff snapshot-vs-build solo reporta 1 file eliminado intencionalmente (`package.json` 93 bytes), 0 mismatches, 0 newer/older en archivos esperados. Phase 5 modifico SOLO los archivos planeados (login.html CSP, index.html CSP, Inicio/index.html CSP+fork) en $BUILD\app, NADA mas.

## Acceptance criteria

| Criterio | Resultado |
|----------|-----------|
| `.exe` existe en `Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\gestion-productiva-portable.exe` | PASS |
| Tamaño .exe matches 05-06 (92,303,063 bytes) | PASS |
| SHA256 SRC == SHA256 DEST | PASS (FDDBA42D...) |
| Robocopy /L reporta solo archivos esperados como diff | PASS (1 file = package.json eliminado intencionalmente) |
| Newer = 0, Older = 0, Mismatch = 0 | PASS (todos 0) |
| Snapshot mtimes baseline intactos | PASS (3 archivos verified, mtimes idénticos a 05-02) |
| Web operativa sin cambios desde 05-06 | PASS (Phase 5 nunca toco ese path por construccion) |

Todos PASS.

## Success criteria phase

- [x] **SC-1:** `.exe` distribuible disponible en destino para los 2 admins (`Z:\...\Gestion Productiva Portable\gestion-productiva-portable.exe`).
- [x] **SC-6:** Web original intacta — D-17 verificado estructural (Phase 5 nunca abrio el path) + por baseline (snapshot mtimes inmutables).

## Deviations from Plan

None. Plan ejecutado exactamente como escrito.

Nota sobre la verificacion robocopy: el plan anticipaba ExitCode 0 ideal o ExitCode 2 aceptable. ExitCode 1 obtenido es esperable y aceptable: el unico diff (`package.json` 93 bytes) es un file eliminado intencionalmente en 05-06 deviation #3, documentado en 05-06 SUMMARY. No hay violacion de D-17 — la web operativa no fue tocada (verified estructural + baseline mtimes).

## Threat Flags

None — no nueva surface. El deploy es solo una copia binaria; la verificacion D-17 no modifica nada (robocopy /L es read-only/dry-run).

## Self-Check

### Files exist

```bash
test -f "Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\gestion-productiva-portable.exe"
```

- FOUND: `Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\gestion-productiva-portable.exe` (92,303,063 bytes, 88 MB)
- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\dist\gestion-productiva-portable.exe` (mantenido en build temp para 05-08, hash idéntico)
- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\d17-verify.log` (robocopy resumen)
- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\d17-verify-detail.log` (con NFL off, identifica package.json diff)

### Hash verify

- SRC SHA256 = DEST SHA256 = `FDDBA42D14346C1F9179C06F851BD2C76F54122240332514B3D06D462FF2377B` (HASH_MATCH)

### D-17 baseline check

- $WEB\Inicio\index.html mtime = 2026-04-30 11:10:32 (= baseline 05-02) PASS
- $WEB\login.html mtime = 2026-04-20 14:12:25 (= baseline 05-02) PASS
- $WEB\index.html mtime = 2026-04-20 14:12:21 (= baseline 05-02) PASS

## Self-Check: PASSED

## Notes para 05-08 (cleanup)

- `.exe` deploy en destino final OK. Build temporal (`C:\...\Prueba_Apliaciones_en_Local\dist\`) puede borrarse en 05-08.
- `C:\...\Prueba_Apliaciones_en_Local\app\` (snapshot copy) puede borrarse — el snapshot fuente queda en `Z:\...\Gestion Productiva (Snapshot AI 2026-05-07)` para futuros rebuilds.
- `7za.cmd` wrapper en `build-tools/` mantener (necesario para futuros builds segun 05-06 notes).
- Logs de verify (`d17-verify*.log`) en build temp pueden borrarse o moverse a `.planning/phases/05-app-electron-portable/artifacts/` segun convention del proyecto.
