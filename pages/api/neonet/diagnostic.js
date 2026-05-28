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

async function neonetPost({ token, user, pass, path, body, method = 'POST', extraHeaders = {}, authMode = 'bearer' }) {
  const url = BASE_URL.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
  const start = Date.now()
  const authValue = authMode === 'raw' ? token : authMode === 'none' ? null : `Bearer ${token}`
  const headers = {
    ...(authValue ? { 'Authorization': authValue } : {}),
    'merchantUser': user,
    'merchantPasswd': pass,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...extraHeaders,
  }
  let r
  try {
    r = await fetch(url, {
      method,
      headers,
      ...(method === 'POST' || method === 'PUT' ? { body: JSON.stringify(body) } : {}),
    })
  } catch (e) {
    return { status: 'error_red', httpStatus: 0, payload: null, error: e.message, ms: Date.now() - start }
  }
  const text = await r.text()
  let payload
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  // Capturar TODOS los headers de respuesta — pueden tener pistas de por que fallo.
  const responseHeaders = {}
  r.headers.forEach((value, key) => { responseHeaders[key] = value })
  let status
  if (!r.ok) status = 'error_http'
  else if (!text || r.status === 204) status = 'sin_datos'
  else if (payload?.responseCode === '00') status = 'ok'
  else status = 'error_neonet'
  return { status, httpStatus: r.status, payload, responseHeaders, ms: Date.now() - start }
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

  // Round v2: hipotesis NUEVAS despues de que el v1 mostro que TODOS los
  // terminales dan -90 (no es device-specific). Buscamos algo del lado de
  // como llamamos el endpoint.
  const tests = [
    {
      name: 'V2.1: SA TID Charles, Authorization RAW (sin Bearer)',
      hipotesis: 'Quizas authorizationpaymentcommerce no quiere el prefijo Bearer (aunque settlement con Bearer si funciono)',
      path: 'authorizationpaymentcommerce',
      body: baseSale(tidCharles, cidCharles, '000010'),
      authMode: 'raw',
    },
    {
      name: 'V2.2: SA TID Charles con User-Agent del POS',
      hipotesis: 'Quizas Neonet filtra requests sin User-Agent reconocido (algunas APIs tienen whitelist)',
      path: 'authorizationpaymentcommerce',
      body: baseSale(tidCharles, cidCharles, '000011'),
      extraHeaders: { 'User-Agent': 'NeoPOS-Android/1.0.0' },
    },
    {
      name: 'V2.3: SA TID Charles con additionalData=LU (catalogo)',
      hipotesis: 'El manual lista LU, VC##, EF##, VD############ como catalogo de additionalData. Quizas exige uno.',
      path: 'authorizationpaymentcommerce',
      body: { ...baseSale(tidCharles, cidCharles, '000012'), additionalData: 'LU' },
    },
    {
      name: 'V2.4: SA TID Charles con taxDetail IVA Guatemala',
      hipotesis: 'taxDetail vacio puede no pasar validacion. Probamos con IVA 12% real.',
      path: 'authorizationpaymentcommerce',
      body: {
        ...baseSale(tidCharles, cidCharles, '000013'),
        amount: {
          amountTrans: '100',
          additionalAmounts: '',
          taxDetail: [{ type: 'IVA', grossAmount: '89', taxAmountNet: '11', rate: '12' }],
        },
      },
    },
    {
      name: 'V2.5: SA TID Charles SIN Authorization header',
      hipotesis: 'Si sin auth da 401 limpio, confirmamos que el server valida. Si da -90, el error no es por auth.',
      path: 'authorizationpaymentcommerce',
      body: baseSale(tidCharles, cidCharles, '000014'),
      authMode: 'none',
    },
    {
      name: 'V2.6: GET / (raiz del API, ver si responde swagger o spec)',
      hipotesis: 'Quizas hay swagger / spec / discovery que nos diga formato real.',
      path: '',
      body: null,
      method: 'GET',
    },
    {
      name: 'V2.7: GET /authorizationpaymentcommerce (OPTIONS-style)',
      hipotesis: 'Algunos servidores responden a GET con la spec o un help.',
      path: 'authorizationpaymentcommerce',
      body: null,
      method: 'GET',
    },
  ]

  const results = []
  for (const t of tests) {
    const r = await neonetPost({
      ...ctx,
      path: t.path,
      body: t.body,
      method: t.method || 'POST',
      extraHeaders: t.extraHeaders || {},
      authMode: t.authMode || 'bearer',
    })
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
