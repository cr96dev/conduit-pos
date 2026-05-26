// pages/api/fel/consultar-nit.js
// GET /api/fel/consultar-nit?nit=XXXXX
// Consulta el RTU de Infile (consultareceptores.feel.com.gt) para obtener el
// nombre del receptor. Solo funciona si hay credenciales Infile cargadas.

import { requireAuth } from '../../../lib/auth'
import { crearCliente, InfileError } from '../../../lib/infile/client'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { nit } = req.query
  if (!nit || nit === 'CF') return res.status(400).json({ error: 'NIT valido requerido' })

  const { data: config } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
  if (!config?.infile_alias_firma || !config?.infile_llave_cert) {
    return res.status(503).json({ error: 'Credenciales Infile no configuradas. No se puede consultar el RTU.' })
  }

  try {
    const client = crearCliente(config)
    const r = await client.consultarNit(nit)
    if (r.no_encontrado) {
      return res.status(200).json({ ok: true, receptor: null, mensaje: r.mensaje || 'NIT no encontrado', raw: r.raw })
    }
    return res.status(200).json({
      ok: true,
      receptor: { nit: r.nit, nombre: r.nombre },
      raw: r.raw,
    })
  } catch (e) {
    if (e instanceof InfileError) {
      return res.status(502).json({ ok: false, error: e.message, etapa: e.etapa })
    }
    return res.status(500).json({ ok: false, error: e.message })
  }
}
