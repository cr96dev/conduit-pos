// pages/api/turnos/mis-turnos.js
// GET /api/turnos/mis-turnos?limit=50
//
// Auth: cajero. Devuelve el historial propio (mas reciente primero).

import { requireAuth } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))

  const { data, error } = await auth.admin
    .from('turnos_caja')
    .select('*')
    .eq('cajero_id', auth.user.id)
    .order('fecha_apertura', { ascending: false })
    .limit(limit)

  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true, turnos: data || [] })
}
