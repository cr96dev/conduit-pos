// pages/api/neonet/pos-credentials.js
// Devuelve TODO lo que el wrapper Android necesita para disparar el Intent
// `com.visanet.pos.START_ACTIVITY` del NeoPOS App.
//
// Por que un solo endpoint:
//   El Intent del NeoPOS necesita 5 extras (token, merchantUser,
//   merchantPasswd, terminalId, cardAcqId). Bakearlos en el APK significa
//   que cualquiera con acceso al .apk puede leerlos. Mejor: el APK pide
//   estas credenciales JIT al backend, autenticandose con el access_token
//   del admin que esta logueado en la WebView.
//
// Auth:
//   Bearer <supabase access_token> con rol admin (via requireAdmin).
//
// Respuesta (ok):
//   {
//     ok: true,
//     token: '<JWT VNGAuthenticator>',
//     tokenExpiresAt: '2026-06-07T...Z',
//     merchant: { user: '...', passwd: '...' },
//     terminal: { id: '18070542', cardAcqId: '42072024' },
//     ttl_seconds: 86400
//   }
//
// El wrapper NO cachea — pide credenciales en cada cobro. El JWT es lo
// caro de obtener y eso ya lo cacheamos backend-side en lib/neonet/auth.
//
// IMPORTANTE: este endpoint NUNCA debe servirse a un browser desktop
// expuesto a cualquier sesion. Requiere rol admin Y deberia limitarse a
// dispositivos conocidos (Sunmi). De momento confiamos en requireAdmin +
// rotacion de tokens Supabase; cuando llegue el segundo Sunmi se puede
// agregar lista blanca por device_id.

import { obtenerJWT, NeonetAuthError } from '../../../lib/neonet/auth'
import { requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const merchantUser = process.env.NEONET_MERCHANT_USER
  const merchantPasswd = process.env.NEONET_MERCHANT_PASSWD
  if (!merchantUser || !merchantPasswd) {
    return res.status(500).json({
      ok: false,
      error: 'NEONET_MERCHANT_USER / NEONET_MERCHANT_PASSWD no configuradas',
    })
  }

  let token, expiresAt
  try {
    const r = await obtenerJWT()
    token = r.token
    expiresAt = r.expiresAt
  } catch (e) {
    if (e instanceof NeonetAuthError) {
      return res.status(502).json({ ok: false, etapa: e.etapa, error: e.message })
    }
    console.error('[neonet/pos-credentials] ERROR JWT:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }

  // Headers anti-cache. No queremos que ninguna capa (CDN, browser) guarde
  // las credenciales.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  res.setHeader('Pragma', 'no-cache')

  return res.status(200).json({
    ok: true,
    token,
    tokenExpiresAt: new Date(expiresAt).toISOString(),
    ttl_seconds: Math.max(0, Math.round((expiresAt - Date.now()) / 1000)),
    merchant: {
      user: merchantUser,
      passwd: merchantPasswd,
    },
    terminal: {
      id: process.env.NEONET_TERMINAL_ID || '18070542',
      cardAcqId: process.env.NEONET_CARD_ACQ_ID || '42072024',
    },
    admin: {
      id: auth.user.id,
      email: auth.perfil.email,
    },
  })
}
