// pages/api/fel/facturas/[id].js
// GET    /api/fel/facturas/:id  -> detalle con items
// DELETE /api/fel/facturas/:id  -> borrar (solo borrador)

import { requireAuth, requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET')    return detalle(req, res, id)
  if (req.method === 'DELETE') return borrar(req, res, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function detalle(req, res, id) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: factura, error } = await auth.admin
    .from('facturas_fel').select('*').eq('id', id).single()
  if (error) return res.status(404).json({ error: 'No encontrada' })
  const { data: items } = await auth.admin
    .from('facturas_fel_items').select('*').eq('factura_id', id).order('orden')
  return res.status(200).json({ ok: true, factura: { ...factura, items: items || [] } })
}

async function borrar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { data: actual } = await auth.admin.from('facturas_fel').select('estado').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'No encontrada' })
  if (actual.estado === 'certificada') {
    return res.status(400).json({ error: 'No se puede borrar una factura certificada. Anular en su lugar.' })
  }
  const { error } = await auth.admin.from('facturas_fel').delete().eq('id', id)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true })
}
