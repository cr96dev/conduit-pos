// pages/api/pos/pedidos/[id]/marcar-listo.js
//
// POST /api/pos/pedidos/[id]/marcar-listo
//   Marca el pedido pickup como 'lista' y dispara el email al cliente
//   diciendo "¡Tu pedido está listo!". Solo aplica a origen=app_pickup.
//
// Auth: cajero o admin.

import { requireAdminOCajero } from '../../../../../lib/auth'
import { enviarEmailListo } from '../../../../../lib/pickup/email'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdminOCajero(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id requerido' })

  // Cargar pedido
  const { data: pedido, error: errLoad } = await auth.admin
    .from('pedidos_pendientes')
    .select('id, referencia, estado, origen, receptor_email')
    .eq('id', id)
    .single()

  if (errLoad || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' })
  if (pedido.origen !== 'app_pickup') {
    return res.status(400).json({ error: 'Esta acción solo aplica a pedidos del app pickup' })
  }
  if (pedido.estado === 'lista') {
    return res.status(200).json({ ok: true, ya_listo: true, pedido })
  }
  if (pedido.estado !== 'pendiente_entrega') {
    return res.status(409).json({ error: `Pedido en estado ${pedido.estado}, no se puede marcar listo` })
  }

  // Actualizar estado
  const { data: updated, error: errUpd } = await auth.admin
    .from('pedidos_pendientes')
    .update({ estado: 'lista' })
    .eq('id', id)
    .eq('estado', 'pendiente_entrega')  // guard
    .select('id, referencia, estado, receptor_email')
    .single()

  if (errUpd) return res.status(500).json({ error: errUpd.message })

  // Disparar email al cliente (best-effort)
  let emailResult = null
  if (updated.receptor_email) {
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const baseUrl = `${proto}://${req.headers.host}`
    try {
      emailResult = await enviarEmailListo({
        to: updated.receptor_email,
        referencia: updated.referencia,
        baseUrl,
        order_id: updated.id,
      })
    } catch (e) {
      console.error('[marcar-listo] email failed:', e.message)
      emailResult = { ok: false, error: e.message }
    }
  }

  return res.status(200).json({ ok: true, pedido: updated, email: emailResult })
}
