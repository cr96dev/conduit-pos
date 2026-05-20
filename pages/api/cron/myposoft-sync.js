// pages/api/cron/myposoft-sync.js
// Cron diario: sincroniza ventas de MyPOSoft a Supabase (myposoft_sales)
//
// Schedule (definido en vercel.json): 08:00 UTC = 02:00 hora Guatemala
// Ventana: ayer + hoy (en hora GT) para capturar ventas tardias y cambios de estado
//
// Auth: Bearer ${CRON_SECRET}
// Vercel envia automaticamente este header cuando llama crons configurados

import { syncSales } from '../../../lib/myposoft/sync.js'
import { supabaseAdmin } from '../../../lib/qbo/supabaseAdmin.js'

// Devuelve YYYY-MM-DD en hora Guatemala (UTC-6 fijo, sin DST)
function gtDate(daysAgo = 0) {
  const now = new Date()
  const gtMs = now.getTime() - 6 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000
  return new Date(gtMs).toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  // Solo GET (Vercel cron usa GET)
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (req.headers.authorization !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET no configurada' })
  }

  const startDate = gtDate(1)  // ayer GT
  const endDate = gtDate(0)    // hoy GT

  try {
    const result = await syncSales({
      startDate,
      endDate,
      triggeredBy: 'cron',
      metadata: {
        cron: 'myposoft-sync',
        invokedAt: new Date().toISOString(),
      },
    })

    console.log(
      `[myposoft-sync cron] OK: ${result.recordsUpserted}/${result.recordsReceived} ` +
      `records en ${result.durationMs}ms (${startDate} a ${endDate})`
    )

    try {
      const ayer = gtDate(1)
      const { data: fallbackRows, error: fallbackError } = await supabaseAdmin.rpc(
        'fill_ventas_lubricantes_fallback',
        { p_fecha: ayer }
      )
      if (fallbackError) throw fallbackError
      if (Array.isArray(fallbackRows) && fallbackRows.length > 0) {
        console.log(
          `[myposoft-sync cron] fallback lubricantes (${ayer}): ${fallbackRows.length} estaciones autocompletadas`
        )
        for (const row of fallbackRows) {
          console.log(`  - ${row.out_estacion}: ${row.out_total}`)
        }
      } else {
        console.log(`[myposoft-sync cron] fallback lubricantes (${ayer}): ya estaba todo completo`)
      }
    } catch (fallbackErr) {
      console.error('[myposoft-sync cron] fallback lubricantes ERROR:', fallbackErr.message)
    }

    return res.status(200).json({
      ok: true,
      window: { startDate, endDate },
      ...result,
    })
  } catch (e) {
    console.error('[myposoft-sync cron] ERROR:', e.message)
    return res.status(500).json({
      ok: false,
      error: e.message,
      window: { startDate, endDate },
    })
  }
}

// Vercel: aumentar timeout (default 10s puede ser poco si MyPOSoft tarda)
// Plan Pro de Vercel: max 60s
// Plan Hobby: max 10s (puede no alcanzar - considerar upgrade si falla)
export const config = {
  maxDuration: 60,
}