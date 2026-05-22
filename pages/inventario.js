import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import ImportarCSV from '../components/ImportarCSV'

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
    if (!session) { router.push('/'); return }
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
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Inventario</h1>
        </div>

        <div className="flex gap-1 border-b border-gray-200 mb-6">
          <TabBtn active={tab === 'terminados'} onClick={() => setTab('terminados')}>Productos terminados</TabBtn>
          <TabBtn active={tab === 'insumos'}    onClick={() => setTab('insumos')}>Insumos</TabBtn>
        </div>

        {tab === 'terminados' && <TabTerminados esAdmin={esAdmin} />}
        {tab === 'insumos'    && <TabInsumos esAdmin={esAdmin} />}
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

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return data.filas.filter(f => {
      if (q) {
        const txt = `${f.item_name || ''} ${f.variant_name || ''} ${f.sku || ''}`.toLowerCase()
        if (!txt.includes(q)) return false
      }
      if (filtro === 'relevantes') {
        return f.ventas_cantidad !== 0
            || f.inventario_inicial != null
            || f.inventario_final != null
      }
      if (filtro === 'con-final')  return f.inventario_final != null
      if (filtro === 'variacion')  return f.variacion != null && f.variacion !== 0
      return true
    })
  }, [data.filas, busqueda, filtro])

  const esHoy = fecha === fechaHoyGT()

  return (
    <div>
      {/* Encabezado: fecha + KPIs */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6 shadow-sm">
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
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>
      )}

      {/* Tabla */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
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
                  {data.filas.length === 0 ? 'No hay productos sincronizados desde Loyverse.' : 'Sin resultados con esos filtros.'}
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
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
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
            nombre:         ['nombre', 'name', 'producto', 'insumo'],
            categoria:      ['categoria', 'category', 'tipo'],
            unidad:         ['unidad', 'unit', 'um'],
            stock_inicial:  ['stock_inicial', 'stock', 'cantidad', 'existencia'],
            stock_minimo:   ['stock_minimo', 'minimo', 'min'],
            costo_unitario: ['costo_unitario', 'costo', 'precio', 'cost'],
            proveedor:      ['proveedor', 'supplier'],
            notas:          ['notas', 'notes', 'observaciones'],
          }}
          requeridos={['nombre']}
          endpoint="/api/insumos/bulk"
          ejemplo={`nombre,categoria,unidad,stock_inicial,stock_minimo,costo_unitario,proveedor
Harina dura,harinas,lb,200,50,4.50,Molino Excelsior
Levadura seca,levaduras,kg,5,2,180,Distribuidora La Espiga
Mantequilla,lacteos,lb,15,5,28,Lactosa`}
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function ModalInsumo({ insumo, onClose, onSaved }) {
  const edicion = !!insumo
  const [form, setForm] = useState({
    nombre:         insumo?.nombre || '',
    categoria:      insumo?.categoria || '',
    unidad:         insumo?.unidad || 'kg',
    stock_minimo:   insumo?.stock_minimo ?? 0,
    costo_unitario: insumo?.costo_unitario ?? '',
    proveedor:      insumo?.proveedor || '',
    notas:          insumo?.notas || '',
    stock_inicial:  0,
  })
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const payload = {
      nombre: form.nombre,
      categoria: form.categoria,
      unidad: form.unidad,
      stock_minimo: Number(form.stock_minimo) || 0,
      costo_unitario: form.costo_unitario === '' ? null : Number(form.costo_unitario),
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
          <Campo label="Unidad">
            <select value={form.unidad} onChange={e => set('unidad', e.target.value)} className="input">
              {['kg', 'lb', 'g', 'lt', 'ml', 'unidad', 'docena', 'caja', 'bolsa'].map(u => <option key={u}>{u}</option>)}
            </select>
          </Campo>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Stock mínimo">
            <input type="number" step="any" value={form.stock_minimo} onChange={e => set('stock_minimo', e.target.value)}
              className="input" />
          </Campo>
          <Campo label="Costo unitario (Q)">
            <input type="number" step="any" value={form.costo_unitario} onChange={e => set('costo_unitario', e.target.value)}
              className="input" placeholder="opcional" />
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

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">
            {guardando ? 'Guardando…' : 'Guardar'}
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
