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

const fmt = n => 'Q' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MESES = ['', 'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function formatFechaCorta(s) {
  if (!s) return '—'
  // Si llega como 'YYYY-MM-DD' (date sin hora), interpretarlo como mediodia GT
  // para evitar el off-by-one que daria new Date('2026-05-21') = 00:00 UTC =
  // 18:00 GT del dia anterior, lo cual hace que toLocaleDateString muestre "20 may".
  const safe = typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00' : s
  return new Date(safe).toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ============================================================================
// Pagina
// ============================================================================

export default function IGSS({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [tab, setTab] = useState('resumen')

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
        <h1 className="text-xl font-semibold text-gray-900 mb-4">IGSS</h1>

        <div className="flex gap-1 border-b border-gray-200 mb-5">
          <TabBtn active={tab === 'resumen'}     onClick={() => setTab('resumen')}>Mes actual</TabBtn>
          <TabBtn active={tab === 'historico'}   onClick={() => setTab('historico')}>Histórico</TabBtn>
          <TabBtn active={tab === 'config'}      onClick={() => setTab('config')}>Configuración patrono</TabBtn>
        </div>

        {tab === 'resumen'   && <TabResumen esAdmin={esAdmin} />}
        {tab === 'historico' && <TabHistorico esAdmin={esAdmin} />}
        {tab === 'config'    && <TabConfig esAdmin={esAdmin} />}
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
// Tab Resumen — DR-182-1 mockup + tabla empleados + acciones
// ============================================================================

function TabResumen({ esAdmin }) {
  const hoy = new Date()
  const [periodo, setPeriodo] = useState({ mes: hoy.getMonth() + 1, anio: hoy.getFullYear() })
  const [preview, setPreview] = useState(null)
  const [config, setConfig] = useState(null)
  const [yaPresentada, setYaPresentada] = useState(null) // declaracion existente del mes
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [accionando, setAccionando] = useState(false)
  const [modalPresentar, setModalPresentar] = useState(false)

  useEffect(() => { cargar() }, [periodo])

  async function cargar() {
    setLoading(true); setErr(null)
    const [pRes, cRes, hRes] = await Promise.all([
      apiFetch(`/api/igss/preview?anio=${periodo.anio}&mes=${periodo.mes}`),
      apiFetch('/api/igss/config'),
      apiFetch(`/api/igss/declaraciones?limit=24`),
    ])
    const pJson = await pRes.json()
    const cJson = await cRes.json()
    const hJson = await hRes.json()
    if (!pRes.ok) setErr(pJson.error || 'Error')
    else setPreview(pJson)
    setConfig(cJson.config)
    setYaPresentada((hJson.declaraciones || []).find(d => d.anio === periodo.anio && d.mes === periodo.mes) || null)
    setLoading(false)
  }

  async function descargarTXT() {
    setAccionando(true); setErr(null)
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/igss/txt?anio=${periodo.anio}&mes=${periodo.mes}`, {
      headers: { Authorization: `Bearer ${session?.access_token || ''}` },
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setAccionando(false)
      setErr(j.error || 'Error descargando TXT')
      return
    }
    const blob = await res.blob()
    const cd = res.headers.get('content-disposition') || ''
    const nombre = cd.match(/filename="([^"]+)"/)?.[1] || `IGSS-${periodo.anio}-${periodo.mes}.TXT`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = nombre; a.click()
    URL.revokeObjectURL(url)
    setAccionando(false)
  }

  function cambiarMes(delta) {
    setPeriodo(p => {
      let m = p.mes + delta
      let a = p.anio
      if (m < 1) { m = 12; a-- }
      if (m > 12) { m = 1; a++ }
      return { mes: m, anio: a }
    })
  }

  const noHayConfig = !config

  return (
    <div>
      {/* Selector periodo */}
      <div className="flex items-center justify-center gap-3 mb-4">
        <button onClick={() => cambiarMes(-1)} className="text-gray-400 hover:text-julia-red px-2 py-1">←</button>
        <div className="text-lg font-medium text-gray-800 min-w-[180px] text-center">
          {MESES[periodo.mes]} {periodo.anio}
        </div>
        <button onClick={() => cambiarMes(1)} className="text-gray-400 hover:text-julia-red px-2 py-1">→</button>
      </div>

      {noHayConfig && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg px-4 py-3 text-sm text-amber-800 mb-4">
          ⚠ No hay datos del patrono configurados. Ir a la pestaña <span className="font-medium">Configuración patrono</span> antes de descargar el TXT.
        </div>
      )}

      {yaPresentada && (
        <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-3 text-sm text-green-800 mb-4">
          ✓ Este mes ya fue presentado el {formatFechaCorta(yaPresentada.presentada_at)} por {fmt(yaPresentada.total_pagar)}.
        </div>
      )}

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      {loading || !preview ? (
        <div className="text-sm text-gray-400 py-8 text-center">Cargando…</div>
      ) : (
        <>
          {/* Recibo DR-182-1 */}
          <ReciboDR182 datos={preview} config={config} />

          {/* Tabla empleados */}
          <div className="mt-6 bg-white border border-gray-100 rounded-xl overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-gray-400 font-normal">Empleado</th>
                  <th className="px-3 py-2 text-left text-gray-400 font-normal">N° IGSS</th>
                  <th className="px-3 py-2 text-right text-gray-400 font-normal">Sal. imponible</th>
                  <th className="px-3 py-2 text-right text-gray-400 font-normal">Patronal</th>
                  <th className="px-3 py-2 text-right text-gray-400 font-normal">Laboral</th>
                  <th className="px-3 py-2 text-right text-gray-400 font-normal">IRTRA</th>
                  <th className="px-3 py-2 text-right text-gray-400 font-normal">INTECAP</th>
                  <th className="px-3 py-2 text-right text-gray-400 font-normal">Total</th>
                </tr>
              </thead>
              <tbody>
                {preview.empleados.length === 0 ? (
                  <tr><td colSpan={8} className="text-center text-xs text-gray-400 py-8">Sin empleados con salario.</td></tr>
                ) : preview.empleados.map(e => (
                  <tr key={e.empleado_id || e.nombre} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-3 py-1.5">
                      <div className="text-gray-800">{e.nombre}</div>
                      <div className="text-[10px] text-gray-400">{e.puesto} {e.fuente === 'catalogo' && <span className="text-amber-500">· (sin planilla del mes)</span>}</div>
                    </td>
                    <td className="px-3 py-1.5 text-gray-500">{e.numero_igss || <span className="text-amber-500">—</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmt(e.sal_mensual_igss)}</td>
                    <td className="px-3 py-1.5 text-right text-blue-600 tabular-nums">{fmt(e.cuotas.patronal)}</td>
                    <td className="px-3 py-1.5 text-right text-purple-600 tabular-nums">{fmt(e.cuotas.laboral)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{fmt(e.cuotas.irtra)}</td>
                    <td className="px-3 py-1.5 text-right text-gray-500 tabular-nums">{fmt(e.cuotas.intecap)}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{fmt(e.cuotas.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Acciones */}
          {esAdmin && (
            <div className="flex flex-wrap justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
              <button onClick={descargarTXT} disabled={accionando || noHayConfig || preview.empleados.length === 0}
                className="btn-secundario">Descargar TXT v2.2.0</button>
              {!yaPresentada && (
                <button onClick={() => setModalPresentar(true)} disabled={accionando || noHayConfig || preview.empleados.length === 0}
                  className="btn-primario">Registrar como presentada</button>
              )}
            </div>
          )}
        </>
      )}

      {modalPresentar && (
        <ModalPresentar anio={periodo.anio} mes={periodo.mes}
          onClose={() => setModalPresentar(false)} onSaved={() => { setModalPresentar(false); cargar() }} />
      )}
    </div>
  )
}

// ============================================================================
// Recibo DR-182-1
// ============================================================================

function ReciboDR182({ datos, config }) {
  const { anio, mes, empleados, totales } = datos
  const fila = (n, label, val) => (
    <tr key={n} className="border-b border-gray-50">
      <td className="py-1.5 text-gray-700">{n} {label}</td>
      <td className={`py-1.5 text-right tabular-nums ${Number(val) > 0 ? 'font-medium text-gray-900' : 'text-gray-400'}`}>{fmt(val)}</td>
    </tr>
  )
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden text-xs">
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 text-center">
        <div className="text-sm font-bold text-gray-800">INSTITUTO GUATEMALTECO DE SEGURIDAD SOCIAL</div>
        <div className="text-xs text-gray-600 mt-0.5">RECIBO DE CUOTAS DE PATRONOS Y DE TRABAJADORES — IMPUESTO IRTRA Y TASA INTECAP</div>
        <div className="text-xs font-bold text-gray-700 mt-1">DR-182-1</div>
      </div>
      <div className="px-6 py-3 border-b border-gray-100 grid grid-cols-2 gap-x-8 gap-y-1.5">
        <Cab n="05" label="N° patronal" val={config?.numero_patronal || '—'} bold />
        <Cab n="06" label="Mes contribución" val={`${MESES[mes]} / ${anio}`} bold />
        <Cab n="07" label="Nombre patrono" val={config?.nombre_patrono || '—'} bold span />
        <Cab n="08" label="Dirección" val={config?.direccion || '—'} span />
        <Cab n="09" label="N° trabajadores" val={totales.trabajadores} bold />
        <Cab n="10" label="Total salarios" val={fmt(totales.total_salarios)} bold />
      </div>
      <div className="px-6 py-3">
        <table className="w-full">
          <tbody>
            {fila('13', 'Cuota de patronos', totales.patronal)}
            {fila('14', 'Cuota de trabajadores', totales.laboral)}
            {fila('15', 'Recargo por cuotas', 0)}
            {fila('16', 'Intereses resarcitorios por cuotas', 0)}
            {fila('17', 'Impuesto IRTRA', totales.irtra)}
            {fila('18', 'Recargo impuesto IRTRA', 0)}
            {fila('19', 'Intereses resarcitorios IRTRA', 0)}
            {fila('20', 'Tasa INTECAP', totales.intecap)}
            {fila('21', 'Recargo INTECAP', 0)}
            {fila('22', 'Recargos administrativos', 0)}
            <tr className="border-t-2 border-gray-800">
              <td className="py-2 font-bold text-gray-900">23 Total a pagar</td>
              <td className="py-2 text-right font-bold text-base text-gray-900 tabular-nums">{fmt(totales.total_pagar)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="bg-gray-50 border-t border-gray-200 px-6 py-2 text-center text-xs text-gray-500">
        Fecha de vencimiento: día 20 del mes siguiente · Banco Industrial Agencia Virtual
      </div>
    </div>
  )
}

function Cab({ n, label, val, bold, span }) {
  return (
    <div className={`flex gap-2 ${span ? 'col-span-2' : ''}`}>
      <span className="text-gray-400 w-32">{n} {label}:</span>
      <span className={bold ? 'font-bold text-gray-800' : 'text-gray-700'}>{val}</span>
    </div>
  )
}

// ============================================================================
// Modal: registrar como presentada
// ============================================================================

function ModalPresentar({ anio, mes, onClose, onSaved }) {
  const [comprobante, setComprobante] = useState('')
  const [pagadaAt, setPagadaAt] = useState('')
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const res = await apiFetch('/api/igss/declaraciones', {
      method: 'POST',
      body: JSON.stringify({ anio, mes, comprobante_pago_numero: comprobante, pagada_at: pagadaAt || null, notas }),
    })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  return (
    <ModalShell titulo={`Registrar IGSS — ${MESES[mes]} ${anio}`} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-3">
        <p className="text-xs text-gray-500">
          Guarda un snapshot con los totales calculados y el archivo TXT generado. Útil para auditoría.
        </p>
        <Campo label="N° comprobante de pago (opcional)">
          <input type="text" value={comprobante} onChange={e => setComprobante(e.target.value)} className="input" />
        </Campo>
        <Campo label="Fecha de pago (opcional)">
          <input type="date" value={pagadaAt} onChange={e => setPagadaAt(e.target.value)} className="input" />
        </Campo>
        <Campo label="Notas">
          <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)} className="input" />
        </Campo>
        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">{guardando ? 'Guardando…' : 'Registrar'}</button>
        </div>
      </form>
    </ModalShell>
  )
}

// ============================================================================
// Tab Historico
// ============================================================================

function TabHistorico({ esAdmin }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/api/igss/declaraciones')
      const json = await res.json()
      setItems(json.declaraciones || [])
      setLoading(false)
    })()
  }, [])

  return (
    <div>
      <div className="text-xs text-gray-400 mb-2">{items.length} declaraciones</div>
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Período</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Trab.</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Salarios</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Total pagado</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Presentada</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Pagada</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Comprobante</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1,2,3].map(i => <tr key={i}><td colSpan={7}><SkeletonRow /></td></tr>)}</>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-xs text-gray-400 py-8">Sin declaraciones registradas aún.</td></tr>
            ) : items.map(d => (
              <tr key={d.id} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2 text-gray-800">{MESES[d.mes]} {d.anio}</td>
                <td className="px-4 py-2 text-right text-gray-600 tabular-nums">{d.trabajadores}</td>
                <td className="px-4 py-2 text-right text-gray-700 tabular-nums">{fmt(d.total_salarios)}</td>
                <td className="px-4 py-2 text-right text-gray-900 font-medium tabular-nums">{fmt(d.total_pagar)}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{formatFechaCorta(d.presentada_at)}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{d.pagada_at ? formatFechaCorta(d.pagada_at) : <span className="text-amber-500">pendiente</span>}</td>
                <td className="px-4 py-2 text-xs text-gray-500">{d.comprobante_pago_numero || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================================================
// Tab Config
// ============================================================================

function TabConfig({ esAdmin }) {
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [f, setF] = useState(null)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/api/igss/config')
      const json = await res.json()
      setConfig(json.config)
      setF(json.config || {
        numero_patronal: '', nit_patrono: '', nombre_patrono: '',
        direccion: '', email_patrono: '', codigo_ocupacion: 5018, codigo_actividad: '452001',
      })
      setLoading(false)
    })()
  }, [])

  if (loading || !f) return <div className="text-sm text-gray-400 py-6">Cargando…</div>

  async function guardar(e) {
    e.preventDefault()
    if (!esAdmin) return
    setErr(null); setMsg(null); setGuardando(true)
    const res = await apiFetch('/api/igss/config', { method: 'PUT', body: JSON.stringify(f) })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    setMsg('✓ Configuración guardada')
    setConfig(json.config)
  }

  return (
    <form onSubmit={guardar} className="max-w-xl space-y-3">
      <div className="text-xs text-gray-500 mb-2">
        Datos del patrono utilizados en el TXT y el recibo DR-182-1.
      </div>
      <Campo label="Número patronal IGSS" required>
        <input type="text" required disabled={!esAdmin} value={f.numero_patronal} onChange={e => setF({...f, numero_patronal: e.target.value})} className="input" />
      </Campo>
      <Campo label="NIT del patrono" required>
        <input type="text" required disabled={!esAdmin} value={f.nit_patrono} onChange={e => setF({...f, nit_patrono: e.target.value})} className="input" />
      </Campo>
      <Campo label="Nombre del patrono" required>
        <input type="text" required disabled={!esAdmin} value={f.nombre_patrono} onChange={e => setF({...f, nombre_patrono: e.target.value})} className="input" />
      </Campo>
      <Campo label="Dirección">
        <input type="text" disabled={!esAdmin} value={f.direccion || ''} onChange={e => setF({...f, direccion: e.target.value})} className="input" />
      </Campo>
      <Campo label="Email">
        <input type="email" disabled={!esAdmin} value={f.email_patrono || ''} onChange={e => setF({...f, email_patrono: e.target.value})} className="input" />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Código ocupación">
          <input type="number" disabled={!esAdmin} value={f.codigo_ocupacion} onChange={e => setF({...f, codigo_ocupacion: e.target.value})} className="input"
            placeholder="5018 = Panadero" />
        </Campo>
        <Campo label="Código actividad (CIIU)">
          <input type="text" disabled={!esAdmin} value={f.codigo_actividad} onChange={e => setF({...f, codigo_actividad: e.target.value})} className="input" />
        </Campo>
      </div>
      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}
      {msg && <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-xs text-green-700">{msg}</div>}
      {esAdmin && (
        <div className="flex justify-end pt-2">
          <button type="submit" disabled={guardando} className="btn-primario">{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
      )}
    </form>
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
