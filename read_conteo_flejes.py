# -*- coding: utf-8 -*-
"""Lee conteo flejes Cervantes 16/4 del .xls"""
import xlrd

PATH = "S:/AA  LOGISTICA/A4 Relevamiento INSUMOS Stock y OP/A1 Conteo INSUMOS y OC (Compra)/A2 Flejes/A2 Conteo FLEJES y Pedido Vigente/Conteo Gral FLEJES y Alambre 16-04-26.xls"
SHEET = "Conteo Cervantes 16-04"

wb = xlrd.open_workbook(PATH)
print("Sheets:", wb.sheet_names())
if SHEET not in wb.sheet_names():
    print(f"Sheet '{SHEET}' no encontrada")
    raise SystemExit(1)

ws = wb.sheet_by_name(SHEET)

# Headers en row 1, datos desde row 2.
# Cols: B=N°Fleje (idx 1), D=Sector (3), L=Total KG (11)
out = []
for i in range(2, ws.nrows):
    row = ws.row_values(i)
    n_fleje = row[1]
    total_kg = row[11]
    if n_fleje == "" or n_fleje is None: continue
    # Convertir N°Fleje a string (puede ser float o texto como '46B')
    if isinstance(n_fleje, float) and n_fleje == int(n_fleje):
        n_fleje_str = str(int(n_fleje))
    else:
        n_fleje_str = str(n_fleje).strip()
    try:
        kg = float(total_kg) if total_kg != "" else 0.0
    except (ValueError, TypeError):
        kg = 0.0
    out.append((n_fleje_str, kg))

print(f"Total flejes: {len(out)}")
sql = "UPDATE \"Flejes\" SET \"Stock Inicial\" = CASE \"N Fleje\"\n"
for n, kg in out:
    sql += f"  WHEN '{n}' THEN {int(round(kg))}\n"
sql += "END WHERE \"N Fleje\" IN (" + ",".join(f"'{n}'" for n, _ in out) + ");"
print(sql)

