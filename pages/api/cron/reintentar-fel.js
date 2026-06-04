// pages/api/cron/reintentar-fel.js
//
// Cron cada 5 minutos: toma facturas en estado 'pendiente_certificacion'
// (Infile cayó cuando se emitieron) e intenta certificarlas de nuevo.
// Si Infile vuelve, las certifica una a una. Si sigue caída, incrementa
// contador y deja para el siguiente tick.
//
// Schedule: */5 * * * * (cada 5 min)
// Auth: Bearer ${CRON_SECRET} (también acepta llamadas manuales desde
//       admin tools con INTERNAL_API_SECRET).

import { createClient } from '@supabase/supabase-js'
import { crearCliente, InfileError } from '../../../lib/infile/client'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// Máximo de facturas a procesar por tick — evita timeouts si la cola es
// gigante. Si quedan más, el siguiente tick las agarra.
const MAX_POR_TICK = 20

export default async function handler(req, res) {
  // Permitir GET (cron de Vercel) y POST (disparo manual)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth: Vercel Cron manda User-Agent vercel-cron + Authorization Bearer
  // CRON_SECRET. También aceptamos INTERNAL_API_SECRET para disparo manual.
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron')
  const cronAuth = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
  const internalAuth = req.headers.authorization === `Bearer ${process.env.INTERNAL_API_SECRET}`
  if (!isVercelCron && !cronAuth && !internalAuth) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // 1. Cargar config_fel una sola vez (no cambia entre facturas)
  const { data: config, error: errConfig } = await supabaseAdmin
    .from('config_fel').select('*').single()
  if (errConfig || !config) {
    return res.status(500).json({ ok: false, error: 'config_fel no disponible' })
  }

  // 2. Traer facturas pendientes (oldest first)
  const { data: pendientes, error: errLoad } = await supabaseAdmin
    .from('facturas_fel')
    .select('id, xml_pendiente, intentos_certificacion, pendiente_desde, receptor_email')
    .eq('estado', 'pendiente_certificacion')
    .order('pendiente_desde', { ascending: true })
    .limit(MAX_POR_TICK)

  if (errLoad) {
    return res.status(500).json({ ok: false, error: errLoad.message })
  }
  if (!pendientes || pendientes.length === 0) {
    return res.status(200).json({ ok: true, procesadas: 0, mensaje: 'Sin facturas pendientes' })
  }

  console.log(`[reintentar-fel] procesando ${pendientes.length} facturas pendientes`)
  const cliente = crearCliente(config)
  const resultados = { certificadas: [], aun_caido: [], rechazadas: [] }

  for (const f of pendientes) {
    if (!f.xml_pendiente) {
      // Borrador sin XML — algo se corrompió. Marcar como error y seguir.
      await supabaseAdmin.from('facturas_fel').update({
        estado: 'error',
        error_ultimo_intento: 'xml_pendiente vacío al reintentar',
      }).eq('id', f.id)
      resultados.rechazadas.push({ id: f.id, razon: 'xml_pendiente vacío' })
      continue
    }

    try {
      const cert = await cliente.firmarYCertificar(f.xml_pendiente, f.id, {
        correoCopia: f.receptor_email || '',
      })

      if (!cert?.uuid) {
        // Infile respondió pero sin UUID — raro pero lo manejamos como caída
        await supabaseAdmin.from('facturas_fel').update({
          intentos_certificacion: (f.intentos_certificacion || 0) + 1,
          ultimo_intento_at: new Date().toISOString(),
          error_ultimo_intento: 'Infile sin uuid en la respuesta',
        }).eq('id', f.id)
        resultados.aun_caido.push({ id: f.id, intentos: (f.intentos_certificacion || 0) + 1 })
        continue
      }

      // ✅ Certificada — limpiar campos de pendiente
      await supabaseAdmin.from('facturas_fel').update({
        estado: 'certificada',
        uuid_sat: cert.uuid,
        serie_sat: cert.serie,
        numero_sat: cert.numero,
        fecha_certificacion: new Date().toISOString(),
        certificador: 'infile',
        xml_dte: cert.xml_certificado || f.xml_pendiente,
        xml_pendiente: null,
        pendiente_desde: null,
        intentos_certificacion: (f.intentos_certificacion || 0) + 1,
        ultimo_intento_at: new Date().toISOString(),
        error_ultimo_intento: null,
        updated_at: new Date().toISOString(),
      }).eq('id', f.id)

      console.log(`[reintentar-fel] ✅ certificada ${f.id} → ${cert.serie}-${cert.numero}`)
      resultados.certificadas.push({ id: f.id, serie: cert.serie, numero: cert.numero })

    } catch (e) {
      const esCaida = !(e instanceof InfileError) || e.status == null || e.status >= 500

      if (esCaida) {
        // Infile sigue caída — incrementar intentos y dejar para el siguiente tick
        await supabaseAdmin.from('facturas_fel').update({
          intentos_certificacion: (f.intentos_certificacion || 0) + 1,
          ultimo_intento_at: new Date().toISOString(),
          error_ultimo_intento: e.message.slice(0, 500),
        }).eq('id', f.id)
        resultados.aun_caido.push({ id: f.id, intentos: (f.intentos_certificacion || 0) + 1 })
      } else {
        // Rechazo legítimo (4xx, XML mal armado, NIT inválido, etc) — no
        // tiene sentido reintentar. Marcar como error para revisión manual.
        await supabaseAdmin.from('facturas_fel').update({
          estado: 'error',
          intentos_certificacion: (f.intentos_certificacion || 0) + 1,
          ultimo_intento_at: new Date().toISOString(),
          error_ultimo_intento: e.message.slice(0, 500),
        }).eq('id', f.id)
        console.error(`[reintentar-fel] ❌ rechazada ${f.id}: ${e.message}`)
        resultados.rechazadas.push({ id: f.id, razon: e.message.slice(0, 200) })
      }
    }
  }

  return res.status(200).json({
    ok: true,
    procesadas: pendientes.length,
    certificadas: resultados.certificadas.length,
    aun_caido: resultados.aun_caido.length,
    rechazadas: resultados.rechazadas.length,
    detalle: resultados,
  })
}

export const config = { maxDuration: 60 }
