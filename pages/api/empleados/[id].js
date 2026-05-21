// pages/api/empleados/[id].js
// PATCH /api/empleados/:id  -> admin. Si cambia salario_mensual, recalcula provisiones.
// DELETE /api/empleados/:id -> baja logica (activo=false)

import { requireAdmin } from '../../../lib/auth'
import { calcularProvisiones } from '../../../lib/planillas'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'PATCH')  return update(req, res, auth, id)
  if (req.method === 'DELETE') return baja(req, res, auth, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function update(req, res, auth, id) {
  const editables = [
    'nombre', 'dpi', 'nit', 'numero_igss', 'area', 'puesto', 'tipo_pago',
    'banco', 'numero_cuenta', 'fecha_ingreso', 'salario_mensual',
    'bonificacion_quincenal', 'bonificacion_segunda_quincena', 'notas', 'activo',
  ]
  const patch = {}
  for (const k of editables) if (req.body && k in req.body) patch[k] = req.body[k]
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Sin cambios' })

  // Si cambia el salario_mensual, recalcular provisiones.
  if ('salario_mensual' in patch) {
    const sm = Number(patch.salario_mensual) || 0
    Object.assign(patch, calcularProvisiones(sm))
    patch.salario_mensual = sm
  }
  patch.updated_at = new Date().toISOString()

  const { data, error } = await auth.admin
    .from('empleados').update(patch).eq('id', id).select().single()
  if (error) {
    console.error('[empleados.update] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, empleado: data })
}

async function baja(req, res, auth, id) {
  const { data, error } = await auth.admin
    .from('empleados').update({ activo: false, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, empleado: data })
}
