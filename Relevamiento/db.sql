-- ============================================================
-- Schema relevamiento_cervantes  (fuente de verdad)
-- Ya APLICADO en Supabase proyecto hrxfctzncixxqmpfhskv (Control Partes Talleristas).
-- Este archivo documenta la estructura + API para reproducir/versionar.
--
-- Modelo (MVP):
--   CATALOGO (info fija por pieza)   cat_*         <- cargado desde hojas 'Conteo/Relevamiento VACIO' + 'Pedido VACIO' de cada Excel
--   CABECERA (1 fila por relevamiento) relevamientos  (tipo, planta, fecha, encargado)
--   DETALLE  (conteo)                det_*         <- generado desde el catalogo por generar_relevamiento()
--
--   Plantas por tipo:  flejes = Cervantes/Virgilio/San Roque ; cajas y plasticos = Cervantes/Virgilio ; resto = Cervantes.
--   Conteo por planta: cajas Cerv=paq+uni_suelta / Virg=uni ; flejes Cerv=rollos+total_kg / Virg-SR=stock_kg.
--   Seeds cargados: cat_cajas 14 · cat_flejes 62 · cat_cartones 243 · cat_plasticos 64 · cat_remaches 22 · cat_bombillas 22 · cat_garage 17.
-- ============================================================
create schema if not exists relevamiento_cervantes;

-- ---------- CATALOGOS ----------
create table if not exists relevamiento_cervantes.cat_cajas (
  id bigint generated always as identity primary key,
  n_caja text, cod_isis_lk text, cod_isis_ch text, sector text, uni_x_paq numeric);
create table if not exists relevamiento_cervantes.cat_flejes (
  id bigint generated always as identity primary key,
  n_fleje text, sector text, descripcion text, medida_mm text, n_orden text, prov text);
create table if not exists relevamiento_cervantes.cat_cartones (
  id bigint generated always as identity primary key,
  cod text, linea text, descripcion text, sector text, uni_x_paq numeric, prov text);
create table if not exists relevamiento_cervantes.cat_plasticos (
  id bigint generated always as identity primary key,
  descripcion text, nuevo_sector text, sector text, uni_x_bolsa numeric);
create table if not exists relevamiento_cervantes.cat_remaches (
  id bigint generated always as identity primary key,
  cod_isis text, descripcion text, medida text, sector_proc text, sector_crudo text, proveedor text, kg_x_bolsa numeric);
create table if not exists relevamiento_cervantes.cat_bombillas (
  id bigint generated always as identity primary key,
  cod_isis text, descripcion text, sector text, proveedor text, uni_x_bc numeric);
create table if not exists relevamiento_cervantes.cat_garage (
  id bigint generated always as identity primary key,
  taller_prov text, sector text, cod_art text, cod_isis text, descripcion text);

-- ---------- CABECERA ----------
create table if not exists relevamiento_cervantes.relevamientos (
  id        bigint generated always as identity primary key,
  tipo      text not null check (tipo in ('cajas','flejes','cartones','plasticos','remaches','bombillas','garage')),
  planta    text not null default 'Cervantes' check (planta in ('Cervantes','Virgilio','San Roque')),
  fecha       date not null,
  encargado   text,        -- obligatorio desde el modulo (no en DB)
  dispositivo text,        -- (no se usa; el modulo no lo envia)
  grupo_id    bigint,      -- une los lugares de un mismo relevamiento (principal: grupo_id = id propio)
  estado      text not null default 'abierto' check (estado in ('abierto','cerrado')),
  creado_en   timestamptz not null default now());
-- rc_generar(tipo,planta,fecha,encargado) abre un grupo nuevo (grupo_id = id).
-- rc_agregar_lugar(grupo_id,planta,fecha,encargado) agrega OTRO lugar al mismo grupo (con su propio encargado/fecha).
-- El modulo agrupa por grupo_id: 1 relevamiento = varios lugares; el total = suma de los lugares.

-- ---------- DETALLES (conteo) ----------
create table if not exists relevamiento_cervantes.det_cajas (
  id bigint generated always as identity primary key,
  relevamiento_id bigint not null references relevamiento_cervantes.relevamientos(id) on delete cascade,
  caja_id bigint not null references relevamiento_cervantes.cat_cajas(id),
  conteo_paq numeric, uni_suelta numeric, uni numeric);
create table if not exists relevamiento_cervantes.det_flejes (
  id bigint generated always as identity primary key,
  relevamiento_id bigint not null references relevamiento_cervantes.relevamientos(id) on delete cascade,
  fleje_id bigint not null references relevamiento_cervantes.cat_flejes(id),
  rollo1_nro text, rollo1_kg numeric, rollo2_nro text, rollo2_kg numeric, rollo3_nro text, rollo3_kg numeric, total_kg numeric, stock_kg numeric,
  rollos_json jsonb);  -- Cervantes: desglose de rollos por tandas (array de {caj,kg}); total_kg = suma de caj*kg. Los rollo*_nro/kg quedan legacy.
create table if not exists relevamiento_cervantes.det_cartones (
  id bigint generated always as identity primary key,
  relevamiento_id bigint not null references relevamiento_cervantes.relevamientos(id) on delete cascade,
  carton_id bigint not null references relevamiento_cervantes.cat_cartones(id),
  conteo_paquete numeric, uni_suelta numeric);
create table if not exists relevamiento_cervantes.det_plasticos (
  id bigint generated always as identity primary key,
  relevamiento_id bigint not null references relevamiento_cervantes.relevamientos(id) on delete cascade,
  plastico_id bigint not null references relevamiento_cervantes.cat_plasticos(id),
  stock_relev_bolsa numeric, uni_suelta numeric);
create table if not exists relevamiento_cervantes.det_remaches (
  id bigint generated always as identity primary key,
  relevamiento_id bigint not null references relevamiento_cervantes.relevamientos(id) on delete cascade,
  remache_id bigint not null references relevamiento_cervantes.cat_remaches(id),
  bolsas_niquel numeric, stock_crudo_kg numeric);
create table if not exists relevamiento_cervantes.det_bombillas (
  id bigint generated always as identity primary key,
  relevamiento_id bigint not null references relevamiento_cervantes.relevamientos(id) on delete cascade,
  bombilla_id bigint not null references relevamiento_cervantes.cat_bombillas(id),
  stock_bolsa_caj_rollo numeric, uni_suelta numeric);
create table if not exists relevamiento_cervantes.det_garage (
  id bigint generated always as identity primary key,
  relevamiento_id bigint not null references relevamiento_cervantes.relevamientos(id) on delete cascade,
  garage_id bigint not null references relevamiento_cervantes.cat_garage(id),
  stock_actual_cajon numeric);

-- ---------- GENERADOR ----------
create or replace function relevamiento_cervantes.generar_relevamiento(
  p_tipo text, p_planta text default 'Cervantes', p_fecha date default current_date,
  p_encargado text default null, p_dispositivo text default null)
returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into relevamiento_cervantes.relevamientos(tipo,planta,fecha,encargado,dispositivo)
  values (p_tipo,p_planta,p_fecha,p_encargado,p_dispositivo) returning id into v_id;
  if p_tipo='cajas'     then insert into relevamiento_cervantes.det_cajas(relevamiento_id,caja_id)         select v_id,id from relevamiento_cervantes.cat_cajas;     end if;
  if p_tipo='flejes'    then insert into relevamiento_cervantes.det_flejes(relevamiento_id,fleje_id)       select v_id,id from relevamiento_cervantes.cat_flejes;    end if;
  if p_tipo='cartones'  then insert into relevamiento_cervantes.det_cartones(relevamiento_id,carton_id)    select v_id,id from relevamiento_cervantes.cat_cartones;  end if;
  if p_tipo='plasticos' then insert into relevamiento_cervantes.det_plasticos(relevamiento_id,plastico_id)select v_id,id from relevamiento_cervantes.cat_plasticos; end if;
  if p_tipo='remaches'  then insert into relevamiento_cervantes.det_remaches(relevamiento_id,remache_id)   select v_id,id from relevamiento_cervantes.cat_remaches;  end if;
  if p_tipo='bombillas' then insert into relevamiento_cervantes.det_bombillas(relevamiento_id,bombilla_id)select v_id,id from relevamiento_cervantes.cat_bombillas; end if;
  if p_tipo='garage'    then insert into relevamiento_cervantes.det_garage(relevamiento_id,garage_id)      select v_id,id from relevamiento_cervantes.cat_garage;    end if;
  return v_id;
end $$;

-- ============================================================
-- API PUBLICA (vistas + RPC en public) — la usa el modulo Relevamiento/ vía anon key.
--   v_rc_relevamientos : cabeceras + contadores (items / cargados)
--   v_rc_detalle       : todas las filas de detalle con forma comun (info + conteo jsonb + flag cargado)
--   rc_generar / rc_set_conteo / rc_completar_plantas / rc_borrar / rc_plantas_tipo
-- Definicion completa: ver migracion 'relevamiento_cervantes_api_publica' en Supabase.
-- ============================================================
