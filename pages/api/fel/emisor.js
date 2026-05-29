// pages/api/fel/emisor.js
// GET /api/fel/emisor
//
// Devuelve los datos publicos del emisor (los que salen en el ticket
// impreso). NO devuelve credenciales ni token. Cualquier rol operativo
// puede leerlo (admin, cajero, barista).

import { requireAuth } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data, error } = await auth.admin
    .from('config_fel')
    .select(`
      nit_emisor, nombre_comercial, razon_social,
      direccion, codigo_postal, municipio, departamento, pais,
      codigo_establecimiento, email_emisor, telefono_emisor,
      afiliacion_iva
    `)
    .limit(1)
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'config_fel no inicializado' })

  return res.status(200).json({ ok: true, emisor: data })
}
