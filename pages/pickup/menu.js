// pages/pickup/menu.js
// Catálogo del pickup conectado al catálogo REAL de Loyverse (252 items).
//
// Categorías dinámicas leídas de loyverse_categories. Items con image_url
// real cuando exista, sino fallback a imagen genérica por categoría.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import PickupShell from '../../components/pickup/PickupShell'
import { PickupTopBar, PickupBottomNav, PickupCartFAB } from '../../components/pickup/Nav'
import { useCart } from '../../lib/pickup/cart'
import { supabase } from '../../lib/supabase'

// Imagen fallback por nombre de categoría (las 4 imágenes Stitch que ya bajamos)
const FALLBACK_BY_CAT_NAME = {
  PASTRIES: '/pickup/images/img_011.jpg',
  PASTELES: '/pickup/images/img_011.jpg',
  BEBIDAS:  '/pickup/images/img_012.jpg',
  CAFE:     '/pickup/images/img_012.jpg',
  ACTUAL:   '/pickup/images/img_010.jpg',
  EXTRAS:   '/pickup/images/img_013.jpg',
}
const FALLBACK_DEFAULT = '/pickup/images/img_002.jpg'

function expandirVariantes(items, categoriasMap) {
  const out = []
  for (const it of items) {
    const cat = categoriasMap[it.category_id] || { name: 'Otros' }
    const fallbackImg = FALLBACK_BY_CAT_NAME[cat.name] || FALLBACK_DEFAULT
    for (const v of (Array.isArray(it.variants) ? it.variants : [])) {
      if (!v?.variant_id) continue
      const price = v.stores?.[0]?.price ?? v.default_price ?? null
      if (price == null) continue
      out.push({
        variant_id: v.variant_id,
        item_name: it.item_name || '?',
        variant_name: v.option1_value || v.option2_value || '',
        precio: Number(price),
        prep_min: 20,
        category_id: it.category_id,
        category_name: cat.name,
        descripcion: it.reference_id || '',
        image_url: it.image_url || fallbackImg,
      })
    }
  }
  // Orden alfabético por nombre dentro de cada categoría
  out.sort((a, b) => a.item_name.localeCompare(b.item_name, 'es'))
  return out
}

export default function PickupMenu() {
  const router = useRouter()
  const { addItem, count } = useCart()
  const [items, setItems] = useState([])
  const [categorias, setCategorias] = useState([])
  const [activa, setActiva] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [flash, setFlash] = useState('')

  // Cargar catálogo real
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ data: cats }, { data: its }] = await Promise.all([
          supabase.from('loyverse_categories').select('loyverse_id, name'),
          supabase.from('loyverse_items')
            .select('loyverse_id, item_name, category_id, variants, image_url, reference_id')
            .is('deleted_at', null),
        ])
        const catsArr = (cats || []).filter(c => c.name)
        const catMap = Object.fromEntries(catsArr.map(c => [c.loyverse_id, c]))
        const expanded = expandirVariantes(its || [], catMap)
        if (cancelled) return
        // Solo categorías que tienen al menos 1 item con precio
        const catsConItems = catsArr
          .filter(c => expanded.some(i => i.category_id === c.loyverse_id))
          .map(c => ({ id: c.loyverse_id, label: c.name }))
        setCategorias(catsConItems)
        setItems(expanded)
        // Categoría activa: por query o la primera
        const qcat = router.query?.categoria
        const found = qcat && catsConItems.find(c => c.label.toLowerCase() === String(qcat).toLowerCase())
        setActiva(found?.id || catsConItems[0]?.id || null)
      } catch (e) {
        console.error('Error cargando catálogo:', e)
      } finally {
        if (!cancelled) setCargando(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Actualizar categoría activa cuando cambia query (?categoria=)
  useEffect(() => {
    const qcat = router.query?.categoria
    if (qcat && categorias.length) {
      const found = categorias.find(c => c.label.toLowerCase() === String(qcat).toLowerCase())
      if (found) setActiva(found.id)
    }
  }, [router.query?.categoria, categorias])

  const itemsActivos = useMemo(
    () => items.filter(i => i.category_id === activa),
    [items, activa],
  )

  function handleAdd(it) {
    addItem({
      variant_id: it.variant_id,
      item_name: it.item_name,
      variant_name: it.variant_name,
      descripcion: it.descripcion,
      precio: it.precio,
      prep_min: it.prep_min,
      image_url: it.image_url,
      cantidad: 1,
    })
    setFlash(`${it.item_name} agregado`)
    setTimeout(() => setFlash(''), 1500)
  }

  return (
    <PickupShell title="Menú · Julia Bakery">
      <PickupTopBar cartCount={count} />

      {/* Tabs categoría */}
      <nav className="sticky top-16 bg-surface z-40 border-b border-outline-variant overflow-x-auto hide-scrollbar">
        <div className="flex whitespace-nowrap px-container-margin-mobile">
          {categorias.map(cat => {
            const isActive = cat.id === activa
            return (
              <button
                key={cat.id}
                onClick={() => setActiva(cat.id)}
                className={
                  isActive
                    ? 'px-4 py-4 text-primary font-bold border-b-2 border-primary transition-colors capitalize'
                    : 'px-4 py-4 text-on-surface-variant hover:text-primary transition-colors capitalize'
                }
              >
                {cat.label.toLowerCase()}
              </button>
            )
          })}
        </div>
      </nav>

      <main className="px-container-margin-mobile pt-stack-md flex flex-col gap-gutter pb-32">
        {cargando ? (
          <div className="text-center text-on-surface-variant py-20">Cargando menú...</div>
        ) : itemsActivos.length === 0 ? (
          <div className="text-center text-on-surface-variant py-20">
            <span className="material-symbols-outlined text-5xl text-tertiary mb-2 block">bakery_dining</span>
            <p className="font-body-lg">Sin productos disponibles en esta categoría.</p>
          </div>
        ) : (
          itemsActivos.map(it => (
            <article
              key={it.variant_id}
              className="bg-surface rounded-xl p-3 flex gap-4 transition-all duration-200 active:scale-[0.98] border border-outline-variant/30 shadow-sm"
            >
              <Link
                href={`/pickup/item/${encodeURIComponent(it.variant_id)}`}
                className="w-24 h-24 flex-shrink-0 bg-surface-container rounded-xl overflow-hidden"
              >
                <img alt={it.item_name} className="w-full h-full object-cover" src={it.image_url}
                     onError={(e) => { e.currentTarget.src = FALLBACK_DEFAULT }} />
              </Link>
              <Link
                href={`/pickup/item/${encodeURIComponent(it.variant_id)}`}
                className="flex-grow flex flex-col justify-between min-w-0"
              >
                <div>
                  <h2 className="font-body-lg text-body-lg text-on-surface line-clamp-2">
                    {it.item_name}
                    {it.variant_name && (
                      <span className="text-on-surface-variant font-body-md ml-1">· {it.variant_name}</span>
                    )}
                  </h2>
                  {it.descripcion && (
                    <p className="text-[13px] text-tertiary leading-tight mt-1 line-clamp-2">{it.descripcion}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-2 text-on-surface-variant opacity-70">
                  <span className="material-symbols-outlined text-[16px]">schedule</span>
                  <span className="text-[12px] font-medium uppercase tracking-wider">{it.prep_min} min</span>
                </div>
              </Link>
              <div className="flex flex-col items-end justify-between flex-shrink-0">
                <span className="font-price-display text-price-display text-on-surface tabular-nums">
                  Q{it.precio.toFixed(2)}
                </span>
                <button
                  onClick={() => handleAdd(it)}
                  className="w-11 h-11 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-lg hover:opacity-90 active:scale-90 transition-all"
                >
                  <span className="material-symbols-outlined">add</span>
                </button>
              </div>
            </article>
          ))
        )}
      </main>

      {flash && (
        <div className="fixed bottom-32 left-1/2 -translate-x-1/2 z-[60] bg-on-surface text-white px-4 py-2 rounded-full text-sm shadow-lg">
          {flash}
        </div>
      )}

      <PickupCartFAB count={count} />
      <PickupBottomNav active="menu" />
    </PickupShell>
  )
}
