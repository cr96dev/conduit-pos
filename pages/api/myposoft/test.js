// pages/api/myposoft/test.js
// Endpoint manual para probar el sync de MyPOSoft (sin esperar el cron)
//
// Uso:
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        "https://app.hidrocom.net/api/myposoft/test?action=sync&startDate=2026-05-01&endDate=2026-05-19"
//
// Acciones disponibles (query param 'action'):
//   - ping       : login a MyPOSoft + cuenta de records sin upsert
//   - sync       : trae y hace upsert a myposoft_sales
//   - reconcile  : compara myposoft_sales vs ventas_lubricantes (read-only)

import { syncSales, reconcileLubricantes } from '../../../lib/myposoft/sync.js'
import { MyPOSoftClient } from '../../../lib/myposoft/client.js'

const INTERNAL_SECRET = process.env.CRON_SECRET

function authorize(req) {
  if (!INTERNAL_SECRET) {
    throw new Error('CRON_SECRET no configurada en env')
  }
  const auth = req.headers.authorization || ''
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (token !== INTERNAL_SECRET) {
    const e = new Error('Unauthorized')
    e.status = 401
    throw e
  }
}

function parseDate(s, defaultDate) {
  if (!s) return defaultDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const e = new Error(`Fecha inválida: ${s} (formato esperado YYYY-MM-DD)`)
    e.status = 400
    throw e
  }
  return s
}

function todayGT() {
  // Fecha de hoy en Guatemala (UTC-6, sin DST)
  const now = new Date()
  const gtMs = now.getTime() - 6 * 60 * 60 * 1000
  return new Date(gtMs).toISOString().slice(0, 10)
}

function daysAgoGT(n) {
  const now = new Date()
  const gtMs = now.getTime() - 6 * 60 * 60 * 1000 - n * 24 * 60 * 60 * 1000
  return new Date(gtMs).toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  try {
    authorize(req)

    const action = req.query.action || 'ping'
    const startDate = parseDate(req.query.startDate, daysAgoGT(1))
    const endDate = parseDate(req.query.endDate, todayGT())
    const tradeId = req.query.tradeId ? parseInt(req.query.tradeId, 10) : undefined

    if (action === 'ping') {
      // Solo loguea y trae count, sin tocar BD
      const client = new MyPOSoftClient()
      const t0 = Date.now()
      await client.login()
      const loginMs = Date.now() - t0

      const t1 = Date.now()
      const { records, sales } = await client.getSales({ startDate, endDate, tradeId })
      const fetchMs = Date.now() - t1

      // Resumen por estación
      const byTrade = {}
      let totalQ = 0
      let anuladas = 0
      for (const s of sales) {
        const k = s.tradeName || '(null)'
        if (!byTrade[k]) byTrade[k] = { n: 0, total: 0, anuladas: 0 }
        byTrade[k].n++
        const t = parseFloat(s.total || 0)
        byTrade[k].total += t
        totalQ += t
        if (s.saleStatus !== 'EMITIDA') {
          byTrade[k].anuladas++
          anuladas++
        }
      }

      return res.status(200).json({
        action: 'ping',
        startDate,
        endDate,
        tradeId: tradeId ?? null,
        timing: { loginMs, fetchMs, totalMs: loginMs + fetchMs },
        records,
        salesReturned: sales.length,
        totalQ: Math.round(totalQ * 100) / 100,
        anuladas,
        byTrade: Object.fromEntries(
          Object.entries(byTrade).map(([k, v]) => [
            k,
            { n: v.n, total: Math.round(v.total * 100) / 100, anuladas: v.anuladas },
          ])
        ),
      })
    }

    if (action === 'sync') {
      const result = await syncSales({
        startDate,
        endDate,
        tradeId,
        triggeredBy: 'manual',
        metadata: {
          ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
          userAgent: req.headers['user-agent']?.slice(0, 200),
        },
      })
      return res.status(200).json({ action: 'sync', ...result })
    }

    if (action === 'reconcile') {
      const result = await reconcileLubricantes({ startDate, endDate })
      return res.status(200).json({ action: 'reconcile', ...result })
    }

    return res.status(400).json({
      error: 'action invalida',
      validActions: ['ping', 'sync', 'reconcile'],
    })
  } catch (e) {
    const status = e.status || 500
    console.error('[myposoft/test] error:', e.message)
    return res.status(status).json({
      error: e.message,
      stack: process.env.NODE_ENV === 'development' ? e.stack : undefined,
    })
  }
}