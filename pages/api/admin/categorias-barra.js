// pages/api/admin/categorias-barra.js
// GET  /api/admin/categorias-barra            -> lista categorias Loyverse + flag es_barra
// PATCH /api/admin/categorias-barra            body: { loyverse_id, es_barra }
//
// Auth: admin.

import { requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (req.method === 'GET') {
    const { data, error } = await auth.admin
      .from('loyverse_categories')
      .select('loyverse_id, name, color, es_barra')
      .order('name')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, categorias: data || [] })
  }

  if (req.method === 'PATCH') {
    const { loyverse_id, es_barra } = req.body || {}
    if (!loyverse_id) return res.status(400).json({ error: 'loyverse_id requerido' })
    if (typeof es_barra !== 'boolean') return res.status(400).json({ error: 'es_barra debe ser boolean' })

    const { data, error } = await auth.admin
      .from('loyverse_categories')
      .update({ es_barra })
      .eq('loyverse_id', loyverse_id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, categoria: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
