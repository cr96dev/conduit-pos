// pages/api/igss/declaraciones/[id].js
// GET    /api/igss/declaraciones/:id          -> incluye archivo_txt
// PATCH  /api/igss/declaraciones/:id          -> editar pagada_at, comprobante, notas
// DELETE /api/igss/declaraciones/:id

import { requireAuth, requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET')    return get(req, res, id)
  if (req.method === 'PATCH')  return update(req, res, id)
  if (req.method === 'DELETE') return borrar(req, res, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function get(req, res, id) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { data, error } = await auth.admin
    .from('igss_declaraciones').select('*').eq('id', id).single()
  if (error) return res.status(404).json({ error: 'No encontrada' })
  return res.status(200).json({ ok: true, declaracion: data })
}

async function update(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const editables = ['pagada_at', 'comprobante_pago_numero', 'notas']
  const patch = {}
  for (const k of editables) if (req.body && k in req.body) patch[k] = req.body[k]
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Sin cambios' })

  const { data, error } = await auth.admin
    .from('igss_declaraciones').update(patch).eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, declaracion: data })
}

async function borrar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { error } = await auth.admin.from('igss_declaraciones').delete().eq('id', id)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true })
}
