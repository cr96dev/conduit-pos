// pages/api/compras/[id].js
// GET    /api/compras/:id          -> detalle con lineas (cualquiera autenticado)
// PATCH  /api/compras/:id          -> editar (solo si estado=borrador, admin)
// DELETE /api/compras/:id          -> borrar (solo si estado=borrador, admin)
// Auth: Bearer

import { requireAuth, requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET')    return detalle(req, res, id)
  if (req.method === 'PATCH')  return editar(req, res, id)
  if (req.method === 'DELETE') return borrar(req, res, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function detalle(req, res, id) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: compra, error: cErr } = await auth.admin
    .from('compras').select('*, proveedores(*)').eq('id', id).single()
  if (cErr) return res.status(404).json({ error: 'Compra no encontrada' })

  const { data: lineas } = await auth.admin
    .from('compras_lineas').select('*, insumos(nombre, unidad)').eq('compra_id', id)
    .order('created_at')

  return res.status(200).json({ ok: true, compra: { ...compra, lineas: lineas || [] } })
}

async function editar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: actual, error: gErr } = await auth.admin
    .from('compras').select('estado').eq('id', id).single()
  if (gErr || !actual) return res.status(404).json({ error: 'Compra no encontrada' })
  if (actual.estado !== 'borrador') {
    return res.status(400).json({ error: 'Solo se puede editar en estado borrador' })
  }

  // Campos editables a nivel cabecera.
  const editables = ['proveedor_id', 'fecha', 'numero_factura', 'serie_factura', 'iva', 'metodo_pago', 'notas']
  const patch = {}
  for (const k of editables) if (req.body && k in req.body) patch[k] = req.body[k]

  // Si se reemplazan las lineas, recalcular y reemplazar.
  if (Array.isArray(req.body?.lineas)) {
    const lineasNorm = []
    for (const [i, l] of req.body.lineas.entries()) {
      const cantidad = Number(l.cantidad), costo = Number(l.costo_unitario)
      if (!l.descripcion?.trim()) return res.status(400).json({ error: `linea ${i + 1}: descripcion requerida` })
      if (!cantidad || cantidad <= 0) return res.status(400).json({ error: `linea ${i + 1}: cantidad debe ser > 0` })
      if (costo == null || isNaN(costo) || costo < 0) return res.status(400).json({ error: `linea ${i + 1}: costo invalido` })
      lineasNorm.push({
        compra_id: id,
        descripcion: l.descripcion.trim(),
        insumo_id: l.insumo_id || null,
        cantidad, costo_unitario: costo,
        subtotal: Number((cantidad * costo).toFixed(2)),
        unidad: l.unidad?.trim() || null,
      })
    }
    const subtotal = Number(lineasNorm.reduce((s, l) => s + l.subtotal, 0).toFixed(2))
    const ivaNum = patch.iva != null ? Number(patch.iva) : 0
    patch.subtotal = subtotal
    patch.iva = ivaNum
    patch.total = Number((subtotal + ivaNum).toFixed(2))

    await auth.admin.from('compras_lineas').delete().eq('compra_id', id)
    const { error: lErr } = await auth.admin.from('compras_lineas').insert(lineasNorm)
    if (lErr) {
      console.error('[compras.editar] lineas ERROR:', lErr.message)
      return res.status(500).json({ ok: false, error: lErr.message })
    }
  }

  patch.updated_at = new Date().toISOString()
  const { data, error } = await auth.admin.from('compras').update(patch).eq('id', id).select().single()
  if (error) {
    console.error('[compras.editar] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, compra: data })
}

async function borrar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: actual } = await auth.admin
    .from('compras').select('estado').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'Compra no encontrada' })
  if (actual.estado !== 'borrador') {
    return res.status(400).json({ error: 'Solo se pueden borrar compras en borrador. Las recibidas se anulan.' })
  }

  const { error } = await auth.admin.from('compras').delete().eq('id', id)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true })
}
