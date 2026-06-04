// pages/api/cotizaciones/[id].js
//
// GET    /api/cotizaciones/[id]   detalle completo
// PATCH  /api/cotizaciones/[id]   cambiar estado o editar campos
// DELETE /api/cotizaciones/[id]   borrar (solo si estado='borrador')

import { requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET') {
    const { data, error } = await auth.admin
      .from('cotizaciones').select('*').eq('id', id).single()
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'No encontrada' })
      return res.status(500).json({ error: error.message })
    }
    return res.status(200).json({ ok: true, cotizacion: data })
  }

  if (req.method === 'PATCH') {
    const patch = {}
    const b = req.body || {}
    if (b.estado && ['borrador','enviada','aceptada','rechazada','vencida'].includes(b.estado)) {
      patch.estado = b.estado
    }
    if (b.notas !== undefined) patch.notas = b.notas?.trim().slice(0, 2000) || null
    patch.updated_at = new Date().toISOString()

    const { data, error } = await auth.admin
      .from('cotizaciones').update(patch).eq('id', id).select().single()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true, cotizacion: data })
  }

  if (req.method === 'DELETE') {
    const { data: existente } = await auth.admin
      .from('cotizaciones').select('estado').eq('id', id).single()
    if (existente?.estado && existente.estado !== 'borrador') {
      return res.status(409).json({ error: 'Solo se puede borrar cotizaciones en borrador. Cambiá el estado a "rechazada" si querés cerrarla.' })
    }
    const { error } = await auth.admin.from('cotizaciones').delete().eq('id', id)
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
