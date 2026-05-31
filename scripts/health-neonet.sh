#!/usr/bin/env bash
# scripts/health-neonet.sh
# Verifica end-to-end que las credenciales Neonet en Vercel funcionan:
#   1. VNGAuthenticator devuelve JWT (HTTP 200)
#   2. /api/pos/cobrar-tarjeta responde sin 401
#
# Uso:
#   bash scripts/health-neonet.sh
#
# Requiere que las env vars ya esten en production (correr cargar-neonet.sh antes).

set -uo pipefail

cd "$(dirname "$0")/../../../.."

echo "== Health check Neonet =="

TMP="$(mktemp)"
vercel env pull "$TMP" --environment=production >/dev/null 2>&1

get() { grep -E "^${1}=" "$TMP" | sed -E "s/^${1}=//;s/^\"(.*)\"$/\1/"; }

MID=$(get NEONET_MEMBERSHIP_ID)
SK=$(get NEONET_SECRET_KEY)

if [[ -z "$MID" || -z "$SK" ]]; then
  echo "FAIL: NEONET_MEMBERSHIP_ID o NEONET_SECRET_KEY vacios. Corre cargar-neonet.sh primero."
  rm -f "$TMP"
  exit 1
fi

echo "-- 1/2 VNGAuthenticator --"
AUTH_CODE=$(curl -s -o /tmp/.neonet_auth.json -w "%{http_code}" \
  -X POST "https://developer.visanet.com.gt/VNGAuthenticator/api/Membership/Authenticate" \
  -H "Content-Type: application/json" \
  -H "membershipId: $MID" \
  -H "secretKey: $SK" \
  -d '{}')
echo "  HTTP: $AUTH_CODE"
if [[ "$AUTH_CODE" != "200" ]]; then
  echo "  Body:"; sed 's/^/    /' /tmp/.neonet_auth.json; echo
  echo "FAIL: Auth no devuelve 200. Credenciales invalidas o revocadas."
  rm -f "$TMP" /tmp/.neonet_auth.json
  exit 1
fi
echo "  ok (JWT obtenido)"

echo
echo "-- 2/2 /api/pos/cobrar-tarjeta (prod) --"
# Solo verificamos que el endpoint NO devuelve 401 (no cobramos de verdad).
# Cobrar = decision del cajero. Aca solo health.
PROD_URL="https://julia-bakery.vercel.app"
EP_CODE=$(curl -s -o /tmp/.neonet_ep.json -w "%{http_code}" \
  -X POST "$PROD_URL/api/pos/cobrar-tarjeta" \
  -H "Content-Type: application/json" \
  -d '{"idsale":"HEALTHCHECK","amountCents":100}')
echo "  HTTP: $EP_CODE"
echo "  Body:"; sed 's/^/    /' /tmp/.neonet_ep.json; echo

rm -f "$TMP" /tmp/.neonet_auth.json /tmp/.neonet_ep.json

if [[ "$EP_CODE" == "200" || "$EP_CODE" == "400" || "$EP_CODE" == "402" ]]; then
  echo
  echo "OK: el backend acepta la auth. (200/400/402 = transaccion procesada o rechazada"
  echo "    a nivel logica de negocio, no de credenciales)."
else
  echo
  echo "FAIL: codigo inesperado. Revisa logs Vercel."
  exit 1
fi
