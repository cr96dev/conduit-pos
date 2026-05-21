// pages/api/asientos/:id/postear   -> cambiar estado a 'posteado' (admin)
// pages/api/asientos/:id/anular    -> ver anular.js

import { requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  const { data: actual } = await auth.admin
    .from('asientos').select('estado, total_debe, total_haber').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'No encontrado' })
  if (actual.estado !== 'borrador') return res.status(400).json({ error: 'Solo borradores se postean' })
  if (Number(actual.total_debe) !== Number(actual.total_haber)) {
    return res.status(400).json({ error: 'Asiento desbalanceado' })
  }

  const { data, error } = await auth.admin
    .from('asientos')
    .update({ estado: 'posteado', posteado_at: new Date().toISOString(), posteado_por: auth.user.id, updated_at: new Date().toISOString() })
    .eq('id', id).eq('estado', 'borrador')
    .select().single()
  if (error || !data) return res.status(500).json({ ok: false, error: error?.message || 'No se pudo postear' })
  return res.status(200).json({ ok: true, asiento: data })
}
