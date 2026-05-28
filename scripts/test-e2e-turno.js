#!/usr/bin/env node
// scripts/test-e2e-turno.js
//
// Test end-to-end del flujo cajero+turno SIN tocar Infile/FEL ni Neonet:
//   1. Login PIN del cajero (Alexander Caal).
//   2. Abrir caja con Q500.
//   3. Insertar una factura simulada (origen_tipo='pos_propio',
//      metodo_pago='efectivo', total=Q100, turno_id=<turno abierto>,
//      estado='certificada') — esto SALTA el camino real /api/pos/ventas
//      para no certificar contra Infile en prueba interna.
//   4. Llamar /api/turnos/cerrar con conteo Q600.
//   5. Verificar: esperado=Q600, diferencia=Q0.
//   6. Cleanup: borrar la factura de prueba.

const crypto = require('crypto')

function cargarEnv() {
  const fs = require('fs')
  const path = require('path')
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  const txt = fs.readFileSync(envPath, 'utf8')
  for (const linea of txt.split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)
    if (m) {
      const v = m[2].replace(/^"|"$/g, '').replace(/^'|'$/g, '')
      if (!process.env[m[1]]) process.env[m[1]] = v
    }
  }
}
cargarEnv()

const { createClient } = require('@supabase/supabase-js')
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !ANON || !SVC) {
  console.error('Faltan envs Supabase')
  process.exit(1)
}

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000'
const PIN  = process.env.E2E_PIN     // PIN del cajero a usar para el test

if (!PIN) {
  console.error('Falta E2E_PIN env')
  process.exit(1)
}

async function http(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, ok: r.ok, json: j }
}

function ok(label, cond, extra) {
  const mark = cond ? '✓' : '✗'
  const color = cond ? '\x1b[32m' : '\x1b[31m'
  console.log(`${color}${mark}\x1b[0m ${label}${extra ? ' — ' + extra : ''}`)
  if (!cond) process.exitCode = 1
}

const admin = createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } })

async function main() {
  console.log(`\nE2E turnos contra: ${BASE}\n`)

  // 1. Login PIN
  const login = await http('POST', '/api/cajeros/login', { pin: PIN })
  ok('1. Login PIN exitoso', login.ok && login.json.session?.access_token,
     `cajero: ${login.json.cajero?.nombre_completo}`)
  if (!login.ok) {
    console.error(JSON.stringify(login.json, null, 2))
    process.exit(2)
  }
  const token = login.json.session.access_token
  const cajeroId = login.json.cajero.id

  // 1b. Cleanup: cerrar cualquier turno previo del cajero antes de empezar.
  await admin
    .from('turnos_caja')
    .update({ estado: 'cerrado', fecha_cierre: new Date().toISOString() })
    .eq('cajero_id', cajeroId)
    .eq('estado', 'abierto')

  // 2. Abrir caja con Q500
  const abrir = await http('POST', '/api/turnos/abrir', {
    monto_apertura: 500,
    observacion_apertura: 'E2E test',
  }, token)
  ok('2. Abrir caja Q500', abrir.ok && abrir.json.turno?.id, `turno_id: ${abrir.json.turno?.id}`)
  if (!abrir.ok) {
    console.error(JSON.stringify(abrir.json, null, 2))
    process.exit(3)
  }
  const turnoId = abrir.json.turno.id

  // 3. Insertar factura sintetica ligada al turno (saltea Infile)
  const { data: factura, error: facErr } = await admin
    .from('facturas_fel')
    .insert({
      receptor_nit: 'CF',
      receptor_nombre: 'TEST E2E',
      tipo_documento: 'FACT',
      moneda: 'GTQ',
      fecha_emision: new Date().toISOString(),
      total_gravado: 89.29,
      total_exento: 0,
      iva: 10.71,
      total: 100,
      metodo_pago: 'efectivo',
      estado: 'certificada',
      uuid_sat: 'E2E-' + crypto.randomBytes(8).toString('hex').toUpperCase(),
      origen_tipo: 'pos_propio',
      turno_id: turnoId,
      certificador: 'infile',
      fecha_certificacion: new Date().toISOString(),
      creado_por: cajeroId,
      notas: 'E2E test factura sintetica',
    })
    .select().single()
  ok('3. Factura sintetica Q100 efectivo ligada al turno', !facErr,
     facErr ? facErr.message : `id: ${factura.id}`)
  if (facErr) process.exit(4)

  // 4. Consultar turno actual y verificar desglose
  const actual = await http('GET', '/api/turnos/actual', null, token)
  ok('4. /turnos/actual ve ventas Q100 efectivo',
     actual.json.desglose?.ventas_efectivo === 100,
     `ventas_efectivo=${actual.json.desglose?.ventas_efectivo}, esperado=${actual.json.esperado}`)

  // 5. Cerrar caja con conteo Q600
  const cerrar = await http('POST', '/api/turnos/cerrar', {
    conteo_efectivo_cierre: 600,
    observacion_cierre: 'E2E test cierre',
  }, token)
  ok('5. Cerrar caja conteo Q600',
     cerrar.ok && cerrar.json.turno?.estado === 'cerrado',
     `esperado=${cerrar.json.turno?.monto_cierre_esperado}, diferencia=${cerrar.json.turno?.diferencia}`)

  const turnoCerrado = cerrar.json.turno
  ok('6. Esperado = Q600 (apertura 500 + ventas_ef 100)',
     Number(turnoCerrado?.monto_cierre_esperado) === 600)
  ok('7. Diferencia = Q0 (sin sobrante/faltante)',
     Number(turnoCerrado?.diferencia) === 0)
  ok('8. ventas_efectivo snapshot = Q100',
     Number(turnoCerrado?.ventas_efectivo) === 100)
  ok('9. cantidad_facturas = 1',
     Number(turnoCerrado?.cantidad_facturas) === 1)

  // 10. Mis turnos contiene este cierre
  const misTurnos = await http('GET', '/api/turnos/mis-turnos?limit=5', null, token)
  const visto = (misTurnos.json.turnos || []).find(t => t.id === turnoCerrado.id)
  ok('10. /mis-turnos contiene el turno cerrado', !!visto && visto.estado === 'cerrado')

  // Cleanup factura sintetica
  await admin.from('facturas_fel').delete().eq('id', factura.id)
  console.log('\n[cleanup] factura sintetica borrada\n')

  if (process.exitCode) {
    console.log('\n\x1b[31mFALLOS detectados\x1b[0m')
  } else {
    console.log('\n\x1b[32mE2E OK\x1b[0m')
  }
}

main().catch(e => {
  console.error('Error fatal:', e?.message || e)
  console.error(e?.stack)
  process.exit(99)
})
