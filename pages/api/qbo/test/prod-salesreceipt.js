// pages/api/qbo/test/prod-salesreceipt.js
// Diagnostico: probar Sales Receipt con distintos formatos para encontrar el correcto

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
    return { label, success: true, id: data.SalesReceipt?.Id, total: data.SalesReceipt?.TotalAmt }
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
    const classIdProd = '769004'  // Brisas
    const itemIdProd = '34'       // Lubricantes
    const taxCodeId = '2'

    const results = []

    // Variante 1: TaxCodeRef adentro de SalesItemLineDetail
    results.push(await tryCreate(realmId, accessToken, 'V1: TaxCodeRef en SalesItemLineDetail', {
      TxnDate: '2026-05-11',
      CustomerRef: { value: customerIdProd },
      ClassRef: { value: classIdProd },
      GlobalTaxCalculation: 'TaxIncluded',
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: 100,
        Description: 'TEST V1',
        SalesItemLineDetail: {
          ItemRef: { value: itemIdProd },
          ClassRef: { value: classIdProd },
          TaxCodeRef: { value: taxCodeId }
        }
      }]
    }))

    // Variante 2: TaxCodeRef adentro pero sin Class en linea
    results.push(await tryCreate(realmId, accessToken, 'V2: TaxCodeRef sin class en linea', {
      TxnDate: '2026-05-11',
      CustomerRef: { value: customerIdProd },
      ClassRef: { value: classIdProd },
      GlobalTaxCalculation: 'TaxIncluded',
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: 100,
        Description: 'TEST V2',
        SalesItemLineDetail: {
          ItemRef: { value: itemIdProd },
          TaxCodeRef: { value: taxCodeId }
        }
      }]
    }))

    // Variante 3: Sin TaxCodeRef pero con GlobalTaxCalculation NotApplicable
    results.push(await tryCreate(realmId, accessToken, 'V3: NotApplicable, sin TaxCode', {
      TxnDate: '2026-05-11',
      CustomerRef: { value: customerIdProd },
      ClassRef: { value: classIdProd },
      GlobalTaxCalculation: 'NotApplicable',
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: 100,
        Description: 'TEST V3',
        SalesItemLineDetail: {
          ItemRef: { value: itemIdProd },
          ClassRef: { value: classIdProd }
        }
      }]
    }))

    // Variante 4: Con CurrencyRef explicito (Multicurrency)
    results.push(await tryCreate(realmId, accessToken, 'V4: Con CurrencyRef GTQ', {
      TxnDate: '2026-05-11',
      CustomerRef: { value: customerIdProd },
      ClassRef: { value: classIdProd },
      CurrencyRef: { value: 'GTQ' },
      GlobalTaxCalculation: 'TaxIncluded',
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: 100,
        Description: 'TEST V4',
        SalesItemLineDetail: {
          ItemRef: { value: itemIdProd },
          ClassRef: { value: classIdProd },
          TaxCodeRef: { value: taxCodeId }
        }
      }]
    }))

    // Variante 5: Sin Tax + sin GlobalTaxCalculation (minimo)
    results.push(await tryCreate(realmId, accessToken, 'V5: Minimo, sin nada de tax', {
      TxnDate: '2026-05-11',
      CustomerRef: { value: customerIdProd },
      ClassRef: { value: classIdProd },
      Line: [{
        DetailType: 'SalesItemLineDetail',
        Amount: 100,
        Description: 'TEST V5',
        SalesItemLineDetail: {
          ItemRef: { value: itemIdProd },
          ClassRef: { value: classIdProd }
        }
      }]
    }))

    return res.status(200).json({ results })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
