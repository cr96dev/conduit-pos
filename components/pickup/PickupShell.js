// components/pickup/PickupShell.js
//
// Wrapper único para todas las páginas de /pickup.
// - Carga el CSS Tailwind pre-compilado (/pickup/styles.css, scoped a #pickup-root)
// - Meta tags PWA (manifest, theme-color, apple-touch-icon)
// - Registra service worker para offline + push notifications
// - Banner "Agregar a inicio" la primera vez que el usuario visita

import { useEffect, useState } from 'react'
import Head from 'next/head'

export default function PickupShell({ children, title = 'Julia Bakery' }) {
  const [installPrompt, setInstallPrompt] = useState(null)
  const [showIosBanner, setShowIosBanner] = useState(false)

  // Service worker register + force update check on every visit
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/pickup/sw.js', { scope: '/pickup' })
      .then((reg) => {
        // Forzar revisión de SW nuevo en cada visita (no esperar a las 24h default)
        reg.update().catch(() => {})
        // Si hay un SW nuevo waiting, decirle que tome control inmediatamente
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
        reg.addEventListener('updatefound', () => {
          const nuevo = reg.installing
          if (!nuevo) return
          nuevo.addEventListener('statechange', () => {
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
              // Hay versión nueva → reload para tomar el SW nuevo
              window.location.reload()
            }
          })
        })
      })
      .catch((e) => console.warn('SW register failed', e))
  }, [])

  // Capturar beforeinstallprompt (Chrome / Android) → mostrar nuestro banner custom
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (e) => {
      e.preventDefault()
      setInstallPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  // Detectar iOS Safari standalone vs no — Apple no soporta beforeinstallprompt
  useEffect(() => {
    if (typeof window === 'undefined') return
    const ua = window.navigator.userAgent
    const isIos = /iPhone|iPad|iPod/i.test(ua)
    const isStandalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches
    const dismissed = localStorage.getItem('julia_pickup_ios_banner_dismissed') === '1'
    if (isIos && !isStandalone && !dismissed) {
      // Mostrar banner iOS solo después de 5 segundos para no ser intrusivo
      const t = setTimeout(() => setShowIosBanner(true), 5000)
      return () => clearTimeout(t)
    }
  }, [])

  async function instalarAndroid() {
    if (!installPrompt) return
    installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null)
    }
  }

  function descartarBannerIos() {
    setShowIosBanner(false)
    try { localStorage.setItem('julia_pickup_ios_banner_dismissed', '1') } catch (_) {}
  }

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="description" content="Pedí tu pan recién horneado y recogelo cuando esté listo. Julia Bakery, Guatemala." />

        {/* PWA */}
        <link rel="manifest" href="/pickup/manifest.json" />
        <meta name="theme-color" content="#c8242a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Julia" />
        <link rel="apple-touch-icon" href="/pickup/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/pickup/icon-192.png" />
        <link rel="icon" type="image/png" sizes="512x512" href="/pickup/icon-512.png" />

        {/* Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />

        {/* Tailwind compilado solo para /pickup, scoped a #pickup-root */}
        <link rel="stylesheet" href="/pickup/styles.css" />
      </Head>

      <div id="pickup-root">
        {children}

        {/* Banner Android (Chrome) — beforeinstallprompt disponible */}
        {installPrompt && (
          <div className="fixed bottom-20 left-4 right-4 z-[70] bg-surface border border-outline-variant rounded-2xl shadow-2xl p-4 flex items-center gap-3 animate-pulse-once">
            <img src="/pickup/icon-96.png" alt="" className="w-12 h-12 rounded-xl" />
            <div className="flex-grow min-w-0">
              <div className="font-body-lg text-on-surface">Agregá Julia a tu inicio</div>
              <div className="text-[12px] text-on-surface-variant">Para ordenar más rápido la próxima vez</div>
            </div>
            <button
              onClick={() => setInstallPrompt(null)}
              className="text-on-surface-variant text-[12px] font-medium px-2"
            >
              No
            </button>
            <button
              onClick={instalarAndroid}
              className="bg-primary text-on-primary font-body-lg px-4 h-10 rounded-lg active:scale-95 transition-transform"
            >
              Agregar
            </button>
          </div>
        )}

        {/* Banner iOS Safari — instrucciones manuales */}
        {showIosBanner && (
          <div className="fixed bottom-20 left-4 right-4 z-[70] bg-surface border border-outline-variant rounded-2xl shadow-2xl p-4 animate-pulse-once">
            <div className="flex items-center gap-3 mb-2">
              <img src="/pickup/icon-96.png" alt="" className="w-10 h-10 rounded-xl" />
              <div className="flex-grow min-w-0">
                <div className="font-body-lg text-on-surface">Agregá Julia a tu inicio</div>
              </div>
              <button onClick={descartarBannerIos} className="text-on-surface-variant text-[20px]">×</button>
            </div>
            <div className="text-[13px] text-on-surface-variant leading-snug">
              Tocá <span className="inline-block align-middle px-1.5 py-0.5 bg-surface-container rounded text-on-surface">⎙</span>
              {' '}abajo, después <strong>"Agregar a pantalla de inicio"</strong>.
            </div>
          </div>
        )}
      </div>
    </>
  )
}
