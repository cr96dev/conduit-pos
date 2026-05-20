// pages/api/qbo/auth/connect.js
// Inicia el flujo OAuth 2.0 con Intuit
// GET /api/qbo/auth/connect

import crypto from 'crypto'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const state = crypto.randomBytes(32).toString('hex')

  res.setHeader('Set-Cookie', `qbo_oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`)

  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: process.env.QBO_REDIRECT_URI,
    state: state
  })

  const authUrl = `https://appcenter.intuit.com/connect/oauth2?${params}`

  console.log(`[QBO Auth] Iniciando OAuth flow. State: ${state.substring(0, 8)}...`)
  res.redirect(authUrl)
}
