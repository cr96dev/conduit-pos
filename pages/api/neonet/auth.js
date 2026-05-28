// pages/api/neonet/auth.js
// Endpoint de inspeccion/debug del JWT del VNGAuthenticator.
//
// La logica real vive en lib/neonet/auth.js (helper reutilizable por el
// client de la WebAPI). Este endpoint solo expone:
//   GET  -> metadata del cache (tokenPreview, ttl, expira)
//   POST -> idem; con header `x-include-token: yes` devuelve el JWT crudo
//           para que el bridge del Sunmi lo inyecte en el Intent del NeoPOS
//
// Auth: Bearer INTERNAL_API_SECRET (para tests desde curl / scripts admin).
//
// NOTA: el cache es por instancia de Vercel Function. Si necesitas forzar
// refresh, pasa ?force=1 en la query.

import { obtenerJWT, invalidarCache, estadoCache, NeonetAuthError } from '../../../lib/neonet/auth'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (req.query.force === '1' || req.query.force === 'true') {
    invalidarCache()
  }

  try {
    const { token, expiresAt, cached } = await obtenerJWT()
    const incluirToken = req.method === 'POST' && req.headers['x-include-token'] === 'yes'
    const estado = estadoCache()
    return res.status(200).json({
      ok: true,
      cached,
      ...estado,
      expiresAt: new Date(expiresAt).toISOString(),
      ttl_seconds: Math.max(0, Math.round((expiresAt - Date.now()) / 1000)),
      ...(incluirToken ? { token } : {}),
    })
  } catch (e) {
    if (e instanceof NeonetAuthError) {
      return res.status(502).json({ ok: false, etapa: e.etapa, error: e.message, status: e.status })
    }
    console.error('[neonet/auth] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
