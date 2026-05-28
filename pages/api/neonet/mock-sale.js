// pages/api/neonet/mock-sale.js
// Simula la respuesta que devolveria el Intent del NeoPOS App en el Sunmi.
//
// Util para iterar el flujo del POS antes de tener el dispositivo fisico
// y la app NeoPOS instalada. El shape de la respuesta es identico al
// `respuesta_lector` documentado en el manual NeoPos App v1.1.0:
//
//   {
//     response_code, retrieval_no, authorization_code, response_message,
//     approved, suggested_nit, voucher_code,
//     // extras que el manual implica pero no documenta explicitamente:
//     panPci, cardHolderName, posEntryMode, terminalId, cardAcqId
//   }
//
// Modo de uso (POST):
//   body: { idsale, amount_cents }
//   query opcional:
//     ?force=denied      -> approved=false, response_code='05'
//     ?force=offline     -> simula error de comunicacion (devuelve error_message)
//     ?force=timeout     -> demora 30s para probar timeouts del bridge
//     ?nit=12345678      -> simula tarjeta con NIT registrado (autocompletar receptor)
//     ?delay=1500        -> demora N ms para sentir realista (default aleatorio 300-1200ms)
//
// Auth: requireAdmin. Solo administradores autenticados de Julia pueden
// disparar el mock — mismas restricciones que el POS real.
//
// NO escribe en BD. La persistencia la hace /api/pos/ventas cuando recibe
// el resultado. Este endpoint solo simula la "caja negra" del Intent.

import { requireAdmin } from '../../../lib/auth'

// Generadores deterministicos-ish para datos de prueba realistas.
function randomDigits(n) {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10)
  return s
}

function randomHolderName() {
  const nombres = ['MARIA', 'JUAN', 'ANA', 'CARLOS', 'LUCIA', 'PEDRO', 'ROSA', 'JOSE']
  const apellidos = ['LOPEZ', 'GARCIA', 'MARTINEZ', 'RODRIGUEZ', 'HERNANDEZ', 'GONZALEZ']
  const n = nombres[Math.floor(Math.random() * nombres.length)]
  const a1 = apellidos[Math.floor(Math.random() * apellidos.length)]
  const a2 = apellidos[Math.floor(Math.random() * apellidos.length)]
  return `${n} ${a1} ${a2}`
}

// 051=chip, 021=banda, 071=NFC (catalogo posEntryMode estandar ISO 8583)
const POS_ENTRY_MODES = ['051', '021', '071']

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { idsale, amount_cents } = req.body || {}
  if (!idsale || typeof idsale !== 'string') {
    return res.status(400).json({ error: 'idsale requerido (string)' })
  }
  const amount = Number(amount_cents)
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: 'amount_cents requerido (entero > 0)' })
  }

  const force = String(req.query.force || '').toLowerCase()
  const delayMs = Number.isFinite(Number(req.query.delay))
    ? Math.min(Math.max(Number(req.query.delay), 0), 30_000)
    : (300 + Math.floor(Math.random() * 900))   // 300-1200 ms default
  const nitOverride = req.query.nit ? String(req.query.nit).trim() : null

  // Delay para sentir realista (chip + red).
  if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))

  // Simular timeout completo (el bridge JS deberia cortar antes).
  if (force === 'timeout') {
    await new Promise(r => setTimeout(r, 30_000))
    return res.status(504).json({
      ok: false,
      mock: true,
      error_message: 'Timeout esperando respuesta del NeoPOS App (mock)',
    })
  }

  // Simular error de comunicacion / dispositivo offline.
  if (force === 'offline') {
    return res.status(200).json({
      ok: false,
      mock: true,
      error_message: 'Sin conexion con el procesador. Reintenta o cobra otro metodo (mock).',
      respuesta_lector: null,
    })
  }

  // Respuesta de venta. force=denied -> rechazada; default -> aprobada.
  const aprobada = force !== 'denied'
  const responseCode = aprobada ? '00' : '05'
  const responseMessage = aprobada
    ? 'APROBADA'
    : 'TARJETA DECLINADA POR EL EMISOR'

  const respuesta_lector = {
    response_code: responseCode,
    retrieval_no: randomDigits(12),
    authorization_code: aprobada ? randomDigits(6) : '',
    response_message: responseMessage,
    approved: aprobada ? 'true' : 'false',
    suggested_nit: nitOverride || '',
    voucher_code: aprobada ? randomDigits(8) : '',
    // Extras que el Intent real devuelve aunque no esten explicitos en el manual:
    panPci: '************' + randomDigits(4),
    cardHolderName: randomHolderName(),
    posEntryMode: POS_ENTRY_MODES[Math.floor(Math.random() * POS_ENTRY_MODES.length)],
    terminalId: '18070542',     // mismo del manual de ejemplo (QA)
    cardAcqId: '42072024',      // mismo del manual de ejemplo (QA)
  }

  return res.status(200).json({
    ok: true,
    mock: true,
    idsale,
    amount_cents: amount,
    respuesta_lector,
  })
}
