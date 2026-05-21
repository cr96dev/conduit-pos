// pages/api/liquidaciones/index.js
// GET  /api/liquidaciones?limit=50
// POST /api/liquidaciones    (admin) - body: { empleado_id, fecha_baja, tipo_baja, motivo?, dias_salario_pendiente?, deducciones?, notas? }
//   Crea la liquidacion calculada + marca al empleado como activo=false.

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { calcularLiquidacion } from '../../../lib/liquidaciones'
import { generarAsientoLiquidacion } from '../../../lib/contabilidad/generador'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { limit = 50 } = req.query
  const { data, error } = await auth.admin
    .from('liquidaciones').select('*')
    .order('fecha_baja', { ascending: false })
    .limit(Math.min(Number(limit) || 50, 200))
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, liquidaciones: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const {
    empleado_id, fecha_baja, tipo_baja, motivo,
    dias_salario_pendiente = 0, deducciones = 0, notas,
  } = req.body || {}

  if (!empleado_id) return res.status(400).json({ error: 'empleado_id requerido' })
  if (!fecha_baja || !/^\d{4}-\d{2}-\d{2}$/.test(fecha_baja)) return res.status(400).json({ error: 'fecha_baja invalida' })
  if (!['despido_injustificado','despido_justificado','renuncia_voluntaria'].includes(tipo_baja)) {
    return res.status(400).json({ error: 'tipo_baja invalido' })
  }

  const { data: empleado, error: eErr } = await auth.admin
    .from('empleados').select('*').eq('id', empleado_id).single()
  if (eErr || !empleado) return res.status(404).json({ error: 'Empleado no encontrado' })

  if (!empleado.fecha_ingreso) {
    return res.status(400).json({ error: 'El empleado no tiene fecha_ingreso. Editarlo y guardarla antes de liquidar.' })
  }

  const calc = calcularLiquidacion({
    empleado, fechaBaja: fecha_baja, tipoBaja: tipo_baja,
    diasSalarioPendiente: Number(dias_salario_pendiente) || 0,
    deducciones: Number(deducciones) || 0,
  })

  const { data: liquidacion, error: lErr } = await auth.admin
    .from('liquidaciones').insert({
      empleado_id: empleado.id,
      nombre: empleado.nombre,
      puesto: empleado.puesto,
      area: empleado.area,
      salario_mensual: empleado.salario_mensual,
      fecha_ingreso: empleado.fecha_ingreso,
      fecha_baja,
      tipo_baja,
      motivo: motivo?.trim() || null,
      anios_trabajados: calc.aniosTrabajados,
      meses_trabajados: calc.mesesTrabajados,
      dias_trabajados: calc.diasTrabajados,
      salario_promedio_6m: calc.salProm6m,
      indemnizacion: calc.indemnizacion,
      preaviso: calc.preaviso,
      vacaciones_pendientes: calc.vacaciones,
      dias_vacaciones: calc.diasVacProporcionales,
      aguinaldo_proporcional: calc.aguinaldo,
      dias_aguinaldo: calc.diasAguinaldo,
      bono14_proporcional: calc.bono14,
      dias_bono14: calc.diasBono14,
      salario_pendiente: calc.salarioPendiente,
      dias_salario_pendiente: calc.diasSalarioPendiente,
      total_bruto: calc.totalBruto,
      deducciones: calc.deducciones,
      total_neto: calc.totalNeto,
      notas: notas?.trim() || null,
      creado_por: auth.user.id,
    }).select().single()

  if (lErr) {
    console.error('[liquidaciones.create] ERROR:', lErr.message)
    return res.status(500).json({ ok: false, error: lErr.message })
  }

  // Marcar empleado como inactivo.
  await auth.admin.from('empleados')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('id', empleado.id)

  // Asiento contable automatico (best effort).
  const asiento = await generarAsientoLiquidacion(auth.admin, liquidacion.id, auth.user.id)
  if (!asiento.ok) console.warn('[liquidaciones.create] no se genero asiento:', asiento.error)

  return res.status(201).json({ ok: true, liquidacion, asiento })
}
