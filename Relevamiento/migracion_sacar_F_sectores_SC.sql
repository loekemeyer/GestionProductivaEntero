-- =====================================================================
-- MIGRACION: sacar la "F" de los sectores SC  (HF1 -> H1, IF16 -> I16, LLF7B -> LL7B, ...)
-- Fecha: 2026-08-10   Autor: Claude (para revision de loekemeyer)
-- ESTADO: NO EJECUTADA. Este archivo es para REVISAR antes de correr.
--
-- CONTEXTO
--   El codigo del sector con "F" (HF/IF/JF/KF/LF/LLF + numero) es UNA identidad:
--   el mismo valor aparece como sector Y como codigo de la pieza cruda (COD/Cod_Art/
--   componente) y en bombilla. Por eso se renombra EN TODAS esas celdas a la vez,
--   asi nada queda desalineado (media tabla con F y media sin).
--
--   Colisiones verificadas: NINGUNA (ningun destino H1/K2/... existe ya como otra cosa).
--
-- SE RENOMBRA (49 sectores):
--   H1,H6,H7,H11,H15,H16 · I1,I2,I3,I4,I6,I10,I11,I12,I14,I16 ·
--   J1,J2,J5,J7,J8,J10,J12,J13,J14,J15 · K2,K3,K5,K7,K8,K9,K11,K14 ·
--   L8,L9,L10,L11,L12,L13,L15,L16 · LL1,LL2,LL3,LL4,LL7A,LL7B,LL8
--
-- NO se toca (revisar aparte / no es campo de sector):
--   - db_n8n_espejo.Nombre_Matriz  (texto "(JF5)"), Matrices.Matriz, UnixCajon.Desc_Matriz
--   - articulos.sector (Virgilio): tiene KF15/IF7/IF7-IF6 que NO existen en SC Kg
--   - Matrices_audit (jsonb), _restructura_sectores, *_backup_*, db_n8n_espejo_historico_*
--
-- COMO CORRER: todo en UNA transaccion (BEGIN..COMMIT). Triggers OFF durante el rename,
--   ON al final + 1 recalc. Si algo falla -> ROLLBACK deja todo como estaba.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0) BACKUP de las tablas afectadas (sufijo _bkp_20260810)
-- ---------------------------------------------------------------------
CREATE TABLE public."SC_Kg_bkp_20260810"                    AS SELECT * FROM public."SC Kg";
CREATE TABLE public."SP_Kg_bkp_20260810"                    AS SELECT * FROM public."SP Kg";
CREATE TABLE public."Despiece_bkp_20260810"                 AS SELECT * FROM public."Despiece x Articulo";
CREATE TABLE public."CausaEfecto_bkp_20260810"              AS SELECT * FROM public."Causa-Efecto";
CREATE TABLE public."PartesxPS_bkp_20260810"                AS SELECT * FROM public."Partes x PS";
CREATE TABLE public."PartesxTallerista_bkp_20260810"        AS SELECT * FROM public."Partes x Tallerista";
CREATE TABLE public."ArtVxT_bkp_20260810"                   AS SELECT * FROM public."Articulos Virgilio X Tallerista";
CREATE TABLE public."GRJComponentes_bkp_20260810"           AS SELECT * FROM public."GRJ_Componentes";
CREATE TABLE public."EntTallCerv_bkp_20260810"              AS SELECT * FROM public."Entregas Tallerista Cervantes";
CREATE TABLE public."partes_excluidas_bkp_20260810"         AS SELECT * FROM public."partes_excluidas_por_tallerista";
CREATE TABLE public."EnviosaPS_bkp_20260810"                AS SELECT * FROM public."Envios a PS";
CREATE TABLE public."EntregasPS_bkp_20260810"               AS SELECT * FROM public."Entregas PS";
CREATE TABLE public."EnviosTall_bkp_20260810"               AS SELECT * FROM public."Envios a Talleristas";
CREATE TABLE public."SectorBombilla_bkp_20260810"           AS SELECT * FROM public."Sector Bombilla";
CREATE TABLE public."RutasConfirmadas_bkp_20260810"         AS SELECT * FROM public."Rutas_Confirmadas";
CREATE TABLE public."RutasProblemas_bkp_20260810"           AS SELECT * FROM public."Rutas_Problemas";
CREATE TABLE relevamiento_cervantes.cat_sc_sp_bkp_20260810  AS SELECT * FROM relevamiento_cervantes.cat_sc_sp;
CREATE TABLE relevamiento_cervantes.cat_bombillas_bkp_20260810 AS SELECT * FROM relevamiento_cervantes.cat_bombillas;

-- ---------------------------------------------------------------------
-- 1) Triggers OFF (evita recalcs/sync a mitad de camino y estados inconsistentes)
-- ---------------------------------------------------------------------
SET session_replication_role = replica;

-- ---------------------------------------------------------------------
-- 2) RENAME: sacar la F.  Solo filas cuyo valor EMPIEZA con el patron F.
--    regexp_replace('^(H|I|J|K|L|LL)F', '\1')  ->  HF1->H1, IF16->I16, LLF7B->LL7B
-- ---------------------------------------------------------------------

-- 2a) Sector (campo de sector directo)
UPDATE public."SC Kg"                      SET "SC"           = regexp_replace("SC",'^(H|I|J|K|L|LL)F','\1')           WHERE "SC" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."SP Kg"                      SET "Sp"           = regexp_replace("Sp",'^(H|I|J|K|L|LL)F','\1')           WHERE "Sp" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE relevamiento_cervantes.cat_sc_sp    SET sector         = regexp_replace(sector,'^(H|I|J|K|L|LL)F','\1')         WHERE sector ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Despiece x Articulo"        SET "Sector Proce" = regexp_replace("Sector Proce",'^(H|I|J|K|L|LL)F','\1') WHERE "Sector Proce" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Causa-Efecto"               SET "Descuenta"    = regexp_replace("Descuenta",'^(H|I|J|K|L|LL)F','\1')    WHERE "Descuenta" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Causa-Efecto"               SET "Aumenta"      = regexp_replace("Aumenta",'^(H|I|J|K|L|LL)F','\1')      WHERE "Aumenta" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Partes x PS"                SET "SC"           = regexp_replace("SC",'^(H|I|J|K|L|LL)F','\1')           WHERE "SC" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Partes x PS"                SET "SC_Original"  = regexp_replace("SC_Original",'^(H|I|J|K|L|LL)F','\1')  WHERE "SC_Original" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Partes x PS"                SET "SP"           = regexp_replace("SP",'^(H|I|J|K|L|LL)F','\1')           WHERE "SP" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Partes x Tallerista"        SET sector_proce   = regexp_replace(sector_proce,'^(H|I|J|K|L|LL)F','\1')   WHERE sector_proce ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."partes_excluidas_por_tallerista" SET sector_proce = regexp_replace(sector_proce,'^(H|I|J|K|L|LL)F','\1') WHERE sector_proce ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Sector Bombilla"            SET "Sector"       = regexp_replace("Sector",'^(H|I|J|K|L|LL)F','\1')       WHERE "Sector" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE relevamiento_cervantes.cat_bombillas SET sector        = regexp_replace(sector,'^(H|I|J|K|L|LL)F','\1')         WHERE sector ~ '^(H|I|J|K|L|LL)F[0-9]';

-- 2b) Coincidencias: el MISMO sector usado como codigo de la pieza cruda / componente
--     (a revisar caso por caso; se incluyen para NO desalinear con el sector)
UPDATE public."Despiece x Articulo"        SET "COD"          = regexp_replace("COD",'^(H|I|J|K|L|LL)F','\1')          WHERE "COD" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Articulos Virgilio X Tallerista" SET "Cod_Art" = regexp_replace("Cod_Art",'^(H|I|J|K|L|LL)F','\1')     WHERE "Cod_Art" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Partes x Tallerista"        SET cod            = regexp_replace(cod,'^(H|I|J|K|L|LL)F','\1')            WHERE cod ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Partes x Tallerista"        SET cod_art        = regexp_replace(cod_art,'^(H|I|J|K|L|LL)F','\1')        WHERE cod_art ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."GRJ_Componentes"            SET componente     = regexp_replace(componente,'^(H|I|J|K|L|LL)F','\1')     WHERE componente ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."GRJ_Componentes"            SET cod_grj        = regexp_replace(cod_grj,'^(H|I|J|K|L|LL)F','\1')        WHERE cod_grj ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Entregas Tallerista Cervantes" SET "Cod"       = regexp_replace("Cod",'^(H|I|J|K|L|LL)F','\1')          WHERE "Cod" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Entregas Tallerista Cervantes" SET "Cod_GRJ"   = regexp_replace("Cod_GRJ",'^(H|I|J|K|L|LL)F','\1')      WHERE "Cod_GRJ" ~ '^(H|I|J|K|L|LL)F[0-9]';

-- 2c) Movimientos historicos (Sector SC / Sector SP / Sector)
UPDATE public."Envios a PS"                SET "Sector SC"    = regexp_replace("Sector SC",'^(H|I|J|K|L|LL)F','\1')    WHERE "Sector SC" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Envios a PS"                SET "Sector SP"    = regexp_replace("Sector SP",'^(H|I|J|K|L|LL)F','\1')    WHERE "Sector SP" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Entregas PS"                SET "Sector SC"    = regexp_replace("Sector SC",'^(H|I|J|K|L|LL)F','\1')    WHERE "Sector SC" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Entregas PS"                SET "Sector SP"    = regexp_replace("Sector SP",'^(H|I|J|K|L|LL)F','\1')    WHERE "Sector SP" ~ '^(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Envios a Talleristas"       SET "Sector"       = regexp_replace("Sector",'^(H|I|J|K|L|LL)F','\1')       WHERE "Sector" ~ '^(H|I|J|K|L|LL)F[0-9]';

-- 2d) Rutas (jsonb + firma): el codigo va EMBEBIDO -> reemplazo global con borde de palabra
--     \y(H|I|J|K|L|LL)F([0-9]) -> \1\2   (no toca el prefijo "F:" ni "Fleje N")
UPDATE public."Rutas_Confirmadas"
   SET firma     = regexp_replace(firma,'\y(H|I|J|K|L|LL)F([0-9])','\1\2','g'),
       ruta_json = regexp_replace(ruta_json::text,'\y(H|I|J|K|L|LL)F([0-9])','\1\2','g')::jsonb
 WHERE firma ~ '\y(H|I|J|K|L|LL)F[0-9]' OR ruta_json::text ~ '\y(H|I|J|K|L|LL)F[0-9]';
UPDATE public."Rutas_Problemas"
   SET firma     = regexp_replace(firma,'\y(H|I|J|K|L|LL)F([0-9])','\1\2','g'),
       ruta_json = regexp_replace(ruta_json::text,'\y(H|I|J|K|L|LL)F([0-9])','\1\2','g')::jsonb
 WHERE firma ~ '\y(H|I|J|K|L|LL)F[0-9]' OR ruta_json::text ~ '\y(H|I|J|K|L|LL)F[0-9]';

-- ---------------------------------------------------------------------
-- 3) Triggers ON
-- ---------------------------------------------------------------------
SET session_replication_role = DEFAULT;

-- ---------------------------------------------------------------------
-- 4) RECALC final (1 sola vez, ya con todo consistente en H1)
-- ---------------------------------------------------------------------
SELECT public.actualizar_despiece();
SELECT public.actualizar_partes_ps();
SELECT public.actualizar_partes_tallerista();
SELECT public.recalcular_stock_online_cajon_total();

-- ---------------------------------------------------------------------
-- 5) VERIFICACION: deben dar 0 refs con F en las columnas tocadas
--    (correr este SELECT antes del COMMIT; si algo != 0 -> ROLLBACK)
-- ---------------------------------------------------------------------
SELECT * FROM (
  SELECT 'SC Kg.SC' c, count(*) n FROM public."SC Kg" WHERE "SC" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'SP Kg.Sp', count(*) FROM public."SP Kg" WHERE "Sp" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'cat_sc_sp', count(*) FROM relevamiento_cervantes.cat_sc_sp WHERE sector ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Despiece.Sector Proce', count(*) FROM public."Despiece x Articulo" WHERE "Sector Proce" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Despiece.COD', count(*) FROM public."Despiece x Articulo" WHERE "COD" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'CausaEfecto', count(*) FROM public."Causa-Efecto" WHERE "Descuenta" ~ '^(H|I|J|K|L|LL)F[0-9]' OR "Aumenta" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Partes x PS', count(*) FROM public."Partes x PS" WHERE "SC" ~ '^(H|I|J|K|L|LL)F[0-9]' OR "SP" ~ '^(H|I|J|K|L|LL)F[0-9]' OR "SC_Original" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Partes x Tallerista', count(*) FROM public."Partes x Tallerista" WHERE sector_proce ~ '^(H|I|J|K|L|LL)F[0-9]' OR cod ~ '^(H|I|J|K|L|LL)F[0-9]' OR cod_art ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Art VxT.Cod_Art', count(*) FROM public."Articulos Virgilio X Tallerista" WHERE "Cod_Art" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'GRJ_Componentes', count(*) FROM public."GRJ_Componentes" WHERE componente ~ '^(H|I|J|K|L|LL)F[0-9]' OR cod_grj ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Ent Tall Cerv', count(*) FROM public."Entregas Tallerista Cervantes" WHERE "Cod" ~ '^(H|I|J|K|L|LL)F[0-9]' OR "Cod_GRJ" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Envios a PS', count(*) FROM public."Envios a PS" WHERE "Sector SC" ~ '^(H|I|J|K|L|LL)F[0-9]' OR "Sector SP" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Entregas PS', count(*) FROM public."Entregas PS" WHERE "Sector SC" ~ '^(H|I|J|K|L|LL)F[0-9]' OR "Sector SP" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Envios Tall', count(*) FROM public."Envios a Talleristas" WHERE "Sector" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Sector Bombilla', count(*) FROM public."Sector Bombilla" WHERE "Sector" ~ '^(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Rutas Confirmadas', count(*) FROM public."Rutas_Confirmadas" WHERE firma ~ '\y(H|I|J|K|L|LL)F[0-9]' OR ruta_json::text ~ '\y(H|I|J|K|L|LL)F[0-9]'
  UNION ALL SELECT 'Rutas Problemas', count(*) FROM public."Rutas_Problemas" WHERE firma ~ '\y(H|I|J|K|L|LL)F[0-9]' OR ruta_json::text ~ '\y(H|I|J|K|L|LL)F[0-9]'
) v WHERE n > 0;   -- ideal: 0 filas

-- Si la verificacion dio 0 filas -> COMMIT.  Si no -> ROLLBACK.
COMMIT;

-- Limpieza de backups (cuando se confirme que todo quedo OK, correr aparte):
-- DROP TABLE public."SC_Kg_bkp_20260810", public."SP_Kg_bkp_20260810", ... ;
