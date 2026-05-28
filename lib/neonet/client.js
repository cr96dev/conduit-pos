// lib/neonet/client.js
// Cliente HTTP para la WebAPI Dynamic Retail de Neonet/Visanet.
//
// Operaciones (todas POST):
//   - settlement              (paymentcommercesettlement)
//   - transactionDetail       (transactiondetail)
//   - settlementDetail        (settlementdetail)
//   - settlementBatch         (settlementbatch)
//   - voucherReprint          (authorizationvoucherreprint)
//   - reportTotals            (reporttotals)
//   - sendDigitalVoucher      (SendDigitalVoucher)
//
// La venta (authorizationpaymentcommerce) NO la usamos desde el backend
// porque el Intent del NeoPOS App on-device captura el plastico. Esta API
// REST seria para card-not-present, fuera de scope para una panaderia.
//
// Headers que cada request manda (segun manual v1.2.0):
//   Authorization: <JWT del VNGAuthenticator>
//   merchantUser:  <env NEONET_MERCHANT_USER>
//   merchantPasswd:<env NEONET_MERCHANT_PASSWD>
//   Content-Type:  application/json
//
// systemsTraceNo: contador 6-digito que reinicia al llegar a 999999.
// Lo persistimos en memoria por instancia (no critico si se resetea por
// cold start — Neonet lo usa para auditoria, no es PK).

import { obtenerJWT, NeonetAuthError } from './auth'

const URL_API_DEFAULT =
  'https://developervisanet.com.gt:60800/NEO_POS_SOCKET/api/v1/pospayment'

// Contador en memoria. No es seguridad — solo correlacion.
let systemsTraceNo = 1

function nextTraceNo() {
  const n = systemsTraceNo
  systemsTraceNo = (systemsTraceNo % 999_999) + 1
  return String(n).padStart(6, '0')
}

export class NeonetClientError extends Error {
  constructor(message, { status, payload, etapa, responseCode } = {}) {
    super(message)
    this.name = 'NeonetClientError'
    this.status = status
    this.payload = payload
    this.etapa = etapa
    this.responseCode = responseCode
  }
}

function envMerchant() {
  const user = process.env.NEONET_MERCHANT_USER
  const pass = process.env.NEONET_MERCHANT_PASSWD
  if (!user || !pass) {
    throw new NeonetClientError('NEONET_MERCHANT_USER / NEONET_MERCHANT_PASSWD no configuradas', { etapa: 'config' })
  }
  return { user, pass }
}

// Devuelve { terminalId, cardAcqId } a usar como `merchant` en los requests.
// Default: el dispositivo de ejemplo del manual (QA_HIDROCOM). Override por env.
function merchantId() {
  return {
    terminalId: process.env.NEONET_TERMINAL_ID || '18070542',
    cardAcqId:  process.env.NEONET_CARD_ACQ_ID || '42072024',
  }
}

async function postJson(path, body, { etapa } = {}) {
  const { token } = await obtenerJWT()
  const { user, pass } = envMerchant()
  const baseUrl = process.env.NEONET_API_URL || URL_API_DEFAULT
  const url = baseUrl.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
  let r
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': token,            // JWT crudo (sin prefijo Bearer segun manual)
        'merchantUser':  user,
        'merchantPasswd':pass,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new NeonetClientError(`Red fallida en ${etapa}: ${e.message}`, { etapa })
  }
  const text = await r.text()
  let payload
  try { payload = JSON.parse(text) } catch { payload = text }
  if (r.status === 401) {
    // JWT expirado o invalido. El obtenerJWT cachea por TTL pero igual:
    // exponer error claro para que el caller pueda invalidar y reintentar.
    throw new NeonetClientError(`Neonet 401 en ${etapa} — JWT rechazado`, { status: 401, payload, etapa })
  }
  if (!r.ok) {
    throw new NeonetClientError(`Neonet HTTP ${r.status} en ${etapa}`, { status: r.status, payload, etapa })
  }
  // Per manual: responseCode '00' = OK. Cualquier otro = error.
  // El campo puede estar en raiz o en un sub-objeto segun el endpoint.
  const responseCode = (payload && typeof payload === 'object' ? payload.responseCode : null)
  if (responseCode != null && responseCode !== '00') {
    const desc = payload?.privateUse63?.alternateHostResponse22 || 'Sin descripcion'
    throw new NeonetClientError(`Neonet rechazo ${etapa} responseCode=${responseCode}: ${desc}`, {
      status: r.status, payload, etapa, responseCode,
    })
  }
  return payload
}

// Cierre/settlement del lote. Body minimo segun manual: merchant.
// Devuelve totales por categoria + detalle + comprobantes imprimibles.
export async function settlement() {
  return postJson('paymentcommercesettlement', {
    merchant: merchantId(),
  }, { etapa: 'settlement' })
}

// Detalle de transacciones procesadas (todas, o filtradas por fecha si el
// manual lo permite — v1.2.0 documenta solo merchant en el body).
export async function transactionDetail() {
  return postJson('transactiondetail', {
    merchant: merchantId(),
  }, { etapa: 'transactionDetail' })
}

// Detalle de un cierre por privateUse60 (batch number). Si no se manda,
// Neonet devuelve el ultimo cierre realizado.
export async function settlementDetail({ batchNumber } = {}) {
  return postJson('settlementdetail', {
    merchant: merchantId(),
    privateUse60: batchNumber || '',
  }, { etapa: 'settlementDetail' })
}

// Listado de cierres por lotes.
export async function settlementBatch() {
  return postJson('settlementbatch', {
    merchant: merchantId(),
  }, { etapa: 'settlementBatch' })
}

// Reimpresion de voucher. Per manual: pasamos systemsTraceNo correspondiente
// a la transaccion. Si no se pasa, Neonet devuelve la ultima.
export async function voucherReprint({ traceNo } = {}) {
  return postJson('authorizationvoucherreprint', {
    merchant: merchantId(),
    systemsTraceNo: traceNo || nextTraceNo(),
  }, { etapa: 'voucherReprint' })
}

// Resumen totales.
export async function reportTotals() {
  return postJson('reporttotals', {
    merchant: merchantId(),
  }, { etapa: 'reportTotals' })
}

// Enviar voucher digital al cliente por SMS o email.
export async function sendDigitalVoucher({ clientName, retrievalRefNo, type, to, locationLat, locationLon }) {
  return postJson('SendDigitalVoucher', {
    merchant: merchantId(),
    clientName: clientName || '',
    retrievalRefNo: String(retrievalRefNo || ''),
    locationLat: locationLat || '',
    locationLon: locationLon || '',
    notification: { type: type || 'Email', to: to || '' },
  }, { etapa: 'sendDigitalVoucher' })
}

// Re-export para que los handlers de error puedan distinguir tipos.
export { NeonetAuthError }
