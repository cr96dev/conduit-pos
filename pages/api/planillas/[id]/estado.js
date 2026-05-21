// pages/api/planillas/[id]/estado.js
// POST /api/planillas/:id/estado  -> { nuevo_estado, notas? }
// Transiciones permitidas:
//   borrador -> revision
//   revision -> aprobada | borrador (rechazo)
//   aprobada -> pagada | borrador (revertir)
//   pagada   -> (final, no se cambia)

import { requireAdmin } from '../../../../lib/auth'
import { generarAsientoPlanillaPagada } from '../../../../lib/contabilidad/generador'

const TRANSICIONES = {
  borrador: ['revision'],
  revision: ['aprobada', 'borrador'],
  aprobada: ['pagada', 'borrador'],
  pagada:   [],
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  const { nuevo_estado, notas } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id requerido' })
  if (!nuevo_estado) return res.status(400).json({ error: 'nuevo_estado requerido' })

  const { data: actual } = await auth.admin.from('planillas').select('estado').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'Planilla no encontrada' })

  const permitidos = TRANSICIONES[actual.estado] || []
  if (!permitidos.includes(nuevo_estado)) {
    return res.status(400).json({ error: `Transicion no permitida: ${actual.estado} -> ${nuevo_estado}` })
  }

  const patch = { estado: nuevo_estado, updated_at: new Date().toISOString() }
  if (nuevo_estado === 'aprobada') {
    patch.aprobado_por = auth.user.id
    patch.aprobado_en = new Date().toISOString()
  } else if (nuevo_estado === 'borrador') {
    patch.aprobado_por = null
    patch.aprobado_en = null
  }

  const { data, error } = await auth.admin.from('planillas').update(patch).eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })

  await auth.admin.from('planilla_auditoria').insert({
    planilla_id: id,
    accion: nuevo_estado === 'borrador' && actual.estado !== 'borrador' ? 'rechazada' : nuevo_estado,
    usuario_id: auth.user.id,
    usuario_email: auth.user.email,
    notas: notas?.trim() || null,
  })

  // Si paso a "pagada", generar asiento contable (best effort).
  let asiento = null
  if (nuevo_estado === 'pagada') {
    asiento = await generarAsientoPlanillaPagada(auth.admin, id, auth.user.id)
    if (!asiento.ok) console.warn('[planillas.estado] no se genero asiento:', asiento.error)
  }

  return res.status(200).json({ ok: true, planilla: data, asiento })
}
