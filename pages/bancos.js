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

// ============================================================================
// Pagina
// ============================================================================

export default function Bancos({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [tab, setTab] = useState('conciliacion')
  const [cuentas, setCuentas] = useState([])
  const [cuentaSel, setCuentaSel] = useState(null)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    (async () => {
      const { data } = await supabase.from('perfiles')
        .select('id, email, nombre_completo, rol, activo')
        .eq('id', session.user.id).single()
      setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' })
    })()
    cargarCuentas()
  }, [session])

  async function cargarCuentas() {
    const res = await apiFetch('/api/bancos/cuentas')
    const json = await res.json()
    const arr = json.cuentas || []
    setCuentas(arr)
    if (arr.length > 0 && !cuentaSel) setCuentaSel(arr[0])
  }

  const esAdmin = perfil?.rol === 'admin'

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">Bancos / Conciliación</h1>

        <div className="flex gap-1 border-b border-gray-200 mb-5">
          <TabBtn active={tab === 'conciliacion'} onClick={() => setTab('conciliacion')}>Conciliación</TabBtn>
          <TabBtn active={tab === 'cuentas'}      onClick={() => setTab('cuentas')}>Cuentas bancarias</TabBtn>
        </div>

        {tab === 'cuentas' && (
          <TabCuentas esAdmin={esAdmin} cuentas={cuentas} onChanged={cargarCuentas} />
        )}
        {tab === 'conciliacion' && (
          cuentas.length === 0 ? (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 text-sm text-amber-800">
              Aún no hay cuentas bancarias. Crear una primero en la pestaña <span className="font-medium">Cuentas bancarias</span>.
            </div>
          ) : (
            <TabConciliacion esAdmin={esAdmin} cuentas={cuentas}
              cuentaSel={cuentaSel} setCuentaSel={setCuentaSel} />
          )
        )}
      </div>
    </Layout>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors ${
        active ? 'border-b-2 border-julia-red text-julia-red' : 'text-gray-500 hover:text-gray-800'
      }`}>{children}</button>
  )
}

// ============================================================================
// Tab Cuentas
// ============================================================================

function TabCuentas({ esAdmin, cuentas, onChanged }) {
  const [modal, setModal] = useState(null)

  return (
    <div>
      <div className="flex justify-between items-baseline mb-3">
        <div className="text-sm text-gray-600">{cuentas.length} cuentas registradas</div>
        {esAdmin && <button onClick={() => setModal({ tipo: 'nueva' })} className="btn-primario">+ Nueva cuenta</button>}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Banco</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Alias</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">N° cuenta</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Tipo</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Cuenta contable</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Saldo inicial</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {cuentas.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-xs text-gray-400 py-8">
                Sin cuentas. {esAdmin && <button onClick={() => setModal({tipo:'nueva'})} className="text-julia-red hover:underline">Crear la primera →</button>}
              </td></tr>
            ) : cuentas.map(c => (
              <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-800">{c.banco}</td>
                <td className="px-4 py-2 text-gray-700">{c.alias}</td>
                <td className="px-4 py-2 text-xs text-gray-500 font-mono">{c.numero_cuenta || '—'}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{c.tipo}</td>
                <td className="px-4 py-2 text-xs text-gray-500">
                  {c.cuentas_contables ? `${c.cuentas_contables.codigo} · ${c.cuentas_contables.nombre}` : <span className="text-amber-500">sin mapear</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{fmtQ(c.saldo_inicial)}</td>
                <td className="px-4 py-2 text-right">
                  {esAdmin && <button onClick={() => setModal({tipo: 'editar', cuenta: c})} className="text-xs text-gray-400 hover:text-julia-red">editar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <ModalCuenta cuenta={modal.cuenta} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); onChanged() }} />
      )}
    </div>
  )
}

function ModalCuenta({ cuenta, onClose, onSaved }) {
  const edicion = !!cuenta
  const [f, setF] = useState({
    banco:               cuenta?.banco || '',
    alias:               cuenta?.alias || '',
    numero_cuenta:       cuenta?.numero_cuenta || '',
    tipo:                cuenta?.tipo || 'monetaria',
    moneda:              cuenta?.moneda || 'GTQ',
    cuenta_contable_id:  cuenta?.cuenta_contable_id || '',
    saldo_inicial:       cuenta?.saldo_inicial || 0,
    fecha_saldo_inicial: cuenta?.fecha_saldo_inicial || '',
    notas:               cuenta?.notas || '',
    activo:              cuenta?.activo ?? true,
  })
  const [cuentasContables, setCuentasContables] = useState([])
  const [err, setErr] = useState(null)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/api/cuentas')
      const json = await res.json()
      // Filtrar solo cuentas hoja (es_movimiento) tipo activo/banco
      setCuentasContables((json.cuentas || []).filter(c => c.es_movimiento && c.tipo === 'activo'))
    })()
  }, [])

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const res = await apiFetch(
      edicion ? `/api/bancos/cuentas/${cuenta.id}` : '/api/bancos/cuentas',
      { method: edicion ? 'PATCH' : 'POST', body: JSON.stringify({...f, cuenta_contable_id: f.cuenta_contable_id || null}) }
    )
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  return (
    <ModalShell titulo={edicion ? `Editar: ${cuenta.alias}` : 'Nueva cuenta bancaria'} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Banco" required>
            <input type="text" required value={f.banco} onChange={e => setF({...f, banco: e.target.value})} className="input" placeholder="BI, BAM, BAC, etc." />
          </Campo>
          <Campo label="Tipo">
            <select value={f.tipo} onChange={e => setF({...f, tipo: e.target.value})} className="input">
              <option value="monetaria">Monetaria</option>
              <option value="ahorro">Ahorro</option>
              <option value="tarjeta_credito">Tarjeta crédito</option>
              <option value="otro">Otro</option>
            </select>
          </Campo>
        </div>
        <Campo label="Alias" required>
          <input type="text" required value={f.alias} onChange={e => setF({...f, alias: e.target.value})} className="input" placeholder="BI cta corriente principal" />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="N° cuenta">
            <input type="text" value={f.numero_cuenta} onChange={e => setF({...f, numero_cuenta: e.target.value})} className="input" />
          </Campo>
          <Campo label="Moneda">
            <input type="text" value={f.moneda} onChange={e => setF({...f, moneda: e.target.value})} className="input" />
          </Campo>
        </div>
        <Campo label="Cuenta contable mapeada">
          <select value={f.cuenta_contable_id} onChange={e => setF({...f, cuenta_contable_id: e.target.value})} className="input">
            <option value="">— sin mapear —</option>
            {cuentasContables.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
          </select>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Saldo inicial (Q)">
            <input type="number" step="0.01" value={f.saldo_inicial} onChange={e => setF({...f, saldo_inicial: e.target.value})} className="input" />
          </Campo>
          <Campo label="A fecha">
            <input type="date" value={f.fecha_saldo_inicial} onChange={e => setF({...f, fecha_saldo_inicial: e.target.value})} className="input" />
          </Campo>
        </div>
        <Campo label="Notas">
          <textarea rows={2} value={f.notas} onChange={e => setF({...f, notas: e.target.value})} className="input" />
        </Campo>
        {edicion && (
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={f.activo} onChange={e => setF({...f, activo: e.target.checked})} className="rounded" /> Activa
          </label>
        )}
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
// Tab Conciliación
// ============================================================================

function TabConciliacion({ esAdmin, cuentas, cuentaSel, setCuentaSel }) {
  const [movs, setMovs] = useState([])
  const [saldo, setSaldo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [estado, setEstado] = useState('pendientes')
  const [modal, setModal] = useState(null) // {tipo: 'importar' | 'conciliar', mov?}
  const [err, setErr] = useState(null)

  useEffect(() => { if (cuentaSel) cargar() }, [cuentaSel, estado])

  async function cargar() {
    setLoading(true); setErr(null)
    const [mRes, sRes] = await Promise.all([
      apiFetch(`/api/bancos/movimientos?cuenta_id=${cuentaSel.id}&estado=${estado}&limit=300`),
      apiFetch(`/api/bancos/cuentas/${cuentaSel.id}/saldo`),
    ])
    const mJson = await mRes.json()
    const sJson = await sRes.json()
    if (!mRes.ok) { setErr(mJson.error || 'Error'); setMovs([]) }
    else setMovs(mJson.movimientos || [])
    setSaldo(sJson.ok ? sJson : null)
    setLoading(false)
  }

  async function desconciliar(mov) {
    if (!confirm('¿Desconciliar este movimiento del asiento?')) return
    const res = await apiFetch(`/api/bancos/movimientos/${mov.id}`, {
      method: 'PATCH', body: JSON.stringify({ asiento_id: null }),
    })
    if (res.ok) cargar()
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Cuenta</span>
          <select value={cuentaSel?.id || ''} onChange={e => setCuentaSel(cuentas.find(c => c.id === e.target.value))} className="input min-w-[240px]">
            {cuentas.map(c => <option key={c.id} value={c.id}>{c.alias}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Mostrar</span>
          <select value={estado} onChange={e => setEstado(e.target.value)} className="input">
            <option value="pendientes">Pendientes de conciliar</option>
            <option value="conciliados">Conciliados</option>
            <option value="">Todos</option>
          </select>
        </label>
        <div className="flex-1" />
        {esAdmin && <button onClick={() => setModal({tipo: 'importar'})} className="btn-primario">Importar CSV</button>}
      </div>

      {/* KPIs */}
      {saldo && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
          <KpiBox label="Saldo según banco" value={fmtQ(saldo.saldo_banco)} bold />
          <KpiBox label="Movimientos" value={saldo.total_movimientos} />
          <KpiBox label="Conciliados" value={saldo.conciliados} tone="green" />
          <KpiBox label="Pendientes" value={saldo.pendientes} tone={saldo.pendientes > 0 ? 'amber' : 'green'} />
        </div>
      )}

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Fecha</th>
              <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Descripción</th>
              <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Ref.</th>
              <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Débito</th>
              <th className="text-right text-xs text-gray-400 font-normal px-3 py-2">Crédito</th>
              <th className="text-left text-xs text-gray-400 font-normal px-3 py-2">Asiento</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1,2,3].map(i => <tr key={i}><td colSpan={7}><SkeletonRow /></td></tr>)}</>
            ) : movs.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-xs text-gray-400 py-8">
                {estado === 'pendientes' ? '✓ Sin movimientos pendientes.' : 'Sin movimientos.'}
              </td></tr>
            ) : movs.map(m => (
              <tr key={m.id} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-3 py-1.5 text-xs text-gray-600">{formatFecha(m.fecha)}</td>
                <td className="px-3 py-1.5 text-gray-800">{m.descripcion}</td>
                <td className="px-3 py-1.5 text-xs text-gray-500 font-mono">{m.referencia || '—'}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-red-600">{Number(m.debito) > 0 ? fmt(m.debito) : ''}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-green-700">{Number(m.credito) > 0 ? fmt(m.credito) : ''}</td>
                <td className="px-3 py-1.5">
                  {m.asientos ? (
                    <span className="text-xs text-julia-red">
                      #{m.asientos.numero} · {m.asientos.descripcion?.slice(0, 30)}{m.asientos.descripcion?.length > 30 ? '…' : ''}
                    </span>
                  ) : <span className="text-xs text-amber-600">— pendiente —</span>}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap">
                  {esAdmin && (
                    m.asientos ? (
                      <button onClick={() => desconciliar(m)} className="text-xs text-gray-400 hover:text-red-500">desconciliar</button>
                    ) : (
                      <button onClick={() => setModal({tipo: 'conciliar', mov: m})} className="text-xs text-julia-red hover:underline">conciliar</button>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.tipo === 'importar' && (
        <ModalImportarCSV cuenta={cuentaSel} onClose={() => setModal(null)} onImportado={() => { setModal(null); cargar() }} />
      )}
      {modal?.tipo === 'conciliar' && (
        <ModalConciliar mov={modal.mov} onClose={() => setModal(null)} onConciliado={() => { setModal(null); cargar() }} />
      )}
    </div>
  )
}

function KpiBox({ label, value, tone = 'gray', bold }) {
  const tones = {
    gray:  'border-gray-100 text-gray-800',
    green: 'border-green-100 text-green-700 bg-green-50',
    amber: 'border-amber-100 text-amber-700 bg-amber-50',
  }
  return (
    <div className={`bg-white border rounded-xl p-3 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 tabular-nums ${bold ? 'text-lg font-semibold' : 'text-base'}`}>{value}</div>
    </div>
  )
}

// ============================================================================
// Modal: Importar CSV
// ============================================================================

function ModalImportarCSV({ cuenta, onClose, onImportado }) {
  const [parsed, setParsed] = useState(null) // {filas, columnas, detectado}
  const [archivo, setArchivo] = useState(null)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [err, setErr] = useState(null)

  function handleFile(file) {
    setArchivo(file); setErr(null); setResultado(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target.result
        const parsed = parseCSV(text)
        setParsed(parsed)
      } catch (e) {
        setErr('Error parseando CSV: ' + e.message)
      }
    }
    reader.readAsText(file)
  }

  async function importar() {
    if (!parsed?.movimientos?.length) return
    setImportando(true); setErr(null)
    const res = await apiFetch('/api/bancos/movimientos', {
      method: 'POST', body: JSON.stringify({ cuenta_id: cuenta.id, movimientos: parsed.movimientos }),
    })
    const json = await res.json()
    setImportando(false)
    if (!res.ok) { setErr(json.error || (json.errores || []).join('; ')); return }
    setResultado(json)
  }

  return (
    <ModalShell titulo={`Importar movimientos: ${cuenta.alias}`} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs text-gray-600 space-y-1">
          <div>El CSV debe tener columnas con encabezado. La detección automática reconoce nombres como:</div>
          <ul className="list-disc list-inside ml-1 text-gray-500">
            <li><b>Fecha:</b> fecha, date</li>
            <li><b>Descripción:</b> descripcion, descripción, description, concepto</li>
            <li><b>Débito:</b> debito, débito, debit, cargo, retiro</li>
            <li><b>Crédito:</b> credito, crédito, credit, abono, deposito</li>
            <li><b>Referencia:</b> referencia, reference, numero, operacion</li>
            <li><b>Saldo (opcional):</b> saldo, balance</li>
          </ul>
          <div className="text-gray-500">Formato de fecha aceptado: <code>YYYY-MM-DD</code> o <code>DD/MM/YYYY</code>.</div>
        </div>

        <input type="file" accept=".csv,text/csv" onChange={e => handleFile(e.target.files[0])} className="text-xs" />

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        {parsed && (
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-3 py-2 text-xs text-gray-600 flex justify-between">
              <span>{parsed.movimientos.length} filas detectadas · columnas: {Object.entries(parsed.detectado).filter(([_,v])=>v!==null).map(([k,v])=>`${k}→col ${v+1}`).join(', ')}</span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1 text-left text-gray-400 font-normal">Fecha</th>
                    <th className="px-2 py-1 text-left text-gray-400 font-normal">Descripción</th>
                    <th className="px-2 py-1 text-right text-gray-400 font-normal">Débito</th>
                    <th className="px-2 py-1 text-right text-gray-400 font-normal">Crédito</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.movimientos.slice(0, 20).map((m, i) => (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-2 py-1 text-gray-600">{m.fecha}</td>
                      <td className="px-2 py-1 text-gray-800">{m.descripcion}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-red-600">{m.debito > 0 ? fmt(m.debito) : ''}</td>
                      <td className="px-2 py-1 text-right tabular-nums text-green-700">{m.credito > 0 ? fmt(m.credito) : ''}</td>
                    </tr>
                  ))}
                  {parsed.movimientos.length > 20 && (
                    <tr><td colSpan={4} className="px-2 py-1 text-center text-xs text-gray-400">… y {parsed.movimientos.length - 20} más</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {resultado && (
          <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-xs text-green-800">
            ✓ {resultado.insertados} insertados, {resultado.duplicados_o_existentes} ya existían (duplicados).
            {resultado.errores_fila?.length > 0 && (
              <div className="text-amber-700 mt-1">⚠ {resultado.errores_fila.length} filas con errores.</div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cerrar</button>
          {parsed && parsed.movimientos.length > 0 && !resultado && (
            <button onClick={importar} disabled={importando} className="btn-primario">{importando ? 'Importando…' : `Importar ${parsed.movimientos.length} mov.`}</button>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

// Parsea CSV con detección automática de columnas.
// Devuelve { movimientos: [{fecha, descripcion, debito, credito, referencia, saldo}], detectado: {fecha: idx, ...} }
function parseCSV(text) {
  const norm = s => String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')

  // Detectar separador (coma vs punto y coma)
  const linea1 = text.split(/\r?\n/)[0] || ''
  const sep = linea1.split(';').length > linea1.split(',').length ? ';' : ','

  // Parser CSV simple (sin manejar comas dentro de comillas en este MVP)
  const filas = text.split(/\r?\n/).filter(l => l.trim()).map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')))
  if (filas.length < 2) throw new Error('Archivo vacio o sin filas de datos')

  const headers = filas[0].map(norm)
  const buscar = (...nombres) => {
    for (const n of nombres) {
      const i = headers.indexOf(n)
      if (i >= 0) return i
    }
    return null
  }
  const detectado = {
    fecha:        buscar('fecha', 'date'),
    descripcion:  buscar('descripcion', 'description', 'concepto', 'detalle'),
    debito:       buscar('debito', 'debit', 'cargo', 'retiro', 'debe'),
    credito:      buscar('credito', 'credit', 'abono', 'deposito', 'haber'),
    referencia:   buscar('referencia', 'reference', 'numero', 'operacion', 'no'),
    saldo:        buscar('saldo', 'balance'),
  }
  if (detectado.fecha == null) throw new Error('No se encontró columna de fecha')
  if (detectado.descripcion == null) throw new Error('No se encontró columna de descripción')
  if (detectado.debito == null && detectado.credito == null) {
    throw new Error('No se encontró columna de débito ni crédito')
  }

  const parseNum = s => {
    if (!s || s === '-' || s === '0' || s === '0.00') return 0
    const n = parseFloat(String(s).replace(/[Q$, ]/g, ''))
    return isNaN(n) ? 0 : Math.abs(n)
  }

  const parseFecha = s => {
    s = String(s).trim()
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
    if (m) {
      const [, d, mo, y] = m
      const yyyy = y.length === 2 ? '20' + y : y
      return `${yyyy}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
    }
    return null
  }

  const movimientos = []
  for (let i = 1; i < filas.length; i++) {
    const fila = filas[i]
    const fecha = parseFecha(fila[detectado.fecha])
    const descripcion = (fila[detectado.descripcion] || '').trim()
    if (!fecha || !descripcion) continue
    const debito  = detectado.debito  != null ? parseNum(fila[detectado.debito])  : 0
    const credito = detectado.credito != null ? parseNum(fila[detectado.credito]) : 0
    if (debito === 0 && credito === 0) continue
    movimientos.push({
      fecha, descripcion,
      debito, credito,
      referencia: detectado.referencia != null ? (fila[detectado.referencia] || '').trim() : null,
      saldo: detectado.saldo != null ? parseNum(fila[detectado.saldo]) : null,
    })
  }
  return { movimientos, detectado }
}

// ============================================================================
// Modal: Conciliar
// ============================================================================

function ModalConciliar({ mov, onClose, onConciliado }) {
  const [sugerencias, setSugerencias] = useState(null)
  const [seleccionado, setSeleccionado] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [todosAsientos, setTodosAsientos] = useState([])
  const [cuentasContables, setCuentasContables] = useState([])
  const [modo, setModo] = useState('existente') // 'existente' | 'crear'
  const [crearForm, setCrearForm] = useState({ cuenta_contrapartida_id: '', concepto: '' })
  const [accionando, setAccionando] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    (async () => {
      const res = await apiFetch(`/api/bancos/movimientos/${mov.id}/sugerir`)
      const json = await res.json()
      setSugerencias(json.sugerencias || [])
    })()
    apiFetch('/api/asientos?estado=posteado&limit=200').then(r => r.json()).then(j => setTodosAsientos(j.asientos || []))
    apiFetch('/api/cuentas').then(r => r.json()).then(j => setCuentasContables((j.cuentas || []).filter(c => c.es_movimiento)))
  }, [mov.id])

  const filtradosOtros = useMemo(() => {
    if (!busqueda) return []
    const b = busqueda.toLowerCase()
    return todosAsientos.filter(a =>
      a.descripcion?.toLowerCase().includes(b) ||
      String(a.numero).includes(b) ||
      String(a.total_debe).includes(b)
    ).slice(0, 15)
  }, [busqueda, todosAsientos])

  async function conciliarExistente() {
    if (!seleccionado) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/bancos/movimientos/${mov.id}`, {
      method: 'PATCH', body: JSON.stringify({ asiento_id: seleccionado }),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onConciliado()
  }

  async function crearYConciliar() {
    if (!crearForm.cuenta_contrapartida_id) { setErr('Elegí cuenta de contrapartida'); return }
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/bancos/movimientos/${mov.id}/generar-asiento`, {
      method: 'POST',
      body: JSON.stringify({
        cuenta_contrapartida_id: crearForm.cuenta_contrapartida_id,
        concepto: crearForm.concepto,
      }),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onConciliado()
  }

  const monto = Number(mov.debito) || Number(mov.credito)
  const esDebito = Number(mov.debito) > 0

  return (
    <ModalShell titulo="Conciliar movimiento" onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <div className="text-xs text-gray-400 mb-1">Movimiento bancario</div>
          <div className="text-gray-800">{mov.descripcion}</div>
          <div className="text-xs text-gray-500 mt-1">{formatFecha(mov.fecha)} · {esDebito ? `débito ${fmtQ(mov.debito)}` : `crédito ${fmtQ(mov.credito)}`}{mov.referencia && ` · ref ${mov.referencia}`}</div>
        </div>

        {/* Modo selector */}
        <div className="grid grid-cols-2 gap-1 bg-gray-50 rounded-lg p-1">
          <button onClick={() => setModo('existente')}
            className={`text-xs py-2 rounded ${modo === 'existente' ? 'bg-white shadow-sm font-medium text-julia-red' : 'text-gray-500'}`}>
            Conciliar con asiento existente
          </button>
          <button onClick={() => setModo('crear')}
            className={`text-xs py-2 rounded ${modo === 'crear' ? 'bg-white shadow-sm font-medium text-julia-red' : 'text-gray-500'}`}>
            Crear asiento nuevo
          </button>
        </div>

        {modo === 'existente' ? (
          <>
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-2">Asientos sugeridos (mismo monto, ±7 días)</div>
              {sugerencias === null ? (
                <div className="text-sm text-gray-400">Buscando…</div>
              ) : sugerencias.length === 0 ? (
                <div className="text-sm text-gray-400 py-3 text-center bg-gray-50 rounded-lg">
                  Sin sugerencias automáticas. Buscá manualmente abajo o creá un asiento nuevo.
                </div>
              ) : (
                <div className="border border-gray-100 rounded-lg divide-y divide-gray-50">
                  {sugerencias.map(s => (
                    <label key={s.asiento_id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-julia-cream/20 ${seleccionado === s.asiento_id ? 'bg-julia-cream/40' : ''}`}>
                      <input type="radio" name="sugerencia" checked={seleccionado === s.asiento_id} onChange={() => setSeleccionado(s.asiento_id)} className="text-julia-red" />
                      <div className="flex-1">
                        <div className="text-sm text-gray-800">#{s.numero} · {s.descripcion}</div>
                        <div className="text-xs text-gray-500">{formatFecha(s.fecha)} · {s.origen_tipo || 'manual'} · Δ {s.delta_dias} días</div>
                      </div>
                      <div className="text-sm tabular-nums font-medium">{fmtQ(s.monto)}</div>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-2">Buscar otro asiento</div>
              <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar por descripción, número o monto…" className="input" />
              {busqueda && filtradosOtros.length > 0 && (
                <div className="mt-2 border border-gray-100 rounded-lg divide-y divide-gray-50 max-h-48 overflow-y-auto">
                  {filtradosOtros.map(a => (
                    <label key={a.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-julia-cream/20 ${seleccionado === a.id ? 'bg-julia-cream/40' : ''}`}>
                      <input type="radio" name="otros" checked={seleccionado === a.id} onChange={() => setSeleccionado(a.id)} className="text-julia-red" />
                      <div className="flex-1">
                        <div className="text-sm text-gray-800">#{a.numero} · {a.descripcion}</div>
                        <div className="text-xs text-gray-500">{formatFecha(a.fecha)}</div>
                      </div>
                      <div className={`text-sm tabular-nums ${Math.abs(Number(a.total_debe) - monto) < 0.01 ? 'font-medium text-green-700' : 'text-gray-600'}`}>
                        {fmtQ(a.total_debe)}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-800">
              Se creará un asiento posteado: <b>{esDebito ? 'HABER' : 'DEBE'}</b> banco · <b>{esDebito ? 'DEBE' : 'HABER'}</b> {esDebito ? 'cuenta de gasto/cargo elegida' : 'cuenta de ingreso/origen elegida'}.
              <br />Útil para comisiones bancarias, intereses, depósitos sueltos, etc.
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">
                Cuenta {esDebito ? 'de gasto o destino del cargo' : 'de origen del depósito'} <span className="text-julia-red">*</span>
              </label>
              <select value={crearForm.cuenta_contrapartida_id}
                onChange={e => setCrearForm({...crearForm, cuenta_contrapartida_id: e.target.value})}
                className="input">
                <option value="">— elegir cuenta contable —</option>
                {cuentasContables.map(c => <option key={c.id} value={c.id}>{c.codigo} · {c.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Concepto (opcional)</label>
              <input type="text" value={crearForm.concepto} onChange={e => setCrearForm({...crearForm, concepto: e.target.value})}
                className="input" placeholder={mov.descripcion} />
            </div>
          </div>
        )}

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          {modo === 'existente' ? (
            <button onClick={conciliarExistente} disabled={!seleccionado || accionando} className="btn-primario">
              {accionando ? '…' : 'Conciliar'}
            </button>
          ) : (
            <button onClick={crearYConciliar} disabled={!crearForm.cuenta_contrapartida_id || accionando} className="btn-primario">
              {accionando ? '…' : 'Crear asiento y conciliar'}
            </button>
          )}
        </div>
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
