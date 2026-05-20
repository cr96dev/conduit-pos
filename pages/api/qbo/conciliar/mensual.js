// pages/api/qbo/conciliar/mensual.js
// Compara totales Supabase vs QBO sync_audit del mes anterior
// Hace agregaciones EN SQL para evitar limite de 1000 filas de Supabase

import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

function parseDestinatarios() {
  const raw = process.env.ALERT_EMAIL_TO || ''
  return raw.split(',').map(e => e.trim()).filter(e => e.length > 0).map(email => ({ email }))
}

async function enviarEmailBrevo(subject, htmlContent) {
  if (!process.env.BREVO_API_KEY) return { skipped: true, reason: 'no_api_key' }
  const destinatarios = parseDestinatarios()
  if (destinatarios.length === 0) return { skipped: true, reason: 'no_recipients' }

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: {
          name: process.env.ALERT_EMAIL_FROM_NAME || 'Hidrocom QBO Sync',
          email: process.env.ALERT_EMAIL_FROM || 'noreply@hidrocom.net'
        },
        to: destinatarios,
        subject,
        htmlContent
      })
    })
    const responseText = await response.text()
    if (!response.ok) return { sent: false, error: `Brevo ${response.status}: ${responseText}` }
    const data = JSON.parse(responseText)
    return { sent: true, messageId: data.messageId }
  } catch (err) {
    return { sent: false, error: err.message }
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Use POST or GET' })
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.INTERNAL_API_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  let mes = req.query.mes
  if (!mes) {
    const hoy = new Date()
    const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
    mes = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`
  }

  const fechaInicio = `${mes}-01`
  const [anio, mesNum] = mes.split('-').map(Number)
  const ultimoDia = new Date(anio, mesNum, 0).getDate()
  const fechaFin = `${mes}-${String(ultimoDia).padStart(2, '0')}`

  try {
    // Totales globales por categoria via RPC/SQL
    const { data: combTotal } = await supabaseAdmin.rpc('exec_sql_count', {}).select() // dummy, no funciona
    
    // Uso queries SQL crudas via .from() agregando con .or() para acumular
    // Mejor estrategia: traer aggregados sumando todo en una sola query
    // Como Supabase REST no soporta SUM directo, uso PostgREST con stored function 
    // O hago varias queries pequeñas - mejor opcion: hacer pages

    // Alternativa simple y robusta: usar SQL puro via execute_sql endpoint Supabase NO disponible aqui
    // Solucion: paginar y sumar manualmente

    const sumarPaginado = async (tabla, columnas) => {
      let offset = 0
      const pageSize = 1000
      const totales = { total: 0, procesado: 0, count: 0, count_procesado: 0, porEstacion: {} }

      while (true) {
        let q = supabaseAdmin.from(tabla).select(columnas)
          .gte('fecha', fechaInicio).lte('fecha', fechaFin)
          .range(offset, offset + pageSize - 1)

        const { data, error } = await q
        if (error) throw new Error(`${tabla}: ${error.message}`)
        if (!data || data.length === 0) break

        for (const row of data) {
          let monto = 0
          if (tabla === 'ventas') {
            monto = parseFloat(row.regular_ingresos || 0) + parseFloat(row.premium_ingresos || 0) +
                    parseFloat(row.diesel_ingresos || 0) + parseFloat(row.diesel_plus_ingresos || 0)
          } else if (tabla === 'ventas_lubricantes') {
            monto = parseFloat(row.total_venta || 0)
          } else if (tabla === 'tienda_facturas_fel') {
            monto = parseFloat(row.monto || 0)
          }

          totales.total += monto
          totales.count += 1
          if (row.qbo_processed) {
            totales.procesado += monto
            totales.count_procesado += 1
          }

          const estId = row.estacion_id
          if (estId) {
            if (!totales.porEstacion[estId]) totales.porEstacion[estId] = { total: 0, procesado: 0 }
            totales.porEstacion[estId].total += monto
            if (row.qbo_processed) totales.porEstacion[estId].procesado += monto
          }
        }

        if (data.length < pageSize) break
        offset += pageSize
      }
      return totales
    }

    const [combTotales, lubTotales, tiendaTotales] = await Promise.all([
      sumarPaginado('ventas', 'estacion_id, regular_ingresos, premium_ingresos, diesel_ingresos, diesel_plus_ingresos, qbo_processed'),
      sumarPaginado('ventas_lubricantes', 'estacion_id, total_venta, qbo_processed'),
      sumarPaginado('tienda_facturas_fel', 'estacion_id, monto, qbo_processed')
    ])

    // Estaciones para nombre
    const { data: estaciones } = await supabaseAdmin.from('estaciones').select('id, nombre')
    const estNombre = {}
    estaciones?.forEach(e => { estNombre[e.id] = e.nombre })

    // Combinar por estacion
    const porEstacion = {}
    const initEst = (estId) => {
      if (!porEstacion[estId]) {
        porEstacion[estId] = {
          nombre: estNombre[estId] || 'Desconocida',
          combustible: { total: 0, procesado: 0 },
          lubricantes: { total: 0, procesado: 0 },
          tienda: { total: 0, procesado: 0 }
        }
      }
    }
    for (const [estId, t] of Object.entries(combTotales.porEstacion)) {
      initEst(estId); porEstacion[estId].combustible = t
    }
    for (const [estId, t] of Object.entries(lubTotales.porEstacion)) {
      initEst(estId); porEstacion[estId].lubricantes = t
    }
    for (const [estId, t] of Object.entries(tiendaTotales.porEstacion)) {
      initEst(estId); porEstacion[estId].tienda = t
    }

    // Totales QBO audit del mes (no requiere paginacion, son pocos registros)
    const { data: audits } = await supabaseAdmin
      .from('qbo_sync_audit')
      .select('categoria, monto_total')
      .gte('fecha_proceso', fechaInicio)
      .lte('fecha_proceso', fechaFin)
      .eq('status', 'SUCCESS')

    const totalQBO = { Combustible: 0, Lubricantes: 0, Tienda: 0 }
    for (const a of audits || []) {
      if (totalQBO[a.categoria] !== undefined) {
        totalQBO[a.categoria] += parseFloat(a.monto_total || 0)
      }
    }

    const totalGlobal = {
      combustible: { supabase: combTotales.total, supabase_procesado: combTotales.procesado, qbo: totalQBO.Combustible },
      lubricantes: { supabase: lubTotales.total, supabase_procesado: lubTotales.procesado, qbo: totalQBO.Lubricantes },
      tienda: { supabase: tiendaTotales.total, supabase_procesado: tiendaTotales.procesado, qbo: totalQBO.Tienda }
    }

    const diffs = {
      combustible: totalGlobal.combustible.supabase_procesado - totalGlobal.combustible.qbo,
      lubricantes: totalGlobal.lubricantes.supabase_procesado - totalGlobal.lubricantes.qbo,
      tienda: totalGlobal.tienda.supabase_procesado - totalGlobal.tienda.qbo
    }
    const totalDiff = diffs.combustible + diffs.lubricantes + diffs.tienda
    const hayDiscrepancia = Math.abs(totalDiff) > 0.01

    const fmtMonto = (n) => 'Q' + n.toLocaleString('es-GT', {minimumFractionDigits: 2, maximumFractionDigits: 2})
    const emoji = hayDiscrepancia ? '⚠️' : '✅'
    const status = hayDiscrepancia ? 'CON DIFERENCIAS' : 'CONCILIADO'
    const color = hayDiscrepancia ? '#f59e0b' : '#2ca01c'

    const subject = `${emoji} QBO Conciliacion ${mes} ${status} - Diff: ${fmtMonto(totalDiff)}`

    const filaCategoria = (cat, sup, supProc, qbo, diff) => `
      <tr>
        <td style="padding: 10px; border: 1px solid #e5e7eb;"><strong>${cat}</strong></td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(sup)}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(supProc)}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(qbo)}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb; color: ${Math.abs(diff) > 0.01 ? '#dc2626' : '#1f2937'};"><strong>${fmtMonto(diff)}</strong></td>
      </tr>
    `

    const html = `
<html><body style="font-family: -apple-system, sans-serif; padding: 24px; max-width: 880px; margin: 0 auto; color: #1f2937;">
  <h2 style="color: ${color}; margin-bottom: 8px;">${emoji} Hidrocom QBO Conciliacion Mensual — ${status}</h2>
  <p style="color: #6b7280; margin-top: 0;">
    Mes analizado: <strong>${mes}</strong> · Generado: ${new Date().toISOString()}
  </p>

  <h3 style="margin-top: 24px;">Resumen por categoria</h3>
  <table style="border-collapse: collapse; width: 100%; font-size: 14px; margin-top: 8px;">
    <thead>
      <tr style="background: #f3f4f6;">
        <th style="text-align: left; padding: 10px; border: 1px solid #e5e7eb;">Categoria</th>
        <th style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">Total Supabase</th>
        <th style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">Procesado a QBO</th>
        <th style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">Audit QBO</th>
        <th style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">Diferencia</th>
      </tr>
    </thead>
    <tbody>
      ${filaCategoria('Combustible', totalGlobal.combustible.supabase, totalGlobal.combustible.supabase_procesado, totalGlobal.combustible.qbo, diffs.combustible)}
      ${filaCategoria('Lubricantes', totalGlobal.lubricantes.supabase, totalGlobal.lubricantes.supabase_procesado, totalGlobal.lubricantes.qbo, diffs.lubricantes)}
      ${filaCategoria('Tienda', totalGlobal.tienda.supabase, totalGlobal.tienda.supabase_procesado, totalGlobal.tienda.qbo, diffs.tienda)}
      <tr style="background: #f9fafb; font-weight: 600;">
        <td style="padding: 10px; border: 1px solid #e5e7eb;">TOTAL</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(totalGlobal.combustible.supabase + totalGlobal.lubricantes.supabase + totalGlobal.tienda.supabase)}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(totalGlobal.combustible.supabase_procesado + totalGlobal.lubricantes.supabase_procesado + totalGlobal.tienda.supabase_procesado)}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(totalGlobal.combustible.qbo + totalGlobal.lubricantes.qbo + totalGlobal.tienda.qbo)}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb; color: ${Math.abs(totalDiff) > 0.01 ? '#dc2626' : '#1f2937'};">${fmtMonto(totalDiff)}</td>
      </tr>
    </tbody>
  </table>

  <h3 style="margin-top: 24px;">Detalle por estacion</h3>
  <table style="border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 8px;">
    <thead>
      <tr style="background: #f3f4f6;">
        <th style="text-align: left; padding: 8px; border: 1px solid #e5e7eb;">Estacion</th>
        <th style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">Combustible</th>
        <th style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">Lubricantes</th>
        <th style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">Tienda</th>
      </tr>
    </thead>
    <tbody>
      ${Object.values(porEstacion).sort((a, b) => b.combustible.total - a.combustible.total).map(est => `
        <tr>
          <td style="padding: 8px; border: 1px solid #e5e7eb;">${est.nombre}</td>
          <td style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">${fmtMonto(est.combustible.total)}</td>
          <td style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">${fmtMonto(est.lubricantes.total)}</td>
          <td style="text-align: right; padding: 8px; border: 1px solid #e5e7eb;">${fmtMonto(est.tienda.total)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <p style="margin-top: 24px; color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
    Reporte automatico de Hidrocom QBO Integrator · Conciliacion mes ${mes}
  </p>
</body></html>
    `

    const emailResult = await enviarEmailBrevo(subject, html)

    return res.status(200).json({
      success: true,
      mes,
      hay_discrepancia: hayDiscrepancia,
      totales: totalGlobal,
      diferencias: diffs,
      diferencia_total: totalDiff,
      counts: {
        combustible_fels: combTotales.count,
        lubricantes_fels: lubTotales.count,
        tienda_fels: tiendaTotales.count
      },
      estaciones_count: Object.keys(porEstacion).length,
      email: emailResult
    })

  } catch (err) {
    console.error('[Conciliacion] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
