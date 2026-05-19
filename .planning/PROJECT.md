# Gestion Productiva

## What This Is

Sistema interno de gestion de produccion para Loeke (kitchenware/utensilios). Trackea
entregas de talleristas (workshop workers) y proveedores de servicio (PS), calcula
stock online de partes/componentes/sectores, valida la cadena de despiece desde fleje
crudo hasta articulo terminado, y alinea con estadistica madre de produccion. Usuarios
internos: equipo de logistica/produccion (Logística3 y otros perfiles definidos en
PERFILES.md).

## Core Value

**Stock confiable** — la grilla de Stock Online (flejes, cajas, cartones, plasticos)
debe reflejar la realidad del galpon. Si miente, todas las decisiones de pedido,
produccion y reparto se rompen en cascada.

## Requirements

### Validated

- ✓ Modulo Produccion con db_n8n_espejo (registro de produccion + premios)
- ✓ Recepcion Cervantes/Virgilio (entregas de talleristas a Entregas Tallerista Virgilio)
- ✓ Despiece x Articulo (sincronizado por funcion actualizar_despiece desde tablas madre)
- ✓ Partes x Tallerista (sincronizado por trigger desde Despiece)
- ✓ Trazado de Rutas (Verificacion, reescrito 2026-04-18)
- ✓ Lectura de Facturas con OCR + edge function → Entregas PS
- ✓ Stock SP / Stock Insumos (flejes, cajas, cartones, plasticos)
- ✓ Causa-Efecto BD (cadena Descuenta/Aumenta via Matriz)
- ✓ Sistema de LOCKS para edicion concurrente entre usuarios

### Active

- [ ] **Flujo Maspoli (Virola → PC12/PEP7)** — Maspoli como proveedor de plasticos
  - ✅ PC12, PEP7 en Partes_Plasticas con Proveedor=Maspoli (stock conservado)
  - ✅ Despiece 508/564→PC12, 518→PEP7 (ya cargado)
  - ✅ plasticos.js suma compras desde Recepcion_Insumos (StockFlejes/recepcion.html)
  - 🔄 Facturas/index.html reconozca Maspoli como proveedor para insertar Entregas PS
  - 🔄 Verificar 508/518/564 fuera de Articulos VxT de talleristas (518 Maspoli 2 ya borrado)
  - 🔄 Cargar E. Madre LK/CH con consumo combinado 508+518+564 (virola)

- [ ] **Limpieza catalogo Articulos VxT** (en curso)
  - ✅ Garcia +7 articulos (035E, 437E, 438E, 439E, 440E, 584E, 590E)
  - ✅ DELETE Carlos 706, Lucho 123 (re-asignados)
  - 🔄 Pendiente CH para Garcia 437E, 438E, 439E (esperando confirmacion)

### Out of Scope

- Mobile-first UI — el equipo opera en desktop con Live Server, no hay caso de uso mobile.
- Migracion a framework (React/Vue) — vanilla HTML/JS funciona y simplifica deployment.
- Multi-tenant / SaaS — sistema cerrado para Loeke.

## Context

- **Stack**: HTML/CSS/JS vanilla + Supabase (PostgreSQL) v2 desde CDN. Sin build step.
- **Server**: Live Server en puerto 5501.
- **Edge Functions**: WhatsApp alertas, OCR de facturas.
- **Carpeta compartida** entre multiples PCs via SMB (\\loeke-svr) — paths absolutos en
  hooks rompen si se mueven, por eso GSD/ruflo van LOCALES.
- **Tablas clave**: `db_n8n_espejo` (produccion), `Empleados`, `Matrices`, `Despiece x
  Articulo`, `Partes x Tallerista`, `Articulos Virgilio X Tallerista`, `Entregas
  Tallerista Virgilio`, `Entregas PS`, `Envios a Talleristas`, `Envios a PS`,
  `Recepcion_Insumos`, `SP Kg`, `SC Kg`, `SectorPlasticos`, `Partes_Plasticas`.
- **Talleristas activos**: Carlos, Garcia, German, Lucho, Martin, Poly, Rafael,
  Blist-Pack, Maspoli (proveedor plasticos).
- **Patrones especiales**: GRJ (productos armados por talleristas con componentes),
  transformaciones 1:1 (M6/M8 Poly, X1/X5 Martin, F7/Toch Martin), Sector Transito ST.

## Constraints

- **Tech stack**: HTML/JS vanilla — sin framework — los cambios deben mantenerse asi.
- **Tablas MADRE/DERIVADAS**: NUNCA modificar derivadas (Despiece x Articulo, Partes x
  Tallerista) directamente; ir a la madre (SP Kg, SC Kg, SectorPlasticos, Articulos
  Virgilio X Tallerista). Excepcion: nuevas filas en Despiece estan permitidas, solo
  los pesos se sincronizan.
- **LOCKS.txt obligatorio** antes de cualquier Edit/Write — sistema multi-usuario.
- **Ediciones minimas** — no reformatear, no reordenar codigo no pedido.
- **Caveman mode default** — respuestas concisas, sin filler. Suspender solo para
  warnings/confirmaciones criticas.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Cervantes y Virgilio escriben en MISMA tabla `Entregas Tallerista Virgilio` | Simplifica reportes, ambos modulos comparten schema | ✓ Good |
| Cervantes guarda `Cod`=componente + `Cod_GRJ`=GRJ destino | Permite descontar componentes sin perder trazabilidad del ensamble | ✓ Good |
| `Recepcion_Insumos.codigo` = `Cod_ISIS` para plasticos | Match limpio sin ambiguedad por sector | ✓ Good |
| GSD instalado LOCAL (~/.claude) en cada PC, NO en compartido | Hooks usan paths absolutos que no portan entre maquinas | ✓ Good |
| 580E (Excel) ≡ 580 (BD) tras normalizacion | Misma pieza fisica, sufijo E es codificacion Isis | ✓ Good |
| Maspoli reemplaza a Pat Bet Plast como proveedor PC12/PEP7 (UPDATE id 56/57) | Stock previo se conserva, ID estable | ✓ Good |

---
*Last updated: 2026-04-28 tras instalacion GSD + flujo Maspoli en curso*
