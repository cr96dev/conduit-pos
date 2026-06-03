// pages/api/pickup/consultar-nit.js
//
// GET /api/pickup/consultar-nit?nit=XXXXX
//   Versión PÚBLICA (sin auth) del consultar-nit Infile, para la app /pickup.
//   Origin check + rate limit por IP (30 consultas/min) para evitar abuso.

import { createClient } from '@supabase/supabase-js'
import { crearCliente, InfileError } from '../../../lib/infile/client'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const rateMap = new Map()
function checkRate(ip) {
  const now = Date.now()
  const key = ip || 'unknown'
  const entry = rateMap.get(key) || { count: 0, resetAt: now + 60_000 }
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60_000 }
  entry.count++
  rateMap.set(key, entry)
  return entry.count <= 30
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
             req.socket?.remoteAddress || ''
  if (!checkRate(ip)) {
    return res.status(429).json({ error: 'Demasiadas consultas. Esperá un minuto.' })
  }

  const { nit } = req.query
  if (!nit || nit === 'CF') return res.status(400).json({ error: 'NIT requerido' })

  const { data: config } = await supabaseAdmin.from('config_fel').select('*').limit(1).maybeSingle()
  if (!config?.infile_alias_firma || !config?.infile_llave_cert) {
    return res.status(503).json({ error: 'Credenciales Infile no configuradas' })
  }

  try {
    const client = crearCliente(config)
    const r = await client.consultarNit(nit)
    if (r.no_encontrado) {
      return res.status(200).json({ ok: true, receptor: null, mensaje: r.mensaje || 'NIT no encontrado' })
    }
    return res.status(200).json({ ok: true, receptor: { nit: r.nit, nombre: r.nombre } })
  } catch (e) {
    if (e instanceof InfileError) {
      return res.status(502).json({ ok: false, error: e.message, etapa: e.etapa })
    }
    return res.status(500).json({ ok: false, error: e.message })
  }
}
