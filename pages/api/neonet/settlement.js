// pages/api/neonet/settlement.js
// Cierre/settlement del lote del dia con Neonet/Visanet.
//
// Llama a paymentcommercesettlement de la WebAPI Dynamic Retail y, si el
// banco devuelve `00`, marca todas las filas aprobadas del dia (UTC-6) en
// neonet_transacciones con settlement_batch + settlement_date.
//
// Modo de uso:
//   POST con Authorization: Bearer ${INTERNAL_API_SECRET}   (manual / cron)
//   POST con Authorization: Bearer <supabase access_token>  (admin desde UI)
//
// Query opcional:
//   ?dry=1  -> ejecuta el settlement pero NO escribe en BD (solo devuelve)
//
// Respuesta (ok):
//   {
//     ok: true,
//     settlement: { responseCode, privateUse60, ...payload Neonet... },
//     marcadas: 17,                  // filas actualizadas en neonet_transacciones
//     settlement_batch: '003421',
//     settlement_date: '2026-05-28',
//   }

import { settlement, esRespuestaVacia, NeonetClientError, NeonetAuthError } from '../../../lib/neonet/client'
import { requireAdmin } from '../../../lib/auth'
import { supabaseAdmin } from '../../../lib/qbo/supabaseAdmin'

// Fecha en GT (UTC-6). El cierre se hace al final del dia operativo GT, asi
// que la "fecha del lote" es la fecha GT del momento en que corre el cierre.
function fechaGT() {
  const ms = Date.now() - 6 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

// Borde dia GT en epoch ms (00:00 GT = 06:00 UTC del mismo dia).
function ventanaDiaGT(fecha) {
  const inicio = new Date(`${fecha}T06:00:00.000Z`).toISOString()
  const fin    = new Date(`${fecha}T06:00:00.000Z`)
  fin.setUTCDate(fin.getUTCDate() + 1)
  return { desde: inicio, hasta: fin.toISOString() }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth dual: Bearer INTERNAL_API_SECRET (cron / curl) o sesion admin.
  const internalOk = req.headers.authorization === `Bearer ${process.env.INTERNAL_API_SECRET}`
  if (!internalOk) {
    const auth = await requireAdmin(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
  }

  const dry = req.query.dry === '1' || req.query.dry === 'true'

  let payload
  try {
    payload = await settlement()
  } catch (e) {
    if (e instanceof NeonetClientError || e instanceof NeonetAuthError) {
      console.error('[neonet/settlement] ERROR Neonet:', e.message, e.etapa, e.responseCode)
      return res.status(502).json({
        ok: false,
        etapa: e.etapa,
        responseCode: e.responseCode || null,
        error: e.message,
      })
    }
    console.error('[neonet/settlement] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }

  const fecha = fechaGT()

  // Neonet respondio 200 pero con body vacio = "no hay lote abierto".
  // No marcamos nada como settled — solo reportamos.
  if (esRespuestaVacia(payload)) {
    return res.status(200).json({
      ok: true,
      sin_lote: true,
      mensaje: 'Neonet respondio 200 sin body. No hay lote abierto para cerrar.',
      settlement_date: fecha,
      dry,
    })
  }

  const batch = payload?.privateUse60 || payload?.batchNumber || ''

  if (dry) {
    return res.status(200).json({
      ok: true,
      dry: true,
      settlement: payload,
      settlement_batch: batch,
      settlement_date: fecha,
    })
  }

  if (!batch) {
    return res.status(502).json({
      ok: false,
      etapa: 'sin_batch',
      error: 'Neonet respondio con responseCode=00 pero sin privateUse60/batchNumber',
      settlement: payload,
    })
  }

  // Marcar como settled todas las filas aprobadas del dia que aun no
  // tienen settlement_batch. Filtro por created_at en ventana GT.
  const { desde, hasta } = ventanaDiaGT(fecha)
  const { data: marcadas, error: updErr } = await supabaseAdmin
    .from('neonet_transacciones')
    .update({ settlement_batch: batch, settlement_date: fecha, updated_at: new Date().toISOString() })
    .eq('approved', true)
    .is('settlement_batch', null)
    .gte('created_at', desde)
    .lt('created_at', hasta)
    .select('id')

  if (updErr) {
    console.error('[neonet/settlement] ERROR update BD:', updErr.message)
    return res.status(500).json({
      ok: false,
      etapa: 'persist',
      error: updErr.message,
      settlement: payload,
    })
  }

  return res.status(200).json({
    ok: true,
    settlement: payload,
    marcadas: marcadas?.length || 0,
    settlement_batch: batch,
    settlement_date: fecha,
  })
}

export const config = { maxDuration: 60 }
