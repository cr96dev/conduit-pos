// pages/api/neonet/voucher-reprint.js
// Reimpresion de voucher de una transaccion previa.
//
// Modo de uso:
//   POST body: { neonet_transaccion_id: 'uuid' }   -- recomendado
//   POST body: { retrieval_no: '123456789012' }    -- si no tenes el uuid
//
// Auth:
//   Bearer <supabase access_token> (admin) o Bearer ${INTERNAL_API_SECRET}.
//
// Devuelve el payload de Neonet (con los campos imprimibles del voucher).
// El front del POS se encarga de pintarlo y/o enviarlo a la impresora del Sunmi.
//
// NOTA: Neonet usa `systemsTraceNo` como llave del voucher. Si pasamos solo
// retrieval_no, primero hacemos lookup en BD para obtener el trace. Si no
// existe, devolvemos 404.

import { voucherReprint, NeonetClientError, NeonetAuthError } from '../../../lib/neonet/client'
import { requireAdmin } from '../../../lib/auth'
import { supabaseAdmin } from '../../../lib/qbo/supabaseAdmin'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const internalOk = req.headers.authorization === `Bearer ${process.env.INTERNAL_API_SECRET}`
  if (!internalOk) {
    const auth = await requireAdmin(req)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })
  }

  const { neonet_transaccion_id, retrieval_no } = req.body || {}
  if (!neonet_transaccion_id && !retrieval_no) {
    return res.status(400).json({ error: 'Falta neonet_transaccion_id o retrieval_no' })
  }

  // Lookup local para obtener trace + datos imprimibles del side de Julia.
  let q = supabaseAdmin
    .from('neonet_transacciones')
    .select('id, idsale, retrieval_no, authorization_code, voucher_code, amount_cents, approved, raw_response, raw_request')

  if (neonet_transaccion_id) q = q.eq('id', neonet_transaccion_id)
  else                       q = q.eq('retrieval_no', retrieval_no)

  const { data: filas, error: selErr } = await q.limit(1)
  if (selErr) {
    console.error('[neonet/voucher-reprint] ERROR BD:', selErr.message)
    return res.status(500).json({ ok: false, etapa: 'persist', error: selErr.message })
  }
  const trans = filas?.[0]
  if (!trans) {
    return res.status(404).json({ error: 'Transaccion no encontrada en BD local' })
  }
  if (!trans.approved) {
    return res.status(400).json({ error: 'Transaccion no aprobada; no hay voucher que reimprimir' })
  }

  // El trace puede venir del raw_response del Intent (lo que el NeoPOS
  // devolvio en el momento del cobro). Si no esta, dejamos que el client
  // de Neonet use el contador y devuelva el ultimo (per manual).
  const traceNo = trans.raw_response?.systemsTraceNo
    || trans.raw_response?.respuesta_lector?.systemsTraceNo
    || trans.raw_request?.systemsTraceNo
    || null

  try {
    const payload = await voucherReprint({ traceNo })
    return res.status(200).json({
      ok: true,
      neonet_transaccion_id: trans.id,
      idsale: trans.idsale,
      voucher: payload,
    })
  } catch (e) {
    if (e instanceof NeonetClientError || e instanceof NeonetAuthError) {
      console.error('[neonet/voucher-reprint] ERROR Neonet:', e.message, e.etapa)
      return res.status(502).json({
        ok: false,
        etapa: e.etapa,
        responseCode: e.responseCode || null,
        error: e.message,
      })
    }
    console.error('[neonet/voucher-reprint] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

export const config = { maxDuration: 60 }
