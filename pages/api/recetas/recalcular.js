// POST /api/recetas/recalcular  (admin)
// Recorre todas las recetas activas en orden topologico (hojas primero) y
// recalcula costos. Maneja sub-recetas correctamente.

import { requireAdmin } from '../../../lib/auth'
import { recalcularTodas } from '../../../lib/recetas'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  try {
    const result = await recalcularTodas(auth.admin)
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    console.error('[recetas.recalcular] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
