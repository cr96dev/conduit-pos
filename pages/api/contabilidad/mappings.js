// pages/api/contabilidad/mappings.js
// GET  -> lista todos los mappings (con cuenta inferida)
// PUT  -> bulk update { mappings: [{clave, cuenta_id}] }

import { requireAuth, requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method === 'GET') return list(req, res)
  if (req.method === 'PUT') return upsert(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data, error } = await auth.admin
    .from('contabilidad_mappings')
    .select('clave, descripcion, cuenta_id, cuentas_contables(codigo, nombre)')
    .order('clave')
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, mappings: data })
}

async function upsert(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { mappings } = req.body || {}
  if (!Array.isArray(mappings)) return res.status(400).json({ error: 'mappings[] requerido' })

  const errores = []
  for (const m of mappings) {
    if (!m.clave) continue
    const { error } = await auth.admin
      .from('contabilidad_mappings')
      .update({ cuenta_id: m.cuenta_id || null, updated_at: new Date().toISOString(), updated_by: auth.user.id })
      .eq('clave', m.clave)
    if (error) errores.push(`${m.clave}: ${error.message}`)
  }
  if (errores.length > 0) return res.status(500).json({ ok: false, errores })
  return res.status(200).json({ ok: true })
}
