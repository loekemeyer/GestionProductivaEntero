#!/bin/bash
INPUT="s:/AA IT/Gestion Productiva/proveedores_data.csv"
OUTDIR="s:/AA IT/Gestion Productiva/sql_batches"
BATCH=100
COUNT=0
FILENUM=1
HEADER=""

escape_sql() {
  echo "$1" | sed "s/'/''/g"
}

val_or_null() {
  local v="$1"
  if [ -z "$v" ]; then
    echo "NULL"
  else
    echo "'$(escape_sql "$v")'"
  fi
}

while IFS=';' read -r codigo rsb rs civa letra cuit estado calif calle numero piso depto barrio localidad cp codprov provincia codpais pais tel1 tel2 tel3 fax email web codniv1 descniv1 codniv2 descniv2 codniv3 descniv3 codniv4 descniv4 codcpago condpago rest; do
  # Skip header
  if [ "$HEADER" = "" ]; then
    HEADER=1
    continue
  fi

  if [ $((COUNT % BATCH)) -eq 0 ]; then
    if [ $COUNT -gt 0 ]; then
      echo ";" >> "$OUTDIR/batch_${FILENUM}.sql"
      FILENUM=$((FILENUM + 1))
    fi
    echo "INSERT INTO public.\"Proveedores\" (codigo, razon_social_busqueda, razon_social, condicion_iva, letra, cuit, estado, calle, numero, localidad, codigo_postal, provincia, telefono, email, condicion_pago) VALUES" > "$OUTDIR/batch_${FILENUM}.sql"
  fi

  if [ $((COUNT % BATCH)) -gt 0 ]; then
    echo "," >> "$OUTDIR/batch_${FILENUM}.sql"
  fi

  printf "(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)" \
    "$(val_or_null "$codigo")" \
    "$(val_or_null "$rsb")" \
    "$(val_or_null "$rs")" \
    "$(val_or_null "$civa")" \
    "$(val_or_null "$letra")" \
    "$(val_or_null "$cuit")" \
    "$(val_or_null "$estado")" \
    "$(val_or_null "$calle")" \
    "$(val_or_null "$numero")" \
    "$(val_or_null "$localidad")" \
    "$(val_or_null "$cp")" \
    "$(val_or_null "$provincia")" \
    "$(val_or_null "$tel1")" \
    "$(val_or_null "$email")" \
    "$(val_or_null "$condpago")" >> "$OUTDIR/batch_${FILENUM}.sql"

  COUNT=$((COUNT + 1))
done < "$INPUT"

# Close last batch
if [ $((COUNT % BATCH)) -ne 0 ] || [ $COUNT -eq $((FILENUM * BATCH)) ]; then
  echo ";" >> "$OUTDIR/batch_${FILENUM}.sql"
fi

echo "Total rows: $COUNT, Files: $FILENUM"
