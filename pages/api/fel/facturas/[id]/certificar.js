// pages/api/fel/facturas/:id/certificar
// POST: arma XML, llama a Digifact, guarda uuid_sat y XML certificado.
//
// Modos:
//   - Si NO hay token Digifact configurado, devuelve 400 con un mensaje claro.
//   - Si hay token, intenta certificar y actualiza estado.
//
// Tambien admite "modo manual" si llega body { manual: true, uuid_sat, serie_sat, numero_sat }:
//   marca la factura como certificada con esos datos, sin llamar a Digifact.
//   Util mientras no se tenga API funcionando.

import { requireAdmin } from '../../../../../lib/auth'
import { crearCliente, construirXMLDte, DigifactError } from '../../../../../lib/digifact/client'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  // Cargar factura + items
  const { data: factura } = await auth.admin.from('facturas_fel').select('*').eq('id', id).single()
  if (!factura) return res.status(404).json({ error: 'No encontrada' })
  if (factura.estado === 'certificada') return res.status(400).json({ error: 'Ya certificada' })
  if (factura.estado === 'anulada')     return res.status(400).json({ error: 'Anulada' })

  const { data: items } = await auth.admin.from('facturas_fel_items').select('*').eq('factura_id', id).order('orden')

  // Modo manual (registrar certificación ingresada a mano)
  if (req.body?.manual) {
    const { uuid_sat, serie_sat, numero_sat } = req.body
    if (!uuid_sat?.trim()) return res.status(400).json({ error: 'uuid_sat requerido en modo manual' })
    const { data, error } = await auth.admin.from('facturas_fel').update({
      estado: 'certificada',
      uuid_sat: uuid_sat.trim(),
      serie_sat: serie_sat?.trim() || null,
      numero_sat: numero_sat?.trim() || null,
      fecha_certificacion: new Date().toISOString(),
      certificador: 'manual',
      error_mensaje: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select().single()
    if (error) return res.status(500).json({ ok: false, error: error.message })
    return res.status(200).json({ ok: true, factura: data, modo: 'manual' })
  }

  // Modo Digifact
  const { data: config } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
  if (!config) return res.status(400).json({ error: 'No hay config_fel. Configurar emisor y token Digifact.' })
  if (!config.digifact_token) {
    return res.status(400).json({ error: 'Token Digifact no configurado. Solicitarlo a soporte@digifact.com.gt y guardarlo en /configuracion FEL.' })
  }

  let xmlDte
  try {
    xmlDte = construirXMLDte({ config, factura, items })
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Error construyendo XML: ' + e.message })
  }

  try {
    const client = crearCliente(config)
    const respuesta = await client.certificarDTE(xmlDte)

    // El parseo de la respuesta depende del formato exacto que devuelva Digifact.
    // Esperamos algun campo tipo "Uuid", "Serie", "Numero" o equivalente.
    const uuidSat = respuesta?.uuid || respuesta?.Uuid || respuesta?.uuid_sat || null
    const serieSat = respuesta?.serie || respuesta?.Serie || null
    const numeroSat = respuesta?.numero || respuesta?.Numero || null

    if (!uuidSat) {
      // Guardamos el error pero no fallamos catastróficamente
      await auth.admin.from('facturas_fel').update({
        estado: 'error',
        error_mensaje: 'Digifact respondio sin uuid: ' + JSON.stringify(respuesta).slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      return res.status(502).json({ ok: false, error: 'Respuesta de Digifact sin uuid', respuesta })
    }

    const { data, error } = await auth.admin.from('facturas_fel').update({
      estado: 'certificada',
      uuid_sat: uuidSat,
      serie_sat: serieSat,
      numero_sat: numeroSat,
      fecha_certificacion: new Date().toISOString(),
      certificador: 'digifact',
      xml_dte: xmlDte,
      error_mensaje: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select().single()
    if (error) return res.status(500).json({ ok: false, error: error.message })

    return res.status(200).json({ ok: true, factura: data, respuesta_digifact: respuesta })
  } catch (e) {
    if (e instanceof DigifactError) {
      await auth.admin.from('facturas_fel').update({
        estado: 'error',
        error_mensaje: e.message,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      return res.status(502).json({ ok: false, error: e.message, payload: e.payload })
    }
    console.error('[fel.certificar] ERROR:', e)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
