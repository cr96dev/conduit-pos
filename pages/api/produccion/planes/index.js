// pages/api/produccion/planes/index.js
// GET  /api/produccion/planes?fecha=YYYY-MM-DD     -> lista planes (filtrable)
// POST /api/produccion/planes                       -> crea borrador (admin)
//   body: { fecha_produccion, notas? }

import { requireAuth, requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { fecha, desde, hasta, estado, limit = '50' } = req.query
  let q = auth.admin
    .from('planes_produccion')
    .select('id, fecha_produccion, estado, notas, ejecutado_at, created_at, updated_at')
    .order('fecha_produccion', { ascending: false })
    .order('updated_at',       { ascending: false })
    .limit(Math.min(parseInt(limit, 10) || 50, 200))

  if (fecha)  q = q.eq('fecha_produccion', fecha)
  if (desde)  q = q.gte('fecha_produccion', desde)
  if (hasta)  q = q.lte('fecha_produccion', hasta)
  if (estado) q = q.eq('estado', estado)

  const { data, error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })

  // Si filtran por fecha sin id, agregar cantidad de lineas para vista de lista.
  let counts = {}
  if ((data || []).length > 0) {
    const ids = data.map(p => p.id)
    const { data: lineas } = await auth.admin
      .from('planes_produccion_lineas')
      .select('plan_id')
      .in('plan_id', ids)
    for (const l of lineas || []) counts[l.plan_id] = (counts[l.plan_id] || 0) + 1
  }
  const planes = (data || []).map(p => ({ ...p, lineas_count: counts[p.id] || 0 }))

  return res.status(200).json({ ok: true, planes })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { fecha_produccion, notas } = req.body || {}
  if (!fecha_produccion || !/^\d{4}-\d{2}-\d{2}$/.test(fecha_produccion)) {
    return res.status(400).json({ error: 'fecha_produccion (YYYY-MM-DD) requerida' })
  }

  const { data, error } = await auth.admin
    .from('planes_produccion')
    .insert({
      fecha_produccion,
      estado: 'borrador',
      notas: notas?.trim() || null,
      created_by: auth.user.id,
      updated_by: auth.user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('[produccion.planes.create] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }

  return res.status(201).json({ ok: true, plan: data })
}
