#!/usr/bin/env python3
"""
scripts/cargar-infile-prod.py

Lee el xlsx con las credenciales Infile producción que mandaron a Julia
Bakery, las extrae, y las escribe a config_fel via PUT /api/fel/config
(con el access_token Supabase admin que vos pegues al clipboard).

Nunca imprime los valores de las credenciales. Solo reporta lengths +
confirmacion + resultado del health-check final.

Uso:
  1) En el browser (DevTools console) copiar el access_token:
       (() => {
         const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'));
         const v = JSON.parse(localStorage.getItem(k));
         copy(v.access_token);
         return `OK len=${v.access_token.length}`;
       })();
  2) En la terminal:
       python3 scripts/cargar-infile-prod.py
"""

import os
import re
import sys
import json
import subprocess
from urllib import request, error

XLSX_PATH = "/Users/cjrh/Downloads/120302411 WEIRD DOUGH, SOCIEDAD ANÓNIMA.xlsx"
PROD_BASE = "https://julia-bakery.vercel.app"

# ---------- 0. Sanity: openpyxl + access_token disponibles ----------

try:
    import openpyxl
except ImportError:
    print("FAIL: openpyxl no instalado. Run: pip3 install openpyxl")
    sys.exit(1)

if not os.path.isfile(XLSX_PATH):
    print(f"FAIL: no encuentro {XLSX_PATH}")
    sys.exit(1)

print("== Pegá tu access_token Supabase (input silencioso) ==")
import getpass
token = getpass.getpass("Token: ").strip()
if not token or not token.startswith("eyJ"):
    print("FAIL: no parece un JWT (debe empezar con eyJ)")
    sys.exit(1)
print(f"  token len={len(token)}")

# ---------- 1. Leer xlsx + mapear celdas ----------

wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
# Recolectar TODAS las (label, value) pairs detectables
celdas = []
for ws in wb.worksheets:
    rows = list(ws.iter_rows(values_only=True))
    for ri, row in enumerate(rows):
        for ci, cell in enumerate(row):
            if cell is None: continue
            v = str(cell).strip()
            if not v: continue
            # Label = la columna a la izquierda o la fila de arriba
            label = ""
            if ci > 0 and ci - 1 < len(row) and row[ci-1] not in (None, ""):
                label = str(row[ci-1]).strip().lower()
            elif ri > 0 and ci < len(rows[ri-1]) and rows[ri-1][ci] not in (None, ""):
                label = str(rows[ri-1][ci]).strip().lower()
            celdas.append((ws.title, label, v))

# Heuristica de mapping. En el xlsx que Infile manda a comercios GT:
#   - "Codigo" o "Código emisor" -> alias_firma (el codigo del comercio)
#   - "Llave firma" -> llave_firma (firma el XML)
#   - "Llave API" -> llave_cert (auth al certificador SAT)
#   - usuario_cert: tipicamente NO viene como columna separada,
#     se reusa el mismo codigo emisor que alias_firma (default Infile)
MAPPING = {
    "infile_alias_firma": [
        r"^codigo$", r"^código$", r"^codigo emisor$", r"^código emisor$",
        r"alias", r"emisor.code", r"codigo.*emisor",
        r"usuario.*firma", r"user.*firma", r"id.*firma",
    ],
    "infile_llave_firma": [
        r"llave.*firma", r"clave.*firma", r"key.*firma", r"firma.*token",
        r"^llave$", r"^clave$",
    ],
    "infile_usuario_cert": [
        r"usuario.*cert", r"user.*cert", r"usuario.*sat", r"user.*sat",
        r"usuario.*api", r"user.*api",
    ],
    "infile_llave_cert": [
        r"llave.*cert", r"clave.*cert", r"key.*cert", r"token.*cert", r"cert.*key",
        r"llave.*api", r"clave.*api", r"^llave api$", r"api.*key",
    ],
}

def matches_any(s: str, patterns: list[str]) -> bool:
    for p in patterns:
        if re.search(p, s, re.IGNORECASE):
            return True
    return False

extracted = {}  # campo -> valor
unmatched = []
for sheet, label, value in celdas:
    matched = False
    for campo, patterns in MAPPING.items():
        if matches_any(label, patterns):
            if campo not in extracted:
                extracted[campo] = value
                matched = True
                break
    if not matched and len(value) > 10 and " " not in value:
        # candidato a credencial no mapeada
        unmatched.append((sheet, label, len(value)))

print("\n== Mapeo de campos detectado ==")
for campo in ["infile_alias_firma", "infile_llave_firma", "infile_usuario_cert", "infile_llave_cert"]:
    v = extracted.get(campo)
    if v:
        print(f"  {campo}: len={len(v)} OK")
    else:
        print(f"  {campo}: NO ENCONTRADO en xlsx")

if unmatched:
    print("\n== Celdas largas sin mapeo (revisar manualmente si falta algo) ==")
    for sheet, label, l in unmatched[:6]:
        print(f"  [{sheet}] label='{label}' len={l}")

faltantes = [k for k in MAPPING if k not in extracted]
if faltantes:
    print(f"\n== Pedir los {len(faltantes)} campos faltantes (input silencioso) ==")
    for k in faltantes:
        v = getpass.getpass(f"  {k}: ").strip()
        if not v:
            print(f"FAIL: {k} vacio, aborto")
            sys.exit(2)
        extracted[k] = v
        print(f"  -> len={len(v)} OK")

# ---------- 2. GET config actual (para preservar nit_emisor + nombre_comercial) ----------

print("\n== GET /api/fel/config (para preservar campos requeridos) ==")
req = request.Request(f"{PROD_BASE}/api/fel/config", headers={
    "Authorization": f"Bearer {token}",
})
try:
    with request.urlopen(req, timeout=30) as r:
        body = json.loads(r.read())
except error.HTTPError as e:
    print(f"FAIL GET: HTTP {e.code}: {e.read().decode()[:200]}")
    sys.exit(3)
if not body.get("ok"):
    print(f"FAIL GET: {body}")
    sys.exit(3)

actual = body.get("config") or {}
print(f"  nit_emisor: {actual.get('nit_emisor', '(vacio)')}")
print(f"  nombre_comercial: {actual.get('nombre_comercial', '(vacio)')}")
print(f"  infile_ambiente actual: {actual.get('infile_ambiente', '(vacio)')}")

# ---------- 3. PUT con creds nuevas + ambiente=prod ----------

patch = dict(extracted)
patch["infile_ambiente"] = "prod"
# Asegurar requeridos
patch["nit_emisor"] = actual.get("nit_emisor") or "120302411"
patch["nombre_comercial"] = actual.get("nombre_comercial") or "JULIA BAKERY"

print("\n== PUT /api/fel/config (UPDATE) ==")
data = json.dumps(patch).encode("utf-8")
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
    sys.exit(4)
if not body.get("ok"):
    print(f"FAIL PUT: {body}")
    sys.exit(4)
print("  PUT OK")

# ---------- 4. Health check ----------

print("\n== GET /api/fel/health-check ==")
req = request.Request(f"{PROD_BASE}/api/fel/health-check", headers={
    "Authorization": f"Bearer {token}",
})
try:
    with request.urlopen(req, timeout=60) as r:
        hc = json.loads(r.read())
except error.HTTPError as e:
    print(f"  health-check error: HTTP {e.code}")
    hc = json.loads(e.read())
# Mostrar todo el body MENOS campos que parecen secrets
print(json.dumps(
    {k: v for k, v in hc.items()
     if not isinstance(v, str) or len(v) < 100},
    indent=2,
    ensure_ascii=False,
))

print("\n== Listo. Si health-check.ok=true, FEL produccion esta lista. ==")
