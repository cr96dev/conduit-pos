// pages/api/qbo/setup/create-bank-account.js
// Crea cuenta bank "Custodia Combustible Bank" en QBO production
// para usar como DepositToAccount

import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

const QBO_API_BASE = 'https://quickbooks.api.intuit.com'

async function getAccessToken() {
  const { data: token } = await supabaseAdmin
    .from('qbo_tokens').select('*').eq('is_production', true).limit(1).single()
  if (!token) throw new Error('No prod token')

  const now = new Date()
  const accessExpires = new Date(token.access_token_expires_at)
  if (accessExpires - now > 5 * 60 * 1000) {
    return { accessToken: token.access_token, realmId: token.realm_id }
  }
  const r = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${process.env.QBO_CLIENT_ID_PROD}:${process.env.QBO_CLIENT_SECRET_PROD}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token }).toString()
  })
  const data = await r.json()
  await supabaseAdmin.from('qbo_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    access_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + data.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString()
  }).eq('realm_id', token.realm_id)
  return { accessToken: data.access_token, realmId: token.realm_id }
}

async function qboCall(realmId, accessToken, method, path, body = null) {
  const url = `${QBO_API_BASE}/v3/company/${realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=75`
  const options = {
    method,
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
  }
  if (body) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  const text = await response.text()
  if (!response.ok) throw new Error(`QBO ${response.status}: ${text.substring(0, 500)}`)
  return JSON.parse(text)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { accessToken, realmId } = await getAccessToken()

    // Verificar si ya existe
    const existing = await qboCall(realmId, accessToken, 'GET',
      `/query?query=${encodeURIComponent("SELECT * FROM Account WHERE Name = 'Custodia Combustible Bank'")}`)

    if (existing.QueryResponse?.Account?.length > 0) {
      const acc = existing.QueryResponse.Account[0]
      return res.status(200).json({
        success: true,
        message: 'Cuenta ya existe',
        account: { Id: acc.Id, Name: acc.Name, AccountType: acc.AccountType }
      })
    }

    // Crear nueva cuenta tipo Bank
    const result = await qboCall(realmId, accessToken, 'POST', '/account', {
      Name: 'Custodia Combustible Bank',
      AccountType: 'Bank',
      AccountSubType: 'Checking',
      Description: 'Cuenta puente para Deposits de combustible. DR aqui, CR contra Custodia 2-3-10.',
      AcctNum: '1-1-99',
      CurrencyRef: { value: 'GTQ' }
    })

    return res.status(200).json({
      success: true,
      message: 'Cuenta creada',
      account: {
        Id: result.Account.Id,
        Name: result.Account.Name,
        AccountType: result.Account.AccountType
      }
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
