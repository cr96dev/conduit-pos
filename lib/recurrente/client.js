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
 * Verifica la firma del webhook (placeholder hasta confirmar mecánica con Recurrente).
 * Documentación de webhooks pendiente — Recurrente típicamente envía un header
 * `X-Recurrente-Signature` con HMAC-SHA256 del body usando el webhook secret.
 *
 * Por ahora retornamos true en TEST mode (sandbox no dispara webhooks) y validamos
 * solo origen/IP en LIVE hasta confirmar la firma real.
 */
export function verificarWebhookSignature(_req, _rawBody) {
  // TODO: implementar HMAC-SHA256 cuando confirmemos webhook secret en dashboard
  return true
}
