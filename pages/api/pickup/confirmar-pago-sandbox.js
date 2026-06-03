// pages/api/pickup/confirmar-pago-sandbox.js
//
// POST /api/pickup/confirmar-pago-sandbox
//   Body: { order_id }
//
// En sandbox (RECURRENTE_SECRET_KEY=sk_test_*) los webhooks NO se disparan,
// pero el cliente sí completa el pago y vuelve al success_url. Esta ruta
// simula el webhook al volver: marca el pedido como pendiente_entrega
// para que aparezca en la bandeja del cajero.
//
// En producción (sk_live_*) esto NO hace nada — el webhook real ya cambió
// el estado antes y dejarlo en idempotente.

import { createClient } from '@supabase/supabase-js'
import { esTestMode } from '../../../lib/recurrente/client'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { order_id } = req.body || {}
  if (!order_id || typeof order_id !== 'string') {
    return res.status(400).json({ error: 'order_id requerido' })
  }

  // Cargar pedido
  const { data: pedido, error: errLoad } = await supabaseAdmin
    .from('pedidos_pendientes')
    .select('id, referencia, estado, pago_simulado, pago_metodo')
    .eq('id', order_id)
    .eq('origen', 'app_pickup')
    .single()

  if (errLoad || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' })

  // Solo confirmar en sandbox + pedido aún pendiente_pago
  if (!esTestMode()) {
    return res.status(200).json({ ok: true, mode: 'live', estado: pedido.estado })
  }
  if (pedido.estado !== 'pendiente_pago') {
    return res.status(200).json({ ok: true, ya_confirmado: true, estado: pedido.estado })
  }

  // Marcar como confirmado (simulando webhook)
  const { data: updated, error: errUpd } = await supabaseAdmin
    .from('pedidos_pendientes')
    .update({ estado: 'pendiente_entrega' })
    .eq('id', order_id)
    .eq('estado', 'pendiente_pago')  // guard contra race
    .select('id, referencia, estado')
    .single()

  if (errUpd) return res.status(500).json({ error: errUpd.message })

  return res.status(200).json({
    ok: true,
    mode: 'sandbox',
    confirmado: true,
    pedido: updated,
  })
}
