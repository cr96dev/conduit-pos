// pages/api/pos/cobrar-tarjeta.js
// Cobro tarjeta backend-mediado contra la terminal externa de Neonet.
//
// Flujo:
//   1. POST {idsale, amount_cents} desde el POS (con Bearer del admin)
//   2. Llamamos authorizationpaymentcommerce a la WebAPI Dynamic Retail
//   3. Neonet enruta el cobro a la P5L identificada por NEONET_TERMINAL_ID
//      y NEONET_CARD_ACQ_ID (env vars)
//   4. El cajero pasa la tarjeta en la P5L, captura, dialoga con Visanet,
//      imprime voucher
//   5. La respuesta vuelve aca: la mapeamos al shape `respuesta_lector`
//      (mismo contrato que /api/neonet/mock-sale y el bridge Sunmi)
//   6. El frontend ya sabe que hacer con eso (POST /api/pos/ventas -> FEL)
//
// Auth: requireAdmin (Bearer access_token Supabase).
//
// Timeout: 120s. Un cobro puede tardar hasta ~90s entre que el cajero
// inserta la tarjeta, ingresa PIN, espera autorizacion del emisor.

import { authorizationPaymentCommerce, NeonetClientError, NeonetAuthError } from '../../../lib/neonet/client'
import { requireAdminOCajero } from '../../../lib/auth'

// Mapea la respuesta cruda de Neonet al shape `respuesta_lector` que el
// frontend ya consume (igual que /api/neonet/mock-sale).
function mapRespuestaLector(payload) {
  const responseCode = String(payload?.responseCode ?? '')
  const approved = responseCode === '00'
  return {
    response_code: responseCode,
    retrieval_no:        String(payload?.retrievalRefNo ?? ''),
    authorization_code:  String(payload?.authIdResponse ?? ''),
    response_message:    payload?.privateUse63?.alternateHostResponse22
                          || (approved ? 'APROBADA' : 'RECHAZADA'),
    approved:            approved ? 'true' : 'false',
    suggested_nit:       String(payload?.privateUse63?.suggestionTaxId27 ?? ''),
    voucher_code:        String(payload?.voucher?.commerceVoucher ?? '').slice(0, 64), // largo total puede ser 65k chars
    panPci:              String(payload?.panPci ?? ''),
    cardHolderName:      String(payload?.cardHolderName ?? ''),
    posEntryMode:        String(payload?.posEntryMode ?? ''),
    terminalId:          String(payload?.merchant?.terminalId ?? ''),
    cardAcqId:           String(payload?.merchant?.cardAcqId ?? ''),
    systemsTraceNo:      String(payload?.systemsTraceNo ?? ''),
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdminOCajero(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { idsale, amount_cents } = req.body || {}
  if (!idsale || typeof idsale !== 'string') {
    return res.status(400).json({ error: 'idsale requerido (string)' })
  }
  const amount = Number(amount_cents)
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    return res.status(400).json({ error: 'amount_cents debe ser entero > 0' })
  }

  let payload
  try {
    payload = await authorizationPaymentCommerce({ idsale, amountCents: amount })
  } catch (e) {
    if (e instanceof NeonetClientError) {
      // Error con responseCode != '00'. Igual lo devolvemos en shape de
      // respuesta_lector para que el frontend pueda mostrarlo (igual que
      // un cobro rechazado normal).
      console.error('[pos/cobrar-tarjeta] Neonet rechazo:', e.message, e.responseCode, e.etapa)
      const respuesta_lector = mapRespuestaLector(e.payload)
      return res.status(200).json({
        ok: false,
        idsale,
        amount_cents: amount,
        respuesta_lector,
        error_message: e.payload?.privateUse63?.alternateHostResponse22 || e.message,
        responseCode: e.responseCode,
      })
    }
    if (e instanceof NeonetAuthError) {
      console.error('[pos/cobrar-tarjeta] Neonet auth fallo:', e.message)
      return res.status(502).json({ ok: false, etapa: 'auth', error_message: e.message })
    }
    console.error('[pos/cobrar-tarjeta] ERROR:', e.message)
    return res.status(500).json({ ok: false, error_message: e.message })
  }

  const respuesta_lector = mapRespuestaLector(payload)
  return res.status(200).json({
    ok: true,
    idsale,
    amount_cents: amount,
    respuesta_lector,
  })
}

export const config = { maxDuration: 120 }
