// pages/api/pickup/orders/[id].js
//
// GET /api/pickup/orders/[id]
//   Devuelve un pedido por ID. Público (cualquiera con el ID puede consultar).
//   En MVP es OK: el ID es UUID de 36 chars, no enumerable. En Fase 2 sumar
//   verificación de email match para evitar leaks.

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
    .select('id, referencia, items, total_estimado, estado, slot_pickup_at, slot_label, day_label, created_at, receptor_nit, receptor_nombre')
    .eq('id', id)
    .in('origen', ['app_pickup', 'kiosko_k2'])
    .single()

  if (error) {
    if (error.code === 'PGRST116') return res.status(404).json({ error: 'Pedido no encontrado' })
    return res.status(500).json({ error: error.message })
  }
  return res.status(200).json({ ok: true, order: data })
}
