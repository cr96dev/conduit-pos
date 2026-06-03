// pages/api/pickup/recurrente-checkout.js
//
// POST /api/pickup/recurrente-checkout
//   Body: { order_id: uuid }
//   1. Lee el pedido_pendiente correspondiente
//   2. Crea checkout en Recurrente con los items reales del pedido
//   3. Guarda el checkout_session_id en el pedido para correlacionar webhook
//   4. Devuelve { checkout_url } para redirigir al cliente

import { createClient } from '@supabase/supabase-js'
import { crearCheckout, RecurrenteError, esTestMode } from '../../../lib/recurrente/client'

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
    .select('id, referencia, items, total_estimado, receptor_email, receptor_nombre, estado, origen')
    .eq('id', order_id)
    .in('origen', ['app_pickup', 'kiosko_k2'])
    .single()

  if (errLoad || !pedido) {
    return res.status(404).json({ error: 'Pedido no encontrado' })
  }
  if (pedido.estado !== 'pendiente_pago' && pedido.estado !== 'pendiente_entrega') {
    return res.status(409).json({ error: `Pedido ya está en estado: ${pedido.estado}` })
  }

  // URLs de retorno — usamos el host del request (preview o prod)
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers.host
  const baseUrl = `${proto}://${host}`

  // Convertir items del pedido al shape de Recurrente
  const recurrenteItems = (pedido.items || []).map((it) => ({
    name: it.descripcion?.slice(0, 100) || 'Producto',
    amount_in_cents: Math.round(Number(it.precio_unitario) * 100),
    currency: 'GTQ',
    quantity: Number(it.cantidad) || 1,
  }))

  // Validar que el total cumpla el mínimo Q5 (500 cents)
  const totalCents = recurrenteItems.reduce((sum, i) => sum + i.amount_in_cents * i.quantity, 0)
  if (totalCents < 500) {
    return res.status(400).json({
      error: 'Monto mínimo Q5.00 para procesar pago con tarjeta.',
    })
  }

  try {
    const checkout = await crearCheckout({
      items: recurrenteItems,
      success_url: `${baseUrl}/pickup/exito/${order_id}?session={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${baseUrl}/pickup/pago?cancelled=1&order_id=${order_id}`,
      metadata: { order_id, referencia: pedido.referencia },
      customer: pedido.receptor_email ? {
        email: pedido.receptor_email,
        name: pedido.receptor_nombre,
      } : undefined,
    })

    // Guardar checkout id en el pedido para que el webhook lo encuentre
    await supabaseAdmin
      .from('pedidos_pendientes')
      .update({
        pago_metodo: 'recurrente',
        pago_simulado: esTestMode(),
        pago_auth_code: checkout.id,  // reusamos campo: en Neonet era auth, acá es checkout id
      })
      .eq('id', order_id)

    return res.status(200).json({
      ok: true,
      checkout_url: checkout.checkout_url,
      checkout_id: checkout.id,
      test_mode: esTestMode(),
    })
  } catch (e) {
    if (e instanceof RecurrenteError) {
      console.error('[recurrente-checkout] ERROR:', e.message, e.body)
      return res.status(502).json({
        ok: false,
        error: e.message,
        etapa: e.etapa,
        detalle: e.body,
      })
    }
    console.error('[recurrente-checkout] EXC:', e)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
