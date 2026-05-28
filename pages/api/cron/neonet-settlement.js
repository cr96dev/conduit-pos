// pages/api/cron/neonet-settlement.js
// Cron diario: cierre/settlement automatico del lote de tarjetas en Neonet.
// Schedule: 0 5 * * *  (23:00 GT — UTC-6)
// Auth:     Bearer ${CRON_SECRET}
//
// Por que 23:00 GT: la panaderia cierra entre 19:00 y 21:00. Damos margen
// hasta las 23:00 para no cortar un cobro de tarjeta tardio. Si el cron se
// salta (Vercel retry, error de red), el siguiente tick lo retoma porque
// el filtro UPDATE busca filas aprobadas SIN settlement_batch — idempotente.
//
// Que hace:
//   1. Llama POST paymentcommercesettlement en la WebAPI Dynamic Retail.
//   2. Si responseCode != '00' -> log + 502 al caller (Vercel lo registra
//      y reintenta segun la politica del cron). NO escribe en BD.
//   3. Si responseCode == '00' -> UPDATE neonet_transacciones SET
//      settlement_batch + settlement_date para todas las aprobadas del dia
//      GT que aun no tienen batch.
//
// La logica esta delegada a /api/neonet/settlement (mismo handler), asi que
// este endpoint solo se autentica como cron y reenvia.

import handlerSettlement from '../neonet/settlement'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // El handler de settlement espera POST + auth (Bearer INTERNAL_API_SECRET o
  // sesion admin). Inyectamos un req con INTERNAL_API_SECRET para evitar
  // re-validar sesion en el handler delegado.
  const fakeReq = {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
      'content-type': 'application/json',
    },
    body: {},
    query: req.query || {},
  }

  // Capturamos la respuesta del handler delegado.
  let captured = null
  const fakeRes = {
    status(code) { this._code = code; return this },
    json(obj) { captured = { code: this._code || 200, obj }; return this },
  }
  await handlerSettlement(fakeReq, fakeRes)

  const code = captured?.code || 500
  const body = captured?.obj || { ok: false, error: 'sin respuesta del handler' }
  console.log('[neonet-settlement] HTTP', code, JSON.stringify({
    ok: body.ok,
    batch: body.settlement_batch,
    marcadas: body.marcadas,
    etapa: body.etapa,
    error: body.error,
  }))
  return res.status(code).json(body)
}

export const config = { maxDuration: 60 }
