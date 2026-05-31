// pages/api/pos/pedidos/[id].js
//
// GET    /api/pos/pedidos/:id   detalle del pedido
// PATCH  /api/pos/pedidos/:id   editar items / referencia / receptor (solo si pendiente)
// DELETE /api/pos/pedidos/:id   cancelar (no borra: marca estado=cancelado)
//
// El endpoint para facturar vive en /api/pos/pedidos/[id]/facturar.js

import { requireAdminOCajero } from '../../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  const auth = await requireAdminOCajero(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET')    return getDetalle(id, res, auth)
  if (req.method === 'PATCH')  return patchHandler(id, req, res, auth)
  if (req.method === 'DELETE') return cancelHandler(id, req, res, auth)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function getDetalle(id, res, auth) {
  const { data, error } = await auth.admin
    .from('pedidos_pendientes').select('*').eq('id', id).maybeSingle()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  if (!data) return res.status(404).json({ ok: false, error: 'Pedido no encontrado' })
  return res.status(200).json({ ok: true, pedido: data })
}

async function patchHandler(id, req, res, auth) {
  // 1. Cargar pedido y validar estado
  const { data: pedido, error: errLoad } = await auth.admin
    .from('pedidos_pendientes').select('*').eq('id', id).maybeSingle()
  if (errLoad || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' })
  if (pedido.estado !== 'pendiente_entrega') {
    return res.status(409).json({ error: `Pedido en estado "${pedido.estado}", ya no se puede editar.` })
  }

  const { items, referencia, receptor, notas } = req.body || {}
  const update = {}

  if (Array.isArray(items)) {
    for (const [i, it] of items.entries()) {
      if (!it.descripcion?.trim()) return res.status(400).json({ error: `item ${i + 1}: descripcion requerida` })
      if (!(Number(it.cantidad) > 0)) return res.status(400).json({ error: `item ${i + 1}: cantidad > 0 requerida` })
      if (!(Number(it.precio_unitario) > 0)) return res.status(400).json({ error: `item ${i + 1}: precio_unitario > 0 requerido` })
    }
    update.items = items
    update.total_estimado = round2(
      items.reduce((s, it) => s + Number(it.cantidad) * Number(it.precio_unitario), 0)
    )
  }
  if (referencia !== undefined) {
    if (typeof referencia !== 'string' || !referencia.trim()) {
      return res.status(400).json({ error: 'referencia debe ser string no vacio' })
    }
    update.referencia = referencia.trim().slice(0, 200)
  }
  if (receptor && typeof receptor === 'object') {
    if (receptor.nit !== undefined)    update.receptor_nit = String(receptor.nit || 'CF').trim().toUpperCase() || 'CF'
    if (receptor.nombre !== undefined) update.receptor_nombre = String(receptor.nombre).trim()
    if (receptor.email !== undefined)  update.receptor_email = receptor.email ? String(receptor.email).trim() : null
  }
  if (notas !== undefined) update.notas = notas ? String(notas).slice(0, 1000) : null

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'Nada que actualizar' })
  }

  const { data, error } = await auth.admin
    .from('pedidos_pendientes').update(update).eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, pedido: data })
}

async function cancelHandler(id, req, res, auth) {
  // DELETE no borra fisicamente — para auditoria, marca estado='cancelado'.
  // El motivo puede venir en body { motivo } o como query ?motivo=.
  const motivo = (req.body?.motivo || req.query?.motivo || '').toString().trim().slice(0, 500) || null

  const { data: pedido, error: errLoad } = await auth.admin
    .from('pedidos_pendientes').select('*').eq('id', id).maybeSingle()
  if (errLoad || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' })
  if (pedido.estado !== 'pendiente_entrega') {
    return res.status(409).json({ error: `Pedido en estado "${pedido.estado}", ya no se puede cancelar.` })
  }

  const { data, error } = await auth.admin
    .from('pedidos_pendientes')
    .update({
      estado: 'cancelado',
      motivo_cancelacion: motivo,
      cancelado_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, pedido: data })
}
