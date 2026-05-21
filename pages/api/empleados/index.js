// pages/api/empleados/index.js
// GET  /api/empleados?incluir_inactivos=1
// POST /api/empleados          -> admin
//
// El POST recibe { nombre, salario_mensual, area?, puesto?, ... } y la API
// calcula y guarda todas las provisiones derivadas (igss, costos patronales, etc).

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { calcularProvisiones } from '../../../lib/planillas'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { incluir_inactivos } = req.query
  let q = auth.admin.from('empleados').select('*').order('nombre')
  if (incluir_inactivos !== '1') q = q.eq('activo', true)

  const { data, error } = await q
  if (error) {
    console.error('[empleados.list] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, empleados: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const body = req.body || {}
  if (!body.nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' })

  const salario_mensual = Number(body.salario_mensual) || 0
  const provisiones = calcularProvisiones(salario_mensual)

  const payload = {
    nombre: body.nombre.trim(),
    dpi: body.dpi?.trim() || null,
    nit: body.nit?.trim() || null,
    numero_igss: body.numero_igss?.trim() || null,
    area: body.area?.trim() || 'panaderia',
    puesto: body.puesto?.trim() || 'Panadero',
    tipo_pago: body.tipo_pago || 'efectivo',
    banco: body.banco?.trim() || null,
    numero_cuenta: body.numero_cuenta?.trim() || null,
    fecha_ingreso: body.fecha_ingreso || null,
    salario_mensual,
    bonificacion_quincenal: Number(body.bonificacion_quincenal) || 0,
    bonificacion_segunda_quincena: Number(body.bonificacion_segunda_quincena) || 0,
    notas: body.notas?.trim() || null,
    created_by: auth.user.id,
    ...provisiones,
  }

  const { data, error } = await auth.admin.from('empleados').insert(payload).select().single()
  if (error) {
    console.error('[empleados.create] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(201).json({ ok: true, empleado: data })
}
