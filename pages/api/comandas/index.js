// pages/api/comandas/index.js
// GET /api/comandas/?incluir_cerradas=0  -> lista comandas (default: solo abiertas)
//
// Auth: admin | cajero | barista. Las RLS ya filtran adecuadamente.

import { requireAuth } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { rol } = auth.perfil
  if (!['admin', 'cajero', 'barista'].includes(rol)) {
    return res.status(403).json({ error: 'Requiere rol operativo' })
  }

  const incluirCerradas = req.query.incluir_cerradas === '1'
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100))

  let q = auth.admin
    .from('comandas')
    .select('*, cajero:perfiles!comandas_cajero_id_fkey(id, nombre_completo)')
    .order('fecha_creacion', { ascending: true })
    .limit(limit)

  if (!incluirCerradas) {
    q = q.in('estado', ['pendiente', 'preparando', 'lista'])
  }

  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ ok: true, comandas: data || [] })
}
