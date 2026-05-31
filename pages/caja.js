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

function formatMoney(n) {
  return 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatFecha(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })
}
function hoyGT() {
  const ms = Date.now() - 6 * 3600 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

// ============================================================================
// Pagina
// ============================================================================

export default function Caja({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [cierres, setCierres] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null) // {tipo: 'crear'|'detalle', cierreId?}

  useEffect(() => {
    if (!session) { router.push('/'); return }
    (async () => {
      const { data } = await supabase.from('perfiles')
        .select('id, email, nombre_completo, rol, activo')
        .eq('id', session.user.id).single()
      setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' })
    })()
    cargar()
  }, [session])

  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch('/api/cierres?limit=60')
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Error'); setCierres([]) }
    else setCierres(json.cierres || [])
    setLoading(false)
  }

  const esAdmin = perfil?.rol === 'admin'

  const stats = useMemo(() => {
    let totalVentas = 0
    let totalDif = 0
    let cantCerrados = 0
    cierres.slice(0, 30).forEach(c => {
      totalVentas += Number(c.ventas_total) || 0
      if (c.diferencia != null) totalDif += Number(c.diferencia)
      if (c.estado === 'cerrado') cantCerrados++
    })
    return { totalVentas, totalDif, cantCerrados }
  }, [cierres])

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
          <h1 className="text-xl font-bold text-gray-900">Caja / Cierre diario</h1>
          {esAdmin && (
            <button onClick={() => setModal({ tipo: 'crear' })}
              className="px-4 py-2 bg-julia-red text-white text-sm rounded-lg hover:bg-red-900">
              + Nuevo cierre
            </button>
          )}
        </div>

        {/* KPIs ultimos 30 dias */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <KpiBox label="Ventas últimos 30 días" value={formatMoney(stats.totalVentas)} />
          <KpiBox label="Cierres confirmados"    value={stats.cantCerrados} />
          <KpiBox label="Diferencia acumulada"
            value={formatMoney(stats.totalDif)}
            tone={stats.totalDif < 0 ? 'red' : stats.totalDif > 0 ? 'green' : 'gray'} />
        </div>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

        <div className="card-julia overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Fecha</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Recibos</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Efectivo</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Tarjeta</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Total</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Diferencia</th>
                <th className="text-center text-xs text-gray-400 font-normal px-4 py-2">Estado</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1, 2, 3].map(i => <tr key={i}><td colSpan={8}><SkeletonRow /></td></tr>)}</>
              ) : cierres.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-xs text-gray-400 py-8">
                  Aún no hay cierres registrados.
                  {esAdmin && <button onClick={() => setModal({ tipo: 'crear' })}
                    className="text-julia-red hover:underline ml-1">Crear el primero →</button>}
                </td></tr>
              ) : cierres.map(c => {
                const dif = c.diferencia
                const difCls = dif == null ? 'text-gray-400'
                              : Number(dif) < 0 ? 'text-red-600 font-medium'
                              : Number(dif) > 0 ? 'text-green-700 font-medium' : 'text-gray-600'
                return (
                  <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700">{formatFecha(c.fecha)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{c.cantidad_recibos}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{formatMoney(c.ventas_efectivo)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{formatMoney(c.ventas_tarjeta)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-800 font-medium tabular-nums">{formatMoney(c.ventas_total)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${difCls}`}>
                      {dif == null ? '—' : formatMoney(dif)}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${
                        c.estado === 'cerrado' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                      }`}>{c.estado}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => setModal({ tipo: 'detalle', cierreId: c.id })}
                        className="text-xs text-julia-red hover:underline">Ver</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        </div>

        {modal?.tipo === 'crear' && (
          <ModalNuevoCierre onClose={() => setModal(null)} onSaved={() => { setModal(null); cargar() }} />
        )}
        {modal?.tipo === 'detalle' && (
          <ModalDetalleCierre cierreId={modal.cierreId} esAdmin={esAdmin}
            onClose={() => setModal(null)} onChanged={cargar} />
        )}
      </div>
    </Layout>
  )
}

function KpiBox({ label, value, tone = 'gray' }) {
  const tones = {
    gray:  'border-gray-100 text-gray-800',
    red:   'border-red-100 text-red-700 bg-red-50',
    green: 'border-green-100 text-green-700 bg-green-50',
  }
  return (
    <div className={`bg-white border rounded-xl p-3 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-semibold mt-1 tabular-nums">{value}</div>
    </div>
  )
}

// ============================================================================
// Modal: Nuevo cierre
// ============================================================================

function ModalNuevoCierre({ onClose, onSaved }) {
  const [fecha, setFecha] = useState(hoyGT())
  const [saldoInicial, setSaldoInicial] = useState(0)
  const [conteoEfectivo, setConteoEfectivo] = useState('')
  const [egresos, setEgresos] = useState([{ concepto: '', monto: '' }])
  const [notas, setNotas] = useState('')
  const [preview, setPreview] = useState(null)
  const [cargandoPreview, setCargandoPreview] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { cargarPreview() }, [fecha])

  async function cargarPreview() {
    if (!fecha) return
    setCargandoPreview(true)
    const res = await apiFetch(`/api/cierres/preview?fecha=${fecha}`)
    const json = await res.json()
    setCargandoPreview(false)
    if (res.ok) setPreview(json)
    else setPreview(null)
  }

  const egresosTotal = useMemo(() =>
    egresos.reduce((s, e) => s + (Number(e.monto) || 0), 0), [egresos])

  const saldoEsperado = (Number(saldoInicial) || 0) + (preview?.ventas_efectivo || 0) - egresosTotal
  const diferencia = conteoEfectivo !== '' ? (Number(conteoEfectivo) - saldoEsperado) : null

  function setEg(i, k, v) {
    setEgresos(arr => arr.map((e, idx) => idx === i ? { ...e, [k]: v } : e))
  }

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const egresosValidos = egresos
      .filter(eg => eg.concepto?.trim() && Number(eg.monto) > 0)
      .map(eg => ({ concepto: eg.concepto.trim(), monto: Number(eg.monto) }))
    const payload = {
      fecha,
      saldo_inicial: Number(saldoInicial) || 0,
      conteo_efectivo: conteoEfectivo === '' ? null : Number(conteoEfectivo),
      notas,
      egresos: egresosValidos,
    }
    const res = await apiFetch('/api/cierres', { method: 'POST', body: JSON.stringify(payload) })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  return (
    <ModalShell titulo="Nuevo cierre de caja" onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={guardar} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Fecha" required>
            <input type="date" required value={fecha} onChange={e => setFecha(e.target.value)} className="input" />
          </Campo>
          <Campo label="Saldo inicial (Q)">
            <input type="number" step="any" value={saldoInicial} onChange={e => setSaldoInicial(e.target.value)} className="input" />
          </Campo>
        </div>

        {/* Preview ventas Loyverse */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-xs uppercase tracking-wide text-gray-500">Ventas del día (Loyverse)</div>
            <div className="text-xs text-gray-400">{cargandoPreview ? 'Calculando…' : (preview ? `${preview.cantidad_recibos} recibos` : '')}</div>
          </div>
          {preview ? (
            <>
              <DesglosePagos desglose={preview.desglose_pagos} total={preview.ventas_total} />
            </>
          ) : (
            <div className="text-xs text-gray-400">Sin datos para esa fecha</div>
          )}
        </div>

        {/* Egresos */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Egresos del día</div>
            <button type="button" onClick={() => setEgresos(arr => [...arr, { concepto: '', monto: '' }])}
              className="text-xs text-julia-red hover:underline">+ Agregar</button>
          </div>
          <div className="space-y-1">
            {egresos.map((eg, i) => (
              <div key={i} className="flex gap-2">
                <input type="text" placeholder="Concepto (ej. pan empleados)"
                  value={eg.concepto} onChange={e => setEg(i, 'concepto', e.target.value)}
                  className="input flex-1" />
                <input type="number" step="any" placeholder="Q"
                  value={eg.monto} onChange={e => setEg(i, 'monto', e.target.value)}
                  className="input w-28 text-right" />
                <button type="button" onClick={() => setEgresos(arr => arr.filter((_, idx) => idx !== i))}
                  className="text-gray-400 hover:text-red-500 px-2">×</button>
              </div>
            ))}
          </div>
        </div>

        {/* Conteo y resumen */}
        <div className="grid grid-cols-2 gap-3 bg-julia-cream/30 border border-julia-cream rounded-lg p-3">
          <Campo label="Conteo efectivo (Q)">
            <input type="number" step="any" value={conteoEfectivo} onChange={e => setConteoEfectivo(e.target.value)} className="input"
              placeholder="lo contado en caja" />
          </Campo>
          <div className="text-xs space-y-0.5 self-end">
            <div className="flex justify-between text-gray-600">
              <span>Saldo esperado:</span>
              <span className="tabular-nums">{formatMoney(saldoEsperado)}</span>
            </div>
            <div className={`flex justify-between font-semibold ${
              diferencia == null ? 'text-gray-400'
              : diferencia < 0 ? 'text-red-600'
              : diferencia > 0 ? 'text-green-700' : 'text-gray-700'}`}>
              <span>Diferencia:</span>
              <span className="tabular-nums">{diferencia == null ? '—' : formatMoney(diferencia)}</span>
            </div>
          </div>
        </div>

        <Campo label="Notas">
          <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2} className="input" />
        </Campo>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">
            {guardando ? 'Guardando…' : 'Crear cierre'}
          </button>
        </div>

        <ModalStyles />
      </form>
    </ModalShell>
  )
}

// ============================================================================
// Modal: Detalle de cierre
// ============================================================================

function ModalDetalleCierre({ cierreId, esAdmin, onClose, onChanged }) {
  const [cierre, setCierre] = useState(null)
  const [err, setErr] = useState(null)
  const [accionando, setAccionando] = useState(false)
  const [editandoConteo, setEditandoConteo] = useState(false)
  const [nuevoConteo, setNuevoConteo] = useState('')

  useEffect(() => { cargar() }, [cierreId])

  async function cargar() {
    const res = await apiFetch(`/api/cierres/${cierreId}`)
    const json = await res.json()
    if (!res.ok) setErr(json.error || 'Error')
    else {
      setCierre(json.cierre)
      setNuevoConteo(json.cierre.conteo_efectivo ?? '')
    }
  }

  async function guardarConteo() {
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/cierres/${cierreId}`, {
      method: 'PATCH',
      body: JSON.stringify({ conteo_efectivo: nuevoConteo === '' ? null : Number(nuevoConteo) }),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    setEditandoConteo(false)
    await cargar()
    onChanged?.()
  }

  async function cerrar() {
    if (!confirm('¿Confirmar cierre? Después solo un admin podrá reabrirlo.')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/cierres/${cierreId}/cerrar`, { method: 'POST' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    await cargar(); onChanged?.()
  }

  async function reabrir() {
    if (!confirm('¿Reabrir este cierre para correcciones?')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/cierres/${cierreId}/reabrir`, { method: 'POST' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    await cargar(); onChanged?.()
  }

  async function borrar() {
    if (!confirm('¿Borrar este cierre? No se puede deshacer.')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/cierres/${cierreId}`, { method: 'DELETE' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onChanged?.(); onClose()
  }

  if (!cierre) {
    return <ModalShell titulo="Cierre" onClose={onClose}><div className="text-sm text-gray-400">Cargando…</div></ModalShell>
  }

  return (
    <ModalShell titulo={`Cierre ${formatFecha(cierre.fecha)}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="flex justify-between items-baseline">
          <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${
            cierre.estado === 'cerrado' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>{cierre.estado}</span>
          <span className="text-xs text-gray-400">{cierre.cantidad_recibos} recibos · saldo inicial {formatMoney(cierre.saldo_inicial)}</span>
        </div>

        {/* Ventas */}
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Ventas Loyverse</div>
          <DesglosePagos desglose={cierre.desglose_pagos} total={cierre.ventas_total} fallback={{ efectivo: cierre.ventas_efectivo, tarjeta: cierre.ventas_tarjeta, otros: cierre.ventas_otros }} />
        </div>

        {/* Egresos */}
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Egresos ({formatMoney(cierre.egresos_total)})</div>
          {(cierre.egresos || []).length === 0 ? (
            <div className="text-xs text-gray-400">Sin egresos.</div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {cierre.egresos.map(e => (
                  <tr key={e.id} className="border-t border-gray-100">
                    <td className="py-1.5 text-gray-700">{e.concepto}</td>
                    <td className="py-1.5 text-right tabular-nums">{formatMoney(e.monto)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Cuadre */}
        <div className="bg-julia-cream/30 border border-julia-cream rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between text-gray-600">
            <span>Saldo esperado en caja:</span>
            <span className="tabular-nums">{formatMoney(cierre.saldo_esperado)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Conteo físico:</span>
            {cierre.estado === 'abierto' && esAdmin && editandoConteo ? (
              <span className="flex gap-1 items-center">
                <input type="number" step="any" value={nuevoConteo} onChange={e => setNuevoConteo(e.target.value)}
                  className="border border-gray-200 rounded px-2 py-0.5 text-xs w-24 text-right" autoFocus />
                <button onClick={guardarConteo} disabled={accionando} className="text-xs text-julia-red hover:underline">Guardar</button>
                <button onClick={() => { setEditandoConteo(false); setNuevoConteo(cierre.conteo_efectivo ?? '') }} className="text-xs text-gray-400">×</button>
              </span>
            ) : (
              <span className="tabular-nums">
                {cierre.conteo_efectivo == null ? <span className="text-gray-400">no registrado</span> : formatMoney(cierre.conteo_efectivo)}
                {cierre.estado === 'abierto' && esAdmin && (
                  <button onClick={() => setEditandoConteo(true)} className="text-xs text-julia-red hover:underline ml-2">editar</button>
                )}
              </span>
            )}
          </div>
          <div className={`flex justify-between font-semibold pt-1 border-t border-julia-cream ${
            cierre.diferencia == null ? 'text-gray-400'
            : Number(cierre.diferencia) < 0 ? 'text-red-600'
            : Number(cierre.diferencia) > 0 ? 'text-green-700' : 'text-gray-700'
          }`}>
            <span>Diferencia:</span>
            <span className="tabular-nums">{cierre.diferencia == null ? '—' : formatMoney(cierre.diferencia)}</span>
          </div>
        </div>

        {cierre.notas && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-gray-400">Notas:</span> {cierre.notas}
          </div>
        )}

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        {esAdmin && (
          <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-100">
            {cierre.estado === 'abierto' ? (
              <>
                <button onClick={borrar} disabled={accionando} className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">Borrar</button>
                <button onClick={cerrar} disabled={accionando || cierre.conteo_efectivo == null} className="btn-primario">
                  {accionando ? '...' : 'Cerrar definitivamente'}
                </button>
              </>
            ) : (
              <button onClick={reabrir} disabled={accionando} className="text-xs px-3 py-2 text-amber-700 hover:bg-amber-50 rounded-lg">
                Reabrir
              </button>
            )}
          </div>
        )}

        <ModalStyles />
      </div>
    </ModalShell>
  )
}

// ============================================================================
// UI primitives
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

function Dato({ label, children, bold }) {
  return (
    <div>
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`tabular-nums ${bold ? 'text-gray-900 font-semibold' : 'text-gray-700'}`}>{children}</div>
    </div>
  )
}

// Muestra TODOS los métodos de pago del desglose. Si el desglose esta vacio
// (cierres antiguos), cae al modelo viejo de 3 buckets.
function DesglosePagos({ desglose, total, fallback }) {
  let entries = []
  if (desglose && typeof desglose === 'object' && Object.keys(desglose).length > 0) {
    entries = Object.entries(desglose)
      .filter(([_, v]) => Number(v) !== 0)
      .sort((a, b) => Math.abs(Number(b[1])) - Math.abs(Number(a[1])))
  } else if (fallback) {
    if (Number(fallback.efectivo)) entries.push(['EFECTIVO', fallback.efectivo])
    if (Number(fallback.tarjeta))  entries.push(['TARJETA',  fallback.tarjeta])
    if (Number(fallback.otros))    entries.push(['OTROS',    fallback.otros])
  }
  if (entries.length === 0) {
    return <div className="text-xs text-gray-400">Sin ventas</div>
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
      {entries.map(([nombre, monto]) => (
        <Dato key={nombre} label={nombre}>{formatMoney(monto)}</Dato>
      ))}
      <Dato label="Total" bold>{formatMoney(total)}</Dato>
    </div>
  )
}

function ModalStyles() {
  return (
    <style jsx global>{`
      .input {
        width: 100%; border: 1px solid #e5e7eb; border-radius: 0.5rem;
        padding: 0.5rem 0.75rem; font-size: 0.875rem;
      }
      .input:focus { outline: none; border-color: #991b1b; }
      .btn-primario {
        padding: 0.5rem 1.25rem; background: #991b1b; color: white;
        border-radius: 0.5rem; font-size: 0.875rem;
      }
      .btn-primario:hover { background: #7f1d1d; }
      .btn-primario:disabled { opacity: 0.5; cursor: not-allowed; }
      .btn-secundario {
        padding: 0.5rem 1rem; border: 1px solid #e5e7eb; color: #4b5563;
        border-radius: 0.5rem; font-size: 0.875rem;
      }
      .btn-secundario:hover { background: #f9fafb; }
    `}</style>
  )
}
