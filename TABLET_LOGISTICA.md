# Tablet de Logística — Specs físicas y CSS

**Uso**: la versión `envios-only.html` (logística) se va a usar EXCLUSIVAMENTE en esta tablet.

## Físico
- **Tamaño pantalla**: 19 cm (alto) × 11.25 cm (ancho)
- **Diagonal**: ~22 cm = **~8.7 pulgadas**
- **Orientación**: portrait (vertical)
- **Modelo más probable**: iPad mini (8.3") o tablet Android 8"

## UI que come espacio (descontar del alto)
- **Chrome (barra superior)**: 2.3 cm
- **Botones táctiles Android (borde inferior)**: 0.9 cm
- **Alto útil real para web**: 19 − 2.3 − 0.9 = **15.8 cm**

## CSS px (portrait)

| Tablet | Ancho × Alto total | Alto útil web |
|---|---|---|
| **iPad mini** | 744 × 1133 | ~1044 px |
| **Android 8" estándar** | 800 × 1280 | ~1180 px |
| **Android low-cost (1024×600 físico)** | 600 × 1024 | ~888 px |

## Setup en Chrome DevTools (Responsive)
- **744 × 1044** (iPad mini, descontando Chrome) o
- **744 × 1133** (iPad mini full)
- DPR: 2
- URL: `http://localhost:5501/envios-only.html`

## Implicancia para diseño

⚠ **LIMITACIÓN PRINCIPAL: ANCHO 744 px** (no el alto)

Esto significa:
- Tablas anchas (EnviosPS Fase 1 tiene 11 columnas) **NO entran** sin scroll horizontal
- Botones grandes ocupan más espacio del que parecía cuando se diseñó pensando en desktop
- Headers stickys de 60+ px se sienten enormes en 1044 de alto útil
- Inputs táctiles deben ser ≥44px (Apple HIG)

## Cambios pendientes para tablet (FUTURO — no hacer ahora)

- [ ] Auditar `envios-only.html` en 744×1044
- [ ] Auditar EnviosPS Fase 1 — compactar columnas o hacer scroll horizontal explícito
- [ ] Auditar EntregaPS Fase 1 (mismo problema)
- [ ] Recepción Cervantes — revisar si se usa desde la tablet
- [ ] Posible PWA (manifest + display:fullscreen) para recuperar los 2.3cm de Chrome → +150px de alto
- [ ] Botones tactiles ≥44px en flujo crítico
