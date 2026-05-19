---
phase: 5
slug: app-electron-portable
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-06
---

# Phase 5 — Validation Strategy

> Phase 5 es **infraestructura de empaquetado** (Electron wrapper). No hay
> logica de negocio nueva ni cambios en BD. La validacion es
> **predominantemente manual** — el .exe abre o no abre, los modulos
> cargan o no cargan, el dialog de impresion aparece o no aparece.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Manual + scripts shell (PowerShell) |
| **Config file** | none — verificacion via comandos directos |
| **Quick run command** | `node --check main.js && node --check preload.js` |
| **Full suite command** | Ejecutar `gestion-productiva-portable.exe` y validar 9 SC manualmente |
| **Estimated runtime** | ~2 min (build) + ~5 min (smoke test manual) |

---

## Sampling Rate

- **After every task commit:** `node --check` sobre archivos JS modificados (`main.js`, `preload.js`)
- **After every plan wave:** Build full + smoke test (abrir .exe, ver Inicio, click 1 modulo piloto)
- **Before `/gsd-verify-work`:** Build limpio + 9 success criteria validados a mano
- **Max feedback latency:** ~2 min (tiempo de build local)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 05-01-* | 01 | 0 | SC-1 (build temporal funcional) | shell | `Test-Path C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\package.json` | ⬜ |
| 05-02-* | 02 | 1 | SC-1 (codigo copiado) | shell | `Test-Path "$tmp\Inicio\index.html"` + count files | ⬜ |
| 05-03-* | 03 | 1 | SC-3 (CSP + login) | grep | `grep -l "Content-Security-Policy" $tmp/login.html` | ⬜ |
| 05-04-* | 04 | 1 | SC-2 (Inicio fork) | grep | `grep -c 'class="disabled"' $tmp/Inicio/index.html` ≥ 12 | ⬜ |
| 05-05-* | 05 | 2 | SC-1 (main.js valido) | shell | `node --check $tmp/main.js` exit 0 | ⬜ |
| 05-06-* | 06 | 2 | SC-1 (preload valido) | shell | `node --check $tmp/preload.js` exit 0 | ⬜ |
| 05-07-* | 07 | 3 | SC-1 (build .exe) | shell | `Test-Path $tmp\dist\*.exe` | ⬜ |
| 05-08-* | 08 | 3 | SC-1 (.exe en destino) | shell | `Test-Path "Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\*.exe"` | ⬜ |
| 05-09-* | 09 | 4 | SC-6 (web original intacta) | shell | `robocopy /L /MIR` reporta 0 diffs vs baseline | ⬜ |
| 05-10-* | 10 | 4 | SC-7 (cleanup temporal) | shell | `Test-Path C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local` = $false | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Plan IDs concretos los define el planner. La tabla arriba es indicativa.*

---

## Wave 0 Requirements

- [x] No hay framework de tests para instalar — proyecto vanilla HTML/JS sin tests existentes
- [x] `node --check` sirve como linter sintactico (Node ya esta instalado)
- [x] PowerShell + robocopy son nativos Windows — no instalar nada

**Wave 0 marker:** sin nuevo framework. Validacion sintactica + manual del .exe.

---

## Manual-Only Verifications

Los 9 Success Criteria de ROADMAP.md Phase 5 — todos requieren ejecucion humana:

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `.exe` portable abre | SC-1 | Ejecutar UI nativa | Doble-click `gestion-productiva-portable.exe` → ventana abre con login |
| 6 modulos piloto cargan | SC-2 | Click + render visual | Login → click cada uno de los 6 (PS, Tall, Prov AT, Stocks, Produccion, Informes) → render OK |
| Login Supabase funciona | SC-3 | Auth contra Supabase real | Ingresar password → sessionStorage.gp_auth=ok → redirige a Inicio |
| Impresion remitos/facturas | SC-4 | Hardware de impresora | Abrir un remito en PS → boton imprimir → dialog Windows → impresora local lista |
| Acceso \\loeke-svr | SC-5 | Network share | Abrir un modulo que toque archivos compartidos → operaciones normales |
| Carpeta web original intacta | SC-6 | File-system diff | `robocopy /L /MIR baseline web` → 0 archivos modificados |
| Cleanup build temporal | SC-7 | Filesystem | `Test-Path C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local` → False |
| Modulos no-piloto disabled | D-03 | UI visual | Click en boton no-piloto → no hace nada, tooltip "No disponible en piloto" visible |
| Sesion limpia al cerrar | D-09 | Comportamiento de ventana | Cerrar app → reabrir → muestra login (no Inicio directo) |

---

## Validation Sign-Off

- [x] Tasks tienen verificacion sintactica (`node --check`) o filesystem-check
- [x] Sampling continuity: cada task tiene check automatico minimo, smoke test manual al final
- [x] Wave 0 trivial: no hay framework nuevo
- [x] No watch-mode flags
- [x] Feedback latency < 120s (build local rapido)
- [x] `nyquist_compliant: true` aceptable para fase de packaging (no business logic testeable unitariamente)

**Approval:** approved 2026-05-06 (Phase 5 es packaging/infra, manual-dominant)
