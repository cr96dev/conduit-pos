// pages/api/pos/pedidos/index.js
//
// GET /api/pos/pedidos
//   Lista pedidos pendientes (default) o por estado. Filtros:
//     ?estado=pendiente_entrega | entregado_facturado | cancelado
//     ?turno_id=<uuid>   (si se omite y sos cajero, defaultea a turno actual)
//     ?limit=N           (default 50, max 200)
//
// POST /api/pos/pedidos
//   Crea un pedido pendiente. Body:
//     {
//       referencia: string,         // "Pedidos Ya #4521", nombre cliente, etc.
//       origen?: string,            // 'pedidos_ya' default
//       items: [...],               // mismo shape que body de /api/pos/ventas
//       receptor?: { nit, nombre, email },
//       notas?: string,
//     }
//   Vincula automatico al turno abierto del cajero.

import { requireAdminOCajero } from '../../../../lib/auth'
import { turnoAbiertoDeCajero } from '../../../../lib/turnos/helpers'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  const auth = await requireAdminOCajero(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (req.method === 'GET')  return getHandler(req, res, auth)
  if (req.method === 'POST') return postHandler(req, res, auth)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function getHandler(req, res, auth) {
  const estado = req.query.estado || 'pendiente_entrega'
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
  let turnoId = req.query.turno_id || null

  // Si no se especifica turno_id y sos cajero, mostramos los pedidos del
  // turno actual (los que estan visibles para vos en la bandeja). Admin sin
  // turno_id ve todos.
  if (!turnoId && auth.perfil.rol === 'cajero') {
    const turno = await turnoAbiertoDeCajero(auth.admin, auth.user.id)
    if (turno) turnoId = turno.id
  }

  let q = auth.admin
    .from('pedidos_pendientes')
    .select(`
      id, turno_id, cajero_creador, cajero_que_facturo,
      referencia, origen, items, total_estimado,
      receptor_nit, receptor_nombre, receptor_email, receptor_telefono,
      estado, factura_id, motivo_cancelacion, notas,
      slot_pickup_at, slot_label, day_label,
      created_at, updated_at, facturado_at, cancelado_at
    `)
    .order('created_at', { ascending: estado === 'pendiente_entrega' })
    .limit(limit)

  // 'activos' = pendiente_entrega + lista (todo lo que el cajero debe operar).
  // 'all' = sin filtro. Cualquier otro valor = exact match.
  if (estado === 'activos') q = q.in('estado', ['pendiente_entrega', 'lista'])
  else if (estado !== 'all') q = q.eq('estado', estado)
  // Filtro de turno: incluir el turno actual del cajero Y los pedidos
  // públicos sin turno (origen='app_pickup' creados desde la PWA, sin
  // sesión, por eso turno_id=null). Admin sin turno_id ve todos.
  if (turnoId) q = q.or(`turno_id.eq.${turnoId},and(turno_id.is.null,origen.eq.app_pickup)`)

  const { data, error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })

  // Enriquecer con nombre del cajero (best-effort, no rompe si falla)
  const userIds = Array.from(new Set(
    (data || []).flatMap(p => [p.cajero_creador, p.cajero_que_facturo].filter(Boolean))
  ))
  let nombresPorId = {}
  if (userIds.length > 0) {
    const { data: perfiles } = await auth.admin
      .from('perfiles').select('id, nombre_completo').in('id', userIds)
    nombresPorId = Object.fromEntries((perfiles || []).map(p => [p.id, p.nombre_completo]))
  }

  return res.status(200).json({
    ok: true,
    pedidos: (data || []).map(p => ({
      ...p,
      cajero_creador_nombre: nombresPorId[p.cajero_creador] || null,
      cajero_que_facturo_nombre: nombresPorId[p.cajero_que_facturo] || null,
    })),
  })
}

async function postHandler(req, res, auth) {
  // Si es cajero, exige turno abierto. Admin puede crear sin turno (raro
  // pero util para tests).
  let turnoId = null
  if (auth.perfil.rol === 'cajero') {
    const turno = await turnoAbiertoDeCajero(auth.admin, auth.user.id)
    if (!turno) return res.status(403).json({ error: 'Necesitás abrir caja antes de guardar pedidos' })
    turnoId = turno.id
  } else if (req.body?.turno_id) {
    turnoId = req.body.turno_id
  }

  const { referencia, origen, items, receptor = {}, notas } = req.body || {}

  if (!referencia || typeof referencia !== 'string' || !referencia.trim()) {
    return res.status(400).json({ error: 'referencia requerida (ej: "Pedidos Ya #4521" o nombre cliente)' })
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items[] requerido' })
  }
  for (const [i, it] of items.entries()) {
    if (!it.descripcion?.trim()) return res.status(400).json({ error: `item ${i + 1}: descripcion requerida` })
    if (!(Number(it.cantidad) > 0)) return res.status(400).json({ error: `item ${i + 1}: cantidad > 0 requerida` })
    if (!(Number(it.precio_unitario) > 0)) return res.status(400).json({ error: `item ${i + 1}: precio_unitario > 0 requerido` })
  }

  // Estimacion del total (no es la factura, solo display).
  const totalEstimado = round2(
    items.reduce((s, it) => s + Number(it.cantidad) * Number(it.precio_unitario), 0)
  )

  // Sanitizar receptor
  const nit = String(receptor.nit || 'CF').trim().toUpperCase() || 'CF'
  const nombre = (receptor.nombre || (nit === 'CF' ? 'CONSUMIDOR FINAL' : '')).trim()
  const email = receptor.email ? String(receptor.email).trim() : null

  const { data, error } = await auth.admin
    .from('pedidos_pendientes')
    .insert({
      turno_id: turnoId,
      cajero_creador: auth.user.id,
      referencia: referencia.trim().slice(0, 200),
      origen: (origen && String(origen).trim()) || 'pedidos_ya',
      items,
      total_estimado: totalEstimado,
      receptor_nit: nit,
      receptor_nombre: nombre,
      receptor_email: email,
      estado: 'pendiente_entrega',
      notas: notas ? String(notas).slice(0, 1000) : null,
    })
    .select()
    .single()

  if (error) return res.status(500).json({ ok: false, error: error.message })

  return res.status(200).json({ ok: true, pedido: data })
}
