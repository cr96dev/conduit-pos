// pages/api/fel/facturas/:id/certificar
// POST: arma el XML DTE, lo firma+certifica con Infile/FEEL, guarda uuid+xml certificado.
//
// Modos:
//   - { manual: true, uuid_sat, serie_sat, numero_sat }
//       Registra como certificada con datos a mano (no llama a Infile).
//       Sigue funcionando como antes.
//   - sin body o body normal:
//       Camino real. Requiere config_fel con infile_alias_firma + llaves.
//
// El `identificador` que Infile correlaciona entre firmador y certificador
// usamos el `factura.id` (UUID de Postgres) — garantiza idempotencia.

import { requireAdmin } from '../../../../../lib/auth'
import { crearCliente, InfileError } from '../../../../../lib/infile/client'
import { construirDteFactura } from '../../../../../lib/infile/construirDte'

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

  const { data: items } = await auth.admin
    .from('facturas_fel_items').select('*').eq('factura_id', id).order('orden')

  // ============================================================
  // Modo manual (registrar certificación ingresada a mano)
  // ============================================================
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

  // ============================================================
  // Modo Infile/FEEL (camino real)
  // ============================================================
  const { data: config } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
  if (!config) {
    return res.status(400).json({ error: 'No hay config_fel. Configurá emisor y credenciales Infile en /configuracion-fel.' })
  }
  if (!config.infile_alias_firma || !config.infile_llave_firma || !config.infile_llave_cert) {
    return res.status(400).json({
      error: 'Credenciales Infile incompletas en config_fel. Faltan: infile_alias_firma, infile_llave_firma o infile_llave_cert.',
    })
  }

  // 1) Construir XML
  let xmlInfo
  try {
    xmlInfo = construirDteFactura({ config, factura, items })
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Error construyendo XML: ' + e.message })
  }

  // 2) Firmar + certificar
  try {
    const client = crearCliente(config)
    const cert = await client.firmarYCertificar(xmlInfo.xml, factura.id, {
      correoCopia: factura.receptor_email || '',
    })

    if (!cert.uuid) {
      const errMsg = 'Infile respondio sin uuid: ' + JSON.stringify(cert.raw).slice(0, 500)
      await auth.admin.from('facturas_fel').update({
        estado: 'error',
        error_mensaje: errMsg,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      return res.status(502).json({ ok: false, error: 'Respuesta de Infile sin uuid', respuesta: cert.raw })
    }

    const { data, error } = await auth.admin.from('facturas_fel').update({
      estado: 'certificada',
      uuid_sat: cert.uuid,
      serie_sat: cert.serie,
      numero_sat: cert.numero,
      fecha_certificacion: new Date().toISOString(),
      certificador: 'infile',
      xml_dte: cert.xml_certificado || xmlInfo.xml,
      error_mensaje: null,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select().single()
    if (error) return res.status(500).json({ ok: false, error: error.message })

    return res.status(200).json({
      ok: true,
      factura: data,
      uuid: cert.uuid,
      serie: cert.serie,
      numero: cert.numero,
      respuesta_infile: cert.raw,
    })
  } catch (e) {
    if (e instanceof InfileError) {
      await auth.admin.from('facturas_fel').update({
        estado: 'error',
        error_mensaje: `[${e.etapa || 'infile'}] ${e.message}`,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      return res.status(502).json({ ok: false, error: e.message, etapa: e.etapa, payload: e.payload })
    }
    console.error('[fel.certificar] ERROR:', e)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

export const config = { maxDuration: 60 }
