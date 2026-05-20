// pages/api/qbo/setup/initial.js
// Setup inicial: crea customers, items, classes en la sandbox QBO

import { qboApi, qboQuery } from '../../../../lib/qbo/apiClient'
import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const log = []

  try {
    // PASO 1: Classes
    log.push('[1/3] Creando Classes...')
    const { data: estaciones } = await supabaseAdmin
      .from('qbo_mapping_estaciones').select('*').eq('activo', true)

    for (const est of estaciones) {
      try {
        const existing = await qboQuery(`SELECT * FROM Class WHERE Name = '${est.estacion_nombre}'`)
        let classId
        if (existing.Class && existing.Class.length > 0) {
          classId = existing.Class[0].Id
          log.push(`  - "${est.estacion_nombre}" ya existe (${classId})`)
        } else {
          const created = await qboApi('POST', '/class', { Name: est.estacion_nombre, Active: true })
          classId = created.Class.Id
          log.push(`  + "${est.estacion_nombre}" creada (${classId})`)
        }
        await supabaseAdmin.from('qbo_mapping_estaciones').update({ qbo_class_id: classId }).eq('estacion_codigo', est.estacion_codigo)
      } catch (err) {
        log.push(`  ! Error en "${est.estacion_nombre}": ${err.message}`)
      }
    }

    // PASO 2: Customers
    log.push('[2/3] Creando Customers...')
    const { data: customers } = await supabaseAdmin
      .from('qbo_mapping_customers').select('*').eq('activo', true)

    for (const cust of customers) {
      try {
        const existing = await qboQuery(`SELECT * FROM Customer WHERE DisplayName = '${cust.nombre.replace(/'/g, "''")}'`)
        let customerId
        if (existing.Customer && existing.Customer.length > 0) {
          customerId = existing.Customer[0].Id
          log.push(`  - "${cust.nombre}" ya existe (${customerId})`)
        } else {
          const created = await qboApi('POST', '/customer', { DisplayName: cust.nombre, CompanyName: cust.nombre, Active: true })
          customerId = created.Customer.Id
          log.push(`  + "${cust.nombre}" creado (${customerId})`)
        }
        await supabaseAdmin.from('qbo_mapping_customers').update({ qbo_customer_id: customerId }).eq('nit', cust.nit)
      } catch (err) {
        log.push(`  ! Error en "${cust.nombre}": ${err.message}`)
      }
    }

    // PASO 3: Items (combustibles + tienda macro + lubricantes)
    log.push('[3/3] Creando Items...')

    const incomeAccts = await qboQuery(`SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 5`)
    const incomeAccountId = incomeAccts.Account?.[0]?.Id
    if (!incomeAccountId) throw new Error('No Income Account')

    // Lee TODOS los items de qbo_mapping_skus (incluye los 8 nuevos de tienda)
    const { data: skusToCreate } = await supabaseAdmin
      .from('qbo_mapping_skus').select('*').eq('activo', true)

    for (const sku of skusToCreate) {
      try {
        const itemName = sku.qbo_item_name || sku.descripcion
        const existing = await qboQuery(`SELECT * FROM Item WHERE Name = '${itemName.replace(/'/g, "''")}'`)
        let itemId
        if (existing.Item && existing.Item.length > 0) {
          itemId = existing.Item[0].Id
          log.push(`  - "${itemName}" ya existe (${itemId})`)
        } else {
          const created = await qboApi('POST', '/item', {
            Name: itemName,
            Type: 'Service',
            IncomeAccountRef: { value: incomeAccountId },
            Active: true
          })
          itemId = created.Item.Id
          log.push(`  + "${itemName}" creado (${itemId})`)
        }
        await supabaseAdmin
          .from('qbo_mapping_skus')
          .update({ qbo_item_id: itemId })
          .eq('sku', sku.sku)
      } catch (err) {
        log.push(`  ! Error en "${sku.sku}": ${err.message}`)
      }
    }

    return res.status(200).json({
      success: true,
      summary: {
        classes: estaciones.length,
        customers: customers.length,
        items: skusToCreate.length,
        income_account: incomeAccountId
      },
      log
    })
  } catch (err) {
    return res.status(500).json({ error: err.message, log })
  }
}
