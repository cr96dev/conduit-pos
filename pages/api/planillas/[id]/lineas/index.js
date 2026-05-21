// pages/api/planillas/[id]/lineas/index.js
// GET  /api/planillas/:id/lineas              -> lista de lineas
// POST /api/planillas/:id/lineas              -> "generar" desde empleados activos
//                                                  Body: { regenerar?: true }  // borra y recrea

import { requireAuth, requireAdmin } from '../../../../../lib/auth'
import { calcularIgssLinea, calcularTotalesPlanilla, round2 } from '../../../../../lib/planillas'

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET')  return list(req, res, id)
  if (req.method === 'POST') return generar(req, res, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res, id) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data, error } = await auth.admin
    .from('planilla_lineas').select('*').eq('planilla_id', id)
    .order('area').order('nombre')
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, lineas: data })
}

async function generar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  // Verificar planilla
  const { data: planilla } = await auth.admin
    .from('planillas').select('id, quincena, periodo, estado').eq('id', id).single()
  if (!planilla) return res.status(404).json({ error: 'Planilla no encontrada' })
  if (planilla.estado !== 'borrador') {
    return res.status(400).json({ error: 'Solo se pueden generar lineas en borrador' })
  }

  const regenerar = !!req.body?.regenerar
  const { data: existentes } = await auth.admin
    .from('planilla_lineas').select('id').eq('planilla_id', id).limit(1)
  if ((existentes?.length || 0) > 0 && !regenerar) {
    return res.status(400).json({ error: 'Ya hay lineas. Pasa regenerar=true para reemplazarlas.' })
  }
  if (regenerar) {
    await auth.admin.from('planilla_lineas').delete().eq('planilla_id', id)
  }

  // Empleados activos
  const { data: emps, error: eErr } = await auth.admin
    .from('empleados').select('*').eq('activo', true).order('area').order('nombre')
  if (eErr) return res.status(500).json({ ok: false, error: eErr.message })
  if (!emps?.length) return res.status(400).json({ error: 'No hay empleados activos' })

  const nuevas = emps.map(e => {
    const bonifQ   = Number(e.bonificacion_quincenal) || 0
    const bonif2da = planilla.quincena === 2 ? (Number(e.bonificacion_segunda_quincena) || 0) : 0
    const otros_ingresos = round2(bonifQ + bonif2da)
    const baseLinea = {
      planilla_id: id,
      empleado_id: e.id,
      nombre: e.nombre, area: e.area, puesto: e.puesto,
      tipo_pago: e.tipo_pago, banco: e.banco, numero_cuenta: e.numero_cuenta,
      salario_quincenal: e.salario_quincenal,
      bono14_quincenal: e.bono14_quincenal,
      aguinaldo_quincenal: e.aguinaldo_quincenal,
      vacaciones_quincenal: e.vacaciones_quincenal,
      horas_extra: 0, comisiones: 0, otros_ingresos,
      bonificacion_incentivo: 0,
      faltante_inventario: 0, faltante_efectivo: 0,
      prestamo_anticipo: 0, embargo_deuda: 0, otros_descuentos: 0, descuentos_varios: 0,
      igss_patronal: e.igss_patronal_mensual,
      irtra: e.irtra_mensual,
      intecap: e.intecap_mensual,
      indemnizacion: e.indemnizacion_mensual,
      costo_patronal_total: e.costo_patronal_quincenal,
      concepto: planilla.periodo,
    }
    return { ...baseLinea, igss_empleado: calcularIgssLinea(baseLinea) }
  })

  const { error: iErr } = await auth.admin.from('planilla_lineas').insert(nuevas)
  if (iErr) return res.status(500).json({ ok: false, error: iErr.message })

  // Recalcular totales en cabecera.
  const totales = calcularTotalesPlanilla(nuevas)
  await auth.admin.from('planillas').update({ ...totales, updated_at: new Date().toISOString() }).eq('id', id)

  return res.status(201).json({ ok: true, generadas: nuevas.length })
}
