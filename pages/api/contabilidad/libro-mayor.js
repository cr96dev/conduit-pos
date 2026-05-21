// pages/api/contabilidad/libro-mayor.js
// GET /api/contabilidad/libro-mayor?cuenta_id=X&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Devuelve movimientos de UNA cuenta en el rango + saldo inicial + saldo final.
// Solo incluye asientos posteados.

import { requireAuth } from '../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { cuenta_id, desde, hasta } = req.query
  if (!cuenta_id) return res.status(400).json({ error: 'cuenta_id requerido' })

  const { data: cuenta, error: cErr } = await auth.admin
    .from('cuentas_contables').select('*').eq('id', cuenta_id).single()
  if (cErr) return res.status(404).json({ error: 'Cuenta no encontrada' })

  // Saldo inicial: suma de debe/haber de todos los asientos posteados antes de `desde`
  let saldoInicial = 0
  if (desde) {
    const { data: previas } = await auth.admin
      .from('asientos_partidas')
      .select('debe, haber, asientos!inner(fecha, estado)')
      .eq('cuenta_id', cuenta_id)
      .eq('asientos.estado', 'posteado')
      .lt('asientos.fecha', desde)
    for (const p of previas || []) {
      saldoInicial += (Number(p.debe) || 0) - (Number(p.haber) || 0)
    }
    // Para cuentas acreedoras, invertir signo del saldo "neto" para que sea natural.
    if (cuenta.naturaleza === 'acreedora') saldoInicial = -saldoInicial
  }

  // Movimientos del rango
  let q = auth.admin
    .from('asientos_partidas')
    .select('id, debe, haber, concepto, asientos!inner(id, numero, fecha, descripcion, estado)')
    .eq('cuenta_id', cuenta_id)
    .eq('asientos.estado', 'posteado')
    .order('fecha', { foreignTable: 'asientos', ascending: true })
    .order('numero', { foreignTable: 'asientos', ascending: true })
  if (desde) q = q.gte('asientos.fecha', desde)
  if (hasta) q = q.lte('asientos.fecha', hasta)

  const { data: movs, error: mErr } = await q
  if (mErr) return res.status(500).json({ ok: false, error: mErr.message })

  // Calcular saldo corrido (en signo natural de la cuenta)
  const signo = cuenta.naturaleza === 'deudora' ? 1 : -1
  let saldo = saldoInicial
  const movimientos = (movs || []).map(m => {
    const delta = (Number(m.debe) || 0) - (Number(m.haber) || 0)
    saldo += signo * delta
    return {
      id: m.id,
      asiento_id: m.asientos.id,
      asiento_numero: m.asientos.numero,
      fecha: m.asientos.fecha,
      descripcion: m.asientos.descripcion,
      concepto: m.concepto,
      debe: Number(m.debe) || 0,
      haber: Number(m.haber) || 0,
      saldo: round2(saldo),
    }
  })

  return res.status(200).json({
    ok: true,
    cuenta,
    desde, hasta,
    saldo_inicial: round2(saldoInicial),
    saldo_final: round2(saldo),
    movimientos,
  })
}
