// pages/api/qbo/test/prod-taxcodes.js
// Lista TaxCodes y TaxRates de QBO production

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

async function qboGet(realmId, accessToken, path) {
  const url = `${QBO_API_BASE}/v3/company/${realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=75`
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
  })
  if (!response.ok) throw new Error(`QBO ${response.status}: ${await response.text()}`)
  return response.json()
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const { accessToken, realmId } = await getAccessToken()

    const taxCodes = await qboGet(realmId, accessToken, '/query?query=' + encodeURIComponent('SELECT * FROM TaxCode MAXRESULTS 100'))
    const taxRates = await qboGet(realmId, accessToken, '/query?query=' + encodeURIComponent('SELECT * FROM TaxRate MAXRESULTS 100'))

    // Tambien company preferences
    const prefs = await qboGet(realmId, accessToken, '/preferences')

    return res.status(200).json({
      success: true,
      tax_codes: taxCodes.QueryResponse?.TaxCode?.map(t => ({
        Id: t.Id, Name: t.Name, Description: t.Description, Active: t.Active, Taxable: t.Taxable
      })) || [],
      tax_rates: taxRates.QueryResponse?.TaxRate?.map(t => ({
        Id: t.Id, Name: t.Name, RateValue: t.RateValue, Active: t.Active
      })) || [],
      currency: prefs.Preferences?.CurrencyPrefs,
      tax_prefs: prefs.Preferences?.TaxPrefs
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
