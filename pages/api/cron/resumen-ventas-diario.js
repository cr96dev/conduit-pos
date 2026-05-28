// pages/api/cron/resumen-ventas-diario.js
//
// Cron diario que envia por email el resumen de ventas del dia.
// Schedule default (vercel.json): 0 3 * * *  (3:00 UTC = 9:00 PM GT del dia previo)
//   -> Por eso por default toma "ayer GT": en GT son las 9 PM y queremos el resumen
//      del dia que recien termina. Si se invoca manualmente con ?fecha=YYYY-MM-DD
//      se respeta esa fecha.
// Auth: header Authorization: Bearer ${CRON_SECRET} o vercel-cron user-agent.

import { createClient } from '@supabase/supabase-js'
import { enviarResumenVentas } from '../../../lib/alertas'
import { hoyGT, fechaGT } from '../../../lib/fecha-gt'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth: Vercel Cron inyecta `Authorization: Bearer ${CRON_SECRET}` automaticamente.
  // NO aceptar user-agent vercel-cron sin token (es spoofeable desde internet).
  const expectedSecret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET
  if (!expectedSecret) {
    return res.status(500).json({ error: 'CRON_SECRET / INTERNAL_API_SECRET no configurada' })
  }
  const hasValidSecret = req.headers.authorization === `Bearer ${expectedSecret}`
  if (!hasValidSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Fecha objetivo: ?fecha=YYYY-MM-DD para test manual, sino "ayer GT".
  // (El cron corre 3:00 UTC = 9:00 PM GT del dia que recien acaba.)
  const fechaParam = req.query.fecha
  const fecha = (typeof fechaParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaParam))
    ? fechaParam
    : (req.query.fecha === 'hoy' ? hoyGT() : fechaGT(1))

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })
  }
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  try {
    const result = await enviarResumenVentas(admin, fecha)
    console.log('[cron.resumen-ventas]', fecha, result)
    return res.status(200).json({ ok: true, fecha, email: result })
  } catch (e) {
    console.error('[cron.resumen-ventas] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

export const config = { maxDuration: 60 }
