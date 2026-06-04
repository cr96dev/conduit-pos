import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import { calcularMargen, costoEfectivo, factorIngrediente } from '../lib/recetas'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const fmt = n => Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtQ = n => 'Q ' + fmt(n)
const fmtPct = n => n == null ? '—' : `${Number(n).toFixed(1)}%`

// ============================================================================

export default function Recetas({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [items, setItems] = useState([])
  const [loyverseItems, setLoyverseItems] = useState([])
  const [insumos, setInsumos] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null)
  const [recalculando, setRecalculando] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [tipoFiltro, setTipoFiltro] = useState('todas') // 'todas' | 'comida' | 'bebida'

  useEffect(() => {
    if (!session) { router.push('/'); return }
    (async () => {
      const { data } = await supabase.from('perfiles')
        .select('id, email, nombre_completo, rol, activo')
        .eq('id', session.user.id).single()
      setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' })
    })()
    cargarTodo()
  }, [session])

  async function cargarTodo() {
    setLoading(true); setErr(null)
    const [rRes, lRes, iRes] = await Promise.all([
      apiFetch('/api/recetas'),
      supabase.from('loyverse_items').select('loyverse_id, item_name').order('item_name'),
      apiFetch('/api/insumos'),
    ])
    const rJson = await rRes.json()
    if (!rRes.ok) { setErr(rJson.error || 'Error') }
    setItems(rJson.recetas || [])
    setLoyverseItems(lRes.data || [])
    const iJson = await iRes.json()
    setInsumos(iJson.insumos || [])
    setLoading(false)
  }

  async function recalcular() {
    if (!confirm('¿Refrescar costos de TODAS las recetas con los costos actuales de insumos? (incluye sub-recetas en orden correcto)')) return
    setRecalculando(true)
    const res = await apiFetch('/api/recetas/recalcular', { method: 'POST' })
    setRecalculando(false)
    if (res.ok) cargarTodo()
  }

  const esAdmin = perfil?.rol === 'admin'

  const filtradas = useMemo(() =>
    items
      .filter(r => !busqueda || r.nombre.toLowerCase().includes(busqueda.toLowerCase()))
      .filter(r => tipoFiltro === 'todas' || (r.tipo || 'comida') === tipoFiltro),
    [items, busqueda, tipoFiltro])

  const conteoTipos = useMemo(() => {
    let comida = 0, bebida = 0
    for (const r of items) {
      if ((r.tipo || 'comida') === 'bebida') bebida++; else comida++
    }
    return { comida, bebida, total: items.length }
  }, [items])

  const stats = useMemo(() => {
    const conMargen = items.filter(r => r.margen_pct != null)
    const avgMargen = conMargen.length > 0
      ? conMargen.reduce((s, r) => s + Number(r.margen_pct), 0) / conMargen.length
      : null
    return {
      cantidad: items.length,
      sin_loyverse: items.filter(r => !r.loyverse_item_id).length,
      avg_margen: avgMargen,
    }
  }, [items])

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
          <h1 className="text-xl font-bold text-gray-900">Recetas (productos compuestos)</h1>
          {esAdmin && (
            <div className="flex gap-2">
              <button onClick={recalcular} disabled={recalculando} className="btn-secundario">
                {recalculando ? '…' : 'Recalcular costos'}
              </button>
              <button onClick={() => setModal({ tipo: 'nueva' })} className="btn-primario">+ Nueva receta</button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3 mb-4">
          <KpiBox label="Recetas activas" value={stats.cantidad} />
          <KpiBox label="Sin enlace a Loyverse" value={stats.sin_loyverse} tone={stats.sin_loyverse > 0 ? 'amber' : 'gray'} />
          <KpiBox label="Margen promedio" value={fmtPct(stats.avg_margen)} />
        </div>

        <div className="flex flex-wrap gap-2 items-center mb-3">
          <input type="text" placeholder="Buscar receta…" value={busqueda} onChange={e => setBusqueda(e.target.value)}
            className="input max-w-md flex-1" />
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 text-sm">
            <FiltroTipoBtn active={tipoFiltro === 'todas'}  onClick={() => setTipoFiltro('todas')}>
              Todas <span className="opacity-50">({conteoTipos.total})</span>
            </FiltroTipoBtn>
            <FiltroTipoBtn active={tipoFiltro === 'comida'} onClick={() => setTipoFiltro('comida')}>
              Comida <span className="opacity-50">({conteoTipos.comida})</span>
            </FiltroTipoBtn>
            <FiltroTipoBtn active={tipoFiltro === 'bebida'} onClick={() => setTipoFiltro('bebida')}>
              Bebidas <span className="opacity-50">({conteoTipos.bebida})</span>
            </FiltroTipoBtn>
          </div>
        </div>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

        <div className="card-julia overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Receta</th>
                <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Producto Loyverse</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Rinde</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Costo unit.</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Precio</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Margen</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1,2,3].map(i => <tr key={i}><td colSpan={7}><SkeletonRow /></td></tr>)}</>
              ) : filtradas.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-xs text-gray-400 py-8">
                  {items.length === 0 ? 'Sin recetas aún.' : 'Sin resultados.'}
                  {esAdmin && items.length === 0 && (
                    <button onClick={() => setModal({tipo:'nueva'})} className="text-julia-red hover:underline ml-1">Crear la primera →</button>
                  )}
                </td></tr>
              ) : filtradas
                .slice()
                .sort((a, b) => {
                  const ta = (a.tipo || 'comida'), tb = (b.tipo || 'comida')
                  if (ta !== tb) return ta === 'comida' ? -1 : 1
                  return a.nombre.localeCompare(b.nombre, 'es')
                })
                .map((r, idx, arr) => {
                const margenCls = r.margen_pct == null ? 'text-gray-400'
                                : Number(r.margen_pct) < 30 ? 'text-amber-600'
                                : 'text-green-700'
                const efectivo = costoEfectivo(r)
                const esPersonalizado = r.costo_personalizado != null
                const tipoR = r.tipo || 'comida'
                const tipoPrev = idx > 0 ? (arr[idx - 1].tipo || 'comida') : null
                const mostrarHeader = tipoFiltro === 'todas' && tipoR !== tipoPrev
                return (
                  <Fragment key={r.id}>
                  {mostrarHeader && (
                    <tr className="bg-gray-50/80">
                      <td colSpan={7} className="px-3 py-1.5 text-[11px] uppercase tracking-wider text-gray-500 font-medium">
                        {tipoR === 'bebida' ? 'Bebidas' : 'Comida'}
                      </td>
                    </tr>
                  )}
                  <tr className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-800">{r.nombre}</td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {r.loyverse_items?.item_name || <span className="text-amber-500">— sin enlace —</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-600 tabular-nums">
                      {fmt(r.rinde_cantidad)} <span className="text-xs text-gray-400">{r.rinde_unidad}</span>
                      {r.peso_unitario_g != null && (
                        <div className="text-[10px] text-gray-400 tabular-nums">{fmt(r.peso_unitario_g)} g/u</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 tabular-nums">
                      {efectivo > 0 ? fmtQ(efectivo) : '—'}
                      {esPersonalizado && <span className="ml-1 text-[10px] bg-violet-100 text-violet-700 px-1 rounded">manual</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{r.precio_venta != null ? fmtQ(r.precio_venta) : '—'}</td>
                    <td className={`px-3 py-2 text-right font-medium tabular-nums ${margenCls}`}>{fmtPct(r.margen_pct)}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={async () => {
                            try {
                              const res = await apiFetch(`/api/recetas/${r.id}`)
                              const j = await res.json()
                              if (!j.ok) throw new Error(j.error || 'Falla al cargar receta')
                              const { generarPDFReceta } = await import('../lib/pdf/recetas')
                              await generarPDFReceta(j.receta)
                            } catch (e) {
                              alert('Error generando PDF: ' + (e?.message || e))
                            }
                          }}
                          className="text-xs text-gray-600 hover:text-julia-red flex items-center gap-1"
                          title="Descargar receta en PDF"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          PDF
                        </button>
                        <button onClick={() => setModal({ tipo: 'editar', id: r.id })} className="text-xs text-julia-red hover:underline">abrir</button>
                      </div>
                    </td>
                  </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>

        {modal && (
          <ModalReceta
            recetaId={modal.tipo === 'editar' ? modal.id : null}
            loyverseItems={loyverseItems}
            insumos={insumos}
            recetas={items}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); cargarTodo() }}
          />
        )}
      </div>
    </Layout>
  )
}

function FiltroTipoBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${
        active ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-800'
      }`}>{children}</button>
  )
}

function KpiBox({ label, value, tone = 'gray' }) {
  const tones = {
    gray:  'border-gray-100 text-gray-800',
    amber: 'border-amber-100 text-amber-700 bg-amber-50',
  }
  return (
    <div className={`bg-white border rounded-xl p-3 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-semibold mt-1 tabular-nums">{value}</div>
    </div>
  )
}

// ============================================================================

function ModalReceta({ recetaId, loyverseItems, insumos, recetas, onClose, onSaved }) {
  const edicion = !!recetaId
  const [loading, setLoading] = useState(edicion)
  const [cab, setCab] = useState({
    loyverse_item_id: '',
    nombre: '',
    rinde_cantidad: 1,
    rinde_unidad: 'unidad',
    merma_pct: 0,
    precio_venta: '',
    costo_personalizado: '',
    peso_unitario_g: '',
    tipo: 'comida',
    notas: '',
    activa: true,
  })
  // Cada linea: componente_id con prefijo 'i:' (insumo) o 'r:' (sub-receta)
  const [ings, setIngs] = useState([{ componente_id: '', cantidad: '', unidad: '', notas: '' }])
  const [err, setErr] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando] = useState(false)

  useEffect(() => {
    if (!edicion) return
    (async () => {
      const res = await apiFetch(`/api/recetas/${recetaId}`)
      const json = await res.json()
      if (!res.ok) { setErr(json.error); setLoading(false); return }
      setCab({
        loyverse_item_id: json.receta.loyverse_item_id || '',
        nombre: json.receta.nombre,
        rinde_cantidad: json.receta.rinde_cantidad,
        rinde_unidad: json.receta.rinde_unidad || 'unidad',
        merma_pct: json.receta.merma_pct || 0,
        precio_venta: json.receta.precio_venta ?? '',
        costo_personalizado: json.receta.costo_personalizado ?? '',
        peso_unitario_g: json.receta.peso_unitario_g ?? '',
        tipo: json.receta.tipo || 'comida',
        notas: json.receta.notas || '',
        activa: json.receta.activa,
      })
      setIngs((json.receta.ingredientes || []).map(i => ({
        componente_id: i.insumo_id ? 'i:' + i.insumo_id : 'r:' + i.sub_receta_id,
        cantidad: i.cantidad,
        unidad: i.unidad || '',
        notas: i.notas || '',
      })))
      setLoading(false)
    })()
  }, [recetaId])

  const itemsDisponibles = useMemo(() => {
    const conReceta = new Set(recetas
      .filter(r => r.id !== recetaId && r.loyverse_item_id)
      .map(r => r.loyverse_item_id))
    return loyverseItems.filter(it => !conReceta.has(it.loyverse_id) || it.loyverse_id === cab.loyverse_item_id)
  }, [loyverseItems, recetas, cab.loyverse_item_id, recetaId])

  // Opciones del dropdown: insumos + recetas (excepto la actual).
  // Para sub-recetas, costo unitario = costo_calculado / rinde (precio por gramo o unidad de la sub-receta).
  const opcionesComponente = useMemo(() => {
    const ins = insumos.map(x => ({
      value: 'i:' + x.id, label: x.nombre,
      tipo: 'insumo', unidad: x.unidad,
      costo: Number(x.costo_unitario) || 0,
      sin_costo: x.costo_unitario == null,
    }))
    const rec = recetas
      .filter(r => r.id !== recetaId && r.activa)
      .map(r => {
        const rinde = Math.max(Number(r.rinde_cantidad) || 1, 0.0001)
        return {
          value: 'r:' + r.id, label: r.nombre,
          tipo: 'receta', unidad: r.rinde_unidad || 'unidad',
          // costo_calculado YA es por unidad del rinde — usar directo
          costo: Number(r.costo_calculado) || 0,
          sin_costo: !r.costo_calculado,
          rinde,
        }
      })
    return [...ins, ...rec].sort((a, b) => a.label.localeCompare(b.label))
  }, [insumos, recetas, recetaId])

  function setLin(i, k, v) {
    setIngs(arr => arr.map((l, idx) => {
      if (idx !== i) return l
      const next = { ...l, [k]: v }
      if (k === 'componente_id' && v) {
        const op = opcionesComponente.find(o => o.value === v)
        if (op && !l.unidad) next.unidad = op.unidad
      }
      return next
    }))
  }

  function eligeProductoLoyverse(item_id) {
    const it = loyverseItems.find(i => i.loyverse_id === item_id)
    setCab(c => ({
      ...c,
      loyverse_item_id: item_id,
      nombre: c.nombre || (it?.item_name || ''),
    }))
  }

  // Costeo en vivo
  // Conversion de unidades: si `i.unidad` y `op.unidad` (unidad base del insumo
  // o rinde_unidad de la sub-receta) son convertibles via lib/unidades.js, se
  // aplica el factor automaticamente. Sino, factor=1 (legacy).
  const costeoVivo = useMemo(() => {
    const detalle = ings.filter(i => i.componente_id && Number(i.cantidad) > 0).map(i => {
      const op = opcionesComponente.find(o => o.value === i.componente_id)
      const cant = Number(i.cantidad) || 0
      const { factor, convertido, dudoso } = factorIngrediente(i.unidad, op?.unidad)
      const subtotal = cant * factor * (op?.costo || 0)
      return {
        cantidad: cant,
        costo_unit: op?.costo || 0,
        nombre: op?.label || '',
        tipo: op?.tipo,
        unidad: i.unidad || op?.unidad,
        unidad_base: op?.unidad,
        factor_conversion: factor,
        convertido,
        dudoso,
        sin_costo: !op || op.sin_costo,
        subtotal,
      }
    })
    const totalReceta = detalle.reduce((s, i) => s + i.subtotal, 0)
    const rinde = Math.max(Number(cab.rinde_cantidad) || 1, 0.0001)
    const merma = (Number(cab.merma_pct) || 0) / 100
    const costoUnidad = (totalReceta / rinde) * (1 + merma)
    // Si hay costo personalizado, ese es el "efectivo" para margen y para uso como sub-receta
    const cp = cab.costo_personalizado !== '' && cab.costo_personalizado != null ? Number(cab.costo_personalizado) : null
    const costoEfec = cp != null ? cp : costoUnidad
    const precio = cab.precio_venta !== '' ? Number(cab.precio_venta) : null
    const margen = precio ? calcularMargen(costoEfec, precio) : null
    return { detalle, totalReceta, costoUnidad, costoEfec, costoPers: cp, precio, margen }
  }, [ings, cab.rinde_cantidad, cab.merma_pct, cab.precio_venta, cab.costo_personalizado, opcionesComponente])

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const ingredientesPayload = ings
      .filter(i => i.componente_id && Number(i.cantidad) > 0)
      .map(i => {
        const isInsumo = i.componente_id.startsWith('i:')
        const id = i.componente_id.slice(2)
        return {
          insumo_id: isInsumo ? id : null,
          sub_receta_id: isInsumo ? null : id,
          cantidad: Number(i.cantidad),
          unidad: i.unidad || null,
          notas: i.notas || null,
        }
      })
    const payload = {
      ...cab,
      tipo: cab.tipo || 'comida',
      precio_venta: cab.precio_venta === '' ? null : Number(cab.precio_venta),
      costo_personalizado: cab.costo_personalizado === '' ? null : Number(cab.costo_personalizado),
      peso_unitario_g: cab.peso_unitario_g === '' ? null : Number(cab.peso_unitario_g),
      loyverse_item_id: cab.loyverse_item_id || null,
      ingredientes: ingredientesPayload,
    }
    const res = await apiFetch(
      edicion ? `/api/recetas/${recetaId}` : '/api/recetas',
      { method: edicion ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
    )
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  async function borrar() {
    if (!confirm('¿Dar de baja esta receta?')) return
    setBorrando(true); setErr(null)
    const res = await apiFetch(`/api/recetas/${recetaId}`, { method: 'DELETE' })
    const json = await res.json()
    setBorrando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  if (loading) {
    return (
      <ModalShell titulo="Receta" onClose={onClose}>
        <div className="text-sm text-gray-400">Cargando…</div>
      </ModalShell>
    )
  }

  return (
    <ModalShell titulo={edicion ? `Editar: ${cab.nombre}` : 'Nueva receta'} onClose={onClose} maxWidth="max-w-3xl">
      <form onSubmit={guardar} className="space-y-4">
        {/* Cabecera */}
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Producto en Loyverse">
            <select value={cab.loyverse_item_id} onChange={e => eligeProductoLoyverse(e.target.value)} className="input">
              <option value="">— sin enlace (intermedio / sub-receta) —</option>
              {itemsDisponibles.map(it => <option key={it.loyverse_id} value={it.loyverse_id}>{it.item_name}</option>)}
            </select>
          </Campo>
          <Campo label="Nombre de la receta" required>
            <input type="text" required value={cab.nombre} onChange={e => setCab({...cab, nombre: e.target.value})} className="input" />
          </Campo>
        </div>

        <Campo label="Tipo">
          <div className="flex gap-2">
            {[
              { v: 'comida', label: 'Comida' },
              { v: 'bebida', label: 'Bebida' },
            ].map(opt => (
              <label key={opt.v}
                className={`flex-1 cursor-pointer text-center px-3 py-2 border rounded-lg text-sm transition ${
                  cab.tipo === opt.v
                    ? 'bg-julia-red/10 border-julia-red text-julia-red font-medium'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>
                <input type="radio" name="tipo" value={opt.v}
                  checked={cab.tipo === opt.v}
                  onChange={() => setCab({ ...cab, tipo: opt.v })}
                  className="sr-only" />
                {opt.label}
              </label>
            ))}
          </div>
        </Campo>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Campo label="Rinde (cantidad)" required>
            <input type="number" step="any" required value={cab.rinde_cantidad} onChange={e => setCab({...cab, rinde_cantidad: e.target.value})} className="input" />
          </Campo>
          <Campo label="Unidad">
            <input type="text" value={cab.rinde_unidad} onChange={e => setCab({...cab, rinde_unidad: e.target.value})} className="input" placeholder="unidad, g, ml…" />
          </Campo>
          <Campo label="Merma %">
            <input type="number" step="any" value={cab.merma_pct} onChange={e => setCab({...cab, merma_pct: e.target.value})} className="input" placeholder="0" />
          </Campo>
          <Campo label="Peso unitario (g)">
            <input type="number" step="any" min="0" value={cab.peso_unitario_g}
              onChange={e => setCab({...cab, peso_unitario_g: e.target.value})}
              className="input" placeholder="ej. 80" title="Peso de UNA unidad del producto terminado, en gramos. Informativo, no afecta el costeo." />
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Precio de venta (Q por unidad)">
            <input type="number" step="any" value={cab.precio_venta} onChange={e => setCab({...cab, precio_venta: e.target.value})} className="input" placeholder="opcional" />
          </Campo>
          <Campo label="Costo personalizado (Q por unidad)">
            <div className="flex gap-1">
              <input type="number" step="any" value={cab.costo_personalizado} onChange={e => setCab({...cab, costo_personalizado: e.target.value})} className="input"
                placeholder={`auto: ${fmtQ(costeoVivo.costoUnidad)}`} />
              {cab.costo_personalizado !== '' && (
                <button type="button" onClick={() => setCab({...cab, costo_personalizado: ''})}
                  className="text-xs text-gray-400 hover:text-red-500 px-2">↻</button>
              )}
            </div>
          </Campo>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          El costo personalizado sobrescribe el calculado automático.
          Útil para sumar mano de obra, energía, o cuando algún insumo no está cargado.
          Dejá vacío para usar el calculado.
        </p>

        {/* Ingredientes */}
        <div>
          <div className="flex justify-between items-baseline mb-1">
            <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Ingredientes (por toda la receta)</div>
            <button type="button" onClick={() => setIngs(arr => [...arr, { componente_id: '', cantidad: '', unidad: '', notas: '' }])}
              className="text-xs text-julia-red hover:underline">+ Agregar</button>
          </div>
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-normal w-16">Tipo</th>
                  <th className="px-2 py-1.5 text-left font-normal">Insumo / Sub-receta</th>
                  <th className="px-2 py-1.5 text-right font-normal w-20">Cantidad</th>
                  <th className="px-2 py-1.5 text-left font-normal w-16">Unidad</th>
                  <th className="px-2 py-1.5 text-right font-normal w-24">Costo Q</th>
                  <th className="px-2 py-1.5 text-left font-normal">Notas</th>
                  <th className="px-1 py-1.5 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {ings.map((l, i) => {
                  const op = opcionesComponente.find(o => o.value === l.componente_id)
                  const conv = factorIngrediente(l.unidad, op?.unidad)
                  const sub = (Number(l.cantidad) || 0) * conv.factor * (op?.costo || 0)
                  return (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-2 py-1">
                        {op ? (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            op.tipo === 'receta' ? 'bg-violet-100 text-violet-700' : 'bg-blue-50 text-blue-700'
                          }`}>{op.tipo === 'receta' ? 'sub-rec' : 'insumo'}</span>
                        ) : <span className="text-gray-300 text-xs">—</span>}
                      </td>
                      <td className="px-2 py-1">
                        <SelectorComponente
                          valor={l.componente_id}
                          opciones={opcionesComponente}
                          onChange={(val) => setLin(i, 'componente_id', val)}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" step="any" value={l.cantidad} onChange={e => setLin(i, 'cantidad', e.target.value)}
                          className="w-full border border-gray-200 rounded px-1 py-1 text-xs text-right" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="text" value={l.unidad} onChange={e => setLin(i, 'unidad', e.target.value)}
                          className={`w-full border rounded px-1 py-1 text-xs ${
                            conv.dudoso ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
                          }`}
                          placeholder={op?.unidad || ''}
                          title={conv.dudoso
                            ? `La unidad "${l.unidad}" no es convertible a "${op?.unidad}" — el costo se calcula como si la cantidad ya estuviera en la unidad base.`
                            : conv.convertido
                              ? `Convertido: 1 ${l.unidad} = ${conv.factor} ${op?.unidad}`
                              : ''} />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-gray-700">
                        {sub > 0 ? fmt(sub) : ''}
                        {conv.convertido && sub > 0 && (
                          <div className="text-[10px] text-gray-400">×{conv.factor < 1 ? conv.factor.toFixed(4) : conv.factor.toFixed(2)}</div>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <input type="text" value={l.notas} onChange={e => setLin(i, 'notas', e.target.value)}
                          className="w-full border border-gray-200 rounded px-1 py-1 text-xs" />
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button type="button" onClick={() => setIngs(arr => arr.filter((_, idx) => idx !== i))}
                          className="text-gray-400 hover:text-red-500 text-sm">×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Costeo en vivo */}
        <div className="bg-julia-cream/30 border border-julia-cream rounded-lg p-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
          <Dato label="Costo total receta">{fmtQ(costeoVivo.totalReceta)}</Dato>
          <Dato label="Costo calculado">{fmtQ(costeoVivo.costoUnidad)}</Dato>
          <Dato label="Costo efectivo" bold>
            {fmtQ(costeoVivo.costoEfec)}
            {costeoVivo.costoPers != null && <span className="ml-1 text-[10px] bg-violet-100 text-violet-700 px-1 rounded">manual</span>}
          </Dato>
          <Dato label="Precio venta">{costeoVivo.precio != null ? fmtQ(costeoVivo.precio) : '—'}</Dato>
          <Dato label="Margen" bold>{fmtPct(costeoVivo.margen)}</Dato>
        </div>
        {costeoVivo.detalle.some(i => i.sin_costo) && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">
            ⚠ Algunos insumos/sub-recetas no tienen costo cargado — el costeo no es exacto.
          </div>
        )}
        {costeoVivo.detalle.some(i => i.dudoso) && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">
            ⚠ Hay ingredientes cuya unidad no se puede convertir automáticamente a la unidad base del insumo (resaltados en ámbar).
            El costeo asume que la cantidad ya está en unidad base — revisá manualmente.
          </div>
        )}
        {costeoVivo.detalle.some(i => i.convertido) && !costeoVivo.detalle.some(i => i.dudoso) && (
          <div className="text-xs text-gray-500">
            ✓ Conversión de unidades aplicada automáticamente donde corresponde.
          </div>
        )}

        <Campo label="Notas">
          <textarea rows={2} value={cab.notas} onChange={e => setCab({...cab, notas: e.target.value})} className="input" />
        </Campo>

        {edicion && (
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={cab.activa} onChange={e => setCab({...cab, activa: e.target.checked})} className="rounded" />
            Activa
          </label>
        )}

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-between items-baseline gap-2 pt-2 border-t border-gray-100">
          <div>
            {edicion && (
              <button type="button" onClick={borrar} disabled={borrando}
                className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">
                Dar de baja
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
            <button type="submit" disabled={guardando} className="btn-primario">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  )
}

function Dato({ label, children, bold }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`tabular-nums ${bold ? 'text-gray-900 font-semibold' : 'text-gray-700'}`}>{children}</div>
    </div>
  )
}

function ModalShell({ titulo, onClose, children, maxWidth = 'max-w-md' }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${maxWidth} my-8`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function Campo({ label, required, children }) {
  return (
    <div className="flex-1">
      <label className="text-xs text-gray-500 block mb-1">
        {label}{required && <span className="text-julia-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

// ============================================================================
// SelectorComponente — autocomplete con sugerencias filtradas
//
// Reemplaza el <select> con optgroups por un input buscable que filtra
// insumos + sub-recetas mientras se teclea. UX similar a Linear / Notion.
// ============================================================================

function SelectorComponente({ valor, opciones, onChange }) {
  const elegido = opciones.find(o => o.value === valor)
  const [query, setQuery] = useState('')
  const [abierto, setAbierto] = useState(false)
  const [indiceActivo, setIndiceActivo] = useState(0)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)

  // Cerrar al click fuera
  useEffect(() => {
    if (!abierto) return
    function onClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setAbierto(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [abierto])

  // Cuando abre, foco al input y reset
  useEffect(() => {
    if (abierto) {
      setQuery('')
      setIndiceActivo(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [abierto])

  // Filtrado case-insensitive: busca el query en cualquier parte del label.
  // Si q está vacío, mostramos las primeras 100 opciones (insumos primero,
  // alfabético) para no abrumar al abrir. Si hay query, mostramos TODOS los
  // que matcheen — sin tope, así no se pierden insumos cuando hay 130+.
  const filtradas = (() => {
    const q = query.trim().toLowerCase()
    const orden = [...opciones].sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'insumo' ? -1 : 1
      return a.label.localeCompare(b.label, 'es', { sensitivity: 'base' })
    })
    if (!q) return orden.slice(0, 100)
    return orden.filter(o => o.label.toLowerCase().includes(q))
  })()

  function elegir(op) {
    onChange(op.value)
    setAbierto(false)
    setQuery('')
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndiceActivo(i => Math.min(filtradas.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndiceActivo(i => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtradas[indiceActivo]) elegir(filtradas[indiceActivo])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setAbierto(false)
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      {!abierto && (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs text-left bg-white hover:bg-gray-50 truncate"
        >
          {elegido ? (
            <span className="flex items-center gap-1.5 truncate">
              <span className={`text-[9px] px-1 py-0.5 rounded font-medium flex-shrink-0 ${
                elegido.tipo === 'receta' ? 'bg-violet-100 text-violet-700' : 'bg-blue-50 text-blue-700'
              }`}>{elegido.tipo === 'receta' ? 'sub-rec' : 'insumo'}</span>
              <span className="truncate">{elegido.label}</span>
            </span>
          ) : (
            <span className="text-gray-400">— elegir o tipear nombre —</span>
          )}
        </button>
      )}

      {abierto && (
        <div className="absolute top-0 left-0 z-30 w-72 bg-white border border-gray-300 rounded-md shadow-lg">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndiceActivo(0) }}
            onKeyDown={onKeyDown}
            placeholder="Buscar insumo o sub-receta..."
            className="w-full px-2 py-1.5 text-xs border-b border-gray-200 outline-none"
          />
          <div className="max-h-64 overflow-y-auto">
            {filtradas.length === 0 ? (
              <div className="px-2 py-3 text-xs text-gray-400 text-center">
                Sin resultados para "{query}"
              </div>
            ) : filtradas.map((o, idx) => (
              <button
                key={o.value}
                type="button"
                onClick={() => elegir(o)}
                onMouseEnter={() => setIndiceActivo(idx)}
                className={`w-full text-left px-2 py-1.5 text-xs flex items-center gap-2 border-b border-gray-50 last:border-0 ${
                  idx === indiceActivo ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
              >
                <span className={`text-[9px] px-1 py-0.5 rounded font-medium flex-shrink-0 ${
                  o.tipo === 'receta' ? 'bg-violet-100 text-violet-700' : 'bg-blue-50 text-blue-700'
                }`}>{o.tipo === 'receta' ? 'sub-rec' : 'insumo'}</span>
                <span className="flex-1 truncate">{o.label}</span>
                {o.tipo === 'receta' && o.rinde && (
                  <span className="text-[10px] text-gray-400 flex-shrink-0">rinde {o.rinde} {o.unidad}</span>
                )}
                {o.tipo === 'insumo' && o.sin_costo && (
                  <span className="text-[10px] text-amber-600 flex-shrink-0">sin costo</span>
                )}
              </button>
            ))}
          </div>
          <div className="px-2 py-1 text-[10px] text-gray-400 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <span>↑↓ navegar · Enter elegir · Esc cerrar</span>
            <span>{filtradas.length} resultado{filtradas.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
      )}
    </div>
  )
}
