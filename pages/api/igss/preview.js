// pages/api/igss/preview.js
// GET /api/igss/preview?anio=2026&mes=5
// Devuelve { empleados: [...], totales: {...}, planillas_mes: [...] }
// para mostrar el recibo DR-182-1 antes de presentar.

import { requireAuth } from '../../../lib/auth'
import { calcularBaseImponibleMes, calcularCuotas } from '../../../lib/igss'

const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const anio = Number(req.query.anio)
  const mes  = Number(req.query.mes)
  if (!anio || !mes || mes < 1 || mes > 12) {
    return res.status(400).json({ error: 'anio y mes (1-12) requeridos' })
  }

  try {
    const empleados = await calcularBaseImponibleMes(auth.admin, anio, mes)

    // Sumar cuotas por empleado
    const empleadosConCuotas = empleados.map(e => ({
      ...e,
      cuotas: calcularCuotas(e.sal_mensual_igss),
    }))

    const totales = empleadosConCuotas.reduce((acc, e) => {
      acc.total_salarios += e.sal_mensual_igss
      acc.patronal       += e.cuotas.patronal
      acc.laboral        += e.cuotas.laboral
      acc.irtra          += e.cuotas.irtra
      acc.intecap        += e.cuotas.intecap
      return acc
    }, { total_salarios: 0, patronal: 0, laboral: 0, irtra: 0, intecap: 0 })

    Object.keys(totales).forEach(k => totales[k] = round(totales[k]))
    totales.total_pagar = round(totales.patronal + totales.laboral + totales.irtra + totales.intecap)
    totales.trabajadores = empleadosConCuotas.length

    // Info de planillas del mes
    const { data: planillas } = await auth.admin
      .from('planillas').select('id, periodo, quincena, estado, total_liquido')
      .eq('anio', anio).eq('mes', mes).order('quincena')

    return res.status(200).json({
      ok: true, anio, mes,
      empleados: empleadosConCuotas, totales,
      planillas_mes: planillas || [],
    })
  } catch (e) {
    console.error('[igss.preview] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
