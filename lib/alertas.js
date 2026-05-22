// lib/alertas.js
// Alertas por email para Julia Bakery via Brevo.
//
// Reusa la idea del lib/qbo/emailAlerts.js (transport Brevo HTTP REST) pero
// con plantillas en espanol, identidad visual de la marca y safe-fail si
// faltan env vars (devuelve { skipped, reason } en vez de fallar).
//
// Env vars:
//   BREVO_API_KEY          api key de Brevo (server-only)
//   ALERT_EMAIL_TO         destinatarios CSV (ej. "a@x.com, b@y.com")
//   ALERT_EMAIL_FROM       remitente verificado en Brevo (sin default seguro)
//   ALERT_EMAIL_FROM_NAME  default 'Julia Bakery'
//
// Funciones:
//   enviarEmail(subject, html)               -> mailer generico
//   enviarResumenVentas(admin, fecha)        -> resumen del dia con desglose
//   enviarAlertaCierreFaltante(admin, fecha) -> solo si NO existe cierre cerrado

import { calcularVentasDelDia } from './cierres'

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

// Paleta Julia (rojo carmesi + crema).
const C_RED       = '#991b1b'
const C_RED_DARK  = '#7f1d1d'
const C_CREAM     = '#fef7ed'
const C_TXT       = '#1f2937'
const C_TXT_LIGHT = '#6b7280'
const C_BORDER    = '#e5e7eb'
const C_GREEN     = '#047857'
const C_AMBER     = '#b45309'
const C_AMBER_BG  = '#fef3c7'

// Helpers de formato.
function fmtQ(n) {
  return 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtFechaLarga(fecha) {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return dt.toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}

function parseDestinatarios() {
  const raw = process.env.ALERT_EMAIL_TO || ''
  return raw.split(',').map(e => e.trim()).filter(e => e.length > 0).map(email => ({ email }))
}

// ---------------------------------------------------------------------------
// Transport generico
// ---------------------------------------------------------------------------

export async function enviarEmail(subject, htmlContent) {
  if (!process.env.BREVO_API_KEY) {
    console.log('[alertas] BREVO_API_KEY no configurado, skip')
    return { skipped: true, reason: 'no_api_key' }
  }
  const destinatarios = parseDestinatarios()
  if (destinatarios.length === 0) {
    console.log('[alertas] ALERT_EMAIL_TO vacio, skip')
    return { skipped: true, reason: 'no_recipients' }
  }
  const fromEmail = process.env.ALERT_EMAIL_FROM
  if (!fromEmail) {
    console.log('[alertas] ALERT_EMAIL_FROM no configurado, skip')
    return { skipped: true, reason: 'no_from' }
  }
  const fromName = process.env.ALERT_EMAIL_FROM_NAME || 'Julia Bakery'

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: destinatarios,
        subject,
        htmlContent,
      }),
    })
    const text = await response.text()
    if (!response.ok) {
      console.error('[alertas] Brevo error:', response.status, text)
      return { sent: false, error: `Brevo ${response.status}: ${text}` }
    }
    const data = JSON.parse(text)
    console.log(`[alertas] OK -> ${destinatarios.length} destinatario(s), messageId=`, data.messageId)
    return { sent: true, messageId: data.messageId, destinatarios: destinatarios.length }
  } catch (e) {
    console.error('[alertas] error enviando:', e.message)
    return { sent: false, error: e.message }
  }
}

// ---------------------------------------------------------------------------
// Plantilla base (header marca + footer)
// ---------------------------------------------------------------------------

function plantillaBase({ titulo, subtitulo, cuerpoHtml, colorAccento = C_RED }) {
  const tagline = 'Reporte automatico de Julia Bakery'
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:${C_CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${C_TXT};">
  <table width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${C_CREAM};padding:24px 12px;">
    <tr><td align="center">
      <table width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${C_BORDER};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${colorAccento};padding:24px 28px;color:#ffffff;">
            <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;opacity:.85;margin-bottom:6px;">Julia Bakery</div>
            <div style="font-size:22px;font-weight:600;line-height:1.2;">${escapeHtml(titulo)}</div>
            ${subtitulo ? `<div style="font-size:13px;opacity:.85;margin-top:4px;">${escapeHtml(subtitulo)}</div>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px;">
            ${cuerpoHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:14px 28px;background:#fafafa;border-top:1px solid ${C_BORDER};color:${C_TXT_LIGHT};font-size:11px;">
            ${tagline} &middot; ${new Date().toISOString()}
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

// ---------------------------------------------------------------------------
// Resumen de ventas del dia
// ---------------------------------------------------------------------------

export async function enviarResumenVentas(admin, fecha) {
  const v = await calcularVentasDelDia(admin, fecha)
  const fechaLarga = fmtFechaLarga(fecha)

  // Lee el cierre si existe para enriquecer.
  const { data: cierre } = await admin
    .from('cierres_caja')
    .select('id, estado, conteo_efectivo, saldo_esperado, diferencia, egresos_total, cerrado_at')
    .eq('fecha', fecha)
    .maybeSingle()

  const desgloseFilas = Object.entries(v.desglose_pagos || {})
    .sort((a, b) => b[1] - a[1])
    .map(([nombre, monto]) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};color:${C_TXT};">${escapeHtml(nombre)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};text-align:right;color:${C_TXT};font-variant-numeric:tabular-nums;">${fmtQ(monto)}</td>
      </tr>`).join('')

  const sinVentas = v.cantidad_recibos === 0
  const subtotalHtml = sinVentas
    ? `<div style="padding:18px;background:${C_AMBER_BG};border-radius:8px;color:${C_AMBER};font-size:14px;text-align:center;">No se registraron ventas en Loyverse para este dia.</div>`
    : `
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;border:1px solid ${C_BORDER};border-radius:8px;overflow:hidden;">
        <tr><td style="padding:18px 20px;background:#fafafa;">
          <div style="font-size:12px;color:${C_TXT_LIGHT};text-transform:uppercase;letter-spacing:.8px;">Total del dia</div>
          <div style="font-size:30px;font-weight:600;color:${C_RED};margin-top:6px;font-variant-numeric:tabular-nums;">${fmtQ(v.ventas_total)}</div>
          <div style="font-size:13px;color:${C_TXT_LIGHT};margin-top:4px;">${v.cantidad_recibos} recibo${v.cantidad_recibos === 1 ? '' : 's'} de Loyverse</div>
        </td></tr>
      </table>

      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:${C_TXT_LIGHT};margin:0 0 10px;font-weight:600;">Desglose por metodo de pago</h3>
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid ${C_BORDER};border-radius:8px;overflow:hidden;font-size:14px;">
        ${desgloseFilas}
        <tr>
          <td style="padding:10px 12px;background:#fafafa;color:${C_TXT};font-weight:600;">Total</td>
          <td style="padding:10px 12px;background:#fafafa;text-align:right;color:${C_TXT};font-weight:600;font-variant-numeric:tabular-nums;">${fmtQ(v.ventas_total)}</td>
        </tr>
      </table>
    `

  // Bloque opcional: estado del cierre.
  let cierreHtml = ''
  if (cierre) {
    const dif = Number(cierre.diferencia)
    const difLabel = Number.isFinite(dif)
      ? (dif > 0 ? `Sobrante de ${fmtQ(dif)}` : dif < 0 ? `Faltante de ${fmtQ(Math.abs(dif))}` : 'Sin diferencia')
      : 'Sin conteo cargado'
    const difColor = !Number.isFinite(dif) ? C_TXT_LIGHT : (Math.abs(dif) > 0 ? C_AMBER : C_GREEN)
    cierreHtml = `
      <h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:${C_TXT_LIGHT};margin:20px 0 10px;font-weight:600;">Cierre de caja</h3>
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid ${C_BORDER};border-radius:8px;overflow:hidden;font-size:14px;">
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};color:${C_TXT_LIGHT};">Estado</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};text-align:right;color:${cierre.estado === 'cerrado' ? C_GREEN : C_AMBER};text-transform:uppercase;font-size:12px;letter-spacing:.5px;font-weight:600;">${escapeHtml(cierre.estado)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};color:${C_TXT_LIGHT};">Esperado en caja</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};text-align:right;color:${C_TXT};font-variant-numeric:tabular-nums;">${fmtQ(cierre.saldo_esperado)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};color:${C_TXT_LIGHT};">Conteo fisico</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};text-align:right;color:${C_TXT};font-variant-numeric:tabular-nums;">${cierre.conteo_efectivo != null ? fmtQ(cierre.conteo_efectivo) : '—'}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;color:${C_TXT_LIGHT};">Diferencia</td>
          <td style="padding:8px 12px;text-align:right;color:${difColor};font-weight:600;font-variant-numeric:tabular-nums;">${escapeHtml(difLabel)}</td>
        </tr>
      </table>`
  }

  const cuerpoHtml = subtotalHtml + cierreHtml

  const subject = sinVentas
    ? `Julia Bakery · Sin ventas el ${fecha}`
    : `Julia Bakery · ${fmtQ(v.ventas_total)} en ventas el ${fecha}`

  const html = plantillaBase({
    titulo: sinVentas ? 'Sin ventas registradas' : `Ventas del dia: ${fmtQ(v.ventas_total)}`,
    subtitulo: fechaLarga,
    cuerpoHtml,
  })

  return await enviarEmail(subject, html)
}

// ---------------------------------------------------------------------------
// Alerta: falta cierre del dia anterior
// ---------------------------------------------------------------------------

export async function enviarAlertaCierreFaltante(admin, fecha) {
  // Buscar si existe cierre cerrado para esa fecha.
  const { data: cierre } = await admin
    .from('cierres_caja')
    .select('id, estado, cerrado_at')
    .eq('fecha', fecha)
    .maybeSingle()

  if (cierre && cierre.estado === 'cerrado') {
    return { skipped: true, reason: 'cierre_ok' }
  }

  // No esta cerrado: armar la alerta. Incluimos ventas del dia para que el
  // destinatario tenga contexto inmediato sin abrir la app.
  let ventas = null
  try {
    ventas = await calcularVentasDelDia(admin, fecha)
  } catch (e) {
    console.warn('[alertas] no se pudo calcular ventas para alerta cierre:', e.message)
  }

  const estadoActual = cierre ? `cierre <strong>${escapeHtml(cierre.estado)}</strong> (no fue marcado como cerrado)` : `<strong>no se creo</strong> ningun cierre`
  const fechaLarga = fmtFechaLarga(fecha)

  const cuerpoVentas = ventas
    ? `
      <table width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 18px;border:1px solid ${C_BORDER};border-radius:8px;overflow:hidden;font-size:14px;">
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};color:${C_TXT_LIGHT};">Recibos Loyverse</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};text-align:right;font-variant-numeric:tabular-nums;">${ventas.cantidad_recibos}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};color:${C_TXT_LIGHT};">Total ventas</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${C_BORDER};text-align:right;font-variant-numeric:tabular-nums;">${fmtQ(ventas.ventas_total)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;color:${C_TXT_LIGHT};">Efectivo</td>
          <td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${fmtQ(ventas.ventas_efectivo)}</td>
        </tr>
      </table>
    `
    : ''

  const cuerpoHtml = `
    <p style="font-size:15px;line-height:1.5;color:${C_TXT};margin:0 0 16px;">
      No encontramos un cierre de caja cerrado para el <strong>${escapeHtml(fecha)}</strong> (${escapeHtml(fechaLarga)}). Hoy ${estadoActual}.
    </p>
    <p style="font-size:14px;line-height:1.5;color:${C_TXT_LIGHT};margin:0 0 18px;">
      Cargalo en cuanto puedas para no perder la conciliacion entre Loyverse y el efectivo fisico.
    </p>
    ${cuerpoVentas}
    <a href="https://julia-bakery.vercel.app/caja"
       style="display:inline-block;background:${C_RED};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;font-weight:600;">
      Abrir caja en Julia Bakery &rarr;
    </a>
  `

  const subject = `Julia Bakery · Falta el cierre de caja del ${fecha}`
  const html = plantillaBase({
    titulo: 'Falta el cierre de caja',
    subtitulo: fechaLarga,
    cuerpoHtml,
    colorAccento: C_RED_DARK,
  })

  const result = await enviarEmail(subject, html)
  return { ...result, cierre_estado_actual: cierre?.estado || 'inexistente' }
}
