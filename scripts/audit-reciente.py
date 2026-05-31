#!/usr/bin/env python3
"""
Audit rapido: que se ha tocado en el sistema en las ultimas N horas.

Consulta varios endpoints admin y arma un timeline con:
  - Quien modifico config_fel (toggle / creds / emisor)
  - Que turnos abrieron y cerraron
  - Que facturas se crearon, certificaron o anularon
  - Que reimpresiones se hicieron y por quien
  - Que acciones via soporte AI se confirmaron / rechazaron

Uso:
  1. En el navegador (DevTools console):
       (() => {
         const k = Object.keys(localStorage).find(x => x.startsWith('sb-') && x.endsWith('-auth-token'));
         const v = JSON.parse(localStorage.getItem(k));
         copy(v.access_token);
         return 'OK';
       })();
  2. En terminal:
       python3 scripts/audit-reciente.py 24    # ultimas 24h (default)
       python3 scripts/audit-reciente.py 6     # ultimas 6h
"""

import sys
import json
import getpass
import datetime
from urllib import request, error

PROD = 'https://julia-bakery.vercel.app'
HORAS = int(sys.argv[1]) if len(sys.argv) > 1 else 24

print(f'== Audit ultimas {HORAS}h ==\n')
print('Pega tu access_token Supabase (input silencioso):')
token = getpass.getpass('Token: ').strip()
if not token.startswith('eyJ'):
    print('FAIL: no parece JWT')
    sys.exit(1)
print(f'  token len={len(token)}\n')

desde = (datetime.datetime.utcnow() - datetime.timedelta(hours=HORAS)).isoformat()


def get(path):
    req = request.Request(f'{PROD}{path}', headers={'Authorization': f'Bearer {token}'})
    try:
        with request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except error.HTTPError as e:
        return {'_http_error': e.code, '_body': e.read().decode()[:200]}
    except Exception as e:
        return {'_error': str(e)}


eventos = []  # (ts, tipo, descripcion)

# ---- 1. Config FEL ----
print('-- 1) Config FEL --')
cfg = get('/api/fel/config')
if cfg.get('ok'):
    c = cfg.get('config', {})
    upd_at = c.get('updated_at')
    upd_by = c.get('updated_by')
    print(f'  Ultima modificacion: {upd_at} por usuario {upd_by}')
    print(f'  Ambiente: {c.get("infile_ambiente")}  NIT: {c.get("nit_emisor")}  Nombre: {c.get("nombre_comercial")}')
    if upd_at and upd_at > desde:
        eventos.append((upd_at, 'CONFIG_FEL', f'modificada por {upd_by}'))
else:
    print(f'  ERROR: {cfg}')
print()

# ---- 2. Facturas recientes ----
print(f'-- 2) Facturas emitidas en ultimas {HORAS}h --')
fac = get(f'/api/fel/facturas?desde={desde[:10]}&limit=50')
if fac.get('ok'):
    facs = fac.get('facturas', [])
    print(f'  {len(facs)} facturas encontradas')
    for f in facs[:15]:
        when = f.get('fecha_emision', '')
        if when and when > desde:
            ref = f"{f.get('serie_sat','')}-{f.get('numero_sat','')}" if f.get('numero_sat') else f.get('id','')[:8]
            est = f.get('estado', '')
            who = f.get('creado_por', '?')[:8]
            tot = f.get('total', 0)
            print(f'  [{when[:19]}] {est:11s}  Q{tot:>8.2f}  ref={ref:20s}  por={who}')
            eventos.append((when, f'FACTURA_{est.upper()}', f'Q{tot:.2f} ref={ref} por={who}'))
else:
    print(f'  ERROR: {fac}')
print()

# ---- 3. Cajeros activos / Turnos ----
print(f'-- 3) Turnos del propio (los del usuario actual) --')
mts = get('/api/turnos/mis-turnos')
if mts.get('ok'):
    turnos = mts.get('turnos', [])
    for t in turnos[:10]:
        ap = t.get('fecha_apertura','')
        if ap > desde:
            cierre = t.get('fecha_cierre') or '(abierto)'
            print(f'  [{ap[:19]}] apertura Q{t.get("monto_apertura",0):.2f} -> cierre {cierre[:19] if cierre != "(abierto)" else cierre}')
            eventos.append((ap, 'TURNO_APERTURA', f'Q{t.get("monto_apertura",0):.2f}'))
            if cierre != '(abierto)':
                eventos.append((cierre, 'TURNO_CIERRE', f'diferencia Q{t.get("diferencia") or 0}'))
else:
    print(f'  ERROR: {mts}')
print()

# ---- 4. Reimpresiones via soporte (audit) ----
print('-- 4) Soporte AI: tool calls recientes (write) --')
# Solo admin puede ver todo; cajero ve solo lo suyo
# No tenemos endpoint directo, intentamos via SUPABASE REST a la tabla
# Pero requiere el ANON key + RLS — se hace via /api/. Por ahora skipeado.
print('  (Si tenes acceso de admin, mira soporte_tool_calls en SQL editor de Supabase)')
print()

# ---- 5. Timeline ordenado ----
print('=== TIMELINE (ultimos eventos detectados) ===')
eventos.sort(reverse=True)
for ts, tipo, desc in eventos[:30]:
    print(f'  {ts[:19]}  {tipo:18s}  {desc}')

print(f'\n== Total {len(eventos)} eventos en ultimas {HORAS}h ==')
