import { useEffect, useMemo, useState } from 'react'
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

const fmt = n => Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtQ = n => 'Q ' + fmt(n)

function formatFecha(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })
}

function hoyGT() {
  const ms = Date.now() - 6 * 3600 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

function inicioMesGT() {
  const d = new Date(Date.now() - 6 * 3600 * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

const ESTADOS = {
  borrador: { label: 'Borrador', cls: 'bg-gray-100 text-gray-700' },
  posteado: { label: 'Posteado', cls: 'bg-green-50 text-green-700' },
  anulado:  { label: 'Anulado',  cls: 'bg-red-50 text-red-700' },
}

// ============================================================================
// Pagina
// ============================================================================

export default function Contabilidad({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [tab, setTab] = useState('asientos')

  useEffect(() => {
    if (!session) { router.push('/'); return }
    (async () => {
      const { data } = await supabase.from('perfiles')
        .select('id, email, nombre_completo, rol, activo')
        .eq('id', session.user.id).single()
      setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' })
    })()
  }, [session])

  const esAdmin = perfil?.rol === 'admin'

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">Contabilidad</h1>

        <div className="flex gap-1 border-b border-gray-200 mb-5 overflow-x-auto">
          <TabBtn active={tab === 'asientos'} onClick={() => setTab('asientos')}>Asientos</TabBtn>
          <TabBtn active={tab === 'cuentas'}  onClick={() => setTab('cuentas')}>Plan de cuentas</TabBtn>
          <TabBtn active={tab === 'mayor'}    onClick={() => setTab('mayor')}>Libro mayor</TabBtn>
          <TabBtn active={tab === 'balance'}  onClick={() => setTab('balance')}>Balance comprobación</TabBtn>
          <TabBtn active={tab === 'config'}   onClick={() => setTab('config')}>Configuración</TabBtn>
        </div>

        {tab === 'asientos' && <TabAsientos esAdmin={esAdmin} />}
        {tab === 'cuentas'  && <TabCuentas esAdmin={esAdmin} />}
        {tab === 'mayor'    && <TabLibroMayor />}
        {tab === 'balance'  && <TabBalance />}
        {tab === 'config'   && <TabConfigMappings esAdmin={esAdmin} />}
      </div>
    </Layout>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
        active ? 'border-b-2 border-julia-red text-julia-red' : 'text-gray-500 hover:text-gray-800'
      }`}>{children}</button>
  )
}

// ============================================================================
// Tab Asientos
// ============================================================================

function TabAsientos({ esAdmin }) {
  const [items, setItems] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [loading, setLoading] = useState(true)
  const [desde, setDesde] = useState(inicioMesGT())
  const [hasta, setHasta] = useState(hoyGT())
  const [estado, setEstado] = useState('')
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null) // {tipo: 'nuevo'|'detalle', id?}

  useEffect(() => { cargarCuentas() }, [])
  useEffect(() => { cargar() }, [desde, hasta, estado])

  async function cargarCuentas() {
    const res = await apiFetch('/api/cuentas')
    const json = await res.json()
    setCuentas(json.cuentas || [])
  }

  async function cargar() {
    setLoading(true); setErr(null)
    const params = new URLSearchParams()
    if (desde)  params.set('desde', desde)
    if (hasta)  params.set('hasta', hasta)
    if (estado) params.set('estado', estado)
    const res = await apiFetch('/api/asientos?' + params.toString())
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Error'); setItems([]) }
    else setItems(json.asientos || [])
    setLoading(false)
  }

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Desde</span>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="input" />
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Hasta</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="input" />
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Estado</span>
          <select value={estado} onChange={e => setEstado(e.target.value)} className="input">
            <option value="">Todos</option>
            <option value="borrador">Borrador</option>
            <option value="posteado">Posteado</option>
            <option value="anulado">Anulado</option>
          </select>
        </label>
        <div className="self-end text-right">
          {esAdmin && (
            <button onClick={() => setModal({ tipo: 'nuevo' })} className="btn-primario">+ Nuevo asiento</button>
          )}
        </div>
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">N°</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Fecha</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Descripción</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Monto</th>
              <th className="text-center text-xs text-gray-400 font-normal px-4 py-2">Estado</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Origen</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1,2,3].map(i => <tr key={i}><td colSpan={7}><SkeletonRow /></td></tr>)}</>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-xs text-gray-400 py-8">
                Sin asientos en este rango.
              </td></tr>
            ) : items.map(a => {
              const est = ESTADOS[a.estado] || ESTADOS.borrador
              return (
                <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-500 tabular-nums">#{a.numero}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">{formatFecha(a.fecha)}</td>
                  <td className="px-4 py-2 text-gray-800">{a.descripcion}</td>
                  <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{fmtQ(a.total_debe)}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${est.cls}`}>{est.label}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400">{a.origen_tipo || '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setModal({ tipo: 'detalle', id: a.id })} className="text-xs text-julia-red hover:underline">Ver</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal?.tipo === 'nuevo' && (
        <ModalNuevoAsiento cuentas={cuentas} onClose={() => setModal(null)} onSaved={() => { setModal(null); cargar() }} />
      )}
      {modal?.tipo === 'detalle' && (
        <ModalDetalleAsiento id={modal.id} esAdmin={esAdmin} onClose={() => setModal(null)} onChanged={cargar} />
      )}
    </div>
  )
}

// ============================================================================
// Modal: nuevo asiento
// ============================================================================

function ModalNuevoAsiento({ cuentas, onClose, onSaved }) {
  const cuentasMov = cuentas.filter(c => c.es_movimiento && c.activo)
  const [fecha, setFecha] = useState(hoyGT())
  const [descripcion, setDescripcion] = useState('')
  const [partidas, setPartidas] = useState([
    { cuenta_id: '', concepto: '', debe: '', haber: '' },
    { cuenta_id: '', concepto: '', debe: '', haber: '' },
  ])
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  function setPart(i, k, v) {
    setPartidas(ps => ps.map((p, idx) => {
      if (idx !== i) return p
      const next = { ...p, [k]: v }
      // Si se llena debe, limpiar haber (y viceversa)
      if (k === 'debe' && Number(v) > 0) next.haber = ''
      if (k === 'haber' && Number(v) > 0) next.debe = ''
      return next
    }))
  }

  const totalDebe = partidas.reduce((s, p) => s + (Number(p.debe) || 0), 0)
  const totalHaber = partidas.reduce((s, p) => s + (Number(p.haber) || 0), 0)
  const balanceado = Math.abs(totalDebe - totalHaber) < 0.01 && totalDebe > 0

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const partidasValidas = partidas
      .filter(p => p.cuenta_id && ((Number(p.debe) || 0) > 0 || (Number(p.haber) || 0) > 0))
      .map(p => ({
        cuenta_id: p.cuenta_id,
        concepto: p.concepto || null,
        debe: Number(p.debe) || 0,
        haber: Number(p.haber) || 0,
      }))
    if (partidasValidas.length < 2) {
      setErr('Mínimo 2 partidas con cuenta y monto.'); setGuardando(false); return
    }
    const res = await apiFetch('/api/asientos', {
      method: 'POST',
      body: JSON.stringify({ fecha, descripcion, notas, partidas: partidasValidas }),
    })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  return (
    <ModalShell titulo="Nuevo asiento" onClose={onClose} maxWidth="max-w-3xl">
      <form onSubmit={guardar} className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Campo label="Fecha" required>
            <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className="input" />
          </Campo>
          <div className="col-span-2">
            <Campo label="Descripción" required>
              <input type="text" required value={descripcion} onChange={e => setDescripcion(e.target.value)} className="input"
                placeholder="ej. Cierre caja 21 mayo · Compra harina #1234" />
            </Campo>
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Partidas</div>
            <button type="button" onClick={() => setPartidas(ps => [...ps, { cuenta_id: '', concepto: '', debe: '', haber: '' }])}
              className="text-xs text-julia-red hover:underline">+ Agregar línea</button>
          </div>
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-normal">Cuenta</th>
                  <th className="px-2 py-1.5 text-left font-normal">Concepto</th>
                  <th className="px-2 py-1.5 text-right font-normal w-28">Debe</th>
                  <th className="px-2 py-1.5 text-right font-normal w-28">Haber</th>
                  <th className="px-1 py-1.5 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {partidas.map((p, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-2 py-1">
                      <select value={p.cuenta_id} onChange={e => setPart(i, 'cuenta_id', e.target.value)} className="w-full border border-gray-200 rounded px-1 py-1 text-xs">
                        <option value="">— elegir —</option>
                        {cuentasMov.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-1">
                      <input type="text" value={p.concepto} onChange={e => setPart(i, 'concepto', e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" step="0.01" value={p.debe} onChange={e => setPart(i, 'debe', e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right" />
                    </td>
                    <td className="px-2 py-1">
                      <input type="number" step="0.01" value={p.haber} onChange={e => setPart(i, 'haber', e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right" />
                    </td>
                    <td className="px-1 py-1 text-center">
                      <button type="button" onClick={() => setPartidas(ps => ps.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500 text-sm">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 text-xs">
                <tr>
                  <td colSpan={2} className="px-2 py-1.5 text-right text-gray-500">Totales</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(totalDebe)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold">{fmt(totalHaber)}</td>
                  <td></td>
                </tr>
                <tr>
                  <td colSpan={2} className="px-2 py-1 text-right text-xs text-gray-500">Diferencia</td>
                  <td colSpan={2} className={`px-2 py-1 text-right tabular-nums font-medium ${balanceado ? 'text-green-700' : 'text-red-600'}`}>
                    {balanceado ? '✓ Balanceado' : fmt(totalDebe - totalHaber)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <Campo label="Notas">
          <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)} className="input" />
        </Campo>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando || !balanceado} className="btn-primario">
            {guardando ? 'Guardando…' : 'Guardar borrador'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

// ============================================================================
// Modal: detalle asiento
// ============================================================================

function ModalDetalleAsiento({ id, esAdmin, onClose, onChanged }) {
  const [a, setA] = useState(null)
  const [err, setErr] = useState(null)
  const [accionando, setAccionando] = useState(false)
  const [motivoAnular, setMotivoAnular] = useState('')
  const [mostrarAnular, setMostrarAnular] = useState(false)

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    const res = await apiFetch(`/api/asientos/${id}`)
    const json = await res.json()
    if (!res.ok) setErr(json.error || 'Error')
    else setA(json.asiento)
  }

  async function postear() {
    if (!confirm('¿Postear este asiento? Después solo se podrá anular, no editar.')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/asientos/${id}/postear`, { method: 'POST' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    await cargar(); onChanged?.()
  }

  async function anular() {
    if (!motivoAnular.trim()) { setErr('Motivo requerido'); return }
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/asientos/${id}/anular`, {
      method: 'POST', body: JSON.stringify({ motivo: motivoAnular }),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    setMostrarAnular(false); setMotivoAnular('')
    await cargar(); onChanged?.()
  }

  async function borrar() {
    if (!confirm('¿Borrar este borrador?')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/asientos/${id}`, { method: 'DELETE' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onChanged?.(); onClose()
  }

  if (!a) return <ModalShell titulo="Asiento" onClose={onClose}><div className="text-sm text-gray-400">{err || 'Cargando…'}</div></ModalShell>

  const est = ESTADOS[a.estado]

  return (
    <ModalShell titulo={`Asiento #${a.numero}`} onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm items-baseline">
          <div><div className="text-xs text-gray-400">Fecha</div><div>{formatFecha(a.fecha)}</div></div>
          <div className="flex-1 min-w-[200px]"><div className="text-xs text-gray-400">Descripción</div><div className="text-gray-800">{a.descripcion}</div></div>
          <div><div className="text-xs text-gray-400">Estado</div><span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${est.cls}`}>{est.label}</span></div>
        </div>

        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-400">
              <tr>
                <th className="px-2 py-1.5 text-left font-normal">Cuenta</th>
                <th className="px-2 py-1.5 text-left font-normal">Concepto</th>
                <th className="px-2 py-1.5 text-right font-normal">Debe</th>
                <th className="px-2 py-1.5 text-right font-normal">Haber</th>
              </tr>
            </thead>
            <tbody>
              {(a.partidas || []).map(p => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="px-2 py-1.5"><span className="text-gray-500">{p.cuentas_contables?.codigo}</span> <span className="text-gray-800">{p.cuentas_contables?.nombre}</span></td>
                  <td className="px-2 py-1.5 text-gray-600">{p.concepto || ''}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{Number(p.debe) > 0 ? fmt(p.debe) : ''}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{Number(p.haber) > 0 ? fmt(p.haber) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 text-xs font-semibold">
              <tr>
                <td colSpan={2} className="px-2 py-2 text-right text-gray-700">Totales</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(a.total_debe)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmt(a.total_haber)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {a.notas && <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2"><span className="text-gray-400">Notas:</span> {a.notas}</div>}
        {a.estado === 'anulado' && a.anulado_motivo && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <span className="font-medium">Anulado:</span> {a.anulado_motivo}
          </div>
        )}

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        {esAdmin && (
          <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-100">
            {a.estado === 'borrador' && (
              <>
                <button onClick={borrar} disabled={accionando} className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">Borrar</button>
                <button onClick={postear} disabled={accionando} className="btn-primario">Postear →</button>
              </>
            )}
            {a.estado === 'posteado' && (
              !mostrarAnular ? (
                <button onClick={() => setMostrarAnular(true)} className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">Anular</button>
              ) : (
                <div className="w-full flex gap-2 items-end">
                  <Campo label="Motivo de anulación" required>
                    <input type="text" value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)} className="input" autoFocus />
                  </Campo>
                  <button onClick={() => { setMostrarAnular(false); setMotivoAnular('') }} className="btn-secundario">Cancelar</button>
                  <button onClick={anular} disabled={accionando} className="btn-primario">{accionando ? '...' : 'Anular'}</button>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

// ============================================================================
// Tab Plan de cuentas
// ============================================================================

function TabCuentas({ esAdmin }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [verInactivas, setVerInactivas] = useState(false)
  const [modal, setModal] = useState(null)

  useEffect(() => { cargar() }, [verInactivas])

  async function cargar() {
    setLoading(true)
    const res = await apiFetch('/api/cuentas' + (verInactivas ? '?incluir_inactivas=1' : ''))
    const json = await res.json()
    setItems(json.cuentas || [])
    setLoading(false)
  }

  const filtradas = items.filter(c =>
    !busqueda || c.codigo.includes(busqueda) || c.nombre.toLowerCase().includes(busqueda.toLowerCase()))

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 items-end">
        <input type="text" placeholder="Buscar código o nombre…" value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="input flex-1 max-w-md" />
        <label className="inline-flex items-center gap-2 text-sm text-gray-600 px-2">
          <input type="checkbox" checked={verInactivas} onChange={e => setVerInactivas(e.target.checked)} className="rounded" />
          Inactivas
        </label>
        <div className="flex-1" />
        {esAdmin && <button onClick={() => setModal({ tipo: 'nueva' })} className="btn-primario">+ Nueva cuenta</button>}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Código</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Nombre</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Tipo</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Naturaleza</th>
              <th className="text-center text-xs text-gray-400 font-normal px-4 py-2">Mov.</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? <>{[1,2,3].map(i => <tr key={i}><td colSpan={6}><SkeletonRow /></td></tr>)}</> :
              filtradas.map(c => (
                <tr key={c.id} className={`border-t border-gray-50 hover:bg-gray-50 ${!c.activo ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-2 text-xs text-gray-500 tabular-nums font-mono">{c.codigo}</td>
                  <td className={`px-4 py-2 text-gray-700`} style={{ paddingLeft: `${(c.nivel - 1) * 12 + 16}px` }}>
                    <span className={c.es_movimiento ? '' : 'font-semibold'}>{c.nombre}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 uppercase">{c.tipo}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{c.naturaleza}</td>
                  <td className="px-4 py-2 text-center text-xs">
                    {c.es_movimiento ? <span className="text-green-600">✓</span> : <span className="text-gray-300">·</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {esAdmin && <button onClick={() => setModal({ tipo: 'editar', cuenta: c })} className="text-xs text-gray-400 hover:text-julia-red">editar</button>}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <ModalCuenta cuenta={modal.cuenta} cuentas={items} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargar() }} />
      )}
    </div>
  )
}

function ModalCuenta({ cuenta, cuentas, onClose, onSaved }) {
  const edicion = !!cuenta
  const [f, setF] = useState({
    codigo:        cuenta?.codigo || '',
    nombre:        cuenta?.nombre || '',
    tipo:          cuenta?.tipo || 'gasto',
    naturaleza:    cuenta?.naturaleza || 'deudora',
    es_movimiento: cuenta?.es_movimiento ?? true,
    notas:         cuenta?.notas || '',
    activo:        cuenta?.activo ?? true,
  })
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const res = await apiFetch(
      edicion ? `/api/cuentas/${cuenta.id}` : '/api/cuentas',
      { method: edicion ? 'PATCH' : 'POST', body: JSON.stringify(f) }
    )
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  return (
    <ModalShell titulo={edicion ? `Editar cuenta ${cuenta.codigo}` : 'Nueva cuenta'} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Código" required>
            <input type="text" required disabled={edicion} value={f.codigo} onChange={e => setF({...f, codigo: e.target.value})} className="input font-mono"
              placeholder="6-02-08" />
          </Campo>
          <Campo label="Tipo" required>
            <select value={f.tipo} onChange={e => setF({...f, tipo: e.target.value})} className="input">
              {['activo','pasivo','patrimonio','ingreso','costo','gasto'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Campo>
        </div>
        <Campo label="Nombre" required>
          <input type="text" required value={f.nombre} onChange={e => setF({...f, nombre: e.target.value})} className="input" />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Naturaleza" required>
            <select value={f.naturaleza} onChange={e => setF({...f, naturaleza: e.target.value})} className="input">
              <option value="deudora">Deudora</option>
              <option value="acreedora">Acreedora</option>
            </select>
          </Campo>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 self-end pb-2">
            <input type="checkbox" checked={f.es_movimiento} onChange={e => setF({...f, es_movimiento: e.target.checked})} className="rounded" />
            Acepta movimientos
          </label>
        </div>
        {edicion && (
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={f.activo} onChange={e => setF({...f, activo: e.target.checked})} className="rounded" />
            Activa
          </label>
        )}
        <Campo label="Notas">
          <textarea rows={2} value={f.notas} onChange={e => setF({...f, notas: e.target.value})} className="input" />
        </Campo>
        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      </form>
    </ModalShell>
  )
}

// ============================================================================
// Tab Libro mayor
// ============================================================================

function TabLibroMayor() {
  const [cuentas, setCuentas] = useState([])
  const [cuentaId, setCuentaId] = useState('')
  const [desde, setDesde] = useState(inicioMesGT())
  const [hasta, setHasta] = useState(hoyGT())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/api/cuentas')
      const json = await res.json()
      setCuentas((json.cuentas || []).filter(c => c.es_movimiento && c.activo))
    })()
  }, [])

  useEffect(() => { if (cuentaId) cargar() }, [cuentaId, desde, hasta])

  async function cargar() {
    setLoading(true); setErr(null)
    const params = new URLSearchParams({ cuenta_id: cuentaId, desde, hasta })
    const res = await apiFetch('/api/contabilidad/libro-mayor?' + params.toString())
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error || 'Error'); setData(null); return }
    setData(json)
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Cuenta</span>
          <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} className="input">
            <option value="">— elegir cuenta —</option>
            {cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Desde</span>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="input" />
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Hasta</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="input" />
        </label>
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      {!cuentaId ? (
        <div className="text-sm text-gray-400 py-10 text-center">Elegí una cuenta para ver sus movimientos.</div>
      ) : loading || !data ? (
        <div className="text-sm text-gray-400 py-10 text-center">Cargando…</div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap justify-between gap-3 text-sm">
            <div>
              <span className="text-gray-400 font-mono">{data.cuenta.codigo}</span>
              <span className="ml-2 text-gray-800 font-medium">{data.cuenta.nombre}</span>
            </div>
            <div className="flex gap-4">
              <span className="text-gray-500">Saldo inicial: <span className="tabular-nums font-medium text-gray-800">{fmtQ(data.saldo_inicial)}</span></span>
              <span className="text-gray-500">Saldo final: <span className="tabular-nums font-semibold text-julia-red">{fmtQ(data.saldo_final)}</span></span>
            </div>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Fecha</th>
                <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">N°</th>
                <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Descripción / concepto</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Debe</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Haber</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {data.movimientos.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-8">Sin movimientos en el rango.</td></tr>
              ) : data.movimientos.map(m => (
                <tr key={m.id} className="border-t border-gray-50">
                  <td className="px-3 py-1.5 text-xs text-gray-600">{formatFecha(m.fecha)}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-400 tabular-nums">#{m.asiento_numero}</td>
                  <td className="px-3 py-1.5 text-xs text-gray-700">{m.descripcion}{m.concepto && <span className="text-gray-400"> · {m.concepto}</span>}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums">{m.debe > 0 ? fmt(m.debe) : ''}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums">{m.haber > 0 ? fmt(m.haber) : ''}</td>
                  <td className="px-3 py-1.5 text-right text-sm tabular-nums font-medium">{fmt(m.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Tab Balance comprobacion
// ============================================================================

function TabBalance() {
  const [desde, setDesde] = useState(inicioMesGT())
  const [hasta, setHasta] = useState(hoyGT())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => { cargar() }, [desde, hasta])

  async function cargar() {
    setLoading(true); setErr(null)
    const params = new URLSearchParams({ desde, hasta })
    const res = await apiFetch('/api/contabilidad/balance?' + params.toString())
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error || 'Error'); setData(null); return }
    setData(json)
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3 max-w-md">
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Desde</span>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className="input" />
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Hasta</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className="input" />
        </label>
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      {loading || !data ? (
        <div className="text-sm text-gray-400 py-10 text-center">Cargando…</div>
      ) : (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Código</th>
                <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Cuenta</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Debe</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Haber</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Saldo deudor</th>
                <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Saldo acreedor</th>
              </tr>
            </thead>
            <tbody>
              {data.filas.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-8">Sin movimientos en el rango.</td></tr>
              ) : data.filas.map(f => (
                <tr key={f.id} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-1.5 text-xs text-gray-500 font-mono">{f.codigo}</td>
                  <td className="px-3 py-1.5 text-gray-800">{f.nombre}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmt(f.debe)}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums">{fmt(f.haber)}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums text-blue-700">{f.saldo_deudor > 0 ? fmt(f.saldo_deudor) : ''}</td>
                  <td className="px-3 py-1.5 text-right text-xs tabular-nums text-purple-700">{f.saldo_acreedor > 0 ? fmt(f.saldo_acreedor) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 font-semibold">
              <tr>
                <td colSpan={2} className="px-3 py-2 text-right text-sm text-gray-700">TOTALES</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totales.debe)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(data.totales.haber)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-blue-700">{fmt(data.totales.saldo_deudor)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-purple-700">{fmt(data.totales.saldo_acreedor)}</td>
              </tr>
              {Math.abs(data.totales.debe - data.totales.haber) > 0.01 ? (
                <tr><td colSpan={6} className="px-3 py-2 text-xs text-red-600 text-center">⚠ Debe ≠ Haber — hay asientos desbalanceados</td></tr>
              ) : (
                <tr><td colSpan={6} className="px-3 py-2 text-xs text-green-700 text-center">✓ Debe = Haber</td></tr>
              )}
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Tab Configuración (mappings)
// ============================================================================

function TabConfigMappings({ esAdmin }) {
  const [mappings, setMappings] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => { (async () => {
    const [mRes, cRes] = await Promise.all([
      apiFetch('/api/contabilidad/mappings'),
      apiFetch('/api/cuentas'),
    ])
    const mJson = await mRes.json()
    const cJson = await cRes.json()
    setMappings(mJson.mappings || [])
    setCuentas((cJson.cuentas || []).filter(c => c.es_movimiento))
    setLoading(false)
  })() }, [])

  function setMap(clave, cuenta_id) {
    setMappings(arr => arr.map(m => m.clave === clave ? { ...m, cuenta_id } : m))
  }

  async function guardar() {
    setErr(null); setMsg(null); setGuardando(true)
    const res = await apiFetch('/api/contabilidad/mappings', {
      method: 'PUT',
      body: JSON.stringify({ mappings: mappings.map(m => ({ clave: m.clave, cuenta_id: m.cuenta_id })) }),
    })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || (json.errores || []).join('; ')); return }
    setMsg('✓ Configuración guardada')
  }

  if (loading) return <div className="text-sm text-gray-400 py-6">Cargando…</div>

  const sinCuenta = mappings.filter(m => !m.cuenta_id).length
  const filtrados = mappings.filter(m =>
    !busqueda || m.clave.toLowerCase().includes(busqueda.toLowerCase()) ||
    m.descripcion?.toLowerCase().includes(busqueda.toLowerCase()))

  return (
    <div className="max-w-4xl">
      <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800 mb-4">
        Estos mappings se usan para generar asientos contables automáticos al cerrar caja, recibir compras, pagar planilla y guardar liquidaciones.
        {sinCuenta > 0 && <span className="font-medium"> Faltan {sinCuenta} mappings sin configurar.</span>}
      </div>

      <input type="text" placeholder="Buscar mapping…" value={busqueda} onChange={e => setBusqueda(e.target.value)}
        className="input max-w-md mb-3" />

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Clave</th>
              <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Descripción</th>
              <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Cuenta contable</th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map(m => (
              <tr key={m.clave} className={`border-t border-gray-50 ${!m.cuenta_id ? 'bg-amber-50/40' : ''}`}>
                <td className="px-3 py-1.5 text-xs text-gray-600 font-mono">{m.clave}</td>
                <td className="px-3 py-1.5 text-gray-700">{m.descripcion}</td>
                <td className="px-3 py-1.5">
                  <select value={m.cuenta_id || ''} disabled={!esAdmin}
                    onChange={e => setMap(m.clave, e.target.value || null)} className="input">
                    <option value="">— sin asignar —</option>
                    {cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mt-3">{err}</div>}
      {msg && <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-xs text-green-700 mt-3">{msg}</div>}

      {esAdmin && (
        <div className="flex justify-end pt-3">
          <button onClick={guardar} disabled={guardando} className="btn-primario">
            {guardando ? 'Guardando…' : 'Guardar configuración'}
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Primitives
// ============================================================================

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
