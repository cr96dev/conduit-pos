// pages/api/fel/facturas/:id/anular
// POST { motivo } - anula factura certificada (intenta llamar a Digifact si hay token).

import { requireAdmin } from '../../../../../lib/auth'
import { crearCliente, DigifactError } from '../../../../../lib/digifact/client'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  const { motivo } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id requerido' })
  if (!motivo?.trim()) return res.status(400).json({ error: 'motivo requerido' })

  const { data: factura } = await auth.admin.from('facturas_fel').select('*').eq('id', id).single()
  if (!factura) return res.status(404).json({ error: 'No encontrada' })
  if (factura.estado === 'anulada') return res.status(400).json({ error: 'Ya anulada' })

  // Si esta certificada y hay token, intentar anular en Digifact.
  if (factura.estado === 'certificada' && factura.uuid_sat) {
    const { data: config } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
    if (config?.digifact_token) {
      try {
        const client = crearCliente(config)
        await client.anularDTE(factura.uuid_sat, motivo)
      } catch (e) {
        if (e instanceof DigifactError) {
          return res.status(502).json({ ok: false, error: 'Digifact rechazo la anulacion: ' + e.message })
        }
        throw e
      }
    }
  }

  const { data, error } = await auth.admin.from('facturas_fel').update({
    estado: 'anulada',
    fecha_anulacion: new Date().toISOString(),
    motivo_anulacion: motivo.trim(),
    anulada_por: auth.user.id,
    updated_at: new Date().toISOString(),
  }).eq('id', id).select().single()
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, factura: data })
}
