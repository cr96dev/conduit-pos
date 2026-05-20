// lib/qbo/tokenManager.js
// Maneja tokens OAuth de QBO: obtener, refrescar automaticamente
// Usar SOLO desde API routes (server-side)

import { supabaseAdmin } from './supabaseAdmin'

/**
 * Obtiene un access_token valido para hacer llamadas a QBO API.
 * Si el access_token esta por expirar (< 5 min), lo refresca automaticamente.
 * 
 * @returns {Promise<{access_token: string, realm_id: string}>}
 * @throws Error si no hay token o falla el refresh
 */
export async function getValidAccessToken() {
  // 1. Obtener token de DB
  const { data: token, error } = await supabaseAdmin
    .from('qbo_tokens')
    .select('*')
    .limit(1)
    .single()

  if (error || !token) {
    throw new Error('No hay tokens QBO en DB. Hacer OAuth primero en /api/qbo/auth/connect')
  }

  // 2. Verificar si el access_token todavia es valido (con 5 min buffer)
  const now = new Date()
  const accessExpires = new Date(token.access_token_expires_at)
  const fiveMinutes = 5 * 60 * 1000

  if (accessExpires - now > fiveMinutes) {
    // Token todavia valido
    console.log(`[QBO Token] Access token valido. Expira en ${Math.floor((accessExpires - now) / 60000)} min`)
    return {
      access_token: token.access_token,
      realm_id: token.realm_id
    }
  }

  // 3. Verificar si el refresh_token todavia es valido
  const refreshExpires = new Date(token.refresh_token_expires_at)
  if (refreshExpires <= now) {
    throw new Error('Refresh token expirado. Reconectar OAuth en /api/qbo/auth/connect')
  }

  // 4. Refrescar access_token
  console.log('[QBO Token] Access token por expirar. Refrescando...')

  try {
    const refreshResponse = await fetch(
      'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(
            `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
          ).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token.refresh_token
        }).toString()
      }
    )

    if (!refreshResponse.ok) {
      const errBody = await refreshResponse.text()
      throw new Error(`Refresh failed (${refreshResponse.status}): ${errBody}`)
    }

    const data = await refreshResponse.json()
    const { access_token, refresh_token, expires_in, x_refresh_token_expires_in } = data

    const accessExpires = new Date(Date.now() + expires_in * 1000).toISOString()
    const refreshExpires = new Date(Date.now() + x_refresh_token_expires_in * 1000).toISOString()

    // 5. Guardar nuevos tokens
    const { error: updateError } = await supabaseAdmin
      .from('qbo_tokens')
      .update({
        access_token,
        refresh_token,
        access_token_expires_at: accessExpires,
        refresh_token_expires_at: refreshExpires,
        updated_at: new Date().toISOString()
      })
      .eq('realm_id', token.realm_id)

    if (updateError) {
      throw new Error(`No se pudo guardar token refrescado: ${updateError.message}`)
    }

    console.log('[QBO Token] Token refrescado exitosamente')

    return {
      access_token,
      realm_id: token.realm_id
    }

  } catch (err) {
    console.error('[QBO Token] Error refrescando:', err.message)
    throw err
  }
}
