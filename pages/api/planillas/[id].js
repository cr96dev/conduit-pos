// pages/api/planillas/[id].js
// GET    /api/planillas/:id      -> cabecera + lineas + auditoria
// PATCH  /api/planillas/:id      -> editar cabecera (notas, periodo, fechas si borrador)
// DELETE /api/planillas/:id      -> elimina (solo si borrador, admin)

import { requireAuth, requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET')    return detalle(req, res, id)
  if (req.method === 'PATCH')  return editar(req, res, id)
  if (req.method === 'DELETE') return borrar(req, res, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function detalle(req, res, id) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: planilla, error } = await auth.admin
    .from('planillas').select('*').eq('id', id).single()
  if (error) return res.status(404).json({ error: 'Planilla no encontrada' })

  const { data: lineas } = await auth.admin
    .from('planilla_lineas').select('*').eq('planilla_id', id)
    .order('area').order('nombre')

  const { data: auditoria } = await auth.admin
    .from('planilla_auditoria').select('*').eq('planilla_id', id)
    .order('created_at', { ascending: false }).limit(50)

  return res.status(200).json({ ok: true, planilla: { ...planilla, lineas: lineas || [], auditoria: auditoria || [] } })
}

async function editar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: actual } = await auth.admin.from('planillas').select('estado').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'Planilla no encontrada' })
  if (actual.estado !== 'borrador') {
    return res.status(400).json({ error: 'Solo se puede editar la cabecera en borrador' })
  }

  const editables = ['periodo', 'fecha_inicio', 'fecha_fin', 'notas']
  const patch = {}
  for (const k of editables) if (req.body && k in req.body) patch[k] = req.body[k]
  patch.updated_at = new Date().toISOString()

  const { data, error } = await auth.admin
    .from('planillas').update(patch).eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, planilla: data })
}

async function borrar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: actual } = await auth.admin.from('planillas').select('estado').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'Planilla no encontrada' })
  if (actual.estado !== 'borrador') {
    return res.status(400).json({ error: 'Solo se pueden eliminar planillas en borrador' })
  }
  // Lineas y auditoria se borran en cascada por FK ON DELETE CASCADE.
  const { error } = await auth.admin.from('planillas').delete().eq('id', id)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true })
}
