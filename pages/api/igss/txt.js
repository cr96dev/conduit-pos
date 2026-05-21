// pages/api/igss/txt.js
// GET /api/igss/txt?anio=2026&mes=5
// Devuelve el archivo TXT v2.2.0 listo para subir al sistema IGSS.
// Content-Type: text/plain con Content-Disposition: attachment.

import { requireAuth } from '../../../lib/auth'
import { calcularBaseImponibleMes, generarTXTPlanillaIGSS } from '../../../lib/igss'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const anio = Number(req.query.anio)
  const mes  = Number(req.query.mes)
  if (!anio || !mes || mes < 1 || mes > 12) {
    return res.status(400).json({ error: 'anio y mes (1-12) requeridos' })
  }

  // Config patrono
  const { data: config } = await auth.admin
    .from('config_igss').select('*').limit(1).maybeSingle()
  if (!config) {
    return res.status(400).json({ error: 'No hay configuracion IGSS. Configurar primero los datos del patrono.' })
  }

  const empleados = await calcularBaseImponibleMes(auth.admin, anio, mes)
  if (empleados.length === 0) {
    return res.status(400).json({ error: 'No hay empleados con salario para ese mes' })
  }

  const txt = generarTXTPlanillaIGSS({ anio, mes, config, empleados })

  const mes2 = String(mes).padStart(2, '0')
  const hoy = new Date()
  const dd = String(hoy.getDate()).padStart(2, '0')
  const mm = String(hoy.getMonth() + 1).padStart(2, '0')
  const HH = String(hoy.getHours()).padStart(2, '0')
  const MM = String(hoy.getMinutes()).padStart(2, '0')
  const nombre = `${config.numero_patronal}-${anio}${mes2}-${dd}${mm}${anio}-${HH}${MM}.TXT`

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`)
  return res.status(200).send(txt)
}
