// pages/api/qbo/test/prod-accounts.js
// Lista TODAS las cuentas de QBO production para encontrar la de Custodia combustibles

import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

const QBO_API_BASE_PROD = 'https://quickbooks.api.intuit.com'

async function refreshTokenIfNeeded(token) {
  const now = new Date()
  const accessExpires = new Date(token.access_token_expires_at)
  if (accessExpires - now > 5 * 60 * 1000) return token.access_token

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
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token }).toString()
    }
  )
  if (!refreshResponse.ok) throw new Error('Refresh failed')
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
  const response = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' } })
  if (!response.ok) throw new Error(`QBO ${response.status}: ${await response.text()}`)
  return response.json()
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { data: token } = await supabaseAdmin.from('qbo_tokens').select('*').eq('is_production', true).limit(1).single()
    if (!token) return res.status(404).json({ error: 'No prod token' })

    const accessToken = await refreshTokenIfNeeded(token)

    // Traer TODAS las cuentas
    const query = encodeURIComponent('SELECT * FROM Account MAXRESULTS 1000')
    const result = await qboGet(token.realm_id, accessToken, `/query?query=${query}`)

    const accounts = result.QueryResponse?.Account || []

    // Agrupar por tipo
    const porTipo = {}
    for (const a of accounts) {
      const tipo = a.AccountType || 'Unknown'
      if (!porTipo[tipo]) porTipo[tipo] = []
      porTipo[tipo].push({
        Id: a.Id,
        Name: a.Name,
        AcctNum: a.AcctNum,
        AccountSubType: a.AccountSubType,
        CurrentBalance: a.CurrentBalance,
        Active: a.Active
      })
    }

    // Buscar candidatos para Custodia
    const custodiaCandidatos = accounts.filter(a => 
      /custodia|combustible|uno|transito|pendiente/i.test(a.Name || '')
    ).map(a => ({
      Id: a.Id,
      Name: a.Name,
      AcctNum: a.AcctNum,
      AccountType: a.AccountType,
      AccountSubType: a.AccountSubType
    }))

    return res.status(200).json({
      success: true,
      total_accounts: accounts.length,
      por_tipo: Object.keys(porTipo).map(tipo => ({
        tipo,
        cuentas: porTipo[tipo].length
      })),
      candidatos_custodia: custodiaCandidatos,
      liability_accounts: porTipo['Other Current Liability'] || porTipo['Long Term Liability'] || [],
      asset_accounts: (porTipo['Bank'] || []).concat(porTipo['Other Current Asset'] || [])
    })

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
