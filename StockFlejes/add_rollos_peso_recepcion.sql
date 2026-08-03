-- Agregar columnas rollos y peso_x_rollo a Recepcion_Insumos
-- Ejecutar en Supabase Console
ALTER TABLE "Recepcion_Insumos"
ADD COLUMN IF NOT EXISTS "rollos" integer,
ADD COLUMN IF NOT EXISTS "peso_x_rollo" numeric;

-- Comentarios para documentación
COMMENT ON COLUMN "Recepcion_Insumos"."rollos" IS 'Número de rollos recibidos (solo para Flejes)';
COMMENT ON COLUMN "Recepcion_Insumos"."peso_x_rollo" IS 'Peso individual de cada rollo en kg (solo para Flejes)';
