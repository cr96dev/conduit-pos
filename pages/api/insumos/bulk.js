// pages/api/insumos/bulk.js
// POST /api/insumos/bulk  (admin)
// Body: { items: [{ nombre, categoria?, unidad?, stock_inicial?, stock_minimo?, costo_unitario?, proveedor?, notas? }] }
//
// Deduplica por lower(nombre) contra insumos activos existentes (skip).
// Por cada insumo nuevo crea registro + movimiento "entrada" si stock_inicial > 0.

import { requireAdmin } from '../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { items } = req.body || {}
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items[] requerido' })
  }

  // Cargar insumos activos existentes para dedupe
  const { data: existentes } = await auth.admin
    .from('insumos').select('id, nombre').eq('activo', true)
  const existenteSet = new Set((existentes || []).map(i => i.nombre.toLowerCase().trim()))

  const insertados = []
  const omitidos = []
  const errores = []

  for (const [i, raw] of items.entries()) {
    const nombre = (raw.nombre || '').trim()
    if (!nombre) { errores.push({ fila: i + 1, error: 'nombre vacio' }); continue }
    if (existenteSet.has(nombre.toLowerCase())) {
      omitidos.push({ fila: i + 1, nombre, motivo: 'ya existe activo' })
      continue
    }

    const stockInicial = Number(raw.stock_inicial) || 0
    const insumoData = {
      nombre,
      categoria:      raw.categoria?.trim() || null,
      unidad:         raw.unidad?.trim() || 'unidad',
      stock_actual:   0, // se ajusta despues con el movimiento de entrada
      stock_minimo:   Number(raw.stock_minimo) || 0,
      costo_unitario: raw.costo_unitario != null && raw.costo_unitario !== '' ? Number(raw.costo_unitario) : null,
      proveedor:      raw.proveedor?.trim() || null,
      notas:          raw.notas?.trim() || null,
    }

    const { data: insumo, error: insErr } = await auth.admin
      .from('insumos').insert(insumoData).select().single()
    if (insErr) {
      errores.push({ fila: i + 1, nombre, error: insErr.message })
      continue
    }

    // Si stock inicial > 0, crear movimiento "entrada"
    if (stockInicial > 0) {
      const { error: movErr } = await auth.admin
        .from('insumos_movimientos').insert({
          insumo_id: insumo.id, tipo: 'entrada',
          delta: stockInicial, stock_antes: 0, stock_despues: stockInicial,
          costo_unitario: insumoData.costo_unitario,
          motivo: 'Carga inicial (bulk import)',
          created_by: auth.user.id,
        })
      if (movErr) errores.push({ fila: i + 1, nombre, error: 'insumo creado pero mov inicial fallo: ' + movErr.message })
    }
    existenteSet.add(nombre.toLowerCase())
    insertados.push({ id: insumo.id, nombre })
  }

  return res.status(200).json({
    ok: true,
    insertados: insertados.length,
    omitidos: omitidos.length,
    errores: errores.length,
    detalle: { insertados, omitidos, errores },
  })
}
