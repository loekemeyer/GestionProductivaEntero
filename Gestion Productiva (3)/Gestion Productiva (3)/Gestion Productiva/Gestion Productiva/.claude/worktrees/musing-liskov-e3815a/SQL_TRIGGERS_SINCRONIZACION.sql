-- ============================================================================
-- TRIGGERS DE SINCRONIZACIÓN BIDIRECCIONAL - PESOS
-- Ejecutar en Supabase SQL Editor
-- ============================================================================
-- PROBLEMA: Despiece x Articulo es una tabla derivada que se sincroniza
-- DESDE SP Kg y SC Kg, pero cuando actualizas Despiece x Articulo,
-- los cambios NO se sincronizan hacia atrás a las maestras.
--
-- SOLUCION: Crear triggers que mantengan los datos sincronizados en ambas
-- direcciones.
-- ============================================================================

-- ============================================================================
-- PASO 1: FUNCIÓN que sincroniza Despiece x Articulo → Partes x Tallerista
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sincronizar_pesos_a_partes_tallerista()
RETURNS TRIGGER AS $$
BEGIN
  -- Cuando se actualiza KGxUni o Kg x Caj en Despiece x Articulo
  -- Actualizar todos los registros en Partes x Tallerista que referenzan este despiece

  IF (TG_OP = 'UPDATE') THEN
    -- Solo procesar si cambiaron los pesos
    IF (OLD."KGxUni" != NEW."KGxUni" OR OLD."Kg x Caj" != NEW."Kg x Caj") THEN
      UPDATE public."Partes x Tallerista"
      SET
        kgxuni = NEW."KGxUni",
        kg_x_caj = NEW."Kg x Caj",
        updated_at = NOW()
      WHERE id_despiece = NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger para Despiece x Articulo → Partes x Tallerista
DROP TRIGGER IF EXISTS trigger_sincronizar_pesos_a_partes ON public."Despiece x Articulo";
CREATE TRIGGER trigger_sincronizar_pesos_a_partes
AFTER UPDATE ON public."Despiece x Articulo"
FOR EACH ROW
EXECUTE FUNCTION public.sincronizar_pesos_a_partes_tallerista();

-- ============================================================================
-- PASO 2: FUNCIÓN que sincroniza Despiece x Articulo → SP Kg y SC Kg
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sincronizar_pesos_a_maestras()
RETURNS TRIGGER AS $$
BEGIN
  -- Cuando se actualiza KGxUni o Kg x Caj en Despiece x Articulo
  -- Buscar el equivalente en SP Kg o SC Kg y actualizar

  IF (TG_OP = 'UPDATE') THEN
    -- Solo procesar si cambiaron los pesos
    IF (OLD."KGxUni" != NEW."KGxUni" OR OLD."Kg x Caj" != NEW."Kg x Caj") THEN

      -- Intentar actualizar en SP Kg (buscando por COD y Parte coincidente)
      UPDATE public."SP Kg"
      SET
        "Kg X Uni" = NEW."KGxUni",
        "KG x Cajon" = NEW."Kg x Caj"
      WHERE "Sp" = NEW."COD" OR "Parte" ILIKE '%' || NEW."Descripcion de partes" || '%';

      -- Intentar actualizar en SC Kg (buscando por COD y Descripcion coincidente)
      UPDATE public."SC Kg"
      SET
        "Kg X Uni" = NEW."KGxUni",
        "KG x Cajon" = NEW."Kg x Caj"
      WHERE "SC" = NEW."COD" OR "Descripcion" ILIKE '%' || NEW."Descripcion de partes" || '%';

    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Crear trigger para Despiece x Articulo → SP Kg / SC Kg
DROP TRIGGER IF EXISTS trigger_sincronizar_pesos_a_maestras ON public."Despiece x Articulo";
CREATE TRIGGER trigger_sincronizar_pesos_a_maestras
AFTER UPDATE ON public."Despiece x Articulo"
FOR EACH ROW
EXECUTE FUNCTION public.sincronizar_pesos_a_maestras();

-- ============================================================================
-- PASO 3: FUNCIÓN inversa - SP Kg / SC Kg → Despiece x Articulo
-- ============================================================================
CREATE OR REPLACE FUNCTION public.sincronizar_maestras_a_despiece()
RETURNS TRIGGER AS $$
BEGIN
  -- Cuando se actualiza SP Kg o SC Kg
  -- Actualizar Despiece x Articulo que referenzan este código

  IF (TG_OP = 'UPDATE') THEN
    IF (OLD."Kg X Uni" != NEW."Kg X Uni" OR OLD."KG x Cajon" != NEW."KG x Cajon") THEN

      IF TG_TABLE_NAME = 'SP Kg' THEN
        -- Actualizar Despiece que coincida con este Sp
        UPDATE public."Despiece x Articulo"
        SET
          "KGxUni" = NEW."Kg X Uni",
          "Kg x Caj" = NEW."KG x Cajon"
        WHERE "COD" = NEW."Sp";

      ELSIF TG_TABLE_NAME = 'SC Kg' THEN
        -- Actualizar Despiece que coincida con este SC
        UPDATE public."Despiece x Articulo"
        SET
          "KGxUni" = NEW."Kg X Uni",
          "Kg x Caj" = NEW."KG x Cajon"
        WHERE "COD" = NEW."SC";

      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger en SP Kg
DROP TRIGGER IF EXISTS trigger_sincronizar_sp_a_despiece ON public."SP Kg";
CREATE TRIGGER trigger_sincronizar_sp_a_despiece
AFTER UPDATE ON public."SP Kg"
FOR EACH ROW
EXECUTE FUNCTION public.sincronizar_maestras_a_despiece();

-- Trigger en SC Kg
DROP TRIGGER IF EXISTS trigger_sincronizar_sc_a_despiece ON public."SC Kg";
CREATE TRIGGER trigger_sincronizar_sc_a_despiece
AFTER UPDATE ON public."SC Kg"
FOR EACH ROW
EXECUTE FUNCTION public.sincronizar_maestras_a_despiece();

-- ============================================================================
-- VERIFICACIÓN - Listar triggers creados
-- ============================================================================
-- Ejecutar esto para verificar que los triggers se crearon:
-- SELECT trigger_name, event_object_table FROM information_schema.triggers
-- WHERE trigger_schema='public' AND trigger_name LIKE 'trigger_sincronizar%';

-- ============================================================================
-- PRUEBA - Ejecutar si quieres probar sincronización manual:
-- ============================================================================
-- UPDATE public."Despiece x Articulo"
-- SET "KGxUni" = 0.999, "Kg x Caj" = 99
-- WHERE "COD" = '031' AND "Descripcion de partes" = 'Alambre Filtro Café';
-- (Verificar que Partes x Tallerista y SP Kg también se actualizaron)
