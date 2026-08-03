-- ============================================
-- RECEPCION_INSUMOS: Crear tabla + columnas
-- ============================================

-- Opción 1: Si la tabla NO EXISTE, crearla completa
CREATE TABLE IF NOT EXISTS "Recepcion_Insumos" (
  id bigserial PRIMARY KEY,
  fecha date NOT NULL,
  proveedor text,
  rubro text,
  codigo text,
  descripcion text,
  cantidad numeric,
  unidad text,
  remito text,
  rollos integer,
  peso_x_rollo numeric,
  created_at timestamp with time zone DEFAULT now()
);

-- Opción 2: Si la tabla YA EXISTE, solo agregar las columnas de flejes y medida
-- (descomenta esto si ya tienes Recepcion_Insumos)
/*
ALTER TABLE "Recepcion_Insumos"
ADD COLUMN IF NOT EXISTS "rollos" integer,
ADD COLUMN IF NOT EXISTS "peso_x_rollo" numeric,
ADD COLUMN IF NOT EXISTS "medida" text;

COMMENT ON COLUMN "Recepcion_Insumos"."rollos" IS 'Número de rollos recibidos (solo para Flejes)';
COMMENT ON COLUMN "Recepcion_Insumos"."peso_x_rollo" IS 'Peso individual de cada rollo en kg (solo para Flejes)';
COMMENT ON COLUMN "Recepcion_Insumos"."medida" IS 'Medida del fleje (ancho x espesor) o especificación técnica del artículo';
*/

-- Índices para mejorar búsquedas
CREATE INDEX IF NOT EXISTS idx_recepcion_fecha ON "Recepcion_Insumos"(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_recepcion_proveedor ON "Recepcion_Insumos"(proveedor);
CREATE INDEX IF NOT EXISTS idx_recepcion_rubro ON "Recepcion_Insumos"(rubro);
CREATE INDEX IF NOT EXISTS idx_recepcion_codigo ON "Recepcion_Insumos"(codigo);

-- RLS (Row Level Security) - permitir lectura/escritura a usuarios autenticados
ALTER TABLE "Recepcion_Insumos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read"
  ON "Recepcion_Insumos"
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to insert"
  ON "Recepcion_Insumos"
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');
