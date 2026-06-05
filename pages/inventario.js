import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import ImportarCSV from '../components/ImportarCSV'
import SelectUnidad from '../components/SelectUnidad'
import { factorEntre, unidadesBasePorCompra } from '../lib/unidades'

// ============================================================================
// Helpers
// ============================================================================

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

function estadoStock(actual, minimo) {
  const a = Number(actual) || 0
  const m = Number(minimo) || 0
  if (a < 0) return 'negativo'
  if (a === 0) return 'cero'
  if (m > 0 && a < m) return 'bajo'
  return 'ok'
}

function colorEstado(e) {
  if (e === 'negativo') return 'text-red-600 font-semibold'
  if (e === 'cero')     return 'text-orange-500 font-medium'
  if (e === 'bajo')     return 'text-yellow-600 font-medium'
  return 'text-gray-700'
}

function bgEstado(e) {
  if (e === 'negativo') return 'bg-red-50'
  if (e === 'cero')     return 'bg-orange-50'
  if (e === 'bajo')     return 'bg-yellow-50'
  return ''
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })
}

function formatFecha(s) {
  if (!s) return '—'
  return new Date(s).toLocaleString('es-GT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ============================================================================
// Pagina
// ============================================================================

export default function Inventario({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [tab, setTab] = useState('terminados') // 'terminados' | 'insumos'

  useEffect(() => {
    if (!session) { router.push('/login'); return }
    cargarPerfil()
  }, [session])

  async function cargarPerfil() {
    const { data } = await supabase
      .from('perfiles')
      .select('id, email, nombre_completo, rol, activo')
      .eq('id', session.user.id)
      .single()
    setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' })
  }

  const esAdmin = perfil?.rol === 'admin'

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-10 py-7 max-w-7xl mx-auto">
        <div className="flex items-baseline justify-between mb-5">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Inventario</h1>
        </div>

        <div className="flex gap-1 border-b border-gray-200 mb-6">
          <TabBtn active={tab === 'terminados'} onClick={() => setTab('terminados')}>Productos terminados</TabBtn>
          <TabBtn active={tab === 'insumos'}    onClick={() => setTab('insumos')}>Insumos</TabBtn>
          <TabBtn active={tab === 'mermas'}     onClick={() => setTab('mermas')}>Histórico de mermas</TabBtn>
        </div>

        {tab === 'terminados' && <TabTerminados esAdmin={esAdmin} />}
        {tab === 'insumos'    && <TabInsumos esAdmin={esAdmin} />}
        {tab === 'mermas'     && <TabHistoricoMermas />}
      </div>
    </Layout>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors ${
        active ? 'border-b-2 border-julia-red text-julia-red' : 'text-gray-500 hover:text-gray-800'
      }`}>
      {children}
    </button>
  )
}

// ============================================================================
// Tab 1: Productos terminados — conteo diario
// Para cada fecha: muestra ventas del dia (desde recibos Loyverse),
// permite cargar inventario inicial (opcional) y final (conteo fisico),
// calcula teorico = inicial - ventas y variacion = final - teorico.
// ============================================================================

function fechaHoyGT() {
  // GT = UTC-6 sin DST.
  const ms = Date.now() - 6 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

function shiftFechaGT(fecha, deltaDias) {
  const [y, m, d] = fecha.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + deltaDias * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function formatFechaLarga(fecha) {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return dt.toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' })
}

function TabTerminados({ esAdmin }) {
  const [fecha, setFecha] = useState(fechaHoyGT())
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ filas: [], resumen: null })
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('relevantes') // 'relevantes' | 'todos' | 'con-final' | 'variacion'
  const [savingMap, setSavingMap] = useState({})     // variant_id -> 'saving' | 'ok' | 'error'
  const [err, setErr] = useState(null)
  const [aviso, setAviso] = useState(null)           // mensaje transitorio (carry-forward, etc.)
  const [propagando, setPropagando] = useState(false)

  useEffect(() => { cargar(fecha) }, [fecha])

  async function cargar(f) {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/inventario/diario?fecha=${f}`)
    const json = await res.json()
    if (!res.ok) {
      setErr(json.error || 'Error cargando inventario diario')
      setData({ filas: [], resumen: null })
    } else {
      setData({ filas: json.filas || [], resumen: json.resumen })
    }
    setLoading(false)
  }

  // Aplicar updates locales sin recargar todo desde la API: actualiza solo la fila tocada.
  const upsertLocal = useCallback((variant_id, patch) => {
    setData(prev => {
      const filas = prev.filas.map(f => {
        if (f.variant_id !== variant_id) return f
        const merged = { ...f, ...patch }
        // Recomputar teorico + variacion (mismas reglas que la API).
        // Teorico requiere inicial cargado: si no hay, queda null.
        const inicial = merged.inventario_inicial
        const ventasCant = Number(merged.ventas_cantidad || 0)
        merged.inventario_teorico = inicial != null
          ? Math.round((Number(inicial) - ventasCant) * 1000) / 1000
          : null
        merged.variacion = (merged.inventario_teorico != null && merged.inventario_final != null)
          ? Math.round((Number(merged.inventario_final) - merged.inventario_teorico) * 1000) / 1000
          : null
        return merged
      })
      // Recalcular resumen agregado.
      const resumen = recalcularResumen(filas, prev.resumen)
      return { filas, resumen }
    })
  }, [])

  // Guardado debounced por variante.
  const saveTimers = useRef({}) // variant_id -> timeout id
  const guardarFila = useCallback((variant_id, payload) => {
    setSavingMap(s => ({ ...s, [variant_id]: 'saving' }))
    clearTimeout(saveTimers.current[variant_id])
    saveTimers.current[variant_id] = setTimeout(async () => {
      const body = { fecha, variant_id, ...payload }
      const res = await apiFetch('/api/inventario/diario', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSavingMap(s => ({ ...s, [variant_id]: 'error' }))
        setErr(json.error || 'Error al guardar')
        return
      }
      setSavingMap(s => ({ ...s, [variant_id]: 'ok' }))
      setTimeout(() => {
        setSavingMap(s => {
          if (s[variant_id] !== 'ok') return s
          const cp = { ...s }; delete cp[variant_id]; return cp
        })
      }, 1500)
    }, 600)
  }, [fecha])

  // Funciones de filtro reutilizables (también se usan para los contadores).
  const esRelevante = (f) =>
    (Number(f.ventas_cantidad) || 0) !== 0
    || (f.inventario_inicial != null)
    || (f.inventario_final != null)
    || (f.inicial_sugerido_ayer != null)
  const tieneFinal     = (f) => f.inventario_final != null
  const tieneVariacion = (f) => f.variacion != null && f.variacion !== 0

  // Contadores por filtro (sobre todo data, sin búsqueda).
  const contadores = useMemo(() => ({
    relevantes: data.filas.filter(esRelevante).length,
    'con-final':  data.filas.filter(tieneFinal).length,
    variacion:    data.filas.filter(tieneVariacion).length,
    todos:        data.filas.length,
  }), [data.filas])

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return data.filas.filter(f => {
      if (q) {
        const txt = `${f.item_name || ''} ${f.variant_name || ''} ${f.sku || ''}`.toLowerCase()
        if (!txt.includes(q)) return false
      }
      if (filtro === 'relevantes') return esRelevante(f)
      if (filtro === 'con-final')  return tieneFinal(f)
      if (filtro === 'variacion')  return tieneVariacion(f)
      return true
    })
  }, [data.filas, busqueda, filtro])

  // Candidatos para carry-forward: filas con inicial vacio Y final de ayer disponible.
  const candidatosCarryForward = useMemo(() => {
    return data.filas.filter(f =>
      f.inventario_inicial == null && f.inicial_sugerido_ayer != null
    )
  }, [data.filas])

  async function propagarDesdeAyer() {
    setPropagando(true); setErr(null); setAviso(null)
    const res = await apiFetch('/api/inventario/diario/carry-forward', {
      method: 'POST',
      body: JSON.stringify({ fecha }),
    })
    const json = await res.json().catch(() => ({}))
    setPropagando(false)
    if (!res.ok) {
      setErr(json.error || 'Error al propagar conteos')
      return
    }
    setAviso(`✓ Cargados ${json.propagados} producto(s) desde el conteo del día anterior. Podés editarlos.`)
    setTimeout(() => setAviso(null), 6000)
    // Recargar para reflejar los nuevos iniciales y recalcular teoricos/variacion.
    cargar(fecha)
  }

  const esHoy = fecha === fechaHoyGT()

  return (
    <div>
      {/* Encabezado: fecha + KPIs */}
      <div className="card-julia p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-medium">Conteo del día</div>
            <div className="text-lg text-gray-900 font-medium capitalize mt-0.5">
              {formatFechaLarga(fecha)}
              {esHoy && <span className="ml-2 text-xs text-julia-red font-semibold uppercase tracking-wide">Hoy</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setFecha(shiftFechaGT(fecha, -1))}
              className="w-9 h-9 rounded-lg border border-gray-200 text-gray-500 hover:border-julia-red hover:text-julia-red transition"
              title="Día anterior">←</button>
            <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-julia-red" />
            <button onClick={() => setFecha(shiftFechaGT(fecha, 1))}
              disabled={esHoy}
              className="w-9 h-9 rounded-lg border border-gray-200 text-gray-500 hover:border-julia-red hover:text-julia-red transition disabled:opacity-30 disabled:hover:border-gray-200 disabled:hover:text-gray-500"
              title="Día siguiente">→</button>
            {!esHoy && (
              <button onClick={() => setFecha(fechaHoyGT())}
                className="text-xs text-gray-500 hover:text-julia-red ml-1">Hoy</button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ResumenCard
            label="Ventas del día"
            value={data.resumen ? `Q ${formatNum(data.resumen.ventas_monto_total)}` : '—'}
            hint={data.resumen ? `${formatNum(data.resumen.ventas_cantidad_total)} unidades · ${data.resumen.variantes_con_ventas} productos` : ''} />
          <ResumenCard
            label="Productos contados"
            value={data.resumen?.variantes_conteo_final ?? '—'}
            hint={data.resumen ? `de ${data.resumen.variantes_totales} variantes` : ''} />
          <ResumenCard
            label="Variación neta"
            value={data.resumen ? formatSigned(data.resumen.variacion_neta_unidades) : '—'}
            hint="físico − teórico (solo productos con ambos)"
            tone={data.resumen && data.resumen.variacion_neta_unidades < 0 ? 'red'
                  : data.resumen && data.resumen.variacion_neta_unidades > 0 ? 'green' : 'neutral'} />
          <ResumenCard
            label="Merma"
            value={data.resumen ? formatNum(Math.abs(data.resumen.merma_unidades || 0)) : '—'}
            hint="unidades perdidas (variaciones negativas)"
            tone={data.resumen && (data.resumen.merma_unidades || 0) < 0 ? 'red' : 'neutral'} />
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input
          type="text" placeholder="Buscar producto, variante o SKU…"
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1 focus:outline-none focus:border-julia-red"
        />
        <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1 text-xs">
          {[
            { v: 'relevantes', l: 'Activos hoy' },
            { v: 'con-final',  l: 'Contados' },
            { v: 'variacion',  l: 'Con variación' },
            { v: 'todos',      l: 'Todos' },
          ].map(o => (
            <button key={o.v} onClick={() => setFiltro(o.v)}
              className={`px-3 py-1.5 rounded-md transition ${filtro === o.v
                ? 'bg-white text-julia-red shadow-sm font-medium'
                : 'text-gray-500 hover:text-gray-800'}`}>
              {o.l} <span className="ml-1 text-gray-400">({contadores[o.v] ?? 0})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Carry-forward: sugerencia cuando hay finales de ayer disponibles */}
      {esAdmin && candidatosCarryForward.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3 mb-3">
          <div className="text-sm text-amber-900 leading-snug">
            <span className="font-medium">{candidatosCarryForward.length} producto{candidatosCarryForward.length === 1 ? '' : 's'}</span>
            {' '}sin inicial cargado pero con conteo final del día anterior.
            <span className="text-amber-700/80"> Podés tomar el final de ayer como inicial de hoy.</span>
          </div>
          <button
            onClick={propagarDesdeAyer}
            disabled={propagando}
            className="text-xs font-medium px-3 py-1.5 bg-white border border-amber-300 text-amber-800 rounded-md hover:bg-amber-50 disabled:opacity-50 whitespace-nowrap">
            {propagando ? 'Cargando…' : 'Usar conteo de ayer'}
          </button>
        </div>
      )}

      {aviso && (
        <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-xs text-emerald-800 mb-3">{aviso}</div>
      )}

      {err && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>
      )}

      {/* Vista MOBILE: cards apiladas (≤ md). En móvil la tabla quedaba con
          scroll horizontal y la columna Inicial se ocultaba a la derecha. */}
      <div className="md:hidden space-y-2 mb-3">
        {loading ? (
          <>{[1, 2, 3].map(i => <div key={i} className="card-julia p-4"><SkeletonRow /></div>)}</>
        ) : filtradas.length === 0 ? (
          <div className="card-julia p-6 text-center text-xs text-gray-400">
            {data.filas.length === 0 ? (
              'No hay productos sincronizados desde Loyverse.'
            ) : (
              <>
                Sin resultados con esos filtros.
                {(busqueda || filtro !== 'todos') && (
                  <>
                    {' '}
                    <button onClick={() => { setBusqueda(''); setFiltro('todos') }}
                      className="text-julia-red hover:underline">Ver todos ({data.filas.length})</button>
                  </>
                )}
              </>
            )}
          </div>
        ) : (
          filtradas.map(f => (
            <CardProductoMobile
              key={f.variant_id}
              fila={f}
              esAdmin={esAdmin}
              estadoSave={savingMap[f.variant_id]}
              onChange={(patch) => {
                upsertLocal(f.variant_id, patch)
                guardarFila(f.variant_id, {
                  inventario_inicial: patch.inventario_inicial !== undefined ? patch.inventario_inicial : f.inventario_inicial,
                  inventario_final:   patch.inventario_final   !== undefined ? patch.inventario_final   : f.inventario_final,
                })
              }}
            />
          ))
        )}
        {!loading && filtradas.length > 0 && (
          <div className="text-[11px] text-gray-400 text-center pt-1">
            {filtradas.length} producto{filtradas.length === 1 ? '' : 's'} · auto-guarda al editar
          </div>
        )}
      </div>

      {/* Vista DESKTOP: tabla (≥ md) */}
      <div className="hidden md:block card-julia overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50/80 border-b border-gray-100">
              <tr>
                <th className="text-left  text-xs text-gray-500 font-medium px-5 py-3">Producto</th>
                <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-28">Ventas del día</th>
                <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-32">Inicial</th>
                <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-28">
                  Final teórico
                  <div className="text-[10px] text-gray-400 font-normal normal-case">automático</div>
                </th>
                <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-32">
                  Final físico
                  <div className="text-[10px] text-gray-400 font-normal normal-case">conteo manual</div>
                </th>
                <th className="text-right text-xs text-gray-500 font-medium px-5 py-3 w-32">Variación</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1, 2, 3, 4, 5].map(i => <tr key={i}><td colSpan={6}><SkeletonRow /></td></tr>)}</>
              ) : filtradas.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-12">
                  {data.filas.length === 0 ? (
                    'No hay productos sincronizados desde Loyverse.'
                  ) : (
                    <>
                      Sin resultados con esos filtros.
                      {(busqueda || filtro !== 'todos') && (
                        <>
                          {' '}
                          <button onClick={() => { setBusqueda(''); setFiltro('todos') }}
                            className="text-julia-red hover:underline">Ver todos ({data.filas.length})</button>
                        </>
                      )}
                    </>
                  )}
                </td></tr>
              ) : (
                filtradas.map((f, idx) => (
                  <FilaProducto
                    key={f.variant_id}
                    fila={f}
                    bordeArriba={idx > 0}
                    esAdmin={esAdmin}
                    estadoSave={savingMap[f.variant_id]}
                    onChange={(patch) => {
                      upsertLocal(f.variant_id, patch)
                      guardarFila(f.variant_id, {
                        inventario_inicial: patch.inventario_inicial !== undefined
                          ? patch.inventario_inicial : f.inventario_inicial,
                        inventario_final:   patch.inventario_final !== undefined
                          ? patch.inventario_final : f.inventario_final,
                      })
                    }}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && filtradas.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/40 text-xs text-gray-500 flex justify-between">
            <span>{filtradas.length} producto{filtradas.length === 1 ? '' : 's'} visibles</span>
            <span>Auto-guarda al editar · datos de Loyverse, sync cada 15 min</span>
          </div>
        )}
      </div>
    </div>
  )
}

function recalcularResumen(filas, prev) {
  let ventasMonto = 0, ventasCant = 0, conFinal = 0, conVentas = 0, merma = 0, variacion = 0
  for (const f of filas) {
    ventasMonto += Number(f.ventas_monto || 0)
    ventasCant  += Number(f.ventas_cantidad || 0)
    if (f.ventas_cantidad !== 0) conVentas++
    if (f.inventario_final != null) conFinal++
    if (f.variacion != null) {
      variacion += f.variacion
      if (f.variacion < 0) merma += f.variacion
    }
  }
  return {
    variantes_totales: prev?.variantes_totales ?? filas.length,
    variantes_con_ventas: conVentas,
    variantes_conteo_final: conFinal,
    ventas_monto_total: Math.round(ventasMonto * 100) / 100,
    ventas_cantidad_total: Math.round(ventasCant * 1000) / 1000,
    merma_unidades: Math.round(merma * 1000) / 1000,
    variacion_neta_unidades: Math.round(variacion * 1000) / 1000,
  }
}

function FilaProducto({ fila, bordeArriba, esAdmin, estadoSave, onChange }) {
  const [inicial, setInicial] = useState(fila.inventario_inicial != null ? String(fila.inventario_inicial) : '')
  const [final, setFinal] = useState(fila.inventario_final != null ? String(fila.inventario_final) : '')

  // Sincronizar cuando viene un cambio externo (ej. cambio de fecha).
  useEffect(() => {
    setInicial(fila.inventario_inicial != null ? String(fila.inventario_inicial) : '')
    setFinal(fila.inventario_final != null ? String(fila.inventario_final) : '')
  }, [fila.variant_id, fila.inventario_inicial, fila.inventario_final])

  function commitInicial(v) {
    const parsed = v === '' ? null : Number(v)
    if (v !== '' && !Number.isFinite(parsed)) return
    onChange({ inventario_inicial: parsed })
  }
  function commitFinal(v) {
    const parsed = v === '' ? null : Number(v)
    if (v !== '' && !Number.isFinite(parsed)) return
    onChange({ inventario_final: parsed })
  }

  const teorico = fila.inventario_teorico
  const variacion = fila.variacion
  const conVar = variacion != null

  let varBadge = null
  if (conVar) {
    const tone = variacion > 0 ? 'bg-emerald-50 text-emerald-700'
              : variacion < 0 ? 'bg-red-50 text-red-700'
              : 'bg-gray-100 text-gray-600'
    varBadge = (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${tone}`}>
        {variacion > 0 ? '+' : ''}{formatNum(variacion)}
      </span>
    )
  }

  return (
    <tr className={`${bordeArriba ? 'border-t border-gray-50' : ''} hover:bg-gray-50/40 transition-colors`}>
      <td className="px-5 py-3.5">
        <div className="text-gray-900 leading-tight">{fila.item_name}</div>
        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
          {fila.variant_name && <span>{fila.variant_name}</span>}
          {fila.variant_name && fila.sku && <span>·</span>}
          {fila.sku && <span className="font-mono">{fila.sku}</span>}
          {!fila.track_stock && (
            <span className="px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-[10px] uppercase tracking-wide">sin stock</span>
          )}
        </div>
      </td>
      <td className="px-3 py-3.5 text-right">
        {fila.ventas_cantidad === 0 ? (
          <span className="text-gray-300">—</span>
        ) : (
          <div>
            <div className="text-gray-800 font-medium tabular-nums">{formatNum(fila.ventas_cantidad)}</div>
            <div className="text-[11px] text-gray-400 tabular-nums">Q {formatNum(fila.ventas_monto)}</div>
          </div>
        )}
      </td>
      <td className="px-3 py-3.5 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {esAdmin && fila.inventario_inicial == null && fila.inicial_sugerido_ayer != null && (
            <button
              type="button"
              onClick={() => {
                const v = String(fila.inicial_sugerido_ayer)
                setInicial(v)
                commitInicial(v)
              }}
              title={`Usar ${formatNum(fila.inicial_sugerido_ayer)} (final de ayer)`}
              className="text-[10px] text-amber-700 hover:text-amber-900 hover:underline tabular-nums whitespace-nowrap">
              ← {formatNum(fila.inicial_sugerido_ayer)}
            </button>
          )}
          <input
            type="number" step="any" inputMode="decimal"
            value={inicial}
            disabled={!esAdmin}
            onChange={e => setInicial(e.target.value)}
            onBlur={e => commitInicial(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            placeholder="—"
            className="w-24 text-right tabular-nums px-2 py-1.5 border border-transparent rounded-md hover:border-gray-200 focus:outline-none focus:border-julia-red focus:bg-white text-sm disabled:bg-transparent disabled:cursor-default"
          />
        </div>
      </td>
      <td className="px-3 py-3.5 text-right tabular-nums"
          title={teorico != null ? 'Final teórico = inicial − ventas del día' : 'Cargá el inventario inicial para calcular el final teórico'}>
        {teorico != null ? (
          <span className="text-gray-800 font-medium">{formatNum(teorico)}</span>
        ) : (
          <span className="text-gray-300 text-xs italic">requiere inicial</span>
        )}
      </td>
      <td className="px-3 py-3.5 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <input
            type="number" step="any" inputMode="decimal"
            value={final}
            disabled={!esAdmin}
            onChange={e => setFinal(e.target.value)}
            onBlur={e => commitFinal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            placeholder="—"
            className="w-24 text-right tabular-nums px-2 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:border-julia-red focus:bg-white bg-white text-sm disabled:bg-transparent disabled:border-transparent disabled:cursor-default"
          />
          {estadoSave === 'saving' && <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse" />}
          {estadoSave === 'ok'     && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
          {estadoSave === 'error'  && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
        </div>
      </td>
      <td className="px-5 py-3.5 text-right">
        {varBadge || <span className="text-gray-300 text-xs">—</span>}
      </td>
    </tr>
  )
}

// Vista mobile: card apilada con grid 2-col para los datos numericos.
// Misma logica de inputs y commits que FilaProducto.
function CardProductoMobile({ fila, esAdmin, estadoSave, onChange }) {
  const [inicial, setInicial] = useState(fila.inventario_inicial != null ? String(fila.inventario_inicial) : '')
  const [final, setFinal] = useState(fila.inventario_final != null ? String(fila.inventario_final) : '')

  useEffect(() => {
    setInicial(fila.inventario_inicial != null ? String(fila.inventario_inicial) : '')
    setFinal(fila.inventario_final != null ? String(fila.inventario_final) : '')
  }, [fila.variant_id, fila.inventario_inicial, fila.inventario_final])

  function commitInicial(v) {
    const parsed = v === '' ? null : Number(v)
    if (v !== '' && !Number.isFinite(parsed)) return
    onChange({ inventario_inicial: parsed })
  }
  function commitFinal(v) {
    const parsed = v === '' ? null : Number(v)
    if (v !== '' && !Number.isFinite(parsed)) return
    onChange({ inventario_final: parsed })
  }

  const teorico = fila.inventario_teorico
  const variacion = fila.variacion
  const varTone = variacion == null ? null
    : variacion > 0 ? 'bg-emerald-50 text-emerald-700'
    : variacion < 0 ? 'bg-red-50 text-red-700'
    : 'bg-gray-100 text-gray-600'

  return (
    <div className="card-julia p-3">
      {/* Header: nombre + meta */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-900 leading-tight truncate">{fila.item_name}</div>
          {(fila.variant_name || fila.sku) && (
            <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
              {fila.variant_name && <span>{fila.variant_name}</span>}
              {fila.variant_name && fila.sku && <span>·</span>}
              {fila.sku && <span className="font-mono">{fila.sku}</span>}
              {!fila.track_stock && (
                <span className="px-1 py-0.5 bg-gray-100 text-gray-400 rounded text-[9px] uppercase">sin stock</span>
              )}
            </div>
          )}
        </div>
        {estadoSave === 'saving' && <span className="w-2 h-2 rounded-full bg-gray-300 animate-pulse flex-shrink-0 mt-1" />}
        {estadoSave === 'ok'     && <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0 mt-1" />}
        {estadoSave === 'error'  && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 mt-1" />}
      </div>

      {/* Grid 2-col: Ventas + Inicial (arriba), Teorico + Final (medio), Variacion (abajo) */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Ventas día</div>
          {fila.ventas_cantidad === 0 ? (
            <div className="text-gray-300">—</div>
          ) : (
            <div>
              <div className="text-gray-900 font-medium tabular-nums">{formatNum(fila.ventas_cantidad)}</div>
              <div className="text-[10px] text-gray-400 tabular-nums">Q {formatNum(fila.ventas_monto)}</div>
            </div>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Inicial</div>
          <div className="flex items-center gap-1">
            <input
              type="number" step="any" inputMode="decimal"
              value={inicial}
              disabled={!esAdmin}
              onChange={e => setInicial(e.target.value)}
              onBlur={e => commitInicial(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
              placeholder="—"
              className="w-full text-right tabular-nums px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:border-julia-red focus:bg-white bg-gray-50 text-sm disabled:bg-transparent disabled:border-transparent"
            />
          </div>
          {esAdmin && fila.inventario_inicial == null && fila.inicial_sugerido_ayer != null && (
            <button
              type="button"
              onClick={() => { const v = String(fila.inicial_sugerido_ayer); setInicial(v); commitInicial(v) }}
              className="text-[10px] text-amber-700 hover:text-amber-900 mt-0.5 tabular-nums">
              ← usar {formatNum(fila.inicial_sugerido_ayer)} (ayer)
            </button>
          )}
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Teórico (auto)</div>
          <div className="tabular-nums">
            {teorico != null ? (
              <span className="text-gray-900 font-medium">{formatNum(teorico)}</span>
            ) : (
              <span className="text-gray-300 text-xs italic">requiere inicial</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">Final físico</div>
          <input
            type="number" step="any" inputMode="decimal"
            value={final}
            disabled={!esAdmin}
            onChange={e => setFinal(e.target.value)}
            onBlur={e => commitFinal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
            placeholder="—"
            className="w-full text-right tabular-nums px-2 py-1 border border-gray-200 rounded-md focus:outline-none focus:border-julia-red focus:bg-white bg-white text-sm disabled:bg-transparent disabled:border-transparent"
          />
        </div>
        {variacion != null && (
          <div className="col-span-2 flex items-center justify-between border-t border-gray-100 pt-2 mt-1">
            <span className="text-[10px] uppercase tracking-wider text-gray-400">Variación</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${varTone}`}>
              {variacion > 0 ? '+' : ''}{formatNum(variacion)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

function ResumenCard({ label, value, hint, tone = 'neutral' }) {
  const tones = {
    neutral: 'border-gray-100',
    red:     'border-red-200 bg-red-50/40',
    green:   'border-emerald-200 bg-emerald-50/40',
  }
  const valueTones = {
    neutral: 'text-gray-900',
    red:     'text-red-700',
    green:   'text-emerald-700',
  }
  return (
    <div className={`border rounded-xl px-4 py-3 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">{label}</div>
      <div className={`text-xl font-semibold mt-1 tabular-nums ${valueTones[tone]}`}>{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  )
}

function formatSigned(n) {
  const v = Number(n) || 0
  return (v > 0 ? '+' : '') + formatNum(v)
}

// ============================================================================
// Tab 2: Insumos (materia prima — gestion manual)
// ============================================================================

function TabInsumos({ esAdmin }) {
  const [loading, setLoading] = useState(true)
  const [insumos, setInsumos] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('todas')
  const [soloProblemas, setSoloProblemas] = useState(false)
  const [insumoExpandido, setInsumoExpandido] = useState(null) // id
  const [modal, setModal] = useState(null) // { tipo: 'crear' | 'movimiento' | 'editar', insumo? }
  const [err, setErr] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    setErr(null)
    const res = await apiFetch('/api/insumos')
    const json = await res.json()
    if (!res.ok) {
      setErr(json.error || 'Error cargando insumos')
      setInsumos([])
    } else {
      setInsumos(json.insumos || [])
    }
    setLoading(false)
  }

  const categorias = useMemo(() => {
    const set = new Set()
    insumos.forEach(i => { if (i.categoria) set.add(i.categoria) })
    return ['todas', ...Array.from(set).sort()]
  }, [insumos])

  const filtrados = useMemo(() => {
    return insumos.filter(i => {
      if (busqueda && !i.nombre.toLowerCase().includes(busqueda.toLowerCase())) return false
      if (categoria !== 'todas' && i.categoria !== categoria) return false
      if (soloProblemas && estadoStock(i.stock_actual, i.stock_minimo) === 'ok') return false
      return true
    })
  }, [insumos, busqueda, categoria, soloProblemas])

  const stats = useMemo(() => {
    let neg = 0, cero = 0, bajos = 0, ok = 0
    insumos.forEach(i => {
      const e = estadoStock(i.stock_actual, i.stock_minimo)
      if (e === 'negativo') neg++
      else if (e === 'cero') cero++
      else if (e === 'bajo') bajos++
      else ok++
    })
    return { neg, cero, bajos, ok, total: insumos.length }
  }, [insumos])

  return (
    <div>
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <KpiCard label="Negativos" value={stats.neg}  tone="red"    hint="requieren ajuste" />
        <KpiCard label="En cero"   value={stats.cero} tone="orange" hint="sin stock" />
        <KpiCard label="Bajo mínimo" value={stats.bajos} tone="yellow" hint="próximos a agotarse" />
        <KpiCard label="OK"        value={stats.ok}   tone="green"  hint="stock adecuado" />
      </div>

      {/* Filtros + acciones */}
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <input
          type="text" placeholder="Buscar insumo…"
          value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm flex-1 focus:outline-none focus:border-julia-red"
        />
        <select
          value={categoria} onChange={e => setCategoria(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-julia-red">
          {categorias.map(c => <option key={c} value={c}>{c === 'todas' ? 'Todas las categorías' : c}</option>)}
        </select>
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 px-2">
          <input type="checkbox" checked={soloProblemas} onChange={e => setSoloProblemas(e.target.checked)}
            className="rounded border-gray-300" />
          Solo problemas
        </label>
        {esAdmin && (
          <>
            <button onClick={() => setModal({ tipo: 'importar' })}
              className="btn-secundario whitespace-nowrap">
              Importar CSV
            </button>
            <button onClick={() => setModal({ tipo: 'crear' })}
              className="px-4 py-2 bg-julia-red text-white text-sm rounded-lg hover:bg-red-900 whitespace-nowrap">
              + Nuevo insumo
            </button>
          </>
        )}
      </div>

      {err && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>
      )}

      {/* Tabla */}
      <div className="card-julia overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Insumo</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Categoría</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Stock</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Mínimo</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Costo Q</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1, 2, 3, 4].map(i => <tr key={i}><td colSpan={6}><SkeletonRow /></td></tr>)}</>
            ) : filtrados.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-xs text-gray-400 py-8">
                  {insumos.length === 0 ? 'No hay insumos. ' : 'Sin resultados con esos filtros.'}
                  {insumos.length === 0 && esAdmin && (
                    <button onClick={() => setModal({ tipo: 'crear' })}
                      className="text-julia-red hover:underline">Crear el primero →</button>
                  )}
                </td>
              </tr>
            ) : (
              filtrados.map(i => {
                const est = estadoStock(i.stock_actual, i.stock_minimo)
                const exp = insumoExpandido === i.id
                return (
                  <Fragment key={i.id}>
                    <tr className={`border-t border-gray-50 hover:bg-gray-50 ${bgEstado(est)}`}>
                      <td className="px-4 py-2.5 text-gray-800">
                        <button onClick={() => setInsumoExpandido(exp ? null : i.id)} className="text-left hover:underline">
                          {i.nombre}
                        </button>
                        {i.proveedor && <span className="text-xs text-gray-400 ml-2">· {i.proveedor}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{i.categoria || '—'}</td>
                      <td className={`px-4 py-2.5 text-right ${colorEstado(est)}`}>
                        {formatNum(i.stock_actual)} <span className="text-xs text-gray-400">{i.unidad}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500">
                        {Number(i.stock_minimo) > 0 ? formatNum(i.stock_minimo) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500">
                        {i.costo_unitario != null ? formatNum(i.costo_unitario) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {esAdmin && (
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => setModal({ tipo: 'movimiento', insumo: i })}
                              className="text-xs px-2 py-1 bg-white border border-gray-200 rounded hover:border-julia-red hover:text-julia-red">
                              Movimiento
                            </button>
                            <button onClick={() => setModal({ tipo: 'editar', insumo: i })}
                              className="text-xs px-2 py-1 text-gray-400 hover:text-gray-700">
                              Editar
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {exp && <FilaHistorial insumoId={i.id} />}
                  </Fragment>
                )
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      {modal?.tipo === 'crear' && (
        <ModalInsumo onClose={() => setModal(null)} onSaved={() => { setModal(null); cargar() }} />
      )}
      {modal?.tipo === 'editar' && (
        <ModalInsumo insumo={modal.insumo} onClose={() => setModal(null)} onSaved={() => { setModal(null); cargar() }} />
      )}
      {modal?.tipo === 'movimiento' && (
        <ModalMovimiento insumo={modal.insumo} onClose={() => setModal(null)} onSaved={() => { setModal(null); cargar() }} />
      )}
      {modal?.tipo === 'importar' && (
        <ImportarCSV
          titulo="Importar insumos desde CSV"
          schema={{
            nombre:                     ['nombre', 'name', 'producto', 'insumo'],
            categoria:                  ['categoria', 'category', 'tipo'],
            unidad:                     ['unidad', 'unidad_base', 'unit', 'um'],
            stock_inicial:              ['stock_inicial', 'stock', 'cantidad', 'existencia'],
            stock_minimo:               ['stock_minimo', 'minimo', 'min'],
            costo_unitario:             ['costo_unitario', 'costo', 'precio', 'cost'],
            unidad_compra:              ['unidad_compra', 'unidad_de_compra', 'empaque'],
            cantidad_por_unidad_compra: ['cantidad_por_unidad_compra', 'cantidad_compra', 'unidades_por_compra', 'cant_compra'],
            costo_compra:               ['costo_compra', 'precio_compra', 'costo_total'],
            proveedor:                  ['proveedor', 'supplier'],
            notas:                      ['notas', 'notes', 'observaciones'],
          }}
          requeridos={['nombre']}
          endpoint="/api/insumos/bulk"
          ejemplo={`nombre,categoria,unidad,unidad_compra,cantidad_por_unidad_compra,costo_compra,costo_unitario,stock_inicial,stock_minimo,proveedor
Cafe en grano,bebidas,lb,quintal,100,7000,,50,10,Tostadora Central
Harina dura,harinas,kg,saco,25,225,,75,25,Molino Excelsior
Huevo,frescos,unidad,carton,30,75,,180,60,Granja San Pedro
Levadura seca,levaduras,g,bolsa,500,45,,2000,500,Distribuidora La Espiga
Mantequilla,lacteos,lb,,,,28,15,5,Lactosa`}
          onClose={() => setModal(null)}
          onImportado={() => { setModal(null); cargar() }}
        />
      )}
    </div>
  )
}

// ============================================================================
// Subcomponentes
// ============================================================================

function KpiCard({ label, value, tone, hint }) {
  const tones = {
    red:    'bg-red-50 border-red-100 text-red-700',
    orange: 'bg-orange-50 border-orange-100 text-orange-700',
    yellow: 'bg-yellow-50 border-yellow-100 text-yellow-800',
    green:  'bg-green-50 border-green-100 text-green-700',
  }
  return (
    <div className={`border rounded-xl p-3 ${tones[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      <div className="text-xs opacity-60 mt-0.5">{hint}</div>
    </div>
  )
}

function FilaHistorial({ insumoId }) {
  const [movs, setMovs] = useState(null)

  useEffect(() => {
    (async () => {
      const res = await apiFetch(`/api/insumos/movimientos?insumo_id=${insumoId}&limit=20`)
      const json = await res.json()
      setMovs(json.movimientos || [])
    })()
  }, [insumoId])

  return (
    <tr className="bg-gray-50/60">
      <td colSpan={6} className="px-4 py-3">
        <div className="text-xs text-gray-500 mb-2">Movimientos recientes</div>
        {movs === null ? (
          <div className="text-xs text-gray-400">Cargando…</div>
        ) : movs.length === 0 ? (
          <div className="text-xs text-gray-400">Sin movimientos registrados.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400">
                <th className="text-left font-normal py-1">Fecha</th>
                <th className="text-left font-normal py-1">Tipo</th>
                <th className="text-right font-normal py-1">Cambio</th>
                <th className="text-right font-normal py-1">Stock después</th>
                <th className="text-left font-normal py-1 pl-3">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movs.map(m => (
                <tr key={m.id} className="border-t border-gray-100">
                  <td className="py-1 text-gray-600">{formatFecha(m.created_at)}</td>
                  <td className="py-1"><PillTipo tipo={m.tipo} /></td>
                  <td className={`py-1 text-right font-medium ${Number(m.delta) >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                    {Number(m.delta) >= 0 ? '+' : ''}{formatNum(m.delta)}
                  </td>
                  <td className="py-1 text-right text-gray-700">{formatNum(m.stock_despues)}</td>
                  <td className="py-1 pl-3 text-gray-500">{m.motivo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  )
}

function PillTipo({ tipo }) {
  const map = {
    entrada: 'bg-green-100 text-green-700',
    salida:  'bg-blue-100 text-blue-700',
    merma:   'bg-red-100 text-red-700',
    ajuste:  'bg-gray-200 text-gray-700',
  }
  return <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${map[tipo] || 'bg-gray-100'}`}>{tipo}</span>
}

// ============================================================================
// Modales
// ============================================================================

function ModalShell({ titulo, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

function ModalInsumo({ insumo, onClose, onSaved }) {
  const edicion = !!insumo
  const [form, setForm] = useState({
    nombre:         insumo?.nombre || '',
    categoria:      insumo?.categoria || '',
    unidad:         insumo?.unidad || 'g',
    stock_minimo:   insumo?.stock_minimo ?? 0,
    costo_unitario: insumo?.costo_unitario ?? '',
    unidad_compra:              insumo?.unidad_compra || '',
    cantidad_por_unidad_compra: insumo?.cantidad_por_unidad_compra ?? '',
    costo_compra:               insumo?.costo_compra ?? '',
    proveedor:      insumo?.proveedor || '',
    notas:          insumo?.notas || '',
    stock_inicial:  0,
  })
  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando] = useState(false)
  const [err, setErr] = useState(null)
  const [aviso, setAviso] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Dar de baja / eliminar. El backend decide: si no hay referencias, hace
  // hard-delete; si las hay, soft-delete (activo=false) y devuelve el listado
  // para que mostremos un mensaje claro.
  async function darDeBaja() {
    if (!edicion) return
    const ok = confirm(
      `¿Dar de baja "${insumo.nombre}"?\n\n` +
      `Si el insumo no se usa en ninguna receta, movimiento o compra, se ` +
      `eliminará por completo.\n\n` +
      `Si está en uso, queda oculto del catálogo pero el historial se conserva.`
    )
    if (!ok) return
    setBorrando(true); setErr(null); setAviso(null)
    const res = await apiFetch(`/api/insumos/${insumo.id}`, { method: 'DELETE' })
    const json = await res.json()
    setBorrando(false)
    if (!res.ok) {
      setErr(json.error || 'Error al dar de baja')
      return
    }
    if (json.modo === 'eliminado') {
      onSaved()
      return
    }
    // soft-delete: mostramos detalle antes de cerrar
    const partes = []
    if (json.usos?.recetas > 0) {
      const lista = (json.recetas_que_lo_usan || []).slice(0, 3).join(', ')
      partes.push(`${json.usos.recetas} receta${json.usos.recetas === 1 ? '' : 's'}${lista ? ` (${lista}${json.usos.recetas > 3 ? '…' : ''})` : ''}`)
    }
    if (json.usos?.movimientos > 0) partes.push(`${json.usos.movimientos} movimiento${json.usos.movimientos === 1 ? '' : 's'} de inventario`)
    if (json.usos?.compras > 0) partes.push(`${json.usos.compras} línea${json.usos.compras === 1 ? '' : 's'} de compra`)
    setAviso(`Insumo dado de baja. Quedó oculto porque ya está referenciado en: ${partes.join('; ')}. El historial se conserva.`)
    setTimeout(onSaved, 2200)
  }

  // Si el usuario llena la presentacion de compra, el costo por unidad base
  // se DERIVA con conversion: si unidad_compra y unidad son ambas conocidas
  // (lb<->g, kg<->g, lt<->ml...) se aplica el factor canonico. Sino, fallback:
  // se asume que cantidad_por_unidad_compra ya esta en unidad base.
  const cpcNum = Number(form.cantidad_por_unidad_compra)
  const ccNum  = Number(form.costo_compra)
  const tieneCompra = form.cantidad_por_unidad_compra !== '' && form.costo_compra !== '' && cpcNum > 0

  // Cantidad real en unidad base que trae UNA compra (aplicando conversion).
  const baseEnUnaCompra = tieneCompra
    ? unidadesBasePorCompra({
        unidad: form.unidad,
        unidad_compra: form.unidad_compra,
        cantidad_por_unidad_compra: cpcNum,
      })
    : null
  const costoDerivado = (tieneCompra && baseEnUnaCompra > 0) ? (ccNum / baseEnUnaCompra) : null

  // Diagnostico: ¿se convirtio o se interpreto la cantidad como base?
  const factorAplicado = (form.unidad_compra && form.unidad)
    ? factorEntre(form.unidad_compra, form.unidad)
    : null
  const huboConversion = factorAplicado != null && factorAplicado !== 1

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const payload = {
      nombre: form.nombre,
      categoria: form.categoria,
      unidad: form.unidad,
      stock_minimo: Number(form.stock_minimo) || 0,
      costo_unitario: form.costo_unitario === '' ? null : Number(form.costo_unitario),
      unidad_compra:              form.unidad_compra?.trim() || null,
      cantidad_por_unidad_compra: form.cantidad_por_unidad_compra === '' ? null : Number(form.cantidad_por_unidad_compra),
      costo_compra:               form.costo_compra === '' ? null : Number(form.costo_compra),
      proveedor: form.proveedor,
      notas: form.notas,
    }
    if (!edicion) payload.stock_inicial = Number(form.stock_inicial) || 0

    const res = await apiFetch(
      edicion ? `/api/insumos/${insumo.id}` : '/api/insumos',
      { method: edicion ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
    )
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error al guardar'); return }
    onSaved()
  }

  return (
    <ModalShell titulo={edicion ? `Editar: ${insumo.nombre}` : 'Nuevo insumo'} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-3">
        <Campo label="Nombre" required>
          <input type="text" value={form.nombre} onChange={e => set('nombre', e.target.value)} required
            className="input" autoFocus />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Categoría">
            <input type="text" value={form.categoria} onChange={e => set('categoria', e.target.value)}
              placeholder="harinas, lácteos…" className="input" />
          </Campo>
          <Campo label="Unidad base">
            <SelectUnidad value={form.unidad} onChange={v => set('unidad', v)}
              title="Unidad en que se LLEVA EL STOCK y se consume en las recetas." />
          </Campo>
        </div>

        {/* Bloque "Compra": si se llena, costo por unidad base se calcula solo. */}
        <fieldset className="border border-gray-100 rounded-lg p-3 space-y-3">
          <legend className="text-xs uppercase tracking-wide text-gray-500 font-medium px-1">Cómo se compra (opcional)</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Campo label="Unidad de compra">
              <SelectUnidad value={form.unidad_compra} onChange={v => set('unidad_compra', v)}
                permitirVacio
                placeholder="igual a unidad base"
                title="Unidad en que se compra (ej. libra, quintal, saco). Si es distinta de la unidad base, el sistema convierte automáticamente." />
            </Campo>
            <Campo label={
              huboConversion
                ? `Cantidad (en ${form.unidad_compra})`
                : `Cantidad (${form.unidad || 'unidad base'} por compra)`
            }>
              <input type="number" step="any" min="0" value={form.cantidad_por_unidad_compra}
                onChange={e => set('cantidad_por_unidad_compra', e.target.value)}
                className="input"
                placeholder={huboConversion ? `ej. 25 ${form.unidad_compra}` : `${form.unidad || 'unid'} por compra`}
                title={huboConversion
                  ? `Cuántas ${form.unidad_compra} trae UNA compra. El sistema convierte: 1 ${form.unidad_compra} = ${factorAplicado} ${form.unidad}.`
                  : `Cuántas unidades base (${form.unidad}) trae una ${form.unidad_compra || 'unidad de compra'}.`} />
            </Campo>
            <Campo label="Costo de compra (Q)">
              <input type="number" step="any" min="0" value={form.costo_compra}
                onChange={e => set('costo_compra', e.target.value)}
                className="input" placeholder={`Q por ${form.unidad_compra || 'compra'}`}
                title="Cuánto cuesta UNA unidad de compra (ej. Q175 por saco de 25 lb)." />
            </Campo>
          </div>
          {tieneCompra && (
            <div className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-md px-2 py-1.5 font-mono leading-snug break-words">
              {huboConversion ? (
                <>
                  📐 <strong>{cpcNum} {form.unidad_compra}</strong> ×{' '}
                  {factorAplicado.toLocaleString('es-GT', { maximumFractionDigits: 4 })} {form.unidad}/{form.unidad_compra} ={' '}
                  <strong>{baseEnUnaCompra.toLocaleString('es-GT', { maximumFractionDigits: 2 })} {form.unidad}</strong> por compra
                  <br />
                  Q{ccNum} ÷ {baseEnUnaCompra.toLocaleString('es-GT', { maximumFractionDigits: 2 })} {form.unidad} ={' '}
                  <strong>Q{costoDerivado.toFixed(4)} / {form.unidad}</strong>
                </>
              ) : (
                <>
                  {form.unidad_compra && !factorAplicado && (
                    <span className="text-amber-700">
                      ⚠ "{form.unidad_compra}" no es una unidad estándar reconocida. Cantidad interpretada como{' '}
                      <strong>{cpcNum} {form.unidad}</strong>.<br />
                    </span>
                  )}
                  Q{ccNum} ÷ {cpcNum} {form.unidad} = <strong>Q{costoDerivado.toFixed(4)} / {form.unidad}</strong>
                </>
              )}
            </div>
          )}
        </fieldset>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Stock mínimo">
            <input type="number" step="any" value={form.stock_minimo} onChange={e => set('stock_minimo', e.target.value)}
              className="input" />
          </Campo>
          <Campo label={tieneCompra ? `Costo / ${form.unidad} (calculado)` : `Costo / ${form.unidad} (Q)`}>
            {tieneCompra ? (
              <input type="text" value={`Q ${costoDerivado.toFixed(4)}`} readOnly
                className="input bg-gray-50 text-gray-600 cursor-default"
                title={`Calculado: Q${ccNum} / ${cpcNum} ${form.unidad} = Q${costoDerivado.toFixed(4)} por ${form.unidad}`} />
            ) : (
              <input type="number" step="any" value={form.costo_unitario} onChange={e => set('costo_unitario', e.target.value)}
                className="input" placeholder="opcional" />
            )}
          </Campo>
        </div>
        <Campo label="Proveedor">
          <input type="text" value={form.proveedor} onChange={e => set('proveedor', e.target.value)} className="input" />
        </Campo>
        {!edicion && (
          <Campo label="Stock inicial">
            <input type="number" step="any" value={form.stock_inicial} onChange={e => set('stock_inicial', e.target.value)}
              className="input" placeholder="0 si no querés cargar stock ahora" />
          </Campo>
        )}
        <Campo label="Notas">
          <textarea value={form.notas} onChange={e => set('notas', e.target.value)} rows={2} className="input" />
        </Campo>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}
        {aviso && <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">{aviso}</div>}

        <div className="flex justify-between items-center gap-2 pt-2">
          <div>
            {edicion && (
              <button type="button" onClick={darDeBaja} disabled={borrando || guardando}
                className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50">
                {borrando ? 'Dando de baja…' : 'Dar de baja'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
            <button type="submit" disabled={guardando || borrando} className="btn-primario">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </form>

      <style jsx>{`
        :global(.input) {
          width: 100%; border: 1px solid #e5e7eb; border-radius: 0.5rem;
          padding: 0.5rem 0.75rem; font-size: 0.875rem;
        }
        :global(.input:focus) { outline: none; border-color: #991b1b; }
        :global(.btn-primario) {
          padding: 0.5rem 1.25rem; background: #991b1b; color: white;
          border-radius: 0.5rem; font-size: 0.875rem;
        }
        :global(.btn-primario:hover) { background: #7f1d1d; }
        :global(.btn-primario:disabled) { opacity: 0.5; }
        :global(.btn-secundario) {
          padding: 0.5rem 1rem; border: 1px solid #e5e7eb; color: #4b5563;
          border-radius: 0.5rem; font-size: 0.875rem;
        }
        :global(.btn-secundario:hover) { background: #f9fafb; }
      `}</style>
    </ModalShell>
  )
}

function ModalMovimiento({ insumo, onClose, onSaved }) {
  const [tipo, setTipo] = useState('entrada')
  const [cantidad, setCantidad] = useState('')
  const [nuevoStock, setNuevoStock] = useState(insumo.stock_actual ?? 0)
  const [costo, setCosto] = useState(insumo.costo_unitario ?? '')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const payload = { insumo_id: insumo.id, tipo, motivo }
    if (tipo === 'ajuste') payload.nuevo_stock = Number(nuevoStock)
    else payload.cantidad = Number(cantidad)
    if (tipo === 'entrada' && costo !== '') payload.costo_unitario = Number(costo)

    const res = await apiFetch('/api/insumos/movimientos', {
      method: 'POST', body: JSON.stringify(payload),
    })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error al registrar'); return }
    onSaved()
  }

  const stockActual = Number(insumo.stock_actual) || 0
  let preview = null
  if (tipo === 'ajuste') {
    preview = Number(nuevoStock) || 0
  } else {
    const c = Number(cantidad) || 0
    preview = tipo === 'entrada' ? stockActual + c : stockActual - c
  }

  return (
    <ModalShell titulo={`Movimiento: ${insumo.nombre}`} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-3">
        <div className="text-xs text-gray-500">
          Stock actual: <span className="font-medium text-gray-800">{formatNum(stockActual)} {insumo.unidad}</span>
        </div>

        <Campo label="Tipo de movimiento">
          <div className="grid grid-cols-4 gap-1">
            {['entrada', 'salida', 'merma', 'ajuste'].map(t => (
              <button key={t} type="button" onClick={() => setTipo(t)}
                className={`text-xs py-2 rounded border ${tipo === t
                  ? 'border-julia-red bg-julia-cream/40 text-julia-red font-medium'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                {t}
              </button>
            ))}
          </div>
        </Campo>

        {tipo === 'ajuste' ? (
          <Campo label={`Nuevo stock (${insumo.unidad})`}>
            <input type="number" step="any" value={nuevoStock} onChange={e => setNuevoStock(e.target.value)} required
              className="input" autoFocus />
          </Campo>
        ) : (
          <Campo label={`Cantidad (${insumo.unidad})`}>
            <input type="number" step="any" value={cantidad} onChange={e => setCantidad(e.target.value)} required min="0.0001"
              className="input" autoFocus />
          </Campo>
        )}

        {tipo === 'entrada' && (
          <Campo label="Costo unitario (Q) — opcional">
            <input type="number" step="any" value={costo} onChange={e => setCosto(e.target.value)} className="input" />
          </Campo>
        )}

        <Campo label="Motivo">
          <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)}
            placeholder={tipo === 'merma' ? 'ej. pan quemado, vencido' : tipo === 'ajuste' ? 'ej. corrección de inventario' : ''}
            className="input" />
        </Campo>

        <div className="bg-gray-50 rounded-lg px-3 py-2 text-xs text-gray-600 flex justify-between">
          <span>Stock después del movimiento:</span>
          <span className={`font-semibold ${preview < 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {formatNum(preview)} {insumo.unidad}
          </span>
        </div>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">
            {guardando ? 'Registrando…' : 'Registrar'}
          </button>
        </div>
      </form>

      <style jsx>{`
        :global(.input) {
          width: 100%; border: 1px solid #e5e7eb; border-radius: 0.5rem;
          padding: 0.5rem 0.75rem; font-size: 0.875rem;
        }
        :global(.input:focus) { outline: none; border-color: #991b1b; }
        :global(.btn-primario) {
          padding: 0.5rem 1.25rem; background: #991b1b; color: white;
          border-radius: 0.5rem; font-size: 0.875rem;
        }
        :global(.btn-primario:hover) { background: #7f1d1d; }
        :global(.btn-primario:disabled) { opacity: 0.5; }
        :global(.btn-secundario) {
          padding: 0.5rem 1rem; border: 1px solid #e5e7eb; color: #4b5563;
          border-radius: 0.5rem; font-size: 0.875rem;
        }
        :global(.btn-secundario:hover) { background: #f9fafb; }
      `}</style>
    </ModalShell>
  )
}

function Campo({ label, required, children }) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">
        {label}{required && <span className="text-julia-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

// ============================================================================
// Tab 3: Historico de mermas
// Cruza conteos_diarios_producto en un rango para mostrar el top de productos
// con mas merma acumulada (variacion negativa). Calcula monto estimado usando
// el precio promedio del periodo y arma un sparkline por producto.
// ============================================================================

const PRESETS = [
  { v: '7',   l: '7 días'  },
  { v: '30',  l: '30 días' },
  { v: 'mes', l: 'Mes actual' },
  { v: 'custom', l: 'Personalizado' },
]

function rangoDePreset(preset) {
  const hoy = fechaHoyGT()
  if (preset === '7' || preset === '30') {
    const n = parseInt(preset, 10)
    const [y, m, d] = hoy.split('-').map(Number)
    const desde = new Date(Date.UTC(y, m - 1, d) - (n - 1) * 86_400_000).toISOString().slice(0, 10)
    return { desde, hasta: hoy }
  }
  if (preset === 'mes') {
    const [y, m] = hoy.split('-').map(Number)
    const desde = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01`
    return { desde, hasta: hoy }
  }
  return null
}

function TabHistoricoMermas() {
  const [preset, setPreset] = useState('7')
  const [rango, setRango] = useState(() => rangoDePreset('7'))
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState({ resumen: null, ranking: [], fechas: [] })
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (preset !== 'custom') {
      const r = rangoDePreset(preset)
      if (r) setRango(r)
    }
  }, [preset])

  useEffect(() => {
    if (!rango?.desde || !rango?.hasta) return
    cargar(rango.desde, rango.hasta)
  }, [rango?.desde, rango?.hasta])

  async function cargar(desde, hasta) {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/inventario/historico-mermas?desde=${desde}&hasta=${hasta}`)
    const json = await res.json()
    if (!res.ok) {
      setErr(json.error || 'Error cargando histórico de mermas')
      setData({ resumen: null, ranking: [], fechas: [] })
    } else {
      setData({ resumen: json.resumen, ranking: json.ranking || [], fechas: json.fechas || [] })
    }
    setLoading(false)
  }

  const resumen = data.resumen

  return (
    <div>
      {/* Header + period selector */}
      <div className="card-julia p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-medium">Histórico de mermas</div>
            <div className="text-lg text-gray-900 font-medium mt-0.5">
              {rango?.desde && rango?.hasta && (
                <>Del {formatFechaCorta(rango.desde)} al {formatFechaCorta(rango.hasta)}</>
              )}
            </div>
          </div>

          <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1 text-xs">
            {PRESETS.map(p => (
              <button key={p.v} onClick={() => setPreset(p.v)}
                className={`px-3 py-1.5 rounded-md transition ${preset === p.v
                  ? 'bg-white text-julia-red shadow-sm font-medium'
                  : 'text-gray-500 hover:text-gray-800'}`}>
                {p.l}
              </button>
            ))}
          </div>
        </div>

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Desde</label>
              <input type="date" value={rango?.desde || ''} max={rango?.hasta}
                onChange={e => setRango(r => ({ ...r, desde: e.target.value }))}
                className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-julia-red" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Hasta</label>
              <input type="date" value={rango?.hasta || ''} min={rango?.desde} max={fechaHoyGT()}
                onChange={e => setRango(r => ({ ...r, hasta: e.target.value }))}
                className="px-2.5 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-julia-red" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ResumenCard
            label="Productos afectados"
            value={resumen?.productos_afectados ?? '—'}
            hint="con merma en el período" />
          <ResumenCard
            label="Merma en unidades"
            value={resumen ? formatNum(Math.abs(resumen.merma_unidades_total || 0)) : '—'}
            hint="suma de variaciones negativas"
            tone={resumen && (resumen.merma_unidades_total || 0) < 0 ? 'red' : 'neutral'} />
          <ResumenCard
            label="Valor estimado"
            value={resumen ? `Q ${formatNum(resumen.merma_monto_estimado || 0)}` : '—'}
            hint="a precio promedio del período"
            tone={resumen && (resumen.merma_monto_estimado || 0) > 0 ? 'red' : 'neutral'} />
          <ResumenCard
            label="Días con conteo"
            value={resumen?.dias_con_conteo ?? '—'}
            hint="en el rango seleccionado" />
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>
      )}

      {/* Tabla ranking */}
      <div className="card-julia overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-gray-900">Top productos con más merma</h2>
          <span className="text-xs text-gray-400">{data.ranking.length} producto{data.ranking.length === 1 ? '' : 's'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50/80 border-b border-gray-100">
              <tr>
                <th className="text-left  text-xs text-gray-500 font-medium px-5 py-3">#</th>
                <th className="text-left  text-xs text-gray-500 font-medium px-3 py-3">Producto</th>
                <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-28">Merma <span className="text-gray-400 font-normal">(unid.)</span></th>
                <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-28">Valor estim.</th>
                <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-24">Días</th>
                <th className="text-left  text-xs text-gray-500 font-medium px-5 py-3 w-32">Tendencia</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1, 2, 3, 4, 5].map(i => <tr key={i}><td colSpan={6}><SkeletonRow /></td></tr>)}</>
              ) : data.ranking.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-12">
                  Sin merma registrada en este período. Cargá inicial y final en la pestaña de productos para que aparezcan acá.
                </td></tr>
              ) : (
                data.ranking.map((r, i) => (
                  <FilaMerma key={r.variant_id} pos={i + 1} fila={r} fechas={data.fechas} />
                ))
              )}
            </tbody>
          </table>
        </div>
        {!loading && data.ranking.length > 0 && (
          <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/40 text-xs text-gray-500">
            Valor estimado calculado con el precio promedio de venta del período. Los productos sin ventas en el rango aparecen sin valor.
          </div>
        )}
      </div>
    </div>
  )
}

function FilaMerma({ pos, fila, fechas }) {
  return (
    <tr className={`${pos > 1 ? 'border-t border-gray-50' : ''} hover:bg-gray-50/40`}>
      <td className="px-5 py-3.5 text-xs text-gray-400 tabular-nums">{pos}</td>
      <td className="px-3 py-3.5">
        <div className="text-gray-900 leading-tight">{fila.item_name}</div>
        <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
          {fila.variant_name && <span>{fila.variant_name}</span>}
          {fila.variant_name && fila.sku && <span>·</span>}
          {fila.sku && <span className="font-mono">{fila.sku}</span>}
        </div>
      </td>
      <td className="px-3 py-3.5 text-right">
        <div className="text-red-700 font-medium tabular-nums">{formatNum(fila.merma_unidades)}</div>
        {fila.dias_con_merma > 0 && (
          <div className="text-[11px] text-gray-400 tabular-nums">{fila.dias_con_merma} día{fila.dias_con_merma === 1 ? '' : 's'} c/merma</div>
        )}
      </td>
      <td className="px-3 py-3.5 text-right">
        {fila.monto_merma_estimado != null ? (
          <div>
            <div className="text-gray-800 font-medium tabular-nums">Q {formatNum(fila.monto_merma_estimado)}</div>
            <div className="text-[11px] text-gray-400 tabular-nums">@ Q {formatNum(fila.precio_promedio || 0)}</div>
          </div>
        ) : (
          <span className="text-gray-300 text-xs italic">sin ventas</span>
        )}
      </td>
      <td className="px-3 py-3.5 text-right text-gray-600 tabular-nums">
        {fila.dias_con_conteo}<span className="text-gray-400"> / {fechas.length}</span>
      </td>
      <td className="px-5 py-3.5">
        <Sparkline serie={fila.serie} />
      </td>
    </tr>
  )
}

// Sparkline SVG: barras hacia abajo en proporcion a la merma de cada dia.
function Sparkline({ serie }) {
  const W = 96, H = 24, GAP = 1
  const n = (serie || []).length
  if (!n) return null
  const max = Math.max(1, ...serie.map(p => Math.abs(p.merma || 0)))
  const bw = (W - GAP * (n - 1)) / n
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      <line x1="0" y1="0" x2={W} y2="0" stroke="#e5e7eb" strokeWidth="1" />
      {serie.map((p, i) => {
        const m = Math.abs(p.merma || 0)
        if (m === 0) return null
        const h = (m / max) * (H - 2)
        const x = i * (bw + GAP)
        return (
          <rect
            key={p.fecha}
            x={x} y={0} width={bw} height={h}
            fill="#dc2626" opacity={0.85}
            rx={0.5}
          >
            <title>{p.fecha}: {formatNum(-m)}</title>
          </rect>
        )
      })}
    </svg>
  )
}

function formatFechaCorta(fecha) {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
  return dt.toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })
}

