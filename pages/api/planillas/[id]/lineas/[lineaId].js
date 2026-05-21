// pages/api/planillas/:id/lineas/:lineaId
// PATCH  -> editar campos de adicion/descuento. Recalcula IGSS y totales de planilla.
// DELETE -> quitar linea de la planilla (solo si planilla en borrador).

import { requireAdmin } from '../../../../../lib/auth'
import { calcularIgssLinea, calcularTotalesPlanilla } from '../../../../../lib/planillas'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id, lineaId } = req.query
  if (!id || !lineaId) return res.status(400).json({ error: 'id y lineaId requeridos' })

  // Verificar que la planilla es editable
  const { data: planilla } = await auth.admin
    .from('planillas').select('id, estado').eq('id', id).single()
  if (!planilla) return res.status(404).json({ error: 'Planilla no encontrada' })
  if (!['borrador', 'revision'].includes(planilla.estado)) {
    return res.status(400).json({ error: 'No se pueden editar lineas en estado ' + planilla.estado })
  }

  if (req.method === 'PATCH')  return update(req, res, auth, id, lineaId)
  if (req.method === 'DELETE') return borrar(req, res, auth, id, lineaId)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function update(req, res, auth, planillaId, lineaId) {
  const editables = [
    'horas_extra', 'comisiones', 'otros_ingresos', 'bonificacion_incentivo',
    'faltante_inventario', 'faltante_efectivo', 'prestamo_anticipo', 'embargo_deuda',
    'otros_descuentos', 'descuentos_varios', 'concepto', 'numero_cheque',
  ]
  const patch = {}
  for (const k of editables) if (req.body && k in req.body) {
    patch[k] = k === 'concepto' || k === 'numero_cheque' ? req.body[k] : (Number(req.body[k]) || 0)
  }

  // Necesitamos la linea actual para calcular IGSS sobre el resultado.
  const { data: actual } = await auth.admin
    .from('planilla_lineas').select('*').eq('id', lineaId).single()
  if (!actual) return res.status(404).json({ error: 'Linea no encontrada' })

  const merged = { ...actual, ...patch }
  patch.igss_empleado = calcularIgssLinea(merged)
  patch.updated_at = new Date().toISOString()

  const { data, error } = await auth.admin
    .from('planilla_lineas').update(patch).eq('id', lineaId).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })

  await recalcularTotales(auth, planillaId)

  return res.status(200).json({ ok: true, linea: data })
}

async function borrar(req, res, auth, planillaId, lineaId) {
  const { error } = await auth.admin.from('planilla_lineas').delete().eq('id', lineaId)
  if (error) return res.status(500).json({ ok: false, error: error.message })
  await recalcularTotales(auth, planillaId)
  return res.status(200).json({ ok: true })
}

async function recalcularTotales(auth, planillaId) {
  const { data: lineas } = await auth.admin
    .from('planilla_lineas').select('*').eq('planilla_id', planillaId)
  const totales = calcularTotalesPlanilla(lineas || [])
  await auth.admin.from('planillas').update({ ...totales, updated_at: new Date().toISOString() }).eq('id', planillaId)
}
