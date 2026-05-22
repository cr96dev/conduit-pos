// GET /api/reportes/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
import { requireAuth } from '../../../lib/auth'
import { calcularVentasRango } from '../../../lib/reportes'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { desde, hasta } = req.query
  if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) return res.status(400).json({ error: 'desde (YYYY-MM-DD) requerida' })
  if (!hasta || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return res.status(400).json({ error: 'hasta (YYYY-MM-DD) requerida' })

  try {
    const data = await calcularVentasRango(auth.admin, desde, hasta)
    return res.status(200).json({ ok: true, ...data })
  } catch (e) {
    console.error('[reportes.ventas] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

export const config = { maxDuration: 60 }
