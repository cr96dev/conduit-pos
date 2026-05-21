// pages/api/planillas/index.js
// GET  /api/planillas?limit=20
// POST /api/planillas    -> admin. Crea cabecera en estado borrador.

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { deducirPeriodo } from '../../../lib/planillas'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { limit = 20 } = req.query
  const { data, error } = await auth.admin
    .from('planillas').select('*')
    .order('anio', { ascending: false })
    .order('mes', { ascending: false })
    .order('quincena', { ascending: false })
    .limit(Math.min(Number(limit) || 20, 200))
  if (error) {
    console.error('[planillas.list] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, planillas: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { fecha_inicio, fecha_fin, periodo: periodoUser } = req.body || {}
  if (!fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'fecha_inicio y fecha_fin requeridos' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha_inicio) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha_fin)) {
    return res.status(400).json({ error: 'formato fecha invalido' })
  }

  const { anio, mes, quincena, periodo } = deducirPeriodo(fecha_inicio)

  const { data, error } = await auth.admin.from('planillas').insert({
    periodo: periodoUser?.trim() || periodo,
    anio, mes, quincena,
    fecha_inicio, fecha_fin,
    estado: 'borrador',
    creado_por: auth.user.id,
  }).select().single()

  if (error) {
    if (error.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe planilla para esa quincena' })
    console.error('[planillas.create] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }

  await auth.admin.from('planilla_auditoria').insert({
    planilla_id: data.id, accion: 'creada',
    usuario_id: auth.user.id, usuario_email: auth.user.email,
  })

  return res.status(201).json({ ok: true, planilla: data })
}
