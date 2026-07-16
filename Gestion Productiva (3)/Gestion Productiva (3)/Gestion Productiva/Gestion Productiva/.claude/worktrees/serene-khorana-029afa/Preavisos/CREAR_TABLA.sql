-- Ejecutar en Supabase SQL Editor del proyecto hrxfctzncixxqmpfhskv
-- Tabla para preavisos de entregas de PS y Talleristas

CREATE TABLE IF NOT EXISTS "Preavisos" (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  proveedor TEXT NOT NULL,
  cod_prov TEXT NOT NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  codigo TEXT NOT NULL,
  descripcion TEXT,
  cantidad INTEGER NOT NULL DEFAULT 0,
  unidad TEXT NOT NULL DEFAULT 'Cajas',
  estado TEXT NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE "Preavisos" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to Preavisos" ON "Preavisos"
  FOR ALL USING (true) WITH CHECK (true);
