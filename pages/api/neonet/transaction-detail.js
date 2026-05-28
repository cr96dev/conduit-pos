// pages/api/neonet/transaction-detail.js
// Consulta el detalle de transacciones procesadas en Neonet/Visanet y lo
// cross-checkea contra neonet_transacciones (la copia local).
//
// Util para auditoria: detectar discrepancias entre lo que la red dice que
// cobro vs lo que nosotros persistimos.
//
// Modo de uso:
//   GET con Authorization: Bearer <supabase access_token>
//   GET con Authorization: Bearer ${INTERNAL_API_SECRET}   (manual / scripts)
//
// Respuesta (ok):
//   {
//     ok: true,
//     neonet: { ... payload crudo ... },
//     local: { total, aprobadas, pendientes_fel, sin_settlement },
//     discrepancias: [{ retrieval_no, en_neonet, en_local }, ...]
//   }
//
// La WebAPI v1.2.0 no documenta filtros por fecha en transactiondetail, asi
// que devolvemos el lote actual + comparamos con el dia GT en curso.

import { transactionDetail, NeonetClientError, NeonetAuthError } from '../../../lib/neonet/client'
import { requireAdmin } from '../../../lib/auth'
import { supabaseAdmin } from '../../../lib/qbo/supabaseAdmin'

function fechaGT() {
  const ms = Date.now() - 6 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

function ventanaDiaGT(fecha) {
  const inicio = new Date(`${fecha}T06:00:00.000Z`).toISOString()
  const fin    = new Date(`${fecha}T06:00:00.000Z`)
  fin.setUTCDate(fin.getUTCDate() + 1)
  return { desde: inicio, hasta: fin.toISOString() }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const internalOk = req.headers.authorization === `Bearer ${process.env.INTERNAL_API_SECRET}`
  if (!internalOk) {
    const auth = await requireAdmin(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
  }

  let payload
  try {
    payload = await transactionDetail()
  } catch (e) {
    if (e instanceof NeonetClientError || e instanceof NeonetAuthError) {
      console.error('[neonet/transaction-detail] ERROR Neonet:', e.message, e.etapa)
      return res.status(502).json({
        ok: false,
        etapa: e.etapa,
        responseCode: e.responseCode || null,
        error: e.message,
      })
    }
    console.error('[neonet/transaction-detail] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }

  // Resumen local del dia.
  const fecha = fechaGT()
  const { desde, hasta } = ventanaDiaGT(fecha)
  const { data: locales, error: selErr } = await supabaseAdmin
    .from('neonet_transacciones')
    .select('id, idsale, retrieval_no, authorization_code, amount_cents, approved, factura_id, settlement_batch')
    .gte('created_at', desde)
    .lt('created_at', hasta)

  if (selErr) {
    console.error('[neonet/transaction-detail] ERROR BD:', selErr.message)
    return res.status(500).json({ ok: false, etapa: 'persist', error: selErr.message, neonet: payload })
  }

  const total = locales?.length || 0
  const aprobadas = (locales || []).filter(l => l.approved).length
  const pendientes_fel = (locales || []).filter(l => l.approved && !l.factura_id).length
  const sin_settlement = (locales || []).filter(l => l.approved && !l.settlement_batch).length

  // Cross-check: por retrieval_no si Neonet nos lo devuelve.
  const retrievalsNeonet = new Set(
    (payload?.transactions || payload?.transactionDetails || [])
      .map(t => String(t.retrievalReferenceNumber || t.retrievalRefNo || t.retrievalRefNumber || '').trim())
      .filter(Boolean)
  )
  const discrepancias = []
  for (const l of (locales || [])) {
    if (l.approved && l.retrieval_no && !retrievalsNeonet.has(l.retrieval_no)) {
      discrepancias.push({
        retrieval_no: l.retrieval_no,
        idsale: l.idsale,
        en_neonet: false,
        en_local: true,
      })
    }
  }

  return res.status(200).json({
    ok: true,
    neonet: payload,
    local: { total, aprobadas, pendientes_fel, sin_settlement },
    discrepancias,
  })
}

export const config = { maxDuration: 60 }
