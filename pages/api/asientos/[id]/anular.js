// pages/api/asientos/:id/anular  -> marcar como anulado (admin)
// Body: { motivo }

import { requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  const { motivo } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id requerido' })
  if (!motivo?.trim()) return res.status(400).json({ error: 'motivo requerido' })

  const { data: actual } = await auth.admin.from('asientos').select('estado').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'No encontrado' })
  if (actual.estado === 'anulado') return res.status(400).json({ error: 'Ya esta anulado' })

  const { data, error } = await auth.admin
    .from('asientos')
    .update({
      estado: 'anulado',
      anulado_at: new Date().toISOString(),
      anulado_por: auth.user.id,
      anulado_motivo: motivo.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, asiento: data })
}
