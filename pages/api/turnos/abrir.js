// pages/api/turnos/abrir.js
// POST /api/turnos/abrir  body: { monto_apertura, observacion_apertura? }
//
// Auth: cajero. Crea un turno abierto. Falla si ya hay uno abierto (unique
// index parcial en BD).

import { requireAuth } from '../../../lib/auth'
import { turnoAbiertoDeCajero } from '../../../lib/turnos/helpers'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  if (auth.perfil.rol !== 'cajero' && auth.perfil.rol !== 'admin') {
    return res.status(403).json({ error: 'Solo cajeros o admin abren turno' })
  }

  const { monto_apertura, observacion_apertura } = req.body || {}
  const monto = Number(monto_apertura)
  if (!Number.isFinite(monto) || monto < 0) {
    return res.status(400).json({ error: 'monto_apertura debe ser numero >= 0' })
  }

  const cajeroId = auth.user.id

  const existente = await turnoAbiertoDeCajero(auth.admin, cajeroId)
  if (existente) {
    return res.status(409).json({
      error: 'Ya tenés un turno abierto',
      turno: existente,
    })
  }

  const { data, error } = await auth.admin
    .from('turnos_caja')
    .insert({
      cajero_id: cajeroId,
      monto_apertura: monto,
      observacion_apertura: (observacion_apertura || '').trim() || null,
      estado: 'abierto',
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ya hay un turno abierto para este cajero' })
    }
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({ ok: true, turno: data })
}
