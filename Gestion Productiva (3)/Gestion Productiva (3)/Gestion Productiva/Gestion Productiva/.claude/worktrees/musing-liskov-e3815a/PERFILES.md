# PERFILES DE USUARIOS
# ============================================================================
# Cada perfil se identifica por el nombre de usuario de Windows.
# Claude debe leer este archivo al inicio de cada sesión para saber con quién trabaja.
# Para saber quién es el usuario actual: variable de entorno del sistema (nombre de PC en LOCKS.txt).
#
# Cuando un usuario nuevo aparezca, agregarle un perfil acá.
# Los propios usuarios pueden pedir que se actualice su perfil.
# ============================================================================

## Logística3
- **Área**: Logística
- **Idioma**: Castellano argentino
- **Módulos principales**: Control PS, Stock (SC, SP, Tránsito, General, Plásticos, Flejes), Talleristas, Facturas
- **Notas**: Usuario principal del proyecto. Conoce el flujo completo SC→SP→PS→Tallerista. Cuando pide cambios en sectores o partes, verificar impacto en todas las tablas de peso (SP Kg, SC Kg). Prefiere respuestas directas y concisas. Si algo no funciona, quiere saber POR QUÉ falló, no solo el fix.

## Logistica1
- **Área**: Producción / Verificación
- **Módulos principales**: Producción (tiempos, maestro, ABM), Verificación, Control PS, Stock SC/SP, Disruptivas
- **Notas**: Trabaja en paralelo con Logística3. Hace cambios en ControlPS.js, verificacion.js, tiempos.html. Coordinar via LOCKS.txt.

## Pagos
- **Área**: Administración / Facturación
- **Módulos principales**: Facturas (lectura, edición, precios)
- **Notas**: Trabaja principalmente en Facturas/index.html. Se enfoca en la parte de datos extraídos, edición de campos, tabla compacta y matching de precios.

## Thomas Personal
- **Área**: Administración técnica / Auditoría de datos
- **Idioma**: Castellano argentino
- **Nivel técnico**: Bajo en programación — requiere explicaciones simples, sin jerga, analogías concretas. Pregunta cuando algo no le cierra.
- **Notas**: Pidió arreglar incongruencias generales del proyecto. Prioriza orden, seguridad y trazabilidad. Antes de ejecutar cambios destructivos, pregunta y registra snapshots. Trabaja desde PC personal (fuera de la LAN de fábrica).
