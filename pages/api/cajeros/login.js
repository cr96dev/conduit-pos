// pages/api/cajeros/login.js
// POST /api/cajeros/login  body: { pin: '1234' }
//
// Valida PIN contra cajeros activos (PBKDF2-SHA256), maneja lockout por IP
// (5 fallos = 1 min), y devuelve tokens de sesion Supabase para que el cliente
// los aplique con supabase.auth.setSession().
//
// Flujo de sesion:
//   1. Server identifica al cajero por PIN.
//   2. Server rota el password del usuario auth (random fresco) via service_role.
//   3. Server hace signInWithPassword con un cliente "anon" usando ese password
//      efimero, obtiene access_token + refresh_token.
//   4. Server devuelve los tokens al cliente. El password rotado queda inutil
//      hasta el proximo login (donde se rota de nuevo). Nunca se almacena.

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { verificarPin } from '../../../lib/cajeros/pin'
import {
  ipDesdeRequest,
  chequearLockout,
  registrarIntentoFallido,
  resetearIntentos,
} from '../../../lib/cajeros/lockout'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function anonClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { pin } = req.body || {}
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) {
    return res.status(400).json({ error: 'PIN invalido (4 digitos requeridos)' })
  }

  const admin = adminClient()
  const ip = ipDesdeRequest(req)

  // 1. Chequear lockout
  const lock = await chequearLockout(admin, ip)
  if (lock.bloqueado) {
    return res.status(429).json({
      error: 'Demasiados intentos fallidos. Esperá un momento.',
      bloqueado: true,
      segundos_restantes: lock.segundos_restantes,
    })
  }

  // 2. Buscar cajero por PIN
  const { data: cajeros, error: qErr } = await admin
    .from('perfiles')
    .select('id, email, nombre_completo, rol, activo, pin_hash, pin_salt, es_kiosko')
    .eq('rol', 'cajero')
    .eq('activo', true)
    .not('pin_hash', 'is', null)

  if (qErr) {
    console.error('[cajeros/login] query error:', qErr.message)
    return res.status(500).json({ error: 'Error consultando cajeros' })
  }

  let cajero = null
  for (const c of cajeros || []) {
    if (verificarPin(pin, c.pin_hash, c.pin_salt)) {
      cajero = c
      break
    }
  }

  if (!cajero) {
    const r = await registrarIntentoFallido(admin, ip)
    if (r.bloqueado) {
      return res.status(429).json({
        error: 'Demasiados intentos fallidos. Esperá un momento.',
        bloqueado: true,
        segundos_restantes: r.segundos_restantes,
      })
    }
    return res.status(401).json({
      error: 'PIN incorrecto',
      intentos_restantes: Math.max(0, 5 - r.intentos),
    })
  }

  // 3. PIN OK -> reset lockout
  await resetearIntentos(admin, ip)
  await admin
    .from('perfiles')
    .update({ pin_intentos_fallidos: 0 })
    .eq('id', cajero.id)

  // 4. Rotar password efimero del usuario auth
  const passwordEfimero = crypto.randomBytes(24).toString('hex')
  const { error: updErr } = await admin.auth.admin.updateUserById(cajero.id, {
    password: passwordEfimero,
  })
  if (updErr) {
    console.error('[cajeros/login] updateUserById error:', updErr.message)
    return res.status(500).json({ error: 'Error generando sesion (1)' })
  }

  // 5. Sign in server-side con el password efimero para obtener tokens
  const pub = anonClient()
  const { data: sesion, error: signErr } = await pub.auth.signInWithPassword({
    email: cajero.email,
    password: passwordEfimero,
  })
  if (signErr || !sesion?.session) {
    console.error('[cajeros/login] signInWithPassword error:', signErr?.message)
    return res.status(500).json({ error: 'Error generando sesion (2)' })
  }

  return res.status(200).json({
    ok: true,
    cajero: {
      id: cajero.id,
      nombre_completo: cajero.nombre_completo,
      rol: cajero.rol,
      es_kiosko: !!cajero.es_kiosko,
    },
    session: {
      access_token: sesion.session.access_token,
      refresh_token: sesion.session.refresh_token,
    },
  })
}
