// pages/api/admin/turnos/index.js
// GET /api/admin/turnos?cajero_id=&estado=&limit=
//
// Auth: admin. Listado completo de turnos con join al cajero.

import { requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100))
  const { cajero_id, estado } = req.query

  let q = auth.admin
    .from('turnos_caja')
    .select('*, cajero:perfiles(id, nombre_completo, email)')
    .order('fecha_apertura', { ascending: false })
    .limit(limit)

  if (cajero_id) q = q.eq('cajero_id', cajero_id)
  if (estado === 'abierto' || estado === 'cerrado') q = q.eq('estado', estado)

  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true, turnos: data || [] })
}
