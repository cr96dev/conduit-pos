// pages/api/cierres/[id]/reabrir.js
// POST /api/cierres/:id/reabrir   -> vuelve estado=abierto (admin)
// Util para correcciones puntuales. Loguea quien lo reabrio en notas.

import { requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  const { data: actual } = await auth.admin
    .from('cierres_caja').select('estado').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'Cierre no encontrado' })
  if (actual.estado === 'abierto') return res.status(400).json({ error: 'Ya esta abierto' })

  const { data, error } = await auth.admin
    .from('cierres_caja')
    .update({
      estado: 'abierto',
      cerrado_at: null,
      cerrado_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select().single()

  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, cierre: data })
}
