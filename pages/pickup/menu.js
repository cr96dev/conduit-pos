// pages/pickup/menu.js
// Catálogo del pickup. Conecta a loyverse_items (mismo catálogo del POS).
// Para no romper si Supabase tarda, usa items mock por default si la
// query falla o vuelve vacía.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import PickupShell from '../../components/pickup/PickupShell'
import { PickupTopBar, PickupBottomNav, PickupCartFAB } from '../../components/pickup/Nav'
import { useCart } from '../../lib/pickup/cart'
import { supabase } from '../../lib/supabase'

const CATEGORIAS = [
  { slug: 'panes',            label: 'Panes' },
  { slug: 'pasteleria-dulce', label: 'Pastelería dulce' },
  { slug: 'pasteleria-salada',label: 'Pastelería salada' },
  { slug: 'bebidas',          label: 'Bebidas' },
  { slug: 'conservas',        label: 'Conservas' },
]

// Productos mock — fallback si Supabase no responde o devuelve vacío.
// Mantienen el mismo shape que loyverse_items.variants normalizado.
const ITEMS_MOCK = [
  { variant_id: 'mock-1', item_name: 'Croissant de Almendra', variant_name: '',
    precio: 25, prep_min: 20, categoria: 'pasteleria-dulce',
    descripcion: 'Mantequilla pura, almendras tostadas y azúcar glass.',
    image_url: '/pickup/images/img_002.jpg' },
  { variant_id: 'mock-2', item_name: 'Baguette Tradicional', variant_name: '',
    precio: 18, prep_min: 15, categoria: 'panes',
    descripcion: 'Corteza crujiente, miga aireada y fermentación natural.',
    image_url: '/pickup/images/img_002.jpg' },
  { variant_id: 'mock-3', item_name: 'Masa Madre Integral', variant_name: '',
    precio: 45, prep_min: 30, categoria: 'panes',
    descripcion: 'Trigo integral orgánico, hidratación alta, 24h reposo.',
    image_url: '/pickup/images/img_002.jpg' },
  { variant_id: 'mock-4', item_name: 'Brioche Cardamomo', variant_name: '',
    precio: 12, prep_min: 25, categoria: 'pasteleria-dulce',
    descripcion: 'Suave y esponjoso, con infusión de semillas reales.',
    image_url: '/pickup/images/img_011.jpg' },
  { variant_id: 'mock-5', item_name: 'Pain au Chocolat', variant_name: '',
    precio: 22, prep_min: 20, categoria: 'pasteleria-dulce',
    descripcion: 'Chocolate belga al 70% envuelto en masa de hojaldre.',
    image_url: '/pickup/images/img_011.jpg' },
  { variant_id: 'mock-6', item_name: 'Café americano', variant_name: '',
    precio: 18, prep_min: 5, categoria: 'bebidas',
    descripcion: 'Especialidad de tueste medio. 100% arábica.',
    image_url: '/pickup/images/img_012.jpg' },
  { variant_id: 'mock-7', item_name: 'Mermelada artesanal', variant_name: 'Frutos rojos',
    precio: 55, prep_min: 0, categoria: 'conservas',
    descripcion: 'Frasco 250g, sin conservantes.',
    image_url: '/pickup/images/img_013.jpg' },
]

// Mapeo simple categoría loyverse → slug del menú. Si no matchea queda como 'panes'.
function inferirCategoria(catName) {
  const n = (catName || '').toLowerCase()
  if (n.includes('pan'))                                  return 'panes'
  if (n.includes('dulce') || n.includes('postre'))        return 'pasteleria-dulce'
  if (n.includes('salad') || n.includes('quiche'))        return 'pasteleria-salada'
  if (n.includes('bebida') || n.includes('café') || n.includes('cafe')) return 'bebidas'
  if (n.includes('conserva') || n.includes('mermelada')) return 'conservas'
  return 'panes'
}

function expandirVariantes(items, categoriasMap) {
  const out = []
  for (const it of items) {
    const catName = categoriasMap[it.category_id] || ''
    for (const v of (Array.isArray(it.variants) ? it.variants : [])) {
      if (!v?.variant_id) continue
      const price = v.stores?.[0]?.price ?? v.default_price ?? null
      if (price == null) continue
      out.push({
        variant_id: v.variant_id,
        item_name: it.item_name || '?',
        variant_name: v.option1_value || v.option2_value || '',
        precio: Number(price),
        prep_min: 20, // default — futuro: agregarlo al campo del item
        categoria: inferirCategoria(catName),
        descripcion: it.reference_id || '',
        image_url: it.image_url || '/pickup/images/img_002.jpg',
      })
    }
  }
  return out
}

export default function PickupMenu() {
  const router = useRouter()
  const { addItem, count } = useCart()
  const [items, setItems] = useState([])
  const [activa, setActiva] = useState('panes')
  const [cargando, setCargando] = useState(true)
  const [flash, setFlash] = useState('')

  // Si viene ?categoria=xxx desde la Home
  useEffect(() => {
    const q = router.query?.categoria
    if (typeof q === 'string' && CATEGORIAS.find(c => c.slug === q)) {
      setActiva(q)
    }
  }, [router.query])

  // Cargar items de Supabase. Si falla, usar mock.
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
        const catMap = Object.fromEntries((cats || []).map(c => [c.loyverse_id, c.name]))
        const expanded = expandirVariantes(its || [], catMap)
        if (cancelled) return
        setItems(expanded.length ? expanded : ITEMS_MOCK)
      } catch (e) {
        if (cancelled) return
        setItems(ITEMS_MOCK)
      } finally {
        if (!cancelled) setCargando(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const itemsActivos = useMemo(() => items.filter(i => i.categoria === activa), [items, activa])

  function handleAdd(item) {
    addItem({
      variant_id: item.variant_id,
      item_name: item.item_name,
      variant_name: item.variant_name,
      descripcion: item.descripcion,
      precio: item.precio,
      prep_min: item.prep_min,
      image_url: item.image_url,
      cantidad: 1,
    })
    setFlash(`${item.item_name} agregado`)
    setTimeout(() => setFlash(''), 1500)
  }

  return (
    <PickupShell title="Menú · Julia Bakery">
      <PickupTopBar cartCount={count} />

      {/* Tabs categoría */}
      <nav className="sticky top-16 bg-surface z-40 border-b border-outline-variant overflow-x-auto hide-scrollbar">
        <div className="flex whitespace-nowrap px-container-margin-mobile">
          {CATEGORIAS.map(cat => {
            const isActive = cat.slug === activa
            return (
              <button
                key={cat.slug}
                onClick={() => setActiva(cat.slug)}
                className={
                  isActive
                    ? 'px-4 py-4 text-primary font-bold border-b-2 border-primary transition-colors'
                    : 'px-4 py-4 text-on-surface-variant hover:text-primary transition-colors'
                }
              >
                {cat.label}
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
            <p className="font-body-lg">Sin productos en esta categoría todavía.</p>
            <p className="font-body-md text-tertiary mt-1">Probá otra categoría arriba.</p>
          </div>
        ) : (
          itemsActivos.map(it => (
            <Link
              key={it.variant_id}
              href={`/pickup/item/${encodeURIComponent(it.variant_id)}`}
              className="bg-surface rounded-xl p-3 flex gap-4 transition-all duration-200 active:scale-[0.98] border border-outline-variant/30 shadow-sm hover:shadow-md"
            >
              <div className="w-24 h-24 flex-shrink-0 bg-surface-container rounded-xl overflow-hidden">
                <img alt={it.item_name} className="w-full h-full object-cover" src={it.image_url} />
              </div>
              <div className="flex-grow flex flex-col justify-between min-w-0">
                <div>
                  <h2 className="font-body-lg text-body-lg text-on-surface truncate">{it.item_name}</h2>
                  {it.descripcion && (
                    <p className="text-[13px] text-tertiary leading-tight mt-1 line-clamp-2">{it.descripcion}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-2 text-on-surface-variant opacity-70">
                  <span className="material-symbols-outlined text-[16px]">schedule</span>
                  <span className="text-[12px] font-medium uppercase tracking-wider">{it.prep_min || 20} min</span>
                </div>
              </div>
              <div className="flex flex-col items-end justify-between flex-shrink-0">
                <span className="font-price-display text-price-display text-on-surface tabular-nums">
                  Q{it.precio.toFixed(2)}
                </span>
                <button
                  onClick={(e) => { e.preventDefault(); handleAdd(it) }}
                  className="w-11 h-11 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-lg hover:opacity-90 active:scale-90 transition-all"
                >
                  <span className="material-symbols-outlined">add</span>
                </button>
              </div>
            </Link>
          ))
        )}
      </main>

      {/* Toast flash al agregar */}
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
