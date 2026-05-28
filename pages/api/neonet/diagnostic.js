// pages/api/neonet/diagnostic.js
// Endpoint de DIAGNOSTICO: corre una bateria de requests a Neonet con
// distintas combinaciones para aislar por que la P5L no recibe el cobro
// routeado. Admin-only.
//
// Lee NEONET_* del env (que tiene acceso porque corre server-side).
//
// Uso:
//   POST con Authorization: Bearer <supabase access_token de admin>
//
// Devuelve { ok: true, tests: [{ name, status, payload, etapa }, ...] }
// donde status = 'ok' | 'error_neonet' | 'error_red'.
//
// NOTA: este endpoint NO debe quedar en prod a largo plazo — es solo para
// debuggear la integracion con Neonet. Borrar cuando este funcionando.

import { obtenerJWT } from '../../../lib/neonet/auth'
import { requireAdmin } from '../../../lib/auth'

const BASE_URL = process.env.NEONET_API_URL
  || 'https://developervisanet.com.gt:60800/NEO_POS_SOCKET/api/v1/pospayment'

async function neonetPost({ token, user, pass, path, body }) {
  const url = BASE_URL.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
  const start = Date.now()
  let r
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'merchantUser': user,
        'merchantPasswd': pass,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return { status: 'error_red', httpStatus: 0, payload: null, error: e.message, ms: Date.now() - start }
  }
  const text = await r.text()
  let payload
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  // Clasificacion:
  //   ok                = HTTP 2xx + body con responseCode=='00'
  //   sin_datos         = HTTP 204 o body vacio (lectura sin resultados, normal)
  //   error_neonet      = HTTP 2xx pero responseCode != '00'
  //   error_http        = HTTP no-2xx
  let status
  if (!r.ok) status = 'error_http'
  else if (!text || r.status === 204) status = 'sin_datos'
  else if (payload?.responseCode === '00') status = 'ok'
  else status = 'error_neonet'
  return { status, httpStatus: r.status, payload, ms: Date.now() - start }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const user = process.env.NEONET_MERCHANT_USER
  const pass = process.env.NEONET_MERCHANT_PASSWD
  const tidCharles = process.env.NEONET_TERMINAL_ID || '20042026'
  const cidCharles = process.env.NEONET_CARD_ACQ_ID || '20260420'
  if (!user || !pass) {
    return res.status(500).json({ ok: false, error: 'NEONET_MERCHANT_USER/PASSWD no configuradas' })
  }

  let token
  try {
    const r = await obtenerJWT()
    token = r.token
  } catch (e) {
    return res.status(502).json({ ok: false, etapa: 'jwt', error: e.message })
  }

  const ctx = { token, user, pass }
  const baseAuth = (terminalId, cardAcqId) => ({ terminalId, cardAcqId })
  const baseSale = (terminalId, cardAcqId, trace, type = 'SA', amount = '100') => ({
    transactionType: type,
    systemsTraceNo: trace,
    additionalData: '',
    merchant: baseAuth(terminalId, cardAcqId),
    amount: { amountTrans: amount, additionalAmounts: '', taxDetail: [] },
    privateUse63: { lodgingFolioNumber14: '', cashbackAmount41: '', taxAmount1: '' },
  })

  const tests = [
    {
      name: '1. transactiondetail TID Charles (solo lectura, sin device)',
      hipotesis: 'Si responde 200/data, TID 20042026 esta en sistema. Si AUTH INCORRECTA, no dado de alta.',
      path: 'transactiondetail',
      body: { merchant: baseAuth(tidCharles, cidCharles) },
    },
    {
      name: '2. settlementbatch TID Charles (solo lectura)',
      hipotesis: 'Idem test 1.',
      path: 'settlementbatch',
      body: { merchant: baseAuth(tidCharles, cidCharles) },
    },
    {
      name: '3. paymentcommercesettlement TID Charles',
      hipotesis: 'Si sin_lote => TID activo. Si AUTH => no dado de alta.',
      path: 'paymentcommercesettlement',
      body: { merchant: baseAuth(tidCharles, cidCharles) },
    },
    {
      name: '4. SA con IDs INVERTIDOS (20260420/20042026)',
      hipotesis: 'Si cambia el error a 00, Angel anoto al reves los IDs.',
      path: 'authorizationpaymentcommerce',
      body: baseSale(cidCharles, tidCharles, '000005'),
    },
    {
      name: '5. AN (anulacion) TID Charles',
      hipotesis: 'Si AN devuelve algo distinto a -90, SA esta bloqueado pero AN no.',
      path: 'authorizationpaymentcommerce',
      body: baseSale(tidCharles, cidCharles, '000006', 'AN'),
    },
    {
      name: '6. SA monto Q10.00 TID Charles',
      hipotesis: 'Si Q10 funciona pero Q1 no, hay monto minimo.',
      path: 'authorizationpaymentcommerce',
      body: baseSale(tidCharles, cidCharles, '000007', 'SA', '1000'),
    },
    {
      name: '7. CONTROL: SA contra QA_HIDROCOM (18070542)',
      hipotesis: 'Si QA da 00 o algo distinto a -90, nuestras creds funcionan. Aisla el problema a la P5L de Charles.',
      path: 'authorizationpaymentcommerce',
      body: baseSale('18070542', '42072024', '000008'),
    },
  ]

  const results = []
  for (const t of tests) {
    const r = await neonetPost({ ...ctx, path: t.path, body: t.body })
    results.push({
      name: t.name,
      hipotesis: t.hipotesis,
      path: t.path,
      body_sent: t.body,
      ...r,
    })
  }

  return res.status(200).json({
    ok: true,
    base_url: BASE_URL,
    terminalId_env: tidCharles,
    cardAcqId_env: cidCharles,
    tests: results,
  })
}

export const config = { maxDuration: 240 }
