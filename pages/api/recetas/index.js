// GET  /api/recetas
// POST /api/recetas   (admin)
//   body { ..., ingredientes: [{ insumo_id?, sub_receta_id?, cantidad, unidad?, notas? }] }

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { recalcularUnaReceta, validarSinCiclos, calcularMargen } from '../../../lib/recetas'

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
          merma_pct = 0, precio_venta = null, costo_personalizado = null,
          peso_unitario_g = null, tipo = 'comida',
          notas, ingredientes = [] } = req.body || {}
  if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' })
  if (!['comida', 'bebida'].includes(tipo)) {
    return res.status(400).json({ error: "tipo invalido (debe ser 'comida' o 'bebida')" })
  }

  // Validar cada ingrediente: exactamente UNO de insumo_id o sub_receta_id
  for (const [i, raw] of (ingredientes || []).entries()) {
    if ((raw.insumo_id && raw.sub_receta_id) || (!raw.insumo_id && !raw.sub_receta_id)) {
      return res.status(400).json({ error: `ingrediente ${i+1}: especificar insumo_id O sub_receta_id (no ambos)` })
    }
    if (!Number(raw.cantidad) || Number(raw.cantidad) <= 0) {
      return res.status(400).json({ error: `ingrediente ${i+1}: cantidad debe ser > 0` })
    }
  }

  // Cargar costos snapshot (insumos + sub-recetas)
  const insumoIds = Array.from(new Set(ingredientes.filter(i => i.insumo_id).map(i => i.insumo_id)))
  const subIds = Array.from(new Set(ingredientes.filter(i => i.sub_receta_id).map(i => i.sub_receta_id)))

  const insumosMap = new Map()
  if (insumoIds.length) {
    const { data: ins } = await auth.admin.from('insumos').select('id, unidad, costo_unitario').in('id', insumoIds)
    for (const x of ins || []) insumosMap.set(x.id, x)
  }
  const subsMap = new Map()
  if (subIds.length) {
    const { data: subs } = await auth.admin.from('recetas')
      .select('id, rinde_cantidad, costo_calculado, rinde_unidad').in('id', subIds)
    for (const x of subs || []) subsMap.set(x.id, x)
  }

  const ingNorm = []
  let totalCosto = 0
  for (const [i, raw] of ingredientes.entries()) {
    const cantidad = Number(raw.cantidad)
    let snap, unidad, subtotal
    if (raw.insumo_id) {
      const ins = insumosMap.get(raw.insumo_id)
      if (!ins) return res.status(400).json({ error: `ingrediente ${i+1}: insumo no encontrado` })
      snap = ins.costo_unitario != null ? Number(ins.costo_unitario) : 0
      unidad = raw.unidad || ins.unidad
      subtotal = Number((cantidad * snap).toFixed(4))
    } else {
      const sub = subsMap.get(raw.sub_receta_id)
      if (!sub) return res.status(400).json({ error: `ingrediente ${i+1}: sub-receta no encontrada` })
      // costo_calculado YA es por unidad del rinde — snapshot directo
      snap = Number((Number(sub.costo_calculado) || 0).toFixed(4))
      unidad = raw.unidad || sub.rinde_unidad
      subtotal = Number((cantidad * snap).toFixed(4))
    }
    totalCosto += subtotal
    ingNorm.push({
      insumo_id: raw.insumo_id || null,
      sub_receta_id: raw.sub_receta_id || null,
      cantidad, unidad,
      costo_unitario_snapshot: snap,
      subtotal_costo: subtotal,
      notas: raw.notas?.trim() || null,
      orden: i,
    })
  }

  const rinde = Math.max(Number(rinde_cantidad) || 1, 0.0001)
  const merma = (Number(merma_pct) || 0) / 100
  const costoCalc = Number(((totalCosto / rinde) * (1 + merma)).toFixed(4))
  const costoPers = costo_personalizado != null && costo_personalizado !== '' ? Number(costo_personalizado) : null
  // margen se calcula sobre el costo efectivo (personalizado si existe, sino calculado).
  // calcularMargen descuenta IVA internamente — recibe el precio TAL COMO SE VENDE.
  const costoEfec = costoPers != null ? costoPers : costoCalc
  const margenPct = (precio_venta != null && precio_venta !== '')
    ? calcularMargen(costoEfec, Number(precio_venta))
    : null

  const { data: receta, error: rErr } = await auth.admin.from('recetas').insert({
    loyverse_item_id: loyverse_item_id || null,
    nombre: nombre.trim(),
    rinde_cantidad: rinde,
    rinde_unidad: rinde_unidad?.trim() || 'unidad',
    merma_pct: Number(merma_pct) || 0,
    precio_venta: precio_venta != null && precio_venta !== '' ? Number(precio_venta) : null,
    costo_calculado: costoCalc,
    costo_personalizado: costoPers,
    margen_pct: margenPct,
    peso_unitario_g: peso_unitario_g != null && peso_unitario_g !== '' ? Number(peso_unitario_g) : null,
    tipo,
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
