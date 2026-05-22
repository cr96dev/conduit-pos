// lib/cierres.js
// Helpers server-side para el modulo de cierre de caja.
// Calcula ventas del dia desde loyverse_receipts/payments respetando refunds.
//
// Devuelve:
//   ventas_efectivo, ventas_tarjeta, ventas_otros (agregados clasicos)
//   ventas_total, cantidad_recibos
//   desglose_pagos: { "EFECTIVO": 100, "TARJETA": 200, "PEDIDOS YA": 50, ... }
//     -> nombres reales de Loyverse normalizados a uppercase.

import { rangoUTCDeDiaGT } from './fecha-gt'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// Mapeo de type clasicos para fallback cuando name esta vacio
const TYPE_FALLBACK = {
  CASH: 'EFECTIVO',
  CARD: 'TARJETA',
  NONINTEGRATEDCARD: 'TARJETA',
}

function normalizarNombre(name, type) {
  if (name && name.trim()) return name.trim().toUpperCase()
  if (type) return TYPE_FALLBACK[String(type).toUpperCase()] || String(type).toUpperCase()
  return 'OTROS'
}

export async function calcularVentasDelDia(admin, fechaGT) {
  const { desdeUTC, hastaUTC } = rangoUTCDeDiaGT(fechaGT)

  const { data: receipts, error } = await admin
    .from('loyverse_receipts')
    .select('loyverse_id, receipt_type, cancelled_at, loyverse_receipt_payments(name, type, money_amount)')
    .gte('receipt_date', desdeUTC)
    .lt('receipt_date', hastaUTC)

  if (error) throw new Error('Error leyendo loyverse_receipts: ' + error.message)

  let ventas_efectivo = 0
  let ventas_tarjeta = 0
  let ventas_otros = 0
  let cantidad_recibos = 0
  const desglose = {}  // nombre normalizado -> monto

  for (const r of receipts || []) {
    if (r.cancelled_at) continue
    const signo = r.receipt_type === 'REFUND' ? -1 : 1
    cantidad_recibos++
    for (const p of r.loyverse_receipt_payments || []) {
      const monto = Number(p.money_amount) || 0
      const aporte = signo * monto
      const nombreNorm = normalizarNombre(p.name, p.type)

      // Acumular desglose por nombre real
      desglose[nombreNorm] = (desglose[nombreNorm] || 0) + aporte

      // Agregados clasicos
      const tipo = String(p.type || '').toUpperCase()
      if (tipo === 'CASH' || nombreNorm === 'EFECTIVO') ventas_efectivo += aporte
      else if (tipo === 'CARD' || tipo === 'NONINTEGRATEDCARD' || nombreNorm === 'TARJETA') ventas_tarjeta += aporte
      else ventas_otros += aporte
    }
  }

  // Redondear desglose
  for (const k of Object.keys(desglose)) desglose[k] = round2(desglose[k])

  const ventas_total = ventas_efectivo + ventas_tarjeta + ventas_otros
  return {
    ventas_efectivo: round2(ventas_efectivo),
    ventas_tarjeta:  round2(ventas_tarjeta),
    ventas_otros:    round2(ventas_otros),
    ventas_total:    round2(ventas_total),
    cantidad_recibos,
    desglose_pagos: desglose,
  }
}
