// pages/kiosko.js
//
// Kiosko self-service de Julia Bakery — diseñado para Sunmi K2 Mini
// 15.6" en orientación vertical (portrait).
//
// Flujo del cliente:
//   1. Pantalla home — tap to start
//   2. Catálogo — fotos grandes, categorías, agregar al carrito
//   3. Confirmar — resumen + opcional NIT
//   4. Éxito — "Tu orden #042, pasá a caja a pagar Q35.00"
//
// Sin login. Sin turno. Sin pago (Fase 2 viene tarjeta + QR).
// Auto-reset a home después de 90s sin actividad.

import { useEffect, useMemo, useState, useRef } from 'react'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

const fmtQ = (n) =>
  'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PLACEHOLDER_IMG = '/logo.png'

export default function Kiosko() {
  const [pantalla, setPantalla] = useState('home')   // home | catalogo | confirmar | exito
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [categoriasInfo, setCategoriasInfo] = useState({})
  const [cargando, setCargando] = useState(true)
  const [carrito, setCarrito] = useState([])         // [{variant_id, descripcion, cantidad, precio_unitario, image_url}]
  const [catSel, setCatSel] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [pedidoCreado, setPedidoCreado] = useState(null)
  const [receptor, setReceptor] = useState({ nit: 'CF', nombre: 'CONSUMIDOR FINAL' })
  const [mostrarFactura, setMostrarFactura] = useState(false)
  const idleTimerRef = useRef(null)

  // Cargar catálogo
  useEffect(() => {
    Promise.all([
      supabase.from('loyverse_categories').select('loyverse_id, name, image_url').order('name'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, category_id, variants, image_url').is('deleted_at', null),
    ]).then(([{ data: cats }, { data: its }]) => {
      const infoMap = {}
      const nombresPorId = {}
      for (const c of cats || []) {
        infoMap[c.loyverse_id] = { name: c.name, image_url: c.image_url || null }
        nombresPorId[c.loyverse_id] = c.name
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

  // Auto-reset por inactividad (90s)
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

  function quitar(variant_id) {
    setCarrito(prev => prev.filter(l => l.variant_id !== variant_id))
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
      </Head>

      {/* Fondo + container vertical centrado */}
      <div className="min-h-screen bg-gradient-to-b from-amber-50 via-orange-50 to-amber-100 select-none touch-manipulation">
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
            quitar={quitar}
            onContinuar={() => setPantalla('confirmar')}
            onCancelar={reiniciar}
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
// Pantalla HOME — tap to start
// ═══════════════════════════════════════════════════════════════════════════

function PantallaHome({ onStart }) {
  return (
    <div onClick={onStart}
      className="min-h-screen flex flex-col items-center justify-center cursor-pointer">
      <div className="text-center px-8">
        <img src="/logo.png" alt="Julia Bakery"
          className="w-64 h-64 mx-auto mb-8 drop-shadow-2xl rounded-full bg-white p-6 animate-pulse" />
        <h1 className="text-7xl font-bold text-julia-red mb-4 leading-tight">
          Julia Bakery
        </h1>
        <p className="text-3xl text-gray-700 mb-12">
          Ordena en pocos toques
        </p>
        <button className="px-16 py-8 bg-julia-red text-white text-4xl font-bold rounded-3xl shadow-2xl active:scale-95 transition-all">
          Tocá para empezar →
        </button>
        <p className="text-base text-gray-500 mt-12">
          Después pasás a la caja a pagar
        </p>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Pantalla CATÁLOGO — categorías + grid + carrito sticky
// ═══════════════════════════════════════════════════════════════════════════

function PantallaCatalogo({
  cargando, categorias, catSel, setCatSel, productos, carrito, totales,
  agregar, cambiarCantidad, quitar, onContinuar, onCancelar,
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header con categorías */}
      <div className="sticky top-0 bg-white shadow-md z-20 p-4 border-b-2 border-amber-200">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-3xl font-bold text-gray-800">Elegí tus productos</h2>
          <button onClick={onCancelar}
            className="px-4 py-2 text-base font-bold text-gray-500 underline">
            Cancelar
          </button>
        </div>
        {/* Chips de categoría */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          <button
            onClick={() => setCatSel('')}
            className={`flex-shrink-0 px-6 py-3 rounded-full text-xl font-bold transition-all ${
              !catSel
                ? 'bg-julia-red text-white shadow-md'
                : 'bg-gray-100 text-gray-700 border-2 border-gray-200'
            }`}>
            Todos
          </button>
          {categorias.map(c => (
            <button
              key={c}
              onClick={() => setCatSel(c)}
              className={`flex-shrink-0 px-6 py-3 rounded-full text-xl font-bold transition-all ${
                catSel === c
                  ? 'bg-julia-red text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 border-2 border-gray-200'
              }`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de productos */}
      <div className="flex-1 p-4 pb-72">
        {cargando ? (
          <div className="text-center py-32 text-2xl text-gray-400">Cargando productos…</div>
        ) : productos.length === 0 ? (
          <div className="text-center py-32 text-2xl text-gray-400">No hay productos en esta categoría</div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {productos.map(p => {
              const enCarrito = carrito.find(l => l.variant_id === p.variant_id)
              return (
                <button
                  key={p.variant_id}
                  onClick={() => agregar(p)}
                  className={`bg-white rounded-3xl shadow-md p-4 flex flex-col items-center text-center transition-all active:scale-95 ${
                    enCarrito ? 'ring-4 ring-julia-red' : ''
                  }`}>
                  <div className="relative w-full aspect-square mb-2 bg-gray-50 rounded-2xl overflow-hidden">
                    <img
                      src={p.image_url || PLACEHOLDER_IMG}
                      alt={p.item_name}
                      onError={(e) => { e.target.src = PLACEHOLDER_IMG }}
                      className="w-full h-full object-cover" />
                    {enCarrito && (
                      <div className="absolute top-2 right-2 w-12 h-12 bg-julia-red text-white rounded-full flex items-center justify-center text-2xl font-bold shadow-lg">
                        {enCarrito.cantidad}
                      </div>
                    )}
                  </div>
                  <div className="text-xl font-bold text-gray-800 leading-tight mb-1 line-clamp-2 min-h-[3rem]">
                    {p.item_name}
                  </div>
                  {p.variant_name && (
                    <div className="text-base text-gray-500 mb-1">{p.variant_name}</div>
                  )}
                  <div className="text-2xl font-bold text-julia-red tabular-nums">
                    {fmtQ(p.precio)}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Carrito sticky abajo */}
      <div className="fixed bottom-0 left-0 right-0 bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.1)] border-t-4 border-julia-red z-30">
        {carrito.length > 0 && (
          <div className="max-h-48 overflow-y-auto p-3 border-b border-gray-100">
            {carrito.map(l => (
              <div key={l.variant_id} className="flex items-center gap-3 py-2">
                <div className="flex-1 text-lg font-medium truncate">{l.descripcion}</div>
                <div className="flex items-center gap-2">
                  <button onClick={() => cambiarCantidad(l.variant_id, -1)}
                    className="w-12 h-12 bg-gray-100 rounded-full text-2xl font-bold active:bg-gray-200">−</button>
                  <span className="w-10 text-center text-2xl font-bold tabular-nums">{l.cantidad}</span>
                  <button onClick={() => cambiarCantidad(l.variant_id, 1)}
                    className="w-12 h-12 bg-julia-red text-white rounded-full text-2xl font-bold active:bg-red-700">+</button>
                </div>
                <div className="w-24 text-right text-xl font-bold tabular-nums text-gray-800">
                  {fmtQ(l.cantidad * l.precio_unitario)}
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="p-4 flex items-center gap-4">
          <div className="flex-1">
            <div className="text-base text-gray-500 uppercase tracking-wider font-semibold">Total</div>
            <div className="text-5xl font-bold text-julia-red tabular-nums">{fmtQ(totales.total)}</div>
          </div>
          <button
            onClick={onContinuar}
            disabled={carrito.length === 0}
            className="px-12 py-6 bg-julia-red text-white text-3xl font-bold rounded-2xl shadow-lg disabled:opacity-40 disabled:cursor-not-allowed active:scale-95">
            Continuar →
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Pantalla CONFIRMAR — resumen + receptor opcional
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
      // Si tiene 13 dígitos → DPI/CUI (persona natural)
      // Caso contrario → NIT empresarial
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
    <div className="min-h-screen p-6 max-w-3xl mx-auto">
      <button onClick={onVolver}
        className="mb-4 px-4 py-2 text-lg text-gray-600 font-semibold flex items-center gap-2">
        ← Volver a agregar
      </button>

      <h2 className="text-4xl font-bold text-gray-800 mb-6">Confirmá tu orden</h2>

      <div className="bg-white rounded-3xl shadow-lg p-6 mb-6">
        <div className="space-y-3">
          {carrito.map(l => (
            <div key={l.variant_id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
              <div className="flex-1">
                <div className="text-xl font-semibold text-gray-800">{l.descripcion}</div>
                <div className="text-base text-gray-500">{l.cantidad} × {fmtQ(l.precio_unitario)}</div>
              </div>
              <div className="text-xl font-bold tabular-nums">{fmtQ(l.cantidad * l.precio_unitario)}</div>
            </div>
          ))}
        </div>
        <div className="border-t-4 border-julia-red mt-4 pt-4 flex items-center justify-between">
          <div className="text-2xl font-bold uppercase tracking-wider text-gray-600">Total</div>
          <div className="text-5xl font-bold text-julia-red tabular-nums">{fmtQ(totales.total)}</div>
        </div>
      </div>

      {/* Receptor de factura — opcional */}
      <div className="bg-white rounded-3xl shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="text-2xl font-bold text-gray-800">¿Querés factura con tu NIT?</div>
          <button
            onClick={() => setMostrarFactura(v => !v)}
            className={`px-6 py-3 rounded-2xl text-xl font-bold transition-all ${
              mostrarFactura ? 'bg-julia-red text-white' : 'bg-gray-200 text-gray-700'
            }`}>
            {mostrarFactura ? 'Sí' : 'No, CF está bien'}
          </button>
        </div>
        {mostrarFactura && (
          <div className="space-y-3 mt-4">
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                placeholder="NIT o DPI"
                value={receptor.nit === 'CF' ? '' : receptor.nit}
                onChange={e => setReceptor(r => ({ ...r, nit: e.target.value }))}
                onBlur={e => consultarReceptor(e.target.value)}
                className="w-full px-5 py-4 text-2xl border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-julia-red" />
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
              className="w-full px-5 py-4 text-2xl border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-julia-red" />
            <p className="text-base text-gray-500">
              Tipeá tu NIT o DPI (13 dígitos) y el nombre se autocompleta.
              Si no, sale como CONSUMIDOR FINAL.
            </p>
          </div>
        )}
      </div>

      <button
        onClick={onConfirmar}
        disabled={enviando}
        className="w-full py-8 bg-julia-red text-white text-4xl font-bold rounded-3xl shadow-2xl active:scale-95 disabled:opacity-50 flex items-center justify-center gap-4">
        {enviando ? (
          <>
            <div className="w-8 h-8 border-4 border-white/40 border-t-white rounded-full animate-spin"></div>
            Enviando…
          </>
        ) : (
          <>Confirmar y pasar a caja →</>
        )}
      </button>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Pantalla ÉXITO — # de orden + instrucciones
// ═══════════════════════════════════════════════════════════════════════════

function PantallaExito({ pedido, onReiniciar }) {
  // Auto-volver al home después de 30 segundos
  useEffect(() => {
    const t = setTimeout(onReiniciar, 30000)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 text-center">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-emerald-200/50 rounded-full blur-3xl animate-pulse"></div>
        <div className="relative w-48 h-48 bg-emerald-500 rounded-full flex items-center justify-center shadow-2xl">
          <svg className="w-32 h-32 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>

      <p className="text-3xl text-gray-600 mb-2">Tu orden</p>
      <div className="text-9xl font-bold text-julia-red mb-8 tabular-nums leading-none drop-shadow-lg">
        {pedido.referencia}
      </div>

      <div className="bg-white rounded-3xl shadow-2xl p-8 mb-8 max-w-2xl">
        <p className="text-2xl text-gray-700 mb-2">Total a pagar</p>
        <div className="text-7xl font-bold text-gray-900 tabular-nums mb-6">{fmtQ(pedido.total)}</div>
        <p className="text-2xl text-gray-600 leading-relaxed">
          Acercate a <span className="font-bold text-julia-red">la caja</span> y
          mostrá este número.<br />Te entregamos tu pedido y cobramos.
        </p>
      </div>

      <button onClick={onReiniciar}
        className="px-12 py-5 bg-white text-julia-red text-2xl font-bold rounded-2xl shadow-lg border-4 border-julia-red active:scale-95">
        Nueva orden
      </button>

      <p className="text-base text-gray-400 mt-8">
        Auto-vuelve en 30 segundos
      </p>
    </div>
  )
}
