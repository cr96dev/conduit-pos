#!/usr/bin/env bash
# scripts/cargar-neonet.sh
# Carga las 5 credenciales Neonet a Vercel production usando el flag --value
# (no interactivo). Las pide con read -s para que no se vean en pantalla
# ni queden en el historial del shell.
#
# Uso:
#   bash scripts/cargar-neonet.sh
#
# Origen de las credenciales: chat WhatsApp con Angel/Neonet.
# Pares correctos: membershipId + secretKey emparejados (ultimo par),
# merchantUser + merchantPasswd emparejados (ultimo par, 64 chars cada uno).

set -euo pipefail

VARS=(
  NEONET_MEMBERSHIP_ID
  NEONET_SECRET_KEY
  NEONET_MERCHANT_USER
  NEONET_MERCHANT_PASSWD
  NEONET_CARD_ACQ_ID
)

cd "$(dirname "$0")/../../../.."   # raiz juliabakery_

echo "== Carga credenciales Neonet a Vercel production =="
echo "Cada valor se pide con input silencioso. No se imprime nada."
echo

for name in "${VARS[@]}"; do
  # quitar version vieja vacia si existe (ignora error si no existe)
  vercel env rm "$name" production -y >/dev/null 2>&1 || true

  printf "Valor para %s: " "$name"
  IFS= read -rs value
  echo

  if [[ -z "$value" ]]; then
    echo "  ! vacio, saltado"
    continue
  fi

  # Carga con --value (no via stdin). Esto es lo que evita el bug de
  # subprocess donde el pipe se ignora y queda como "".
  if vercel env add "$name" production --value "$value" --sensitive -y >/dev/null 2>&1; then
    echo "  ok (${#value} chars)"
  else
    echo "  FAIL al agregar $name" >&2
    exit 1
  fi

  # limpia la variable del entorno del shell
  unset value
done

echo
echo "Hecho. Verificando longitudes..."
TMP="$(mktemp)"
vercel env pull "$TMP" --environment=production >/dev/null 2>&1

for name in "${VARS[@]}"; do
  len=$(grep -E "^${name}=" "$TMP" | sed -E "s/^${name}=//;s/^\"(.*)\"$/\1/" | wc -c | tr -d ' ')
  # wc cuenta el \n => restar 1
  len=$((len - 1))
  echo "  ${name}: len=${len}"
done

rm -f "$TMP"

echo
echo "Si todas las longitudes son > 0, decile a Claude:"
echo "  'creds neonet cargadas, redeploy y health check'"
