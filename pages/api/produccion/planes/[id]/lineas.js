// pages/api/produccion/planes/[id]/lineas.js
// PUT /api/produccion/planes/[id]/lineas
//   body: { lineas: [{ receta_id, cantidad, notas? }, ...] }
// Reemplaza el set completo de lineas. Solo si el plan esta en estado 'borrador'.
// La validacion de receta_id vs existencia se hace contra recetas activas.
// El orden se asigna por la posicion en el array recibido.

import { requireAdmin } from '../../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' })
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { lineas } = req.body || {}
  if (!Array.isArray(lineas)) return res.status(400).json({ error: 'lineas[] requerido' })

  const { data: plan } = await auth.admin
    .from('planes_produccion').select('id, estado').eq('id', id).maybeSingle()
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' })
  if (plan.estado !== 'borrador') {
    return res.status(409).json({ error: `Plan en estado '${plan.estado}', lineas no editables.` })
  }

  // Validar y deduplicar por receta_id (la tabla tiene UNIQUE(plan_id, receta_id)).
  const seen = new Set()
  const norm = []
  for (const [i, raw] of lineas.entries()) {
    if (!raw.receta_id) return res.status(400).json({ error: `linea ${i+1}: receta_id requerido` })
    const cant = Number(raw.cantidad)
    if (!Number.isFinite(cant) || cant <= 0) {
      return res.status(400).json({ error: `linea ${i+1}: cantidad debe ser > 0` })
    }
    if (seen.has(raw.receta_id)) return res.status(400).json({ error: `linea ${i+1}: receta_id duplicado` })
    seen.add(raw.receta_id)
    norm.push({
      plan_id: id,
      receta_id: raw.receta_id,
      cantidad: cant,
      notas: raw.notas?.trim() || null,
      orden: i,
    })
  }

  // Validar que las recetas existen y estan activas.
  if (norm.length > 0) {
    const ids = norm.map(l => l.receta_id)
    const { data: recetas } = await auth.admin
      .from('recetas').select('id, activa').in('id', ids)
    const mapa = new Map((recetas || []).map(r => [r.id, r]))
    for (const l of norm) {
      const r = mapa.get(l.receta_id)
      if (!r)       return res.status(400).json({ error: `receta ${l.receta_id} no existe` })
      if (!r.activa) return res.status(400).json({ error: `receta ${l.receta_id} esta inactiva` })
    }
  }

  // Reemplazo: borrar todo y volver a insertar.
  const { error: dErr } = await auth.admin
    .from('planes_produccion_lineas').delete().eq('plan_id', id)
  if (dErr) return res.status(500).json({ ok: false, error: dErr.message })

  if (norm.length > 0) {
    const { error: iErr } = await auth.admin
      .from('planes_produccion_lineas').insert(norm)
    if (iErr) return res.status(500).json({ ok: false, error: iErr.message })
  }

  // Touch del plan.
  await auth.admin.from('planes_produccion')
    .update({ updated_by: auth.user.id, updated_at: new Date().toISOString() })
    .eq('id', id)

  return res.status(200).json({ ok: true, lineas_count: norm.length })
}
