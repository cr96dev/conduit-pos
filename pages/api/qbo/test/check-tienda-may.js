import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'
const QBO_API_BASE = 'https://quickbooks.api.intuit.com'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  
  const { data: token } = await supabaseAdmin
    .from('qbo_tokens').select('*').eq('is_production', true).limit(1).single()
  
  // IDs que dice Supabase que existen en prod para tienda 1-10 mayo
  const ids = ['1550', '1573', '1596', '1619', '1643', '1666', '1689', '1712', '1736', '1759']
  const results = []
  
  for (const id of ids) {
    const r = await fetch(
      `${QBO_API_BASE}/v3/company/${token.realm_id}/salesreceipt/${id}?minorversion=75`,
      { headers: { 'Authorization': `Bearer ${token.access_token}`, 'Accept': 'application/json' } }
    )
    if (r.ok) {
      const data = await r.json()
      results.push({ 
        id, exists: true, 
        total: data.SalesReceipt?.TotalAmt,
        date: data.SalesReceipt?.TxnDate,
        customer: data.SalesReceipt?.CustomerRef?.name
      })
    } else {
      results.push({ id, exists: false, error: r.status })
    }
  }
  
  return res.status(200).json({ results })
}
