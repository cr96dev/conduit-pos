// pages/api/insumos/[id].js
// PATCH  /api/insumos/:id  -> actualizar metadatos (no toca stock; usar /movimientos)
// DELETE /api/insumos/:id  -> baja logica (activo = false). No borra historial.
// Auth: Bearer (admin)

import { requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'PATCH')  return update(req, res, auth, id)
  if (req.method === 'DELETE') return baja(req, res, auth, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function update(req, res, auth, id) {
  // Campos editables (stock_actual queda fuera a proposito; solo movimientos lo cambian).
  const editables = [
    'nombre', 'categoria', 'unidad', 'stock_minimo', 'costo_unitario',
    'unidad_compra', 'cantidad_por_unidad_compra', 'costo_compra',
    'proveedor', 'notas', 'activo',
  ]
  const patch = {}
  for (const k of editables) {
    if (req.body && k in req.body) patch[k] = req.body[k]
  }
  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'Sin cambios' })
  }

  // Normalizar numericos opcionales que vienen como '' desde el form a null.
  for (const k of ['costo_unitario', 'cantidad_por_unidad_compra', 'costo_compra']) {
    if (patch[k] === '') patch[k] = null
  }

  // Derivar costo_unitario si el patch toca costo_compra o cantidad_por_unidad_compra:
  // releer los valores actuales para los campos que no vienen en el patch,
  // asi se respeta el estado actual del insumo. Si costo_compra y cpc quedan
  // ambos con valor positivo, pisa cualquier costo_unitario explicito.
  if ('costo_compra' in patch || 'cantidad_por_unidad_compra' in patch) {
    const { data: actual } = await auth.admin
      .from('insumos').select('costo_compra, cantidad_por_unidad_compra').eq('id', id).single()
    const cc  = 'costo_compra' in patch ? patch.costo_compra : actual?.costo_compra
    const cpc = 'cantidad_por_unidad_compra' in patch ? patch.cantidad_por_unidad_compra : actual?.cantidad_por_unidad_compra
    if (cc != null && cpc != null && Number(cpc) > 0) {
      patch.costo_unitario = Math.round((Number(cc) / Number(cpc)) * 10000) / 10000
    }
  }

  patch.updated_at = new Date().toISOString()

  const { data, error } = await auth.admin
    .from('insumos').update(patch).eq('id', id).select().single()

  if (error) {
    console.error('[insumos.update] ERROR:', error.message)
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Ya existe un insumo activo con ese nombre' })
    }
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, insumo: data })
}

async function baja(req, res, auth, id) {
  const { data, error } = await auth.admin
    .from('insumos')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()

  if (error) {
    console.error('[insumos.baja] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, insumo: data })
}
