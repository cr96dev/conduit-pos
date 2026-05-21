// pages/api/cierres/index.js
// GET  /api/cierres?desde=...&hasta=...   -> lista (cualquiera autenticado)
// POST /api/cierres                       -> crea cierre abierto para fecha (admin)
//
// Body POST:
// { fecha, saldo_inicial?, conteo_efectivo?, notas?, egresos?: [{concepto, monto}] }
//
// La API calcula las ventas del dia desde Loyverse y rellena el resto.

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { calcularVentasDelDia } from '../../../lib/cierres'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { desde, hasta, limit = 60 } = req.query
  let q = auth.admin
    .from('cierres_caja')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(Math.min(Number(limit) || 60, 365))

  if (desde) q = q.gte('fecha', desde)
  if (hasta) q = q.lte('fecha', hasta)

  const { data, error } = await q
  if (error) {
    console.error('[cierres.list] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, cierres: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { fecha, saldo_inicial = 0, conteo_efectivo = null, notas, egresos = [] } = req.body || {}
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha (YYYY-MM-DD) requerida' })
  }

  // Validar egresos
  for (const [i, e] of egresos.entries()) {
    if (!e.concepto?.trim() || !(Number(e.monto) > 0)) {
      return res.status(400).json({ error: `egreso ${i + 1}: concepto y monto > 0 requeridos` })
    }
  }

  // Calcular ventas Loyverse
  let ventas
  try {
    ventas = await calcularVentasDelDia(auth.admin, fecha)
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message })
  }

  const egresos_total = round2(egresos.reduce((s, e) => s + Number(e.monto || 0), 0))
  const si = Number(saldo_inicial) || 0
  const saldo_esperado = round2(si + ventas.ventas_efectivo - egresos_total)
  const ce = conteo_efectivo != null && conteo_efectivo !== '' ? Number(conteo_efectivo) : null
  const diferencia = ce != null ? round2(ce - saldo_esperado) : null

  const { data: cierre, error: cErr } = await auth.admin
    .from('cierres_caja')
    .insert({
      fecha,
      saldo_inicial: si,
      conteo_efectivo: ce,
      ventas_efectivo: ventas.ventas_efectivo,
      ventas_tarjeta: ventas.ventas_tarjeta,
      ventas_otros: ventas.ventas_otros,
      ventas_total: ventas.ventas_total,
      cantidad_recibos: ventas.cantidad_recibos,
      egresos_total,
      saldo_esperado,
      diferencia,
      notas: notas?.trim() || null,
      created_by: auth.user.id,
    })
    .select().single()

  if (cErr) {
    console.error('[cierres.create] ERROR:', cErr.message)
    if (cErr.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe un cierre para esa fecha' })
    return res.status(500).json({ ok: false, error: cErr.message })
  }

  // Insertar egresos
  if (egresos.length > 0) {
    const rows = egresos.map(e => ({
      cierre_id: cierre.id,
      concepto: e.concepto.trim(),
      monto: Number(e.monto),
      created_by: auth.user.id,
    }))
    const { error: eErr } = await auth.admin.from('cierres_egresos').insert(rows)
    if (eErr) console.error('[cierres.create] egresos ERROR:', eErr.message)
  }

  return res.status(201).json({ ok: true, cierre })
}

function round2(n) { return Math.round(n * 100) / 100 }
