// pages/api/fel/facturas/index.js
// GET  /api/fel/facturas?desde=...&hasta=...&estado=...
// POST /api/fel/facturas   -> crear borrador (admin)

import { requireAuth, requireAdmin } from '../../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { desde, hasta, estado, limit = 100, creado_por } = req.query
  let q = auth.admin.from('facturas_fel').select('*')
    .order('fecha_emision', { ascending: false })
    .limit(Math.min(Number(limit) || 100, 500))
  if (desde) q = q.gte('fecha_emision', desde)
  if (hasta) q = q.lte('fecha_emision', hasta + 'T23:59:59')
  if (estado) q = q.eq('estado', estado)
  // Filtro por cajero/emisor. UI del POS lo usa para el "historial del turno"
  // (solo las facturas que emitio este cajero). Admin no lo pasa -> ve todas.
  if (creado_por) q = q.eq('creado_por', creado_por)
  const { data, error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, facturas: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const {
    receptor_nit = 'CF', receptor_nombre, receptor_direccion, receptor_email,
    tipo_documento = 'FACT', fecha_emision, moneda = 'GTQ',
    afecta_iva_global = true, items, notas, origen_tipo, origen_id,
  } = req.body || {}

  if (!receptor_nombre?.trim()) return res.status(400).json({ error: 'receptor_nombre requerido' })
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items requeridos' })

  // Validar + calcular
  const itemsNorm = []
  let totalGravado = 0, totalExento = 0, iva = 0
  for (const [i, it] of items.entries()) {
    const cant = Number(it.cantidad), pu = Number(it.precio_unitario), desc = Number(it.descuento) || 0
    if (!it.descripcion?.trim()) return res.status(400).json({ error: `item ${i+1}: descripcion requerida` })
    if (!cant || cant <= 0) return res.status(400).json({ error: `item ${i+1}: cantidad > 0` })
    if (pu < 0 || isNaN(pu)) return res.status(400).json({ error: `item ${i+1}: precio_unitario invalido` })
    const subtotal = round2(cant * pu - desc)
    const afecta = it.afecta_iva !== undefined ? !!it.afecta_iva : !!afecta_iva_global
    itemsNorm.push({
      bien_o_servicio: it.bien_o_servicio || 'B',
      descripcion: it.descripcion.trim(),
      unidad_medida: it.unidad_medida?.trim() || 'UND',
      cantidad: cant, precio_unitario: pu, descuento: desc,
      subtotal, afecta_iva: afecta, orden: i,
    })
    if (afecta) {
      // IVA INCLUIDO en el precio (regimen normal GT). Gravado = subtotal / 1.12; iva = subtotal - gravado.
      const grav = round2(subtotal / 1.12)
      totalGravado += grav
      iva += round2(subtotal - grav)
    } else {
      totalExento += subtotal
    }
  }
  totalGravado = round2(totalGravado); iva = round2(iva); totalExento = round2(totalExento)
  const total = round2(totalGravado + totalExento + iva)

  const { data: factura, error } = await auth.admin.from('facturas_fel').insert({
    receptor_nit: receptor_nit.trim() || 'CF',
    receptor_nombre: receptor_nombre.trim(),
    receptor_direccion: receptor_direccion?.trim() || null,
    receptor_email: receptor_email?.trim() || null,
    tipo_documento, moneda,
    fecha_emision: fecha_emision || new Date().toISOString(),
    total_gravado: totalGravado, total_exento: totalExento, iva, total,
    estado: 'borrador',
    notas: notas?.trim() || null,
    origen_tipo: origen_tipo || 'manual',
    origen_id: origen_id || null,
    creado_por: auth.user.id,
  }).select().single()

  if (error) return res.status(500).json({ ok: false, error: error.message })

  const itemsParaInsertar = itemsNorm.map(it => ({ ...it, factura_id: factura.id }))
  const { error: iErr } = await auth.admin.from('facturas_fel_items').insert(itemsParaInsertar)
  if (iErr) {
    await auth.admin.from('facturas_fel').delete().eq('id', factura.id)
    return res.status(500).json({ ok: false, error: iErr.message })
  }

  return res.status(201).json({ ok: true, factura })
}
