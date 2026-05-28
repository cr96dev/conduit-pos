// pages/api/admin/cajeros/reset-pin.js
// POST /api/admin/cajeros/reset-pin  body: { cajero_id, pin? }
//
// Auth: admin. Si pin no viene, se genera aleatorio. El PIN se devuelve UNA
// SOLA VEZ al admin (no se guarda en claro, solo el hash).

import { requireAdmin } from '../../../../lib/auth'
import { hashearPin, validarFormatoPin, generarPinAleatorio } from '../../../../lib/cajeros/pin'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { cajero_id, pin } = req.body || {}
  if (!cajero_id) return res.status(400).json({ error: 'cajero_id requerido' })

  const { data: cajero, error: qErr } = await auth.admin
    .from('perfiles')
    .select('id, rol, nombre_completo')
    .eq('id', cajero_id)
    .single()
  if (qErr || !cajero) return res.status(404).json({ error: 'Cajero no encontrado' })
  if (cajero.rol !== 'cajero') return res.status(400).json({ error: 'El perfil no es un cajero' })

  const pinFinal = pin || generarPinAleatorio()
  const errFormato = validarFormatoPin(pinFinal)
  if (errFormato) return res.status(400).json({ error: errFormato })

  const { hash, salt } = hashearPin(pinFinal)
  const { error: updErr } = await auth.admin
    .from('perfiles')
    .update({
      pin_hash: hash,
      pin_salt: salt,
      pin_updated_at: new Date().toISOString(),
      pin_intentos_fallidos: 0,
      pin_bloqueado_hasta: null,
    })
    .eq('id', cajero_id)

  if (updErr) return res.status(500).json({ error: updErr.message })

  return res.status(200).json({ ok: true, cajero: { id: cajero.id, nombre_completo: cajero.nombre_completo }, pin: pinFinal })
}
