// pages/api/qbo/auth/connect-prod.js
// OAuth init para QBO PRODUCTION (cuenta real)

import crypto from 'crypto'

export default function handler(req, res) {
  const state = crypto.randomBytes(32).toString('hex')

  res.setHeader('Set-Cookie', `qbo_oauth_state_prod=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`)

  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID_PROD,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: process.env.QBO_REDIRECT_URI_PROD,
    state: state
  })

  const authUrl = `https://appcenter.intuit.com/connect/oauth2?${params.toString()}`
  res.redirect(authUrl)
}
