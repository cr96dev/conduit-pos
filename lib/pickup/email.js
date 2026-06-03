// lib/pickup/email.js
//
// Envío de emails de confirmación de pedido pickup.
// Provider: Resend (https://resend.com) — 3,000 emails/mes gratis.
// Setup: env var RESEND_API_KEY + verificar dominio juliabakery.com.gt
// (mientras no hay dominio, se envía desde onboarding@resend.dev pero
// solo a emails del owner).

const RESEND_API = 'https://api.resend.com/emails'

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function renderEmailConfirmacion({ referencia, items, total, slot_label, day_label, baseUrl, order_id }) {
  const itemsHtml = (items || []).map(it => `
    <tr>
      <td style="padding:8px 0;color:#1c1c18;font-size:15px">
        ${it.cantidad}× ${htmlEscape(it.descripcion)}
      </td>
      <td style="padding:8px 0;color:#1c1c18;font-size:15px;text-align:right;font-variant-numeric:tabular-nums">
        Q${(Number(it.cantidad) * Number(it.precio_unitario)).toFixed(2)}
      </td>
    </tr>
  `).join('')

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Pedido confirmado · Julia Bakery</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#fdf9f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table cellpadding="0" cellspacing="0" border="0" style="background:#fdf9f2;width:100%;padding:32px 16px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%;background:#fdf9f2">
        <tr><td align="center" style="padding:16px 0 24px">
          <img src="${baseUrl}/pickup/logo.png" width="80" alt="Julia Bakery" style="display:block">
        </td></tr>
        <tr><td style="font-family:'Cinzel',Georgia,serif;font-size:32px;color:#1c1c18;text-align:center;line-height:1.1;padding:0 16px">
          ¡Tu pedido está confirmado!
        </td></tr>
        <tr><td style="text-align:center;color:#5b403e;font-size:15px;padding:12px 16px 32px">
          Te esperamos para recogerlo cuando esté listo.
        </td></tr>

        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff;border:1px solid #e4beba;border-radius:16px;padding:24px">
            <tr><td style="font-size:12px;color:#5b403e;text-transform:uppercase;letter-spacing:0.08em;padding-bottom:6px">Pedido</td></tr>
            <tr><td style="font-family:'Cinzel',Georgia,serif;font-size:24px;color:#a40016;letter-spacing:0.05em;padding-bottom:20px">
              ${htmlEscape(referencia)}
            </td></tr>
            <tr><td style="border-top:1px solid #f1ede6;padding-top:16px">
              <table cellpadding="0" cellspacing="0" border="0" style="width:100%">
                ${itemsHtml}
                <tr><td colspan="2" style="border-top:1px solid #f1ede6;padding-top:12px;margin-top:8px"></td></tr>
                <tr>
                  <td style="font-weight:600;color:#1c1c18;font-size:18px;padding-top:12px">Total</td>
                  <td style="font-weight:700;color:#1c1c18;font-size:24px;text-align:right;padding-top:12px;font-variant-numeric:tabular-nums">
                    Q${Number(total || 0).toFixed(2)}
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        ${slot_label ? `
        <tr><td style="padding-top:16px">
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#f7f3ec;border:1px solid #e4beba;border-radius:16px;padding:20px">
            <tr><td style="font-size:12px;color:#5b403e;text-transform:uppercase;letter-spacing:0.08em;padding-bottom:4px">Recogés</td></tr>
            <tr><td style="font-family:'Cinzel',Georgia,serif;font-size:22px;color:#1c1c18;line-height:1.2">
              ${htmlEscape(day_label || '')} a las ${htmlEscape(slot_label)}
            </td></tr>
            <tr><td style="color:#6a4645;font-size:13px;padding-top:8px">
              <a href="https://www.google.com/maps/place/julia+bakery/data=!4m2!3m1!1s0x8589a32272f6004d:0x88fdc9b818be06f6"
                 style="color:#a40016;text-decoration:underline;font-weight:600">
                Julia Bakery · 2 Avenida 11-08, Zona 10 →
              </a>
            </td></tr>
          </table>
        </td></tr>
        ` : ''}

        <tr><td style="padding:32px 0 16px;text-align:center">
          <a href="${baseUrl}/pickup/pedido/${order_id}"
             style="display:inline-block;background:#c8242a;color:#fff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 28px;border-radius:12px">
            Ver mi pedido
          </a>
        </td></tr>

        <tr><td style="color:#8f6f6d;font-size:12px;text-align:center;padding:24px 16px;line-height:1.6">
          Te vamos a avisar cuando esté listo para recoger.<br>
          ¿Necesitás cancelar o cambiar la hora? Respondé este correo o llamanos.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function renderEmailListo({ referencia, baseUrl, order_id }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>¡Tu pedido está listo! · Julia Bakery</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#fdf9f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table cellpadding="0" cellspacing="0" border="0" style="background:#fdf9f2;width:100%;padding:32px 16px">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%">
        <tr><td align="center" style="padding:16px 0 24px">
          <img src="${baseUrl}/pickup/logo.png" width="80" alt="Julia Bakery">
        </td></tr>
        <tr><td align="center" style="padding:0 16px 12px">
          <div style="display:inline-block;background:#fecb97;color:#79542a;font-weight:600;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;padding:6px 14px;border-radius:999px">
            🔔 Listo para recoger
          </div>
        </td></tr>
        <tr><td style="font-family:'Cinzel',Georgia,serif;font-size:32px;color:#1c1c18;text-align:center;line-height:1.1;padding:0 16px 16px">
          ¡Tu pedido está listo!
        </td></tr>
        <tr><td style="text-align:center;color:#5b403e;font-size:15px;line-height:1.5;padding:0 24px 24px">
          Pasá a recogerlo cuando puedas. Te esperamos.
        </td></tr>
        <tr><td>
          <table cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#fff;border:1px solid #e4beba;border-radius:16px;padding:24px;text-align:center">
            <tr><td style="font-size:12px;color:#5b403e;text-transform:uppercase;letter-spacing:0.08em;padding-bottom:8px">Mostrá tu pedido</td></tr>
            <tr><td style="font-family:'Cinzel',Georgia,serif;font-size:32px;color:#a40016;letter-spacing:0.06em;padding-bottom:20px">
              ${htmlEscape(referencia)}
            </td></tr>
            <tr><td style="padding-top:8px">
              <a href="https://www.google.com/maps/place/julia+bakery/data=!4m2!3m1!1s0x8589a32272f6004d:0x88fdc9b818be06f6"
                 style="display:inline-block;background:#c8242a;color:#fff;font-size:16px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:12px">
                Cómo llegar →
              </a>
            </td></tr>
            <tr><td style="color:#6a4645;font-size:13px;padding-top:16px;line-height:1.5">
              Julia Bakery<br>2 Avenida 11-08, Zona 10, Guatemala
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="color:#8f6f6d;font-size:12px;text-align:center;padding:24px 16px;line-height:1.6">
          <a href="${baseUrl}/pickup/pedido/${order_id}" style="color:#a40016;text-decoration:underline">Ver detalle del pedido</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export async function enviarEmailListo({ to, referencia, baseUrl, order_id }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY no configurada — skip envío listo')
    return { ok: false, skipped: true, reason: 'no_api_key' }
  }
  const from = process.env.RESEND_FROM_EMAIL || 'Julia Bakery <onboarding@resend.dev>'
  const html = renderEmailListo({ referencia, baseUrl, order_id })
  try {
    const r = await fetch(RESEND_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from, to: [to],
        subject: `🔔 Tu pedido ${referencia} está listo`,
        html,
      }),
    })
    const j = await r.json()
    if (!r.ok) {
      console.error('[email] Resend error (listo):', j)
      return { ok: false, error: j.message || 'Resend rechazó' }
    }
    return { ok: true, id: j.id }
  } catch (e) {
    console.error('[email] exc listo:', e.message)
    return { ok: false, error: e.message }
  }
}

export async function enviarEmailConfirmacion({ to, referencia, items, total, slot_label, day_label, baseUrl, order_id }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY no configurada — skipping send')
    return { ok: false, skipped: true, reason: 'no_api_key' }
  }
  const from = process.env.RESEND_FROM_EMAIL || 'Julia Bakery <onboarding@resend.dev>'
  const html = renderEmailConfirmacion({ referencia, items, total, slot_label, day_label, baseUrl, order_id })

  try {
    const r = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Tu pedido ${referencia} está confirmado`,
        html,
      }),
    })
    const j = await r.json()
    if (!r.ok) {
      console.error('[email] Resend error:', j)
      return { ok: false, error: j.message || 'Resend rechazó el envío' }
    }
    return { ok: true, id: j.id }
  } catch (e) {
    console.error('[email] exception:', e.message)
    return { ok: false, error: e.message }
  }
}
