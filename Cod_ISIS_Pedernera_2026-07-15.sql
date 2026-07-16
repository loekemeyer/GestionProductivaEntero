-- Cod_ISIS para Pedernera — generado 2026-07-15 desde "codigos nuevos LK procesos 29-6-26.xlsx"
-- Ver PROBLEMAS_CODIGOS_ISIS_2026-07-15.md (raiz del proyecto) para los 5 pendientes.
-- 32 codigos distintos -> 34 filas de "Partes x PS".
-- Excluidos a proposito: 5160600 (colision Bombillas Niqueladas), 5204600 y 5206600 (no existen en la lista nueva).
-- Cod_Prov_Externo NO se toca.

BEGIN;

ALTER TABLE "Partes x PS" ADD COLUMN IF NOT EXISTS "Cod_ISIS" text;

-- Manija Redonda
UPDATE "Partes x PS" SET "Cod_ISIS" = '0206' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5020600';
-- Mariposa Cromada
UPDATE "Partes x PS" SET "Cod_ISIS" = '0226' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5022600';
-- Varilla c/ Cuchilla  Abre Mani
UPDATE "Partes x PS" SET "Cod_ISIS" = '0866' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5086600';
-- Engranaje Gde  Abre Manija
UPDATE "Partes x PS" SET "Cod_ISIS" = '0876' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5087600';
-- Mgo Plano Abre Mariposa 502 Cr
UPDATE "Partes x PS" SET "Cod_ISIS" = '0916' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5091600';
-- Engranaje Chico - Abre Maripos
UPDATE "Partes x PS" SET "Cod_ISIS" = '0936' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5093600';
-- Manguito Pelapapas
UPDATE "Partes x PS" SET "Cod_ISIS" = '0956' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5095600';
-- Cuerpo - Sac Tipo Mozo
UPDATE "Partes x PS" SET "Cod_ISIS" = '0966' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5096600';
-- Cabezales Cromado
UPDATE "Partes x PS" SET "Cod_ISIS" = '0976' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5097600';
-- Aletas Izq - Sac Doble Aleta
UPDATE "Partes x PS" SET "Cod_ISIS" = '1076' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5107600';
-- Cremallera-SacDoble Aleta Crom
UPDATE "Partes x PS" SET "Cod_ISIS" = '1086' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5108600';
-- Bastidor Corto - Corta Queso
UPDATE "Partes x PS" SET "Cod_ISIS" = '1136' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5113600';
-- Sacafuentes - Pieza Grande
UPDATE "Partes x PS" SET "Cod_ISIS" = '1156' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5115600';
-- Sacafuentes - Pieza Chica
UPDATE "Partes x PS" SET "Cod_ISIS" = '1166' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5116600';
-- Destapacorona
UPDATE "Partes x PS" SET "Cod_ISIS" = '1176' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5117600';
-- 3 en 1 C/ Y S/MARCA (2 filas: 3 En 1 LK Crom. / 3 En 1 Ch Crom.)
UPDATE "Partes x PS" SET "Cod_ISIS" = '1186' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5118600';
-- Ahueca Papas 1
UPDATE "Partes x PS" SET "Cod_ISIS" = '1216' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5121600';
-- Ahueca Frutas 1
UPDATE "Partes x PS" SET "Cod_ISIS" = '1226' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5122600';
-- Sacafuente Pizzero 1
UPDATE "Partes x PS" SET "Cod_ISIS" = '1236' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5123600';
-- Rompenueces (2 filas: Rompenuez Cerrado LK Crom. / Rompenuez Abierto LK Crom.)
UPDATE "Partes x PS" SET "Cod_ISIS" = '1246' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5124600';
-- Resorte U Pinza Inox
UPDATE "Partes x PS" SET "Cod_ISIS" = '1286' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5128600';
-- Vastago Pala Canelones
UPDATE "Partes x PS" SET "Cod_ISIS" = '1296' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5129600';
-- Vastago de Espatula
UPDATE "Partes x PS" SET "Cod_ISIS" = '1356' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5135600';
-- Cuerpo Sacatapita Sac Comb 521
UPDATE "Partes x PS" SET "Cod_ISIS" = '2186' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5659600';
-- Sacatapita - Sac Combinado
UPDATE "Partes x PS" SET "Cod_ISIS" = '2196' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5660600';
-- PINZA LARGA CROMO
UPDATE "Partes x PS" SET "Cod_ISIS" = '2446' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '5690600';
-- Vastago para Cortapizza Cromad
UPDATE "Partes x PS" SET "Cod_ISIS" = '3326' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '6037600';
-- Vástago de pelapapas cromado
UPDATE "Partes x PS" SET "Cod_ISIS" = '3786' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '6083600';
-- Abrelata Uña 510 Cromado
UPDATE "Partes x PS" SET "Cod_ISIS" = '3896' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '6094600';
-- Vastago Cortapizza Gastro Crom
UPDATE "Partes x PS" SET "Cod_ISIS" = '4016' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '6106600';
-- SUPER MARIPOSITA
UPDATE "Partes x PS" SET "Cod_ISIS" = '4186' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '6160600';
-- Aletas Der - Sac Doble Aleta
UPDATE "Partes x PS" SET "Cod_ISIS" = '4306' WHERE lower(trim("PS")) = 'pedernera' AND "Cod_Prov_Externo" = '6173600';

-- Control: debe dar 34 filas con Cod_ISIS y 5 en NULL (2 sin mapeo + 1 colision + 2 sin Cod_Prov_Externo).
SELECT count(*) FILTER (WHERE "Cod_ISIS" IS NOT NULL) AS con_isis,
       count(*) FILTER (WHERE "Cod_ISIS" IS NULL)     AS sin_isis
FROM "Partes x PS" WHERE lower(trim("PS")) = 'pedernera';

COMMIT;
