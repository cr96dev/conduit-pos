// pages/api/qbo/auth/status.js
// Devuelve el estado actual de la conexion QBO
// GET /api/qbo/auth/status

import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const { data: tokens, error } = await supabaseAdmin
      .from('qbo_tokens')
      .select('realm_id, access_token_expires_at, refresh_token_expires_at, updated_at')
      .limit(1)

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    if (!tokens || tokens.length === 0) {
      return res.status(200).json({
        connected: false,
        message: 'QBO no esta conectado. Iniciar OAuth en /api/qbo/auth/connect'
      })
    }

    const token = tokens[0]
    const now = new Date()
    const accessExpires = new Date(token.access_token_expires_at)
    const refreshExpires = new Date(token.refresh_token_expires_at)

    return res.status(200).json({
      connected: true,
      realm_id: token.realm_id,
      access_token_valid: accessExpires > now,
      refresh_token_valid: refreshExpires > now,
      access_token_expires_at: token.access_token_expires_at,
      refresh_token_expires_at: token.refresh_token_expires_at,
      last_updated: token.updated_at,
      access_token_expires_in_seconds: Math.floor((accessExpires - now) / 1000),
      refresh_token_expires_in_days: Math.floor((refreshExpires - now) / (1000 * 60 * 60 * 24))
    })

  } catch (err) {
    console.error('[QBO Status] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
