// pages/api/qbo/test/customer.js
// Test: lee Customer ID 1 de la sandbox QBO
// GET /api/qbo/test/customer

import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { data: tokens, error: tokenError } = await supabaseAdmin
      .from('qbo_tokens')
      .select('*')
      .limit(1)
      .single()

    if (tokenError || !tokens) {
      return res.status(404).json({ error: 'No QBO token found. Reconectar OAuth.' })
    }

    const realmId = tokens.realm_id
    const apiBase = process.env.QBO_API_BASE
    const url = `${apiBase}/v3/company/${realmId}/customer/1?minorversion=75`

    console.log('[QBO Test] Calling:', url)

    const qboResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Accept': 'application/json'
      }
    })

    const responseText = await qboResponse.text()
    console.log('[QBO Test] Status:', qboResponse.status)
    console.log('[QBO Test] Body length:', responseText.length)

    if (!qboResponse.ok) {
      return res.status(qboResponse.status).json({
        error: 'QBO API error',
        status: qboResponse.status,
        body: responseText
      })
    }

    const data = JSON.parse(responseText)

    return res.status(200).json({
      success: true,
      realm_id: realmId,
      customer: data.Customer ? {
        Id: data.Customer.Id,
        DisplayName: data.Customer.DisplayName,
        CompanyName: data.Customer.CompanyName,
        PrimaryEmailAddr: data.Customer.PrimaryEmailAddr?.Address,
        Active: data.Customer.Active
      } : null,
      raw: data
    })

  } catch (err) {
    console.error('[QBO Test] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
