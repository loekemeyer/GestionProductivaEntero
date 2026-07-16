-- ============================================================================
-- AUSENCIA AUTOMATICA - Supabase pg_cron
-- Ejecutar este SQL en el SQL Editor de Supabase
-- ============================================================================

-- PASO 1: Habilitar extensiones (ejecutar una sola vez)
-- Si ya estan habilitadas, no pasa nada
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- PASO 2: Crear la funcion que detecta ausencias
CREATE OR REPLACE FUNCTION public.registrar_ausencias()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  hoy DATE := CURRENT_DATE;
  es_feriado BOOLEAN := FALSE;
  emp RECORD;
BEGIN
  -- Verificar si hoy es feriado (tabla opcional, ver PASO 4)
  SELECT EXISTS(
    SELECT 1 FROM public."Feriados" WHERE fecha = hoy
  ) INTO es_feriado;

  IF es_feriado THEN
    RETURN; -- No registrar ausencias en feriados
  END IF;

  -- Recorrer empleados activos de Cervantes que NO tienen registro hoy
  FOR emp IN
    SELECT e."Legajo", e."Empleado"
    FROM public."Empleados" e
    WHERE UPPER(e."Activo") = 'SI'
      AND UPPER(e."Sede") = 'C'
      AND e."Legajo" != '95'  -- Excluir Juan Gervasoni
      AND NOT EXISTS (
        SELECT 1
        FROM public."db_n8n_espejo" d
        WHERE d."Legajo" = e."Legajo"
          AND d."Fecha"::date = hoy
      )
  LOOP
    INSERT INTO public."db_n8n_espejo" (
      "Fecha",
      "Legajo",
      "Nombre_Empleado",
      "Matriz",
      "Nombre_Matriz",
      "Uni",
      "Premio",
      "Tiempo_Toma",
      "Tiempo_Historico",
      "Segundos_Historico",
      "Segundos_Trabajados",
      "Segundos_Tiempo_Muerto",
      "Hora_Inicio",
      "Hora_Fin",
      "Anular_Tiempo",
      "Dia",
      "Mes",
      "Quincena"
    ) VALUES (
      hoy,
      emp."Legajo",
      emp."Empleado",
      'Ausencia',
      'Ausencia',
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      '00:00:00',
      '00:00:00',
      FALSE,
      EXTRACT(DAY FROM hoy),
      EXTRACT(MONTH FROM hoy),
      CASE WHEN EXTRACT(DAY FROM hoy) > 15 THEN 2 ELSE 1 END
    );
  END LOOP;
END;
$$;

-- PASO 3: Programar el cron job - Lun a Vie a las 21:00 hora Argentina (UTC-3 = 00:00 UTC del dia siguiente)
-- pg_cron usa UTC, asi que 21:00 Argentina = 00:00 UTC
SELECT cron.schedule(
  'registrar-ausencias',        -- nombre del job
  '0 0 * * 2-6',                -- 00:00 UTC Mar-Sab = 21:00 UTC-3 Lun-Vie
  $$SELECT public.registrar_ausencias()$$
);

-- ============================================================================
-- PASO 4 (OPCIONAL): Crear tabla de Feriados
-- Si no queres usar esta tabla, comenta el bloque de verificacion de feriados
-- en la funcion de arriba y listo
-- ============================================================================
CREATE TABLE IF NOT EXISTS public."Feriados" (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL UNIQUE,
  descripcion TEXT
);

-- Cargar feriados 2026 Argentina (los principales)
INSERT INTO public."Feriados" (fecha, descripcion) VALUES
  ('2026-01-01', 'Año Nuevo'),
  ('2026-02-16', 'Carnaval'),
  ('2026-02-17', 'Carnaval'),
  ('2026-03-24', 'Dia de la Memoria'),
  ('2026-04-02', 'Dia del Veterano'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Dia del Trabajador'),
  ('2026-05-25', 'Dia de la Revolucion de Mayo'),
  ('2026-06-15', 'Paso a la Inmortalidad de Guemes'),
  ('2026-06-20', 'Dia de la Bandera'),
  ('2026-07-09', 'Dia de la Independencia'),
  ('2026-08-17', 'Paso a la Inmortalidad de San Martin'),
  ('2026-10-12', 'Dia del Respeto a la Diversidad Cultural'),
  ('2026-11-23', 'Dia de la Soberania Nacional'),
  ('2026-12-08', 'Dia de la Inmaculada Concepcion'),
  ('2026-12-25', 'Navidad')
ON CONFLICT (fecha) DO NOTHING;

-- ============================================================================
-- COMANDOS UTILES:
--
-- Ver jobs programados:
--   SELECT * FROM cron.job;
--
-- Ver historial de ejecuciones:
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--
-- Ejecutar manualmente para probar:
--   SELECT public.registrar_ausencias();
--
-- Desactivar el job:
--   SELECT cron.unschedule('registrar-ausencias');
--
-- ============================================================================
