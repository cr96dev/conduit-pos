// pages/api/turnos/cerrar.js
// POST /api/turnos/cerrar  body: { conteo_efectivo_cierre, observacion_cierre? }
//
// Auth: cajero. Cierra el turno abierto del cajero, calcula desglose de
// ventas (efectivo, tarjeta, etc.) sumando facturas_fel.turno_id certificadas,
// computa esperado = apertura + ventas_efectivo y diferencia = conteo - esperado.

import { requireAuth } from '../../../lib/auth'
import { turnoAbiertoDeCajero, calcularDesgloseVentasTurno } from '../../../lib/turnos/helpers'

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  if (auth.perfil.rol !== 'cajero' && auth.perfil.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo cajeros o admin cierran turno' })
  }

  const { conteo_efectivo_cierre, observacion_cierre } = req.body || {}
  const conteo = Number(conteo_efectivo_cierre)
  if (!Number.isFinite(conteo) || conteo < 0) {
    return res.status(400).json({ error: 'conteo_efectivo_cierre debe ser numero >= 0' })
  }

  const cajeroId = auth.user.id
  const turno = await turnoAbiertoDeCajero(auth.admin, cajeroId)
  if (!turno) {
    return res.status(404).json({ error: 'No tenés un turno abierto' })
  }

  const desglose = await calcularDesgloseVentasTurno(auth.admin, turno.id)
  if (desglose.error) {
    return res.status(500).json({ error: 'Error calculando ventas: ' + desglose.error })
  }

  const esperado = r2(Number(turno.monto_apertura) + Number(desglose.ventas_efectivo))
  const diferencia = r2(conteo - esperado)

  const { data: cerrado, error: updErr } = await auth.admin
    .from('turnos_caja')
    .update({
      ...desglose,
      monto_cierre_esperado: esperado,
      conteo_efectivo_cierre: r2(conteo),
      diferencia,
      observacion_cierre: (observacion_cierre || '').trim() || null,
      fecha_cierre: new Date().toISOString(),
      estado: 'cerrado',
      updated_at: new Date().toISOString(),
    })
    .eq('id', turno.id)
    .eq('estado', 'abierto') // guard: no recerrar
    .select()
    .single()

  if (updErr) {
    return res.status(500).json({ error: updErr.message })
  }
  if (!cerrado) {
    return res.status(409).json({ error: 'El turno ya no estaba abierto' })
  }

  return res.status(200).json({ ok: true, turno: cerrado })
}
