#!/usr/bin/env bash
# scripts/test-neonet-auth.sh
# Prueba que las credenciales NEONET_MEMBERSHIP_ID y NEONET_SECRET_KEY
# cargadas en Vercel production funcionan contra VNGAuthenticator.
#
# NO toca la terminal P5L, NO cobra, NO genera ruido para el cajero.
# Solo dispara el handshake JWT del endpoint /api/neonet/auth?force=1.
#
# Necesitas INTERNAL_API_SECRET (lo tenes en 1Password o lo podes copiar
# desde Vercel dashboard -> Settings -> Environment Variables -> el ojo
# de INTERNAL_API_SECRET).
#
# Uso:
#   bash scripts/test-neonet-auth.sh

set -uo pipefail

PROD_URL="https://julia-bakery.vercel.app"

printf "Pega INTERNAL_API_SECRET (no se muestra): "
IFS= read -rs SECRET
echo
if [[ -z "$SECRET" ]]; then
  echo "vacio - aborto"
  exit 1
fi

echo
echo "== Llamando /api/neonet/auth?force=1 =="
HTTP=$(curl -s -o /tmp/.neonet_test.json -w "%{http_code}" \
  -X GET "$PROD_URL/api/neonet/auth?force=1" \
  -H "Authorization: Bearer $SECRET")

unset SECRET

echo "HTTP: $HTTP"
echo "Body:"
# Solo mostramos campos NO sensibles. Filtramos cualquier campo que parezca token.
python3 -c "
import json, sys
try:
    d = json.load(open('/tmp/.neonet_test.json'))
    safe = {k: v for k, v in d.items() if k.lower() not in ('token','jwt','accesstoken','tokenpreview')}
    if 'tokenPreview' in d:
        safe['tokenPreview'] = '<' + str(len(str(d['tokenPreview']))) + ' chars>'
    print(json.dumps(safe, indent=2))
except Exception as e:
    print(open('/tmp/.neonet_test.json').read())
"

rm -f /tmp/.neonet_test.json

echo
case "$HTTP" in
  200)
    echo ">> AUTH OK. MEMBERSHIP_ID + SECRET_KEY estan bien."
    echo "   Las otras 3 credenciales (MERCHANT_USER/PASSWD/CARD_ACQ_ID)"
    echo "   solo se validan en una venta real - hacela cuando baje el trafico."
    ;;
  401)
    echo ">> 401: INTERNAL_API_SECRET equivocado. Volve a pegar el correcto."
    ;;
  502)
    echo ">> 502: VNGAuthenticator rechazo. MEMBERSHIP_ID o SECRET_KEY estan"
    echo "   mal o revocadas. Hay que pedirle nuevas a Angel/Neonet."
    ;;
  *)
    echo ">> codigo inesperado. Mira el body arriba y los logs de Vercel."
    ;;
esac
