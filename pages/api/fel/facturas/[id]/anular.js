// pages/api/fel/facturas/:id/anular
// POST { motivo } - anula factura certificada. Si esta certificada con Infile y
// hay credenciales, intenta anular contra Infile/FEEL antes de marcar localmente.

import { requireAdmin } from '../../../../../lib/auth'
import { crearCliente, InfileError } from '../../../../../lib/infile/client'
import { construirDteAnulacion } from '../../../../../lib/infile/construirDte'

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

  // Si esta certificada por Infile, intentar anular en Infile primero.
  if (factura.estado === 'certificada' && factura.uuid_sat && factura.certificador === 'infile') {
    const { data: config } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
    if (config?.infile_alias_firma && config.infile_llave_firma && config.infile_llave_cert) {
      try {
        const xmlAnulacion = construirDteAnulacion({ config, factura, motivo })
        const client = crearCliente(config)
        // identificador unico para la anulacion: id de factura + '-anul'
        await client.anular(xmlAnulacion, `${factura.id}-anul`, { correoCopia: factura.receptor_email || '' })
      } catch (e) {
        if (e instanceof InfileError) {
          return res.status(502).json({ ok: false, error: 'Infile rechazo la anulacion: ' + e.message, etapa: e.etapa })
        }
        throw e
      }
    }
  }
  // Si es manual o no hay credenciales, anulamos solo localmente (compat con flujo anterior).

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

export const config = { maxDuration: 60 }
