#!/usr/bin/env node
// scripts/test-e2e-lockout.js
// Verifica anti-brute-force: 5 PINs incorrectos seguidos = bloqueo 1 min.

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
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = createClient(URL, SVC, { auth: { autoRefreshToken: false, persistSession: false } })

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000'

async function http(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
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

async function main() {
  console.log('\nE2E lockout contra: ' + BASE + '\n')

  // Reset el tracker para empezar limpio (IP ::ffff:127.0.0.1 en localhost)
  await admin.from('cajeros_login_intentos').delete().neq('ip', '')

  for (let i = 1; i <= 4; i++) {
    const r = await http('POST', '/api/cajeros/login', { pin: '9876' })
    ok(`intento ${i} (PIN obvio, no es de nadie)`,
      r.status === 401 && !r.json.bloqueado,
      `intentos_restantes=${r.json.intentos_restantes}`)
  }
  const r5 = await http('POST', '/api/cajeros/login', { pin: '9876' })
  ok('5to intento -> debe activar bloqueo',
    r5.status === 429 && r5.json.bloqueado === true,
    `segundos_restantes=${r5.json.segundos_restantes}`)

  // 6to intento, todavia bloqueado
  const r6 = await http('POST', '/api/cajeros/login', { pin: '9876' })
  ok('6to intento -> sigue bloqueado',
    r6.status === 429 && r6.json.bloqueado === true)

  // Cleanup: reset
  await admin.from('cajeros_login_intentos').delete().neq('ip', '')
  console.log('\n[cleanup] tabla cajeros_login_intentos vaciada\n')

  if (process.exitCode) {
    console.log('\n\x1b[31mFALLOS detectados\x1b[0m')
  } else {
    console.log('\n\x1b[32mLockout OK\x1b[0m')
  }
}

main().catch(e => { console.error('Error:', e?.message); process.exit(99) })
