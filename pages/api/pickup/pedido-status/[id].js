// pages/api/pickup/pedido-status/[id].js
//
// GET /api/pickup/pedido-status/[id]
//   Endpoint público liviano para polling. Devuelve solo lo necesario para
//   que el K2 detecte cambios de estado: { estado, pago_estado, referencia }.
//   Lo usa la pantalla /pickup/qr/[id] que muestra el QR de Recurrente y
//   espera a que el cliente termine de pagar en su celular.
//
// Seguridad: el ID es UUID v4 (no enumerable). Sin auth en MVP — el dueño
// del ID tiene acceso al estado (igual que /pickup/orders/[id]).

import { createClient } from '@supabase/supabase-js'

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

  const { data, error } = await supabaseAdmin
    .from('pedidos_pendientes')
    .select('id, referencia, estado, pago_simulado, total_estimado')
    .eq('id', id)
    .in('origen', ['app_pickup', 'kiosko_k2', 'pos_kiosko'])
    .single()

  if (error) {
    if (error.code === 'PGRST116') return res.status(404).json({ error: 'no encontrado' })
    return res.status(500).json({ error: error.message })
  }

  // No-cache para que el polling siempre vea el último estado
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
