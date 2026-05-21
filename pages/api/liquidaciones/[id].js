// pages/api/liquidaciones/[id].js
// GET    /api/liquidaciones/:id  -> detalle
// DELETE /api/liquidaciones/:id  -> borrar (admin). Reactiva el empleado si quedo
//                                     inactivo solamente por esta liquidacion.

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

  const { data, error } = await auth.admin
    .from('liquidaciones').select('*').eq('id', id).single()
  if (error) return res.status(404).json({ error: 'Liquidacion no encontrada' })
  return res.status(200).json({ ok: true, liquidacion: data })
}

async function borrar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: liq } = await auth.admin
    .from('liquidaciones').select('empleado_id').eq('id', id).single()
  if (!liq) return res.status(404).json({ error: 'Liquidacion no encontrada' })

  const { error } = await auth.admin.from('liquidaciones').delete().eq('id', id)
  if (error) return res.status(500).json({ ok: false, error: error.message })

  // Si el empleado existe y esta inactivo, reactivarlo.
  if (liq.empleado_id) {
    await auth.admin.from('empleados')
      .update({ activo: true, updated_at: new Date().toISOString() })
      .eq('id', liq.empleado_id).eq('activo', false)
  }

  return res.status(200).json({ ok: true })
}
