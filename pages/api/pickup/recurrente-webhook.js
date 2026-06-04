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

  // Recurrente/Svix puede usar varios nombres para el campo del tipo de evento.
  // Probamos en orden: event, type, event_type, kind, action, data.type.
  // Si no encontramos en ninguno, loggemos el payload completo para diagnóstico.
  const eventType = payload.event || payload.type || payload.event_type
    || payload.kind || payload.action || payload.data?.type
    || payload.data?.event || payload.data?.status || ''

  console.log('[recurrente-webhook] event:', eventType, 'top keys:', Object.keys(payload), 'data keys:', Object.keys(payload.data || {}))
  // Log completo del payload truncado a 2KB para no llenar logs
  console.log('[recurrente-webhook] payload preview:', JSON.stringify(payload).slice(0, 2000))

  const isCompleted = /completed|succeeded|paid|confirmed|approved/i.test(eventType)
                   || (typeof payload.status === 'string' && /paid|completed|succeeded/i.test(payload.status))
                   || (typeof payload.data?.status === 'string' && /paid|completed|succeeded/i.test(payload.data.status))
  const isFailed    = /failed|declined|rejected|cancelled|canceled/i.test(eventType)

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
        pagado_at: new Date().toISOString(),
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
