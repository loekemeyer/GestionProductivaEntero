# INFORME DE AUDITORIA - Base de Datos Supabase
### Proyecto: Gestion Productiva
### Fecha: 2026-04-08
### Auditor: Claude (Logistica3)

---

## RESUMEN EJECUTIVO

Se auditaron **5.694 registros** en `db_n8n_espejo` (tabla principal de produccion) y todas las tablas relacionadas. Se encontraron **problemas criticos** que afectan la integridad de los datos, el calculo de premios, y la seguridad.

| Severidad | Hallazgos |
|-----------|-----------|
| CRITICO   | 3 |
| ALTO      | 5 |
| MEDIO     | 4 |
| BAJO      | 3 |

---

## HALLAZGO #1 - CRITICO: Colisiones masivas en ID_Ejecucion (duplicados falsos)

### Que encontre
- **874 grupos** de registros comparten el mismo `ID_Ejecucion`
- **1.708 registros sobrantes** (de 5.694 totales = **30% de la tabla**)
- El peor caso: `ID_Ejecucion = 12083` aparece en **62 registros distintos**

### Por que pasa
Al inspeccionar los registros con `ID_Ejecucion = 12083`, encontre que son registros **completamente diferentes** (distintos legajos: 251, 262, 252, 74, 233, 270, 261; distintas matrices: MOV, PC). No son duplicados reales, sino **colisiones del algoritmo de hash**.

La funcion `hashId()` en el codigo convierte un UUID de 36 caracteres a un numero de 15 digitos tomando los primeros 15 caracteres hex y parseandolos como base 16. Este espacio es demasiado chico y produce colisiones.

### Impacto
- Cuando el codigo hace `.eq("ID_Ejecucion", hash)` para buscar un registro, **puede encontrar otro registro de otro empleado**.
- Al editar o borrar un registro, se puede **modificar/borrar el registro equivocado**.
- La recalculacion de cajones despues de insertar TM usa `ID_Ejecucion` para hacer UPDATE → puede **corromper premios de otros empleados**.

### Recomendacion
- **Urgente**: Agregar un constraint UNIQUE en `ID_Ejecucion` (despues de limpiar duplicados).
- **Cambiar la funcion hash**: usar el UUID completo como text, o un hash de mayor espacio (ej: primeros 18 digitos hex = 10^21 combinaciones en vez de 10^15).
- **Alternativa**: guardar el UUID original como campo adicional y usarlo para las busquedas.

---

## HALLAZGO #2 - CRITICO: 110 registros con Premio=0 porque la Matriz no tiene Tiempo_Promedio

### Que encontre
- **110 registros activos** tienen `Segundos_Historico = 0` pero `Uni > 0`
- Esto significa que la formula `Premio = (-(SegTrab/SegHist - 1)) * 10` no puede calcularse
- El sistema pone `Premio = 0`, lo que **esconde la productividad real** del empleado

### Matrices afectadas (con registros de produccion):

| N_Matriz | Nombre | Registros afectados |
|----------|--------|:-------------------:|
| 216 | Colocar Resorte Bombilla | 22 |
| 236 | Colocar vastago Pisa Papa Ny | 9 |
| 144 | Colocar Resorte | 3 |
| 333 | Env Lava Vajilla | 2 |
| 12B | (sin nombre) | 6 |
| 14 | Corte Engranaje chico | 1 |
| 51 | Armado Cpo con Cuchufli | 1 |
| 176 | Colocar Cuchufli en Destapador | 1 |
| 4 | Doblado Mango pela | 1 |
| 7 | Corte Cuchilla Abrelatas | 1 |

### Impacto
- Los empleados que trabajan con estas matrices **no reciben premio** aunque trabajen rapido.
- Los informes de productividad estan **subestimados**.
- La matriz "12B" ni siquiera existe en la tabla Matrices (se esta usando HOY, 6 registros del legajo 74).

### Recomendacion
- Completar `Tiempo_Promedio` en las 9 matrices listadas.
- Dar de alta la matriz "12B" en la tabla `Matrices`.
- Agregar validacion en el frontend: si la matriz no tiene Tiempo_Promedio, **avisar al usuario** antes de registrar.

---

## HALLAZGO #3 - CRITICO: Zero Foreign Keys entre tablas

### Que encontre
No existe **ninguna** Foreign Key entre las tablas principales:
- `db_n8n_espejo.Legajo` → NO apunta a `Empleados.Legajo`
- `db_n8n_espejo.Matriz` → NO apunta a `Matrices.N_Matriz`
- `db_n8n_espejo.ID_Ejecucion` → NO apunta a `Registros Produccion Cervantes`

### Impacto
- Se pueden insertar registros con **legajos inexistentes** o **matrices inexistentes**.
- Ya hay evidencia: legajos y matrices en `db_n8n_espejo` que no existen en las tablas maestras.
- No hay proteccion contra borrado accidental de un empleado/matriz que tenga registros.

### Recomendacion
- Crear FKs al menos para Legajo y Matriz (como soft FKs si el rendimiento preocupa).
- Validar en el frontend antes de insertar.

---

## HALLAZGO #4 - ALTO: Sin indices de performance (solo PK)

### Que encontre
La tabla `db_n8n_espejo` (5.694 filas, creciendo) tiene **un solo indice**: la Primary Key (`id`).

### Queries que hacen FULL TABLE SCAN:
- Busqueda por `Legajo` + `Dia` + `Mes` (recalcular cajones) → **cada vez que se registra un TM**
- Busqueda por `ID_Ejecucion` (editar/borrar) → **cada edicion**
- Filtro por `Eliminar IS NULL` → **cada carga de pagina**
- Disruptivas carga **TODA la tabla** en paginas de 1000

### Recomendacion
Crear estos indices:
```sql
CREATE INDEX idx_espejo_legajo_dia_mes ON db_n8n_espejo ("Legajo", "Dia", "Mes");
CREATE INDEX idx_espejo_id_ejecucion ON db_n8n_espejo ("ID_Ejecucion");
CREATE INDEX idx_espejo_fecha ON db_n8n_espejo ("Fecha");
CREATE INDEX idx_espejo_eliminar ON db_n8n_espejo ("Eliminar") WHERE "Eliminar" IS NULL;
```

Con 5.700 filas todavia no se nota, pero cuando lleguen a 50.000+ va a ser un cuello de botella.

---

## HALLAZGO #5 - ALTO: Soft Delete no se usa, Hard Delete sin rastro

### Que encontre
- Registros con `Eliminar = 'S'`: **0** (cero)
- Registros activos: **5.694** (100%)
- El codigo tiene logica de soft delete (`Eliminar = 'S'`), pero en la practica **todo se borra fisicamente**.

### Impacto
- Si alguien borra un registro por error, **se pierde para siempre**.
- La tabla `Auditoria_Produccion` tiene **0 registros**, asi que la auditoria del codigo tampoco esta funcionando (posible bug de RLS: la tabla no tiene policy de INSERT para anon).

### Recomendacion
- Verificar por que `Auditoria_Produccion` no recibe inserts (probablemente falta RLS policy de INSERT).
- Decidir: o se usa soft delete consistentemente, o se asegura que la auditoria funcione como backup.

---

## HALLAZGO #6 - ALTO: Nombres inconsistentes para misma Matriz

### Que encontre
10 codigos de Matriz tienen **multiples nombres** en `db_n8n_espejo`:

| Codigo | Nombre 1 | Nombre 2 |
|--------|----------|----------|
| AL | Ayuda Logistica | Ayuda Log**i**stica |
| BC | Busque Cajon | Busqu**e** Caj**o**n |
| PB | Pare Bano | Par**e** Ba**n**o |
| PC | Pare Comida | Par**e** Comida |
| PR | Pare Carga Rollo | Par**e** Carga Rollo |
| PERM | Permiso | Permiso Salida |
| 130 | Doblado Agarre Pinza Chica | Doblado Agarre Pinzas |
| 218 | Doblar Punta Bombilla | PM 218 |
| 300 | Env Pelador | Env Pelador (con espacio) |
| 37 | Corte Cuerpo Sacac. | PM 37 |

### Causa
Los datos de Enero (Mes 1) vinieron de una carga distinta (probablemente n8n o importacion manual) que no normalizo acentos ni nombres. Los datos nuevos (desde la app) usan el nombre de la tabla Matrices con tildes.

### Impacto
- Los reportes agrupan por nombre, asi que "Pare Bano" y "Pare Bano" aparecen como **dos matrices distintas**.
- Inconsistencia visual en informes.

### Recomendacion
- Normalizar los nombres existentes con un UPDATE masivo.
- Siempre tomar el nombre de la tabla `Matrices` como fuente de verdad (el codigo ya lo hace para registros nuevos).

---

## HALLAZGO #7 - ALTO: 341 registros sin ID_Ejecucion

### Que encontre
- **341 registros** (6% del total) tienen `ID_Ejecucion = NULL`
- Estos registros **no tienen vinculo** con la tabla `Registros Produccion Cervantes`
- Son principalmente los datos de Enero (Mes 1) y los 7 registros con Mes=0

### Impacto
- Si se intenta editar/borrar desde el frontend, el codigo busca por `ID_Ejecucion` y no los encuentra.
- Son registros "huerfanos" que solo se pueden gestionar directamente en Supabase.

### Recomendacion
- Para datos historicos: generar `ID_Ejecucion` unicos retroactivamente.
- Hacer NOT NULL el campo para datos nuevos.

---

## HALLAZGO #8 - ALTO: Seguridad - anon tiene acceso total de lectura a passwords

### Que encontre
```
app_login → policy: anon_read_app_login → SELECT → anon → qual: true
```
Cualquier persona con la URL de Supabase y la anon key (que esta en el frontend, visible en el codigo fuente) puede hacer:
```sql
SELECT * FROM app_login;
```
Y obtener **todas las passwords en texto plano**.

### Impacto
- Las credenciales estan expuestas publicamente.
- El campo se llama `password_text`, lo que sugiere que no estan hasheadas.

### Recomendacion
- **Inmediato**: Cambiar la policy para que solo compare el hash, no devuelva la password.
- Usar Supabase Auth en lugar de tabla custom de login.
- Si no es posible, al menos hashear las passwords (bcrypt).

---

## HALLAZGO #9 - MEDIO: Datos de Enero con formato de fecha distinto

### Que encontre
Los registros de Mes=1 tienen `Fecha` con formato `2026-01-19 00:00:00+00` (medianoche UTC), mientras que los registros nuevos tienen `2026-03-05 03:00:00+00` (medianoche Argentina = 03:00 UTC).

Ademas hay **7 registros con Mes=0**, lo cual es un mes invalido.

### Impacto
- El RLS policy `anon_update_espejo_solo_hoy` usa `Dia` y `Mes` para restringir updates.
- Los registros con Mes=0 **nunca podran ser editados/borrados** por el frontend (no coinciden con ningun dia real).
- Posibles errores en filtros por fecha.

### Recomendacion
- Corregir los 7 registros con Mes=0 (investigar de donde vienen).
- Normalizar el timezone de los registros de Enero.

---

## HALLAZGO #10 - MEDIO: RLS de "solo hoy" puede bloquear ediciones legitimas

### Que encontre
Las policies de UPDATE/DELETE en `db_n8n_espejo` usan:
```sql
"Dia" = EXTRACT(day FROM now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
AND "Mes" = EXTRACT(month FROM now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
```

### Impacto
- Si un supervisor necesita corregir un registro de **ayer**, no puede hacerlo desde la app.
- El modulo Disruptivas intenta hacer UPDATE/DELETE de registros historicos → **falla silenciosamente** si el registro no es de hoy.
- La policy no considera el **ano**, asi que el 8 de abril de 2027 podria editar registros del 8 de abril de 2026.

### Recomendacion
- Evaluar si Disruptivas necesita una policy mas permisiva (ej: authenticated role para supervisores).
- Agregar el ano a la condicion.

---

## HALLAZGO #11 - MEDIO: Registros Produccion Cervantes desincronizado

### Que encontre
- `Registros Produccion Cervantes`: **1.013 registros**
- `db_n8n_espejo`: **5.694 registros**
- Relacion esperada: cada registro en Cervantes deberia generar 0 o 1 registro en espejo (segun si es cajon/TM).
- Los 341 registros sin `ID_Ejecucion` en espejo **no tienen contraparte** en Cervantes.

### Impacto
- No se puede hacer trazabilidad completa registro por registro.
- Los datos de Enero fueron cargados directamente en espejo sin pasar por Cervantes.

### Recomendacion
- Documentar que los datos pre-Febrero son importados y no tienen trazabilidad completa.
- Para datos nuevos, asegurar que siempre se inserte en ambas tablas.

---

## HALLAZGO #12 - MEDIO: Premios extremos no revisados

### Que encontre
Hay registros con premios absurdamente altos/bajos que no estan marcados como revisados:

| Premio | Legajo | Matriz | Motivo probable |
|--------|--------|--------|-----------------|
| -35.944 | 1 | 1 (Corte Cuchilla) | Legajo 1 = pruebas, Tiempo_Historico=3.5seg vs 12.584seg trabajados |
| -6.414 | 1 | 10 (Armado Varilla) | Idem, legajo de pruebas |
| -1.700 | 261 | 258 | Uni=2, Seg_Hist=21, Seg_Trab=3.591 → algo raro |
| -1.470 | 1 | 39 | Legajo de pruebas |
| -110 | 94 | 39 | Real, no anulado |

### Impacto
- Los premios de legajo "1" (sistema/pruebas) **contaminan los reportes** si no se filtran.
- Valores como -35.944 distorsionan promedios y graficos.

### Recomendacion
- El codigo ya excluye legajo "1" en reportes, pero no en Disruptivas al cargar.
- Marcar como `Revisado = true` o `Anular_Tiempo = true` los registros del legajo 1.
- Considerar un cleanup automatico de registros de prueba.

---

## HALLAZGO #13 - BAJO: Tabla Auditoria sin policy de INSERT

### Que encontre
La tabla `Auditoria_Produccion` existe con la estructura correcta (12 columnas), pero:
- Tiene **0 registros**
- No aparece en la lista de RLS policies

### Causa probable
Si RLS esta habilitado y no hay policy de INSERT para anon, el insert desde el frontend **falla silenciosamente** (Supabase devuelve `[]` en vez de error con anon key).

### Recomendacion
```sql
CREATE POLICY "anon_insert_auditoria" ON "Auditoria_Produccion"
FOR INSERT TO anon WITH CHECK (true);
```

---

## HALLAZGO #14 - BAJO: Campos texto donde deberian ser numericos

### Que encontre
- `Segundos_Trabajados`, `Segundos_Historico`, `Segundos_Tiempo_Muerto` son tipo **text** (varchar), no numeric.
- Esto obliga a castear constantemente y puede producir errores si se inserta un valor no numerico.

### Recomendacion
- A futuro, migrar a tipo `numeric` o `real`.
- Por ahora, agregar un CHECK constraint que valide que sea numerico.

---

## HALLAZGO #15 - BAJO: 16 registros con Matriz vacia + 14 con Uni NULL

### Que encontre
- 16 registros con `Matriz = ''` (vacio) → son registros "LT" (Llegada Tarde) que se insertaron con Matriz vacia.
- 14 registros con `Uni = NULL` → deberian ser 0 si son tiempos muertos.

### Recomendacion
- Corregir los 16 registros de LT para que tengan `Matriz = 'LT'`.
- Poner `Uni = 0` donde es NULL.
- Agregar NOT NULL con default 0 en `Uni`.

---

## RESUMEN DE NUMEROS

| Metrica | Valor |
|---------|-------|
| Total registros db_n8n_espejo | 5.694 |
| Registros con ID_Ejecucion duplicado (colisiones hash) | 2.582 (en 874 grupos) |
| Registros sobrantes por colisiones | 1.708 |
| Registros sin ID_Ejecucion | 341 |
| Registros con Premio incalculable (Seg_Hist=0, Uni>0) | 110 |
| Registros con Matriz vacia | 16 |
| Registros con Uni NULL | 14 |
| Registros con Mes invalido (0) | 7 |
| Soft deletes usados | 0 |
| Registros de auditoria | 0 |
| Foreign Keys entre tablas principales | 0 |
| Indices (aparte de PK) | 0 |
| Matrices sin Tiempo_Promedio con registros | 9 |
| Nombres inconsistentes de Matriz | 10 codigos afectados |

---

## PLAN DE ACCION RECOMENDADO (por prioridad)

### Inmediato (esta semana)
1. **Arreglar la funcion hashId()** para evitar colisiones, o usar UUID directo
2. **Crear policy INSERT en Auditoria_Produccion** para que empiece a grabar
3. **Completar Tiempo_Promedio** en las 9 matrices afectadas (especialmente 216, 236, 12B)
4. **Revisar seguridad de app_login** - no exponer passwords

### Corto plazo (proximo sprint)
5. **Crear indices** en db_n8n_espejo (Legajo+Dia+Mes, ID_Ejecucion, Fecha)
6. **Normalizar nombres** de matrices duplicados (UPDATE masivo)
7. **Limpiar registros de legajo "1"** (marcar como Anular_Tiempo)
8. **Corregir registros con Mes=0 y Matriz vacia**

### Mediano plazo
9. **Implementar Foreign Keys** (Legajo → Empleados, Matriz → Matrices)
10. **Migrar campos de texto a numeric** (Segundos_*)
11. **Revisar RLS policies** (agregar ano, considerar rol supervisor)
12. **Definir estrategia de soft delete vs hard delete** consistente

---

*Fin del informe. Cualquier duda o si queres que profundice en algun hallazgo, avisame.*
