// lib/kiosko.js
// Detecta si la app esta corriendo dentro del wrapper Android JuliaBakeryPOS
// (Sunmi / cualquier dispositivo de cobro on-site).
//
// El wrapper agrega `JuliaBakeryPOS/<version>` al User-Agent y expone
// `window.JuliaPOS`. Cualquiera de las dos es senal suficiente.
//
// Uso:
//   import { esKiosko } from '../lib/kiosko'
//   if (esKiosko()) { ... }
//
// IMPORTANTE: este check debe ser tolerante a SSR (window no existe).
// Llamarlo desde useEffect o detras de un guard `typeof window !== ...`.

export function esKiosko() {
  if (typeof window === 'undefined') return false
  // Senal A: User-Agent del wrapper.
  try {
    if (typeof navigator !== 'undefined' && navigator.userAgent && navigator.userAgent.indexOf('JuliaBakeryPOS') !== -1) {
      return true
    }
  } catch (_) {}
  // Senal B: bridge nativo instalado (puede llegar antes que el UA si
  // bootstrap llego primero — por las dudas).
  try {
    if (window.JuliaPOS && window.JuliaPOS.__installed === true) return true
  } catch (_) {}
  return false
}

// Hook para usar en componentes. Devuelve `false` durante SSR y se
// actualiza tras montar.
import { useEffect, useState } from 'react'
export function useEsKiosko() {
  const [v, setV] = useState(false)
  useEffect(() => {
    setV(esKiosko())
    // Si el bridge se instala despues (pageFinished tarda), re-chequear.
    const t = setInterval(() => {
      if (esKiosko()) { setV(true); clearInterval(t) }
    }, 500)
    return () => clearInterval(t)
  }, [])
  return v
}
