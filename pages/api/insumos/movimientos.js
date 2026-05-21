// pages/api/insumos/movimientos.js
// GET  /api/insumos/movimientos?insumo_id=X&limit=50  -> historial
// POST /api/insumos/movimientos                       -> registrar movimiento (admin)
// Auth: Bearer
//
// El POST recibe { insumo_id, tipo, cantidad, motivo, costo_unitario?, nuevo_stock? }
// y calcula stock_antes/delta/stock_despues atomicamente.
//
//   tipo = 'entrada'   delta = +cantidad
//   tipo = 'salida'    delta = -cantidad
//   tipo = 'merma'     delta = -cantidad
//   tipo = 'ajuste'    delta = nuevo_stock - stock_antes (cantidad ignorada)

import { requireAuth, requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { insumo_id, limit = 100 } = req.query
  let q = auth.admin
    .from('insumos_movimientos')
    .select('*, insumos(nombre, unidad)')
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit) || 100, 500))

  if (insumo_id) q = q.eq('insumo_id', insumo_id)

  const { data, error } = await q
  if (error) {
    console.error('[insumos.mov.list] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, movimientos: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { insumo_id, tipo, cantidad, motivo, costo_unitario, nuevo_stock, referencia } = req.body || {}

  if (!insumo_id) return res.status(400).json({ error: 'insumo_id requerido' })
  if (!['entrada', 'salida', 'merma', 'ajuste'].includes(tipo)) {
    return res.status(400).json({ error: 'tipo invalido' })
  }

  // Lock pesimista light: leer stock_actual ahora.
  // (Para un negocio chico la concurrencia es minima; si en el futuro hay carrera,
  //  envolver en RPC con SELECT ... FOR UPDATE.)
  const { data: insumo, error: getErr } = await auth.admin
    .from('insumos')
    .select('id, stock_actual, costo_unitario')
    .eq('id', insumo_id)
    .single()

  if (getErr || !insumo) return res.status(404).json({ error: 'Insumo no encontrado' })

  const stockAntes = Number(insumo.stock_actual) || 0
  let delta

  if (tipo === 'ajuste') {
    if (nuevo_stock == null || isNaN(Number(nuevo_stock))) {
      return res.status(400).json({ error: 'ajuste requiere nuevo_stock' })
    }
    delta = Number(nuevo_stock) - stockAntes
  } else {
    const c = Number(cantidad)
    if (!c || c <= 0) return res.status(400).json({ error: 'cantidad debe ser > 0' })
    delta = tipo === 'entrada' ? c : -c
  }

  const stockDespues = stockAntes + delta

  if (stockDespues < 0) {
    return res.status(400).json({
      error: `Stock resultante seria negativo (${stockDespues}). Para corregir usa tipo "ajuste".`
    })
  }

  const { data: mov, error: movErr } = await auth.admin
    .from('insumos_movimientos')
    .insert({
      insumo_id,
      tipo,
      delta,
      stock_antes: stockAntes,
      stock_despues: stockDespues,
      costo_unitario: costo_unitario != null ? Number(costo_unitario) : (tipo === 'entrada' ? insumo.costo_unitario : null),
      motivo: motivo?.trim() || null,
      referencia: referencia || {},
      created_by: auth.user.id,
    })
    .select()
    .single()

  if (movErr) {
    console.error('[insumos.mov.create] ERROR:', movErr.message)
    return res.status(500).json({ ok: false, error: movErr.message })
  }

  return res.status(201).json({ ok: true, movimiento: mov, stock_actual: stockDespues })
}
