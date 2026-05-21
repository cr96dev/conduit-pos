// pages/api/cuentas/index.js
// GET  /api/cuentas?incluir_inactivas=1
// POST /api/cuentas    (admin)

import { requireAuth, requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { incluir_inactivas } = req.query
  let q = auth.admin.from('cuentas_contables').select('*').order('codigo')
  if (incluir_inactivas !== '1') q = q.eq('activo', true)
  const { data, error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, cuentas: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { codigo, nombre, tipo, naturaleza, cuenta_padre_id, es_movimiento, notas } = req.body || {}
  if (!codigo?.trim() || !nombre?.trim()) return res.status(400).json({ error: 'codigo y nombre requeridos' })
  if (!['activo','pasivo','patrimonio','ingreso','costo','gasto'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido' })
  }
  if (!['deudora','acreedora'].includes(naturaleza)) {
    return res.status(400).json({ error: 'naturaleza invalida' })
  }

  // nivel = numero de segmentos separados por '-'
  const nivel = codigo.split('-').length

  const { data, error } = await auth.admin.from('cuentas_contables').insert({
    codigo: codigo.trim(),
    nombre: nombre.trim(),
    tipo,
    naturaleza,
    cuenta_padre_id: cuenta_padre_id || null,
    nivel,
    es_movimiento: !!es_movimiento,
    notas: notas?.trim() || null,
  }).select().single()

  if (error) {
    if (error.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe una cuenta con ese codigo' })
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(201).json({ ok: true, cuenta: data })
}
