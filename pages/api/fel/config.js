// pages/api/fel/config.js
// GET  /api/fel/config  -> admin (contiene token)
// PUT  /api/fel/config  -> admin

import { requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  if (req.method === 'GET') {
    const { data } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
    return res.status(200).json({ ok: true, config: data })
  }
  if (req.method === 'PUT') {
    const editables = [
      'nit_emisor','nombre_comercial','razon_social','direccion','codigo_postal',
      'municipio','departamento','pais','afiliacion_iva','codigo_establecimiento',
      'email_emisor','telefono_emisor',
      // Infile / FEEL
      'infile_url_firma','infile_url_cert','infile_url_consulta_nit',
      'infile_alias_firma','infile_llave_firma',
      'infile_usuario_cert','infile_llave_cert',
      'infile_ambiente','infile_frases_extras',
      // Digifact (legacy — se mantiene editable hasta limpiar la migracion)
      'digifact_url_base','digifact_token',
      'digifact_token_vence','digifact_usuario','digifact_ambiente',
    ]
    const patch = {}
    for (const k of editables) if (req.body && k in req.body) patch[k] = req.body[k]
    if (!patch.nit_emisor || !patch.nombre_comercial) {
      return res.status(400).json({ error: 'nit_emisor y nombre_comercial requeridos' })
    }
    patch.updated_at = new Date().toISOString()
    patch.updated_by = auth.user.id

    const { data: actual } = await auth.admin.from('config_fel').select('id').limit(1).maybeSingle()
    const result = actual
      ? await auth.admin.from('config_fel').update(patch).eq('id', actual.id).select().single()
      : await auth.admin.from('config_fel').insert(patch).select().single()
    if (result.error) return res.status(500).json({ ok: false, error: result.error.message })
    return res.status(200).json({ ok: true, config: result.data })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
