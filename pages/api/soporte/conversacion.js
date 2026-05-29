// pages/api/soporte/conversacion.js
// GET /api/soporte/conversacion           -> ultima conversacion abierta + mensajes
// PATCH /api/soporte/conversacion         body: { id, estado }   (cerrar/archivar)
//
// Auth: cualquier rol operativo.

import { requireAuth } from '../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (req.method === 'GET') {
    // Recuperar la conversacion mas reciente del cajero (abierta o no)
    const { data: conv } = await auth.admin
      .from('soporte_conversaciones')
      .select('*')
      .eq('cajero_id', auth.user.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!conv) {
      return res.status(200).json({ ok: true, conversacion: null, mensajes: [] })
    }
    const { data: mensajes } = await auth.admin
      .from('soporte_mensajes')
      .select('id, rol, contenido, created_at')
      .eq('conversacion_id', conv.id)
      .neq('rol', 'system')   // los system messages son internos (errores), no se muestran al cajero
      .order('created_at', { ascending: true })
      .limit(100)
    return res.status(200).json({ ok: true, conversacion: conv, mensajes: mensajes || [] })
  }

  if (req.method === 'PATCH') {
    const { id, estado, notas_admin } = req.body || {}
    if (!id) return res.status(400).json({ error: 'id requerido' })
    if (!['abierta', 'resuelta', 'escalada', 'archivada'].includes(estado)) {
      return res.status(400).json({ error: 'estado invalido' })
    }
    const update = { estado, updated_at: new Date().toISOString() }
    if (estado === 'resuelta') {
      update.resuelta_at = new Date().toISOString()
      update.resuelta_por = auth.user.id
    }
    if (typeof notas_admin === 'string') update.notas_admin = notas_admin

    const { data, error } = await auth.admin
      .from('soporte_conversaciones')
      .update(update)
      .eq('id', id)
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true, conversacion: data })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
