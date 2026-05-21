// pages/api/fel/consultar-nit.js
// GET /api/fel/consultar-nit?nit=XXXXX
// Consulta el RTU de Digifact para obtener nombre/direccion del contribuyente.
// Solo funciona si hay token Digifact configurado.

import { requireAuth } from '../../../lib/auth'
import { crearCliente, DigifactError } from '../../../lib/digifact/client'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { nit } = req.query
  if (!nit || nit === 'CF') return res.status(400).json({ error: 'NIT valido requerido' })

  const { data: config } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
  if (!config?.digifact_token) {
    return res.status(503).json({ error: 'Token Digifact no configurado. No se puede consultar el RTU.' })
  }

  try {
    const client = crearCliente(config)
    const r = await client.consultarReceptor(nit)
    // Normalizar respuesta — el formato exacto depende de Digifact:
    const receptor = {
      nombre: r?.NombreCompleto || r?.Nombre || r?.nombre || null,
      direccion: r?.Direccion || r?.direccion || null,
      raw: r,
    }
    return res.status(200).json({ ok: true, receptor })
  } catch (e) {
    if (e instanceof DigifactError) {
      return res.status(502).json({ ok: false, error: e.message })
    }
    return res.status(500).json({ ok: false, error: e.message })
  }
}
