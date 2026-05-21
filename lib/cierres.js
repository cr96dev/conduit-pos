// lib/cierres.js
// Helpers server-side para el modulo de cierre de caja.
// Calcula ventas del dia desde loyverse_receipts/payments respetando refunds.

import { rangoUTCDeDiaGT } from './fecha-gt'

// Devuelve un objeto con totales por metodo de pago para una fecha GT (YYYY-MM-DD).
// Lo refunds se restan al total del metodo correspondiente.
//
//   await calcularVentasDelDia(supabaseAdmin, '2026-05-21')
//     -> { ventas_efectivo, ventas_tarjeta, ventas_otros, ventas_total, cantidad_recibos }
export async function calcularVentasDelDia(admin, fechaGT) {
  const { desdeUTC, hastaUTC } = rangoUTCDeDiaGT(fechaGT)

  // Traer receipts del rango + sus payments embebidos.
  const { data: receipts, error } = await admin
    .from('loyverse_receipts')
    .select('loyverse_id, receipt_type, cancelled_at, loyverse_receipt_payments(type, money_amount)')
    .gte('receipt_date', desdeUTC)
    .lt('receipt_date', hastaUTC)

  if (error) throw new Error('Error leyendo loyverse_receipts: ' + error.message)

  let ventas_efectivo = 0
  let ventas_tarjeta = 0
  let ventas_otros = 0
  let cantidad_recibos = 0

  for (const r of receipts || []) {
    if (r.cancelled_at) continue  // ignorar cancelados
    const signo = r.receipt_type === 'REFUND' ? -1 : 1
    cantidad_recibos++
    for (const p of r.loyverse_receipt_payments || []) {
      const monto = Number(p.money_amount) || 0
      const aporte = signo * monto
      const tipo = String(p.type || '').toUpperCase()
      if (tipo === 'CASH')      ventas_efectivo += aporte
      else if (tipo === 'CARD') ventas_tarjeta  += aporte
      else                      ventas_otros    += aporte
    }
  }

  const ventas_total = ventas_efectivo + ventas_tarjeta + ventas_otros
  return {
    ventas_efectivo: round2(ventas_efectivo),
    ventas_tarjeta:  round2(ventas_tarjeta),
    ventas_otros:    round2(ventas_otros),
    ventas_total:    round2(ventas_total),
    cantidad_recibos,
  }
}

function round2(n) {
  return Math.round(n * 100) / 100
}
