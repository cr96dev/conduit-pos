// GET    /api/recetas/:id   detalle con ingredientes (insumos y sub-recetas resueltos)
// PATCH  /api/recetas/:id   editar
// DELETE /api/recetas/:id   baja logica (no se puede si otra receta la usa como sub-receta)

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { recalcularUnaReceta, validarSinCiclos } from '../../../lib/recetas'

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
    .select('*, insumos(nombre, unidad, costo_unitario), recetas:sub_receta_id(nombre, rinde_cantidad, rinde_unidad, costo_calculado)')
    .eq('receta_id', id).order('orden')

  return res.status(200).json({ ok: true, receta: { ...receta, ingredientes: ings || [] } })
}

async function editar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const editables = ['loyverse_item_id', 'nombre', 'rinde_cantidad', 'rinde_unidad', 'merma_pct', 'precio_venta', 'costo_personalizado', 'peso_unitario_g', 'notas', 'activa']
  const patch = {}
  for (const k of editables) {
    if (!req.body || !(k in req.body)) continue
    let v = req.body[k]
    // Normalizar numericos opcionales que pueden venir como '' desde el form.
    if ((k === 'precio_venta' || k === 'costo_personalizado' || k === 'peso_unitario_g') && v === '') v = null
    patch[k] = v
  }
  if ('costo_personalizado' in patch) {
    patch.costo_personalizado = patch.costo_personalizado === '' || patch.costo_personalizado == null
      ? null : Number(patch.costo_personalizado)
  }

  if (Array.isArray(req.body?.ingredientes)) {
    const ings = req.body.ingredientes

    // Validar shape: insumo_id XOR sub_receta_id
    for (const [i, raw] of ings.entries()) {
      if ((raw.insumo_id && raw.sub_receta_id) || (!raw.insumo_id && !raw.sub_receta_id)) {
        return res.status(400).json({ error: `ingrediente ${i+1}: especificar insumo_id O sub_receta_id` })
      }
      if (!Number(raw.cantidad) || Number(raw.cantidad) <= 0) {
        return res.status(400).json({ error: `ingrediente ${i+1}: cantidad debe ser > 0` })
      }
    }

    // Validar sin ciclos (las sub-recetas que se quieren agregar no deben llegar a esta receta)
    const nuevasSubs = ings.filter(i => i.sub_receta_id).map(i => i.sub_receta_id)
    try {
      await validarSinCiclos(auth.admin, id, nuevasSubs)
    } catch (e) {
      return res.status(400).json({ error: e.message })
    }

    // Resolver snapshots
    const insumoIds = Array.from(new Set(ings.filter(i => i.insumo_id).map(i => i.insumo_id)))
    const subIds = Array.from(new Set(ings.filter(i => i.sub_receta_id).map(i => i.sub_receta_id)))
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
    for (const [i, raw] of ings.entries()) {
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
      ingNorm.push({
        receta_id: id,
        insumo_id: raw.insumo_id || null,
        sub_receta_id: raw.sub_receta_id || null,
        cantidad, unidad,
        costo_unitario_snapshot: snap,
        subtotal_costo: subtotal,
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

  patch.updated_at = new Date().toISOString()
  const { error } = await auth.admin.from('recetas').update(patch).eq('id', id)
  if (error) return res.status(500).json({ ok: false, error: error.message })

  // Recalcular esta receta (y sus padres si esta es usada como sub-receta)
  const nuevoCosto = await recalcularUnaReceta(auth.admin, id)

  // Padres: cualquier receta que use esta como sub-receta debe recalcularse
  const { data: padresRows } = await auth.admin
    .from('receta_ingredientes').select('receta_id').eq('sub_receta_id', id)
  const padres = Array.from(new Set((padresRows || []).map(r => r.receta_id)))
  for (const padre of padres) await recalcularUnaReceta(auth.admin, padre)

  const { data: actualizada } = await auth.admin.from('recetas').select('*').eq('id', id).single()
  return res.status(200).json({ ok: true, receta: actualizada, recalculadas_padres: padres.length })
}

async function baja(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  // No permitir baja si otra receta la usa como sub-receta
  const { data: usos } = await auth.admin
    .from('receta_ingredientes').select('receta_id, recetas!receta_id(nombre)').eq('sub_receta_id', id).limit(5)
  if (usos && usos.length > 0) {
    const nombres = usos.map(u => u.recetas?.nombre).filter(Boolean).join(', ')
    return res.status(400).json({ error: `Esta receta es usada como sub-receta en: ${nombres}. Quitala de esas recetas primero.` })
  }

  const { data, error } = await auth.admin
    .from('recetas').update({ activa: false, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, receta: data })
}
