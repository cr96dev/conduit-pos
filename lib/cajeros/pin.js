// lib/cajeros/pin.js
// Hash y verificacion de PINs de cajero.
//
// Algoritmo: PBKDF2-SHA256, 100k iteraciones, salt de 16 bytes por cajero.
// Nativo de Node `crypto`, sin dependencias extra.
//
// Formato almacenado en perfiles:
//   pin_salt: hex (32 chars = 16 bytes)
//   pin_hash: hex (64 chars = 32 bytes) — PBKDF2(pin, salt, 100000, 32, 'sha256')
//
// Uso:
//   import { hashearPin, verificarPin, generarPinAleatorio } from '.../pin'
//   const { hash, salt } = hashearPin('1234')
//   const ok = verificarPin('1234', hash, salt)

import crypto from 'crypto'

const ITERACIONES = 100000
const KEYLEN = 32
const DIGEST = 'sha256'
const SALT_BYTES = 16

function normalizar(pin) {
  return String(pin || '').trim()
}

export function validarFormatoPin(pin) {
  const p = normalizar(pin)
  if (!/^\d{4}$/.test(p)) return 'PIN debe ser exactamente 4 digitos'
  // Bloquear los obvios.
  if (['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
       '1234', '4321', '1212', '2121'].includes(p)) {
    return 'PIN demasiado obvio. Elegi otro.'
  }
  return null
}

export function hashearPin(pin) {
  const p = normalizar(pin)
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex')
  const hash = crypto.pbkdf2Sync(p, salt, ITERACIONES, KEYLEN, DIGEST).toString('hex')
  return { hash, salt }
}

export function verificarPin(pin, hashEsperado, salt) {
  if (!pin || !hashEsperado || !salt) return false
  try {
    const p = normalizar(pin)
    const hash = crypto.pbkdf2Sync(p, salt, ITERACIONES, KEYLEN, DIGEST).toString('hex')
    // Comparacion en tiempo constante.
    const a = Buffer.from(hash, 'hex')
    const b = Buffer.from(hashEsperado, 'hex')
    if (a.length !== b.length) return false
    return crypto.timingSafeEqual(a, b)
  } catch (_) {
    return false
  }
}

// PIN aleatorio de 4 digitos, evitando los obvios.
export function generarPinAleatorio() {
  const obvios = new Set([
    '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
    '1234','4321','1212','2121','1010','0101','1313','9876',
  ])
  while (true) {
    const buf = crypto.randomBytes(2)
    const n = (buf[0] * 256 + buf[1]) % 10000
    const pin = String(n).padStart(4, '0')
    if (obvios.has(pin)) continue
    // Evitar todos los digitos iguales o secuencias obvias adicionales.
    if (/^(\d)\1{3}$/.test(pin)) continue
    return pin
  }
}
