// pages/api/cotizaciones/index.js
//
// GET  /api/cotizaciones?estado=<opt>&q=<opt>
//   Lista cotizaciones del más reciente al más viejo. Filtros opcionales:
//     estado=borrador|enviada|aceptada|rechazada|vencida
//     q=texto libre (busca en nombre, empresa, NIT)
//
// POST /api/cotizaciones
//   Crea una cotización. Body:
//     { cliente_nombre, cliente_empresa?, cliente_nit?, cliente_email?,
//       cliente_telefono?, fecha?, validez_dias?, items:[...], notas?, estado? }
//   Calcula subtotal/iva/total server-side (12% IVA), autogenera numero.

import { requireAdmin } from '../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (req.method === 'GET') return listar(req, res, auth)
  if (req.method === 'POST') return crear(req, res, auth)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function listar(req, res, auth) {
  const { estado, q } = req.query
  let query = auth.admin.from('cotizaciones')
    .select('id, numero, cliente_nombre, cliente_empresa, cliente_nit, fecha, total, estado, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (estado && estado !== 'all') query = query.eq('estado', estado)
  if (q) {
    const like = `%${q}%`
    query = query.or(`cliente_nombre.ilike.${like},cliente_empresa.ilike.${like},cliente_nit.ilike.${like},numero.ilike.${like}`)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, cotizaciones: data || [] })
}

async function crear(req, res, auth) {
  const b = req.body || {}
  if (!b.cliente_nombre?.trim()) return res.status(400).json({ error: 'cliente_nombre requerido' })
  if (!Array.isArray(b.items) || b.items.length === 0) {
    return res.status(400).json({ error: 'items[] requerido' })
  }

  // Validar y normalizar items
  const items = []
  let subtotal = 0
  for (const [i, raw] of b.items.entries()) {
    const desc = String(raw.descripcion || '').trim()
    const cant = Number(raw.cantidad)
    const precio = Number(raw.precio_unitario)
    if (!desc) return res.status(400).json({ error: `item ${i + 1}: descripcion requerida` })
    if (!(cant > 0)) return res.status(400).json({ error: `item ${i + 1}: cantidad > 0 requerida` })
    if (!(precio >= 0)) return res.status(400).json({ error: `item ${i + 1}: precio_unitario inválido` })
    const sub = round2(cant * precio)
    items.push({ descripcion: desc, cantidad: cant, precio_unitario: round2(precio), subtotal: sub })
    subtotal += sub
  }
  subtotal = round2(subtotal)
  // IVA 12% incluido en el precio (estilo guatemalteco). El total = subtotal.
  // El IVA "desglosado" se calcula como total / 1.12 * 0.12 para mostrar al cliente.
  const total = subtotal
  const iva = round2(total - total / 1.12)

  // Numero correlativo COT-YYYY-NNNN (por año)
  const año = new Date().getFullYear()
  const { count } = await auth.admin
    .from('cotizaciones').select('id', { count: 'exact', head: true })
    .gte('fecha', `${año}-01-01`).lte('fecha', `${año}-12-31`)
  const numero = `COT-${año}-${String((count || 0) + 1).padStart(4, '0')}`

  const insert = {
    numero,
    cliente_nombre: b.cliente_nombre.trim().slice(0, 200),
    cliente_empresa: b.cliente_empresa?.trim().slice(0, 200) || null,
    cliente_nit: b.cliente_nit?.trim().slice(0, 20) || null,
    cliente_email: b.cliente_email?.trim().slice(0, 200) || null,
    cliente_telefono: b.cliente_telefono?.trim().slice(0, 50) || null,
    fecha: b.fecha || new Date().toISOString().slice(0, 10),
    validez_dias: Math.max(1, Math.min(180, Number(b.validez_dias) || 15)),
    items,
    subtotal,
    iva,
    total,
    notas: b.notas?.trim().slice(0, 2000) || null,
    estado: ['borrador','enviada','aceptada','rechazada','vencida'].includes(b.estado) ? b.estado : 'borrador',
    creado_por: auth.user.id,
  }

  const { data, error } = await auth.admin.from('cotizaciones').insert(insert).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, cotizacion: data })
}
