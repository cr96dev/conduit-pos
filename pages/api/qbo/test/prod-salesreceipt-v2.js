// pages/api/qbo/test/prod-salesreceipt-v2.js
// V6 y V7: Calcular IVA en cliente, mandar neto con TaxCodeRef
// V8 y V9: Sin tax handling, item Service Q100 simple
// V10: Item de Tienda (Service)

import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

const QBO_API_BASE = 'https://quickbooks.api.intuit.com'

async function getAccessToken() {
  const { data: token } = await supabaseAdmin
    .from('qbo_tokens').select('*').eq('is_production', true).limit(1).single()
  if (!token) throw new Error('No prod token')
  return { accessToken: token.access_token, realmId: token.realm_id }
}

async function tryCreate(realmId, accessToken, label, payload) {
  const url = `${QBO_API_BASE}/v3/company/${realmId}/salesreceipt?minorversion=75`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  const text = await response.text()
  if (response.ok) {
    const data = JSON.parse(text)
    return { label, success: true, id: data.SalesReceipt?.Id, total: data.SalesReceipt?.TotalAmt, tax: data.SalesReceipt?.TxnTaxDetail?.TotalTax }
  }
  return { label, success: false, error: text.substring(0, 400) }
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { accessToken, realmId } = await getAccessToken()
    const customerIdProd = '101'  // Brisas
    const classIdProd = '769004'
    const lubricantesItemId = '34'   // Inventory
    const tiendaItemId = '945'        // Tienda Snacks (Service)
    const taxCodeId = '2'

    const results = []

    // V6: Lubricantes con Qty=1 + TaxCodeRef
    results.push(await tryCreate(realmId, accessToken, 'V6: Lubricantes Inventory + Qty + TaxCode', {
      TxnDate: '2026-05-11',
      CustomerRef: { value: customerIdProd },
      ClassRef: { value: classIdProd },
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: 100,
        Description: 'TEST V6 - lubricantes',
        SalesItemLineDetail: {
          ItemRef: { value: lubricantesItemId },
          Qty: 1,
          UnitPrice: 100,
          ClassRef: { value: classIdProd },
          TaxCodeRef: { value: taxCodeId }
        }
      }]
    }))

    // V7: Tienda Service + TaxCodeRef (item nuestro)
    results.push(await tryCreate(realmId, accessToken, 'V7: Tienda Service + TaxCode', {
      TxnDate: '2026-05-11',
      CustomerRef: { value: customerIdProd },
      ClassRef: { value: classIdProd },
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: 100,
        Description: 'TEST V7 - tienda',
        SalesItemLineDetail: {
          ItemRef: { value: tiendaItemId },
          Qty: 1,
          ClassRef: { value: classIdProd },
          TaxCodeRef: { value: taxCodeId }
        }
      }]
    }))

    // V8: Tienda Service + sin TaxCode (caso C)
    results.push(await tryCreate(realmId, accessToken, 'V8: Tienda sin tax', {
      TxnDate: '2026-05-11',
      CustomerRef: { value: customerIdProd },
      ClassRef: { value: classIdProd },
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: 100,
        Description: 'TEST V8 - tienda sin tax',
        SalesItemLineDetail: {
          ItemRef: { value: tiendaItemId },
          Qty: 1,
          ClassRef: { value: classIdProd }
        }
      }]
    }))

    return res.status(200).json({ results })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
