// pages/api/bancos/cuentas/index.js
// GET  /api/bancos/cuentas
// POST /api/bancos/cuentas    (admin)

import { requireAuth, requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { incluir_inactivas } = req.query
  let q = auth.admin
    .from('bancos_cuentas')
    .select('*, cuentas_contables(codigo, nombre)')
    .order('alias')
  if (incluir_inactivas !== '1') q = q.eq('activo', true)
  const { data, error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, cuentas: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const {
    banco, alias, numero_cuenta, tipo, moneda,
    cuenta_contable_id, saldo_inicial, fecha_saldo_inicial, notas,
  } = req.body || {}
  if (!banco?.trim() || !alias?.trim()) return res.status(400).json({ error: 'banco y alias requeridos' })

  const { data, error } = await auth.admin.from('bancos_cuentas').insert({
    banco: banco.trim(),
    alias: alias.trim(),
    numero_cuenta: numero_cuenta?.trim() || null,
    tipo: tipo || 'monetaria',
    moneda: moneda || 'GTQ',
    cuenta_contable_id: cuenta_contable_id || null,
    saldo_inicial: Number(saldo_inicial) || 0,
    fecha_saldo_inicial: fecha_saldo_inicial || null,
    notas: notas?.trim() || null,
  }).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(201).json({ ok: true, cuenta: data })
}
