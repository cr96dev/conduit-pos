// pages/api/bancos/cuentas/[id].js
// PATCH  -> editar
// DELETE -> baja logica

import { requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'PATCH') {
    const editables = ['banco','alias','numero_cuenta','tipo','moneda','cuenta_contable_id','saldo_inicial','fecha_saldo_inicial','notas','activo']
    const patch = {}
    for (const k of editables) if (req.body && k in req.body) patch[k] = req.body[k]
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Sin cambios' })
    patch.updated_at = new Date().toISOString()
    const { data, error } = await auth.admin.from('bancos_cuentas').update(patch).eq('id', id).select().single()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true, cuenta: data })
  }
  if (req.method === 'DELETE') {
    const { data, error } = await auth.admin.from('bancos_cuentas')
      .update({ activo: false, updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true, cuenta: data })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
