// lib/qbo/apiClient.js
// Wrapper para llamadas a QBO API con auto-refresh de tokens

import { getValidAccessToken } from './tokenManager'

/**
 * Hace una llamada autenticada a QBO API
 * 
 * @param {string} method - GET, POST, PUT, DELETE
 * @param {string} path - ej: '/customer/1' o '/salesreceipt'
 * @param {object} body - opcional, payload para POST/PUT
 * @returns {Promise<object>} Response JSON parseado
 */
export async function qboApi(method, path, body = null) {
  const { access_token, realm_id } = await getValidAccessToken()

  const apiBase = process.env.QBO_API_BASE
  const url = `${apiBase}/v3/company/${realm_id}${path}${path.includes('?') ? '&' : '?'}minorversion=75`

  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${access_token}`,
      'Accept': 'application/json'
    }
  }

  if (body) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  console.log(`[QBO API] ${method} ${url}`)

  const response = await fetch(url, options)
  const responseText = await response.text()

  if (!response.ok) {
    console.error(`[QBO API] Error ${response.status}: ${responseText.substring(0, 500)}`)
    const error = new Error(`QBO API ${method} ${path} failed: ${response.status}`)
    error.status = response.status
    error.body = responseText
    throw error
  }

  return JSON.parse(responseText)
}

/**
 * Helpers especificos
 */

export async function qboGetCustomer(id) {
  const data = await qboApi('GET', `/customer/${id}`)
  return data.Customer
}

export async function qboQuery(sql) {
  // QBO usa pseudo-SQL para queries
  const encoded = encodeURIComponent(sql)
  const data = await qboApi('GET', `/query?query=${encoded}`)
  return data.QueryResponse
}

export async function qboCreateSalesReceipt(salesReceipt) {
  const data = await qboApi('POST', '/salesreceipt', salesReceipt)
  return data.SalesReceipt
}
