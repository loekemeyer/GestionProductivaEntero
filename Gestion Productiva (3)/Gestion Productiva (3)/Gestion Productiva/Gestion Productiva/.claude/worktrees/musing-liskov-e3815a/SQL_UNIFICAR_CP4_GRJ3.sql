-- =============================================================================
-- SCRIPT DE UNIFICACIÓN: CP4 → GRJ3
-- Códigos asociados: 307, 580
-- Fecha: 2026-04-17
-- =============================================================================

-- 1. SP Kg tabla: cambiar Sp="CP4" a Sp="GRJ3"
UPDATE "SP Kg"
SET "Sp" = 'GRJ3'
WHERE "Sp" = 'CP4';

-- 2. Partes x Tallerista: cambiar sector_proce="CP4" a "GRJ3" (si existen)
UPDATE "Partes x Tallerista"
SET "sector_proce" = 'GRJ3'
WHERE "sector_proce" = 'CP4';

-- 3. Articulos Virgilio X Tallerista: cambiar Sector="CP4" a "GRJ3"
UPDATE "Articulos Virgilio X Tallerista"
SET "Sector" = 'GRJ3'
WHERE "Sector" = 'CP4';

-- 4. CRÍTICO - Control SP Kg: consolidar consumos mensuales
-- Sumar registros de CP4 a GRJ3 por mes/año
-- Primero: insertar suma de CP4 a GRJ3 (si no existe registro de GRJ3 para ese mes)
INSERT INTO "Control SP Kg" ("Sp", "Dia-mes", "kg", "Mes", "created_at")
SELECT 'GRJ3', "Dia-mes", SUM("kg"), "Mes", NOW()
FROM "Control SP Kg"
WHERE "Sp" = 'CP4'
GROUP BY "Dia-mes", "Mes"
ON CONFLICT DO NOTHING;

-- Luego: sumar CP4 a registros existentes de GRJ3
UPDATE "Control SP Kg" grj
SET "kg" = grj."kg" + (
  SELECT COALESCE(SUM("kg"), 0)
  FROM "Control SP Kg" cp4
  WHERE cp4."Sp" = 'CP4'
    AND cp4."Dia-mes" = grj."Dia-mes"
    AND cp4."Mes" = grj."Mes"
)
WHERE grj."Sp" = 'GRJ3'
  AND EXISTS (
    SELECT 1 FROM "Control SP Kg" cp4
    WHERE cp4."Sp" = 'CP4'
      AND cp4."Dia-mes" = grj."Dia-mes"
      AND cp4."Mes" = grj."Mes"
  );

-- Finalmente: eliminar registros de CP4
DELETE FROM "Control SP Kg"
WHERE "Sp" = 'CP4';

-- 5. Partes x PS: cambiar si existe CP4 como PS
UPDATE "Partes x PS"
SET "PS" = 'GRJ3'
WHERE "PS" = 'CP4';

-- =============================================================================
-- VERIFICACIÓN (ejecutar después de cambios)
-- =============================================================================

-- Ver registros consolidados de GRJ3 en Control SP Kg
SELECT "Sp", "Dia-mes", "Mes", SUM("kg") as "Total Kg"
FROM "Control SP Kg"
WHERE "Sp" = 'GRJ3'
GROUP BY "Sp", "Dia-mes", "Mes"
ORDER BY "Mes", "Dia-mes";

-- Ver que ya no exista CP4 en ninguna tabla
SELECT 'SP Kg' as tabla, COUNT(*) as registros FROM "SP Kg" WHERE "Sp" = 'CP4'
UNION ALL
SELECT 'Partes x Tallerista', COUNT(*) FROM "Partes x Tallerista" WHERE "sector_proce" = 'CP4'
UNION ALL
SELECT 'Articulos Virgilio X Tallerista', COUNT(*) FROM "Articulos Virgilio X Tallerista" WHERE "Sector" = 'CP4'
UNION ALL
SELECT 'Control SP Kg', COUNT(*) FROM "Control SP Kg" WHERE "Sp" = 'CP4'
UNION ALL
SELECT 'Partes x PS', COUNT(*) FROM "Partes x PS" WHERE "PS" = 'CP4';
