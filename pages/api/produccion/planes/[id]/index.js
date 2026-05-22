// pages/api/produccion/planes/[id]/index.js
// GET    /api/produccion/planes/[id]   -> cabecera + lineas + explosion BOM contra stock actual
// PATCH  /api/produccion/planes/[id]   -> editar (notas, fecha; solo en borrador)
// DELETE /api/produccion/planes/[id]   -> borrar (solo en borrador)

import { requireAuth, requireAdmin } from '../../../../../lib/auth'
import { explotarPlan } from '../../../../../lib/produccion'

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET')    return detalle(req, res, id)
  if (req.method === 'PATCH')  return editar(req, res, id)
  if (req.method === 'DELETE') return borrar(req, res, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function detalle(req, res, id) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: plan, error: pErr } = await auth.admin
    .from('planes_produccion')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (pErr) return res.status(500).json({ error: pErr.message })
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' })

  const { data: lineas, error: lErr } = await auth.admin
    .from('planes_produccion_lineas')
    .select('id, receta_id, cantidad, notas, orden, recetas(id, nombre, rinde_unidad, rinde_cantidad, merma_pct, costo_calculado, costo_personalizado, loyverse_item_id, activa)')
    .eq('plan_id', id)
    .order('orden')
  if (lErr) return res.status(500).json({ error: lErr.message })

  // Explosion contra stock actual (siempre fresco).
  let explosion = null
  try {
    explosion = await explotarPlan(
      auth.admin,
      (lineas || []).map(l => ({ receta_id: l.receta_id, cantidad: Number(l.cantidad) })),
    )
  } catch (e) {
    console.error('[produccion.planes.detalle] explotarPlan ERROR:', e.message)
    return res.status(500).json({ ok: false, error: 'Error al expandir BOM: ' + e.message })
  }

  return res.status(200).json({
    ok: true,
    plan,
    lineas: lineas || [],
    ...explosion,   // requerimientos, lineas_resueltas, resumen
  })
}

async function editar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: plan } = await auth.admin
    .from('planes_produccion').select('id, estado').eq('id', id).maybeSingle()
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' })
  if (plan.estado !== 'borrador') {
    return res.status(409).json({ error: `Plan en estado '${plan.estado}', no editable.` })
  }

  const patch = { updated_by: auth.user.id }
  if ('notas' in req.body) patch.notas = req.body.notas?.trim() || null
  if ('fecha_produccion' in req.body) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.fecha_produccion)) {
      return res.status(400).json({ error: 'fecha_produccion invalida' })
    }
    patch.fecha_produccion = req.body.fecha_produccion
  }
  if ('estado' in req.body) {
    // Solo permitimos pasar a 'cancelado' (la ejecucion va por endpoint dedicado).
    if (req.body.estado !== 'cancelado') {
      return res.status(400).json({ error: 'estado solo se puede cambiar a "cancelado" desde aca (usar /ejecutar para ejecucion)' })
    }
    patch.estado = 'cancelado'
  }

  const { data, error } = await auth.admin
    .from('planes_produccion')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, plan: data })
}

async function borrar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: plan } = await auth.admin
    .from('planes_produccion').select('id, estado').eq('id', id).maybeSingle()
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' })
  if (plan.estado !== 'borrador') {
    return res.status(409).json({ error: `Plan en estado '${plan.estado}' no se borra. Cancelalo en su lugar.` })
  }

  const { error } = await auth.admin.from('planes_produccion').delete().eq('id', id)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true })
}
