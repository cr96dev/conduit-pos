// pages/api/contacto.js
//
// POST /api/contacto
//   Body: { nombre, negocio, email, telefono, mensaje, fuente? }
//
//   Captura leads desde el form del landing. Hace 3 cosas:
//
//   1. Valida campos mínimos
//   2. Envía email vía Resend si RESEND_API_KEY está configurada
//      (a hola@conduitgt.net por default; configurable via CONTACT_TO)
//   3. Log estructurado para Vercel logs (siempre, para auditoría)
//
//   Si Resend no está configurado, el lead queda solo en logs — vale como
//   captura mínima durante Fase 1. En Fase 2 movemos a Supabase + Resend.
//
// Auth: público. Rate-limit recomendado en producción (no implementado aún).
// Anti-spam: campo honeypot (campo_secreto vacío esperado).

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = req.body || {}
  const {
    nombre = '',
    negocio = '',
    email = '',
    telefono = '',
    mensaje = '',
    fuente = 'landing',
    campo_secreto = '',  // honeypot — bots lo llenan, humanos no
  } = body

  // Honeypot: si está lleno, es bot. Respondemos 200 pero descartamos.
  if (campo_secreto) {
    console.log('[contacto] HONEYPOT triggered — bot blocked')
    return res.status(200).json({ ok: true })
  }

  // Validación mínima
  const nombreLimpio = String(nombre).trim().slice(0, 100)
  const negocioLimpio = String(negocio).trim().slice(0, 100)
  const emailLimpio = String(email).trim().toLowerCase().slice(0, 200)
  const telefonoLimpio = String(telefono).trim().slice(0, 30)
  const mensajeLimpio = String(mensaje).trim().slice(0, 2000)

  if (!nombreLimpio) return res.status(400).json({ error: 'Nombre requerido' })
  if (!emailLimpio || !emailLimpio.includes('@')) return res.status(400).json({ error: 'Email válido requerido' })
  if (!negocioLimpio) return res.status(400).json({ error: 'Nombre del negocio requerido' })

  // Log estructurado para Vercel logs
  const lead = {
    timestamp: new Date().toISOString(),
    fuente,
    nombre: nombreLimpio,
    negocio: negocioLimpio,
    email: emailLimpio,
    telefono: telefonoLimpio,
    mensaje: mensajeLimpio,
    ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown',
    user_agent: req.headers['user-agent']?.slice(0, 200) || 'unknown',
  }
  console.log('[contacto] NEW LEAD:', JSON.stringify(lead))

  // Envío de email vía Resend (si está configurado)
  const resendKey = process.env.RESEND_API_KEY
  const contactTo = process.env.CONTACT_TO || 'hola@conduitgt.net'
  const contactFrom = process.env.CONTACT_FROM || 'Conduit POS <noreply@conduitgt.net>'

  let emailSent = false
  if (resendKey) {
    try {
      const html = `
        <div style="font-family: -apple-system, sans-serif; max-width: 560px; padding: 32px; background: #FBF7F0;">
          <h2 style="font-family: Georgia, serif; color: #1F1411; margin-bottom: 8px;">Nuevo lead desde el landing</h2>
          <p style="color: #6E5C52; font-size: 13px; margin-bottom: 24px;">${lead.timestamp}</p>

          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #DDD3C1; color: #6E5C52; width: 100px;">Nombre</td><td style="padding: 8px 0; border-bottom: 1px solid #DDD3C1; color: #1F1411; font-weight: 600;">${nombreLimpio}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #DDD3C1; color: #6E5C52;">Negocio</td><td style="padding: 8px 0; border-bottom: 1px solid #DDD3C1; color: #1F1411; font-weight: 600;">${negocioLimpio}</td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #DDD3C1; color: #6E5C52;">Email</td><td style="padding: 8px 0; border-bottom: 1px solid #DDD3C1;"><a href="mailto:${emailLimpio}" style="color: #D7461C;">${emailLimpio}</a></td></tr>
            <tr><td style="padding: 8px 0; border-bottom: 1px solid #DDD3C1; color: #6E5C52;">Teléfono</td><td style="padding: 8px 0; border-bottom: 1px solid #DDD3C1;"><a href="https://wa.me/${telefonoLimpio.replace(/\D/g, '')}" style="color: #D7461C;">${telefonoLimpio || '—'}</a></td></tr>
            <tr><td style="padding: 8px 0; color: #6E5C52; vertical-align: top;">Mensaje</td><td style="padding: 8px 0; color: #1F1411;">${mensajeLimpio || '—'}</td></tr>
          </table>

          <p style="color: #9C8A7E; font-size: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid #DDD3C1;">
            Fuente: ${fuente} · IP: ${lead.ip}<br/>
            Respondé directo al email del cliente para abrir conversación.
          </p>
        </div>
      `
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendKey}`,
        },
        body: JSON.stringify({
          from: contactFrom,
          to: [contactTo],
          subject: `🔥 Lead Conduit · ${negocioLimpio} · ${nombreLimpio}`,
          html,
          reply_to: emailLimpio,
        }),
      })
      if (resp.ok) {
        emailSent = true
        console.log('[contacto] email enviado a', contactTo)
      } else {
        const errText = await resp.text()
        console.error('[contacto] Resend falló:', resp.status, errText.slice(0, 200))
      }
    } catch (e) {
      console.error('[contacto] Resend error:', e.message)
    }
  } else {
    console.log('[contacto] RESEND_API_KEY no configurada — lead solo en logs')
  }

  return res.status(200).json({
    ok: true,
    email_sent: emailSent,
    message: 'Recibido. Te contactamos en menos de 24 horas.',
  })
}
