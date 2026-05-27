// pages/api/insumos/index.js
// GET  /api/insumos          -> lista de insumos activos (cualquiera autenticado)
// POST /api/insumos          -> crear insumo (solo admin)
// Auth: Bearer <supabase access_token>

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { derivarCostoUnitario } from '../../../lib/unidades'

export default async function handler(req, res) {
  if (req.method === 'GET') return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { incluir_inactivos } = req.query
  let query = auth.admin.from('insumos').select('*').order('nombre')
  if (incluir_inactivos !== '1') query = query.eq('activo', true)

  const { data, error } = await query
  if (error) {
    console.error('[insumos.list] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, insumos: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const {
    nombre,
    categoria,
    unidad = 'unidad',
    stock_minimo = 0,
    costo_unitario = null,
    unidad_compra = null,
    cantidad_por_unidad_compra = null,
    costo_compra = null,
    proveedor = null,
    notas = null,
    stock_inicial = 0,
  } = req.body || {}

  if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0) {
    return res.status(400).json({ error: 'nombre requerido' })
  }

  const costoUnitarioFinal = derivarCostoUnitario({
    unidad,
    unidad_compra,
    cantidad_por_unidad_compra,
    costo_compra,
    costo_unitario_crudo: costo_unitario,
  })

  // 1. Crear el insumo con stock_actual = 0 (el trigger lo ajustara si hay stock_inicial)
  const { data: insumo, error: insErr } = await auth.admin
    .from('insumos')
    .insert({
      nombre: nombre.trim(),
      categoria: categoria?.trim() || null,
      unidad,
      stock_actual: 0,
      stock_minimo: Number(stock_minimo) || 0,
      costo_unitario: costoUnitarioFinal,
      unidad_compra: unidad_compra?.trim() || null,
      cantidad_por_unidad_compra: cantidad_por_unidad_compra != null && cantidad_por_unidad_compra !== ''
        ? Number(cantidad_por_unidad_compra) : null,
      costo_compra: costo_compra != null && costo_compra !== ''
        ? Number(costo_compra) : null,
      proveedor: proveedor?.trim() || null,
      notas: notas?.trim() || null,
    })
    .select()
    .single()

  if (insErr) {
    console.error('[insumos.create] ERROR:', insErr.message)
    // 23505 = unique violation (nombre duplicado entre activos)
    if (insErr.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Ya existe un insumo activo con ese nombre' })
    }
    return res.status(500).json({ ok: false, error: insErr.message })
  }

  // 2. Si hay stock_inicial > 0, registrar movimiento de entrada (el trigger sincroniza).
  const stockInicial = Number(stock_inicial) || 0
  if (stockInicial > 0) {
    const { error: movErr } = await auth.admin
      .from('insumos_movimientos')
      .insert({
        insumo_id: insumo.id,
        tipo: 'entrada',
        delta: stockInicial,
        stock_antes: 0,
        stock_despues: stockInicial,
        costo_unitario: insumo.costo_unitario,
        motivo: 'Inventario inicial al crear insumo',
        created_by: auth.user.id,
      })
    if (movErr) {
      console.error('[insumos.create] mov inicial ERROR:', movErr.message)
      // No abortamos: el insumo ya existe, el mov se puede registrar despues.
    }
  }

  // Releer para devolver el stock_actual sincronizado.
  const { data: final } = await auth.admin
    .from('insumos').select('*').eq('id', insumo.id).single()

  return res.status(201).json({ ok: true, insumo: final || insumo })
}
