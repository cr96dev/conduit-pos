// lib/qbo/emailAlerts.js
// Envia alertas por email sobre el estado del sync QBO usando Brevo API

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

/**
 * Parsea ALERT_EMAIL_TO que puede ser un email o varios separados por coma
 */
function parseDestinatarios() {
  const raw = process.env.ALERT_EMAIL_TO || ''
  return raw.split(',')
    .map(e => e.trim())
    .filter(e => e.length > 0)
    .map(email => ({ email }))
}

/**
 * Envia email usando Brevo API
 */
async function enviarEmailBrevo(subject, htmlContent) {
  if (!process.env.BREVO_API_KEY) {
    console.log('[Email] BREVO_API_KEY no configurado, saltando')
    return { skipped: true, reason: 'no_api_key' }
  }

  const destinatarios = parseDestinatarios()
  if (destinatarios.length === 0) {
    console.log('[Email] ALERT_EMAIL_TO vacio, saltando')
    return { skipped: true, reason: 'no_recipients' }
  }

  const fromEmail = process.env.ALERT_EMAIL_FROM || 'noreply@hidrocom.net'
  const fromName = process.env.ALERT_EMAIL_FROM_NAME || 'Hidrocom QBO Sync'

  try {
    const response = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        sender: { name: fromName, email: fromEmail },
        to: destinatarios,
        subject: subject,
        htmlContent: htmlContent
      })
    })

    const responseText = await response.text()

    if (!response.ok) {
      console.error('[Email] Brevo error:', response.status, responseText)
      return { sent: false, error: `Brevo ${response.status}: ${responseText}` }
    }

    const data = JSON.parse(responseText)
    console.log(`[Email] Enviado OK a ${destinatarios.length} destinatarios, messageId:`, data.messageId)
    return { sent: true, messageId: data.messageId, destinatarios: destinatarios.length }
  } catch (err) {
    console.error('[Email] Error enviando:', err.message)
    return { sent: false, error: err.message }
  }
}

/**
 * Envia email de resumen post-sync
 */
export async function enviarReporteSync(resultado, fecha, duracionSeg) {
  const r = resultado

  const totalExitos = (r.combustible?.exitos || 0) + (r.lubricantes?.exitos || 0) + (r.tienda?.exitos || 0)
  const totalErrores = (r.combustible?.errores || 0) + (r.lubricantes?.errores || 0) + (r.tienda?.errores || 0)
  const sumarMontos = (detalle) => (detalle || []).reduce((s, x) => s + (parseFloat(x.monto) || 0), 0)
  const montoCombustible = sumarMontos(r.combustible?.detalle)
  const montoLubricantes = sumarMontos(r.lubricantes?.detalle)
  const montoTienda = sumarMontos(r.tienda?.detalle)
  const totalMonto = montoCombustible + montoLubricantes + montoTienda

  let status, emoji, color
  if (totalErrores === 0 && totalExitos > 0) {
    status = 'OK'; emoji = '✅'; color = '#2ca01c'
  } else if (totalErrores > 0 && totalExitos > 0) {
    status = 'PARCIAL'; emoji = '⚠️'; color = '#f59e0b'
  } else if (totalExitos === 0 && totalErrores === 0) {
    status = 'SIN DATOS'; emoji = 'ℹ️'; color = '#6b7280'
  } else {
    status = 'FALLO'; emoji = '🔴'; color = '#dc2626'
  }

  const fmtMonto = (n) => 'Q' + n.toLocaleString('es-GT', {minimumFractionDigits: 2, maximumFractionDigits: 2})

  const subject = `${emoji} QBO Sync ${status} - ${fecha} - ${totalExitos} SRs ${fmtMonto(totalMonto)}`

  const erroresHtml = []
  for (const cat of ['combustible', 'lubricantes', 'tienda']) {
    const errs = (r[cat]?.detalle || []).filter(d => d.error)
    for (const e of errs) {
      erroresHtml.push(`<li><strong>${cat}</strong> · ${e.estacion || 'N/A'}: ${e.error}</li>`)
    }
  }

  const html = `
<html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; max-width: 720px; margin: 0 auto; color: #1f2937;">
  <h2 style="color: ${color}; margin-bottom: 8px;">${emoji} Hidrocom QBO Sync — ${status}</h2>
  <p style="color: #6b7280; margin-top: 0;">
    Fecha procesada: <strong>${fecha}</strong> · Duracion: ${duracionSeg}s · Total: <strong>${fmtMonto(totalMonto)}</strong>
  </p>

  <table style="border-collapse: collapse; width: 100%; margin-top: 16px; font-size: 14px;">
    <thead>
      <tr style="background: #f3f4f6;">
        <th style="text-align: left; padding: 10px; border: 1px solid #e5e7eb;">Categoria</th>
        <th style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">Exitos</th>
        <th style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">Errores</th>
        <th style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">Monto</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding: 10px; border: 1px solid #e5e7eb;">Combustible</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${r.combustible?.exitos || 0}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb; color: ${(r.combustible?.errores || 0) > 0 ? '#dc2626' : '#1f2937'};">${r.combustible?.errores || 0}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(montoCombustible)}</td>
      </tr>
      <tr>
        <td style="padding: 10px; border: 1px solid #e5e7eb;">Lubricantes</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${r.lubricantes?.exitos || 0}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb; color: ${(r.lubricantes?.errores || 0) > 0 ? '#dc2626' : '#1f2937'};">${r.lubricantes?.errores || 0}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(montoLubricantes)}</td>
      </tr>
      <tr>
        <td style="padding: 10px; border: 1px solid #e5e7eb;">Tienda</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${r.tienda?.exitos || 0}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb; color: ${(r.tienda?.errores || 0) > 0 ? '#dc2626' : '#1f2937'};">${r.tienda?.errores || 0}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(montoTienda)}</td>
      </tr>
      <tr style="background: #f9fafb; font-weight: 600;">
        <td style="padding: 10px; border: 1px solid #e5e7eb;">TOTAL</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${totalExitos}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb; color: ${totalErrores > 0 ? '#dc2626' : '#1f2937'};">${totalErrores}</td>
        <td style="text-align: right; padding: 10px; border: 1px solid #e5e7eb;">${fmtMonto(totalMonto)}</td>
      </tr>
    </tbody>
  </table>

  ${erroresHtml.length > 0 ? `
    <div style="margin-top: 20px; padding: 12px; background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 4px;">
      <strong style="color: #991b1b;">Errores detectados:</strong>
      <ul style="margin: 8px 0 0; padding-left: 20px; color: #7f1d1d;">
        ${erroresHtml.join('\n')}
      </ul>
    </div>
  ` : ''}

  <p style="margin-top: 24px; color: #9ca3af; font-size: 12px; border-top: 1px solid #e5e7eb; padding-top: 12px;">
    Email automatico de Hidrocom QBO Integrator · ${new Date().toISOString()}
  </p>
</body></html>
  `

  return await enviarEmailBrevo(subject, html)
}

/**
 * Envia email de error fatal (cuando ni siquiera se pudo correr el sync)
 */
export async function enviarErrorFatal(error, fecha) {
  const subject = `🔴 QBO Sync FALLO FATAL - ${fecha}`
  const html = `
<html><body style="font-family: -apple-system, sans-serif; padding: 24px; max-width: 720px;">
  <h2 style="color: #dc2626;">🔴 Hidrocom QBO Sync — FALLO FATAL</h2>
  <p>El sync de <strong>${fecha}</strong> fallo antes de poder procesar ningun Sales Receipt.</p>
  <div style="margin: 16px 0; padding: 12px; background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 4px;">
    <strong>Error:</strong>
    <pre style="margin: 8px 0 0; white-space: pre-wrap; color: #7f1d1d;">${error}</pre>
  </div>
  <p style="color: #6b7280;">Accion recomendada: revisar Vercel logs y/o reintentar manualmente con curl.</p>
</body></html>
  `
  return await enviarEmailBrevo(subject, html)
}
