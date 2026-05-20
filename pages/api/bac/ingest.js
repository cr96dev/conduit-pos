// pages/api/bac/ingest.js
//
// Endpoint que recibe PDFs de BAC desde Apps Script de Gmail.
// Valida HMAC, parsea el PDF, inserta en bac_consumos (idempotente)
// y actualiza el agregado en ventas.bac o tienda_ventas.tarjeta.

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { extractText, getDocumentProxy } from 'unpdf'

export const config = { api: { bodyParser: false } }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

function verifyHmac(rawBody, signature) {
  if (!signature || !process.env.BAC_HMAC_SECRET) return false
  const h = crypto.createHmac('sha256', process.env.BAC_HMAC_SECRET)
  h.update(rawBody)
  const computed = h.digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))
  } catch { return false }
}

// Parse fecha DD-MM-YYYY a YYYY-MM-DD
function parseFecha(s) {
  if (!s) return null
  const m = s.match(/(\d{2})-(\d{2})-(\d{4})/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

function num(s) {
  if (!s) return null
  const clean = String(s).replace(/,/g, '').replace(/[^\d.-]/g, '')
  const v = parseFloat(clean)
  return isNaN(v) ? null : v
}

async function parsePdfText(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text } = await extractText(pdf, { mergePages: true })
  return text
}

function extractFields(text) {
  // Liquidación No.
  const liq = text.match(/LIQUIDACI[ÓO]N\s*No\.?\s*(\d+)/i)?.[1]
                || text.match(/LIQUIDACI[ÓO]N\s*N[°o]?\s*(\d+)/i)?.[1]
  // No. Afiliado
  const afi = text.match(/No\.?\s*Afiliado\s*:?\s*(\d+)/i)?.[1]
  // Lote POS
  const lote = text.match(/Lote\s*POS\s*:?\s*(\d+)/i)?.[1]
  // Cuenta destino
  const cta = text.match(/Acreditado\s*a\s*la\s*Cta\s*:?\s*(\d+)/i)?.[1]
  // Fechas
  const fechaRem = parseFecha(text.match(/Fecha\s*de\s*Remisi[óo]n\s*:?\s*(\d{2}-\d{2}-\d{4})/i)?.[1])
  const fechaPag = parseFecha(text.match(/Fecha\s*de\s*Pago\s*:?\s*(\d{2}-\d{2}-\d{4})/i)?.[1])
  // Cantidad
  const cantidad = text.match(/(\d+)\s+Total\s*de\s*ventas/i)?.[1]
  // Montos
  const totalVentas = num(text.match(/Total\s*de\s*ventas[\.\s]*([\d,]+\.\d{2})/i)?.[1])
  const comision    = num(text.match(/Comisi[óo]n[\.\s]*([\d,]+\.\d{2})/i)?.[1])
  const creditoIva  = num(text.match(/Cr[eé]dito\s*fiscal\s*\(IVA\)[\.\s]*([\d,]+\.\d{2})/i)?.[1])
  const retencion   = num(text.match(/Retenci[óo]n[^\d]*([\d,]+\.\d{2})/i)?.[1])
  const neto        = num(text.match(/Neto\s*pagado[\.\s]*([\d,]+\.\d{2})/i)?.[1])

  return {
    liquidacion_no: liq,
    no_afiliado: afi,
    lote_pos: lote,
    cuenta_destino: cta,
    fecha_remision: fechaRem,
    fecha_pago: fechaPag,
    cantidad_transac: cantidad ? parseInt(cantidad, 10) : null,
    total_ventas: totalVentas,
    comision: comision,
    credito_fiscal_iva: creditoIva,
    retencion_iva: retencion,
    neto_pagado: neto
  }
}

async function notificarAfiliadoDesconocido({ noAfiliado, liquidacionNo, fechaRem, totalVentas, pdfFilename }) {
  if (!process.env.BREVO_API_KEY) return
  try {
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        sender: { name: 'GasOps BAC', email: 'noreply@hidrocom.net' },
        to: [{ email: 'adoffice569@gmail.com', name: 'Charles' }],
        subject: `Afiliado BAC desconocido: ${noAfiliado}`,
        htmlContent: `
          <p>BAC envió un PDF con un número de afiliado que no está mapeado:</p>
          <ul>
            <li><b>No. Afiliado:</b> ${noAfiliado}</li>
            <li><b>Liquidación:</b> ${liquidacionNo}</li>
            <li><b>Fecha Remisión:</b> ${fechaRem}</li>
            <li><b>Total ventas:</b> Q ${totalVentas}</li>
            <li><b>PDF:</b> ${pdfFilename}</li>
          </ul>
          <p>Agregalo en <code>bac_afiliaciones</code> para que se procese automáticamente.</p>
        `
      })
    })
  } catch (e) {
    console.error('Brevo notify failed:', e.message)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  // Body raw para HMAC
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const rawBody = Buffer.concat(chunks).toString('utf-8')

  // HMAC
  const sig = req.headers['x-gasops-signature']
  if (!verifyHmac(rawBody, sig)) {
    return res.status(401).json({ error: 'invalid signature' })
  }
 
  let payload
  try { payload = JSON.parse(rawBody) } catch { return res.status(400).json({ error: 'invalid json' }) }

  const { pdfBase64, emailMessageId, pdfFilename } = payload
  if (!pdfBase64) return res.status(400).json({ error: 'missing pdfBase64' })

  // Parse PDF
  let text
  try {
    const buffer = Buffer.from(pdfBase64, 'base64')
    text = await parsePdfText(buffer)
  } catch (e) {
    return res.status(400).json({ error: 'pdf parse failed', detail: e.message })
  }

  const fields = extractFields(text)

  if (!fields.liquidacion_no || !fields.no_afiliado || fields.total_ventas == null || !fields.fecha_remision) {
    return res.status(422).json({
      error: 'missing required fields in PDF',
      parsed: fields
    })
  }

  // Idempotencia: si ya existe la liquidación, terminar OK
  const { data: existing } = await supabase
    .from('bac_consumos')
    .select('id, estado')
    .eq('liquidacion_no', fields.liquidacion_no)
    .maybeSingle()
  if (existing) {
    return res.status(200).json({
      ok: true,
      duplicate: true,
      liquidacion_no: fields.liquidacion_no,
      estado_actual: existing.estado
    })
  }

  // Lookup afiliado
  const { data: afi } = await supabase
    .from('bac_afiliaciones')
    .select('estacion_id, categoria, activo')
    .eq('no_afiliado', fields.no_afiliado)
    .maybeSingle()

  if (!afi || !afi.activo) {
    // Registrar como afiliado_desconocido y notificar
    await supabase.from('bac_consumos').insert({
      liquidacion_no: fields.liquidacion_no,
      no_afiliado: fields.no_afiliado,
      fecha_remision: fields.fecha_remision,
      fecha_pago: fields.fecha_pago,
      lote_pos: fields.lote_pos,
      cuenta_destino: fields.cuenta_destino,
      cantidad_transac: fields.cantidad_transac,
      total_ventas: fields.total_ventas,
      comision: fields.comision,
      credito_fiscal_iva: fields.credito_fiscal_iva,
      retencion_iva: fields.retencion_iva,
      neto_pagado: fields.neto_pagado,
      email_message_id: emailMessageId,
      pdf_filename: pdfFilename,
      estado: 'afiliado_desconocido'
    })
    await notificarAfiliadoDesconocido({
      noAfiliado: fields.no_afiliado,
      liquidacionNo: fields.liquidacion_no,
      fechaRem: fields.fecha_remision,
      totalVentas: fields.total_ventas,
      pdfFilename
    })
    return res.status(200).json({ ok: true, estado: 'afiliado_desconocido', no_afiliado: fields.no_afiliado })
  }

  // Resolver fila destino y aplicar agregado
  const eid = afi.estacion_id
  const fecha = fields.fecha_remision
  let aplicadoATabla, aplicadoAId, valorAnterior, valorNuevo, estado, errorMsg

  try {
    if (afi.categoria === 'combustible') {
      const { data: ventaRow } = await supabase
        .from('ventas')
        .select('id, bac')
        .eq('estacion_id', eid)
        .eq('fecha', fecha)
        .maybeSingle()

      if (!ventaRow) {
        // No hay fila destino aún → registrar pendiente
        estado = 'sin_venta_destino'
      } else {
        // Sumar todos los consumos aplicados de ese día+estación + el actual
        const { data: previos } = await supabase
          .from('bac_consumos')
          .select('total_ventas')
          .eq('estacion_id', eid)
          .eq('fecha_remision', fecha)
          .eq('categoria', 'combustible')
          .eq('estado', 'aplicado')

        const sumaPrevia = (previos || []).reduce((s, x) => s + parseFloat(x.total_ventas || 0), 0)
        valorAnterior = parseFloat(ventaRow.bac || 0)
        valorNuevo = sumaPrevia + parseFloat(fields.total_ventas)

        const { error } = await supabase
          .from('ventas')
          .update({ bac: valorNuevo, qbo_processed: false })
          .eq('id', ventaRow.id)
        if (error) throw error

        aplicadoATabla = 'ventas'
        aplicadoAId = ventaRow.id
        estado = 'aplicado'
      }
    } else if (afi.categoria === 'tienda') {
      const { data: tiendaRow } = await supabase
        .from('tienda_ventas')
        .select('id, tarjeta')
        .eq('estacion_id', eid)
        .eq('fecha', fecha)
        .maybeSingle()

      if (!tiendaRow) {
        estado = 'sin_venta_destino'
      } else {
        const { data: previos } = await supabase
          .from('bac_consumos')
          .select('total_ventas')
          .eq('estacion_id', eid)
          .eq('fecha_remision', fecha)
          .eq('categoria', 'tienda')
          .eq('estado', 'aplicado')

        const sumaPrevia = (previos || []).reduce((s, x) => s + parseFloat(x.total_ventas || 0), 0)
        valorAnterior = parseFloat(tiendaRow.tarjeta || 0)
        valorNuevo = sumaPrevia + parseFloat(fields.total_ventas)

        const { error } = await supabase
          .from('tienda_ventas')
          .update({ tarjeta: valorNuevo })
          .eq('id', tiendaRow.id)
        if (error) throw error

        aplicadoATabla = 'tienda_ventas'
        aplicadoAId = tiendaRow.id
        estado = 'aplicado'
      }
    } else {
      estado = 'fallido'
      errorMsg = `categoria no soportada: ${afi.categoria}`
    }
  } catch (e) {
    estado = 'fallido'
    errorMsg = e.message
  }

  // Insertar audit row
  const { error: insertErr } = await supabase.from('bac_consumos').insert({
    liquidacion_no: fields.liquidacion_no,
    no_afiliado: fields.no_afiliado,
    fecha_remision: fields.fecha_remision,
    fecha_pago: fields.fecha_pago,
    lote_pos: fields.lote_pos,
    cuenta_destino: fields.cuenta_destino,
    cantidad_transac: fields.cantidad_transac,
    total_ventas: fields.total_ventas,
    comision: fields.comision,
    credito_fiscal_iva: fields.credito_fiscal_iva,
    retencion_iva: fields.retencion_iva,
    neto_pagado: fields.neto_pagado,
    email_message_id: emailMessageId,
    pdf_filename: pdfFilename,
    estacion_id: eid,
    categoria: afi.categoria,
    aplicado_a_tabla: aplicadoATabla,
    aplicado_a_id: aplicadoAId,
    valor_anterior: valorAnterior,
    valor_nuevo: valorNuevo,
    estado: estado,
    error_msg: errorMsg
  })

  if (insertErr) {
    return res.status(500).json({ error: 'failed to insert audit', detail: insertErr.message })
  }

  return res.status(200).json({
    ok: true,
    liquidacion_no: fields.liquidacion_no,
    estado,
    estacion_id: eid,
    categoria: afi.categoria,
    valor_anterior: valorAnterior,
    valor_nuevo: valorNuevo
  })
}
