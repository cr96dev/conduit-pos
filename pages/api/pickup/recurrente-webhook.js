// pages/api/pickup/recurrente-webhook.js
//
// POST /api/pickup/recurrente-webhook
//   Recibe eventos de Recurrente. En sandbox (sk_test) NO se disparan webhooks,
//   solo en LIVE. Por eso este handler queda preparado para producción.
//
// Eventos esperados (a confirmar con Recurrente):
//   - checkout.completed / payment.succeeded → marca el pedido como pagado
//   - payment.failed → marca rechazado, deja el pedido en pendiente_pago

import { createClient } from '@supabase/supabase-js'
import { verificarWebhookSignature } from '../../../lib/recurrente/client'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export const config = {
  api: { bodyParser: false },  // necesitamos raw body para HMAC
}

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf-8')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  let rawBody = ''
  let payload = null
  try {
    rawBody = await readRawBody(req)
    payload = JSON.parse(rawBody)
  } catch (e) {
    console.error('[recurrente-webhook] payload inválido:', e.message)
    return res.status(400).json({ error: 'Body inválido' })
  }

  // Verificar signature (Svix HMAC-SHA256 base64)
  if (!verificarWebhookSignature(req, rawBody)) {
    console.warn('[recurrente-webhook] signature inválida — rechazando')
    return res.status(401).json({ error: 'Signature inválida' })
  }

  console.log('[recurrente-webhook] event:', payload.event || payload.type, 'data keys:', Object.keys(payload.data || payload))

  // Manejar eventos de pago confirmado (nombre exacto a confirmar con Recurrente)
  const eventType = payload.event || payload.type || ''
  const isCompleted = /completed|succeeded|paid|confirmed/i.test(eventType)
  const isFailed    = /failed|declined|rejected/i.test(eventType)

  if (isCompleted) {
    // Identificar el pedido por metadata u order_id
    const data = payload.data || payload
    const orderId = data.metadata?.order_id || payload.metadata?.order_id
    const checkoutId = data.id || data.checkout_id || payload.checkout_id

    if (!orderId && !checkoutId) {
      console.error('[recurrente-webhook] sin orderId/checkoutId en payload')
      return res.status(200).json({ ok: true, message: 'No order to update' })
    }

    // Lookup por order_id o por checkout_id guardado en pago_auth_code.
    // Filtramos por origen para evitar que un atacante (con un order_id
    // robado o adivinado) marque pagado un pedido que NO viene de Recurrente.
    let query = supabaseAdmin.from('pedidos_pendientes')
      .update({
        estado: 'pendiente_entrega',
        pago_auth_code: checkoutId || undefined,
      })
      .in('origen', ['app_pickup', 'kiosko_k2', 'pos_kiosko'])
      .eq('estado', 'pendiente_pago')  // guard: solo si todavía espera pago

    if (orderId) query = query.eq('id', orderId)
    else query = query.eq('pago_auth_code', checkoutId)

    // .maybeSingle() — si el pedido ya fue confirmado por otro evento
    // (idempotencia), devuelve null y no rompe. Recurrente reintenta los
    // webhooks si nos demoramos.
    const { data: updated, error } = await query.select('id, referencia').maybeSingle()

    if (error) {
      console.error('[recurrente-webhook] update error:', error.message)
      return res.status(500).json({ error: error.message })
    }
    if (!updated) {
      // Ya estaba confirmado o no existe — devolvemos 200 para que Recurrente
      // no nos siga mandando reintentos del mismo evento.
      console.log('[recurrente-webhook] pedido ya confirmado o no encontrado — idempotente')
      return res.status(200).json({ ok: true, already_processed: true })
    }
    console.log(`[recurrente-webhook] Pedido ${updated.referencia} confirmado como pagado`)
    return res.status(200).json({ ok: true, order_id: updated.id })
  }

  if (isFailed) {
    console.log('[recurrente-webhook] payment.failed (no action — pedido queda en pendiente_pago)')
    return res.status(200).json({ ok: true })
  }

  // Eventos no manejados: 200 OK para que Recurrente no reintente
  console.log('[recurrente-webhook] evento no manejado:', eventType)
  return res.status(200).json({ ok: true, ignored: eventType })
}
