// pages/api/fel/health-check.js
// GET /api/fel/health-check
// Smoke test contra Infile: arma una factura demo CF Q 1.00 en memoria, la
// firma+certifica, y guarda el resultado en facturas_fel para auditoria.
// Si el ambiente esta en 'demo', queda flag certificador='infile' y origen
// 'health_check'. Si certifica, devuelve uuid/serie/numero.
//
// NO crea items reales en la DB salvo despues de un certificado exitoso
// (idea: solo aparece en facturas_fel si Infile la acepta — si falla, no
// ensuciamos la tabla).

import { requireAdmin } from '../../../lib/auth'
import { crearCliente, InfileError } from '../../../lib/infile/client'
import { construirDteFactura } from '../../../lib/infile/construirDte'

const PRECIO_DEMO = 1.00  // Q 1.00 — minimo que SAT acepta sin problemas.

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  // 1. Cargar config
  const { data: config } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
  if (!config) {
    return res.status(400).json({
      ok: false, etapa: 'config',
      error: 'No hay config_fel. Cargá los datos del emisor y credenciales Infile en /configuracion-fel.',
    })
  }
  const faltan = []
  for (const k of ['nit_emisor', 'nombre_comercial', 'infile_alias_firma', 'infile_llave_firma', 'infile_llave_cert']) {
    if (!config[k]) faltan.push(k)
  }
  if (faltan.length > 0) {
    return res.status(400).json({
      ok: false, etapa: 'config',
      error: 'Faltan campos en config_fel: ' + faltan.join(', '),
    })
  }

  // 2. Crear borrador de factura demo
  const items = [{
    bien_o_servicio: 'B',
    descripcion: 'PRUEBA HEALTH-CHECK FEL (demo)',
    unidad_medida: 'UND',
    cantidad: 1,
    precio_unitario: PRECIO_DEMO,
    descuento: 0,
    subtotal: PRECIO_DEMO,
    afecta_iva: true,
    orden: 0,
  }]

  const facturaDraft = {
    id: cryptoRandomUUID(),  // se reusa como identificador Infile
    receptor_nit: 'CF',
    receptor_nombre: 'CONSUMIDOR FINAL',
    receptor_email: '',
    tipo_documento: 'FACT',
    moneda: 'GTQ',
    fecha_emision: new Date().toISOString(),
    frase_iva: '1',
    escenario_iva: 1,
  }

  let xmlInfo
  try {
    xmlInfo = construirDteFactura({ config, factura: facturaDraft, items })
  } catch (e) {
    return res.status(500).json({ ok: false, etapa: 'construir_xml', error: e.message })
  }

  // 3. Firmar + certificar
  let cert
  try {
    const client = crearCliente(config)
    cert = await client.firmarYCertificar(xmlInfo.xml, facturaDraft.id, { correoCopia: '' })
  } catch (e) {
    if (e instanceof InfileError) {
      return res.status(502).json({
        ok: false, etapa: e.etapa || 'infile',
        error: e.message,
        payload: e.payload,
        xml_que_fallo: xmlInfo.xml,
        ambiente: config.infile_ambiente,
      })
    }
    return res.status(500).json({ ok: false, etapa: 'infile_runtime', error: e.message })
  }

  if (!cert?.uuid) {
    return res.status(502).json({
      ok: false, etapa: 'cert_sin_uuid',
      error: 'Infile respondio sin uuid',
      respuesta_infile: cert?.raw,
    })
  }

  // 4. Guardar la factura demo en la DB (solo si Infile la aceptó).
  const { data: facturaInsertada, error: insErr } = await auth.admin
    .from('facturas_fel').insert({
      receptor_nit: 'CF',
      receptor_nombre: 'CONSUMIDOR FINAL',
      tipo_documento: 'FACT',
      moneda: 'GTQ',
      total_gravado: round2(PRECIO_DEMO / 1.12),
      total_exento: 0,
      iva: round2(PRECIO_DEMO - PRECIO_DEMO / 1.12),
      total: PRECIO_DEMO,
      estado: 'certificada',
      uuid_sat: cert.uuid,
      serie_sat: cert.serie,
      numero_sat: cert.numero,
      fecha_certificacion: new Date().toISOString(),
      certificador: 'infile',
      xml_dte: cert.xml_certificado || xmlInfo.xml,
      origen_tipo: 'health_check',
      notas: `Health-check ambiente ${config.infile_ambiente}`,
      creado_por: auth.user.id,
    })
    .select().single()

  if (insErr) {
    return res.status(207).json({
      ok: true,
      certificada: true,
      uuid: cert.uuid, serie: cert.serie, numero: cert.numero,
      warning: 'Infile certifico pero falló el INSERT local: ' + insErr.message,
      respuesta_infile: cert.raw,
    })
  }

  // Insertar items
  await auth.admin.from('facturas_fel_items').insert(items.map(it => ({
    factura_id: facturaInsertada.id,
    bien_o_servicio: it.bien_o_servicio,
    descripcion: it.descripcion,
    unidad_medida: it.unidad_medida,
    cantidad: it.cantidad,
    precio_unitario: it.precio_unitario,
    descuento: it.descuento,
    subtotal: it.subtotal,
    afecta_iva: it.afecta_iva,
    orden: it.orden,
  })))

  return res.status(200).json({
    ok: true,
    certificada: true,
    factura_id: facturaInsertada.id,
    uuid: cert.uuid,
    serie: cert.serie,
    numero: cert.numero,
    ambiente: config.infile_ambiente,
    mensaje: 'OK — Infile firmo y certifico la factura demo. Quedo en Facturación marcada como health_check.',
  })
}

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100 }

// UUID v4 sin dep externa. Node 19+ tiene crypto.randomUUID nativo en globalThis.
function cryptoRandomUUID() {
  try { return globalThis.crypto.randomUUID() } catch {}
  // Fallback rudimentario (Vercel siempre tiene crypto, esto no debería usarse).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

export const config = { maxDuration: 60 }
