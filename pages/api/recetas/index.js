// GET  /api/recetas
// POST /api/recetas   (admin) — body { loyverse_item_id?, nombre, rinde_cantidad, rinde_unidad?, merma_pct?, precio_venta?, notas?, ingredientes: [{insumo_id, cantidad, unidad?, notas?}] }

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { calcularCostoReceta, calcularMargen } from '../../../lib/recetas'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { incluir_inactivas } = req.query
  let q = auth.admin
    .from('recetas')
    .select('*, loyverse_items(item_name)')
    .order('nombre')
  if (incluir_inactivas !== '1') q = q.eq('activa', true)
  const { data, error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, recetas: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { loyverse_item_id, nombre, rinde_cantidad = 1, rinde_unidad = 'unidad',
          merma_pct = 0, precio_venta = null, notas, ingredientes = [] } = req.body || {}
  if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' })

  // Cargar costos actuales de los insumos para hacer snapshot
  const insumoIds = Array.from(new Set((ingredientes || []).map(i => i.insumo_id).filter(Boolean)))
  let insumosMap = new Map()
  if (insumoIds.length > 0) {
    const { data: insumos } = await auth.admin
      .from('insumos').select('id, nombre, unidad, costo_unitario').in('id', insumoIds)
    insumosMap = new Map((insumos || []).map(i => [i.id, i]))
  }

  const ingNorm = []
  for (const [i, raw] of (ingredientes || []).entries()) {
    if (!raw.insumo_id) return res.status(400).json({ error: `ingrediente ${i+1}: insumo_id requerido` })
    const ins = insumosMap.get(raw.insumo_id)
    if (!ins) return res.status(400).json({ error: `ingrediente ${i+1}: insumo no encontrado` })
    const cantidad = Number(raw.cantidad)
    if (!cantidad || cantidad <= 0) return res.status(400).json({ error: `ingrediente ${i+1}: cantidad debe ser > 0` })
    const costoSnap = ins.costo_unitario != null ? Number(ins.costo_unitario) : 0
    ingNorm.push({
      insumo_id: raw.insumo_id,
      cantidad,
      unidad: raw.unidad || ins.unidad,
      costo_unitario_snapshot: costoSnap,
      subtotal_costo: Number((cantidad * costoSnap).toFixed(4)),
      notas: raw.notas?.trim() || null,
      orden: i,
    })
  }

  const costoCalc = calcularCostoReceta({
    ingredientes: ingNorm, rinde_cantidad, merma_pct,
  })
  const margenPct = precio_venta != null ? calcularMargen(costoCalc, Number(precio_venta)) : null

  const { data: receta, error: rErr } = await auth.admin.from('recetas').insert({
    loyverse_item_id: loyverse_item_id || null,
    nombre: nombre.trim(),
    rinde_cantidad: Number(rinde_cantidad) || 1,
    rinde_unidad: rinde_unidad?.trim() || 'unidad',
    merma_pct: Number(merma_pct) || 0,
    precio_venta: precio_venta != null && precio_venta !== '' ? Number(precio_venta) : null,
    costo_calculado: costoCalc,
    margen_pct: margenPct,
    notas: notas?.trim() || null,
    created_by: auth.user.id,
  }).select().single()

  if (rErr) {
    if (rErr.code === '23505') return res.status(409).json({ ok: false, error: 'Ya hay una receta activa para ese producto Loyverse' })
    return res.status(500).json({ ok: false, error: rErr.message })
  }

  if (ingNorm.length > 0) {
    const rows = ingNorm.map(i => ({ ...i, receta_id: receta.id }))
    const { error: iErr } = await auth.admin.from('receta_ingredientes').insert(rows)
    if (iErr) {
      await auth.admin.from('recetas').delete().eq('id', receta.id)
      return res.status(500).json({ ok: false, error: iErr.message })
    }
  }

  return res.status(201).json({ ok: true, receta })
}
