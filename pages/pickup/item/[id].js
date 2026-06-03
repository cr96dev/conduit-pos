// pages/pickup/item/[id].js
// Detalle de un item. Diseño basado en design-source/pickup/screens/detalle.html

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import PickupShell from '../../../components/pickup/PickupShell'
import { PickupTopBar, PickupBottomNav } from '../../../components/pickup/Nav'
import { useCart } from '../../../lib/pickup/cart'

// Reuso del mismo mock del menu para que funcione sin Supabase
const FALLBACK_BY_ID = {
  'mock-1': { item_name: 'Croissant de Almendra', variant_name: '', precio: 25, prep_min: 20,
              descripcion: 'Croissant artesanal de hojaldre con almendras tostadas, crema de almendra y un toque de azúcar glass. Horneado al momento.',
              image_url: '/pickup/images/img_002.jpg' },
}

async function fetchItem(variantId) {
  try {
    const r = await fetch('/api/pickup/catalogo')
    const j = await r.json()
    if (!j?.ok) return null
    for (const it of j.items || []) {
      for (const v of (it.variants || [])) {
        if (v.variant_id === variantId) {
          const price = v.stores?.[0]?.price ?? v.default_price ?? 0
          return {
            variant_id: v.variant_id,
            item_name: it.item_name,
            variant_name: v.option1_value || v.option2_value || '',
            precio: Number(price),
            prep_min: 20,
            descripcion: it.reference_id || '',
            image_url: it.image_url || '/pickup/images/img_002.jpg',
          }
        }
      }
    }
    return null
  } catch (_) {
    return null
  }
}

export default function PickupItemDetail() {
  const router = useRouter()
  const { id } = router.query
  const { addItem, count } = useCart()
  const [item, setItem] = useState(null)
  const [cantidad, setCantidad] = useState(1)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!id || typeof id !== 'string') return
    ;(async () => {
      setCargando(true)
      const fromDb = await fetchItem(id)
      setItem(fromDb || FALLBACK_BY_ID[id] || null)
      setCargando(false)
    })()
  }, [id])

  if (cargando) {
    return (
      <PickupShell title="Cargando · Julia Bakery">
        <PickupTopBar cartCount={count} />
        <main className="p-6 text-center text-on-surface-variant">Cargando producto...</main>
      </PickupShell>
    )
  }

  if (!item) {
    return (
      <PickupShell title="No encontrado · Julia Bakery">
        <PickupTopBar cartCount={count} />
        <main className="p-6 text-center">
          <p className="font-headline-lg text-headline-lg mb-2">No encontramos ese producto</p>
          <Link href="/pickup/menu" className="text-primary underline">Volver al menú</Link>
        </main>
      </PickupShell>
    )
  }

  const subtotal = item.precio * cantidad

  return (
    <PickupShell title={`${item.item_name} · Julia Bakery`}>
      <PickupTopBar cartCount={count} />
      <main className="pb-32">
        {/* Foto */}
        <div className="w-full aspect-[16/9] bg-surface-container overflow-hidden">
          <img alt={item.item_name} className="w-full h-full object-cover" src={item.image_url} />
        </div>

        {/* Contenido */}
        <div className="px-container-margin-mobile pt-stack-md flex flex-col gap-stack-md">
          <div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface mb-1">
              {item.item_name}
              {item.variant_name && (
                <span className="text-on-surface-variant font-body-md ml-2">({item.variant_name})</span>
              )}
            </h1>
            <div className="flex items-center gap-2 text-on-surface-variant">
              <span className="material-symbols-outlined text-[18px]">schedule</span>
              <span className="font-caption-caps text-caption-caps">{item.prep_min} min de preparación</span>
            </div>
          </div>

          {item.descripcion && (
            <p className="font-body-md text-on-surface-variant leading-relaxed">{item.descripcion}</p>
          )}

          {/* Selector cantidad */}
          <div className="flex items-center justify-between bg-surface-container-low border border-outline-variant/30 rounded-xl px-4 py-3">
            <span className="font-body-lg text-on-surface">Cantidad</span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setCantidad(Math.max(1, cantidad - 1))}
                disabled={cantidad <= 1}
                className="w-10 h-10 bg-surface border border-outline-variant rounded-full flex items-center justify-center disabled:opacity-30 active:scale-90 transition-transform"
              >
                <span className="material-symbols-outlined">remove</span>
              </button>
              <span className="font-price-display text-price-display text-on-surface tabular-nums min-w-[24px] text-center">
                {cantidad}
              </span>
              <button
                onClick={() => setCantidad(Math.min(99, cantidad + 1))}
                className="w-10 h-10 bg-primary text-on-primary rounded-full flex items-center justify-center active:scale-90 transition-transform"
              >
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* CTA sticky */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-outline-variant px-container-margin-mobile py-4 pb-safe">
        <button
          onClick={() => {
            addItem({
              variant_id: item.variant_id,
              item_name: item.item_name,
              variant_name: item.variant_name,
              descripcion: item.descripcion,
              precio: item.precio,
              prep_min: item.prep_min,
              image_url: item.image_url,
              cantidad,
            })
            router.push('/pickup/menu')
          }}
          className="w-full h-14 bg-primary text-on-primary rounded-lg font-body-lg flex items-center justify-between px-6 active:scale-[0.98] transition-all shadow-lg"
        >
          <span>Agregar al pedido</span>
          <span className="tabular-nums">Q{subtotal.toFixed(2)}</span>
        </button>
      </div>
    </PickupShell>
  )
}
