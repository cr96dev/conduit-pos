// POST /api/recetas/recalcular  (admin)
// Recorre todas las recetas activas, refresca costo_unitario_snapshot de cada
// ingrediente con el valor actual de insumos.costo_unitario, y recalcula
// costo_calculado + margen_pct. Util cuando cambian costos de insumos.

import { requireAdmin } from '../../../lib/auth'
import { calcularCostoReceta, calcularMargen } from '../../../lib/recetas'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: recetas } = await auth.admin
    .from('recetas').select('*').eq('activa', true)

  let actualizadas = 0
  for (const r of recetas || []) {
    const { data: ings } = await auth.admin
      .from('receta_ingredientes').select('id, insumo_id, cantidad, insumos(costo_unitario)').eq('receta_id', r.id)

    // Actualizar snapshot por ingrediente
    for (const ing of ings || []) {
      const costoActual = ing.insumos?.costo_unitario != null ? Number(ing.insumos.costo_unitario) : 0
      const subtotal = Number((Number(ing.cantidad) * costoActual).toFixed(4))
      await auth.admin.from('receta_ingredientes')
        .update({ costo_unitario_snapshot: costoActual, subtotal_costo: subtotal })
        .eq('id', ing.id)
    }

    // Recalcular cabecera
    const ingsActualizados = (ings || []).map(i => ({
      cantidad: i.cantidad,
      costo_unitario_snapshot: i.insumos?.costo_unitario != null ? Number(i.insumos.costo_unitario) : 0,
    }))
    const costo = calcularCostoReceta({
      ingredientes: ingsActualizados, rinde_cantidad: r.rinde_cantidad, merma_pct: r.merma_pct,
    })
    const margen = r.precio_venta ? calcularMargen(costo, Number(r.precio_venta)) : null
    await auth.admin.from('recetas')
      .update({ costo_calculado: costo, margen_pct: margen, updated_at: new Date().toISOString() })
      .eq('id', r.id)
    actualizadas++
  }

  return res.status(200).json({ ok: true, actualizadas })
}
