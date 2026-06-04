// lib/pickup/k2-mode.js
//
// Detecta si la PWA pickup está corriendo en el modo "K2 armador":
// - El K2 Mini (Sunmi) carga juliabakery.com/pickup?modo=k2 al boot.
// - El primer hit guarda el flag en localStorage.
// - De ahí en adelante todas las páginas /pickup/* lo detectan.
//
// Para revertir/limpiar: visitar juliabakery.com/pickup?modo=normal
// (o limpiar el localStorage del dispositivo).
//
// Uso:
//   import { useK2Mode, esModoK2 } from '../../lib/pickup/k2-mode'
//   const isK2 = useK2Mode()
//   if (esModoK2()) { ... } // server-side safe

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'julia_modo_k2_v1'

export function esModoK2() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function activarModoK2() {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(STORAGE_KEY, '1') } catch {}
}

export function desactivarModoK2() {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(STORAGE_KEY) } catch {}
}

// Hook React. Lee localStorage al montar y también escucha query param para
// permitir activar/desactivar el modo visitando una URL específica.
export function useK2Mode() {
  const [isK2, setIsK2] = useState(false)

  useEffect(() => {
    // Procesar query param ?modo=k2 / ?modo=normal
    const url = new URL(window.location.href)
    const modo = url.searchParams.get('modo')
    if (modo === 'k2') activarModoK2()
    else if (modo === 'normal') desactivarModoK2()
    setIsK2(esModoK2())
  }, [])

  return isK2
}
