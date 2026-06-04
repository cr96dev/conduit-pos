// pages/api/productos/index.js
//
// POST /api/productos
//   Crea un producto nuevo en loyverse_items (gestionado manualmente,
//   desde que paramos el sync con Loyverse el 2026-06-05).
//   Body: { item_name, category_id?, precio, image_url?, track_stock? }
//   Genera loyverse_id como UUID con prefijo 'manual-' para distinguir
//   de los importados de Loyverse.

import { requireAdmin } from '../../../lib/auth'
import crypto from 'crypto'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { item_name, category_id, precio, image_url, track_stock } = req.body || {}
  if (!item_name?.trim()) return res.status(400).json({ error: 'item_name requerido' })
  const precioNum = Number(precio)
  if (!(precioNum >= 0)) return res.status(400).json({ error: 'precio inválido' })

  // ID determinístico tipo UUID v4. Lo prefijamos 'manual-' para identificar
  // a futuro que NO viene de Loyverse (por si reactivamos el sync algún día).
  const loyverseId = 'manual-' + crypto.randomUUID()
  const variantId  = 'manual-' + crypto.randomUUID()
  const storeId    = '1f881eaf-080a-4ff1-9ce6-eaa0d7c1c6d0'  // store_id que usa todo el catálogo actual

  // Estructura compatible con loyverse_items.variants — el resto del código
  // (POS, pickup, recetas) ya lee este shape, así no hay que tocar nada más.
  const variant = {
    sku: '',
    cost: 0,
    stores: [{
      price: precioNum,
      store_id: storeId,
      low_stock: 0,
      pricing_type: 'FIXED',
      optimal_stock: null,
      available_for_sale: true,
    }],
    barcode: null,
    item_id: loyverseId,
    created_at: new Date().toISOString(),
    deleted_at: null,
    updated_at: new Date().toISOString(),
    variant_id: variantId,
    default_price: precioNum,
    option1_value: null,
    option2_value: null,
    option3_value: null,
    purchase_cost: null,
    default_pricing_type: 'FIXED',
    reference_variant_id: null,
  }

  const { data, error } = await auth.admin.from('loyverse_items').insert({
    loyverse_id: loyverseId,
    item_name: item_name.trim().slice(0, 200),
    category_id: category_id || null,
    track_stock: !!track_stock,
    variants: [variant],
    image_url: image_url?.trim() || null,
  }).select().single()

  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, producto: data })
}
