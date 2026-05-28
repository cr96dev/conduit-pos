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

// Extrae { variant_id, item_name, variant_name, sku, price } de loyverse_items.
function expandirVariantes(items, categorias) {
  const out = []
  for (const it of items) {
    const cat = categorias[it.category_id] || ''
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
        image_url: it.image_url || null,
        categoria: cat,
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
      supabase.from('loyverse_categories').select('loyverse_id, name'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, category_id, variants, image_url').is('deleted_at', null),
    ]).then(([{ data: cats }, { data: its }]) => {
      const mapCat = {}
      for (const c of cats || []) mapCat[c.loyverse_id] = c.name
      setCategorias(mapCat)
      setProductos(expandirVariantes(its || [], mapCat))
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
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 text-center">
            <div className="w-12 h-12 mx-auto mb-4 border-4 border-julia-cream border-t-julia-red rounded-full animate-spin"></div>
            <h2 className="text-base font-semibold text-gray-900 mb-1">Procesando tarjeta</h2>
            <p className="text-2xl font-bold text-julia-red tabular-nums my-3">{fmtQ(neonetFase.monto)}</p>
            <p className="text-xs text-gray-500">
              {typeof window !== 'undefined' && window.JuliaPOS
                ? 'Insertá / acercá la tarjeta al lector y seguí las instrucciones del PIN pad.'
                : '⚙ Modo desarrollo (mock) — no hay dispositivo real conectado.'}
            </p>
            <p className="text-[10px] text-gray-300 mt-3 font-mono">idsale {neonetFase.idsale}</p>
          </div>
        </div>
      )}

      {/* Resultado de venta exitosa: pantalla completa con detalle */}
      {resultado && resultado.ok && (
        <PantallaExito resultado={resultado} onNueva={nuevaVenta} />
      )}

      <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-0 min-h-[calc(100vh-3rem)]">
        {/* COLUMNA IZQUIERDA: productos */}
        <div className="p-4 md:p-6 border-r border-gray-100">
          <div className="flex flex-col gap-2 mb-3">
            <h1 className="text-xl font-semibold text-gray-900">Punto de Venta</h1>
            <p className="text-xs text-gray-500">
              Ventas que no pasan por Loyverse. Cada cobro emite factura FEL e impacta inventario.
            </p>
          </div>

          <div className="flex gap-2 mb-3 flex-wrap">
            <input
              type="text" placeholder="Buscar producto..."
              value={busqueda} onChange={e => setBusqueda(e.target.value)}
              className="input flex-1 min-w-[180px]" autoFocus />
            <select value={catSel} onChange={e => setCatSel(e.target.value)} className="input max-w-[180px]">
              <option value="">Todas las categorías</option>
              {categoriasUnicas.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {cargandoCat ? (
            <div className="space-y-2"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
          ) : productosFiltrados.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-8">
              {productos.length === 0 ? 'No hay productos sincronizados desde Loyverse.' : 'Sin resultados.'}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {productosFiltrados.map(p => (
                <button
                  key={p.variant_id}
                  onClick={() => agregarProducto(p)}
                  className="text-left p-3 border border-gray-100 rounded-xl bg-white hover:border-julia-red hover:bg-julia-cream/30 transition-colors group">
                  <div className="text-sm font-medium text-gray-900 leading-tight line-clamp-2">{p.item_name}</div>
                  {p.variant_name && <div className="text-[10px] text-gray-400 mt-0.5">{p.variant_name}</div>}
                  <div className="text-julia-red font-semibold mt-1.5 tabular-nums">{p.precio != null ? fmtQ(p.precio) : '—'}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* COLUMNA DERECHA: carrito (desktop fijo, mobile drawer abajo) */}
        <div className={`bg-white border-t md:border-t-0 md:border-l border-gray-100 flex flex-col ${mostrarCarritoMobile ? 'fixed inset-0 z-40 md:static' : 'hidden md:flex'}`}>
          {/* Header carrito */}
          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-gray-900">Venta actual</div>
              <div className="text-[11px] text-gray-400">{carrito.length} {carrito.length === 1 ? 'línea' : 'líneas'}</div>
            </div>
            <button onClick={() => setMostrarCarritoMobile(false)} className="md:hidden text-gray-400 hover:text-gray-700 text-xl">✕</button>
          </div>

          {/* Líneas */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {carrito.length === 0 ? (
              <div className="text-center text-xs text-gray-400 py-8">Agregá productos del catálogo</div>
            ) : carrito.map((l, i) => (
              <div key={i} className="border border-gray-100 rounded-lg p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-800 leading-tight line-clamp-2">{l.descripcion}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{l.variant_id?.slice(0, 8)}</div>
                  </div>
                  <button onClick={() => quitarLinea(i)} className="text-gray-300 hover:text-red-500 text-sm">✕</button>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <input type="number" step="any" min="0" value={l.cantidad} onChange={e => setLinea(i, { cantidad: Number(e.target.value) || 0 })}
                    className="w-16 text-center text-sm px-1 py-1 border border-gray-200 rounded tabular-nums" />
                  <span className="text-gray-400 text-xs">×</span>
                  <input type="number" step="any" min="0" value={l.precio_unitario} onChange={e => setLinea(i, { precio_unitario: Number(e.target.value) || 0 })}
                    className="flex-1 text-right text-sm px-2 py-1 border border-gray-200 rounded tabular-nums" />
                  <span className="text-sm font-medium text-gray-800 tabular-nums w-20 text-right">
                    {fmtQ(Number(l.cantidad) * Number(l.precio_unitario))}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Totales */}
          <div className="border-t border-gray-100 p-4 bg-gray-50/40 space-y-2">
            <div className="flex justify-between text-xs text-gray-500">
              <span>Subtotal (sin IVA)</span><span className="tabular-nums">{fmtQ(totales.gravable)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>IVA 12%</span><span className="tabular-nums">{fmtQ(totales.iva)}</span>
            </div>
            <div className="flex justify-between text-base font-semibold text-gray-900 pt-2 border-t border-gray-200">
              <span>Total</span><span className="tabular-nums">{fmtQ(totales.total)}</span>
            </div>
          </div>

          {/* Receptor */}
          <div className="p-4 border-t border-gray-100 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Receptor</div>
            <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
              <button onClick={() => setNitMode(true)}
                className={`flex-1 text-xs py-1.5 rounded ${receptor.nit === 'CF' ? 'bg-white shadow-sm text-julia-red font-medium' : 'text-gray-600'}`}>
                Consumidor Final
              </button>
              <button onClick={() => setNitMode(false)}
                className={`flex-1 text-xs py-1.5 rounded ${receptor.nit !== 'CF' ? 'bg-white shadow-sm text-julia-red font-medium' : 'text-gray-600'}`}>
                Con NIT
              </button>
            </div>
            {receptor.nit !== 'CF' && (
              <>
                <div className="relative">
                  <input type="text" placeholder="NIT (sin guiones)" value={receptor.nit}
                    onChange={e => setReceptor(r => ({ ...r, nit: e.target.value }))}
                    onBlur={() => consultarNit(receptor.nit)}
                    className="input w-full text-sm pr-9" inputMode="text" autoComplete="off" />
                  {consultando ? (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-gray-200 border-t-julia-red rounded-full animate-spin" title="Consultando RTU…" />
                  ) : (
                    receptor.nit && ultimoNitConsultado.current === normalizarNit(receptor.nit) && receptor.nombre && !nitMsg && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-emerald-600 text-sm" title="NIT confirmado en RTU">✓</span>
                    )
                  )}
                </div>
                <input type="text" placeholder="Nombre receptor" value={receptor.nombre}
                  onChange={e => setReceptor(r => ({ ...r, nombre: e.target.value }))}
                  className="input text-sm" />
                <input type="email" placeholder="Email (opcional)" value={receptor.email}
                  onChange={e => setReceptor(r => ({ ...r, email: e.target.value }))}
                  className="input text-sm" />
                {nitMsg && (
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1.5">
                    {nitMsg}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Método de pago */}
          <div className="p-4 border-t border-gray-100">
            <div className="text-[11px] uppercase tracking-wide text-gray-400 font-medium mb-2">Método de pago</div>
            <div className="grid grid-cols-2 gap-1.5">
              {METODOS_PAGO.map(m => (
                <button key={m.id} onClick={() => setMetodoPago(m.id)}
                  className={`text-xs py-2 rounded border transition-colors ${
                    metodoPago === m.id
                      ? 'border-julia-red bg-julia-red text-white font-medium'
                      : 'border-gray-200 text-gray-700 hover:border-julia-red bg-white'
                  }`}>{m.label}</button>
              ))}
            </div>
          </div>

          {err && (
            <div className="px-4 pb-2">
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>
            </div>
          )}

          {/* Botón cobrar */}
          <div className="p-4 border-t border-gray-100 bg-white">
            <button onClick={cobrar} disabled={enviando || carrito.length === 0}
              className="w-full py-3 bg-julia-red text-white font-medium rounded-lg disabled:opacity-50 hover:bg-red-700 transition-colors">
              {enviando ? 'Procesando…' : `Cobrar y facturar · ${fmtQ(totales.total)}`}
            </button>
          </div>
        </div>
      </div>

      {/* FAB para abrir carrito en mobile */}
      <button onClick={() => setMostrarCarritoMobile(true)}
        className="md:hidden fixed bottom-20 right-4 z-30 bg-julia-red text-white rounded-full px-5 py-3 shadow-lg flex items-center gap-2 font-medium">
        <span>🛒</span>
        <span>{carrito.length}</span>
        <span className="tabular-nums">{fmtQ(totales.total)}</span>
      </button>
    </POSChrome>
  )
}

function PantallaExito({ resultado, onNueva }) {
  const f = resultado.factura
  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-6">
      <div className="text-5xl mb-3">✓</div>
      <h2 className="text-2xl font-semibold text-emerald-700 mb-1">Factura certificada</h2>
      <p className="text-sm text-gray-500 mb-6">UUID SAT confirmado por Infile</p>

      <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 max-w-md w-full space-y-3 mb-6">
        <Row k="Receptor" v={`${f.receptor_nit} — ${f.receptor_nombre}`} />
        <Row k="Total" v={'Q ' + Number(f.total).toLocaleString('es-GT', { minimumFractionDigits: 2 })} bold />
        <Row k="Método pago" v={f.metodo_pago} />
        {resultado.neonet && (
          <>
            <hr className="border-gray-200" />
            <Row k="Tarjeta" v={<span className="font-mono">{resultado.neonet.pan_masked || '—'}</span>} />
            <Row k="Autorización" v={<span className="font-mono">{resultado.neonet.authorization_code || '—'}</span>} />
            <Row k="Voucher" v={<span className="font-mono">{resultado.neonet.voucher_code || '—'}</span>} />
            {resultado.neonet.origen !== 'prod' && (
              <Row k="" v={<span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-0.5 rounded">{resultado.neonet.origen}</span>} />
            )}
          </>
        )}
        <hr className="border-gray-200" />
        <Row k="UUID SAT" v={<span className="font-mono text-xs">{f.uuid_sat}</span>} />
        <Row k="Serie" v={<span className="font-mono">{f.serie_sat || '—'}</span>} />
        <Row k="Número" v={<span className="font-mono">{f.numero_sat || '—'}</span>} />
        <Row k="Inventario PT" v={resultado.descuento?.pt?.ok
          ? `✓ ${resultado.descuento.pt.lineas_procesadas} líneas`
          : <span className="text-amber-600">⚠ {resultado.descuento?.pt?.error || 'sin descontar'}</span>} />
        <Row k="Asiento" v={resultado.asiento?.ok
          ? <span className="text-emerald-600">✓ generado #{resultado.asiento.numero}</span>
          : <span className="text-amber-600">⚠ {resultado.asiento?.error || 'no generado'}</span>} />
      </div>

      <button onClick={onNueva}
        className="px-6 py-3 bg-julia-red text-white font-medium rounded-lg hover:bg-red-700">
        Nueva venta
      </button>
    </div>
  )
}

function Row({ k, v, bold }) {
  return (
    <div className="flex justify-between items-center gap-3">
      <span className="text-xs uppercase tracking-wide text-gray-400">{k}</span>
      <span className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>{v}</span>
    </div>
  )
}
