// GET    /api/recetas/:id   detalle con ingredientes
// PATCH  /api/recetas/:id   editar (replace ingredientes si llegan)
// DELETE /api/recetas/:id   baja logica

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { calcularCostoReceta, calcularMargen } from '../../../lib/recetas'

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET')    return detalle(req, res, id)
  if (req.method === 'PATCH')  return editar(req, res, id)
  if (req.method === 'DELETE') return baja(req, res, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function detalle(req, res, id) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: receta, error } = await auth.admin
    .from('recetas').select('*, loyverse_items(item_name)').eq('id', id).single()
  if (error) return res.status(404).json({ error: 'Receta no encontrada' })

  const { data: ings } = await auth.admin
    .from('receta_ingredientes')
    .select('*, insumos(nombre, unidad, costo_unitario)')
    .eq('receta_id', id).order('orden')

  return res.status(200).json({ ok: true, receta: { ...receta, ingredientes: ings || [] } })
}

async function editar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const editables = ['loyverse_item_id', 'nombre', 'rinde_cantidad', 'rinde_unidad', 'merma_pct', 'precio_venta', 'notas', 'activa']
  const patch = {}
  for (const k of editables) if (req.body && k in req.body) patch[k] = req.body[k]

  // Si llegan ingredientes, reemplazar y recalcular costo
  if (Array.isArray(req.body?.ingredientes)) {
    const ings = req.body.ingredientes
    const insumoIds = Array.from(new Set(ings.map(i => i.insumo_id).filter(Boolean)))
    const { data: insumos } = await auth.admin
      .from('insumos').select('id, unidad, costo_unitario').in('id', insumoIds)
    const insumosMap = new Map((insumos || []).map(i => [i.id, i]))

    const ingNorm = []
    for (const [i, raw] of ings.entries()) {
      if (!raw.insumo_id) return res.status(400).json({ error: `ingrediente ${i+1}: insumo_id requerido` })
      const ins = insumosMap.get(raw.insumo_id)
      if (!ins) return res.status(400).json({ error: `ingrediente ${i+1}: insumo no encontrado` })
      const cantidad = Number(raw.cantidad)
      if (!cantidad || cantidad <= 0) return res.status(400).json({ error: `ingrediente ${i+1}: cantidad debe ser > 0` })
      const costoSnap = ins.costo_unitario != null ? Number(ins.costo_unitario) : 0
      ingNorm.push({
        receta_id: id,
        insumo_id: raw.insumo_id,
        cantidad,
        unidad: raw.unidad || ins.unidad,
        costo_unitario_snapshot: costoSnap,
        subtotal_costo: Number((cantidad * costoSnap).toFixed(4)),
        notas: raw.notas?.trim() || null,
        orden: i,
      })
    }
    await auth.admin.from('receta_ingredientes').delete().eq('receta_id', id)
    if (ingNorm.length > 0) {
      const { error: iErr } = await auth.admin.from('receta_ingredientes').insert(ingNorm)
      if (iErr) return res.status(500).json({ ok: false, error: iErr.message })
    }
  }

  // Recalcular costo y margen
  const { data: actual } = await auth.admin
    .from('recetas').select('rinde_cantidad, merma_pct, precio_venta').eq('id', id).single()
  const rindeFinal = patch.rinde_cantidad != null ? Number(patch.rinde_cantidad) : Number(actual.rinde_cantidad)
  const mermaFinal = patch.merma_pct      != null ? Number(patch.merma_pct)      : Number(actual.merma_pct)
  const precioFinal = patch.precio_venta != null ? (patch.precio_venta === '' ? null : Number(patch.precio_venta))
                                                  : actual.precio_venta != null ? Number(actual.precio_venta) : null

  const { data: ingsActuales } = await auth.admin
    .from('receta_ingredientes').select('cantidad, costo_unitario_snapshot').eq('receta_id', id)
  const costoCalc = calcularCostoReceta({
    ingredientes: ingsActuales || [], rinde_cantidad: rindeFinal, merma_pct: mermaFinal,
  })
  patch.costo_calculado = costoCalc
  patch.margen_pct = precioFinal != null ? calcularMargen(costoCalc, precioFinal) : null
  patch.updated_at = new Date().toISOString()

  const { data, error } = await auth.admin.from('recetas').update(patch).eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, receta: data })
}

async function baja(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { data, error } = await auth.admin
    .from('recetas').update({ activa: false, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, receta: data })
}
