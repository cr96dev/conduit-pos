// pages/api/igss/declaraciones/index.js
// GET  /api/igss/declaraciones?limit=24
// POST /api/igss/declaraciones    (admin) - presentar mes:
//   Body: { anio, mes, notas?, comprobante_pago_numero?, pagada_at? }
//   Calcula totales desde planilla_lineas, genera TXT y guarda snapshot.

import { requireAuth, requireAdmin } from '../../../../lib/auth'
import { calcularBaseImponibleMes, calcularCuotas, generarTXTPlanillaIGSS } from '../../../../lib/igss'

const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return presentar(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { limit = 24 } = req.query
  const { data, error } = await auth.admin
    .from('igss_declaraciones')
    .select('id, anio, mes, trabajadores, total_salarios, total_pagar, presentada_at, pagada_at, comprobante_pago_numero')
    .order('anio', { ascending: false }).order('mes', { ascending: false })
    .limit(Math.min(Number(limit) || 24, 200))
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, declaraciones: data })
}

async function presentar(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { anio, mes, notas, comprobante_pago_numero, pagada_at } = req.body || {}
  if (!anio || !mes) return res.status(400).json({ error: 'anio y mes requeridos' })

  const { data: config } = await auth.admin.from('config_igss').select('*').limit(1).maybeSingle()
  if (!config) return res.status(400).json({ error: 'No hay configuracion IGSS' })

  const empleados = await calcularBaseImponibleMes(auth.admin, Number(anio), Number(mes))
  if (empleados.length === 0) return res.status(400).json({ error: 'Sin empleados ese mes' })

  const totales = empleados.reduce((acc, e) => {
    const c = calcularCuotas(e.sal_mensual_igss)
    acc.total_salarios += e.sal_mensual_igss
    acc.patronal       += c.patronal
    acc.laboral        += c.laboral
    acc.irtra          += c.irtra
    acc.intecap        += c.intecap
    return acc
  }, { total_salarios: 0, patronal: 0, laboral: 0, irtra: 0, intecap: 0 })
  Object.keys(totales).forEach(k => totales[k] = round(totales[k]))
  const totalPagar = round(totales.patronal + totales.laboral + totales.irtra + totales.intecap)

  const archivoTxt = generarTXTPlanillaIGSS({ anio: Number(anio), mes: Number(mes), config, empleados })

  const { data, error } = await auth.admin
    .from('igss_declaraciones').insert({
      anio: Number(anio), mes: Number(mes),
      trabajadores: empleados.length,
      total_salarios: totales.total_salarios,
      cuota_patronal: totales.patronal,
      cuota_laboral: totales.laboral,
      irtra: totales.irtra,
      intecap: totales.intecap,
      total_pagar: totalPagar,
      archivo_txt: archivoTxt,
      presentada_at: new Date().toISOString(),
      presentada_by: auth.user.id,
      pagada_at: pagada_at || null,
      comprobante_pago_numero: comprobante_pago_numero?.trim() || null,
      notas: notas?.trim() || null,
    }).select().single()

  if (error) {
    if (error.code === '23505') return res.status(409).json({ ok: false, error: 'Ya hay declaracion para ese mes' })
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(201).json({ ok: true, declaracion: data })
}
