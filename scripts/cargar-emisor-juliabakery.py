#!/usr/bin/env python3
"""
Patch para corregir el bloque "emisor" de config_fel.

Hoy quedo con la data legacy de HIDROCOM (NIT 11700574K). Las creds Infile
pertenecen a WEIRD DOUGH (NIT 120302411) -> mismatch al firmar.

Sobreescribe nit_emisor, razon_social, nombre_comercial, direccion, etc.
Las creds infile_* y URLs no se tocan (ya quedaron bien del script anterior).
"""

import json
import getpass
from urllib import request, error

PROD_BASE = "https://julia-bakery.vercel.app"

# Datos del emisor real Julia Bakery (los conocemos del recibo BAC + xlsx Infile).
# Frase SAT: WEIRD DOUGH esta bajo "Frases de Retencion de ISR" -> esc=3 tipo=1
# (texto "Sujeto a pago directo ISR (5111420251235387 - 01/04/2025)").
# Despues del fix en lib/infile/client.js, si infile_frases_extras tiene
# entradas SE USA EXCLUSIVAMENTE esas (override del default esc=1 tipo=1).
PATCH = {
    "nit_emisor": "120302411",
    "razon_social": "WEIRD DOUGH, SOCIEDAD ANONIMA",
    "nombre_comercial": "JULIA BAKERY",
    "direccion": "2 AVENIDA 11-08 APTO. C ZONA 10",
    "codigo_postal": "01010",
    "municipio": "GUATEMALA",
    "departamento": "GUATEMALA",
    "pais": "GT",
    "afiliacion_iva": "GEN",
    "codigo_establecimiento": 1,
    "infile_frases_extras": [{
        "escenario": 3,
        "tipo": 1,
        "numeroResolucion": "5111420251235387",
        "fechaResolucion": "2025-04-01",
    }],
}

print("== Pegá tu access_token Supabase (input silencioso) ==")
token = getpass.getpass("Token: ").strip()
if not token.startswith("eyJ"):
    print("FAIL: no parece JWT")
    raise SystemExit(1)
print(f"  token len={len(token)}")

print("\n== PUT /api/fel/config con datos Julia Bakery ==")
data = json.dumps(PATCH).encode("utf-8")
req = request.Request(
    f"{PROD_BASE}/api/fel/config",
    method="PUT",
    headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    },
    data=data,
)
try:
    with request.urlopen(req, timeout=30) as r:
        body = json.loads(r.read())
except error.HTTPError as e:
    print(f"FAIL PUT: HTTP {e.code}: {e.read().decode()[:300]}")
    raise SystemExit(2)
if not body.get("ok"):
    print(f"FAIL PUT: {body}")
    raise SystemExit(2)
print("  PUT OK")
cfg = body.get("config", {})
print(f"  nit_emisor: {cfg.get('nit_emisor')}")
print(f"  nombre_comercial: {cfg.get('nombre_comercial')}")
print(f"  razon_social: {cfg.get('razon_social')}")
print(f"  infile_ambiente: {cfg.get('infile_ambiente')}")

print("\n== GET /api/fel/health-check ==")
req = request.Request(f"{PROD_BASE}/api/fel/health-check", headers={
    "Authorization": f"Bearer {token}",
})
try:
    with request.urlopen(req, timeout=60) as r:
        hc = json.loads(r.read())
except error.HTTPError as e:
    print(f"  health-check HTTP {e.code}")
    hc = json.loads(e.read())
print(json.dumps(
    {k: v for k, v in hc.items() if not isinstance(v, str) or len(v) < 200},
    indent=2, ensure_ascii=False,
))

if hc.get("ok") is True:
    print("\n✓ FEL produccion lista. Las facturas que /pos emita van a Infile real.")
else:
    print("\n✗ Algo sigue fallando. Mira el body arriba.")
