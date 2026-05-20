// pages/api/qbo/test/api.js
// Test del API client wrapper con auto-refresh

import { qboApi, qboQuery } from '../../../../lib/qbo/apiClient'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    // Test 1: Company info
    const companyInfo = await qboApi('GET', '/companyinfo/1')

    // Test 2: Query - listar primeros 5 customers
    const customersQuery = await qboQuery('SELECT * FROM Customer MAXRESULTS 5')

    // Test 3: Query - listar primeros 5 items
    const itemsQuery = await qboQuery('SELECT * FROM Item MAXRESULTS 5')

    return res.status(200).json({
      success: true,
      tests: {
        companyInfo: {
          name: companyInfo.CompanyInfo?.CompanyName,
          country: companyInfo.CompanyInfo?.Country,
          email: companyInfo.CompanyInfo?.Email?.Address,
          fiscalYearStart: companyInfo.CompanyInfo?.FiscalYearStartMonth
        },
        customers: {
          count: customersQuery.Customer?.length || 0,
          first5: customersQuery.Customer?.slice(0, 5).map(c => ({
            Id: c.Id,
            DisplayName: c.DisplayName,
            Active: c.Active
          }))
        },
        items: {
          count: itemsQuery.Item?.length || 0,
          first5: itemsQuery.Item?.slice(0, 5).map(i => ({
            Id: i.Id,
            Name: i.Name,
            Type: i.Type,
            UnitPrice: i.UnitPrice
          }))
        }
      }
    })

  } catch (err) {
    console.error('[QBO Test API] Error:', err.message)
    return res.status(500).json({ 
      error: err.message,
      status: err.status,
      body: err.body
    })
  }
}
