// pages/api/igss/config.js
// GET  /api/igss/config   -> devuelve la fila de config (o null)
// PUT  /api/igss/config   -> upsert (admin)

import { requireAuth, requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method === 'GET') return get(req, res)
  if (req.method === 'PUT') return upsert(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function get(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data, error } = await auth.admin
    .from('config_igss').select('*').limit(1).maybeSingle()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, config: data })
}

async function upsert(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const {
    numero_patronal, nit_patrono, nombre_patrono,
    direccion, email_patrono, codigo_ocupacion, codigo_actividad,
  } = req.body || {}
  if (!numero_patronal || !nit_patrono || !nombre_patrono) {
    return res.status(400).json({ error: 'numero_patronal, nit_patrono y nombre_patrono requeridos' })
  }

  // Asegurar singleton: si ya hay fila, update; si no, insert.
  const { data: actual } = await auth.admin.from('config_igss').select('id').limit(1).maybeSingle()
  const payload = {
    numero_patronal: numero_patronal.trim(),
    nit_patrono: nit_patrono.trim(),
    nombre_patrono: nombre_patrono.trim(),
    direccion: direccion?.trim() || null,
    email_patrono: email_patrono?.trim() || null,
    codigo_ocupacion: Number(codigo_ocupacion) || 5018,
    codigo_actividad: codigo_actividad?.trim() || '452001',
    updated_at: new Date().toISOString(),
    updated_by: auth.user.id,
  }

  let result
  if (actual) {
    result = await auth.admin.from('config_igss').update(payload).eq('id', actual.id).select().single()
  } else {
    result = await auth.admin.from('config_igss').insert(payload).select().single()
  }

  if (result.error) return res.status(500).json({ ok: false, error: result.error.message })
  return res.status(200).json({ ok: true, config: result.data })
}
