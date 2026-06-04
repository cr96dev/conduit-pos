// pages/api/productos/[id].js
//
// PATCH /api/productos/[id]   editar nombre, categoría, precio, imagen
// DELETE /api/productos/[id]  soft delete (setea deleted_at)
//
// id = loyverse_id (puede ser manual-xxx para los creados desde acá,
// o uuid puro para los heredados de Loyverse).

import { requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id requerido' })

  // Cargar el producto actual para mantener el shape de variants
  const { data: actual, error: errLoad } = await auth.admin
    .from('loyverse_items')
    .select('loyverse_id, item_name, category_id, track_stock, variants, image_url')
    .eq('loyverse_id', id)
    .single()
  if (errLoad || !actual) return res.status(404).json({ error: 'Producto no encontrado' })

  if (req.method === 'PATCH') {
    const b = req.body || {}
    const patch = { updated_at: new Date().toISOString() }

    if (b.item_name !== undefined) {
      if (!b.item_name?.trim()) return res.status(400).json({ error: 'item_name no puede estar vacío' })
      patch.item_name = b.item_name.trim().slice(0, 200)
    }
    if (b.category_id !== undefined) patch.category_id = b.category_id || null
    if (b.image_url !== undefined)   patch.image_url   = b.image_url?.trim() || null
    if (b.track_stock !== undefined) patch.track_stock = !!b.track_stock

    // Cambio de precio: actualiza la primera variante (variants[0].stores[0].price
    // y variants[0].default_price). El resto del código siempre lee la primera
    // variante; si en el futuro soportamos multi-variante hay que ajustar acá.
    if (b.precio !== undefined) {
      const precioNum = Number(b.precio)
      if (!(precioNum >= 0)) return res.status(400).json({ error: 'precio inválido' })

      const variantsNuevas = JSON.parse(JSON.stringify(actual.variants || []))
      if (variantsNuevas.length === 0) {
        return res.status(400).json({ error: 'Producto sin variantes — usá crear nuevo' })
      }
      const v = variantsNuevas[0]
      v.default_price = precioNum
      if (Array.isArray(v.stores) && v.stores.length > 0) {
        v.stores[0].price = precioNum
      } else {
        v.stores = [{ price: precioNum, store_id: '1f881eaf-080a-4ff1-9ce6-eaa0d7c1c6d0', pricing_type: 'FIXED', available_for_sale: true }]
      }
      v.updated_at = new Date().toISOString()
      patch.variants = variantsNuevas
    }

    const { data, error } = await auth.admin
      .from('loyverse_items').update(patch).eq('loyverse_id', id).select().single()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true, producto: data })
  }

  if (req.method === 'DELETE') {
    // Soft delete: setea deleted_at. El catálogo en POS/PWA lo filtra con
    // `deleted_at IS NULL`.
    const { error } = await auth.admin
      .from('loyverse_items').update({ deleted_at: new Date().toISOString() }).eq('loyverse_id', id)
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
