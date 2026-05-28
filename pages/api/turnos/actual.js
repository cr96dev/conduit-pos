// pages/api/turnos/actual.js
// GET /api/turnos/actual
//
// Auth: cajero o admin. Devuelve el turno abierto del cajero actual
// (null si no tiene) + desglose de ventas en vivo del turno.

import { requireAuth } from '../../../lib/auth'
import { turnoAbiertoDeCajero, calcularDesgloseVentasTurno } from '../../../lib/turnos/helpers'

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const turno = await turnoAbiertoDeCajero(auth.admin, auth.user.id)
  if (!turno) return res.status(200).json({ ok: true, turno: null, desglose: null, esperado: null })

  const desglose = await calcularDesgloseVentasTurno(auth.admin, turno.id)
  if (desglose.error) return res.status(500).json({ error: desglose.error })

  const esperado = r2(Number(turno.monto_apertura) + Number(desglose.ventas_efectivo))

  return res.status(200).json({ ok: true, turno, desglose, esperado })
}
