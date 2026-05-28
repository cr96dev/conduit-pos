// lib/cajeros/lockout.js
// Anti-brute-force por IP para login de cajeros (PIN-only).
//
// Reglas:
//   - 5 intentos fallidos seguidos -> bloqueo 1 minuto.
//   - Un intento exitoso resetea el contador.
//   - Tras vencer el bloqueo, el contador vuelve a 0.
//
// Persistencia en tabla cajeros_login_intentos (PK=ip). Solo service_role.

const MAX_FALLOS = 5
const BLOQUEO_SEGUNDOS = 60

export function ipDesdeRequest(req) {
  const fwd = req.headers['x-forwarded-for']
  if (fwd) {
    // Puede venir 'ip1, ip2, ip3'. Tomar la primera.
    return String(fwd).split(',')[0].trim() || 'unknown'
  }
  return req.socket?.remoteAddress || 'unknown'
}

// Devuelve { bloqueado: boolean, segundos_restantes: number, intentos_fallidos: number }
export async function chequearLockout(admin, ip) {
  const { data } = await admin
    .from('cajeros_login_intentos')
    .select('intentos_fallidos, bloqueado_hasta')
    .eq('ip', ip)
    .maybeSingle()

  if (!data) {
    return { bloqueado: false, segundos_restantes: 0, intentos_fallidos: 0 }
  }

  const ahora = Date.now()
  const hastaMs = data.bloqueado_hasta ? new Date(data.bloqueado_hasta).getTime() : 0

  if (hastaMs > ahora) {
    return {
      bloqueado: true,
      segundos_restantes: Math.ceil((hastaMs - ahora) / 1000),
      intentos_fallidos: data.intentos_fallidos || 0,
    }
  }

  return {
    bloqueado: false,
    segundos_restantes: 0,
    intentos_fallidos: data.intentos_fallidos || 0,
  }
}

// Llamar tras un intento fallido. Devuelve { intentos, bloqueado, segundos_restantes }.
export async function registrarIntentoFallido(admin, ip) {
  const { data: actual } = await admin
    .from('cajeros_login_intentos')
    .select('intentos_fallidos, bloqueado_hasta')
    .eq('ip', ip)
    .maybeSingle()

  const ahora = Date.now()
  // Si HABIA un bloqueo y ya vencio, los intentos previos eran de la ronda pasada -> reset.
  // Si nunca hubo bloqueo, conservamos el contador.
  const huboBloqueoVencido = !!actual?.bloqueado_hasta
    && new Date(actual.bloqueado_hasta).getTime() <= ahora
  const baseIntentos = huboBloqueoVencido ? 0 : (actual?.intentos_fallidos || 0)
  const nuevos = baseIntentos + 1

  let bloqueadoHasta = null
  if (nuevos >= MAX_FALLOS) {
    bloqueadoHasta = new Date(ahora + BLOQUEO_SEGUNDOS * 1000).toISOString()
  }

  await admin
    .from('cajeros_login_intentos')
    .upsert({
      ip,
      intentos_fallidos: nuevos,
      bloqueado_hasta: bloqueadoHasta,
      ultimo_intento_at: new Date(ahora).toISOString(),
    }, { onConflict: 'ip' })

  return {
    intentos: nuevos,
    bloqueado: nuevos >= MAX_FALLOS,
    segundos_restantes: bloqueadoHasta ? BLOQUEO_SEGUNDOS : 0,
  }
}

export async function resetearIntentos(admin, ip) {
  await admin
    .from('cajeros_login_intentos')
    .upsert({
      ip,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
      ultimo_intento_at: new Date().toISOString(),
    }, { onConflict: 'ip' })
}
