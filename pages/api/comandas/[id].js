// pages/api/comandas/[id].js
// PATCH /api/comandas/:id   body: { estado, motivo_cancelacion?, notas_generales? }
//
// Transiciones validas:
//   pendiente   -> preparando   (barista/admin)
//   preparando  -> lista        (barista/admin)
//   lista       -> entregada    (cajero/admin)
//   *           -> cancelada    (cajero dueño cuando esta pendiente; admin siempre)

import { requireAuth } from '../../../lib/auth'

const TRANSICIONES = {
  pendiente:  new Set(['preparando', 'cancelada']),
  preparando: new Set(['lista', 'cancelada']),
  lista:      new Set(['entregada', 'cancelada']),
  entregada:  new Set([]),       // estado final
  cancelada:  new Set([]),       // estado final
}

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const { rol } = auth.perfil
  if (!['admin', 'cajero', 'barista'].includes(rol)) {
    return res.status(403).json({ error: 'Requiere rol operativo' })
  }

  const { id } = req.query
  const { estado, motivo_cancelacion, notas_generales } = req.body || {}

  if (!['preparando', 'lista', 'entregada', 'cancelada'].includes(estado)) {
    return res.status(400).json({ error: 'estado destino invalido' })
  }

  // Cargar comanda actual
  const { data: comanda, error: qErr } = await auth.admin
    .from('comandas')
    .select('*')
    .eq('id', id)
    .single()
  if (qErr || !comanda) return res.status(404).json({ error: 'Comanda no encontrada' })

  // Validar transicion
  const permitidas = TRANSICIONES[comanda.estado]
  if (!permitidas.has(estado)) {
    return res.status(400).json({
      error: `Transicion invalida: ${comanda.estado} -> ${estado}`,
    })
  }

  // Validar autorizacion por transicion
  const esAdmin = rol === 'admin'
  const esBarista = rol === 'barista'
  const esCajero = rol === 'cajero'
  const esCajeroDueño = esCajero && comanda.cajero_id === auth.user.id

  let autorizado = false
  if (estado === 'preparando' || estado === 'lista') {
    autorizado = esAdmin || esBarista
  } else if (estado === 'entregada') {
    autorizado = esAdmin || esCajero || esBarista
  } else if (estado === 'cancelada') {
    autorizado = esAdmin || (esCajeroDueño && comanda.estado === 'pendiente')
  }
  if (!autorizado) {
    return res.status(403).json({ error: 'No autorizado para esta transicion' })
  }

  // Armar update con timestamps + tracking
  const ahora = new Date().toISOString()
  const update = {
    estado,
    updated_at: ahora,
  }
  if (estado === 'preparando') {
    update.fecha_preparando = ahora
    update.marcada_preparando_por = auth.user.id
  } else if (estado === 'lista') {
    update.fecha_lista = ahora
    update.marcada_lista_por = auth.user.id
  } else if (estado === 'entregada') {
    update.fecha_entregada = ahora
    update.marcada_entregada_por = auth.user.id
  } else if (estado === 'cancelada') {
    update.fecha_cancelada = ahora
    update.motivo_cancelacion = (motivo_cancelacion || '').trim() || 'Sin motivo'
  }
  if (typeof notas_generales === 'string') {
    update.notas_generales = notas_generales.trim() || null
  }

  const { data: actualizada, error: updErr } = await auth.admin
    .from('comandas')
    .update(update)
    .eq('id', id)
    .eq('estado', comanda.estado)  // guard de race condition
    .select()
    .single()

  if (updErr) return res.status(500).json({ error: updErr.message })
  if (!actualizada) {
    return res.status(409).json({ error: 'La comanda cambio de estado antes del update' })
  }

  return res.status(200).json({ ok: true, comanda: actualizada })
}
