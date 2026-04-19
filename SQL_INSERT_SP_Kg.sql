-- ============================================================================
-- INSERT DE 8 REGISTROS EN SP Kg
-- Ejecutar en Supabase SQL Editor con usuario admin
-- ============================================================================

-- GRJ13 - Bowls 330ml (sin pesos aún)
INSERT INTO public."SP Kg" ("Sp", "Parte", "Stock Inicial", "Stock Online Cajon Total", "Max Cajon SP Cerv", "Max Cajon SP Virg", "Max Cajon SP Total")
VALUES ('GRJ13', 'Bowls 330ml', 0, 0, 0, 0, 0)
ON CONFLICT DO NOTHING;

-- GRJ3 - Cepillo Limp Vaso Mamadera
INSERT INTO public."SP Kg" ("Sp", "Parte", "Kg X Uni", "KG x Cajon", "Stock Inicial", "Stock Online Cajon Total", "Max Cajon SP Cerv", "Max Cajon SP Virg", "Max Cajon SP Total")
VALUES ('GRJ3', 'Cepillo Limp Vaso Mamadera', 0.01594, 1.9128, 0, 0, 0, 0, 0)
ON CONFLICT DO NOTHING;

-- Z21 - Cuchillo Torta CH/LK
INSERT INTO public."SP Kg" ("Sp", "Parte", "Kg X Uni", "KG x Cajon", "Stock Inicial", "Stock Online Cajon Total", "Max Cajon SP Cerv", "Max Cajon SP Virg", "Max Cajon SP Total")
VALUES ('Z21', 'Cuchillo Torta CH/LK', 0.01932, 10, 0, 0, 0, 0, 0)
ON CONFLICT DO NOTHING;

-- Z20 - Pala Torta
INSERT INTO public."SP Kg" ("Sp", "Parte", "Kg X Uni", "KG x Cajon", "Stock Inicial", "Stock Online Cajon Total", "Max Cajon SP Cerv", "Max Cajon SP Virg", "Max Cajon SP Total")
VALUES ('Z20', 'Pala Torta', 0.0389633, 8.875, 0, 0, 0, 0, 0)
ON CONFLICT DO NOTHING;

-- Z25B - Argolla Chica
INSERT INTO public."SP Kg" ("Sp", "Parte", "Kg X Uni", "KG x Cajon", "Stock Inicial", "Stock Online Cajon Total", "Max Cajon SP Cerv", "Max Cajon SP Virg", "Max Cajon SP Total")
VALUES ('Z25B', 'Argolla Chica', 0.000482, 4.75, 0, 0, 0, 0, 0)
ON CONFLICT DO NOTHING;

-- Z25A - Argolla Grande
INSERT INTO public."SP Kg" ("Sp", "Parte", "Kg X Uni", "KG x Cajon", "Stock Inicial", "Stock Online Cajon Total", "Max Cajon SP Cerv", "Max Cajon SP Virg", "Max Cajon SP Total")
VALUES ('Z25A', 'Argolla Grande', 0.00319, 10.479, 0, 0, 0, 0, 0)
ON CONFLICT DO NOTHING;

-- GRJ15 - Bombilla Plana Ancha (sin pesos)
-- YA EXISTE - no es necesario insertar de nuevo

-- GRJ14 - Bombilla Pico de Loro (sin pesos)
-- YA EXISTE - no es necesario insertar de nuevo

-- ============================================================================
-- VERIFICACION - Ejecutar esto para ver los 8 registros
-- ============================================================================
SELECT "Sp", "Parte", "Kg X Uni", "KG x Cajon"
FROM public."SP Kg"
WHERE "Sp" IN ('GRJ13', 'GRJ3', 'Z21', 'Z20', 'Z25B', 'Z25A', 'GRJ15', 'GRJ14')
ORDER BY "Sp" ASC;
