// pages/api/qbo/setup/prod.js
// Setup en QBO PRODUCTION
// GET (dry-run): muestra qué crearía sin tocar nada
// POST (execute): crea customers e items en QBO real e actualiza Supabase

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

async function qboCall(realmId, accessToken, method, path, body = null) {
  const url = `${QBO_API_BASE_PROD}/v3/company/${realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=75`
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  }
  if (body) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  const text = await response.text()
  if (!response.ok) throw new Error(`QBO ${response.status}: ${text.substring(0, 300)}`)
  return JSON.parse(text)
}

async function qboQuery(realmId, accessToken, sql) {
  const encoded = encodeURIComponent(sql)
  const data = await qboCall(realmId, accessToken, 'GET', `/query?query=${encoded}`)
  return data.QueryResponse
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Use GET (dry-run) or POST (execute)' })
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const isDryRun = req.method === 'GET'
  const log = []
  const plan = {
    customers_to_create: [],
    customers_existing: [],
    items_to_create: [],
    items_existing: []
  }

  try {
    const { data: token } = await supabaseAdmin
      .from('qbo_tokens').select('*').eq('is_production', true).limit(1).single()
    if (!token) return res.status(404).json({ error: 'No PROD token. Hacer OAuth en /api/qbo/auth/connect-prod' })

    const accessToken = await refreshTokenIfNeeded(token)
    const realmId = token.realm_id

    log.push(`[${isDryRun ? 'DRY-RUN' : 'EXECUTE'}] Realm: ${realmId}`)

    // ===========================================
    // 1. CUSTOMERS CF (12)
    // ===========================================
    const { data: customers } = await supabaseAdmin
      .from('qbo_mapping_customers').select('*')
      .eq('activo', true)
      .eq('qbo_customer_type', 'CF_BY_STATION')

    log.push(`Verificando ${customers.length} customers CF...`)

    for (const cust of customers) {
      const nombreEscaped = cust.nombre.replace(/'/g, "''")
      const existing = await qboQuery(realmId, accessToken, `SELECT * FROM Customer WHERE DisplayName = '${nombreEscaped}'`)

      if (existing.Customer && existing.Customer.length > 0) {
        const existingId = existing.Customer[0].Id
        plan.customers_existing.push({ nombre: cust.nombre, qbo_id: existingId })
        if (!isDryRun) {
          await supabaseAdmin.from('qbo_mapping_customers')
            .update({ qbo_customer_id_prod: existingId })
            .eq('nit', cust.nit)
        }
      } else {
        plan.customers_to_create.push({ nombre: cust.nombre, nit: cust.nit, estacion: cust.estacion_codigo })
        if (!isDryRun) {
          const created = await qboCall(realmId, accessToken, 'POST', '/customer', {
            DisplayName: cust.nombre,
            CompanyName: cust.nombre,
            Active: true
          })
          const newId = created.Customer.Id
          await supabaseAdmin.from('qbo_mapping_customers')
            .update({ qbo_customer_id_prod: newId })
            .eq('nit', cust.nit)
          log.push(`+ Customer creado: "${cust.nombre}" (ID ${newId})`)
        }
      }
    }

    // ===========================================
    // 2. ITEMS (8 tienda + 1 lubricantes = 9 items)
    // Combustibles NO se crean como items (van via Deposit)
    // ===========================================
    const { data: skus } = await supabaseAdmin
      .from('qbo_mapping_skus').select('*')
      .eq('activo', true)
      .not('sku', 'like', 'COMB-%')  // Excluir combustibles

    log.push(`Verificando ${skus.length} items (tienda + lubricantes)...`)

    for (const sku of skus) {
      const itemName = sku.qbo_item_name || sku.descripcion
      const itemNameEscaped = itemName.replace(/'/g, "''")
      const existing = await qboQuery(realmId, accessToken, `SELECT * FROM Item WHERE Name = '${itemNameEscaped}'`)

      if (existing.Item && existing.Item.length > 0) {
        const existingId = existing.Item[0].Id
        plan.items_existing.push({ sku: sku.sku, nombre: itemName, qbo_id: existingId })
        if (!isDryRun) {
          await supabaseAdmin.from('qbo_mapping_skus')
            .update({ qbo_item_id_prod: existingId })
            .eq('sku', sku.sku)
        }
      } else {
        plan.items_to_create.push({
          sku: sku.sku,
          nombre: itemName,
          income_account_id: sku.qbo_income_account_id_prod
        })
        if (!isDryRun) {
          if (!sku.qbo_income_account_id_prod) {
            log.push(`! SKIP ${sku.sku}: sin qbo_income_account_id_prod`)
            continue
          }
          const created = await qboCall(realmId, accessToken, 'POST', '/item', {
            Name: itemName,
            Type: 'Service',
            IncomeAccountRef: { value: sku.qbo_income_account_id_prod },
            Active: true
          })
          const newId = created.Item.Id
          await supabaseAdmin.from('qbo_mapping_skus')
            .update({ qbo_item_id_prod: newId })
            .eq('sku', sku.sku)
          log.push(`+ Item creado: "${itemName}" (ID ${newId}, IncomeAcct ${sku.qbo_income_account_id_prod})`)
        }
      }
    }

    return res.status(200).json({
      success: true,
      mode: isDryRun ? 'DRY-RUN (no se creó nada)' : 'EXECUTED',
      realm_id: realmId,
      summary: {
        customers_to_create: plan.customers_to_create.length,
        customers_existing: plan.customers_existing.length,
        items_to_create: plan.items_to_create.length,
        items_existing: plan.items_existing.length
      },
      plan,
      log
    })

  } catch (err) {
    return res.status(500).json({ error: err.message, log })
  }
}
