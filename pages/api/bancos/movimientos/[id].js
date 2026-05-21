// pages/api/bancos/movimientos/[id].js
// PATCH  /api/bancos/movimientos/:id   -> conciliar o desconciliar
//   Body: { asiento_id: uuid | null, notas?: string }
// DELETE /api/bancos/movimientos/:id   -> borrar (admin)

import { requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'PATCH') {
    const { asiento_id, notas } = req.body || {}
    const patch = {}
    if ('asiento_id' in (req.body || {})) {
      patch.asiento_id = asiento_id || null
      patch.conciliado_at = asiento_id ? new Date().toISOString() : null
      patch.conciliado_by = asiento_id ? auth.user.id : null
    }
    if ('notas' in (req.body || {})) patch.conciliado_notas = notas?.trim() || null
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Sin cambios' })

    const { data, error } = await auth.admin
      .from('bancos_movimientos').update(patch).eq('id', id).select().single()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true, movimiento: data })
  }

  if (req.method === 'DELETE') {
    const { error } = await auth.admin.from('bancos_movimientos').delete().eq('id', id)
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
