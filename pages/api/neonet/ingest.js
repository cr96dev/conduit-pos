// pages/api/neonet/ingest.js
//
// Recibe un PDF de estado de cuenta Neonet en base64 desde el Apps Script,
// lo parsea, resuelve afiliacion -> estacion + variante, y aplica el cobro
// a la(s) columna(s) apropiada(s) (ventas.neonet, ventas.neonet_prepago o ventas.neolink),
// con auditoria.
//
// El PDF Neonet trae un "RESUMEN POR PRODUCTO" con rubros separados:
//   - 0-Ventas                       → ventas.neonet (suma con canje)
//   - 4-Canje de Puntos o Millas     → ventas.neonet (suma con ventas)
//   - 6-Prepago Shell Guatemala      → ventas.neonet_prepago
// Para variante 'neolink' va todo a ventas.neolink.
//
// Seguridad: HMAC-SHA256 del body con NEONET_HMAC_SECRET.
// Idempotencia: email_message_id es UNIQUE en neonet_consumos.

import crypto from 'crypto'
import { supabaseAdmin } from '../../../lib/qbo/supabaseAdmin'

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '5mb'
    }
  }
}

const NOTIFY_EMAIL = 'adoffice569@gmail.com'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 1. Validar HMAC ──────────────────────────────────────────
  const secret = process.env.NEONET_HMAC_SECRET
  if (!secret) {
    console.error('[neonet/ingest] NEONET_HMAC_SECRET no configurado en env')
    return res.status(500).json({ error: 'Server misconfigured' })
  }

  const sigHeader = req.headers['x-hmac-signature']
  if (!sigHeader) {
    return res.status(401).json({ error: 'Missing X-HMAC-Signature' })
  }

  const rawBody = JSON.stringify(req.body)
  const expectedSig = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  if (!crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expectedSig))) {
    return res.status(401).json({ error: 'Invalid HMAC signature' })
  }

  // ── 2. Validar payload ───────────────────────────────────────
  const {
    afiliacion_codigo,
    email_message_id,
    email_date,
    pdf_base64,
    pdf_filename
  } = req.body

  if (!afiliacion_codigo || !email_message_id || !pdf_base64) {
    return res.status(400).json({
      error: 'Faltan campos requeridos: afiliacion_codigo, email_message_id, pdf_base64'
    })
  }

  // ── 3. Idempotencia ──────────────────────────────────────────
  const { data: existente } = await supabaseAdmin
    .from('neonet_consumos')
    .select('id, estado')
    .eq('email_message_id', email_message_id)
    .maybeSingle()

  if (existente && existente.estado === 'aplicado') {
    return res.status(200).json({
      success: true,
      ya_procesado: true,
      consumo_id: existente.id
    })
  }

  // ── 4. Parsear PDF ───────────────────────────────────────────
  let parsedPdf
  try {
    parsedPdf = await parsearPdfNeonet(pdf_base64)
  } catch (err) {
    console.error('[neonet/ingest] Error parseando PDF', err)
    await supabaseAdmin.from('neonet_consumos').insert({
      afiliacion_codigo,
      fecha_consumo: email_date?.split('T')[0] || new Date().toISOString().split('T')[0],
      total_q: 0,
      email_message_id,
      pdf_filename,
      estado: 'fallido',
      error_msg: `PDF parse error: ${err.message}`
    })
    return res.status(422).json({ error: 'No se pudo parsear el PDF', detalle: err.message })
  }

  const { fecha_consumo, total_q, ventas_q, canje_q, prepago_q, detalle } = parsedPdf

  // ── 5. Resolver afiliacion ───────────────────────────────────
  const { data: afiliacion } = await supabaseAdmin
    .from('neonet_afiliaciones')
    .select('estacion_id, variante, activo')
    .eq('afiliacion_codigo', afiliacion_codigo)
    .maybeSingle()

  if (!afiliacion) {
    await supabaseAdmin.from('neonet_consumos').insert({
      afiliacion_codigo,
      fecha_consumo,
      total_q,
      detalle_json: detalle,
      email_message_id,
      pdf_filename,
      estado: 'fallido',
      error_msg: 'Afiliacion no registrada en neonet_afiliaciones'
    })
    await notificarAfiliacionDesconocida(afiliacion_codigo, email_message_id, pdf_filename, total_q)
    return res.status(200).json({
      success: false,
      motivo: 'afiliacion_desconocida',
      afiliacion_codigo
    })
  }

  if (!afiliacion.activo) {
    return res.status(200).json({
      success: false,
      motivo: 'afiliacion_inactiva',
      afiliacion_codigo
    })
  }

  const { estacion_id, variante } = afiliacion

  // ── 6. Determinar columnas y montos a aplicar ────────────────
  // Para neolink: todo va a ventas.neolink (mantenemos comportamiento original)
  // Para neonet: split entre ventas.neonet (ventas + canje) y ventas.neonet_prepago
  const montoNeonet = ventas_q + canje_q  // 0-Ventas + 4-Canje
  const montoPrepago = prepago_q          // 6-Prepago Shell Guatemala

  const columnaPrincipal = variante === 'neolink' ? 'neolink' : 'neonet'
  const valorPrincipal = variante === 'neolink' ? total_q : montoNeonet
  const aplicarPrepago = variante !== 'neolink' && montoPrepago > 0

  // ── 7. Buscar fila ventas ────────────────────────────────────
  const selectCols = aplicarPrepago
    ? `id, ${columnaPrincipal}, neonet_prepago`
    : `id, ${columnaPrincipal}`

  const { data: ventaRow } = await supabaseAdmin
    .from('ventas')
    .select(selectCols)
    .eq('fecha', fecha_consumo)
    .eq('estacion_id', estacion_id)
    .maybeSingle()

  const valorAnterior = ventaRow ? parseFloat(ventaRow[columnaPrincipal] || 0) : null
  const valorAnteriorPrepago = ventaRow && aplicarPrepago ? parseFloat(ventaRow.neonet_prepago || 0) : null
  const valorNuevo = valorPrincipal
  const diferencia = valorAnterior !== null ? valorNuevo - valorAnterior : null

  if (!ventaRow) {
    await supabaseAdmin.from('neonet_consumos').insert({
      afiliacion_codigo,
      fecha_consumo,
      total_q,
      detalle_json: detalle,
      email_message_id,
      pdf_filename,
      estacion_id,
      variante,
      estado: 'sin_venta_destino',
      error_msg: 'Fila ventas para esa fecha/estacion no existe aun'
    })
    return res.status(200).json({
      success: true,
      motivo: 'sin_venta_destino_aun',
      total_q,
      fecha_consumo
    })
  }

  // ── 8. Aplicar update ────────────────────────────────────────
  const updatePayload = {
    [columnaPrincipal]: valorNuevo,
    qbo_processed: false,
    qbo_processed_prod: false
  }
  if (aplicarPrepago) {
    updatePayload.neonet_prepago = montoPrepago
  }

  const { error: errUpdate } = await supabaseAdmin
    .from('ventas')
    .update(updatePayload)
    .eq('id', ventaRow.id)

  if (errUpdate) {
    await supabaseAdmin.from('neonet_consumos').insert({
      afiliacion_codigo,
      fecha_consumo,
      total_q,
      detalle_json: detalle,
      email_message_id,
      pdf_filename,
      estacion_id,
      variante,
      valor_anterior: valorAnterior,
      valor_nuevo: valorNuevo,
      diferencia,
      estado: 'fallido',
      error_msg: `Update ventas falló: ${errUpdate.message}`
    })
    return res.status(500).json({ error: 'Update falló', detalle: errUpdate.message })
  }

  await supabaseAdmin.from('neonet_consumos').insert({
    afiliacion_codigo,
    fecha_consumo,
    total_q,
    detalle_json: detalle,
    email_message_id,
    pdf_filename,
    estacion_id,
    variante,
    aplicado_a_tabla: 'ventas',
    aplicado_a_id: ventaRow.id,
    valor_anterior: valorAnterior,
    valor_nuevo: valorNuevo,
    diferencia,
    estado: 'aplicado'
  })

  return res.status(200).json({
    success: true,
    afiliacion_codigo,
    estacion_id,
    variante,
    fecha_consumo,
    total_q,
    ventas_q,
    canje_q,
    prepago_q,
    aplicado_principal: { columna: columnaPrincipal, valor: valorNuevo },
    aplicado_prepago: aplicarPrepago ? { columna: 'neonet_prepago', valor: montoPrepago } : null,
    valor_anterior: valorAnterior,
    diferencia
  })
}

// ─── Parser PDF ─────────────────────────────────────────────────
// El PDF Neonet trae una sección "RESUMEN POR PRODUCTO" con rubros separados:
//   0-Ventas                      → suma de ventas regulares con tarjeta
//   4-Canje de Puntos o Millas    → canjes
//   6-Prepago Shell Guatemala     → cargas/usos de prepago Shell
//   TOTAL                         → suma de los tres
async function parsearPdfNeonet(base64) {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const buffer = Buffer.from(base64, 'base64')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  const { text: textArr } = await extractText(pdf, { mergePages: true })
  const text = Array.isArray(textArr) ? textArr.join('\n') : String(textArr || '')

  // ─── Total general
  // El formato típico es: "TOTAL <N> <MONTO> ..."
  // Buscamos la última ocurrencia de TOTAL seguida de número con decimales
  let total_q = null
  const totalMatches = [...text.matchAll(/TOTAL[\s\S]{0,40}?([\d,]+\.\d{2})/gi)]
  if (totalMatches.length > 0) {
    // Tomamos el último match (suele ser el del resumen final)
    total_q = parseFloat(totalMatches[totalMatches.length - 1][1].replace(/,/g, ''))
  }
  if (total_q === null) {
    throw new Error('No se encontró TOTAL en el PDF. Texto: ' + text.substring(0, 500))
  }

  // ─── Rubros del resumen por producto
  // Patrón observado: "0-Ventas <TRANS> <MONTO>" etc.
  // Buscamos cada rubro de forma independiente y tolerante a saltos de línea/espacios.
  let ventas_q = 0
  let canje_q = 0
  let prepago_q = 0

  // 0-Ventas
  const mVentas = text.match(/0-?\s*Ventas[\s\S]{0,60}?(\d+)\s+([\d,]+\.\d{2})/i)
  if (mVentas) {
    ventas_q = parseFloat(mVentas[2].replace(/,/g, ''))
  }

  // 4-Canje de Puntos o Millas
  const mCanje = text.match(/4-?\s*Canje[\s\S]{0,60}?(\d+)\s+([\d,]+\.\d{2})/i)
  if (mCanje) {
    canje_q = parseFloat(mCanje[2].replace(/,/g, ''))
  }

  // 6-Prepago Shell Guatemala
  const mPrepago = text.match(/6-?\s*Prepago[\s\S]{0,80}?(\d+)\s+([\d,]+\.\d{2})/i)
  if (mPrepago) {
    prepago_q = parseFloat(mPrepago[2].replace(/,/g, ''))
  }

  // Fallback: si no encontramos ningún rubro pero sí TOTAL, asumimos que todo es ventas
  if (ventas_q === 0 && canje_q === 0 && prepago_q === 0) {
    ventas_q = total_q
  }

  // Validación: la suma debería coincidir con TOTAL (tolerancia 1 centavo)
  const sumaRubros = ventas_q + canje_q + prepago_q
  if (Math.abs(sumaRubros - total_q) > 0.02) {
    // No fallar; loguear y dejar total como referencia
    console.warn('[neonet parser] Suma de rubros no coincide con TOTAL', {
      sumaRubros, total_q, ventas_q, canje_q, prepago_q
    })
  }

  // ─── Fecha consumo
  // Buscar "Del DD/MM/YYYY" o cualquier fecha DD/MM/YYYY
  let fecha_consumo = null
  const fechaMatch = text.match(/Del\s+(\d{2})\/(\d{2})\/(\d{4})/i)
    || text.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (fechaMatch) {
    const [, dd, mm, yyyy] = fechaMatch
    fecha_consumo = `${yyyy}-${mm}-${dd}`
  } else {
    const ayer = new Date(Date.now() - 24 * 60 * 60 * 1000)
    fecha_consumo = ayer.toISOString().split('T')[0]
  }

  // ─── Detalle (best effort)
  const detalle = {
    total_q,
    ventas_q,
    canje_q,
    prepago_q,
    transacciones: []
  }
  const lineas = text.split('\n')
  for (const linea of lineas) {
    const m = linea.match(/^\s*(\d{2}:\d{2}(?::\d{2})?)\s+.*?Q?\s*([\d,]+\.\d{2})\s*$/)
    if (m) {
      detalle.transacciones.push({
        hora: m[1],
        monto: parseFloat(m[2].replace(/,/g, '')),
        linea_original: linea.trim()
      })
    }
  }

  return {
    fecha_consumo,
    total_q,
    ventas_q,
    canje_q,
    prepago_q,
    detalle
  }
}

// ─── Notificacion ───────────────────────────────────────────────
async function notificarAfiliacionDesconocida(afiliacion, msgId, pdfName, total) {
  const BREVO_KEY = process.env.BREVO_API_KEY
  if (!BREVO_KEY) {
    console.warn('[neonet/ingest] BREVO_API_KEY no configurada; skip notify')
    return
  }
  try {
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: { name: 'GasOps Neonet', email: 'noreply@hidrocom.net' },
        to: [{ email: NOTIFY_EMAIL }],
        subject: `Afiliación Neonet desconocida: ${afiliacion}`,
        htmlContent: `
          <p>Llegó un estado de cuenta Neonet con afiliación <b>${afiliacion}</b> que no está mapeada.</p>
          <p>Total: Q${total}</p>
          <p>PDF: ${pdfName}</p>
          <p>Email ID: ${msgId}</p>
          <p>Agregar fila a <code>neonet_afiliaciones</code> para que se procese automáticamente.</p>
        `
      })
    })
  } catch (err) {
    console.error('[neonet/ingest] Brevo notify falló', err)
  }
}
