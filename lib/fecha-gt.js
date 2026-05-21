// lib/fecha-gt.js
// Helpers de fecha en zona horaria Guatemala (UTC-6, sin DST).
//
// El POS (Loyverse), Supabase y Vercel guardan timestamps en UTC.
// Cuando hablamos de "el dia X" en GT necesitamos convertir bien
// para no perder o duplicar ventas en los limites del dia.

const OFFSET_MS = 6 * 60 * 60 * 1000  // GT = UTC - 6h

// Devuelve YYYY-MM-DD para la fecha de hoy en GT.
export function hoyGT() {
  const ms = Date.now() - OFFSET_MS
  return new Date(ms).toISOString().slice(0, 10)
}

// Devuelve YYYY-MM-DD para `daysAgo` dias antes de hoy en GT.
export function fechaGT(daysAgo = 0) {
  const ms = Date.now() - OFFSET_MS - daysAgo * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

// Para una fecha local GT (YYYY-MM-DD), devuelve el rango [desdeUTC, hastaUTC)
// como ISO strings, listos para usar en queries .gte() / .lt().
//
//   rangoUTCDeDiaGT('2026-05-21')
//     -> { desdeUTC: '2026-05-21T06:00:00.000Z',
//          hastaUTC: '2026-05-22T06:00:00.000Z' }
export function rangoUTCDeDiaGT(fechaGT) {
  const [y, m, d] = fechaGT.split('-').map(Number)
  // 00:00 GT = 06:00 UTC del mismo dia calendario.
  const desde = new Date(Date.UTC(y, m - 1, d, 6, 0, 0, 0))
  const hasta = new Date(desde.getTime() + 86_400_000)
  return { desdeUTC: desde.toISOString(), hastaUTC: hasta.toISOString() }
}
