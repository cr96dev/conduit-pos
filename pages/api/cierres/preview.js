// pages/api/cierres/preview.js
// GET /api/cierres/preview?fecha=YYYY-MM-DD
// Devuelve los totales de venta calculados desde Loyverse para esa fecha GT.
// Util para que el UI muestre el desglose ANTES de cerrar.

import { requireAuth } from '../../../lib/auth'
import { calcularVentasDelDia } from '../../../lib/cierres'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { fecha } = req.query
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha (YYYY-MM-DD) requerida' })
  }

  try {
    const ventas = await calcularVentasDelDia(auth.admin, fecha)
    return res.status(200).json({ ok: true, fecha, ...ventas })
  } catch (e) {
    console.error('[cierres.preview] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
