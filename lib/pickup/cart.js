// lib/pickup/cart.js
//
// Hook simple para manejar el carrito en localStorage (sin context para mantenerlo liviano).

import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'julia_pickup_cart_v1'

function loadCart() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch (_) {
    return []
  }
}

function saveCart(items) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    window.dispatchEvent(new Event('julia-pickup-cart-changed'))
  } catch (_) {}
}

export function useCart() {
  const [items, setItems] = useState([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setItems(loadCart())
    setReady(true)
    const handler = () => setItems(loadCart())
    window.addEventListener('julia-pickup-cart-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('julia-pickup-cart-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  const addItem = useCallback((item) => {
    const current = loadCart()
    const idx = current.findIndex((x) => x.variant_id === item.variant_id)
    let next
    if (idx >= 0) {
      next = [...current]
      next[idx] = { ...next[idx], cantidad: next[idx].cantidad + (item.cantidad || 1) }
    } else {
      next = [...current, { ...item, cantidad: item.cantidad || 1 }]
    }
    saveCart(next)
    setItems(next)
  }, [])

  const updateQty = useCallback((variantId, cantidad) => {
    const current = loadCart()
    let next
    if (cantidad <= 0) {
      next = current.filter((x) => x.variant_id !== variantId)
    } else {
      next = current.map((x) => (x.variant_id === variantId ? { ...x, cantidad } : x))
    }
    saveCart(next)
    setItems(next)
  }, [])

  const removeItem = useCallback((variantId) => {
    const next = loadCart().filter((x) => x.variant_id !== variantId)
    saveCart(next)
    setItems(next)
  }, [])

  const clear = useCallback(() => {
    saveCart([])
    setItems([])
  }, [])

  const count = items.reduce((sum, i) => sum + (i.cantidad || 0), 0)
  const total = items.reduce((sum, i) => sum + (i.cantidad || 0) * (i.precio || 0), 0)
  const maxPrepMin = items.reduce((max, i) => Math.max(max, i.prep_min || 0), 0)

  return { items, count, total, maxPrepMin, ready, addItem, updateQty, removeItem, clear }
}
