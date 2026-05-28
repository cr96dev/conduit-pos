// pages/api/cron/loyverse-sync.js
// Cron de polling Loyverse -> Supabase.
//
// Schedule (vercel.json): cada 15 min, */15 * * * *.
// Auth: Bearer ${CRON_SECRET}. Tambien acepta header de Vercel Cron (user-agent
// vercel-cron) o un POST manual con INTERNAL_API_SECRET para disparos a mano.
//
// Cada recurso persiste su propio cursor en loyverse_sync_state, asi que
// reintentos y rate-limits son seguros: el siguiente tick retoma donde quedo.

import { syncAll } from '../../../lib/loyverse/sync.js'

export default async function handler(req, res) {
  // Solo GET (Vercel cron) o POST (manual)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth: Vercel Cron inyecta automaticamente `Authorization: Bearer ${CRON_SECRET}`
  // cuando dispara el endpoint. NO confiar solo en el user-agent (spoofeable).
  const auth = req.headers.authorization
  const validCron     = !!process.env.CRON_SECRET         && auth === `Bearer ${process.env.CRON_SECRET}`
  const validInternal = !!process.env.INTERNAL_API_SECRET && auth === `Bearer ${process.env.INTERNAL_API_SECRET}`

  if (!validCron && !validInternal) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // El user-agent solo se conserva para el log de origen, no para autenticar.
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron')

  if (!process.env.LOYVERSE_ACCESS_TOKEN) {
    return res.status(500).json({ error: 'LOYVERSE_ACCESS_TOKEN no configurada' })
  }

  const startTime = Date.now()

  try {
    const results = await syncAll()

    const summary = results.reduce((acc, r) => {
      acc.fetched   += r.fetched   || 0
      acc.upserted  += r.upserted  || 0
      if (r.deadlineReached)  acc.deadlineReached.push(r.resource)
      if (r.ok)               acc.ok.push(r.resource)
      else if (r.rateLimited) acc.rateLimited.push(r.resource)
      else                    acc.errored.push({ resource: r.resource, error: r.error })
      return acc
    }, { fetched: 0, upserted: 0, ok: [], rateLimited: [], errored: [], deadlineReached: [] })

    const durationMs = Date.now() - startTime
    const trigger = isVercelCron ? 'vercel_cron' : (validCron ? 'cron_secret' : 'internal')

    console.log(
      `[loyverse-sync] ${trigger} | ${durationMs}ms | ` +
      `fetched=${summary.fetched} upserted=${summary.upserted} | ` +
      `ok=[${summary.ok.join(',')}] ` +
      `rl=[${summary.rateLimited.join(',')}] ` +
      `err=[${summary.errored.map(e => e.resource).join(',')}] ` +
      `deadline=[${summary.deadlineReached.join(',')}]`
    )

    return res.status(200).json({
      ok: summary.errored.length === 0,
      duration_ms: durationMs,
      summary,
      results,
    })
  } catch (e) {
    console.error('[loyverse-sync] ERROR fatal:', e.message)
    return res.status(500).json({
      ok: false,
      error: e.message,
      duration_ms: Date.now() - startTime,
    })
  }
}

export const config = {
  maxDuration: 60,
}
