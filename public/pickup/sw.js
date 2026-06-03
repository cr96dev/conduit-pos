// public/pickup/sw.js — Service Worker para Julia Bakery PWA
//
// Estrategia:
// - Pre-cache de shell estático (logo, CSS, imágenes fallback)
// - Network-first para HTML y API (siempre tratamos de pegarle al server)
// - Cache-first para imágenes del catálogo Loyverse
// - Cache offline fallback al menú último visto

const CACHE_NAME = 'julia-pickup-v5'
const STATIC_ASSETS = [
  '/pickup/styles.css',
  '/pickup/logo.png',
  '/pickup/icon-192.png',
  '/pickup/icon-512.png',
  '/pickup/icon-maskable-512.png',
  '/pickup/apple-touch-icon.png',
  '/pickup/manifest.json',
  // Imágenes hero/categorías Stitch
  '/pickup/images/img_002.jpg',
  '/pickup/images/img_010.jpg',
  '/pickup/images/img_011.jpg',
  '/pickup/images/img_012.jpg',
  '/pickup/images/img_013.jpg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('julia-pickup-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  )
})

// Skip waiting cuando la app pide actualizar
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Solo manejar requests dentro del scope /pickup
  if (!url.pathname.startsWith('/pickup') && !url.pathname.startsWith('/api/pickup')) return

  // API → network-first (no cache para datos dinámicos del pedido)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    )
    return
  }

  // Imágenes del catálogo Loyverse → cache-first
  if (url.hostname.includes('loyverse') || url.hostname.includes('amazonaws')) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        return fetch(req).then((res) => {
          if (res.ok) {
            const clone = res.clone()
            caches.open(CACHE_NAME).then((c) => c.put(req, clone))
          }
          return res
        })
      })
    )
    return
  }

  // HTML y assets locales → network-first con fallback a cache
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const clone = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(req, clone))
        }
        return res
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('/pickup')))
  )
})

// Push notifications (cuando pedido marcado listo)
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data?.json() || {} } catch (_) {}
  const title = data.title || 'Julia Bakery'
  const body  = data.body  || 'Tu pedido está listo para recoger'
  const tag   = data.tag   || 'julia-pickup-' + Date.now()
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pickup/icon-192.png',
      badge: '/pickup/icon-96.png',
      tag,
      data: data.url ? { url: data.url } : undefined,
      requireInteraction: true,
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/pickup/mis-pedidos'
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url.includes('/pickup'))
      if (existing) {
        existing.focus()
        existing.navigate(targetUrl)
        return
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})
