// pages/api/admin/cajeros/index.js
// GET  /api/admin/cajeros          -> lista cajeros (sin pin_hash)
// POST /api/admin/cajeros          -> crea cajero { nombre_completo, email, pin? }
//                                     Si pin no viene, genera aleatorio.
// Auth: admin.

import { requireAdmin } from '../../../../lib/auth'
import { hashearPin, validarFormatoPin, generarPinAleatorio } from '../../../../lib/cajeros/pin'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (req.method === 'GET') {
    const { data, error } = await auth.admin
      .from('perfiles')
      .select('id, email, nombre_completo, activo, created_at, pin_updated_at, es_kiosko')
      .eq('rol', 'cajero')
      .order('nombre_completo', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })

    // Turno abierto por cajero (si hay)
    const ids = (data || []).map(c => c.id)
    let turnosAbiertos = []
    if (ids.length > 0) {
      const { data: ta } = await auth.admin
        .from('turnos_caja')
        .select('id, cajero_id, fecha_apertura, monto_apertura')
        .eq('estado', 'abierto')
        .in('cajero_id', ids)
      turnosAbiertos = ta || []
    }
    const mapTurno = new Map(turnosAbiertos.map(t => [t.cajero_id, t]))

    const cajeros = (data || []).map(c => ({
      ...c,
      tiene_pin: !!c.pin_updated_at,
      turno_abierto: mapTurno.get(c.id) || null,
    }))

    return res.status(200).json({ ok: true, cajeros })
  }

  if (req.method === 'POST') {
    const { nombre_completo, email, pin, es_kiosko } = req.body || {}
    if (!nombre_completo?.trim()) return res.status(400).json({ error: 'nombre_completo requerido' })
    if (!email?.trim() || !email.includes('@')) return res.status(400).json({ error: 'email invalido' })

    const pinFinal = pin || generarPinAleatorio()
    const errFormato = validarFormatoPin(pinFinal)
    if (errFormato) return res.status(400).json({ error: errFormato })

    const esKioskoFlag = es_kiosko === true

    // 1. Crear usuario auth (email confirmado)
    const passwordInicial = require('crypto').randomBytes(24).toString('hex')
    const { data: created, error: createErr } = await auth.admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: passwordInicial,
      email_confirm: true,
    })
    if (createErr) {
      return res.status(500).json({ error: 'No se pudo crear usuario auth: ' + createErr.message })
    }
    const userId = created.user.id

    // 2. Crear perfil rol=cajero con PIN
    const { hash, salt } = hashearPin(pinFinal)
    const { error: perfilErr } = await auth.admin.from('perfiles').insert({
      id: userId,
      email: email.trim().toLowerCase(),
      nombre_completo: nombre_completo.trim(),
      rol: 'cajero',
      activo: true,
      pin_hash: hash,
      pin_salt: salt,
      pin_updated_at: new Date().toISOString(),
      es_kiosko: esKioskoFlag,
    })
    if (perfilErr) {
      // Rollback: borrar usuario auth recien creado para no dejar huerfano.
      await auth.admin.auth.admin.deleteUser(userId)
      return res.status(500).json({ error: 'No se pudo crear perfil: ' + perfilErr.message })
    }

    return res.status(200).json({
      ok: true,
      cajero: { id: userId, nombre_completo, email, rol: 'cajero', es_kiosko: esKioskoFlag },
      pin: pinFinal, // se devuelve UNA SOLA VEZ al admin para que se lo pase al cajero.
    })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
