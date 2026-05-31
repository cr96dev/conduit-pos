#!/usr/bin/env bash
# scripts/test-cobrar-tarjeta.sh
# Prueba end-to-end de /api/pos/cobrar-tarjeta SIN tocar el Sunmi POS.
#
# IMPORTANTE: este script ACTIVA LA P5L fisica. Apenas se ejecuta:
#   - El pinpad de la cajera se enciende y pide tarjeta
#   - Si nadie pasa tarjeta en ~90s, Neonet timeout y devuelve error
#   - Si se pasa tarjeta + PIN, se ejecuta un cargo REAL de Q1.00
#
# Avisale al cajero antes de correrlo, o teneit la P5L en mano.
#
# Pre-requisito: tener un access_token Supabase de un usuario admin/cajero
# en el clipboard (ver instrucciones en chat).
#
# Uso:
#   bash scripts/test-cobrar-tarjeta.sh [amount_cents]
#   Default amount: 100 (Q1.00)

set -uo pipefail

AMOUNT="${1:-100}"
IDSALE="TEST_$(date +%s)_$(openssl rand -hex 4)"
PROD_URL="https://julia-bakery.vercel.app"

TOKEN="$(pbpaste)"
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: clipboard vacio. Copia tu access_token Supabase y reintenta."
  exit 1
fi
TOKEN_LEN=${#TOKEN}
TOKEN_HEAD="${TOKEN:0:4}"
if [[ $TOKEN_LEN -lt 100 ]]; then
  echo "ERROR: clipboard tiene solo $TOKEN_LEN chars - no parece un JWT (esperado ~700+)."
  echo "         Re-copia el access_token completo."
  exit 1
fi
if [[ "$TOKEN_HEAD" != "eyJh" ]]; then
  echo "ERROR: clipboard no empieza con 'eyJh' (los JWTs SIEMPRE empiezan asi)."
  echo "         Lo que tienes: '$TOKEN_HEAD...'"
  exit 1
fi

# Introspeccion del JWT - solo metadata publica del payload
NOW=$(date +%s)
INTROSPECCION=$(python3 - <<PYEOF 2>/dev/null
import sys, json, base64
t = """$TOKEN"""
try:
    payload_b64 = t.split('.')[1]
    payload_b64 += '=' * (-len(payload_b64) % 4)
    payload = json.loads(base64.urlsafe_b64decode(payload_b64))
    out = {
        'iss': payload.get('iss',''),
        'sub_short': str(payload.get('sub',''))[:8] + '...',
        'email': payload.get('email',''),
        'role': payload.get('role',''),
        'aud': payload.get('aud',''),
        'iat': payload.get('iat',0),
        'exp': payload.get('exp',0),
        'exp_in_seconds': payload.get('exp',0) - $NOW,
        'is_anonymous': payload.get('is_anonymous'),
    }
    print(json.dumps(out, indent=2))
except Exception as e:
    print(f"NO_PARSE: {e}")
PYEOF
)

echo "== JWT introspeccion (solo metadata publica) =="
echo "$INTROSPECCION"
echo

# Validar exp
EXP_LEFT=$(echo "$INTROSPECCION" | grep '"exp_in_seconds"' | sed -E 's/.*: *(-?[0-9]+).*/\1/')
if [[ -n "$EXP_LEFT" && "$EXP_LEFT" -lt 0 ]]; then
  echo "ABORT: token expiro hace ${EXP_LEFT}s. Re-loguea y volve a copiar."
  exit 1
fi

echo "== Cobrar tarjeta TEST =="
echo "  idsale:       $IDSALE"
echo "  amount_cents: $AMOUNT"
echo "  prod URL:     $PROD_URL"
echo "  token len:    $TOKEN_LEN  head=$TOKEN_HEAD  exp_in=${EXP_LEFT}s"
echo
read -rp "Confirmar disparo (la P5L se va a activar). [y/N]: " ok
[[ "$ok" =~ ^[Yy]$ ]] || { echo "abortado"; exit 0; }

echo
echo "== Llamando /api/pos/cobrar-tarjeta =="
START=$(date +%s)

HTTP=$(curl -s -o /tmp/.cobro.json -w "%{http_code}" \
  -X POST "$PROD_URL/api/pos/cobrar-tarjeta" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --max-time 120 \
  -d "{\"idsale\":\"$IDSALE\",\"amount_cents\":$AMOUNT}")

ELAPSED=$(( $(date +%s) - START ))

echo "HTTP: $HTTP   (tardo ${ELAPSED}s)"
echo "Body:"
python3 -c "
import json, sys
try:
    d = json.load(open('/tmp/.cobro.json'))
    # voucher puede ser muy largo, lo recortamos
    rl = d.get('respuesta_lector', {})
    if rl.get('voucher_code'):
        rl['voucher_code'] = rl['voucher_code'][:80] + '...[truncated]'
    print(json.dumps(d, indent=2, ensure_ascii=False))
except Exception:
    print(open('/tmp/.cobro.json').read())
"

unset TOKEN
rm -f /tmp/.cobro.json

echo
case "$HTTP" in
  200)
    echo ">> HTTP 200 - mira 'ok' y 'response_code' en el body:"
    echo "   - ok=true  + response_code=00 -> COBRO APROBADO (hay un cargo real)"
    echo "   - ok=false                    -> rechazado (declined/cancelled/timeout)"
    echo
    echo "   Si fue aprobado y queres revertir: void/refund desde el P5L o usa"
    echo "   /api/neonet/settlement para devolver el cargo (idsale: $IDSALE)."
    ;;
  401|403)
    echo ">> $HTTP: access_token invalido, expirado, o el perfil no es admin/cajero."
    ;;
  502)
    echo ">> 502: Neonet auth fallo (etapa: auth). Probablemente creds revocadas."
    ;;
  *)
    echo ">> codigo inesperado. Mira el body arriba y los logs de Vercel."
    ;;
esac
