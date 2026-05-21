// pages/api/cierres/[id]/cerrar.js
// POST /api/cierres/:id/cerrar    -> bloquea el cierre (estado=cerrado, admin)
// POST /api/cierres/:id/reabrir   (este archivo NO; ver reabrir.js)

import { requireAdmin } from '../../../../lib/auth'
import { generarAsientoCierreCaja } from '../../../../lib/contabilidad/generador'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  const { data: actual } = await auth.admin
    .from('cierres_caja').select('estado, conteo_efectivo').eq('id', id).single()
  if (!actual) return res.status(404).json({ error: 'Cierre no encontrado' })
  if (actual.estado === 'cerrado') return res.status(400).json({ error: 'Ya esta cerrado' })
  if (actual.conteo_efectivo == null) {
    return res.status(400).json({ error: 'Debe registrarse el conteo de efectivo antes de cerrar' })
  }

  const { data, error } = await auth.admin
    .from('cierres_caja')
    .update({
      estado: 'cerrado',
      cerrado_at: new Date().toISOString(),
      cerrado_by: auth.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).eq('estado', 'abierto')
    .select().single()

  if (error || !data) {
    return res.status(500).json({ ok: false, error: error?.message || 'No se pudo cerrar' })
  }

  // Generar asiento contable automatico (best effort, no aborta el cierre).
  const asiento = await generarAsientoCierreCaja(auth.admin, id, auth.user.id)
  if (!asiento.ok) console.warn('[cierres.cerrar] no se genero asiento:', asiento.error)

  return res.status(200).json({ ok: true, cierre: data, asiento })
}
