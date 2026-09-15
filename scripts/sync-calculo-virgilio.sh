#!/usr/bin/env bash
# El motor de calculo del reporte de Virgilio vive en UN solo lugar:
#   Produccion/InformesVirgilio/calculo.js   <- la fuente, la que carga la pagina
# La Edge Function necesita el mismo archivo pero como modulo ESM, asi que su copia
# se GENERA: es la fuente + una linea de export. Nunca se edita a mano.
#
#   ./scripts/sync-calculo-virgilio.sh          regenera la copia
#   ./scripts/sync-calculo-virgilio.sh --check  falla si quedaron distintas (lo usa el CI)
#
# Motivo: el 15/09/2026 las dos copias habian divergido y la pagina contaba el legajo 0
# (Thomas TESTING) y el 600 (entrevistas) que la funcion excluia. Mismo dato, dos numeros.
set -euo pipefail
cd "$(dirname "$0")/.."
FUENTE="Produccion/InformesVirgilio/calculo.js"
DESTINO="supabase/functions/gv-reporte-diario-virgilio/calculo.js"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
cp "$FUENTE" "$TMP"
printf '\nexport { procesar, CONFIG };\n' >> "$TMP"

if [ "${1:-}" = "--check" ]; then
  if cmp -s "$TMP" "$DESTINO"; then
    echo "OK: $DESTINO esta al dia con $FUENTE"
  else
    echo "ERROR: $DESTINO no coincide con $FUENTE + el export." >&2
    echo "Alguien edito una de las dos a mano. Corre:  ./scripts/sync-calculo-virgilio.sh" >&2
    diff "$DESTINO" "$TMP" >&2 || true
    exit 1
  fi
else
  cp "$TMP" "$DESTINO"
  echo "Regenerado $DESTINO desde $FUENTE"
fi
