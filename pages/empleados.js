import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import ImportarCSV from '../components/ImportarCSV'
import { calcularProvisiones } from '../lib/planillas'

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

// ============================================================================
// Pagina
// ============================================================================

export default function Empleados({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [tab, setTab] = useState('personal')

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
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">Empleados</h1>

        <div className="flex gap-1 border-b border-gray-200 mb-5">
          <TabBtn active={tab === 'personal'} onClick={() => setTab('personal')}>Personal</TabBtn>
          <TabBtn active={tab === 'cajeros'}  onClick={() => setTab('cajeros')}>Cajeros (Loyverse)</TabBtn>
        </div>

        {tab === 'personal' && <TabPersonal esAdmin={esAdmin} />}
        {tab === 'cajeros'  && <TabCajeros />}
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
// Tab Personal (CRUD empleados con salario)
// ============================================================================

function TabPersonal({ esAdmin }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [modal, setModal] = useState(null)

  useEffect(() => { cargar() }, [verInactivos])

  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch('/api/empleados' + (verInactivos ? '?incluir_inactivos=1' : ''))
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Error'); setItems([]) }
    else setItems(json.empleados || [])
    setLoading(false)
  }

  const filtrados = useMemo(() =>
    items.filter(e => !busqueda || e.nombre.toLowerCase().includes(busqueda.toLowerCase())), [items, busqueda])

  const totales = useMemo(() => {
    const activos = items.filter(e => e.activo)
    return {
      cantidad: activos.length,
      planilla: activos.reduce((s, e) => s + Number(e.salario_quincenal || 0), 0),
      costoQuincenal: activos.reduce((s, e) => s + Number(e.costo_patronal_quincenal || 0), 0),
    }
  }, [items])

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <KpiBox label="Empleados activos" value={totales.cantidad} />
        <KpiBox label="Planilla bruta quincenal" value={formatMoney(totales.planilla)} />
        <KpiBox label="Costo patronal quincenal" value={formatMoney(totales.costoQuincenal)} />
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <input type="text" placeholder="Buscar…" value={busqueda} onChange={e => setBusqueda(e.target.value)}
          className="input flex-1 max-w-xs" />
        <label className="inline-flex items-center gap-2 text-sm text-gray-600">
          <input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} className="rounded" />
          Ver inactivos
        </label>
        <div className="flex-1" />
        {esAdmin && (
          <>
            <button onClick={() => setModal({ tipo: 'importar' })} className="btn-secundario">Importar CSV</button>
            <button onClick={() => setModal({ tipo: 'nuevo' })} className="btn-primario">+ Nuevo empleado</button>
          </>
        )}
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Nombre</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Puesto</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Área</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Salario quincenal</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Pago</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1,2,3].map(i => <tr key={i}><td colSpan={6}><SkeletonRow /></td></tr>)}</>
            ) : filtrados.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-8">
                {items.length === 0 ? 'Sin empleados aún.' : 'Sin resultados.'}
                {esAdmin && items.length === 0 && (
                  <button onClick={() => setModal({ tipo: 'nuevo' })} className="text-julia-red hover:underline ml-1">Crear el primero →</button>
                )}
              </td></tr>
            ) : filtrados.map(e => (
              <tr key={e.id} className={`border-t border-gray-50 hover:bg-gray-50 ${!e.activo ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2.5 text-gray-800">
                  {e.nombre} {!e.activo && <span className="text-xs text-gray-400">(inactivo)</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-600">{e.puesto}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{e.area || '—'}</td>
                <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{formatMoney(e.salario_quincenal)}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{e.tipo_pago}</td>
                <td className="px-4 py-2.5 text-right">
                  {esAdmin && (
                    <button onClick={() => setModal({ tipo: 'editar', empleado: e })}
                      className="text-xs text-julia-red hover:underline">Editar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {modal?.tipo !== 'importar' && modal && (
        <ModalEmpleado empleado={modal.empleado} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargar() }} />
      )}
      {modal?.tipo === 'importar' && (
        <ImportarCSV
          titulo="Importar empleados desde CSV"
          schema={{
            nombre:                        ['nombre', 'name', 'empleado'],
            dpi:                           ['dpi', 'cui'],
            nit:                           ['nit'],
            numero_igss:                   ['numero_igss', 'igss', 'no_igss'],
            area:                          ['area', 'área', 'departamento'],
            puesto:                        ['puesto', 'cargo', 'position'],
            tipo_pago:                     ['tipo_pago', 'forma_pago', 'metodo_pago'],
            banco:                         ['banco', 'bank'],
            numero_cuenta:                 ['numero_cuenta', 'cuenta', 'account'],
            fecha_ingreso:                 ['fecha_ingreso', 'ingreso', 'fecha_inicio'],
            salario_mensual:               ['salario_mensual', 'salario', 'sueldo'],
            bonificacion_quincenal:        ['bonificacion_quincenal', 'bono_quincenal'],
            bonificacion_segunda_quincena: ['bonificacion_segunda_quincena', 'bono_2da_quincena'],
            notas:                         ['notas', 'observaciones', 'notes'],
          }}
          requeridos={['nombre', 'salario_mensual']}
          endpoint="/api/empleados/bulk"
          ejemplo={`nombre,dpi,puesto,area,salario_mensual,fecha_ingreso,tipo_pago,bonificacion_quincenal
Maria Lopez,2345678901101,Panadero,panaderia,4002.28,2024-01-15,efectivo,0
Juan Perez,1234567890101,Maestro panadero,panaderia,5500,2023-06-01,transferencia,250`}
          onClose={() => setModal(null)}
          onImportado={() => { setModal(null); cargar() }}
        />
      )}
    </div>
  )
}

function KpiBox({ label, value }) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-3">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-lg font-semibold text-gray-800 mt-1 tabular-nums">{value}</div>
    </div>
  )
}

// ============================================================================
// Modal: Empleado (crear / editar)
// ============================================================================

function ModalEmpleado({ empleado, onClose, onSaved }) {
  const edicion = !!empleado
  const [f, setF] = useState({
    nombre:        empleado?.nombre || '',
    dpi:           empleado?.dpi || '',
    nit:           empleado?.nit || '',
    numero_igss:   empleado?.numero_igss || '',
    area:          empleado?.area || 'panaderia',
    puesto:        empleado?.puesto || 'Panadero',
    tipo_pago:     empleado?.tipo_pago || 'efectivo',
    banco:         empleado?.banco || '',
    numero_cuenta: empleado?.numero_cuenta || '',
    fecha_ingreso: empleado?.fecha_ingreso || '',
    salario_mensual: empleado?.salario_mensual || '',
    bonificacion_quincenal: empleado?.bonificacion_quincenal || 0,
    bonificacion_segunda_quincena: empleado?.bonificacion_segunda_quincena || 0,
    notas:         empleado?.notas || '',
    activo:        empleado?.activo ?? true,
  })
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  function set(k, v) { setF(p => ({ ...p, [k]: v })) }

  const sal = Number(f.salario_mensual) || 0
  // Las provisiones (sal/2, bono14, aguinaldo, vacaciones, igss, IRTRA, INTECAP,
  // indemnización) usan la misma función pura que la API al guardar — asegura
  // que el preview matchea el costo_patronal_quincenal que se persiste.
  const previewProv = useMemo(() => calcularProvisiones(sal), [sal])
  const previewQuincenal = previewProv.salario_quincenal
  const previewIgss = previewProv.igss_empleado_quincenal
  const previewLiquido = previewQuincenal - previewIgss + (Number(f.bonificacion_quincenal) || 0)

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const payload = { ...f, salario_mensual: sal }
    const res = await apiFetch(
      edicion ? `/api/empleados/${empleado.id}` : '/api/empleados',
      { method: edicion ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
    )
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  return (
    <ModalShell titulo={edicion ? `Editar: ${empleado.nombre}` : 'Nuevo empleado'} onClose={onClose} maxWidth="max-w-xl">
      <form onSubmit={guardar} className="space-y-3">
        <Campo label="Nombre completo" required>
          <input type="text" required value={f.nombre} onChange={e => set('nombre', e.target.value)} className="input" autoFocus />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Puesto">
            <input type="text" value={f.puesto} onChange={e => set('puesto', e.target.value)} className="input"
              list="puestos-comunes" />
            <datalist id="puestos-comunes">
              <option value="Panadero" /><option value="Maestro panadero" /><option value="Pastelero" />
              <option value="Cajero" /><option value="Vendedor" /><option value="Repartidor" />
              <option value="Administrador" /><option value="Contador" /><option value="Ayudante" />
            </datalist>
          </Campo>
          <Campo label="Área">
            <select value={f.area} onChange={e => set('area', e.target.value)} className="input">
              <option value="panaderia">Panadería</option>
              <option value="ventas">Ventas</option>
              <option value="administracion">Administración</option>
              <option value="reparto">Reparto</option>
              <option value="otra">Otra</option>
            </select>
          </Campo>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Campo label="DPI">
            <input type="text" value={f.dpi} onChange={e => set('dpi', e.target.value)} className="input" />
          </Campo>
          <Campo label="NIT">
            <input type="text" value={f.nit} onChange={e => set('nit', e.target.value)} className="input" />
          </Campo>
          <Campo label="N° IGSS">
            <input type="text" value={f.numero_igss} onChange={e => set('numero_igss', e.target.value)} className="input" />
          </Campo>
        </div>

        <Campo label="Fecha ingreso">
          <input type="date" value={f.fecha_ingreso || ''} onChange={e => set('fecha_ingreso', e.target.value)} className="input" />
        </Campo>

        <Campo label="Salario mensual (Q)" required>
          <input type="number" step="0.01" required value={f.salario_mensual} onChange={e => set('salario_mensual', e.target.value)} className="input" />
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Bonif. quincenal fija (Q)">
            <input type="number" step="0.01" value={f.bonificacion_quincenal}
              onChange={e => set('bonificacion_quincenal', e.target.value)} className="input"
              placeholder="0 = sin bono fijo" />
          </Campo>
          <Campo label="Bonif. solo 2da quincena (Q)">
            <input type="number" step="0.01" value={f.bonificacion_segunda_quincena}
              onChange={e => set('bonificacion_segunda_quincena', e.target.value)} className="input" />
          </Campo>
        </div>

        {sal > 0 && (
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs space-y-1">
            <div className="flex justify-between"><span className="text-gray-500">Salario quincenal:</span><span className="tabular-nums font-medium">{formatMoney(previewQuincenal)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">IGSS empleado (4.83%):</span><span className="tabular-nums text-red-600">- {formatMoney(previewIgss)}</span></div>
            <div className="flex justify-between text-gray-700 border-t border-gray-200 pt-1 mt-1"><span>Líquido aproximado:</span><span className="tabular-nums font-semibold">{formatMoney(previewLiquido)}</span></div>
            <div className="flex justify-between text-gray-400"><span>Costo patronal quincenal:</span><span className="tabular-nums">{formatMoney(previewProv.costo_patronal_quincenal)}</span></div>
          </div>
        )}

        <Campo label="Tipo de pago">
          <select value={f.tipo_pago} onChange={e => set('tipo_pago', e.target.value)} className="input">
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="cheque">Cheque</option>
          </select>
        </Campo>

        {f.tipo_pago === 'transferencia' && (
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Banco">
              <input type="text" value={f.banco} onChange={e => set('banco', e.target.value)} className="input" />
            </Campo>
            <Campo label="N° cuenta">
              <input type="text" value={f.numero_cuenta} onChange={e => set('numero_cuenta', e.target.value)} className="input" />
            </Campo>
          </div>
        )}

        <Campo label="Notas">
          <textarea value={f.notas} onChange={e => set('notas', e.target.value)} rows={2} className="input" />
        </Campo>

        {edicion && (
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={f.activo} onChange={e => set('activo', e.target.checked)} className="rounded" />
            Empleado activo
          </label>
        )}

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

// ============================================================================
// Tab Cajeros (Loyverse — solo lectura)
// ============================================================================

function TabCajeros() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('loyverse_employees')
        .select('loyverse_id, name, email, phone_number, is_owner, created_at')
        .order('name')
      setItems(data || [])
      setLoading(false)
    })()
  }, [])

  return (
    <div>
      <div className="text-xs text-gray-400 mb-2">
        Usuarios registrados en Loyverse POS. Se sincronizan automáticamente.
      </div>
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Nombre</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Email</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Teléfono</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Rol POS</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1,2,3].map(i => <tr key={i}><td colSpan={4}><SkeletonRow /></td></tr>)}</>
            ) : items.length === 0 ? (
              <tr><td colSpan={4} className="text-center text-xs text-gray-400 py-8">Sin cajeros sincronizados.</td></tr>
            ) : items.map(e => (
              <tr key={e.loyverse_id} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-700">{e.name || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{e.email || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{e.phone_number || '—'}</td>
                <td className="px-4 py-2.5">
                  {e.is_owner
                    ? <span className="text-xs bg-julia-cream/40 text-julia-red px-2 py-0.5 rounded">Propietario</span>
                    : <span className="text-xs text-gray-500">Cajero</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
