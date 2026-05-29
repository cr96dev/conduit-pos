// pages/api/admin/soporte.js
// GET /api/admin/soporte                       -> lista conversaciones
// GET /api/admin/soporte?id=<conversacion_id>  -> conversacion + todos los mensajes (incluido system errors)
//
// Auth: admin.

import { requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query

  if (id) {
    const { data: conv, error } = await auth.admin
      .from('soporte_conversaciones')
      .select('*, cajero:perfiles!soporte_conversaciones_cajero_id_fkey(id, nombre_completo, email, rol)')
      .eq('id', id)
      .single()
    if (error) return res.status(404).json({ error: error.message })

    const { data: mensajes } = await auth.admin
      .from('soporte_mensajes')
      .select('*')
      .eq('conversacion_id', id)
      .order('created_at', { ascending: true })

    return res.status(200).json({ ok: true, conversacion: conv, mensajes: mensajes || [] })
  }

  // Lista de conversaciones (recientes primero)
  const estado = req.query.estado  // filtro opcional
  let q = auth.admin
    .from('soporte_conversaciones')
    .select('id, asunto, estado, created_at, updated_at, cajero:perfiles!soporte_conversaciones_cajero_id_fkey(id, nombre_completo, rol)')
    .order('updated_at', { ascending: false })
    .limit(100)
  if (estado) q = q.eq('estado', estado)

  const { data: lista, error: listaErr } = await q
  if (listaErr) return res.status(500).json({ error: listaErr.message })

  // Conteo de mensajes por conversacion
  const ids = (lista || []).map(c => c.id)
  let conteos = {}
  if (ids.length > 0) {
    const { data: msgs } = await auth.admin
      .from('soporte_mensajes')
      .select('conversacion_id')
      .in('conversacion_id', ids)
    for (const m of msgs || []) {
      conteos[m.conversacion_id] = (conteos[m.conversacion_id] || 0) + 1
    }
  }
  const enriquecidas = (lista || []).map(c => ({ ...c, num_mensajes: conteos[c.id] || 0 }))

  return res.status(200).json({ ok: true, conversaciones: enriquecidas })
}
