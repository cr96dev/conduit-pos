// Borra SRs de prueba que tienen "TEST" en Description
import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

const QBO_API_BASE = 'https://quickbooks.api.intuit.com'

async function getAccessToken() {
  const { data: token } = await supabaseAdmin
    .from('qbo_tokens').select('*').eq('is_production', true).limit(1).single()
  return { accessToken: token.access_token, realmId: token.realm_id }
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const dryRun = req.query.dry_run !== 'false'

  try {
    const { accessToken, realmId } = await getAccessToken()

    // Buscar SRs con "TEST" en linea description
    const query = encodeURIComponent("SELECT * FROM SalesReceipt WHERE Line.Description LIKE '%TEST%' MAXRESULTS 50")
    const findRes = await fetch(`${QBO_API_BASE}/v3/company/${realmId}/query?query=${query}&minorversion=75`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
    })
    const findData = await findRes.json()
    const srs = findData.QueryResponse?.SalesReceipt || []

    const results = []
    for (const sr of srs) {
      const isTest = sr.Line?.some(l => (l.Description || '').includes('TEST'))
      if (!isTest) continue

      if (dryRun) {
        results.push({ id: sr.Id, total: sr.TotalAmt, would_delete: true })
        continue
      }

      // Void el SR (soft delete)
      const voidRes = await fetch(`${QBO_API_BASE}/v3/company/${realmId}/salesreceipt?operation=void&minorversion=75`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ Id: sr.Id, SyncToken: sr.SyncToken })
      })
      const voidData = await voidRes.json()
      results.push({ id: sr.Id, total: sr.TotalAmt, voided: voidRes.ok, response: voidData.SalesReceipt?.PrivateNote || voidData })
    }

    return res.status(200).json({ mode: dryRun ? 'DRY-RUN' : 'EXECUTED', results, count: results.length })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
