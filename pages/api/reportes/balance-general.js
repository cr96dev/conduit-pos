// GET /api/reportes/balance-general?hasta=YYYY-MM-DD
// Balance General: activos / pasivos / patrimonio (con utilidad del ejercicio).
import { requireAuth } from '../../../lib/auth'
import { calcularBalanceGeneral } from '../../../lib/reportes'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { hasta } = req.query
  if (!hasta || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return res.status(400).json({ error: 'hasta (YYYY-MM-DD) requerida' })

  try {
    const data = await calcularBalanceGeneral(auth.admin, hasta)
    return res.status(200).json({ ok: true, ...data })
  } catch (e) {
    console.error('[reportes.balance-general] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

export const config = { maxDuration: 60 }
