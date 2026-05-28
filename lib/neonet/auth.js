// lib/neonet/auth.js
// Cliente del VNGAuthenticator de Neonet/Visanet.
//
// Devuelve un JWT (accessToken.token) que vale como Bearer Authorization
// en la WebAPI Dynamic Retail y, muy probablemente, como `token` para el
// Intent del NeoPOS App on-device (a confirmar cuando llegue el Sunmi).
//
// Cache: en memoria por instancia de Vercel Function. El token de Neonet
// QA vino con TTL real de 10 dias (no los 5 min que dice el manual).
// Igual nos refrescamos 5 min antes del expire por seguridad.
//
// Env vars requeridas:
//   NEONET_MEMBERSHIP_ID
//   NEONET_SECRET_KEY
//   NEONET_AUTH_URL (opcional, default al endpoint developer.visanet.com.gt)

const URL_AUTH_DEFAULT = 'https://developer.visanet.com.gt/VNGAuthenticator/api/Membership/Authenticate'
const CACHE_BUFFER_MS  = 5 * 60 * 1000   // refrescamos 5 min antes del expire

let cache = null
// shape: { token, expiresAt, refreshToken, refreshExpiresAt }

export class NeonetAuthError extends Error {
  constructor(message, { status, payload, etapa } = {}) {
    super(message)
    this.name = 'NeonetAuthError'
    this.status = status
    this.payload = payload
    this.etapa = etapa
  }
}

// Devuelve el JWT crudo, refrescando si esta cerca de expirar.
// Lanza NeonetAuthError si falla. Cachea el resultado entre invocaciones.
export async function obtenerJWT() {
  if (cache && cache.expiresAt > Date.now() + CACHE_BUFFER_MS) {
    return { token: cache.token, expiresAt: cache.expiresAt, cached: true }
  }

  if (!process.env.NEONET_MEMBERSHIP_ID || !process.env.NEONET_SECRET_KEY) {
    throw new NeonetAuthError('NEONET_MEMBERSHIP_ID / NEONET_SECRET_KEY no configuradas', { etapa: 'config' })
  }
  const url = process.env.NEONET_AUTH_URL || URL_AUTH_DEFAULT

  let r
  try {
    r = await fetch(url, {
      method: 'GET',
      headers: {
        accept: '*/*',
        membershipId: process.env.NEONET_MEMBERSHIP_ID,
        secretKey:    process.env.NEONET_SECRET_KEY,
      },
    })
  } catch (e) {
    throw new NeonetAuthError(`Red fallida llamando VNGAuthenticator: ${e.message}`, { etapa: 'fetch' })
  }
  const text = await r.text()
  if (!r.ok) {
    throw new NeonetAuthError(`VNGAuthenticator HTTP ${r.status}: ${text.slice(0, 300)}`, { status: r.status, etapa: 'http' })
  }
  let json
  try { json = JSON.parse(text) }
  catch { throw new NeonetAuthError(`Respuesta no JSON: ${text.slice(0, 300)}`, { etapa: 'parse' }) }

  const access = json?.accessToken
  if (!access?.token) {
    throw new NeonetAuthError('Respuesta sin accessToken.token', { payload: json, etapa: 'no_token' })
  }
  const expiresAt = access.expires ? new Date(access.expires).getTime() : (Date.now() + 4 * 60_000)
  const refresh = json?.refreshToken || null
  cache = {
    token: access.token,
    expiresAt,
    refreshToken: refresh?.token || null,
    refreshExpiresAt: refresh?.expires ? new Date(refresh.expires).getTime() : null,
  }
  return { token: cache.token, expiresAt: cache.expiresAt, cached: false }
}

// Invalida el cache. Util para tests o para forzar refresh tras un 401.
export function invalidarCache() {
  cache = null
}

// Helper de inspeccion segura: NO expone el token, solo metadata.
export function estadoCache() {
  if (!cache) return { presente: false }
  return {
    presente: true,
    tokenLength: cache.token.length,
    tokenPreview: cache.token.slice(0, 12) + '...' + cache.token.slice(-4),
    expiresAt: new Date(cache.expiresAt).toISOString(),
    ttl_seconds: Math.max(0, Math.round((cache.expiresAt - Date.now()) / 1000)),
    refreshTokenLength: cache.refreshToken?.length || 0,
    refreshExpiresAt: cache.refreshExpiresAt ? new Date(cache.refreshExpiresAt).toISOString() : null,
  }
}
