// pages/api/admin/categorias-barra.js
// GET   /api/admin/categorias-barra   -> lista categorias Loyverse + es_barra + image_url
// PATCH /api/admin/categorias-barra   body: { loyverse_id, es_barra?, image_url? }
//
// Cualquier campo es opcional. Si solo se pasa loyverse_id, no se modifica nada.
// Auth: admin.

import { requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (req.method === 'GET') {
    const { data, error } = await auth.admin
      .from('loyverse_categories')
      .select('loyverse_id, name, color, es_barra, image_url')
      .order('name')
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, categorias: data || [] })
  }

  if (req.method === 'PATCH') {
    const { loyverse_id, es_barra, image_url } = req.body || {}
    if (!loyverse_id) return res.status(400).json({ error: 'loyverse_id requerido' })

    const update = {}
    if (typeof es_barra === 'boolean') update.es_barra = es_barra
    if (image_url !== undefined) {
      // null = limpiar; string = setear
      update.image_url = image_url === null || image_url === '' ? null : String(image_url)
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'Nada para actualizar' })
    }

    const { data, error } = await auth.admin
      .from('loyverse_categories')
      .update(update)
      .eq('loyverse_id', loyverse_id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, categoria: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
