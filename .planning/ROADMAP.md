# Roadmap: Gestion Productiva

## Overview

Sistema de gestion de produccion ya en uso. Roadmap captura mejoras y nuevas
integraciones — no es greenfield. Foco actual: integracion proveedor Maspoli
(plasticos) y limpieza catalogo de articulos por tallerista.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): mejoras planificadas
- Decimal phases (2.1, 2.2): inserciones urgentes

- [x] **Phase 0: Sistema base** — Modulos Produccion / Recepcion / Envios / Stock / Verificacion (deployado pre-GSD)
- [~] **Phase 1: Flujo Maspoli (Virola → PC12/PEP7)** — Integrar Maspoli como proveedor plasticos con compras + descuento por consumo
- [~] **Phase 2: Limpieza catalogo Articulos VxT** — Sincronizar Articulos Virgilio X Tallerista con pedidos reales del Excel
- [ ] **Phase 3: Compras en flejes/cajas/cartones** — Reemplazar `const compras = 0` hardcoded por lectura real de Recepcion_Insumos (paridad con plasticos.js)
- [ ] **Phase 4: Estadistica Madre activa** — Cargar E. Madre LK/CH con consumos historicos para que la columna "Consumo Mensual" salga de datos reales
- [ ] **Phase 5: App Electron Portable (piloto admins)** — Generar .exe portable Windows que envuelve modulos PS, Tall, Prov Art Terminado, Stocks, Produccion para 2 admins, sin tocar carpeta web actual

## Phase Details

### Phase 1: Flujo Maspoli
**Goal**: Maspoli aparece como proveedor de PC12/PEP7 en stock plasticos, sus
recepciones de virola se contabilizan como compras, sus entregas de PC12/PEP7 se
reciben como Entregas PS desde Facturas, y el consumo de virola sale de la suma
508+518+564 via Estadistica Madre.

**Depends on**: Phase 0
**Success Criteria**:
1. Cargar recepcion en StockFlejes/recepcion.html (Plasticos / Maspoli / cantidad) suma a Stock Online de PC12/PEP7
2. Despiece 508→PC12, 564→PC12, 518→PEP7 cargado y consistente
3. Lectura de factura de Maspoli inserta automaticamente en Entregas PS con Sector SP=PC12/PEP7
4. Stock Online plasticos para PC12/PEP7 = stockInicial + compras + entregasPS - enviosPS - enviosTall
5. Ningun tallerista de Virgilio tiene 508, 518 ni 564 asignado en Articulos VxT

**Plans**:
- [x] 01-01: PC12/PEP7 en Partes_Plasticas con Proveedor=Maspoli (stock conservado de Pat Bet Plast)
- [x] 01-02: Despiece 508/564→PC12 y 518→PEP7 verificado (ya estaba cargado)
- [x] 01-03: plasticos.js suma compras desde Recepcion_Insumos por Cod_ISIS
- [ ] 01-04: Facturas/index.html reconoce Maspoli como proveedor de plasticos
- [ ] 01-05: Verificar 508/518/564 fuera de Articulos VxT de cualquier tallerista (excepto borrado: Maspoli 2/518 ya hecho)
- [ ] 01-06: Cargar E. Madre LK/CH consumo combinado 508+518+564 para virola

### Phase 2: Limpieza catalogo Articulos VxT
**Goal**: Articulos Virgilio X Tallerista refleja exactamente los codigos que cada
tallerista entrega en Excel "Pedidos Talleristas-Prov Art. Term".

**Depends on**: Phase 0
**Success Criteria**:
1. Cada tallerista (Carlos, Garcia, German, Lucho, Martin, Poly, Rafael) tiene los codigos del Excel cargados con linea LK/CH correcta
2. Codigos huerfanos (no en Excel) borrados o justificados
3. Modal Recepcion Virgilio muestra para cada tallerista exactamente los codigos esperados

**Plans**:
- [x] 02-01: Garcia +7 articulos LK con sufijo E
- [x] 02-02: DELETE Carlos 706, Lucho 123 (re-asignados a Martin/Garcia)
- [x] 02-03: DELETE Maspoli 2 / 518 (Maspoli pasa a ser proveedor plasticos no tallerista)
- [ ] 02-04: Garcia 437E/438E/439E como CH (pendiente confirmacion)
- [ ] 02-05: Verificar Lucho 505/574/809 (extras sin Excel match)

### Phase 3: Compras en flejes/cajas/cartones
**Goal**: Replicar el patron de plasticos.js (lectura Recepcion_Insumos como compras)
en stock-flejes.js, cajas.js, cartones.js para reemplazar `const compras = 0`.

**Depends on**: Phase 1 (probar el patron primero en plasticos)
**Success Criteria**:
1. Stock Online de fleje X = stockInicial + compras (de Recepcion_Insumos) - fabricacion
2. Stock Online de caja Y similar
3. Stock Online de carton Z similar
4. Popup muestra detalle de compras por proveedor/fecha en cada uno

### Phase 4: Estadistica Madre activa
**Goal**: E. Madre LK / E. Madre CH alimenta Cons_Mensual de plasticos (y otros
insumos). Hoy Cons_Mensual se carga manual; debe salir de produccion historica.

**Depends on**: Phase 1
**Success Criteria**:
1. E. Madre tiene fila por cada cod articulo con consumo historico (ultimos N meses)
2. Cons_Mensual de Partes_Plasticas se calcula como suma de consumos por sector segun despiece
3. Cambios en produccion (db_n8n_espejo) reflejan en E. Madre via trigger o vista materializada

### Phase 5: App Electron Portable (piloto admins)
**Goal**: Empaquetar el sistema web actual como .exe portable de Windows para 2
administrativos. La app envuelve los modulos PS, Tall, Prov Art Terminado,
Stocks y Produccion. Login Supabase como hoy. Impresion de remitos/facturas
opera. La carpeta original `Gestion Productiva` queda intacta — el codigo se
copia a `Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\` y se
empaqueta desde alli. Build temporal en
`C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\` y se borra al
finalizar.

**Depends on**: Phase 0
**Scope** (modulos piloto):
- PS (StockSP, StockSC, Envios PS)
- Talleristas (Recepcion, Envios, Control, Proporciones)
- Prov Art Terminado (Entregas, Control)
- Stocks (StockFlejes, StockMovimiento, StockTransitoPS, Stocks General)
- Produccion (maestro, tiempos, import)

**Out of scope (no incluidos en piloto)**: Compras, Facturas, Verificacion,
Despiece x Articulo, Alertas, Disruptivas, Preavisos, Ventas Chat. Se evaluan
para un siguiente piloto si admins lo necesitan.

**Success Criteria**:
1. `.exe` portable generado y copiado a `Z:\AA IT\Gestion Productiva (4)\Gestion Productiva Portable\`
2. Los 5 modulos piloto cargan y operan en la app igual que en la web
3. Login Supabase funcional desde la app (mismas credenciales que la web)
4. Impresion de remitos/facturas opera (impresora local del admin)
5. Acceso a archivos compartidos `\\loeke-svr\Documentos Compartidos\AA IT\...` funcional
6. Carpeta `Gestion Productiva` original sin modificaciones (verificacion por hash o git status)
7. `C:\Users\Logistica1\Desktop\Prueba_Apliaciones_en_Local\` borrado al finalizar
8. Auto-update opcional: descartado en este piloto (admins reciben .exe nuevo manual)

**Plans**: 8 plans
- [ ] 05-01-PLAN.md — Setup build temporal (npm init + electron@^42 + electron-builder@^26)
- [ ] 05-02-PLAN.md — Robocopy snapshot web -> /app con exclusiones
- [ ] 05-03-PLAN.md — Inyectar CSP meta tag en login.html, index.html, Inicio/index.html del snapshot
- [ ] 05-04-PLAN.md — Crear main.js + preload.js + package.json electron-builder portable
- [ ] 05-05-PLAN.md — Fork Inicio/index.html: 12 botones no-piloto con .disabled + tooltip
- [ ] 05-06-PLAN.md — Build .exe (npx electron-builder --win portable --x64) + verify asar
- [ ] 05-07-PLAN.md — Mover .exe a Z:Gestion Productiva Portable + verificar D-17 (web original intacta)
- [ ] 05-08-PLAN.md — Smoke test manual (9 SC + D-03 + D-09) + cleanup build temporal + actualizar STATE

---
*Last updated: 2026-05-06 — Phase 5 plans creados (8 plans, 7 waves)*
