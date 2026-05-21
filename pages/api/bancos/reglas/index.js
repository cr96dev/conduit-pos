// GET  /api/bancos/reglas
// POST /api/bancos/reglas (admin)

import { requireAuth, requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const auth = await requireAuth(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { data, error } = await auth.admin
      .from('bancos_reglas_clasificacion')
      .select('*, cuentas_contables(codigo, nombre)')
      .order('prioridad').order('patron')
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true, reglas: data })
  }
  if (req.method === 'POST') {
    const auth = await requireAdmin(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
    const { patron, tipo_match, aplica_a, cuenta_id, descripcion, concepto, prioridad } = req.body || {}
    if (!patron?.trim() || !cuenta_id) return res.status(400).json({ error: 'patron y cuenta_id requeridos' })
    const { data, error } = await auth.admin.from('bancos_reglas_clasificacion').insert({
      patron: patron.trim(),
      tipo_match: tipo_match || 'contains',
      aplica_a: aplica_a || 'ambos',
      cuenta_id,
      descripcion: descripcion?.trim() || null,
      concepto: concepto?.trim() || null,
      prioridad: prioridad != null ? Number(prioridad) : 100,
      created_by: auth.user.id,
    }).select().single()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(201).json({ ok: true, regla: data })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
