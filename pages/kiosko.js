// pages/kiosko.js
//
// Kiosko self-service de Julia Bakery — rediseño premium para Sunmi K2 Mini.
//
// Pantallas:
//   1. Home: hero cinematic con logo animado
//   2. Catálogo: cards premium con fotos grandes
//   3. Confirmar: resumen + NIT autocompletado
//   4. Éxito: número gigante + confetti
//
// Sin login. Sin turno. Sin pago (F2). Auto-reset 90s.

import { useEffect, useMemo, useState, useRef } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

const fmtQ = (n) =>
  'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PLACEHOLDER_IMG = '/logo.png'

// Iconos emoji por categoría (case-insensitive match en nombre)
const ICONO_CAT = (nombre) => {
  const n = String(nombre || '').toLowerCase()
  if (n.includes('cafe') || n.includes('café')) return '☕'
  if (n.includes('bebida')) return '🥤'
  if (n.includes('té') || n.includes('te')) return '🍵'
  if (n.includes('pastel')) return '🎂'
  if (n.includes('pastr')) return '🥐'
  if (n.includes('pan')) return '🍞'
  if (n.includes('extra')) return '✨'
  if (n.includes('jugo')) return '🧃'
  if (n.includes('sandwich') || n.includes('sándwich')) return '🥪'
  return '🍽️'
}

export default function Kiosko() {
  const [pantalla, setPantalla] = useState('home')
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [categoriasInfo, setCategoriasInfo] = useState({})
  const [cargando, setCargando] = useState(true)
  const [carrito, setCarrito] = useState([])
  const [catSel, setCatSel] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pedidoCreado, setPedidoCreado] = useState(null)
  const [receptor, setReceptor] = useState({ nit: 'CF', nombre: 'CONSUMIDOR FINAL' })
  const [mostrarFactura, setMostrarFactura] = useState(false)
  // Microanimacion al agregar
  const [pulseProducto, setPulseProducto] = useState(null)
  const idleTimerRef = useRef(null)

  // Cargar catálogo
  useEffect(() => {
    Promise.all([
      supabase.from('loyverse_categories').select('loyverse_id, name, image_url').order('name'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, category_id, variants, image_url').is('deleted_at', null),
    ]).then(([{ data: cats }, { data: its }]) => {
      const infoMap = {}
      for (const c of cats || []) {
        infoMap[c.loyverse_id] = { name: c.name, image_url: c.image_url || null }
      }
      setCategoriasInfo(infoMap)
      const prods = []
      for (const it of (its || [])) {
        const catInfo = infoMap[it.category_id] || { name: '', image_url: null }
        for (const v of (it.variants || [])) {
          if (!v?.variant_id) continue
          const precio = v.stores?.[0]?.price ?? v.default_price
          if (precio == null) continue
          prods.push({
            variant_id: v.variant_id,
            item_id: it.loyverse_id,
            item_name: it.item_name || '?',
            variant_name: v.option1_value || v.option2_value || '',
            precio: Number(precio),
            image_url: it.image_url || catInfo.image_url || null,
            categoria: catInfo.name || '',
          })
        }
      }
      setProductos(prods)
      const catUnicas = Array.from(new Set(prods.map(p => p.categoria).filter(Boolean))).sort()
      setCategorias(catUnicas)
      setCargando(false)
    })
  }, [])

  // Auto-reset por inactividad
  useEffect(() => {
    const reset = () => {
      if (pantalla === 'home') return
      setPantalla('home')
      setCarrito([])
      setCatSel('')
      setPedidoCreado(null)
      setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL' })
      setMostrarFactura(false)
    }
    const bumpTimer = () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (pantalla === 'home' || pantalla === 'exito') return
      idleTimerRef.current = setTimeout(reset, 90000)
    }
    bumpTimer()
    const handler = () => bumpTimer()
    window.addEventListener('touchstart', handler)
    window.addEventListener('click', handler)
    return () => {
      window.removeEventListener('touchstart', handler)
      window.removeEventListener('click', handler)
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    }
  }, [pantalla])

  const productosFiltrados = useMemo(() => {
    if (!catSel) return productos
    return productos.filter(p => p.categoria === catSel)
  }, [productos, catSel])

  const totales = useMemo(() => {
    const total = carrito.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0)
    const items = carrito.reduce((s, l) => s + l.cantidad, 0)
    return { total: Math.round(total * 100) / 100, items }
  }, [carrito])

  function agregarAlCarrito(p) {
    setCarrito(prev => {
      const idx = prev.findIndex(l => l.variant_id === p.variant_id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + 1 }
        return next
      }
      return [...prev, {
        variant_id: p.variant_id,
        descripcion: p.variant_name ? `${p.item_name} (${p.variant_name})` : p.item_name,
        cantidad: 1,
        precio_unitario: p.precio,
        image_url: p.image_url,
      }]
    })
    // Microanimación
    setPulseProducto(p.variant_id)
    setTimeout(() => setPulseProducto(null), 700)
  }

  function cambiarCantidad(variant_id, delta) {
    setCarrito(prev => {
      const idx = prev.findIndex(l => l.variant_id === variant_id)
      if (idx < 0) return prev
      const nuevaCant = prev[idx].cantidad + delta
      if (nuevaCant <= 0) return prev.filter((_, i) => i !== idx)
      const next = [...prev]
      next[idx] = { ...next[idx], cantidad: nuevaCant }
      return next
    })
  }

  async function enviarPedido() {
    setEnviando(true)
    try {
      const r = await fetch('/api/pos/pedidos/kiosko', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: carrito.map(l => ({ variant_id: l.variant_id, cantidad: l.cantidad })),
          receptor: mostrarFactura ? receptor : { nit: 'CF', nombre: 'CONSUMIDOR FINAL' },
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error al enviar pedido')
      setPedidoCreado(j.pedido)
      setPantalla('exito')
    } catch (e) {
      alert('Hubo un problema: ' + (e?.message || 'desconocido') + '\nPasá directo a la caja.')
    } finally {
      setEnviando(false)
    }
  }

  function reiniciar() {
    setCarrito([])
    setCatSel('')
    setPedidoCreado(null)
    setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL' })
    setMostrarFactura(false)
    setPantalla('home')
  }

  return (
    <>
      <Head>
        <title>Julia Bakery — Autoservicio</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700;900&display=swap" rel="stylesheet" />
      </Head>

      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-12px); }
        }
        @keyframes bounce-in {
          0% { transform: scale(0.3); opacity: 0; }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes ping-ring {
          0% { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(2); opacity: 0; }
        }
        @keyframes confetti-fall {
          0% { transform: translateY(-100vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
        .font-display { font-family: 'Playfair Display', Georgia, serif; }
        .text-shimmer {
          background: linear-gradient(90deg, #C8232A 0%, #ff6b6b 50%, #C8232A 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 3s linear infinite;
        }
        .kiosko-bg {
          background:
            radial-gradient(ellipse at top, rgba(254, 215, 170, 0.4) 0%, transparent 50%),
            radial-gradient(ellipse at bottom, rgba(252, 165, 165, 0.2) 0%, transparent 50%),
            linear-gradient(180deg, #fffbeb 0%, #fef3c7 50%, #fed7aa 100%);
        }
      `}</style>

      <div className="min-h-screen kiosko-bg select-none touch-manipulation overflow-x-hidden">
        {pantalla === 'home' && <PantallaHome onStart={() => setPantalla('catalogo')} />}

        {pantalla === 'catalogo' && (
          <PantallaCatalogo
            cargando={cargando}
            categorias={categorias}
            catSel={catSel}
            setCatSel={setCatSel}
            productos={productosFiltrados}
            carrito={carrito}
            totales={totales}
            agregar={agregarAlCarrito}
            cambiarCantidad={cambiarCantidad}
            onContinuar={() => setPantalla('confirmar')}
            onCancelar={reiniciar}
            pulseProducto={pulseProducto}
          />
        )}

        {pantalla === 'confirmar' && (
          <PantallaConfirmar
            carrito={carrito}
            totales={totales}
            receptor={receptor}
            setReceptor={setReceptor}
            mostrarFactura={mostrarFactura}
            setMostrarFactura={setMostrarFactura}
            enviando={enviando}
            onConfirmar={enviarPedido}
            onVolver={() => setPantalla('catalogo')}
          />
        )}

        {pantalla === 'exito' && pedidoCreado && (
          <PantallaExito pedido={pedidoCreado} onReiniciar={reiniciar} />
        )}
      </div>
    </>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// HOME — Hero cinematic
// ═══════════════════════════════════════════════════════════════════════════

function PantallaHome({ onStart }) {
  return (
    <div onClick={onStart}
      className="min-h-screen flex flex-col items-center justify-center cursor-pointer relative px-8 py-12">
      {/* Halos animados de fondo */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-orange-300/30 rounded-full blur-3xl"
          style={{ animation: 'float 6s ease-in-out infinite' }}></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-red-300/30 rounded-full blur-3xl"
          style={{ animation: 'float 6s ease-in-out infinite 3s' }}></div>
      </div>

      <div className="relative text-center z-10 max-w-2xl">
        {/* Logo con halo y pulse rings */}
        <div className="relative mb-10 inline-block">
          <div className="absolute inset-0 rounded-full border-4 border-julia-red/30"
            style={{ animation: 'ping-ring 2s ease-out infinite' }}></div>
          <div className="absolute inset-0 rounded-full border-4 border-julia-red/40"
            style={{ animation: 'ping-ring 2s ease-out infinite 1s' }}></div>
          <div className="relative w-72 h-72 mx-auto rounded-full bg-gradient-to-br from-white to-amber-50 p-8 shadow-2xl"
            style={{ animation: 'float 4s ease-in-out infinite' }}>
            <img src="/logo.png" alt="Julia Bakery" className="w-full h-full object-contain drop-shadow-xl" />
          </div>
        </div>

        {/* Título serif elegante */}
        <h1 className="font-display text-8xl font-black text-shimmer mb-2 leading-none tracking-tight">
          Julia
        </h1>
        <p className="text-2xl text-gray-600 mb-2 tracking-widest uppercase">Bakery</p>
        <div className="w-24 h-1 bg-gradient-to-r from-transparent via-julia-red to-transparent mx-auto mb-8"></div>

        <p className="text-3xl text-gray-700 mb-12 font-light leading-relaxed">
          Buenas, gracias por venir.<br />
          <span className="font-semibold text-gray-900">Ordená en pocos toques.</span>
        </p>

        {/* CTA grande con shimmer */}
        <button
          className="relative px-16 py-7 bg-gradient-to-r from-julia-red via-red-600 to-julia-red bg-[length:200%_100%] hover:bg-[position:100%] text-white text-4xl font-bold rounded-full shadow-2xl active:scale-95 transition-all hover:shadow-julia-red/50"
          style={{ animation: 'shimmer 4s linear infinite' }}>
          <span className="flex items-center gap-4">
            Tocá para empezar
            <span className="text-3xl">→</span>
          </span>
        </button>

        <p className="text-lg text-gray-500 mt-12 italic">
          Después pasás a la caja a pagar
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO
// ═══════════════════════════════════════════════════════════════════════════

function PantallaCatalogo({
  cargando, categorias, catSel, setCatSel, productos, carrito, totales,
  agregar, cambiarCantidad, onContinuar, onCancelar, pulseProducto,
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header sticky con logo y categorías */}
      <div className="sticky top-0 z-30 bg-white/90 backdrop-blur-lg shadow-sm border-b border-amber-100">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="w-12 h-12 rounded-full bg-amber-50 p-1" />
            <div>
              <div className="font-display text-2xl font-bold text-gray-900 leading-tight">Julia Bakery</div>
              <div className="text-sm text-gray-500">Elegí lo que quieras</div>
            </div>
          </div>
          <button onClick={onCancelar}
            className="px-5 py-2.5 text-sm font-bold text-gray-500 hover:text-julia-red bg-gray-100 rounded-full active:scale-95 transition-all">
            ✕ Cancelar
          </button>
        </div>

        {/* Tabs de categoría premium */}
        <div className="px-6 pb-4">
          <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
            <CategoriaTab
              activa={!catSel}
              onClick={() => setCatSel('')}
              icono="🛍️"
              nombre="Todo" />
            {categorias.map(c => (
              <CategoriaTab
                key={c}
                activa={catSel === c}
                onClick={() => setCatSel(c)}
                icono={ICONO_CAT(c)}
                nombre={c} />
            ))}
          </div>
        </div>
      </div>

      {/* Grid productos */}
      <div className="flex-1 px-6 pt-6 pb-80">
        {cargando ? (
          <div className="text-center py-32">
            <div className="inline-block w-16 h-16 border-4 border-julia-red/30 border-t-julia-red rounded-full animate-spin"></div>
            <p className="text-2xl text-gray-500 mt-6">Cargando catálogo…</p>
          </div>
        ) : productos.length === 0 ? (
          <div className="text-center py-32 text-2xl text-gray-400">
            No hay productos en esta categoría
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 max-w-6xl mx-auto">
            {productos.map(p => {
              const enCarrito = carrito.find(l => l.variant_id === p.variant_id)
              const isPulse = pulseProducto === p.variant_id
              return (
                <ProductoCard
                  key={p.variant_id}
                  producto={p}
                  enCarrito={enCarrito}
                  isPulse={isPulse}
                  onClick={() => agregar(p)} />
              )
            })}
          </div>
        )}
      </div>

      {/* Carrito sticky bottom — drawer style */}
      <CarritoDrawer
        carrito={carrito}
        totales={totales}
        cambiarCantidad={cambiarCantidad}
        onContinuar={onContinuar} />
    </div>
  )
}

function CategoriaTab({ activa, onClick, icono, nombre }) {
  return (
    <button
      onClick={onClick}
      className={`flex-shrink-0 px-6 py-3.5 rounded-full font-bold text-lg transition-all active:scale-95 flex items-center gap-2 ${
        activa
          ? 'bg-gradient-to-r from-julia-red to-red-600 text-white shadow-lg shadow-julia-red/30'
          : 'bg-white text-gray-700 border-2 border-amber-100 hover:border-julia-red/30'
      }`}>
      <span className="text-2xl">{icono}</span>
      <span>{nombre}</span>
    </button>
  )
}

function ProductoCard({ producto, enCarrito, isPulse, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`group relative bg-white rounded-3xl shadow-md hover:shadow-2xl overflow-hidden flex flex-col text-left transition-all active:scale-[0.98] ${
        enCarrito ? 'ring-4 ring-julia-red/40' : 'ring-1 ring-amber-100'
      } ${isPulse ? '' : ''}`}
      style={isPulse ? { animation: 'bounce-in 0.6s ease' } : {}}>
      {/* Imagen */}
      <div className="relative aspect-[4/3] bg-gradient-to-br from-amber-50 to-orange-100 overflow-hidden">
        <img
          src={producto.image_url || PLACEHOLDER_IMG}
          alt={producto.item_name}
          onError={(e) => { e.target.src = PLACEHOLDER_IMG }}
          className="w-full h-full object-cover group-active:scale-105 transition-transform duration-500" />
        {/* Gradiente sutil arriba */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/10 to-transparent"></div>
        {/* Badge si en carrito */}
        {enCarrito && (
          <div className="absolute top-3 right-3 w-14 h-14 bg-julia-red text-white rounded-full flex items-center justify-center text-2xl font-bold shadow-xl"
            style={{ animation: 'bounce-in 0.4s ease' }}>
            {enCarrito.cantidad}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-5 flex-1 flex flex-col">
        <h3 className="font-bold text-xl text-gray-900 leading-tight line-clamp-2 min-h-[3rem] mb-1">
          {producto.item_name}
        </h3>
        {producto.variant_name && (
          <p className="text-sm text-gray-500 mb-2">{producto.variant_name}</p>
        )}
        <div className="mt-auto flex items-center justify-between">
          <span className="font-display text-3xl font-bold text-julia-red tabular-nums">
            {fmtQ(producto.precio)}
          </span>
          <div className={`px-4 py-2 rounded-full font-bold text-sm transition-all ${
            enCarrito
              ? 'bg-emerald-50 text-emerald-700 border-2 border-emerald-200'
              : 'bg-julia-red text-white shadow-md'
          }`}>
            {enCarrito ? `✓ ${enCarrito.cantidad}` : '+ Agregar'}
          </div>
        </div>
      </div>
    </button>
  )
}

function CarritoDrawer({ carrito, totales, cambiarCantidad, onContinuar }) {
  const [expandido, setExpandido] = useState(false)
  const tieneItems = carrito.length > 0

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 pointer-events-none">
      <div className={`pointer-events-auto bg-white shadow-[0_-12px_40px_rgba(0,0,0,0.12)] border-t-[3px] border-julia-red rounded-t-3xl transition-all duration-300 ${
        tieneItems ? 'translate-y-0' : 'translate-y-2'
      }`}>
        {/* Handle clickeable para expand/collapse */}
        {tieneItems && (
          <button
            onClick={() => setExpandido(v => !v)}
            className="w-full pt-3 pb-1 flex justify-center group">
            <div className="w-16 h-1.5 bg-gray-300 rounded-full group-hover:bg-julia-red transition-colors"></div>
          </button>
        )}

        {/* Items expandidos */}
        {tieneItems && expandido && (
          <div className="max-h-96 overflow-y-auto px-6 pb-2 border-b border-amber-100"
            style={{ animation: 'bounce-in 0.3s ease' }}>
            {carrito.map(l => (
              <div key={l.variant_id} className="flex items-center gap-4 py-3 border-b border-amber-50 last:border-0">
                <img
                  src={l.image_url || PLACEHOLDER_IMG}
                  alt=""
                  onError={(e) => { e.target.src = PLACEHOLDER_IMG }}
                  className="w-16 h-16 rounded-2xl object-cover bg-amber-50" />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-lg text-gray-900 truncate">{l.descripcion}</div>
                  <div className="text-sm text-gray-500">{fmtQ(l.precio_unitario)} c/u</div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => cambiarCantidad(l.variant_id, -1)}
                    className="w-12 h-12 bg-amber-50 rounded-full text-2xl font-bold text-julia-red active:bg-amber-100 active:scale-95">−</button>
                  <span className="w-10 text-center text-2xl font-bold tabular-nums">{l.cantidad}</span>
                  <button onClick={() => cambiarCantidad(l.variant_id, 1)}
                    className="w-12 h-12 bg-julia-red text-white rounded-full text-2xl font-bold active:bg-red-700 active:scale-95">+</button>
                </div>
                <div className="w-24 text-right text-xl font-bold tabular-nums text-gray-900">
                  {fmtQ(l.cantidad * l.precio_unitario)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer con total + CTA */}
        <div className="px-6 py-5 flex items-center gap-6">
          <div className="flex-1">
            <div className="text-sm text-gray-500 uppercase tracking-wider font-bold mb-1">
              {totales.items === 0 ? 'Empezá a agregar productos' : `${totales.items} ${totales.items === 1 ? 'producto' : 'productos'}`}
            </div>
            <div className="font-display text-5xl font-black text-julia-red tabular-nums leading-none">
              {fmtQ(totales.total)}
            </div>
          </div>
          <button
            onClick={onContinuar}
            disabled={!tieneItems}
            className={`px-10 py-6 text-2xl font-bold rounded-2xl shadow-xl active:scale-95 transition-all flex items-center gap-3 ${
              tieneItems
                ? 'bg-gradient-to-r from-julia-red to-red-600 text-white hover:shadow-julia-red/50'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}>
            Pagar
            <span className="text-2xl">→</span>
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIRMAR
// ═══════════════════════════════════════════════════════════════════════════

function PantallaConfirmar({
  carrito, totales, receptor, setReceptor, mostrarFactura, setMostrarFactura,
  enviando, onConfirmar, onVolver,
}) {
  const [consultando, setConsultando] = useState(false)
  const [nitMsg, setNitMsg] = useState(null)
  const ultimoConsultado = useRef('')

  async function consultarReceptor(valor) {
    const limpio = String(valor || '').replace(/\D/g, '')
    if (!limpio || limpio === ultimoConsultado.current) return
    ultimoConsultado.current = limpio
    setConsultando(true)
    setNitMsg(null)
    try {
      const esDpi = limpio.length === 13
      const url = esDpi
        ? `/api/fel/consultar-cui-kiosko?cui=${encodeURIComponent(limpio)}`
        : `/api/fel/consultar-nit-kiosko?nit=${encodeURIComponent(limpio)}`
      const r = await fetch(url)
      const j = await r.json()
      if (r.ok && j.receptor?.nombre) {
        setReceptor(rec => ({ ...rec, nombre: j.receptor.nombre }))
        if (j.fallecido) setNitMsg('⚠️ La persona figura como fallecida en RENAP')
      } else if (r.ok) {
        setNitMsg(j.mensaje || (esDpi ? 'CUI no encontrado' : 'NIT no encontrado'))
      } else {
        setNitMsg(j.error || 'No se pudo consultar')
      }
    } catch (e) {
      setNitMsg('Sin conexión — ingresá el nombre manual')
    } finally {
      setConsultando(false)
    }
  }

  return (
    <div className="min-h-screen px-6 py-8 max-w-3xl mx-auto">
      <button onClick={onVolver}
        className="mb-6 px-5 py-3 text-lg text-gray-600 font-bold rounded-full bg-white shadow-sm border border-amber-100 flex items-center gap-2 hover:text-julia-red active:scale-95 transition-all">
        ← Seguir agregando
      </button>

      <h2 className="font-display text-5xl font-black text-gray-900 mb-2">Tu orden</h2>
      <p className="text-xl text-gray-600 mb-8">Revisá antes de confirmar</p>

      {/* Card del resumen */}
      <div className="bg-white rounded-3xl shadow-xl overflow-hidden mb-6 border border-amber-100">
        <div className="px-6 py-3 bg-gradient-to-r from-amber-50 to-orange-50 border-b border-amber-100">
          <span className="text-sm font-bold text-gray-600 uppercase tracking-wider">Productos</span>
        </div>
        <div className="px-6 py-3 divide-y divide-amber-50">
          {carrito.map(l => (
            <div key={l.variant_id} className="flex items-center justify-between py-3">
              <div className="flex-1">
                <div className="text-xl font-bold text-gray-900">{l.descripcion}</div>
                <div className="text-base text-gray-500">{l.cantidad} × {fmtQ(l.precio_unitario)}</div>
              </div>
              <div className="font-display text-2xl font-bold tabular-nums text-gray-900">{fmtQ(l.cantidad * l.precio_unitario)}</div>
            </div>
          ))}
        </div>
        <div className="px-6 py-5 bg-gradient-to-r from-julia-red/5 to-red-50 border-t-2 border-julia-red flex items-center justify-between">
          <div className="text-2xl font-bold uppercase tracking-wider text-gray-700">Total</div>
          <div className="font-display text-6xl font-black text-julia-red tabular-nums leading-none">
            {fmtQ(totales.total)}
          </div>
        </div>
      </div>

      {/* Receptor de factura */}
      <div className="bg-white rounded-3xl shadow-xl p-6 mb-8 border border-amber-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="font-display text-2xl font-bold text-gray-900">¿Factura con tu NIT?</div>
            <div className="text-sm text-gray-500 mt-0.5">Opcional — si no, sale como Consumidor Final</div>
          </div>
          <button
            onClick={() => setMostrarFactura(v => !v)}
            className={`px-6 py-3 rounded-2xl text-xl font-bold transition-all active:scale-95 ${
              mostrarFactura
                ? 'bg-julia-red text-white shadow-md'
                : 'bg-amber-50 text-gray-700 border-2 border-amber-200'
            }`}>
            {mostrarFactura ? 'Sí, quiero' : 'No, así está bien'}
          </button>
        </div>
        {mostrarFactura && (
          <div className="space-y-3 mt-4" style={{ animation: 'bounce-in 0.4s ease' }}>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                placeholder="NIT o DPI (13 dígitos)"
                value={receptor.nit === 'CF' ? '' : receptor.nit}
                onChange={e => setReceptor(r => ({ ...r, nit: e.target.value }))}
                onBlur={e => consultarReceptor(e.target.value)}
                className="w-full px-5 py-4 text-2xl border-2 border-amber-100 rounded-2xl focus:outline-none focus:border-julia-red focus:ring-4 focus:ring-julia-red/10 bg-amber-50/50" />
              {consultando && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 w-6 h-6 border-2 border-julia-red/30 border-t-julia-red rounded-full animate-spin"></div>
              )}
            </div>
            {nitMsg && (
              <div className="text-base text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                {nitMsg}
              </div>
            )}
            <input
              type="text"
              placeholder="Nombre completo"
              value={receptor.nombre === 'CONSUMIDOR FINAL' ? '' : receptor.nombre}
              onChange={e => setReceptor(r => ({ ...r, nombre: e.target.value }))}
              className="w-full px-5 py-4 text-2xl border-2 border-amber-100 rounded-2xl focus:outline-none focus:border-julia-red focus:ring-4 focus:ring-julia-red/10 bg-amber-50/50" />
            <p className="text-base text-gray-500 italic">
              Tipeá NIT o DPI y el nombre se autocompleta solo.
            </p>
          </div>
        )}
      </div>

      {/* CTA gigante */}
      <button
        onClick={onConfirmar}
        disabled={enviando}
        className="w-full py-8 bg-gradient-to-r from-julia-red via-red-600 to-julia-red bg-[length:200%_100%] text-white text-4xl font-bold rounded-3xl shadow-2xl active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-4 hover:bg-[position:100%] transition-all"
        style={{ animation: enviando ? '' : 'shimmer 4s linear infinite' }}>
        {enviando ? (
          <>
            <div className="w-8 h-8 border-4 border-white/40 border-t-white rounded-full animate-spin"></div>
            Enviando…
          </>
        ) : (
          <>
            Confirmar y pasar a caja
            <span className="text-3xl">→</span>
          </>
        )}
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// ÉXITO — cinematic
// ═══════════════════════════════════════════════════════════════════════════

function PantallaExito({ pedido, onReiniciar }) {
  useEffect(() => {
    const t = setTimeout(onReiniciar, 30000)
    return () => clearTimeout(t)
  }, [])

  // Confetti emojis
  const confetti = Array.from({ length: 24 }, (_, i) => {
    const emoji = ['🥐', '🍞', '☕', '🎉', '✨', '🍰', '🥖', '🥯'][i % 8]
    const left = (i * 37) % 100
    const delay = (i * 0.2) % 4
    const duration = 4 + ((i * 0.3) % 3)
    return { emoji, left, delay, duration, key: i }
  })

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center relative overflow-hidden">
      {/* Confetti caer */}
      <div className="absolute inset-0 pointer-events-none">
        {confetti.map(c => (
          <div
            key={c.key}
            className="absolute text-4xl"
            style={{
              left: `${c.left}%`,
              animation: `confetti-fall ${c.duration}s linear ${c.delay}s infinite`,
            }}>
            {c.emoji}
          </div>
        ))}
      </div>

      {/* Check verde gigante */}
      <div className="relative mb-8 z-10">
        <div className="absolute inset-0 bg-emerald-300/50 rounded-full blur-3xl scale-150 animate-pulse"></div>
        <div className="absolute inset-0 rounded-full border-4 border-emerald-400/40"
          style={{ animation: 'ping-ring 2s ease-out infinite' }}></div>
        <div className="relative w-56 h-56 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-full flex items-center justify-center shadow-2xl"
          style={{ animation: 'bounce-in 0.8s ease' }}>
          <svg className="w-36 h-36 text-white drop-shadow-lg" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <p className="font-display text-3xl text-gray-600 mb-2 z-10">Tu orden</p>

      <div className="relative z-10 mb-10">
        <div className="absolute inset-0 bg-julia-red/20 blur-3xl scale-110"></div>
        <div className="font-display relative text-[10rem] font-black text-shimmer leading-none drop-shadow-2xl tabular-nums">
          {pedido.referencia.replace('KIOSKO ', '')}
        </div>
      </div>

      {/* Card con total e instrucción */}
      <div className="relative z-10 bg-white rounded-3xl shadow-2xl p-8 mb-8 max-w-2xl border border-amber-100">
        <p className="text-xl text-gray-500 uppercase tracking-widest font-bold mb-1">Pagás en caja</p>
        <div className="font-display text-7xl font-black text-julia-red tabular-nums mb-6 leading-none">
          {fmtQ(pedido.total)}
        </div>
        <div className="border-t border-amber-100 pt-4">
          <p className="text-2xl text-gray-700 leading-relaxed">
            🛎️ Acercate a <span className="font-bold text-julia-red">la caja</span>
            <br />
            y mostrá <span className="font-bold">tu número</span>.
          </p>
        </div>
      </div>

      <button onClick={onReiniciar}
        className="relative z-10 px-10 py-4 bg-white/80 backdrop-blur text-julia-red text-xl font-bold rounded-2xl shadow-lg border-2 border-julia-red active:scale-95 hover:bg-white transition-all">
        Nueva orden
      </button>

      <p className="relative z-10 text-base text-gray-400 mt-6 italic">
        Esta pantalla se cierra en 30 segundos
      </p>
    </div>
  )
}
