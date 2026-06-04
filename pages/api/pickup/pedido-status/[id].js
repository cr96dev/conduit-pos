// pages/api/pickup/pedido-status/[id].js
//
// GET /api/pickup/pedido-status/[id]
//   Endpoint público liviano para polling desde el K2 / PWA durante el
//   flujo de pago QR. Devuelve { estado, referencia, total }.
//
//   ⚡ FIX DEFINITIVO (5 jun 2026): si el pedido está pendiente_pago y
//   tiene checkout_id de Recurrente, en este mismo request consultamos
//   a la API de Recurrente directamente para ver si el pago se confirmó.
//   Si Recurrente dice "pagado" → UPDATE estado a pendiente_entrega.
//   Así NO dependemos del webhook funcionando — funciona en cualquier
//   configuración. El webhook queda como redundancia opcional.
//
//   Latencia esperada: cliente paga → max 3-6 segundos → estado cambia.
//
// Seguridad: el ID es UUID v4 (no enumerable). Sin auth — el dueño del
// ID tiene acceso al estado (igual que /pickup/orders/[id]).

import { createClient } from '@supabase/supabase-js'
import { consultarCheckout, checkoutEstaPagado, RecurrenteError } from '../../../../lib/recurrente/client'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { id } = req.query
  if (!id || typeof id !== 'string' || id.length < 32) {
    return res.status(400).json({ error: 'id inválido' })
  }

  let { data, error } = await supabaseAdmin
    .from('pedidos_pendientes')
    .select('id, referencia, estado, pago_simulado, pago_metodo, pago_auth_code, total_estimado')
    .eq('id', id)
    .in('origen', ['app_pickup', 'kiosko_k2', 'pos_kiosko'])
    .single()

  if (error) {
    if (error.code === 'PGRST116') return res.status(404).json({ error: 'no encontrado' })
    return res.status(500).json({ error: error.message })
  }

  // ⚡ Si está pendiente_pago + es Recurrente real + tiene checkout_id,
  // consultamos Recurrente para confirmar. Si dice pagado, actualizamos
  // estado AHORA en este mismo request.
  if (
    data.estado === 'pendiente_pago' &&
    data.pago_metodo === 'recurrente' &&
    data.pago_simulado === false &&
    data.pago_auth_code
  ) {
    try {
      const checkout = await consultarCheckout(data.pago_auth_code)
      if (checkoutEstaPagado(checkout)) {
        // Pagado en Recurrente — actualizar estado
        const { data: updated, error: errUpd } = await supabaseAdmin
          .from('pedidos_pendientes')
          .update({ estado: 'pendiente_entrega', updated_at: new Date().toISOString() })
          .eq('id', id)
          .eq('estado', 'pendiente_pago')  // guard contra race con webhook
          .select('id, estado')
          .single()
        if (!errUpd && updated) {
          console.log(`[pedido-status] confirmado pago ${data.pago_auth_code} para ${data.referencia} via consulta directa`)
          data.estado = updated.estado
        }
      }
    } catch (e) {
      // Si Recurrente no responde, no rompemos el polling. Devolvemos
      // el estado actual de BD; el siguiente tick volverá a intentar.
      // Solo loggeamos si NO es 404 (404 = checkout no existe en Recurrente,
      // probablemente es de sandbox o de un test viejo).
      const status = e instanceof RecurrenteError ? e.status : null
      if (status !== 404) {
        console.warn(`[pedido-status] error consultando Recurrente ${data.pago_auth_code}:`, e.message)
      }
    }
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')
  return res.status(200).json({
    ok: true,
    id: data.id,
    referencia: data.referencia,
    estado: data.estado,
    pago_simulado: data.pago_simulado,
    total: Number(data.total_estimado || 0),
  })
}
