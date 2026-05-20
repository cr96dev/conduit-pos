// pages/api/qbo/test/prod-read.js
// Test READ-ONLY contra QBO production
// Lee company info + lista de Classes/Customers/Items existentes
// NO crea NADA

import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

const QBO_API_BASE_PROD = 'https://quickbooks.api.intuit.com'

async function refreshTokenIfNeeded(token) {
  const now = new Date()
  const accessExpires = new Date(token.access_token_expires_at)
  if (accessExpires - now > 5 * 60 * 1000) {
    return token.access_token
  }

  // Refresh
  const refreshResponse = await fetch(
    'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(
          `${process.env.QBO_CLIENT_ID_PROD}:${process.env.QBO_CLIENT_SECRET_PROD}`
        ).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token
      }).toString()
    }
  )

  if (!refreshResponse.ok) throw new Error('Refresh failed: ' + await refreshResponse.text())
  const data = await refreshResponse.json()

  await supabaseAdmin.from('qbo_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    access_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + data.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString()
  }).eq('realm_id', token.realm_id)

  return data.access_token
}

async function qboGet(realmId, accessToken, path) {
  const url = `${QBO_API_BASE_PROD}/v3/company/${realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=75`
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  })
  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`QBO ${response.status}: ${errText.substring(0, 300)}`)
  }
  return response.json()
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Obtener token de PRODUCTION
    const { data: token, error } = await supabaseAdmin
      .from('qbo_tokens')
      .select('*')
      .eq('is_production', true)
      .limit(1)
      .single()

    if (error || !token) {
      return res.status(404).json({ error: 'No hay token PRODUCTION en DB. Hacer OAuth via /api/qbo/auth/connect-prod' })
    }

    const accessToken = await refreshTokenIfNeeded(token)

    // Test 1: Company info
    const companyInfo = await qboGet(token.realm_id, accessToken, '/companyinfo/' + token.realm_id)

    // Test 2: Classes existentes
    const classesQuery = encodeURIComponent('SELECT * FROM Class MAXRESULTS 100')
    const classes = await qboGet(token.realm_id, accessToken, `/query?query=${classesQuery}`)

    // Test 3: Customers existentes (top 20)
    const customersQuery = encodeURIComponent('SELECT * FROM Customer MAXRESULTS 20')
    const customers = await qboGet(token.realm_id, accessToken, `/query?query=${customersQuery}`)

    // Test 4: Items existentes (top 30)
    const itemsQuery = encodeURIComponent('SELECT * FROM Item MAXRESULTS 30')
    const items = await qboGet(token.realm_id, accessToken, `/query?query=${itemsQuery}`)

    // Test 5: Cuentas de Income
    const accountsQuery = encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 50")
    const incomeAccounts = await qboGet(token.realm_id, accessToken, `/query?query=${accountsQuery}`)

    return res.status(200).json({
      success: true,
      realm_id: token.realm_id,
      company: {
        name: companyInfo.CompanyInfo?.CompanyName,
        legal_name: companyInfo.CompanyInfo?.LegalName,
        country: companyInfo.CompanyInfo?.Country,
        fiscal_year_start: companyInfo.CompanyInfo?.FiscalYearStartMonth
      },
      classes: {
        total: classes.QueryResponse?.Class?.length || 0,
        lista: classes.QueryResponse?.Class?.map(c => ({ Id: c.Id, Name: c.Name, Active: c.Active })) || []
      },
      customers: {
        total: customers.QueryResponse?.Customer?.length || 0,
        primeros_20: customers.QueryResponse?.Customer?.map(c => ({ Id: c.Id, DisplayName: c.DisplayName, Active: c.Active })) || []
      },
      items: {
        total: items.QueryResponse?.Item?.length || 0,
        primeros_30: items.QueryResponse?.Item?.map(i => ({ Id: i.Id, Name: i.Name, Type: i.Type })) || []
      },
      income_accounts: {
        total: incomeAccounts.QueryResponse?.Account?.length || 0,
        lista: incomeAccounts.QueryResponse?.Account?.map(a => ({ Id: a.Id, Name: a.Name, AcctNum: a.AcctNum })) || []
      }
    })

  } catch (err) {
    console.error('[QBO Prod Test] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
