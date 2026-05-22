import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'

// ============================================================================
// Helpers
// ============================================================================

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

function formatNum(n) {
  return Number(n || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })
}

function formatQ(n) {
  return 'Q ' + formatNum(n)
}

function fechaHoyGT() {
  const ms = Date.now() - 6 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

function fechaManianaGT() {
  const ms = Date.now() - 6 * 60 * 60 * 1000 + 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function shiftFecha(fecha, dias) {
  const [y, m, d] = fecha.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d) + dias * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

function formatFechaLarga(fecha) {
  if (!fecha) return ''
  const [y, m, d] = fecha.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  return dt.toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' })
}

function estadoColor(estado) {
  if (estado === 'ejecutado') return 'bg-emerald-50 text-emerald-700 border-emerald-100'
  if (estado === 'cancelado') return 'bg-gray-50 text-gray-500 border-gray-200'
  return 'bg-amber-50 text-amber-700 border-amber-100'
}

// ============================================================================
// Pagina principal
// ============================================================================

export default function Produccion({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [fecha, setFecha] = useState(fechaManianaGT())
  const [planActivo, setPlanActivo] = useState(null)   // { plan, lineas, requerimientos, ... }
  const [recetas, setRecetas] = useState([])
  const [loadingPlan, setLoadingPlan] = useState(false)
  const [creando, setCreando] = useState(false)
  const [err, setErr] = useState(null)
  const [aviso, setAviso] = useState(null)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    cargarPerfil()
    cargarRecetas()
  }, [session])

  useEffect(() => { if (perfil) buscarPlan(fecha) }, [fecha, perfil])

  async function cargarPerfil() {
    const { data } = await supabase
      .from('perfiles').select('id, email, nombre_completo, rol, activo')
      .eq('id', session.user.id).single()
    setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' })
  }

  async function cargarRecetas() {
    const res = await apiFetch('/api/recetas')
    const json = await res.json()
    setRecetas((json.recetas || []).filter(r => r.activa))
  }

  async function buscarPlan(f) {
    setLoadingPlan(true); setErr(null); setAviso(null)
    const res = await apiFetch(`/api/produccion/planes?fecha=${f}&limit=1`)
    const json = await res.json()
    if (!res.ok) {
      setErr(json.error || 'Error buscando plan')
      setLoadingPlan(false)
      return
    }
    const p = (json.planes || [])[0]
    if (p) {
      await cargarPlan(p.id)
    } else {
      setPlanActivo(null)
      setLoadingPlan(false)
    }
  }

  async function cargarPlan(id) {
    setLoadingPlan(true)
    const res = await apiFetch(`/api/produccion/planes/${id}`)
    const json = await res.json()
    setLoadingPlan(false)
    if (!res.ok) {
      setErr(json.error || 'Error cargando plan')
      setPlanActivo(null)
      return
    }
    setPlanActivo(json)
  }

  async function crearPlan() {
    if (!esAdmin) return
    setCreando(true); setErr(null)
    const res = await apiFetch('/api/produccion/planes', {
      method: 'POST',
      body: JSON.stringify({ fecha_produccion: fecha }),
    })
    const json = await res.json()
    setCreando(false)
    if (!res.ok) { setErr(json.error || 'Error creando plan'); return }
    await cargarPlan(json.plan.id)
  }

  async function guardarLineas(nuevas) {
    if (!planActivo) return
    const res = await apiFetch(`/api/produccion/planes/${planActivo.plan.id}/lineas`, {
      method: 'PUT',
      body: JSON.stringify({ lineas: nuevas }),
    })
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Error guardando lineas'); return false }
    await cargarPlan(planActivo.plan.id)
    return true
  }

  async function ejecutarPlan(forzar = false) {
    if (!planActivo) return null
    const res = await apiFetch(`/api/produccion/planes/${planActivo.plan.id}/ejecutar`, {
      method: 'POST',
      body: JSON.stringify({ forzar }),
    })
    const json = await res.json()
    if (res.ok) {
      setAviso(`✓ Plan ejecutado. ${json.movimientos_creados} movimiento(s) de salida creados.`)
      setTimeout(() => setAviso(null), 6000)
      await cargarPlan(planActivo.plan.id)
      return { ok: true, ...json }
    }
    if (res.status === 207) {
      setAviso(`⚠ Plan ejecutado con errores parciales (${json.errores_parciales?.length || 0}).`)
      await cargarPlan(planActivo.plan.id)
      return { ok: false, parcial: true, ...json }
    }
    return { ok: false, ...json, status: res.status }
  }

  async function eliminarPlan() {
    if (!planActivo) return
    if (!confirm('Borrar este plan? (solo borradores).')) return
    const res = await apiFetch(`/api/produccion/planes/${planActivo.plan.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { setErr(json.error || 'Error borrando'); return }
    setPlanActivo(null)
  }

  const esAdmin = perfil?.rol === 'admin'
  const esHoy = fecha === fechaHoyGT()
  const esManiana = fecha === fechaManianaGT()
  const estado = planActivo?.plan?.estado
  const editable = estado === 'borrador' && esAdmin

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-10 py-7 max-w-7xl mx-auto">
        <div className="flex items-baseline justify-between mb-5">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Planificación de producción</h1>
        </div>

        {/* Header card: fecha + estado del plan */}
        <div className="bg-white border border-gray-100 rounded-2xl p-5 mb-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-400 font-medium">Plan del día</div>
              <div className="text-lg text-gray-900 font-medium capitalize mt-0.5 flex items-center gap-2">
                {formatFechaLarga(fecha)}
                {esHoy     && <span className="text-xs text-julia-red font-semibold uppercase tracking-wide">Hoy</span>}
                {esManiana && <span className="text-xs text-blue-700 font-semibold uppercase tracking-wide">Mañana</span>}
                {planActivo && (
                  <span className={`text-xs uppercase tracking-wide border rounded px-2 py-0.5 ${estadoColor(estado)}`}>
                    {estado}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setFecha(shiftFecha(fecha, -1))}
                className="w-9 h-9 rounded-lg border border-gray-200 text-gray-500 hover:border-julia-red hover:text-julia-red transition" title="Día anterior">←</button>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-julia-red" />
              <button onClick={() => setFecha(shiftFecha(fecha, 1))}
                className="w-9 h-9 rounded-lg border border-gray-200 text-gray-500 hover:border-julia-red hover:text-julia-red transition" title="Día siguiente">→</button>
              <button onClick={() => setFecha(fechaManianaGT())}
                className="text-xs text-gray-500 hover:text-julia-red ml-1">Mañana</button>
              <button onClick={() => setFecha(fechaHoyGT())}
                className="text-xs text-gray-500 hover:text-julia-red ml-1">Hoy</button>
            </div>
          </div>

          {/* Acciones segun estado */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {!planActivo && !loadingPlan && (
              esAdmin ? (
                <button onClick={crearPlan} disabled={creando}
                  className="px-4 py-2 bg-julia-red text-white text-sm rounded-lg hover:bg-red-900 disabled:opacity-50">
                  {creando ? 'Creando…' : '+ Crear plan para esta fecha'}
                </button>
              ) : (
                <div className="text-sm text-gray-500">No hay plan para esta fecha. Solo un admin puede crear uno.</div>
              )
            )}
            {planActivo && estado === 'borrador' && esAdmin && (
              <button onClick={eliminarPlan}
                className="text-xs px-3 py-1.5 text-gray-400 hover:text-red-600">
                Borrar plan
              </button>
            )}
            {planActivo && estado === 'ejecutado' && (
              <div className="text-xs text-gray-500">
                Ejecutado {planActivo.plan.ejecutado_at && new Date(planActivo.plan.ejecutado_at).toLocaleString('es-GT')} ·
                ya descontó insumos del stock.
              </div>
            )}
            {planActivo && estado === 'cancelado' && esAdmin && (
              <button onClick={crearPlan} disabled={creando}
                className="px-4 py-2 bg-julia-red text-white text-sm rounded-lg hover:bg-red-900 disabled:opacity-50">
                {creando ? 'Creando…' : '+ Crear nuevo plan para esta fecha'}
              </button>
            )}
          </div>
        </div>

        {err && (
          <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>
        )}
        {aviso && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-xs text-emerald-800 mb-3">{aviso}</div>
        )}

        {loadingPlan && (
          <div className="bg-white rounded-2xl border border-gray-100 p-5">
            <SkeletonRow /><SkeletonRow /><SkeletonRow />
          </div>
        )}

        {!loadingPlan && planActivo && (
          <PanelPlan
            plan={planActivo}
            recetas={recetas}
            editable={editable}
            esAdmin={esAdmin}
            fecha={fecha}
            onGuardarLineas={guardarLineas}
            onEjecutar={ejecutarPlan}
          />
        )}
      </div>
    </Layout>
  )
}

// ============================================================================
// Panel principal del plan
// ============================================================================

function PanelPlan({ plan, recetas, editable, esAdmin, fecha, onGuardarLineas, onEjecutar }) {
  // Estado local de lineas (drafts), syncado cuando el plan recarga.
  const [draft, setDraft] = useState(() => plan.lineas.map(l => ({
    receta_id: l.receta_id, cantidad: l.cantidad, nombre: l.recetas?.nombre, rinde_unidad: l.recetas?.rinde_unidad,
  })))
  const [guardando, setGuardando] = useState(false)
  const [agregarOpen, setAgregarOpen] = useState(false)
  const [modalEjecutar, setModalEjecutar] = useState(false)
  const [modalCompras, setModalCompras] = useState(false)
  const [sugiriendo, setSugiriendo] = useState(false)
  const [sugerenciaMsg, setSugerenciaMsg] = useState(null)

  // Sync cuando cambian las lineas desde el servidor.
  useEffect(() => {
    setDraft(plan.lineas.map(l => ({
      receta_id: l.receta_id, cantidad: l.cantidad, nombre: l.recetas?.nombre, rinde_unidad: l.recetas?.rinde_unidad,
    })))
  }, [plan.plan.id, plan.plan.updated_at])

  const dirty = useMemo(() => {
    if (draft.length !== plan.lineas.length) return true
    const m = new Map(plan.lineas.map(l => [l.receta_id, Number(l.cantidad)]))
    for (const l of draft) {
      const orig = m.get(l.receta_id)
      if (orig == null) return true
      if (Number(l.cantidad) !== orig) return true
    }
    return false
  }, [draft, plan.lineas])

  async function persistir(next) {
    setGuardando(true)
    await onGuardarLineas(next.map(l => ({ receta_id: l.receta_id, cantidad: Number(l.cantidad) })))
    setGuardando(false)
  }

  function actualizarCantidad(receta_id, valor) {
    const v = Number(valor)
    if (!Number.isFinite(v) || v <= 0) {
      // si vacio o invalido, eliminar
      setDraft(d => d.filter(l => l.receta_id !== receta_id))
      return
    }
    setDraft(d => d.map(l => l.receta_id === receta_id ? { ...l, cantidad: v } : l))
  }

  function quitar(receta_id) {
    setDraft(d => d.filter(l => l.receta_id !== receta_id))
  }

  async function persistirYa() {
    await persistir(draft)
  }

  async function agregarRecetas(seleccionadas) {
    const existentes = new Set(draft.map(d => d.receta_id))
    const nuevas = seleccionadas
      .filter(s => !existentes.has(s.receta_id))
      .map(s => ({ ...s }))
    const next = [...draft, ...nuevas]
    setDraft(next)
    await persistir(next)
    setAgregarOpen(false)
  }

  async function sugerirCantidades() {
    setSugiriendo(true); setSugerenciaMsg(null)
    const res = await apiFetch(`/api/produccion/sugerencias?fecha=${fecha}&semanas=4`)
    const json = await res.json()
    setSugiriendo(false)
    if (!res.ok) { setSugerenciaMsg({ tipo: 'error', txt: json.error || 'Error al sugerir' }); return }
    const sug = json.sugerencias || []
    if (sug.length === 0) {
      setSugerenciaMsg({ tipo: 'info', txt: 'No hay ventas históricas para sugerir (necesitas recetas linkeadas a productos Loyverse con ventas en las últimas 4 semanas).' })
      setTimeout(() => setSugerenciaMsg(null), 8000)
      return
    }
    // Construir nuevo draft: agarra todas las recetas sugeridas (mantiene cantidades del draft cuando coinciden? mejor reemplaza con sugerido — el usuario edita).
    const recetasMap = new Map(recetas.map(r => [r.id, r]))
    const next = sug
      .map(s => {
        const r = recetasMap.get(s.receta_id)
        if (!r) return null
        return { receta_id: r.id, cantidad: s.sugerido, nombre: r.nombre, rinde_unidad: r.rinde_unidad }
      })
      .filter(Boolean)
    setDraft(next)
    await persistir(next)
    setSugerenciaMsg({ tipo: 'ok', txt: `Cargadas ${next.length} sugerencias en base al promedio del mismo día en las últimas 4 semanas.` })
    setTimeout(() => setSugerenciaMsg(null), 6000)
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
      {/* Lineas del plan */}
      <div className="lg:col-span-3">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-900">Productos a producir</h2>
            <div className="flex gap-2 items-center">
              {editable && (
                <button onClick={sugerirCantidades} disabled={sugiriendo}
                  className="text-xs px-3 py-1.5 border border-gray-200 text-gray-600 rounded-md hover:border-julia-red hover:text-julia-red disabled:opacity-50">
                  {sugiriendo ? 'Sugiriendo…' : 'Sugerir cantidades'}
                </button>
              )}
              {editable && (
                <button onClick={() => setAgregarOpen(true)}
                  className="text-xs px-3 py-1.5 bg-julia-red text-white rounded-md hover:bg-red-900">
                  + Agregar receta
                </button>
              )}
            </div>
          </div>

          {sugerenciaMsg && (
            <div className={`px-5 py-2 text-xs border-b border-gray-100 ${
              sugerenciaMsg.tipo === 'error' ? 'bg-red-50 text-red-700'
              : sugerenciaMsg.tipo === 'ok' ? 'bg-emerald-50 text-emerald-700'
              : 'bg-blue-50 text-blue-700'}`}>
              {sugerenciaMsg.txt}
            </div>
          )}

          {draft.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-gray-400">
              No hay líneas en el plan todavía. {editable && <span>Agregá recetas o pedí sugerencias en base a ventas históricas.</span>}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50/80 border-b border-gray-100">
                <tr>
                  <th className="text-left  text-xs text-gray-500 font-medium px-5 py-3">Receta</th>
                  <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-32">Unidades</th>
                  <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-24">Costo unit.</th>
                  <th className="text-right text-xs text-gray-500 font-medium px-3 py-3 w-28">Subtotal</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {draft.map((l, i) => {
                  const resuelta = plan.lineas_resueltas?.find(x => x.receta_id === l.receta_id)
                  const costoUnit = resuelta?.costo_unitario ?? 0
                  const subtotal = Number(l.cantidad || 0) * costoUnit
                  return (
                    <tr key={l.receta_id} className={`${i > 0 ? 'border-t border-gray-50' : ''} hover:bg-gray-50/40`}>
                      <td className="px-5 py-3">
                        <div className="text-gray-900">{l.nombre || resuelta?.nombre || l.receta_id.slice(0, 8)}</div>
                        {l.rinde_unidad && <div className="text-xs text-gray-400">{l.rinde_unidad}</div>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          type="number" step="any" min="0.001"
                          value={l.cantidad}
                          disabled={!editable}
                          onChange={e => actualizarCantidad(l.receta_id, e.target.value)}
                          onBlur={persistirYa}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                          className="w-24 text-right tabular-nums px-2 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:border-julia-red text-sm disabled:bg-transparent disabled:border-transparent" />
                      </td>
                      <td className="px-3 py-3 text-right text-gray-600 tabular-nums">{costoUnit ? formatQ(costoUnit) : '—'}</td>
                      <td className="px-3 py-3 text-right text-gray-800 font-medium tabular-nums">{subtotal ? formatQ(subtotal) : '—'}</td>
                      <td className="px-2 py-3">
                        {editable && (
                          <button onClick={() => { quitar(l.receta_id); persistir(draft.filter(x => x.receta_id !== l.receta_id)) }}
                            className="text-gray-300 hover:text-red-600" title="Quitar">✕</button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {draft.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/40 text-xs text-gray-500 flex justify-between">
              <span>{draft.length} receta{draft.length === 1 ? '' : 's'} · {plan.resumen?.unidades_totales != null ? formatNum(plan.resumen.unidades_totales) : '—'} unidades</span>
              {plan.resumen?.costo_produccion_estimado != null && (
                <span>Costo de producción estimado: <span className="font-medium text-gray-800">{formatQ(plan.resumen.costo_produccion_estimado)}</span></span>
              )}
            </div>
          )}
        </div>

        {/* Ejecutar */}
        {editable && draft.length > 0 && (
          <div className="mt-5 flex items-center justify-between gap-3 bg-gradient-to-r from-julia-red/5 to-transparent border border-julia-red/20 rounded-xl px-5 py-4">
            <div>
              <div className="text-sm font-medium text-gray-900">¿Listo para producir?</div>
              <div className="text-xs text-gray-500 mt-0.5">Descontará los insumos del stock vía movimientos auditados.</div>
            </div>
            <button onClick={() => setModalEjecutar(true)} disabled={guardando || dirty}
              className="px-4 py-2 bg-julia-red text-white text-sm rounded-lg hover:bg-red-900 disabled:opacity-50 whitespace-nowrap">
              {dirty ? 'Guarda cambios primero…' : 'Confirmar y ejecutar producción →'}
            </button>
          </div>
        )}
      </div>

      {/* Requerimientos de insumos */}
      <div className="lg:col-span-2">
        <PanelRequerimientos
          requerimientos={plan.requerimientos || []}
          resumen={plan.resumen}
          onVerCompras={() => setModalCompras(true)}
        />
      </div>

      {agregarOpen && (
        <ModalAgregarReceta
          recetas={recetas}
          existentes={new Set(draft.map(d => d.receta_id))}
          onClose={() => setAgregarOpen(false)}
          onAgregar={agregarRecetas}
        />
      )}
      {modalEjecutar && (
        <ModalEjecutar
          resumen={plan.resumen}
          requerimientos={plan.requerimientos || []}
          onClose={() => setModalEjecutar(false)}
          onEjecutar={async (forzar) => {
            const r = await onEjecutar(forzar)
            if (r?.ok || r?.parcial) setModalEjecutar(false)
            return r
          }}
        />
      )}
      {modalCompras && (
        <ModalListaCompras
          requerimientos={plan.requerimientos || []}
          onClose={() => setModalCompras(false)}
        />
      )}
    </div>
  )
}

// ============================================================================
// Panel lateral: requerimientos de insumos
// ============================================================================

function PanelRequerimientos({ requerimientos, resumen, onVerCompras }) {
  const conFaltante = (requerimientos || []).filter(r => r.faltante > 0)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden sticky top-4">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <h2 className="text-sm font-medium text-gray-900">Insumos requeridos</h2>
        <div className="text-xs text-gray-400 mt-0.5">Calculado contra stock actual de insumos</div>
      </div>

      {/* KPIs compactos */}
      <div className="grid grid-cols-2 gap-3 p-5 border-b border-gray-100">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">Insumos totales</div>
          <div className="text-xl font-semibold mt-1 tabular-nums text-gray-900">{resumen?.total_insumos ?? 0}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">A comprar</div>
          <div className={`text-xl font-semibold mt-1 tabular-nums ${conFaltante.length > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
            {conFaltante.length}
          </div>
          {(resumen?.costo_compra_estimado || 0) > 0 && (
            <div className="text-xs text-gray-500 mt-0.5">{formatQ(resumen.costo_compra_estimado)}</div>
          )}
        </div>
      </div>

      {conFaltante.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/40">
          <button onClick={onVerCompras}
            className="w-full text-xs font-medium px-3 py-2 bg-white border border-amber-300 text-amber-800 rounded-md hover:bg-amber-50">
            Ver lista de compras ({conFaltante.length})
          </button>
        </div>
      )}

      {/* Tabla compacta de requerimientos */}
      <div className="max-h-[60vh] overflow-y-auto">
        {requerimientos.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-gray-400">
            Sin requerimientos. Agregá recetas con cantidades.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="bg-gray-50/80 sticky top-0">
              <tr>
                <th className="text-left  text-[11px] text-gray-500 font-medium px-4 py-2.5">Insumo</th>
                <th className="text-right text-[11px] text-gray-500 font-medium px-2 py-2.5 w-20">Necesita</th>
                <th className="text-right text-[11px] text-gray-500 font-medium px-2 py-2.5 w-16">Stock</th>
                <th className="text-right text-[11px] text-gray-500 font-medium px-3 py-2.5 w-20">Falta</th>
              </tr>
            </thead>
            <tbody>
              {requerimientos.map((r, i) => {
                const falta = r.faltante > 0
                return (
                  <tr key={r.insumo_id} className={`${i > 0 ? 'border-t border-gray-50' : ''} ${falta ? 'bg-red-50/40' : ''}`}>
                    <td className="px-4 py-2">
                      <div className="text-gray-800 leading-tight">{r.nombre}</div>
                      {r.proveedor && <div className="text-[10px] text-gray-400">{r.proveedor}</div>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-700">
                      {formatNum(r.requerido)}<span className="text-[10px] text-gray-400 ml-0.5">{r.unidad}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-gray-500">{formatNum(r.stock_actual)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {falta ? (
                        <span className="text-red-700 font-medium">{formatNum(r.faltante)}</span>
                      ) : (
                        <span className="text-emerald-600">✓</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Modales
// ============================================================================

function ModalShell({ titulo, ancho = 'max-w-md', onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${ancho} max-h-[90vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

function ModalAgregarReceta({ recetas, existentes, onClose, onAgregar }) {
  const [busqueda, setBusqueda] = useState('')
  const [seleccionadas, setSeleccionadas] = useState({})  // receta_id -> cantidad

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return recetas
      .filter(r => !existentes.has(r.id))
      .filter(r => !q || r.nombre.toLowerCase().includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
  }, [recetas, existentes, busqueda])

  function toggle(r) {
    setSeleccionadas(s => {
      if (s[r.id]) { const cp = { ...s }; delete cp[r.id]; return cp }
      return { ...s, [r.id]: { cantidad: 1, nombre: r.nombre, rinde_unidad: r.rinde_unidad } }
    })
  }

  function confirmar() {
    const items = Object.entries(seleccionadas).map(([receta_id, v]) => ({
      receta_id, cantidad: Number(v.cantidad) || 1,
      nombre: v.nombre, rinde_unidad: v.rinde_unidad,
    }))
    onAgregar(items)
  }

  const total = Object.keys(seleccionadas).length

  return (
    <ModalShell titulo="Agregar recetas al plan" ancho="max-w-xl" onClose={onClose}>
      <input type="text" placeholder="Buscar receta…" autoFocus
        value={busqueda} onChange={e => setBusqueda(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-julia-red mb-3" />
      <div className="border border-gray-100 rounded-lg overflow-hidden">
        <div className="max-h-[50vh] overflow-y-auto">
          {filtradas.length === 0 ? (
            <div className="text-center text-xs text-gray-400 py-8">
              {recetas.length === 0 ? 'No hay recetas activas. Creá una primero en /recetas.' : 'Sin resultados.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {filtradas.map(r => {
                  const sel = !!seleccionadas[r.id]
                  return (
                    <tr key={r.id} className={`border-t first:border-t-0 border-gray-50 cursor-pointer ${sel ? 'bg-julia-cream/30' : 'hover:bg-gray-50'}`}
                        onClick={() => toggle(r)}>
                      <td className="px-3 py-2.5 w-8">
                        <input type="checkbox" readOnly checked={sel} className="rounded border-gray-300" />
                      </td>
                      <td className="px-2 py-2.5 text-gray-800">
                        {r.nombre}
                        <span className="text-xs text-gray-400 ml-1">/ rinde {r.rinde_cantidad} {r.rinde_unidad}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right w-32">
                        {sel && (
                          <input type="number" step="any" min="0.001"
                            value={seleccionadas[r.id].cantidad}
                            onClick={e => e.stopPropagation()}
                            onChange={e => setSeleccionadas(s => ({ ...s, [r.id]: { ...s[r.id], cantidad: e.target.value } }))}
                            className="w-20 text-right tabular-nums px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:border-julia-red" />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="flex justify-between items-center pt-4">
        <span className="text-xs text-gray-500">{total} receta{total === 1 ? '' : 's'} seleccionada{total === 1 ? '' : 's'}</span>
        <div className="flex gap-2">
          <button onClick={onClose}
            className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={confirmar} disabled={total === 0}
            className="px-4 py-2 bg-julia-red text-white text-sm rounded-lg hover:bg-red-900 disabled:opacity-50">
            Agregar {total > 0 ? `(${total})` : ''}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function ModalEjecutar({ resumen, requerimientos, onClose, onEjecutar }) {
  const [forzar, setForzar] = useState(false)
  const [ejecutando, setEjecutando] = useState(false)
  const [resultado, setResultado] = useState(null)  // { ok, error?, faltantes? }
  const conFaltante = requerimientos.filter(r => r.faltante > 0)
  const hayFaltante = conFaltante.length > 0

  async function ejecutar() {
    setEjecutando(true); setResultado(null)
    const r = await onEjecutar(forzar)
    setEjecutando(false)
    if (r?.ok || r?.parcial) {
      // El parent cierra el modal — pero por si no, mostrar resultado
      setResultado({ ok: true })
    } else {
      setResultado(r)
    }
  }

  return (
    <ModalShell titulo="Confirmar y ejecutar producción" ancho="max-w-lg" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-gray-700">
          Esta acción <strong>descontará los insumos</strong> del stock vía movimientos auditados de tipo <em>salida</em>,
          con referencia a este plan. <strong>No es reversible automáticamente</strong> — para revertir, se usan movimientos de ajuste manuales.
        </p>

        <div className="bg-gray-50 rounded-lg p-3 space-y-1.5 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">Productos a producir</span><span className="font-medium">{resumen?.productos_a_producir || 0}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Unidades totales</span><span className="font-medium tabular-nums">{formatNum(resumen?.unidades_totales || 0)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Insumos a descontar</span><span className="font-medium">{resumen?.total_insumos || 0}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Costo de producción</span><span className="font-medium tabular-nums">{formatQ(resumen?.costo_produccion_estimado || 0)}</span></div>
        </div>

        {hayFaltante && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-sm">
            <div className="font-medium text-red-800 mb-1">⚠ Stock insuficiente para {conFaltante.length} insumo{conFaltante.length === 1 ? '' : 's'}</div>
            <ul className="text-xs text-red-700 space-y-0.5 max-h-32 overflow-y-auto">
              {conFaltante.map(r => (
                <li key={r.insumo_id}>
                  <strong>{r.nombre}</strong>: necesita {formatNum(r.requerido)} {r.unidad}, hay {formatNum(r.stock_actual)} (falta {formatNum(r.faltante)})
                </li>
              ))}
            </ul>
            <label className="flex items-center gap-2 mt-2 text-xs">
              <input type="checkbox" checked={forzar} onChange={e => setForzar(e.target.checked)} className="rounded border-red-300" />
              <span className="text-red-800">Ejecutar igual (stock quedará en negativo)</span>
            </label>
          </div>
        )}

        {resultado && !resultado.ok && (
          <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">
            {resultado.error || 'Error al ejecutar'}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={ejecutando}
            className="px-4 py-2 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 disabled:opacity-50">Cancelar</button>
          <button onClick={ejecutar} disabled={ejecutando || (hayFaltante && !forzar)}
            className="px-4 py-2 bg-julia-red text-white text-sm rounded-lg hover:bg-red-900 disabled:opacity-50">
            {ejecutando ? 'Ejecutando…' : 'Ejecutar producción'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function ModalListaCompras({ requerimientos, onClose }) {
  const faltantes = requerimientos.filter(r => r.faltante > 0)
  const totalQ = faltantes.reduce((s, r) => s + (r.costo_compra || 0), 0)

  function copiar() {
    const txt = faltantes.map(r =>
      `${r.nombre}: ${formatNum(r.faltante)} ${r.unidad || ''}${r.proveedor ? ` (${r.proveedor})` : ''}`
    ).join('\n')
    navigator.clipboard?.writeText(txt)
  }

  return (
    <ModalShell titulo="Lista de compras" ancho="max-w-xl" onClose={onClose}>
      <div className="mb-3 flex justify-between items-baseline">
        <p className="text-sm text-gray-600">
          {faltantes.length} insumo{faltantes.length === 1 ? '' : 's'} con stock insuficiente para el plan.
        </p>
        <button onClick={copiar} className="text-xs text-gray-500 hover:text-julia-red">Copiar</button>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50/80 border-b border-gray-100">
          <tr>
            <th className="text-left  text-xs text-gray-500 font-medium px-3 py-2">Insumo</th>
            <th className="text-right text-xs text-gray-500 font-medium px-3 py-2">Cantidad</th>
            <th className="text-right text-xs text-gray-500 font-medium px-3 py-2">Costo estim.</th>
          </tr>
        </thead>
        <tbody>
          {faltantes.map((r, i) => (
            <tr key={r.insumo_id} className={i > 0 ? 'border-t border-gray-50' : ''}>
              <td className="px-3 py-2.5">
                <div className="text-gray-800">{r.nombre}</div>
                {r.proveedor && <div className="text-xs text-gray-400">{r.proveedor}</div>}
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-red-700 font-medium">
                {formatNum(r.faltante)} <span className="text-xs text-gray-400">{r.unidad}</span>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">
                {r.costo_compra > 0 ? formatQ(r.costo_compra) : '—'}
              </td>
            </tr>
          ))}
          {faltantes.length === 0 && (
            <tr><td colSpan={3} className="text-center text-xs text-gray-400 py-8">Nada por comprar.</td></tr>
          )}
        </tbody>
        {totalQ > 0 && (
          <tfoot>
            <tr className="border-t border-gray-100 bg-gray-50/40">
              <td className="px-3 py-2.5 text-xs text-gray-500" colSpan={2}>Total estimado</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-gray-900 font-semibold">{formatQ(totalQ)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </ModalShell>
  )
}
