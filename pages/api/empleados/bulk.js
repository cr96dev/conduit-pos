// pages/api/empleados/bulk.js
// POST /api/empleados/bulk  (admin)
// Body: { items: [{ nombre, salario_mensual, dpi?, nit?, numero_igss?, area?, puesto?, tipo_pago?, banco?, numero_cuenta?, fecha_ingreso?, bonificacion_quincenal?, bonificacion_segunda_quincena? }] }
//
// Dedupe por (nombre + dpi). No upserta — solo skip si match.

import { requireAdmin } from '../../../lib/auth'
import { calcularProvisiones } from '../../../lib/planillas'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { items } = req.body || {}
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items[] requerido' })
  }

  // Cargar empleados activos existentes para dedupe (por DPI cuando viene, sino por nombre)
  const { data: existentes } = await auth.admin
    .from('empleados').select('id, nombre, dpi').eq('activo', true)
  const dpiSet = new Set((existentes || []).filter(e => e.dpi).map(e => e.dpi.trim()))
  const nombreSet = new Set((existentes || []).map(e => e.nombre.toLowerCase().trim()))

  const insertados = []
  const omitidos = []
  const errores = []

  for (const [i, raw] of items.entries()) {
    const nombre = (raw.nombre || '').trim()
    if (!nombre) { errores.push({ fila: i + 1, error: 'nombre vacio' }); continue }

    const dpi = (raw.dpi || '').trim() || null
    if (dpi && dpiSet.has(dpi)) {
      omitidos.push({ fila: i + 1, nombre, motivo: `ya existe DPI ${dpi}` })
      continue
    }
    if (!dpi && nombreSet.has(nombre.toLowerCase())) {
      omitidos.push({ fila: i + 1, nombre, motivo: 'ya existe nombre' })
      continue
    }

    const salario_mensual = Number(raw.salario_mensual) || 0
    const provisiones = calcularProvisiones(salario_mensual)

    const tipoPagoRaw = (raw.tipo_pago || 'efectivo').toLowerCase().trim()
    const tipo_pago = ['efectivo','transferencia','cheque'].includes(tipoPagoRaw) ? tipoPagoRaw : 'efectivo'

    const payload = {
      nombre,
      dpi,
      nit: raw.nit?.trim() || null,
      numero_igss: raw.numero_igss?.trim() || null,
      area: raw.area?.trim() || 'panaderia',
      puesto: raw.puesto?.trim() || 'Panadero',
      tipo_pago,
      banco: raw.banco?.trim() || null,
      numero_cuenta: raw.numero_cuenta?.trim() || null,
      fecha_ingreso: raw.fecha_ingreso || null,
      salario_mensual,
      bonificacion_quincenal: Number(raw.bonificacion_quincenal) || 0,
      bonificacion_segunda_quincena: Number(raw.bonificacion_segunda_quincena) || 0,
      notas: raw.notas?.trim() || null,
      created_by: auth.user.id,
      ...provisiones,
    }

    const { data: emp, error } = await auth.admin
      .from('empleados').insert(payload).select().single()
    if (error) {
      errores.push({ fila: i + 1, nombre, error: error.message })
      continue
    }
    if (dpi) dpiSet.add(dpi)
    nombreSet.add(nombre.toLowerCase())
    insertados.push({ id: emp.id, nombre })
  }

  return res.status(200).json({
    ok: true,
    insertados: insertados.length,
    omitidos: omitidos.length,
    errores: errores.length,
    detalle: { insertados, omitidos, errores },
  })
}
