// pages/api/cajeros/cambiar-pin.js
// POST /api/cajeros/cambiar-pin  body: { pin_actual, pin_nuevo }
//
// Auth: bearer del cajero. Cambia su propio PIN.

import { requireAuth } from '../../../lib/auth'
import { verificarPin, hashearPin, validarFormatoPin } from '../../../lib/cajeros/pin'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  if (auth.perfil.rol !== 'cajero') {
    return res.status(403).json({ error: 'Solo cajeros pueden cambiar su PIN aqui' })
  }

  const { pin_actual, pin_nuevo } = req.body || {}
  const errFormato = validarFormatoPin(pin_nuevo)
  if (errFormato) return res.status(400).json({ error: errFormato })
  if (typeof pin_actual !== 'string' || !/^\d{4}$/.test(pin_actual)) {
    return res.status(400).json({ error: 'pin_actual invalido' })
  }
  if (pin_actual === pin_nuevo) {
    return res.status(400).json({ error: 'El PIN nuevo debe ser distinto al actual' })
  }

  const { data: perfil } = await auth.admin
    .from('perfiles')
    .select('pin_hash, pin_salt')
    .eq('id', auth.user.id)
    .single()

  if (!perfil?.pin_hash || !verificarPin(pin_actual, perfil.pin_hash, perfil.pin_salt)) {
    return res.status(401).json({ error: 'PIN actual incorrecto' })
  }

  const { hash, salt } = hashearPin(pin_nuevo)
  const { error: updErr } = await auth.admin
    .from('perfiles')
    .update({
      pin_hash: hash,
      pin_salt: salt,
      pin_updated_at: new Date().toISOString(),
      pin_intentos_fallidos: 0,
      pin_bloqueado_hasta: null,
    })
    .eq('id', auth.user.id)

  if (updErr) {
    return res.status(500).json({ error: 'Error actualizando PIN: ' + updErr.message })
  }

  return res.status(200).json({ ok: true })
}
