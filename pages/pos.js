// pages/pos.js
// Punto de Venta propio: ventas que NO pasan por Loyverse (mayoreo, catering,
// Pedidos Ya, pedidos especiales). Cada venta emite factura FEL via Infile,
// descuenta inventario PT, y genera asiento contable. Si la certificacion FEL
// falla, la venta NO se completa.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import { useEsKiosko } from '../lib/kiosko'

// Wrapper de layout: en modo kiosko (wrapper Android Sunmi) renderiza un
// header minimo con logo + cajero + logout. En desktop usa el Layout
// completo con sidebar y navegacion a otros modulos.
function POSChrome({ perfil, kiosko, turno, children }) {
  // Admin desktop -> Layout completo con sidebar. (Si admin es cajero, no
  // queremos perder el sidebar.) Solo en kiosko o si rol=cajero mostramos
  // el chrome minimo con cajero/turno + Cerrar caja + Mis turnos.
  const esCajero = perfil?.rol === 'cajero'
  if (!kiosko && !esCajero) return <Layout perfil={perfil}>{children}</Layout>

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-3 py-2 flex items-center justify-between flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo.png" alt="" className="h-8 w-auto flex-shrink-0" />
          <div className="text-sm font-semibold text-gray-900 truncate">
            {perfil?.nombre_completo || 'Cajero'}
          </div>
          {turno && (
            <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded uppercase tracking-wide hidden sm:inline">
              Caja abierta
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {esCajero && (
            <>
              <button onClick={() => window.location.href = '/mis-turnos'}
                className="text-[11px] text-gray-500 hover:text-julia-red px-2 py-1">
                Mis turnos
              </button>
              {turno && (
                <button onClick={() => window.location.href = '/cerrar-caja'}
                  className="text-[11px] bg-amber-100 text-amber-800 hover:bg-amber-200 px-3 py-1.5 rounded-lg font-medium">
                  Cerrar caja
                </button>
              )}
            </>
          )}
          <button
            onClick={async () => {
              await supabase.auth.signOut()
              window.location.href = esCajero ? '/cajero-login' : '/'
            }}
            className="text-[11px] text-gray-400 hover:text-julia-red px-2 py-1">
            Salir
          </button>
        </div>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  )
}

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const fmtQ = (n) => 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Genera un idsale corto (8 hex chars) — sirve para correlacionar la venta
// con la respuesta del Intent NeoPOS, y como UNIQUE en neonet_transacciones
// (previene duplicados por doble-click).
function generarIdsale() {
  const u = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36)
  return u.replace(/-/g, '').slice(0, 12)
}

// Cobra una tarjeta. Default: backend-mediado (Neonet enruta a la P5L).
// Para testing sin P5L: agregar ?mock=1 en la URL del POS.
//
// Devuelve { ok, respuesta_lector, error_message?, origen }.
async function cobrarTarjetaNeonet({ idsale, amountCents }) {
  const usarMock = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('mock') === '1'

  if (usarMock) {
    try {
      const r = await apiFetch('/api/neonet/mock-sale', {
        method: 'POST',
        body: JSON.stringify({ idsale, amount_cents: amountCents }),
      })
      const json = await r.json()
      if (!r.ok || !json.ok) {
        return { ok: false, error_message: json.error_message || json.error || 'Mock rechazo', origen: 'mock' }
      }
      return { ok: true, respuesta_lector: json.respuesta_lector, origen: 'mock' }
    } catch (e) {
      return { ok: false, error_message: e?.message || 'Error llamando al mock', origen: 'mock' }
    }
  }

  // Path real: backend llama authorizationpaymentcommerce -> P5L.
  // Esto puede tardar 30-90s mientras el cajero pasa la tarjeta.
  try {
    const r = await apiFetch('/api/pos/cobrar-tarjeta', {
      method: 'POST',
      body: JSON.stringify({ idsale, amount_cents: amountCents }),
    })
    const json = await r.json()
    if (!r.ok) {
      return { ok: false, error_message: json.error_message || json.error || `Backend HTTP ${r.status}`, origen: 'prod' }
    }
    if (!json.ok) {
      // Cobro rechazado por la red Visanet o por el cajero. El backend ya
      // mapeo a respuesta_lector con response_code != '00'.
      return {
        ok: false,
        error_message: json.error_message || json.respuesta_lector?.response_message || 'Tarjeta rechazada',
        respuesta_lector: json.respuesta_lector,
        origen: 'prod',
      }
    }
    return { ok: true, respuesta_lector: json.respuesta_lector, origen: 'prod' }
  } catch (e) {
    return { ok: false, error_message: e?.message || 'Error de red llamando al backend', origen: 'prod' }
  }
}

const METODOS_PAGO = [
  { id: 'efectivo',      label: 'Efectivo' },
  { id: 'tarjeta',       label: 'Tarjeta' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'pedidos_ya',    label: 'Pedidos Ya' },
  { id: 'otro',          label: 'Otro' },
]

// Extrae variants de loyverse_items + resuelve imagen con fallback a categoria.
// categoriasInfo: { [loyverse_id]: { name, image_url } }
function expandirVariantes(items, categoriasInfo) {
  const out = []
  for (const it of items) {
    const catInfo = categoriasInfo[it.category_id] || { name: '', image_url: null }
    for (const v of (Array.isArray(it.variants) ? it.variants : [])) {
      if (!v?.variant_id) continue
      const stores = Array.isArray(v.stores) ? v.stores : []
      const price = stores[0]?.price ?? v.default_price ?? null
      out.push({
        variant_id: v.variant_id,
        item_id: it.loyverse_id,
        item_name: it.item_name || '?',
        variant_name: v.option1_value || v.option2_value || '',
        sku: v.sku || '',
        precio: price != null ? Number(price) : null,
        // Imagen del producto -> imagen de categoria -> null (fallback iniciales en UI)
        image_url: it.image_url || catInfo.image_url || null,
        categoria: catInfo.name,
      })
    }
  }
  out.sort((a, b) => (a.item_name || '').localeCompare(b.item_name || '', 'es'))
  return out
}

export default function POS({ session }) {
  const router = useRouter()
  const kiosko = useEsKiosko()
  const [perfil, setPerfil] = useState(null)
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [cargandoCat, setCargandoCat] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [catSel, setCatSel] = useState('')
  const [carrito, setCarrito] = useState([])  // [{variant_id, descripcion, cantidad, precio_unitario, descuenta_insumos, receta_id?}]
  const [receptor, setReceptor] = useState({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '' })
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [consultando, setConsultando] = useState(false)
  const [nitMsg, setNitMsg] = useState(null)        // 'NIT no encontrado en RTU' o null
  const [err, setErr] = useState(null)
  const [mostrarCarritoMobile, setMostrarCarritoMobile] = useState(false)
  // Fase de autorización Neonet (cuando metodoPago='tarjeta' y estamos
  // esperando respuesta del bridge / mock). { idsale, monto } o null.
  const [neonetFase, setNeonetFase] = useState(null)
  // Memoria del ultimo NIT consultado para no repetir el call al RTU si el
  // usuario sale del input y vuelve sin cambiar.
  const ultimoNitConsultado = useRef('')
  const debounceTimer = useRef(null)
  const [turno, setTurno] = useState(null)
  const [turnoCargado, setTurnoCargado] = useState(false)

  // Cargar perfil + catálogo + turno (si cajero)
  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, email, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => {
        const p = data || { id: session.user.id, email: session.user.email, rol: 'empleado' }
        setPerfil(p)
        // Si es cajero, chequear turno abierto. Si no hay, mandar a abrir caja.
        if (p.rol === 'cajero') {
          apiFetch('/api/turnos/actual').then(r => r.json()).then(j => {
            if (!j.turno) {
              router.replace('/abrir-caja')
            } else {
              setTurno(j.turno)
              setTurnoCargado(true)
            }
          })
        } else {
          setTurnoCargado(true)
        }
      })
    Promise.all([
      supabase.from('loyverse_categories').select('loyverse_id, name, image_url'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, category_id, variants, image_url').is('deleted_at', null),
    ]).then(([{ data: cats }, { data: its }]) => {
      // categoriasInfo: id -> { name, image_url } para resolver fallback de imagen
      const categoriasInfo = {}
      const nombresPorId = {}
      for (const c of cats || []) {
        categoriasInfo[c.loyverse_id] = { name: c.name, image_url: c.image_url || null }
        nombresPorId[c.loyverse_id] = c.name
      }
      setCategorias(nombresPorId)  // mantiene compat con el filtro de categorías
      setProductos(expandirVariantes(its || [], categoriasInfo))
      setCargandoCat(false)
    })
  }, [session])

  const esAdmin = perfil?.rol === 'admin'
  const esCajero = perfil?.rol === 'cajero'

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return productos.filter(p => {
      if (catSel && p.categoria !== catSel) return false
      if (!q) return true
      return (p.item_name || '').toLowerCase().includes(q) || (p.variant_name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)
    }).slice(0, 200)  // limit para no laguear con miles
  }, [productos, busqueda, catSel])

  const categoriasUnicas = useMemo(() => {
    const s = new Set(productos.map(p => p.categoria).filter(Boolean))
    return Array.from(s).sort()
  }, [productos])

  const totales = useMemo(() => {
    const total = carrito.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario), 0)
    const gravable = total / 1.12
    const iva = total - gravable
    return {
      total: Math.round(total * 100) / 100,
      gravable: Math.round(gravable * 100) / 100,
      iva: Math.round(iva * 100) / 100,
    }
  }, [carrito])

  function agregarProducto(p) {
    setCarrito(prev => {
      const idx = prev.findIndex(l => l.variant_id === p.variant_id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + 1 }
        return next
      }
      return [...prev, {
        variant_id: p.variant_id,
        descripcion: p.item_name + (p.variant_name ? ` (${p.variant_name})` : ''),
        cantidad: 1,
        precio_unitario: p.precio || 0,
        descuenta_insumos: false,
      }]
    })
  }

  function setLinea(i, patch) {
    setCarrito(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function quitarLinea(i) {
    setCarrito(prev => prev.filter((_, idx) => idx !== i))
  }

  // Sanea el NIT: quita guiones/espacios/letras minúsculas; SAT acepta sufijo
  // "K" en mayúscula (digito verificador).
  function normalizarNit(s) {
    return String(s || '').replace(/[^0-9Kk]/g, '').toUpperCase()
  }

  async function consultarNit(nitArg) {
    const nit = normalizarNit(nitArg ?? receptor.nit)
    if (!nit || nit === 'CF') return
    if (nit === ultimoNitConsultado.current) return  // ya consultado, no repetir
    setConsultando(true); setNitMsg(null)
    ultimoNitConsultado.current = nit
    try {
      const r = await apiFetch(`/api/fel/consultar-nit?nit=${encodeURIComponent(nit)}`)
      const j = await r.json()
      if (r.ok && j.receptor?.nombre) {
        setReceptor(rec => ({ ...rec, nombre: j.receptor.nombre }))
        setNitMsg(null)
      } else if (r.ok) {
        // Endpoint OK pero NIT no figura en RTU. Dejamos el nombre editable.
        setNitMsg(j.mensaje || 'NIT no encontrado en RTU — ingresá el nombre manualmente')
      } else {
        // Error en endpoint o en Infile — NO bloquea la venta.
        setNitMsg(j.error || 'No se pudo consultar el RTU — ingresá el nombre manualmente')
      }
    } catch (e) {
      setNitMsg('Sin conexión al RTU — ingresá el nombre manualmente')
    } finally {
      setConsultando(false)
    }
  }

  // Debounce automático: consulta 600 ms despues de que el usuario dejo de
  // tipear, si el NIT cambio. Si pierde foco (onBlur del input) se gatilla
  // inmediato. Validacion: 5+ caracteres tras normalizar.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    const nit = normalizarNit(receptor.nit)
    if (!nit || nit === 'CF' || nit.length < 5) return
    if (nit === ultimoNitConsultado.current) return
    debounceTimer.current = setTimeout(() => {
      consultarNit(nit)
    }, 600)
    return () => debounceTimer.current && clearTimeout(debounceTimer.current)
  }, [receptor.nit])

  function setNitMode(esCF) {
    ultimoNitConsultado.current = ''   // resetear memo al cambiar de modo
    setNitMsg(null)
    if (esCF) setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '' })
    else setReceptor(r => ({ ...r, nit: '', nombre: '' }))
  }

  async function cobrar() {
    setErr(null)
    if (carrito.length === 0) { setErr('Carrito vacío'); return }
    if (receptor.nit !== 'CF' && !receptor.nombre.trim()) { setErr('Nombre del receptor requerido (o usá CF)'); return }
    setEnviando(true)

    // Si es tarjeta, primero autorizar con Neonet (bridge Sunmi en prod, mock en desktop).
    // Si rechaza, abortar antes de tocar el FEL.
    let neonet_resultado = null
    if (metodoPago === 'tarjeta') {
      const amountCents = Math.round(totales.total * 100)
      if (amountCents <= 0) {
        setEnviando(false); setErr('Monto inválido para tarjeta')
        return
      }
      const idsale = generarIdsale()
      setNeonetFase({ idsale, monto: totales.total })
      try {
        const r = await cobrarTarjetaNeonet({ idsale, amountCents })
        setNeonetFase(null)
        if (!r.ok) {
          setEnviando(false)
          setErr(`Cobro con tarjeta no autorizado: ${r.error_message || 'sin detalle'}`)
          return
        }
        // Si el tarjetahabiente tiene NIT en RTU y el receptor sigue siendo CF,
        // ofrecer usarlo (el usuario confirma — no auto-cambia para evitar fraude).
        const sugerido = r.respuesta_lector.suggested_nit
        if (sugerido && receptor.nit === 'CF') {
          if (confirm(`La tarjeta tiene NIT ${sugerido} registrado. ¿Facturar a ese NIT en vez de Consumidor Final?`)) {
            setReceptor(rec => ({ ...rec, nit: sugerido, nombre: '' }))
            // Disparamos consulta de RTU para autocompletar nombre. Como es
            // sincrono no podemos esperar acá; el usuario verá la sugerencia
            // de nombre cuando el endpoint responda. Igual avanzamos con el flow.
            consultarNit(sugerido)
          }
        }
        neonet_resultado = {
          idsale,
          amount_cents: amountCents,
          respuesta_lector: r.respuesta_lector,
          origen: r.origen,
        }
      } catch (e) {
        setNeonetFase(null)
        setEnviando(false)
        setErr(`Error al autorizar tarjeta: ${e?.message || e}`)
        return
      }
    }

    const body = {
      items: carrito.map(l => ({
        variant_id: l.variant_id,
        descripcion: l.descripcion,
        cantidad: Number(l.cantidad),
        precio_unitario: Number(l.precio_unitario),
        descuenta_insumos: l.descuenta_insumos,
        receta_id: l.receta_id || null,
        unidad_medida: 'UND',
      })),
      receptor,
      metodo_pago: metodoPago,
      ...(neonet_resultado ? { neonet_resultado } : {}),
    }
    const res = await apiFetch('/api/pos/ventas', { method: 'POST', body: JSON.stringify(body) })
    const json = await res.json()
    setEnviando(false)
    if (!res.ok) {
      setErr(`[${json.etapa || 'error'}] ${json.error || 'Falla'}`)
      setResultado({ error: true, ...json })
      return
    }
    setResultado(json)

    // Imprimir ticket cliente en la termica del Sunmi (si esta el bridge nativo).
    // Best-effort: si falla, la venta sigue OK; el cajero puede re-imprimir
    // manual mas tarde.
    try {
      if (typeof window !== 'undefined' && window.JuliaPOS && window.JuliaPOS.printTicket) {
        const f = json.factura
        const payload = {
          merchantName: 'Julia Bakery',
          merchantSubtitle: 'Panaderia',
          merchantAddress: 'Guatemala City',
          merchantNit: null,  // TODO: traer de /api/fel/config en v0.3
          receptorNit: f.receptor_nit,
          receptorNombre: f.receptor_nombre,
          fecha: new Date(f.fecha_certificacion || Date.now()).toLocaleString('es-GT'),
          cajeroNombre: perfil?.nombre_completo || null,
          metodoPago: f.metodo_pago || null,
          items: carrito.map(l => ({
            descripcion: l.descripcion,
            cantidad: String(l.cantidad),
            precioUnitario: Number(l.precio_unitario),
            subtotal: Math.round(Number(l.cantidad) * Number(l.precio_unitario) * 100) / 100,
          })),
          totalGravado: Number(f.total) / 1.12,
          iva: Number(f.iva),
          total: Number(f.total),
          uuidSat: f.uuid_sat,
          serieSat: f.serie_sat,
          numeroSat: f.numero_sat,
          certificador: 'Infile',
        }
        const r = await window.JuliaPOS.printTicket(payload)
        console.log('[POS] printTicket result:', r)
      }
    } catch (e) {
      console.warn('[POS] printTicket fallo (no crashea venta):', e?.message || e)
    }
  }

  function nuevaVenta() {
    setCarrito([])
    setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '' })
    setMetodoPago('efectivo')
    setResultado(null)
    setErr(null)
    setMostrarCarritoMobile(false)
  }

  // Cantidades por variant_id en el carrito — para mostrar badge en cards.
  // OJO: este hook DEBE estar antes de cualquier early return; si quedaba
  // despues, React tiraba "Rendered fewer hooks than expected" (error #300).
  const carritoPorVariant = useMemo(() => {
    const m = new Map()
    for (const l of carrito) {
      if (l.variant_id) m.set(l.variant_id, (m.get(l.variant_id) || 0) + Number(l.cantidad))
    }
    return m
  }, [carrito])

  if (perfil && !esAdmin && !esCajero) {
    return (
      <POSChrome perfil={perfil} kiosko={kiosko} turno={turno}>
        <Head><title>POS · Julia Bakery</title></Head>
        <div className="p-8 text-center text-sm text-gray-500">
          Solo administradores o cajeros pueden emitir facturas desde el POS.
        </div>
      </POSChrome>
    )
  }

  // Cajero sin turno cargado todavia (esperando redirect a /abrir-caja)
  if (esCajero && !turnoCargado) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-400">
        Verificando turno...
      </div>
    )
  }

  return (
    <POSChrome perfil={perfil} kiosko={kiosko} turno={turno}>
      <Head><title>Punto de Venta · Julia Bakery</title></Head>

      {/* Overlay mientras se esta autorizando la tarjeta con NeoPOS */}
      {neonetFase && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-5 border-4 border-julia-cream border-t-julia-red rounded-full animate-spin"></div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Procesando tarjeta</h2>
            <p className="text-4xl font-bold text-julia-red tabular-nums my-4">{fmtQ(neonetFase.monto)}</p>
            <p className="text-sm text-gray-500">
              {typeof window !== 'undefined' && window.JuliaPOS
                ? 'Insertá o acercá la tarjeta al lector y seguí las instrucciones del PIN pad.'
                : '⚙ Modo desarrollo (mock) — no hay dispositivo real conectado.'}
            </p>
            <p className="text-[10px] text-gray-300 mt-4 font-mono">idsale {neonetFase.idsale}</p>
          </div>
        </div>
      )}

      {/* Resultado de venta exitosa: pantalla completa con detalle */}
      {resultado && resultado.ok && (
        <PantallaExito resultado={resultado} onNueva={nuevaVenta} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-0 min-h-[calc(100vh-3.5rem)] bg-gray-50">

        {/* ============================================================
            COLUMNA IZQUIERDA — Catálogo de productos
           ============================================================ */}
        <div className="flex flex-col min-h-0">
          {/* Header sticky con búsqueda + filtros + título */}
          <div className="bg-white border-b border-gray-100 px-5 md:px-8 pt-5 pb-4 sticky top-0 z-20">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Punto de venta</h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  Cada cobro emite factura FEL e impacta inventario
                </p>
              </div>
              <div className="text-right hidden sm:block">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Total venta</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">{fmtQ(totales.total)}</div>
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                </svg>
                <input
                  type="text" placeholder="Buscar producto, SKU o variante..."
                  value={busqueda} onChange={e => setBusqueda(e.target.value)}
                  className="w-full pl-10 pr-3 py-3 text-base border border-gray-200 rounded-xl focus:outline-none focus:border-julia-red focus:ring-2 focus:ring-julia-red/10 transition-all"
                  autoFocus />
              </div>
              <select value={catSel} onChange={e => setCatSel(e.target.value)}
                className="text-sm border border-gray-200 rounded-xl px-3 py-3 bg-white focus:outline-none focus:border-julia-red min-w-[160px]">
                <option value="">Todas las categorías</option>
                {categoriasUnicas.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            {/* Pills de categorías para filtro rápido */}
            {!cargandoCat && categoriasUnicas.length > 0 && (
              <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
                <button onClick={() => setCatSel('')}
                  className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    catSel === ''
                      ? 'bg-julia-red text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  Todas
                </button>
                {categoriasUnicas.map(c => (
                  <button key={c} onClick={() => setCatSel(c)}
                    className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                      catSel === c
                        ? 'bg-julia-red text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Grid de productos */}
          <div className="flex-1 overflow-y-auto px-5 md:px-8 py-5">
            {cargandoCat ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="bg-white border border-gray-100 rounded-2xl overflow-hidden animate-pulse">
                    <div className="aspect-square bg-gray-100" />
                    <div className="p-3 space-y-2">
                      <div className="h-3 bg-gray-100 rounded w-3/4" />
                      <div className="h-5 bg-gray-100 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : productosFiltrados.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <div className="text-6xl mb-3">🥖</div>
                <div className="text-base font-medium text-gray-600">
                  {productos.length === 0 ? 'Sin productos sincronizados desde Loyverse' : 'Sin resultados para tu búsqueda'}
                </div>
                <div className="text-xs mt-1">
                  {productos.length === 0 ? 'El cron de Loyverse corre cada 15 minutos' : 'Probá con otro término o categoría'}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {productosFiltrados.map(p => {
                  const cantEnCarrito = carritoPorVariant.get(p.variant_id) || 0
                  return (
                    <button
                      key={p.variant_id}
                      onClick={() => agregarProducto(p)}
                      className={`group relative text-left bg-white border-2 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all active:scale-[0.98] ${
                        cantEnCarrito > 0 ? 'border-julia-red/40 ring-2 ring-julia-red/10' : 'border-gray-100 hover:border-julia-red/30'
                      }`}>
                      {/* Imagen / placeholder */}
                      <div className="aspect-square bg-gray-50 overflow-hidden relative">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt={p.item_name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => { e.target.style.display = 'none' }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-julia-cream/40 to-julia-cream/10">
                            <span className="text-4xl font-bold text-julia-red/30 tracking-tight">
                              {(p.item_name || '?').slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                        )}
                        {/* Badge con cantidad en carrito */}
                        {cantEnCarrito > 0 && (
                          <div className="absolute top-2 right-2 bg-julia-red text-white text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center shadow-lg">
                            {cantEnCarrito}
                          </div>
                        )}
                        {/* Categoría pill */}
                        {p.categoria && (
                          <div className="absolute top-2 left-2 bg-white/95 backdrop-blur-sm text-gray-600 text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide">
                            {p.categoria}
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-3">
                        <div className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 min-h-[2.5rem]">
                          {p.item_name}
                        </div>
                        {p.variant_name && (
                          <div className="text-[11px] text-gray-500 mt-1 truncate">{p.variant_name}</div>
                        )}
                        <div className="text-lg font-bold text-julia-red mt-2 tabular-nums">
                          {p.precio != null ? fmtQ(p.precio) : '—'}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ============================================================
            COLUMNA DERECHA — Carrito + checkout
           ============================================================ */}
        <div className={`bg-white border-t-2 lg:border-t-0 lg:border-l border-gray-100 flex flex-col ${mostrarCarritoMobile ? 'fixed inset-0 z-40 lg:static' : 'hidden lg:flex'}`}>
          {/* Header */}
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
            <div>
              <h2 className="text-base font-bold text-gray-900">Venta actual</h2>
              <p className="text-xs text-gray-400">
                {carrito.length === 0 ? 'Sin productos aún' : `${carrito.length} ${carrito.length === 1 ? 'línea' : 'líneas'}`}
              </p>
            </div>
            {carrito.length > 0 && (
              <button onClick={() => setCarrito([])}
                className="text-xs text-gray-400 hover:text-red-500 transition-colors">
                Vaciar
              </button>
            )}
            <button onClick={() => setMostrarCarritoMobile(false)} className="lg:hidden text-gray-400 hover:text-gray-700 text-2xl ml-2">✕</button>
          </div>

          {/* Líneas */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {carrito.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-5xl mb-3 opacity-50">🛒</div>
                <div className="text-sm font-medium text-gray-500">El carrito está vacío</div>
                <div className="text-xs mt-1">Tocá un producto para agregarlo</div>
              </div>
            ) : carrito.map((l, i) => (
              <div key={i} className="bg-gray-50 border border-gray-100 rounded-xl p-3 hover:border-gray-200 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 leading-tight line-clamp-2">{l.descripcion}</div>
                  </div>
                  <button onClick={() => quitarLinea(i)}
                    className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors w-6 h-6 flex items-center justify-center">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {/* Cantidad con +/- */}
                  <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setLinea(i, { cantidad: Math.max(0, Number(l.cantidad) - 1) })}
                      className="w-8 h-8 text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors font-medium">
                      −
                    </button>
                    <input type="number" step="any" min="0" value={l.cantidad}
                      onChange={e => setLinea(i, { cantidad: Number(e.target.value) || 0 })}
                      className="w-12 text-center text-sm tabular-nums focus:outline-none border-x border-gray-200" />
                    <button
                      onClick={() => setLinea(i, { cantidad: Number(l.cantidad) + 1 })}
                      className="w-8 h-8 text-gray-500 hover:bg-gray-100 active:bg-gray-200 transition-colors font-medium">
                      +
                    </button>
                  </div>
                  <span className="text-xs text-gray-400">×</span>
                  <input type="number" step="any" min="0" value={l.precio_unitario}
                    onChange={e => setLinea(i, { precio_unitario: Number(e.target.value) || 0 })}
                    className="flex-1 text-right text-sm px-2 py-1.5 bg-white border border-gray-200 rounded-lg tabular-nums focus:outline-none focus:border-julia-red" />
                  <span className="text-sm font-bold text-gray-900 tabular-nums min-w-[80px] text-right">
                    {fmtQ(Number(l.cantidad) * Number(l.precio_unitario))}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Totales */}
          <div className="border-t border-gray-100 px-5 py-4 bg-gradient-to-b from-gray-50/50 to-white space-y-1.5">
            <div className="flex justify-between text-sm text-gray-500">
              <span>Subtotal (sin IVA)</span><span className="tabular-nums">{fmtQ(totales.gravable)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-500">
              <span>IVA 12%</span><span className="tabular-nums">{fmtQ(totales.iva)}</span>
            </div>
            <div className="flex justify-between text-2xl font-bold text-gray-900 pt-3 mt-2 border-t-2 border-gray-200">
              <span>Total</span><span className="tabular-nums text-julia-red">{fmtQ(totales.total)}</span>
            </div>
          </div>

          {/* Receptor */}
          <div className="px-5 py-4 border-t border-gray-100 space-y-2.5">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold">Receptor</div>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
              <button onClick={() => setNitMode(true)}
                className={`flex-1 text-sm py-2 rounded-lg font-medium transition-colors ${
                  receptor.nit === 'CF' ? 'bg-white shadow-sm text-julia-red' : 'text-gray-500'
                }`}>
                Consumidor final
              </button>
              <button onClick={() => setNitMode(false)}
                className={`flex-1 text-sm py-2 rounded-lg font-medium transition-colors ${
                  receptor.nit !== 'CF' ? 'bg-white shadow-sm text-julia-red' : 'text-gray-500'
                }`}>
                Con NIT
              </button>
            </div>
            {receptor.nit !== 'CF' && (
              <div className="space-y-2">
                <div className="relative">
                  <input type="text" placeholder="NIT (sin guiones)" value={receptor.nit}
                    onChange={e => setReceptor(r => ({ ...r, nit: e.target.value }))}
                    onBlur={() => consultarNit(receptor.nit)}
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red pr-10"
                    inputMode="text" autoComplete="off" />
                  {consultando ? (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-gray-200 border-t-julia-red rounded-full animate-spin" title="Consultando RTU…" />
                  ) : (
                    receptor.nit && ultimoNitConsultado.current === normalizarNit(receptor.nit) && receptor.nombre && !nitMsg && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600" title="NIT confirmado en RTU">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )
                  )}
                </div>
                <input type="text" placeholder="Nombre receptor" value={receptor.nombre}
                  onChange={e => setReceptor(r => ({ ...r, nombre: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red" />
                <input type="email" placeholder="Email (opcional)" value={receptor.email}
                  onChange={e => setReceptor(r => ({ ...r, email: e.target.value }))}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red" />
                {nitMsg && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                    {nitMsg}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Método de pago */}
          <div className="px-5 py-4 border-t border-gray-100">
            <div className="text-[11px] uppercase tracking-wider text-gray-500 font-bold mb-2.5">Método de pago</div>
            <div className="grid grid-cols-2 gap-2">
              {METODOS_PAGO.map(m => (
                <button key={m.id} onClick={() => setMetodoPago(m.id)}
                  className={`text-sm py-3 rounded-xl font-medium transition-all ${
                    metodoPago === m.id
                      ? 'bg-julia-red text-white shadow-md ring-2 ring-julia-red/20'
                      : 'border border-gray-200 text-gray-700 hover:border-julia-red/40 bg-white'
                  }`}>{m.label}</button>
              ))}
            </div>
          </div>

          {err && (
            <div className="px-5 pb-2">
              <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 text-sm text-red-700 flex items-start gap-2">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{err}</span>
              </div>
            </div>
          )}

          {/* Botón cobrar */}
          <div className="px-5 py-4 border-t border-gray-100 bg-white">
            <button onClick={cobrar} disabled={enviando || carrito.length === 0}
              className="w-full py-4 bg-julia-red text-white text-base font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 active:scale-[0.98] transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2">
              {enviando ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Procesando...</span>
                </>
              ) : (
                <>
                  <span>Cobrar</span>
                  <span className="tabular-nums">{fmtQ(totales.total)}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* FAB para abrir carrito en mobile */}
      {!mostrarCarritoMobile && carrito.length > 0 && (
        <button onClick={() => setMostrarCarritoMobile(true)}
          className="lg:hidden fixed bottom-6 right-6 z-30 bg-julia-red text-white rounded-2xl px-5 py-3.5 shadow-2xl flex items-center gap-3 font-medium active:scale-95 transition-transform">
          <div className="relative">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span className="absolute -top-2 -right-2 bg-white text-julia-red text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {carrito.length}
            </span>
          </div>
          <span className="tabular-nums font-bold">{fmtQ(totales.total)}</span>
        </button>
      )}
    </POSChrome>
  )
}

function PantallaExito({ resultado, onNueva }) {
  const f = resultado.factura
  const comandaCreada = resultado.comanda?.ok && resultado.comanda?.comanda
  const [verDetalles, setVerDetalles] = useState(false)
  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-gray-50 to-white overflow-y-auto">
      <div className="min-h-full flex flex-col items-center justify-start px-4 py-5">
        {/* Check verde */}
        <div className="relative mb-2">
          <div className="absolute inset-0 bg-emerald-200/40 rounded-full blur-xl"></div>
          <div className="relative w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        <h2 className="text-base font-bold text-gray-900">Venta certificada</h2>

        {/* Total */}
        <div className="text-3xl font-bold text-julia-red tabular-nums my-2">
          {'Q ' + Number(f.total).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
        </div>

        {/* BOTÓN PROMINENTE arriba — siempre visible */}
        <button onClick={onNueva}
          className="w-full max-w-sm block px-8 py-4 mt-2 bg-julia-red text-white text-base font-bold rounded-2xl hover:bg-red-700 active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nueva venta
        </button>

        {/* Status chips compactos */}
        <div className="flex flex-wrap gap-1.5 mt-4 max-w-sm justify-center">
          <StatusChip
            ok={resultado.descuento?.pt?.ok}
            label="Inventario"
            detail={resultado.descuento?.pt?.ok ? '✓' : '⚠'} />
          <StatusChip
            ok={resultado.asiento?.ok}
            label="Asiento"
            detail={resultado.asiento?.ok ? `#${resultado.asiento.numero}` : '⚠'} />
          {comandaCreada && <StatusChip ok={true} label="Barra" detail="enviada" />}
        </div>

        {/* Toggle ver detalles — colapsable */}
        <button
          onClick={() => setVerDetalles(v => !v)}
          className="mt-4 text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">
          {verDetalles ? '▴ Ocultar detalles' : '▾ Ver detalles SAT, NIT, voucher'}
        </button>

        {verDetalles && (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-4 max-w-sm w-full space-y-2 mt-2 mb-4">
            <Row k="Receptor" v={`${f.receptor_nit} — ${f.receptor_nombre}`} />
            <Row k="Pago" v={<span className="capitalize">{f.metodo_pago}</span>} />
            {resultado.neonet && (
              <>
                <div className="border-t border-gray-100 my-1.5"></div>
                <Row k="Tarjeta" v={<span className="font-mono text-xs">{resultado.neonet.pan_masked || '—'}</span>} />
                <Row k="Autoriz." v={<span className="font-mono text-xs">{resultado.neonet.authorization_code || '—'}</span>} />
                {resultado.neonet.origen !== 'prod' && (
                  <Row k="" v={<span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">{resultado.neonet.origen}</span>} />
                )}
              </>
            )}
            <div className="border-t border-gray-100 my-1.5"></div>
            <Row k="UUID SAT" v={<span className="font-mono text-[9px] break-all">{f.uuid_sat}</span>} />
            <Row k="Serie/Núm" v={<span className="font-mono text-xs">{f.serie_sat || '—'} / {f.numero_sat || '—'}</span>} />
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-xs uppercase tracking-wider text-gray-400 font-medium flex-shrink-0">{k}</span>
      <span className="text-sm text-gray-800 text-right break-words">{v}</span>
    </div>
  )
}

function StatusChip({ ok, label, detail }) {
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${
      ok
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-amber-50 border-amber-200 text-amber-700'
    }`}>
      <span className="text-xs">{ok ? '✓' : '⚠'}</span>
      <span className="text-xs font-medium">{label}:</span>
      <span className="text-xs">{detail}</span>
    </div>
  )
}
