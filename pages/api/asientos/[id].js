// pages/api/asientos/[id].js
// GET    /api/asientos/:id    -> cabecera + partidas + nombres de cuenta
// DELETE /api/asientos/:id    -> borrar (solo borrador) o exigir anular

import { requireAuth, requireAdmin } from '../../../lib/auth'

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

  const { data: asiento, error } = await auth.admin
    .from('asientos').select('*').eq('id', id).single()
  if (error) return res.status(404).json({ error: 'Asiento no encontrado' })

  const { data: partidas } = await auth.admin
    .from('asientos_partidas')
    .select('*, cuentas_contables(codigo, nombre, tipo)')
    .eq('asiento_id', id)
    .order('orden')

  return res.status(200).json({ ok: true, asiento: { ...asiento, partidas: partidas || [] } })
}

async function borrar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: actual } = await auth.admin.from('asientos').select('estado').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'No encontrado' })
  if (actual.estado === 'posteado') {
    return res.status(400).json({ error: 'Asiento posteado: anular en vez de borrar' })
  }
  const { error } = await auth.admin.from('asientos').delete().eq('id', id)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true })
}
