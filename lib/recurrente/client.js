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
 * Consulta el estado actual de un checkout en Recurrente.
 * Devuelve el objeto completo del checkout. Lo usamos como fallback al
 * webhook: el endpoint /api/pickup/pedido-status consulta acá cuando el
 * pedido está pendiente_pago, así no dependemos del webhook funcionando
 * perfecto.
 *
 * Endpoints posibles (a confirmar con docs Recurrente):
 *   GET /checkouts/{id}     ← más común
 *
 * @returns {Promise<{id:string, status?:string, paid?:boolean, amount_in_cents?:number, ...}>}
 */
export async function consultarCheckout(checkoutId) {
  if (!checkoutId || typeof checkoutId !== 'string') {
    throw new RecurrenteError('checkoutId requerido', { etapa: 'validacion' })
  }
  return rpc('GET', `/checkouts/${encodeURIComponent(checkoutId)}`)
}

/**
 * Determina si un checkout devuelto por Recurrente está pagado.
 * Heurística amplia para soportar variaciones del shape:
 *   - status: 'paid' | 'completed' | 'succeeded'
 *   - paid: true
 *   - payment_status: 'paid'
 *   - state: 'paid'
 */
export function checkoutEstaPagado(checkout) {
  if (!checkout || typeof checkout !== 'object') return false
  if (checkout.paid === true) return true
  if (checkout.payment?.status && /paid|completed|succeeded|approved/i.test(checkout.payment.status)) return true
  for (const k of ['status', 'payment_status', 'state', 'checkout_status']) {
    const v = checkout[k]
    if (typeof v === 'string' && /paid|completed|succeeded|approved/i.test(v)) return true
  }
  return false
}

/**
 * Verifica la firma de webhook de Recurrente.
 *
 * Recurrente usa Svix como infraestructura de webhooks. El esquema de
 * firma de Svix (docs.svix.com/receiving/verifying-payloads/how) es:
 *
 *   Headers que envía Svix:
 *     - svix-id          → identifier único del mensaje (msg_xxx)
 *     - svix-timestamp   → unix timestamp en segundos
 *     - svix-signature   → "v1,<base64_sig> v1,<otra_sig>" (soporta rotación)
 *
 *   Payload firmado:
 *     signed_content = svix-id + "." + svix-timestamp + "." + body
 *
 *   Secret:
 *     viene del dashboard como "whsec_BASE64_DEL_SECRET". Hay que sacar
 *     el prefijo whsec_ y decodear base64 para obtener los bytes raw.
 *
 *   Firma:
 *     HMAC-SHA256(signed_content, secret_bytes) → base64
 *
 *   Anti-replay:
 *     rechazar si svix-timestamp difiere >5 min de NOW.
 *
 * Si RECURRENTE_WEBHOOK_SECRET NO está configurada, devolvemos true en
 * TEST mode (sandbox no dispara webhooks reales) y false en LIVE — fallar
 * cerrado es más seguro que dejar pasar pagos falsos.
 */
import crypto from 'crypto'

export function verificarWebhookSignature(req, rawBody) {
  const secret = process.env.RECURRENTE_WEBHOOK_SECRET
  if (!secret) {
    if (esTestMode()) return true
    console.error('[webhook] RECURRENTE_WEBHOOK_SECRET no configurado en LIVE — rechazando')
    return false
  }

  const svixId = req.headers['svix-id']
  const svixTimestamp = req.headers['svix-timestamp']
  const svixSignature = req.headers['svix-signature']

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.warn('[webhook] headers svix-* faltan', {
      tieneId: !!svixId, tieneTs: !!svixTimestamp, tieneSig: !!svixSignature,
    })
    return false
  }

  // Anti-replay: rechazar si el timestamp es de hace >5 min o del futuro >1 min
  const tsSec = Number(svixTimestamp)
  const ahoraSec = Math.floor(Date.now() / 1000)
  const edadSeg = ahoraSec - tsSec
  if (!isFinite(tsSec) || edadSeg < -60 || edadSeg > 300) {
    console.warn(`[webhook] svix-timestamp fuera de tolerancia: ${edadSeg}s`)
    return false
  }

  // Decodear el secret del formato Svix (whsec_BASE64)
  const secretLimpio = secret.startsWith('whsec_') ? secret.slice(6) : secret
  let secretBytes
  try {
    secretBytes = Buffer.from(secretLimpio, 'base64')
  } catch (e) {
    console.error('[webhook] secret no es base64 válido')
    return false
  }
  if (secretBytes.length === 0) {
    console.error('[webhook] secret vacío después de decodear')
    return false
  }

  // Construir el payload firmado y calcular HMAC
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const firmaEsperada = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent, 'utf-8')
    .digest('base64')

  // svix-signature puede contener varias firmas separadas por espacio (rotación):
  //   "v1,signature_actual v1,signature_anterior"
  // Cualquiera que matchee es válida.
  const firmasRecibidas = String(svixSignature).split(' ')
  for (const firma of firmasRecibidas) {
    if (!firma.startsWith('v1,')) continue
    const valor = firma.slice(3)
    try {
      const a = Buffer.from(valor, 'base64')
      const b = Buffer.from(firmaEsperada, 'base64')
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return true
      }
    } catch (_) {
      // firma malformada, probar siguiente
    }
  }
  return false
}
