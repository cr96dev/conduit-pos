// pages/api/cuentas/[id].js
// PATCH  /api/cuentas/:id  -> admin
// DELETE /api/cuentas/:id  -> baja logica (no se borra si tiene partidas)

import { requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'PATCH')  return update(req, res, auth, id)
  if (req.method === 'DELETE') return baja(req, res, auth, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function update(req, res, auth, id) {
  const editables = ['nombre', 'tipo', 'naturaleza', 'es_movimiento', 'notas', 'activo']
  const patch = {}
  for (const k of editables) if (req.body && k in req.body) patch[k] = req.body[k]
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Sin cambios' })
  patch.updated_at = new Date().toISOString()
  const { data, error } = await auth.admin
    .from('cuentas_contables').update(patch).eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, cuenta: data })
}

async function baja(req, res, auth, id) {
  const { data, error } = await auth.admin
    .from('cuentas_contables').update({ activo: false, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, cuenta: data })
}
