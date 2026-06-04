// lib/recurrente/client.js
//
// Cliente Node para la API de Recurrente (pasarela de pagos GT).
// Doc: https://docs.recurrente.com / https://app.recurrente.com/api
//
// Auth: header `X-SECRET-KEY: sk_test_xxx` o `sk_live_xxx`.
// La env var RECURRENTE_SECRET_KEY define ambiente (test vs live por prefijo).

const BASE_URL = 'https://app.recurrente.com/api'

export class RecurrenteError extends Error {
  constructor(message, { etapa, status, body } = {}) {
    super(message)
    this.name = 'RecurrenteError'
    this.etapa = etapa
    this.status = status
    this.body = body
  }
}

function getSecretKey() {
  const key = process.env.RECURRENTE_SECRET_KEY
  if (!key) throw new RecurrenteError('RECURRENTE_SECRET_KEY no configurada', { etapa: 'config' })
  return key
}

export function esTestMode() {
  const key = process.env.RECURRENTE_SECRET_KEY || ''
  return key.startsWith('sk_test_')
}

async function rpc(method, path, body) {
  const key = getSecretKey()
  const url = `${BASE_URL}${path}`
  const init = {
    method,
    headers: {
      'X-SECRET-KEY': key,
      'Accept': 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }
  let res
  try {
    res = await fetch(url, init)
  } catch (e) {
    throw new RecurrenteError(`Red caída hacia Recurrente: ${e.message}`, { etapa: 'fetch' })
  }
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { json = { raw: text } }
  if (!res.ok) {
    throw new RecurrenteError(
      json?.error || json?.message || `HTTP ${res.status}`,
      { etapa: 'response', status: res.status, body: json },
    )
  }
  return json
}

// GET /api/test — verifica que las credenciales funcionen
export function testCredenciales() {
  return rpc('GET', '/test')
}

/**
 * Crear un checkout (sesión de pago) en Recurrente.
 *
 * @param {Object} args
 * @param {Array<{name:string, amount_in_cents:number, currency?:string, quantity?:number}>} args.items
 * @param {string} args.success_url   — URL a la que vuelve el cliente tras pago OK
 * @param {string} args.cancel_url    — URL a la que vuelve si cancela/falla
 * @param {Object} [args.metadata]    — clave/valor para rastrear el checkout (ej. { order_id })
 * @param {Object} [args.customer]    — { email, name, phone } opcional
 * @returns {Promise<{id:string, checkout_url:string, live_mode:boolean, ...}>}
 */
export async function crearCheckout({ items, success_url, cancel_url, metadata, customer }) {
  if (!Array.isArray(items) || !items.length) {
    throw new RecurrenteError('items[] requerido', { etapa: 'validacion' })
  }
  // Validar mínimo (500 GTQ cents = Q5, 100 USD cents = $1)
  for (const it of items) {
    const cur = (it.currency || 'GTQ').toUpperCase()
    const min = cur === 'GTQ' ? 500 : 100
    if (!it.amount_in_cents || it.amount_in_cents < min) {
      throw new RecurrenteError(
        `amount_in_cents debe ser >= ${min} para ${cur} (item: ${it.name})`,
        { etapa: 'validacion' },
      )
    }
  }
  const body = {
    items: items.map(it => ({
      name: it.name,
      amount_in_cents: it.amount_in_cents,
      currency: (it.currency || 'GTQ').toUpperCase(),
      quantity: it.quantity || 1,
    })),
    success_url,
    cancel_url,
  }
  if (metadata) body.metadata = metadata
  if (customer) body.customer = customer
  return rpc('POST', '/checkouts', body)
}

/**
 * Verifica la firma HMAC-SHA256 del webhook de Recurrente.
 *
 * Patrón estándar (igual que Stripe, GitHub, etc):
 *   1. Recurrente envía header con la firma: probablemente `X-Recurrente-Signature`
 *      o `Webhook-Signature` (confirmar en dashboard al configurar el webhook).
 *   2. La firma es HMAC-SHA256(rawBody) usando el `webhook_secret` que copiamos
 *      del dashboard Recurrente y guardamos en env var RECURRENTE_WEBHOOK_SECRET.
 *   3. Comparamos con timing-safe compare.
 *
 * Si RECURRENTE_WEBHOOK_SECRET NO está configurada, devolvemos true en TEST
 * mode (sandbox no dispara webhooks reales) y false en LIVE — preferimos
 * rechazar todo en producción si la verificación no está armada que dejar
 * pasar pagos falsos.
 *
 * Recurrente puede usar 2 formatos comunes:
 *   A) `X-Signature: <hex_digest>`                    → simple HMAC
 *   B) `X-Signature: t=<unix>,v1=<hex>`              → Stripe-like con timestamp
 * Soportamos ambos. El nombre del header se lee de
 * RECURRENTE_WEBHOOK_SIGNATURE_HEADER (default: 'x-recurrente-signature').
 */
import crypto from 'crypto'

export function verificarWebhookSignature(req, rawBody) {
  const secret = process.env.RECURRENTE_WEBHOOK_SECRET
  if (!secret) {
    // Sandbox sin secret: permitir (no se disparan webhooks reales).
    // LIVE sin secret: rechazar (más seguro fallar cerrado).
    if (esTestMode()) return true
    console.error('[recurrente-webhook] RECURRENTE_WEBHOOK_SECRET no configurado en LIVE — rechazando')
    return false
  }

  const headerName = (process.env.RECURRENTE_WEBHOOK_SIGNATURE_HEADER || 'x-recurrente-signature').toLowerCase()
  const sigHeader = req.headers[headerName]
  if (!sigHeader || typeof sigHeader !== 'string') {
    console.warn(`[recurrente-webhook] header ${headerName} ausente`)
    return false
  }

  // Detectar formato: simple "abc123..." vs Stripe-like "t=12345,v1=abc..."
  let firmaRecibida = sigHeader.trim()
  let timestampedPayload = String(rawBody || '')
  if (sigHeader.includes(',')) {
    const partes = Object.fromEntries(sigHeader.split(',').map(p => p.split('=').map(s => s.trim())))
    if (partes.t && partes.v1) {
      firmaRecibida = partes.v1
      timestampedPayload = `${partes.t}.${rawBody}`
      // Anti-replay: rechazar payloads de >5min de edad
      const edadSeg = Math.floor(Date.now() / 1000) - Number(partes.t)
      if (!isFinite(edadSeg) || edadSeg < -60 || edadSeg > 300) {
        console.warn(`[recurrente-webhook] timestamp fuera de tolerancia: ${edadSeg}s`)
        return false
      }
    }
  }

  const firmaEsperada = crypto
    .createHmac('sha256', secret)
    .update(timestampedPayload, 'utf-8')
    .digest('hex')

  // Timing-safe compare para evitar timing attacks
  const a = Buffer.from(firmaRecibida, 'hex')
  const b = Buffer.from(firmaEsperada, 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
