#!/usr/bin/env node
// scripts/crear-cajeros.js
//
// Crea los dos cajeros iniciales (Alexander Caal, Dalia Mishel) con un PIN
// aleatorio de 4 digitos cada uno. Imprime los PINs en stdout para que el
// admin se los pase al cajero (Charles).
//
// Idempotente: si el usuario ya existe (mismo email), solo resetea el PIN.
//
// Requiere env vars:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Uso (local):
//   vercel env pull .env.local
//   node -r dotenv/config scripts/crear-cajeros.js dotenv_config_path=.env.local
// O directamente con env inline:
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/crear-cajeros.js

const { createClient } = require('@supabase/supabase-js')
const path = require('path')

// Cargar .env.local si existe (sin requerir paquete dotenv extra: parser minimo)
function cargarEnvLocal() {
  try {
    const fs = require('fs')
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
  } catch (_) {}
}
cargarEnvLocal()

// Replicar la logica de lib/cajeros/pin.js (CommonJS).
const crypto = require('crypto')
function hashearPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(String(pin), salt, 100000, 32, 'sha256').toString('hex')
  return { hash, salt }
}
function generarPinAleatorio() {
  const obvios = new Set([
    '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
    '1234','4321','1212','2121','1010','0101','1313','9876',
  ])
  while (true) {
    const buf = crypto.randomBytes(2)
    const n = (buf[0] * 256 + buf[1]) % 10000
    const pin = String(n).padStart(4, '0')
    if (obvios.has(pin)) continue
    if (/^(\d)\1{3}$/.test(pin)) continue
    return pin
  }
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const CAJEROS = [
  { nombre_completo: 'Alexander Caal',  email: 'alexander.caal@cajeros.juliabakery.gt' },
  { nombre_completo: 'Dalia Mishel',    email: 'dalia.mishel@cajeros.juliabakery.gt' },
]

async function main() {
  const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const resultados = []

  for (const c of CAJEROS) {
    const pin = generarPinAleatorio()
    const { hash, salt } = hashearPin(pin)

    // Buscar perfil por email
    const { data: existente } = await admin
      .from('perfiles')
      .select('id, rol')
      .eq('email', c.email.toLowerCase())
      .maybeSingle()

    let userId
    let accion

    if (existente) {
      userId = existente.id
      accion = 'reset_pin'
      // Si no era cajero, lo promovemos.
      const { error: updErr } = await admin
        .from('perfiles')
        .update({
          nombre_completo: c.nombre_completo,
          rol: 'cajero',
          activo: true,
          pin_hash: hash,
          pin_salt: salt,
          pin_updated_at: new Date().toISOString(),
          pin_intentos_fallidos: 0,
          pin_bloqueado_hasta: null,
        })
        .eq('id', userId)
      if (updErr) {
        console.error(`[${c.email}] error actualizando perfil:`, updErr.message)
        process.exit(2)
      }
    } else {
      // Crear usuario auth
      const passwordInicial = crypto.randomBytes(24).toString('hex')
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: c.email.toLowerCase(),
        password: passwordInicial,
        email_confirm: true,
      })
      if (createErr) {
        console.error(`[${c.email}] error creando usuario auth:`, createErr.message)
        process.exit(3)
      }
      userId = created.user.id

      // Insertar perfil
      const { error: pErr } = await admin.from('perfiles').insert({
        id: userId,
        email: c.email.toLowerCase(),
        nombre_completo: c.nombre_completo,
        rol: 'cajero',
        activo: true,
        pin_hash: hash,
        pin_salt: salt,
        pin_updated_at: new Date().toISOString(),
      })
      if (pErr) {
        console.error(`[${c.email}] error creando perfil:`, pErr.message)
        // Cleanup
        await admin.auth.admin.deleteUser(userId)
        process.exit(4)
      }
      accion = 'creado'
    }

    resultados.push({ nombre: c.nombre_completo, email: c.email, userId, pin, accion })
  }

  // Reporte (este output es lo que se le pasa a Charles)
  console.log('\n=== CAJEROS LISTOS ===\n')
  for (const r of resultados) {
    console.log(`  ${r.nombre.padEnd(20)}  PIN: ${r.pin}  (${r.accion})`)
    console.log(`    email interno: ${r.email}`)
    console.log(`    user_id:       ${r.userId}`)
    console.log('')
  }
  console.log('Anotar los PINs y pasarlos al cajero correspondiente. NO quedan en BD.')
}

main().catch(e => {
  console.error('Error fatal:', e?.message || e)
  process.exit(99)
})
