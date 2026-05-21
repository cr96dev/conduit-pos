// pages/api/contabilidad/balance.js
// GET /api/contabilidad/balance?desde=...&hasta=...
// Balance de comprobacion: por cada cuenta de movimiento, suma debe y haber
// del rango, mas saldo deudor / acreedor.

import { requireAuth } from '../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { desde, hasta } = req.query

  // Obtener todas las cuentas activas
  const { data: cuentas } = await auth.admin
    .from('cuentas_contables').select('*').eq('activo', true).order('codigo')

  // Obtener todas las partidas posteadas en el rango
  let q = auth.admin
    .from('asientos_partidas')
    .select('cuenta_id, debe, haber, asientos!inner(fecha, estado)')
    .eq('asientos.estado', 'posteado')
  if (desde) q = q.gte('asientos.fecha', desde)
  if (hasta) q = q.lte('asientos.fecha', hasta)

  const { data: movs, error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })

  // Agrupar por cuenta_id
  const acc = {}
  for (const m of movs || []) {
    const k = m.cuenta_id
    if (!acc[k]) acc[k] = { debe: 0, haber: 0 }
    acc[k].debe  += Number(m.debe) || 0
    acc[k].haber += Number(m.haber) || 0
  }

  const filas = (cuentas || [])
    .filter(c => c.es_movimiento)
    .map(c => {
      const a = acc[c.id] || { debe: 0, haber: 0 }
      const debe = round2(a.debe), haber = round2(a.haber)
      let saldo_deudor = 0, saldo_acreedor = 0
      const dif = debe - haber
      if (c.naturaleza === 'deudora') {
        if (dif >= 0) saldo_deudor = round2(dif)
        else          saldo_acreedor = round2(-dif)
      } else {
        if (dif <= 0) saldo_acreedor = round2(-dif)
        else          saldo_deudor = round2(dif)
      }
      return { ...c, debe, haber, saldo_deudor, saldo_acreedor }
    })
    .filter(f => f.debe > 0 || f.haber > 0)

  const totales = filas.reduce((s, f) => ({
    debe: s.debe + f.debe,
    haber: s.haber + f.haber,
    saldo_deudor: s.saldo_deudor + f.saldo_deudor,
    saldo_acreedor: s.saldo_acreedor + f.saldo_acreedor,
  }), { debe: 0, haber: 0, saldo_deudor: 0, saldo_acreedor: 0 })
  Object.keys(totales).forEach(k => totales[k] = round2(totales[k]))

  return res.status(200).json({ ok: true, desde, hasta, filas, totales })
}
