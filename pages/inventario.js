import { Fragment, useEffect, useMemo, useState } from 'react'
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
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-900">Inventario</h1>
        </div>

        <div className="flex gap-1 border-b border-gray-200 mb-5">
          <TabBtn active={tab === 'terminados'} onClick={() => setTab('terminados')}>Productos terminados</TabBtn>
          <TabBtn active={tab === 'insumos'}    onClick={() => setTab('insumos')}>Insumos</TabBtn>
        </div>

        {tab === 'terminados' && <TabTerminados />}
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
// Tab 1: Productos terminados (Loyverse — solo lectura, lo que ya teniamos)
// ============================================================================

function TabTerminados() {
  const [loading, setLoading] = useState(true)
  const [filas, setFilas] = useState([])

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const [{ data: inv }, { data: items }] = await Promise.all([
      supabase.from('loyverse_inventory_levels').select('variant_id, store_id, in_stock, updated_at'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, variants'),
    ])
    const mapVar = {}
    for (const it of items || []) {
      const variantes = Array.isArray(it.variants) ? it.variants : []
      for (const v of variantes) {
        if (v.variant_id) mapVar[v.variant_id] = {
          item_name: it.item_name,
          variant_name: v.option1_value || v.option_value || null,
          sku: v.sku || null,
        }
      }
    }
    const rows = (inv || []).map(r => ({
      ...r,
      ...(mapVar[r.variant_id] || { item_name: '—', variant_name: null, sku: null }),
    })).sort((a, b) => (a.item_name || '').localeCompare(b.item_name || ''))
    setFilas(rows)
    setLoading(false)
  }

  return (
    <div>
      <div className="text-xs text-gray-400 mb-2">
        {filas.length} variantes con stock · datos de Loyverse, actualizados cada 15 min
      </div>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Producto</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">SKU</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">En stock</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Actualizado</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1, 2, 3, 4, 5].map(i => <tr key={i}><td colSpan={4}><SkeletonRow /></td></tr>)}</>
            ) : filas.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-xs text-gray-400 py-8">Sin datos de inventario.</td></tr>
            ) : (
              filas.map(r => {
                const bajo = Number(r.in_stock || 0) <= 5
                return (
                  <tr key={`${r.variant_id}-${r.store_id}`} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700">
                      {r.item_name}
                      {r.variant_name && <span className="text-xs text-gray-400 ml-1">/ {r.variant_name}</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{r.sku || '—'}</td>
                    <td className={`px-4 py-2.5 text-right ${bajo ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                      {formatNum(r.in_stock)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                      {formatFecha(r.updated_at)}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
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
