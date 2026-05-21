// pages/api/asientos/index.js
// GET  /api/asientos?desde=...&hasta=...&estado=...&limit=100
// POST /api/asientos   -> body { fecha, descripcion, notas?, partidas: [{cuenta_id, debe, haber, concepto?}] }
//   Crea asiento en estado borrador validando partida doble (debe==haber).

import { requireAuth, requireAdmin } from '../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { desde, hasta, estado, limit = 100 } = req.query
  let q = auth.admin.from('asientos').select('*')
    .order('fecha', { ascending: false }).order('numero', { ascending: false })
    .limit(Math.min(Number(limit) || 100, 500))
  if (desde)  q = q.gte('fecha', desde)
  if (hasta)  q = q.lte('fecha', hasta)
  if (estado) q = q.eq('estado', estado)
  const { data, error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, asientos: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { fecha, descripcion, partidas, notas, origen_tipo, origen_id } = req.body || {}
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return res.status(400).json({ error: 'fecha requerida' })
  if (!descripcion?.trim()) return res.status(400).json({ error: 'descripcion requerida' })
  if (!Array.isArray(partidas) || partidas.length < 2) {
    return res.status(400).json({ error: 'minimo 2 partidas' })
  }

  // Validar partidas
  let totalDebe = 0, totalHaber = 0
  const partidasNorm = []
  for (const [i, p] of partidas.entries()) {
    if (!p.cuenta_id) return res.status(400).json({ error: `partida ${i + 1}: cuenta_id requerido` })
    const d = Number(p.debe) || 0
    const h = Number(p.haber) || 0
    if (d < 0 || h < 0) return res.status(400).json({ error: `partida ${i + 1}: debe/haber no pueden ser negativos` })
    if (d > 0 && h > 0) return res.status(400).json({ error: `partida ${i + 1}: solo debe o haber, no ambos` })
    if (d === 0 && h === 0) return res.status(400).json({ error: `partida ${i + 1}: debe o haber > 0` })
    totalDebe += d; totalHaber += h
    partidasNorm.push({ cuenta_id: p.cuenta_id, debe: round2(d), haber: round2(h), concepto: p.concepto?.trim() || null, orden: i })
  }
  totalDebe = round2(totalDebe); totalHaber = round2(totalHaber)

  if (totalDebe !== totalHaber) {
    return res.status(400).json({ error: `Partida doble desbalanceada: debe=${totalDebe} haber=${totalHaber}` })
  }

  // Validar que las cuentas son es_movimiento=true y activas
  const cuentaIds = Array.from(new Set(partidasNorm.map(p => p.cuenta_id)))
  const { data: cuentas } = await auth.admin
    .from('cuentas_contables').select('id, codigo, es_movimiento, activo').in('id', cuentaIds)
  if (!cuentas || cuentas.length !== cuentaIds.length) {
    return res.status(400).json({ error: 'Hay cuentas no encontradas en las partidas' })
  }
  for (const c of cuentas) {
    if (!c.activo)         return res.status(400).json({ error: `Cuenta ${c.codigo} inactiva` })
    if (!c.es_movimiento)  return res.status(400).json({ error: `Cuenta ${c.codigo} no acepta movimientos (es totalizadora)` })
  }

  // Crear cabecera
  const { data: asiento, error: aErr } = await auth.admin.from('asientos').insert({
    fecha, descripcion: descripcion.trim(),
    total_debe: totalDebe, total_haber: totalHaber,
    notas: notas?.trim() || null,
    origen_tipo: origen_tipo || 'manual',
    origen_id: origen_id || null,
    creado_por: auth.user.id,
  }).select().single()

  if (aErr) return res.status(500).json({ ok: false, error: aErr.message })

  // Insertar partidas
  const rows = partidasNorm.map(p => ({ ...p, asiento_id: asiento.id }))
  const { error: pErr } = await auth.admin.from('asientos_partidas').insert(rows)
  if (pErr) {
    await auth.admin.from('asientos').delete().eq('id', asiento.id)
    return res.status(500).json({ ok: false, error: pErr.message })
  }

  return res.status(201).json({ ok: true, asiento })
}
