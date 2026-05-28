// pages/api/neonet/auth.js
// Obtiene JWT del VNGAuthenticator de Neonet/Visanet.
//
// El JWT (accessToken.token) vale 5 minutos y es lo que se usa como:
//   - header Authorization en las llamadas a la WebAPI Dynamic Retail
//     (pospayment/, settlementdetail, transactiondetail, etc.)
//   - probablemente como `token` para el Intent del NeoPOS App on-device
//     (lo confirmamos cuando hagamos el primer test contra el Sunmi)
//
// Cache en memoria por instancia de Function: vale ~4 min (con buffer 1 min
// antes de expirar). Vercel Fluid Compute reusa instancias entre invocaciones,
// asi que esto ahorra round-trip a Neonet en cobros sucesivos.
//
// Auth temporal: Bearer INTERNAL_API_SECRET (para test desde curl).
// TODO: cambiar a requireAdmin cuando se integre desde el frontend del POS.

const URL_AUTH = process.env.NEONET_AUTH_URL
  || 'https://developer.visanet.com.gt/VNGAuthenticator/api/Membership/Authenticate'

// Cache en memoria por instancia.
let cache = null
// shape: { token, expiresAt: epochMs, refreshToken, refreshExpiresAt }

const CACHE_BUFFER_MS = 60 * 1000  // refrescamos 1 min antes del expire

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Validar envs requeridas. No exponer los valores en la respuesta.
  const faltantes = []
  if (!process.env.NEONET_MEMBERSHIP_ID) faltantes.push('NEONET_MEMBERSHIP_ID')
  if (!process.env.NEONET_SECRET_KEY)    faltantes.push('NEONET_SECRET_KEY')
  if (faltantes.length > 0) {
    return res.status(500).json({ ok: false, etapa: 'config', error: `Faltan env vars: ${faltantes.join(', ')}` })
  }

  // ¿Cache vivo? -> servir directo.
  if (cache && cache.expiresAt > Date.now() + CACHE_BUFFER_MS) {
    return res.status(200).json(formatear(cache, /*cached*/ true, req))
  }

  // Refresh real contra VNGAuthenticator.
  try {
    const r = await fetch(URL_AUTH, {
      method: 'GET',
      headers: {
        accept: '*/*',
        membershipId: process.env.NEONET_MEMBERSHIP_ID,
        secretKey:    process.env.NEONET_SECRET_KEY,
      },
    })
    const text = await r.text()
    if (!r.ok) {
      return res.status(502).json({
        ok: false, etapa: 'http_no_ok',
        status: r.status,
        body: text.slice(0, 400),
      })
    }
    let json
    try { json = JSON.parse(text) }
    catch {
      return res.status(502).json({ ok: false, etapa: 'parse_json', body: text.slice(0, 400) })
    }

    // Per manual (página 38) el shape esperado es:
    //   { accessToken: { token: '<JWT>', expires: 'YYYY-MM-DDTHH:mm:ss-06:00' },
    //     refreshToken: { token: '...', expires: '...' } }
    const access = json?.accessToken
    if (!access?.token) {
      return res.status(502).json({
        ok: false, etapa: 'no_access_token',
        keys_top: Object.keys(json || {}),
        body: text.slice(0, 400),
      })
    }
    const expiresAt = access.expires ? new Date(access.expires).getTime() : (Date.now() + 4 * 60_000)
    const refresh = json?.refreshToken || null
    const refreshExpiresAt = refresh?.expires ? new Date(refresh.expires).getTime() : null

    cache = {
      token: access.token,
      expiresAt,
      refreshToken: refresh?.token || null,
      refreshExpiresAt,
    }
    return res.status(200).json(formatear(cache, /*cached*/ false, req))
  } catch (e) {
    return res.status(500).json({ ok: false, etapa: 'fetch_error', error: e.message })
  }
}

// Da la respuesta segura por default. Si llaman POST con header
// `x-include-token: yes`, se devuelve el JWT crudo (para que el bridge del POS
// lo pueda inyectar en el Intent del NeoPOS App). Mientras estemos en modo
// test desde curl, no lo seteamos.
function formatear(c, cached, req) {
  const incluirToken = req.method === 'POST'
    && req.headers['x-include-token'] === 'yes'
  return {
    ok: true,
    cached,
    tokenPreview: (c.token || '').slice(0, 12) + '...' + (c.token || '').slice(-4),
    tokenLength: c.token ? c.token.length : 0,
    expiresAt: new Date(c.expiresAt).toISOString(),
    ttl_seconds: Math.max(0, Math.round((c.expiresAt - Date.now()) / 1000)),
    refreshTokenLength: c.refreshToken ? c.refreshToken.length : 0,
    refreshExpiresAt: c.refreshExpiresAt ? new Date(c.refreshExpiresAt).toISOString() : null,
    ...(incluirToken ? { token: c.token } : {}),
  }
}
