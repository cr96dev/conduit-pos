// pages/api/cron/alerta-cierre-faltante.js
//
// Cron diario que verifica si el cierre de caja del dia anterior fue cerrado.
// Si NO esta cerrado (o no existe), manda un email recordatorio.
// Si esta cerrado, devuelve { skipped, reason: 'cierre_ok' } y NO manda nada.
//
// Schedule default (vercel.json): 0 15 * * *  (15:00 UTC = 9:00 AM GT)
// Auth: header Authorization: Bearer ${CRON_SECRET} o vercel-cron user-agent.

import { createClient } from '@supabase/supabase-js'
import { enviarAlertaCierreFaltante } from '../../../lib/alertas'
import { fechaGT } from '../../../lib/fecha-gt'

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

  // Default: revisar ayer GT. Override con ?fecha=YYYY-MM-DD para test manual.
  const fechaParam = req.query.fecha
  const fecha = (typeof fechaParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fechaParam))
    ? fechaParam
    : fechaGT(1)

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ ok: false, error: 'Supabase env vars no configuradas' })
  }
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  try {
    const result = await enviarAlertaCierreFaltante(admin, fecha)
    console.log('[cron.alerta-cierre]', fecha, result)
    return res.status(200).json({ ok: true, fecha, email: result })
  } catch (e) {
    console.error('[cron.alerta-cierre] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

export const config = { maxDuration: 60 }
