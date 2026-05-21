// pages/api/compras/index.js
// GET  /api/compras?desde=YYYY-MM-DD&hasta=...&estado=borrador|recibida|anulada&proveedor_id=...
// POST /api/compras  -> crear cabecera + lineas en estado borrador (admin)
//
// Body POST:
// {
//   proveedor_id, fecha, numero_factura?, serie_factura?, iva?, metodo_pago?, notas?,
//   lineas: [{ descripcion, insumo_id?, cantidad, costo_unitario, unidad? }, ...]
// }
//
// La API calcula subtotal por linea, subtotal cabecera y total.

import { requireAuth, requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { desde, hasta, estado, proveedor_id, limit = 100 } = req.query
  let q = auth.admin
    .from('compras')
    .select('*, proveedores(nombre, nit)')
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit) || 100, 500))

  if (desde)        q = q.gte('fecha', desde)
  if (hasta)        q = q.lte('fecha', hasta)
  if (estado)       q = q.eq('estado', estado)
  if (proveedor_id) q = q.eq('proveedor_id', proveedor_id)

  const { data, error } = await q
  if (error) {
    console.error('[compras.list] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, compras: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const {
    proveedor_id, fecha, numero_factura, serie_factura,
    iva = 0, metodo_pago, notas, lineas,
  } = req.body || {}

  if (!proveedor_id) return res.status(400).json({ error: 'proveedor_id requerido' })
  if (!Array.isArray(lineas) || lineas.length === 0) {
    return res.status(400).json({ error: 'lineas[] requerido con al menos una linea' })
  }

  // Validar y calcular cada linea.
  const lineasNorm = []
  for (const [i, l] of lineas.entries()) {
    const cantidad = Number(l.cantidad)
    const costo = Number(l.costo_unitario)
    if (!l.descripcion || !l.descripcion.trim()) {
      return res.status(400).json({ error: `linea ${i + 1}: descripcion requerida` })
    }
    if (!cantidad || cantidad <= 0) {
      return res.status(400).json({ error: `linea ${i + 1}: cantidad debe ser > 0` })
    }
    if (costo == null || isNaN(costo) || costo < 0) {
      return res.status(400).json({ error: `linea ${i + 1}: costo_unitario invalido` })
    }
    lineasNorm.push({
      descripcion: l.descripcion.trim(),
      insumo_id: l.insumo_id || null,
      cantidad,
      costo_unitario: costo,
      subtotal: Number((cantidad * costo).toFixed(2)),
      unidad: l.unidad?.trim() || null,
    })
  }

  const subtotal = Number(lineasNorm.reduce((s, l) => s + l.subtotal, 0).toFixed(2))
  const ivaNum = Number(iva) || 0
  const total = Number((subtotal + ivaNum).toFixed(2))

  // 1. Crear cabecera.
  const { data: compra, error: cErr } = await auth.admin
    .from('compras')
    .insert({
      proveedor_id,
      fecha: fecha || new Date().toISOString().slice(0, 10),
      numero_factura: numero_factura?.trim() || null,
      serie_factura: serie_factura?.trim() || null,
      subtotal,
      iva: ivaNum,
      total,
      metodo_pago: metodo_pago?.trim() || null,
      notas: notas?.trim() || null,
      created_by: auth.user.id,
    })
    .select()
    .single()

  if (cErr) {
    console.error('[compras.create] cabecera ERROR:', cErr.message)
    return res.status(500).json({ ok: false, error: cErr.message })
  }

  // 2. Insertar lineas. Si falla, borrar cabecera para no dejar huerfanas.
  const lineasParaInsertar = lineasNorm.map(l => ({ ...l, compra_id: compra.id }))
  const { error: lErr } = await auth.admin.from('compras_lineas').insert(lineasParaInsertar)

  if (lErr) {
    console.error('[compras.create] lineas ERROR:', lErr.message)
    await auth.admin.from('compras').delete().eq('id', compra.id)
    return res.status(500).json({ ok: false, error: 'Error guardando lineas: ' + lErr.message })
  }

  return res.status(201).json({ ok: true, compra })
}
