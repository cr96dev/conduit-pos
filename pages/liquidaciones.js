import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import { calcularLiquidacion } from '../lib/liquidaciones'

// ============================================================================
// Helpers
// ============================================================================

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

function fmt(n) {
  return 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatFecha(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })
}
function hoyGT() {
  const ms = Date.now() - 6 * 3600 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

const TIPO_BAJA = {
  despido_injustificado: { label: 'Despido injustificado', art: 'Art. 82 CT', cls: 'bg-red-50 text-red-700' },
  despido_justificado:   { label: 'Despido justificado',   art: 'Art. 77 CT', cls: 'bg-amber-50 text-amber-700' },
  renuncia_voluntaria:   { label: 'Renuncia voluntaria',   art: 'Art. 83 CT', cls: 'bg-blue-50 text-blue-700' },
}

// ============================================================================
// Pagina
// ============================================================================

export default function Liquidaciones({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [modal, setModal] = useState(null) // {tipo: 'elegir'|'calcular'|'detalle', empleado?, id?}

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
    const res = await apiFetch('/api/liquidaciones')
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Error'); setItems([]) }
    else setItems(json.liquidaciones || [])
    setLoading(false)
  }

  const esAdmin = perfil?.rol === 'admin'

  const stats = useMemo(() => {
    let neto = 0
    items.forEach(l => { neto += Number(l.total_neto) || 0 })
    return { cant: items.length, neto }
  }, [items])

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
          <h1 className="text-xl font-bold text-gray-900">Liquidaciones</h1>
          {esAdmin && (
            <button onClick={() => setModal({ tipo: 'elegir' })} className="btn-primario">+ Nueva liquidación</button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="card-julia p-3">
            <div className="text-xs uppercase tracking-wide text-gray-400">Liquidaciones registradas</div>
            <div className="text-2xl font-semibold mt-1">{stats.cant}</div>
          </div>
          <div className="card-julia p-3">
            <div className="text-xs uppercase tracking-wide text-gray-400">Total pagado neto</div>
            <div className="text-2xl font-semibold mt-1 tabular-nums">{fmt(stats.neto)}</div>
          </div>
        </div>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

        <div className="card-julia overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Empleado</th>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Fecha baja</th>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Tipo</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Años</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Bruto</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Neto</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1,2,3].map(i => <tr key={i}><td colSpan={7}><SkeletonRow /></td></tr>)}</>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="text-center text-xs text-gray-400 py-8">
                  Aún no hay liquidaciones registradas.
                </td></tr>
              ) : items.map(l => {
                const t = TIPO_BAJA[l.tipo_baja] || TIPO_BAJA.renuncia_voluntaria
                return (
                  <tr key={l.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <div className="text-gray-800">{l.nombre}</div>
                      <div className="text-xs text-gray-400">{l.puesto} · {l.area || ''}</div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-600">{formatFecha(l.fecha_baja)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${t.cls}`}>{t.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-600 tabular-nums">{Number(l.anios_trabajados).toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{fmt(l.total_bruto)}</td>
                    <td className="px-4 py-2.5 text-right text-gray-900 font-medium tabular-nums">{fmt(l.total_neto)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => setModal({ tipo: 'detalle', id: l.id })} className="text-xs text-julia-red hover:underline">Ver</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {modal?.tipo === 'elegir' && (
          <ModalElegirEmpleado onClose={() => setModal(null)}
            onElegir={(emp) => setModal({ tipo: 'calcular', empleado: emp })} />
        )}
        {modal?.tipo === 'calcular' && (
          <ModalCalcular empleado={modal.empleado} onClose={() => setModal(null)}
            onSaved={() => { setModal(null); cargar() }} />
        )}
        {modal?.tipo === 'detalle' && (
          <ModalDetalle id={modal.id} esAdmin={esAdmin} onClose={() => setModal(null)}
            onDeleted={() => { setModal(null); cargar() }} />
        )}
      </div>
    </Layout>
  )
}

// ============================================================================
// Modal 1: elegir empleado activo
// ============================================================================

function ModalElegirEmpleado({ onClose, onElegir }) {
  const [emps, setEmps] = useState([])
  const [busq, setBusq] = useState('')

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/api/empleados')
      const json = await res.json()
      setEmps(json.empleados || [])
    })()
  }, [])

  const filtrados = emps.filter(e =>
    !busq || e.nombre.toLowerCase().includes(busq.toLowerCase()))

  return (
    <ModalShell titulo="Elegí empleado a liquidar" onClose={onClose}>
      <input type="text" placeholder="Buscar…" value={busq} onChange={e => setBusq(e.target.value)}
        className="input mb-3" autoFocus />
      <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-lg">
        {filtrados.length === 0 ? (
          <div className="text-xs text-gray-400 text-center py-6">Sin empleados activos.</div>
        ) : filtrados.map(e => (
          <button key={e.id} onClick={() => onElegir(e)}
            className="w-full text-left px-3 py-2 hover:bg-julia-cream/30 border-b border-gray-50 last:border-0">
            <div className="text-sm text-gray-800">{e.nombre}</div>
            <div className="text-xs text-gray-500">{e.puesto} · {fmt(e.salario_mensual)}/mes · desde {formatFecha(e.fecha_ingreso)}</div>
          </button>
        ))}
      </div>
    </ModalShell>
  )
}

// ============================================================================
// Modal 2: calcular y guardar
// ============================================================================

function ModalCalcular({ empleado, onClose, onSaved }) {
  const [fechaBaja, setFechaBaja] = useState(hoyGT())
  const [tipoBaja, setTipoBaja] = useState('despido_injustificado')
  const [motivo, setMotivo] = useState('')
  const [diasPend, setDiasPend] = useState(0)
  const [deducciones, setDeducciones] = useState(0)
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  // Compute inline en cada render — el calc es cheap y elimina cualquier
  // duda de useMemo + deps. Cambiar tipoBaja garantiza recompute.
  let calc = null
  try {
    calc = calcularLiquidacion({
      empleado, fechaBaja, tipoBaja,
      diasSalarioPendiente: Number(diasPend) || 0,
      deducciones: Number(deducciones) || 0,
    })
  } catch (e) {
    calc = null
  }

  // Aplicabilidad legal por antigüedad (Codigo de Trabajo GT)
  const antiguedadInsuficiente = calc && calc.aniosTrabajados < 0.5 && calc.mesesTrabajados < 6
  const indemAplicaPorTipo = tipoBaja === 'despido_injustificado'
  const preavisoAplicaPorTipo = tipoBaja === 'despido_injustificado'

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const res = await apiFetch('/api/liquidaciones', {
      method: 'POST',
      body: JSON.stringify({
        empleado_id: empleado.id, fecha_baja: fechaBaja, tipo_baja: tipoBaja,
        motivo, dias_salario_pendiente: Number(diasPend) || 0,
        deducciones: Number(deducciones) || 0, notas,
      }),
    })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  const noTieneIngreso = !empleado.fecha_ingreso

  return (
    <ModalShell titulo={`Liquidación: ${empleado.nombre}`} onClose={onClose} maxWidth="max-w-2xl">
      <form onSubmit={guardar} className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 grid grid-cols-3 gap-3 text-sm">
          <div><div className="text-xs text-gray-400">Puesto</div><div>{empleado.puesto}</div></div>
          <div><div className="text-xs text-gray-400">Salario mensual</div><div className="tabular-nums">{fmt(empleado.salario_mensual)}</div></div>
          <div><div className="text-xs text-gray-400">Ingreso</div><div>{formatFecha(empleado.fecha_ingreso)}</div></div>
        </div>

        {noTieneIngreso && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-700">
            ⚠ Este empleado no tiene fecha de ingreso registrada. Editalo primero antes de liquidar.
          </div>
        )}

        <Campo label="Tipo de baja" required>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(TIPO_BAJA).map(([k, v]) => {
              const activo = tipoBaja === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTipoBaja(k)}
                  className={`text-left px-3 py-2.5 rounded-lg border transition ${
                    activo
                      ? 'border-julia-red bg-julia-cream/40 ring-1 ring-julia-red/30'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <div className={`text-sm font-medium ${activo ? 'text-julia-red' : 'text-gray-700'}`}>
                    {v.label}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-400 mt-0.5">{v.art}</div>
                </button>
              )
            })}
          </div>
        </Campo>

        {tipoBaja !== 'despido_injustificado' && (
          <div className="bg-amber-50/60 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">
            <strong>{TIPO_BAJA[tipoBaja].label}</strong>: la liquidación <em>no incluye</em> indemnización
            (Art. 82) ni preaviso (Art. 78). Sí se pagan aguinaldo, bono 14 y vacaciones proporcionales.
          </div>
        )}

        {antiguedadInsuficiente && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-800">
            <strong>Antigüedad menor a 6 meses</strong> ({calc.mesesTrabajados} mes{calc.mesesTrabajados === 1 ? '' : 'es'} ·
            {' '}{calc.diasTrabajados} días). Por Código de Trabajo GT, indemnización (Art. 82) y preaviso (Art. 78)
            <strong> requieren al menos 6 meses</strong> de relación laboral aunque el despido sea injustificado.
            Cambiar el tipo de baja <strong>no modificará el total</strong> en este caso — solo cambia cuando
            la antigüedad alcanza el umbral legal.
          </div>
        )}

        <Campo label="Fecha de baja" required>
          <input type="date" required value={fechaBaja} onChange={e => setFechaBaja(e.target.value)} className="input" />
        </Campo>

        <Campo label="Motivo">
          <input type="text" value={motivo} onChange={e => setMotivo(e.target.value)} className="input"
            placeholder="Descripción libre" />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Días de salario pendiente">
            <input type="number" min="0" max="31" value={diasPend} onChange={e => setDiasPend(e.target.value)} className="input" />
          </Campo>
          <Campo label="Deducciones (Q)">
            <input type="number" step="0.01" min="0" value={deducciones} onChange={e => setDeducciones(e.target.value)} className="input" />
          </Campo>
        </div>

        {calc && (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-baseline">
              <span className="text-sm font-medium text-gray-700">Cálculo de prestaciones</span>
              <span className="text-xs text-gray-500">
                Antigüedad: <strong className="text-gray-700">{calc.aniosTrabajados.toFixed(2)} años · {calc.mesesTrabajados} meses · {calc.diasTrabajados} días</strong>
              </span>
            </div>
            <div className="divide-y divide-gray-50">
              <Fila
                label={
                  !indemAplicaPorTipo ? 'Indemnización — no aplica (tipo de baja)'
                  : antiguedadInsuficiente ? 'Indemnización — no aplica (antigüedad < 6 meses)'
                  : 'Indemnización'
                }
                nota={indemAplicaPorTipo && !antiguedadInsuficiente
                  ? `Prom. 6m: ${fmt(calc.salProm6m)} × ${calc.aniosTrabajados.toFixed(2)} años` : null}
                val={calc.indemnizacion}
                aplica={indemAplicaPorTipo && !antiguedadInsuficiente}
              />
              <Fila
                label={
                  !preavisoAplicaPorTipo ? 'Preaviso — no aplica (tipo de baja)'
                  : antiguedadInsuficiente ? 'Preaviso — no aplica (antigüedad < 6 meses)'
                  : 'Preaviso'
                }
                val={calc.preaviso}
                aplica={preavisoAplicaPorTipo && !antiguedadInsuficiente}
              />
              <Fila label="Vacaciones proporcionales" val={calc.vacaciones}
                nota={`${calc.diasVacProporcionales} días × ${fmt(empleado.salario_mensual/30)}/día`} />
              <Fila label="Aguinaldo proporcional" val={calc.aguinaldo} nota={`${calc.diasAguinaldo} días del período`} />
              <Fila label="Bono 14 proporcional"   val={calc.bono14}    nota={`${calc.diasBono14} días del período`} />
              <Fila label="Salario pendiente"      val={calc.salarioPendiente}
                nota={`${calc.diasSalarioPendiente} días × ${fmt(empleado.salario_mensual/30)}/día`} />
              <div className="flex justify-between px-4 py-2 bg-gray-50 text-sm">
                <span className="font-medium text-gray-700">Total bruto</span>
                <span className="font-medium tabular-nums">{fmt(calc.totalBruto)}</span>
              </div>
              {calc.deducciones > 0 && (
                <div className="flex justify-between px-4 py-2 text-sm">
                  <span className="text-gray-600">Deducciones</span>
                  <span className="tabular-nums text-red-600">- {fmt(calc.deducciones)}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-3 bg-julia-cream/30 text-base">
                <span className="font-semibold text-gray-800">Total a pagar (neto)</span>
                <span className="font-semibold tabular-nums text-julia-red">{fmt(calc.totalNeto)}</span>
              </div>
            </div>
          </div>
        )}

        <Campo label="Notas">
          <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)} className="input" />
        </Campo>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-between items-baseline gap-2 pt-2">
          <div className="text-xs text-gray-400">
            Al guardar, el empleado se marcará como inactivo automáticamente.
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
            <button type="submit" disabled={guardando || noTieneIngreso} className="btn-primario">
              {guardando ? 'Guardando…' : 'Guardar liquidación'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  )
}

function Fila({ label, val, nota, aplica }) {
  const dim = aplica === false ? 'opacity-40' : ''
  return (
    <div className={`flex justify-between items-baseline px-4 py-2 text-sm ${dim}`}>
      <div>
        <div className="text-gray-700">{label}</div>
        {nota && <div className="text-xs text-gray-400">{nota}</div>}
      </div>
      <span className={`tabular-nums ${val > 0 ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>{fmt(val)}</span>
    </div>
  )
}

// ============================================================================
// Modal 3: detalle
// ============================================================================

function ModalDetalle({ id, esAdmin, onClose, onDeleted }) {
  const [liq, setLiq] = useState(null)
  const [err, setErr] = useState(null)
  const [accionando, setAccionando] = useState(false)

  useEffect(() => {
    (async () => {
      const res = await apiFetch(`/api/liquidaciones/${id}`)
      const json = await res.json()
      if (!res.ok) setErr(json.error || 'Error')
      else setLiq(json.liquidacion)
    })()
  }, [id])

  async function borrar() {
    if (!confirm('¿Borrar esta liquidación? Si el empleado fue dado de baja por esta liquidación, se reactivará.')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/liquidaciones/${id}`, { method: 'DELETE' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onDeleted()
  }

  if (!liq) {
    return <ModalShell titulo="Liquidación" onClose={onClose}>
      <div className="text-sm text-gray-400">{err || 'Cargando…'}</div>
    </ModalShell>
  }

  const t = TIPO_BAJA[liq.tipo_baja]

  return (
    <ModalShell titulo={`Liquidación: ${liq.nombre}`} onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div><div className="text-xs text-gray-400">Puesto</div><div>{liq.puesto}</div></div>
          <div><div className="text-xs text-gray-400">Ingreso</div><div>{formatFecha(liq.fecha_ingreso)}</div></div>
          <div><div className="text-xs text-gray-400">Baja</div><div>{formatFecha(liq.fecha_baja)}</div></div>
          <div><div className="text-xs text-gray-400">Salario</div><div className="tabular-nums">{fmt(liq.salario_mensual)}/mes</div></div>
          <div><div className="text-xs text-gray-400">Tipo</div>
            <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${t.cls}`}>{t.label}</span>
          </div>
        </div>

        {liq.motivo && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-gray-400">Motivo:</span> {liq.motivo}
          </div>
        )}

        <div className="border border-gray-100 rounded-lg divide-y divide-gray-50">
          <Fila label="Indemnización" val={liq.indemnizacion}
            nota={liq.salario_promedio_6m ? `Promedio 6m: ${fmt(liq.salario_promedio_6m)} × ${Number(liq.anios_trabajados).toFixed(2)} años` : null}
            aplica={Number(liq.indemnizacion) > 0} />
          <Fila label="Preaviso" val={liq.preaviso} aplica={Number(liq.preaviso) > 0} />
          <Fila label="Vacaciones" val={liq.vacaciones_pendientes} nota={`${Number(liq.dias_vacaciones)} días`} />
          <Fila label="Aguinaldo" val={liq.aguinaldo_proporcional} nota={`${liq.dias_aguinaldo} días`} />
          <Fila label="Bono 14"   val={liq.bono14_proporcional}   nota={`${liq.dias_bono14} días`} />
          <Fila label="Salario pendiente" val={liq.salario_pendiente} nota={`${liq.dias_salario_pendiente} días`} />
          <div className="flex justify-between px-4 py-2 bg-gray-50">
            <span className="text-sm font-medium text-gray-700">Total bruto</span>
            <span className="text-sm tabular-nums font-medium">{fmt(liq.total_bruto)}</span>
          </div>
          {Number(liq.deducciones) > 0 && (
            <Fila label="Deducciones" val={-Number(liq.deducciones)} />
          )}
          <div className="flex justify-between px-4 py-3 bg-julia-cream/30">
            <span className="text-base font-semibold">Total neto</span>
            <span className="text-base tabular-nums font-semibold text-julia-red">{fmt(liq.total_neto)}</span>
          </div>
        </div>

        {liq.notas && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-gray-400">Notas:</span> {liq.notas}
          </div>
        )}

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        {esAdmin && (
          <div className="flex justify-end pt-2 border-t border-gray-100">
            <button onClick={borrar} disabled={accionando}
              className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">
              Borrar liquidación
            </button>
          </div>
        )}
      </div>
    </ModalShell>
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
