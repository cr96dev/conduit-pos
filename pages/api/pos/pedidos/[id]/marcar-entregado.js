// pages/api/pos/pedidos/[id]/marcar-entregado.js
//
// POST /api/pos/pedidos/[id]/marcar-entregado
//   Marca el pedido como entregado_facturado SIN emitir factura nueva.
//   Solo aplica a pedidos que ya tienen factura_id (FEL ya emitida) y
//   estado=pendiente_entrega. Caso típico: pedido del K2 que el flujo
//   viejo auto-facturó y necesitamos marcar entrega física desde el POS.
//
// Auth: cajero o admin.

import { requireAdminOCajero } from '../../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdminOCajero(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id requerido' })

  // Cargar pedido + validar
  const { data: pedido, error: errLoad } = await auth.admin
    .from('pedidos_pendientes')
    .select('id, referencia, estado, factura_id')
    .eq('id', id)
    .single()

  if (errLoad || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' })

  if (!pedido.factura_id) {
    return res.status(400).json({
      error: 'Este pedido todavía no tiene factura. Usá "Entregar y facturar" para emitir el FEL.',
    })
  }
  if (pedido.estado !== 'pendiente_entrega' && pedido.estado !== 'lista') {
    return res.status(409).json({ error: `Pedido en estado ${pedido.estado}` })
  }

  // Marcar entregado_facturado (la factura ya existía)
  const { data: updated, error: errUpd } = await auth.admin
    .from('pedidos_pendientes')
    .update({
      estado: 'entregado_facturado',
      cajero_que_facturo: auth.user.id,  // registramos quién hizo el cierre físico
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .in('estado', ['pendiente_entrega', 'lista'])
    .select()
    .single()

  if (errUpd) return res.status(500).json({ ok: false, error: errUpd.message })
  return res.status(200).json({ ok: true, pedido: updated })
}
