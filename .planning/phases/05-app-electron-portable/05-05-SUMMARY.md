---
phase: 05-app-electron-portable
plan: 05
subsystem: electron-portable
tags: [inicio-fork, disabled-buttons, piloto-scope, d-03, d-04]
status: complete
date: 2026-05-07
dependency_graph:
  requires: ["05-03"]
  provides: ["inicio-fork-piloto"]
  affects: ["05-06+ smoke tests piloto", "SC-2 modulos piloto cargan", "D-03 paridad visual no-piloto"]
tech_stack:
  added: []
  patterns:
    - "CSS class .disabled + atributo HTML disabled + title tooltip"
    - "Click handler capture-phase con classList.contains('disabled') guard"
key_files:
  created: []
  modified:
    - "C:\\Users\\Logistica1\\Desktop\\Prueba_Apliaciones_en_Local\\app\\Inicio\\index.html"
decisions:
  - "10 botones <button class='btn-opcion'> deshabilitados con clase .disabled + attr disabled + data-link='#' + title='No disponible en piloto'"
  - "2 alert iconos top-right (alertBell, alertInsumos) deshabilitados con clase .disabled-alert (filter:grayscale + pointer-events:none) y onclick removido"
  - "Click handler doble: capture-phase listener bloquea propagacion + bubble listener verifica antes de navegar. Defense-in-depth"
  - "Atributo data-link cambiado a '#' (no removido) para preservar selector de queries existentes"
  - "Inline style original de Verif Integridad/Madres (gradiente purpura/rojo) ELIMINADO porque la clase .disabled lo overridea via !important — limpieza explicita"
  - "id='btnDisruptivas' preservado (codigo posterior puede referirlo)"
  - "5 botones piloto del card 'Insumos' (StockFlejes/cajas, flejes, cartones, plasticos, recepcion) NO modificados"
metrics:
  tasks: 1
  files_modified: 1
  duration_min: 4
---

# Phase 05 Plan 05: Fork Inicio — 12 botones no-piloto disabled — Summary

**One-liner:** Snapshot `app/Inicio/index.html` forkeado: 10 `btn-opcion` no-piloto + 2 alert iconos top-right marcados como `disabled` con tooltip "No disponible en piloto", click handler capture-phase bloquea navegacion. CSS gris no-clickeable inyectado. 5 botones piloto StockFlejes preservados.

## Archivos modificados

| Archivo | Cambios |
| ------- | ------- |
| `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Inicio\index.html` | CSS bloque agregado (.btn-opcion.disabled + .alert-*.disabled-alert), 10 buttons reescritos con `class="btn-opcion disabled" disabled data-link="#"`, 2 alert buttons (alertBell, alertInsumos) reescritos con `class="alert-* disabled-alert" disabled` y onclick removido, click handler reforzado con guard capture-phase |

## Lista exacta de 12 elementos disabled (verificada via grep)

| # | Elemento | Linea | data-link/onclick antes | Despues |
|---|----------|-------|-------------------------|---------|
| 1  | Verificacion Integridad        | 1183 | `data-link="../Verificacion/verificacion.html"` (+ inline gradient style) | `class="btn-opcion disabled" data-link="#" disabled title="No disponible en piloto"` |
| 2  | Verificacion Madres            | 1184 | `data-link="../VerifMadres/VerifMadres.html"` (+ inline gradient) | idem |
| 3  | Producciones Disruptivas       | 1195 | `id="btnDisruptivas" data-link="../Disruptivas/index.html"` | `class="btn-opcion disabled" id="btnDisruptivas" data-link="#" disabled title="..."` |
| 4  | Despiece x Artículo            | 1209 | `data-link="../Despiece/Despiece.html"` | idem patron #1 |
| 5  | Lectura de Facturas Entrantes  | 1218 | `data-link="../Facturas/index.html"` | idem |
| 6  | Entrega Proveedores Cervantes  | 1220 | `data-link="../Facturas/EntregaProveedoresCervantes.html"` | idem |
| 7  | Remaches                       | 1234 | `data-link="#"` | idem (clase + disabled + title agregados) |
| 8  | Bombillas                      | 1235 | `data-link="#"` | idem |
| 9  | Garage                         | 1236 | `data-link="#"` | idem |
| 10 | Chat Bot Ventas                | 1245 | `data-link="../Ventas Chat/index.html"` | idem patron #1 |
| 11 | alertBell (top-right icon)     | 1085 | `class="alert-bell" onclick="location.href='../Alertas/'"` | `class="alert-bell disabled-alert" disabled title="No disponible en piloto"` (onclick removido) |
| 12 | alertInsumos (top-right icon)  | 1090 | `class="alert-insumos" onclick="location.href='../Compras/cajas.html'"` | `class="alert-insumos disabled-alert" disabled title="..."` (onclick removido) |

## CSS agregado (linea 528-549 antes de `</style>`)

```css
/* Phase 5 (05-05): piloto disabled — no-piloto modulos */
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
.alert-bell.disabled-alert,
.alert-insumos.disabled-alert {
  filter: grayscale(1);
  opacity: 0.5;
  cursor: not-allowed !important;
  pointer-events: none;
}
```

## JS click handler reforzado (linea ~1258)

ANTES:

```javascript
document.querySelectorAll(".btn-opcion").forEach(btn => {
  btn.addEventListener("click", () => {
    window.location.href = btn.dataset.link;
  });
});
```

DESPUES:

```javascript
// Phase 5 (05-05): bloquea click en disabled antes de cualquier handler
document.querySelectorAll(".btn-opcion").forEach(btn => {
  btn.addEventListener("click", (e) => {
    if (btn.classList.contains('disabled') || btn.disabled) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);
});

document.querySelectorAll(".btn-opcion").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.classList.contains('disabled') || btn.disabled) return;
    if (!btn.dataset.link || btn.dataset.link === '#') return;
    window.location.href = btn.dataset.link;
  });
});
```

Defense-in-depth: capture-phase listener + bubble-phase guard. Aun si el `disabled` HTML attr fallara en algun browser, el JS bloquea navegacion.

## Before/After diff conceptual

```diff
  <!-- Card Verificacion -->
- <button class="btn-opcion" data-link="../Verificacion/verificacion.html"
-         style="background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;border-color:#7c3aed">
-   Verificacion Integridad
- </button>
+ <button class="btn-opcion disabled" title="No disponible en piloto" data-link="#" disabled>
+   Verificacion Integridad
+ </button>

  <!-- top-right -->
- <button class="alert-bell" id="alertBell" onclick="location.href='../Alertas/'" title="Alertas - Matrices sin Tiempo">
+ <button class="alert-bell disabled-alert" id="alertBell" disabled title="No disponible en piloto">

  <!-- click handler -->
- btn.addEventListener("click", () => { window.location.href = btn.dataset.link; });
+ btn.addEventListener("click", (e) => {
+   if (btn.classList.contains('disabled') || btn.disabled) { e.preventDefault(); e.stopPropagation(); return false; }
+ }, true);
+ btn.addEventListener("click", () => {
+   if (btn.classList.contains('disabled') || btn.disabled) return;
+   if (!btn.dataset.link || btn.dataset.link === '#') return;
+   window.location.href = btn.dataset.link;
+ });
```

## Verificacion (acceptance criteria)

| Criterio | Comando | Resultado |
|----------|---------|-----------|
| `class="btn-opcion disabled"` count >= 10 | `grep -c 'class="btn-opcion disabled"' Inicio/index.html` | **10** PASS |
| `No disponible en piloto` tooltip count == 12 | `grep -c 'No disponible en piloto'` | **12** PASS (10 buttons + 2 alerts) |
| alertBell + alertInsumos disabled | `grep -E 'id="(alertBell\|alertInsumos)".*disabled'` | **2 lineas** PASS |
| CSS `.btn-opcion.disabled` presente | `grep -c '.btn-opcion.disabled'` | **13** matches PASS |
| JS guard `classList.contains('disabled')` | `grep -c "classList.contains('disabled')"` | **2** PASS |
| 5 piloto StockFlejes habilitados (sin disabled) | `grep -E "disabled.*data-link=\"../StockFlejes/X\""` | **0** disabled todos PASS |
| no-piloto data-link residuales | `grep "data-link=\"../{Verificacion\|Disruptivas\|Despiece\|Facturas\|Ventas Chat}..."` | **0 todos** PASS |
| CSP preservado (05-03) | `grep -c 'Content-Security-Policy'` | **1** PASS |

## D-17: Web original sin cambios

Mtime de `Z:\AA IT\Gestion Productiva (4)\Gestion Productiva (3)\Gestion Productiva (3)\Gestion Productiva\Gestion Productiva\Inicio\index.html`:

- Pre 05-03: `2026-04-30 11:10:32.244832200 -0300`
- Post 05-03: `2026-04-30 11:10:32.244832200 -0300` (preservado)
- Post 05-05: `2026-04-30 11:10:32.244832200 -0300` (preservado)

Web original intacta. Solo `C:\...\Prueba_Apliaciones_en_Local\app\Inicio\index.html` fue modificado.

## 5 botones piloto preservados (HABILITADOS)

| Boton | Linea | data-link | clase |
|-------|-------|-----------|-------|
| Recepción Insumos | 1229 | `../StockFlejes/recepcion.html` | `btn-opcion` (sin disabled) |
| Cajas             | 1230 | `../StockFlejes/cajas.html`     | idem |
| Flejes            | 1231 | `../StockFlejes/flejes.html`    | idem |
| Cartones          | 1232 | `../StockFlejes/cartones.html`  | idem |
| Partes Plásticas  | 1233 | `../StockFlejes/plasticos.html` | idem |

Resto de modulos piloto (Talleristas, Prov Serv, Prov Art Terminado, StockSP/SC/Movimiento/TransitoPS/General, Produccion, Informes) — NO modificados, siguen funcionales.

## Acceptance Criteria

- [x] 12 elementos disabled con tooltip "No disponible en piloto" (10 buttons + 2 alerts)
- [x] CSS `.btn-opcion.disabled` con gris + cursor:not-allowed + opacity reducida + sin hover transform
- [x] CSS `.alert-bell.disabled-alert` / `.alert-insumos.disabled-alert` con grayscale + pointer-events:none
- [x] Click handler capture-phase guard (`classList.contains('disabled')` + e.preventDefault)
- [x] 5 botones piloto del card "Insumos" (StockFlejes/*) preservados habilitados
- [x] Resto de cards piloto sin modificaciones
- [x] CSP meta tag (inyectado en 05-03) preservado en `<head>`
- [x] Web original `Z:\...\Inicio\index.html` mtime sin cambios (D-17)
- [x] data-link a no-piloto (Verificacion, VerifMadres, Disruptivas, Despiece, Facturas, Ventas Chat, Compras, Alertas) eliminados / reemplazados por `#`

## Deviations from Plan

### Auto-fixed (Rule 2 — Functional correctness)

**1. [Rule 2 - Robustness] Removi onclick inline de alertBell/alertInsumos**
- Found during: Task 1
- Issue: Plan menciona "modificar onclick para que retorne early O eliminar onclick handler". Decidi eliminar onclick inline completamente — el atributo `disabled` HTML + clase `.disabled-alert` (con `pointer-events:none` en CSS) son suficientes y mas limpios. Sin onclick = no hay codigo legacy que compita con el guard CSS.
- Fix: `onclick="..."` removido en lineas 1085 y 1090, reemplazado por solo `disabled title="..."`
- Files modified: `app/Inicio/index.html`

**2. [Rule 2 - Cleanliness] Elimine inline `style=` de Verificacion Integridad/Madres**
- Found during: Task 1
- Issue: Los buttons originales tenian `style="background:linear-gradient(...);color:#fff;border-color:..."` que sobreescribiria el gris de `.disabled` salvo por `!important`. Aun con `!important` quedaba como cruft.
- Fix: Atributo `style` removido en el reemplazo (la clase `.disabled` aplica el look gris correctamente).
- Files modified: `app/Inicio/index.html`

**3. [Rule 3 - Defense in depth] Doble click handler en lugar de uno con guard**
- Found during: Task 1
- Issue: El handler original (`window.location.href = btn.dataset.link`) no chequea disabled. Plan sugiere agregar listener con capture=true. Decidi tambien modificar el handler bubble existente para chequear `disabled` y `data-link === '#'` antes de navegar.
- Fix: Capture-phase listener (preventDefault+stopPropagation) + bubble-phase guard (early return si disabled o data-link='#').
- Files modified: `app/Inicio/index.html`

Ninguna de las 3 desviaciones cambia comportamiento esperado — son cleanups defensivos que cumplen mejor el spirit de D-03/D-04.

## Decisions Made

- **`disabled-alert` clase nueva** para alertBell/alertInsumos: el plan dejaba a discrecion si forzar `btn-opcion` o crear clase nueva. Elegi clase nueva porque los iconos top-right son visualmente distintos (no son botones cuadrados grises) — CSS dedicado preserva su shape pero quita color.
- **`data-link="#"` preservado** (en lugar de remover el atributo) para no romper potenciales queries `[data-link]` en JS futuro.
- **`pointer-events:none` SOLO en alert-*.disabled-alert**: para `.btn-opcion.disabled` NO se uso `pointer-events:none` porque queremos que `cursor:not-allowed` sea visible al hover (pointer-events:none anula cursor custom). Con `cursor:not-allowed` + click handler capture-phase guard, el click es bloqueado igual.
- **NO commit git** — proyecto sin repo (working dir no es git repo). Cambios persistidos en filesystem (igual que 05-03/05-04).

## Threat Flags

None — sin nueva surface. Todos los cambios reducen surface (disabling de paths a no-piloto) o son defensivos (CSS visual + JS guard).

## Self-Check

### File exists

- FOUND: `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\app\Inicio\index.html` (1480 lineas, 10 buttons disabled + 2 alerts disabled)

### Grep checks

- FOUND: `class="btn-opcion disabled"` x 10
- FOUND: `No disponible en piloto` x 12
- FOUND: `.btn-opcion.disabled` (CSS) x 13 occurrences
- FOUND: `classList.contains('disabled')` x 2 (capture + bubble)
- FOUND: CSP meta tag preservado x 1
- NOT FOUND: `data-link="../Verificacion/`, `data-link="../Disruptivas/`, `data-link="../Despiece/`, `data-link="../Facturas/`, `data-link="../Ventas Chat/`, `data-link="../Compras/`, `data-link="../Alertas/"` (todos 0 — esperado)
- FOUND: 5 piloto StockFlejes data-links preservados sin disabled

### D-17 verification

- mtime web original Inicio/index.html sin cambios pre/post

## Self-Check: PASSED

## Next Plan

`05-06` — siguiente plan en el wave (probablemente smoke tests de los 21 paths piloto + verificacion D-17 final).
