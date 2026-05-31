// pages/api/fel/consultar-cui.js
// GET /api/fel/consultar-cui?cui=XXXXXXXXXXXXX
//
// Consulta el CUI (DPI guatemalteco, 13 digitos) contra Infile -> SAT.
// Devuelve nombre del titular y bloquea si la persona figura fallecida.
//
// Sirve para autocompletar el nombre del receptor cuando el cliente da DPI
// en lugar de NIT (personas naturales sin negocio).

import { requireAuth } from '../../../lib/auth'
import { crearCliente, InfileError } from '../../../lib/infile/client'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { cui } = req.query
  const cuiLimpio = String(cui || '').replace(/\D/g, '')
  if (!cuiLimpio) return res.status(400).json({ error: 'CUI requerido' })
  if (cuiLimpio.length !== 13) {
    return res.status(400).json({
      error: `CUI debe tener exactamente 13 dígitos (recibido ${cuiLimpio.length})`,
    })
  }

  const { data: config } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
  if (!config?.infile_alias_firma || !config?.infile_llave_cert) {
    return res.status(503).json({
      error: 'Credenciales Infile no configuradas. No se puede consultar CUI.',
    })
  }

  try {
    const client = crearCliente(config)
    const r = await client.consultarCui(cuiLimpio)

    if (r.no_encontrado) {
      return res.status(200).json({
        ok: true,
        receptor: null,
        mensaje: r.mensaje || 'CUI no encontrado en RENAP',
      })
    }

    if (r.fallecido) {
      // No bloqueo en backend pero aviso fuerte al front. El cajero decide
      // si quiere igual emitir la factura (a veces el familiar paga el ultimo
      // consumo en una panaderia, etc).
      return res.status(200).json({
        ok: true,
        receptor: { cui: r.cui, nombre: r.nombre },
        fallecido: true,
        mensaje: '⚠️ La persona figura como FALLECIDA en RENAP. Verificá antes de emitir.',
      })
    }

    return res.status(200).json({
      ok: true,
      receptor: { cui: r.cui, nombre: r.nombre },
    })
  } catch (e) {
    if (e instanceof InfileError) {
      return res.status(502).json({ ok: false, error: e.message, etapa: e.etapa })
    }
    return res.status(500).json({ ok: false, error: e.message })
  }
}
