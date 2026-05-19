# Phase 5: App Electron Portable (piloto admins) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or
> execution agents. Decisions are captured in CONTEXT.md — this log
> preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 05-app-electron-portable
**Areas discussed:** Menu Inicio: no-piloto, Modulo Informes en piloto, Mecanismo de disable

---

## Multi-select inicial: gray areas a discutir

| Opcion | Descripcion | Seleccionada |
|--------|-------------|--------------|
| Origen del codigo en runtime | Snapshot vs leer carpeta web compartida en runtime | |
| Menu Inicio: no-piloto | Como tratar modulos NO-piloto en menu | ✓ |
| Impresion remitos/facturas | Silenciosa default vs dialog del sistema vs PDF | |
| Acceso filesystem nativo (IPC) | Solo minimo vs full (Excel, Python, COM) | |

**Decision del usuario:** Solo "Menu Inicio: no-piloto" se discute. Las otras
3 areas → Claude discretion.

---

## Menu Inicio: no-piloto (tratamiento)

| Opcion | Descripcion | Seleccionada |
|--------|-------------|--------------|
| Ocultar completamente | Botones desaparecen del menu | |
| Visibles pero deshabilitados | Botones grises con tooltip | ✓ |
| Visibles y funcionales (igual web) | Boton funciona igual que en web | |
| Ocultar pero accesible por shortcut | Atajo oculto Ctrl+Alt+M | |

**User's choice:** Visibles pero deshabilitados (gris + tooltip "No disponible
en piloto").
**Notes:** Mantiene paridad visual con la web. Deja claro que el alcance es
piloto y que va a haber mas.

---

## Modulo Informes: incluir en piloto?

| Opcion | Descripcion | Seleccionada |
|--------|-------------|--------------|
| Si, agregar al piloto | Informes es herramienta de admins, encaja | ✓ |
| No, fuera de piloto | Mantener los 5 originales (PS, Tall, AT, Stocks, Prod) | |

**User's choice:** Si, agregar al piloto.
**Notes:** Informes pasa de 5 a 6 modulos piloto. Se reflejara en CONTEXT.md
y al planear deberia ajustarse el ROADMAP.md scope (modulos piloto = 6, no
5).

---

## Como implementar 'visibles pero deshabilitados'

| Opcion | Descripcion | Seleccionada |
|--------|-------------|--------------|
| Modificar Inicio/index.html del .exe | Forkear Inicio dentro del portable, agregar clase disabled + tooltip | ✓ |
| Inyectar CSS/JS desde main process | Electron inyecta script que detecta y deshabilita | |
| Nuevo menu propio (reemplaza Inicio) | Menu propio electron-side, contradice "visibles pero gris" | |

**User's choice:** Modificar `Inicio/index.html` del .exe (fork dentro del
portable). La carpeta web original NO se toca.
**Notes:** Approach simple, predecible, debugable. Fork solo en
`Gestion Productiva Portable\Inicio\index.html`.

---

## Claude's Discretion (no discutidas — defaults aplicados en CONTEXT.md)

- **Origen del codigo:** Snapshot embebido en `.exe`. La carpeta web original
  no se referencia en runtime. Razones: confiabilidad, portabilidad,
  versionado del codigo atado al `.exe`.
- **Impresion:** Dialog del sistema cada vez (`silent: false`). Admin elige
  impresora/copias. Mas seguro para piloto.
- **Acceso filesystem nativo / IPC:** Minimo. Solo impresion + persistencia
  de sesion + apertura de URLs externas. Sin Excel local, sin Python, sin
  COM en este piloto.
- **Configuracion app:** `app.getPath('userData')` (`%APPDATA%`).
- **Branding:** Sin custom (defaults electron-builder).
- **Distribucion:** Manual (Logistica1 copia .exe nuevo a Portable folder y
  avisa por WhatsApp). Sin auto-update.
- **Firma digital:** No firmar en piloto (admins aceptan SmartScreen).

---

## Deferred Ideas

- Excel local (lectura/escritura), Python (`envios_excel.py`), Excel COM
  (macros .bas) — se evaluan despues del piloto.
- Auto-update (electron-updater).
- Branding personalizado.
- Firma digital del .exe.
- Modo offline (cache datos sin internet).
- App movil / PWA para operarios en planta.
- Habilitar modulos no-piloto (Compras, Facturas, Verificacion, etc.) en
  un proximo piloto.
- Empaquetado para Mac/Linux (no aplica — admins son Windows).
