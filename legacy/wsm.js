import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

const TIPOS = ['super', 'vpower', 'diesel', 'regular']
const TIPO_LABEL = { super: 'Super', vpower: 'V-Power', diesel: 'Diesel', regular: 'Regular' }
const TIPO_COLOR = { super: '#16A34A', vpower: '#DC2626', diesel: '#1C1917', regular: '#CA8A04' }
const OAKLAND_ID = '85da69a8-1e81-48a7-8b0d-82df9eeec15e'

function Badge({ value, pct, limite }) {
  const abs = Math.abs(parseFloat(pct || 0))
  const ok = abs <= limite
  if (ok) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-50 text-green-700">OK</span>
  if (abs <= limite * 1.5) return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-600">⚠ {parseFloat(pct).toFixed(2)}%</span>
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-600">✕ {parseFloat(pct).toFixed(2)}%</span>
}

function MiniBar({ pct, limite }) {
  const abs = Math.abs(parseFloat(pct || 0))
  const color = abs > limite ? '#dc2626' : abs > limite * 0.8 ? '#d97706' : '#16a34a'
  const width = Math.min((abs / (limite * 2)) * 100, 100)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${width}%`, background: color }} />
      </div>
    </div>
  )
}

export default function WSM({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tipoSeleccionado, setTipoSeleccionado] = useState('super')
  const [registros, setRegistros] = useState([])
  const [alertas, setAlertas] = useState([])
  const [recalculando, setRecalculando] = useState(false)
  const [modalEntrega, setModalEntrega] = useState(false)
  const [formEntrega, setFormEntrega] = useState({
    fecha_entrega: new Date().toISOString().split('T')[0],
    proveedor: 'ADIME',
    regular_galones: '',
    premium_galones: '',
    diesel_galones: '',
    diesel_plus_galones: '',
  })
  const [guardandoEntrega, setGuardandoEntrega] = useState(false)
  const [errorEntrega, setErrorEntrega] = useState('')
  const [exito, setExito] = useState('')
  const [analizando, setAnalizando] = useState(false)
  const [modalIA, setModalIA] = useState(false)
  const [analisisIA, setAnalisisIA] = useState('')

  useEffect(() => {
    if (!session) { router.push('/'); return }
    init()
  }, [session])

  async function init() {
    const { data: p } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single()
    if (!p || p.rol !== 'admin') { router.push('/dashboard'); return }
    setPerfil(p)
    await cargarWSM()
    setLoading(false)
  }

  async function cargarWSM() {
    const { data } = await supabase
      .from('wsm')
      .select('*')
      .eq('estacion_id', OAKLAND_ID)
      .order('fecha', { ascending: false })
      .limit(120)
    setRegistros(data || [])

    const alertasActivas = []
    const ultimos = {}
    ;(data || []).forEach(r => {
      if (!ultimos[r.tipo]) ultimos[r.tipo] = r
    })
    Object.values(ultimos).forEach(r => {
      const limite = r.tipo === 'diesel' ? 0.4 : 1.2
      if (Math.abs(parseFloat(r.varianza_acumulada_pct || 0)) > limite) {
        alertasActivas.push({
          tipo: 'varianza',
          combustible: r.tipo,
          mensaje: `${TIPO_LABEL[r.tipo]} - Varianza acumulada ${parseFloat(r.varianza_acumulada_pct).toFixed(2)}% supera limite (${limite}%)`,
          nivel: 'danger'
        })
      }
      if (r.alerta_dias_consecutivos >= 5) {
        alertasActivas.push({
          tipo: 'dias',
          combustible: r.tipo,
          mensaje: `${TIPO_LABEL[r.tipo]} - ${r.alerta_dias_consecutivos} dias consecutivos de perdida`,
          nivel: 'danger'
        })
      } else if (r.alerta_dias_consecutivos >= 3) {
        alertasActivas.push({
          tipo: 'dias',
          combustible: r.tipo,
          mensaje: `${TIPO_LABEL[r.tipo]} - ${r.alerta_dias_consecutivos} dias consecutivos de perdida (limite: 5)`,
          nivel: 'warning'
        })
      }
      if (r.alerta_diferencia_acumulada) {
        alertasActivas.push({
          tipo: 'diferencia',
          combustible: r.tipo,
          mensaje: `${TIPO_LABEL[r.tipo]} - Diferencia acumulada ${parseFloat(r.varianza_acumulada || 0).toFixed(0)} gal sin compensacion`,
          nivel: 'danger'
        })
      }
    })
    setAlertas(alertasActivas)
  }

  async function recalcular() {
    setRecalculando(true)
    const hoy = new Date()
    for (let i = 6; i >= 1; i--) {
      const d = new Date(hoy)
      d.setDate(d.getDate() - i)
      const fecha = d.toISOString().split('T')[0]
      await supabase.rpc('calcular_wsm', { p_estacion_id: OAKLAND_ID, p_fecha: fecha })
    }
    await cargarWSM()
    setRecalculando(false)
    setExito('WSM recalculado correctamente')
    setTimeout(() => setExito(''), 3000)
  }

  async function analizarConIA() {
    setAnalizando(true)
    setAnalisisIA('')
    const resumen = TIPOS.map(tipo => {
      const regs = registros.filter(r => r.tipo === tipo).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
      const ultimo = regs[0]
      return {
        combustible: TIPO_LABEL[tipo],
        limite_pct: tipo === 'diesel' ? 0.4 : 1.2,
        varianza_acumulada_pct: parseFloat(ultimo?.varianza_acumulada_pct || 0),
        varianza_acumulada_gal: parseFloat(ultimo?.varianza_acumulada || 0),
        ventas_acumuladas_gal: parseFloat(ultimo?.ventas_acumuladas || 0),
        dias_perdida_consecutiva: ultimo?.alerta_dias_consecutivos || 0,
        ultimos_7_dias: regs.slice(0, 7).map(r => ({
          fecha: r.fecha,
          ventas: parseFloat(r.ventas || 0),
          varianza_gal: parseFloat(r.varianza || 0),
          varianza_pct: parseFloat(r.varianza_pct || 0),
          inventario_fisico: parseFloat(r.inventario_fisico || 0),
          inventario_teorico: parseFloat(r.inventario_teorico || 0),
        }))
      }
    })
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'Analiza este reporte de Wetstock de una estacion de combustible en Guatemala. Identifica: 1) Combustibles en alerta y su riesgo, 2) Tendencias de perdida o ganancia, 3) Dias consecutivos de perdida preocupantes, 4) Recomendaciones de accion inmediata. Se conciso y directo.',
          data: { estacion: 'SS Oakland', fecha: new Date().toLocaleDateString('es-GT'), alertas_activas: alertas, combustibles: resumen }
        })
      })
      const json = await res.json()
      setAnalisisIA(json.analysis)
      setModalIA(true)
    } catch (err) {
      setAnalisisIA('Error: ' + err.message)
      setModalIA(true)
    }
    setAnalizando(false)
  }

  async function guardarEntrega(e) {
    e.preventDefault()
    setGuardandoEntrega(true)
    setErrorEntrega('')
    const total = (parseFloat(formEntrega.regular_galones) || 0) +
      (parseFloat(formEntrega.premium_galones) || 0) +
      (parseFloat(formEntrega.diesel_galones) || 0) +
      (parseFloat(formEntrega.diesel_plus_galones) || 0)
    const { error } = await supabase.from('entregas').insert({
      estacion_id: OAKLAND_ID,
      fecha_entrega: formEntrega.fecha_entrega,
      proveedor: formEntrega.proveedor,
      regular_galones: parseFloat(formEntrega.regular_galones) || 0,
      premium_galones: parseFloat(formEntrega.premium_galones) || 0,
      diesel_galones: parseFloat(formEntrega.diesel_galones) || 0,
      diesel_plus_galones: parseFloat(formEntrega.diesel_plus_galones) || 0,
      total_galones: total,
      estado: 'confirmada',
      creado_por: session.user.id,
    })
    if (error) {
      setErrorEntrega('Error al guardar la entrega.')
    } else {
      setModalEntrega(false)
      setFormEntrega({ fecha_entrega: new Date().toISOString().split('T')[0], proveedor: 'ADIME', regular_galones: '', premium_galones: '', diesel_galones: '', diesel_plus_galones: '' })
      await recalcular()
      setExito('Entrega registrada y WSM recalculado')
      setTimeout(() => setExito(''), 3000)
    }
    setGuardandoEntrega(false)
  }

  if (loading) return <div className="flex items-center justify-center h-screen text-sm text-gray-400">Cargando...</div>

  const registrosTipo = registros.filter(r => r.tipo === tipoSeleccionado).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
  const ultimoRegistro = registrosTipo[0]
  const limite = tipoSeleccionado === 'diesel' ? 0.4 : 1.2
  const ventasAcum = parseFloat(ultimoRegistro?.ventas_acumuladas || 0)
  const varAcum = parseFloat(ultimoRegistro?.varianza_acumulada || 0)
  const varAcumPct = parseFloat(ultimoRegistro?.varianza_acumulada_pct || 0)
  const diasConsec = ultimoRegistro?.alerta_dias_consecutivos || 0

  return (
    <Layout perfil={perfil} estacion={null}>

      {modalIA && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModalIA(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white">
              <h2 className="text-base font-semibold text-gray-900">Analisis IA - Wetstock</h2>
              <button onClick={() => setModalIA(false)} className="text-gray-400 hover:text-gray-600 text-xl">X</button>
            </div>
            <div className="px-6 py-5 text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
              {analisisIA}
            </div>
          </div>
        </div>
      )}

      {modalEntrega && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModalEntrega(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Registrar entrega</h2>
              <button onClick={() => setModalEntrega(false)} className="text-gray-400 hover:text-gray-600 text-xl">X</button>
            </div>
            <form onSubmit={guardarEntrega} className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Fecha</label>
                  <input type="date" value={formEntrega.fecha_entrega}
                    onChange={e => setFormEntrega(f => ({ ...f, fecha_entrega: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Proveedor</label>
                  <input type="text" value={formEntrega.proveedor}
                    onChange={e => setFormEntrega(f => ({ ...f, proveedor: e.target.value }))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                </div>
              </div>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="grid grid-cols-2 bg-gray-50 px-4 py-2 border-b border-gray-100 text-xs text-gray-400 font-medium">
                  <div>Combustible</div>
                  <div className="text-center">Galones recibidos</div>
                </div>
                {[['Super', 'regular_galones'], ['V-Power', 'premium_galones'], ['Diesel', 'diesel_galones'], ['Regular', 'diesel_plus_galones']].map(([label, key]) => (
                  <div key={key} className="grid grid-cols-2 gap-2 px-4 py-2.5 border-b border-gray-50 items-center">
                    <span className="text-sm text-gray-700">{label}</span>
                    <input type="number" min="0" step="0.01"
                      value={formEntrega[key]}
                      onChange={e => setFormEntrega(f => ({ ...f, [key]: e.target.value }))}
                      placeholder="0"
                      className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-400" />
                  </div>
                ))}
              </div>
              {errorEntrega && <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-xs text-red-700">{errorEntrega}</div>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setModalEntrega(false)}
                  className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancelar</button>
                <button type="submit" disabled={guardandoEntrega}
                  className="text-sm px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                  {guardandoEntrega && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                  {guardandoEntrega ? 'Guardando...' : 'Guardar entrega'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="p-6 max-w-6xl">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Wetstock Management</h1>
            <p className="text-sm text-gray-400">SS Oakland</p>
          </div>
          <div className="flex items-center gap-2">
            {exito && <span className="text-xs text-green-700 bg-green-50 border border-green-100 px-3 py-1.5 rounded-lg">{exito}</span>}
            <button onClick={analizarConIA} disabled={analizando}
              className="text-xs px-3 py-1.5 border border-purple-200 bg-purple-50 rounded-lg hover:bg-purple-100 text-purple-700 disabled:opacity-40 flex items-center gap-1.5">
              {analizando && <div className="w-3 h-3 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"></div>}
              {analizando ? 'Analizando...' : 'Analizar IA'}
            </button>
            <button onClick={recalcular} disabled={recalculando}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 disabled:opacity-40 flex items-center gap-1.5">
              {recalculando && <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>}
              {recalculando ? 'Recalculando...' : 'Recalcular'}
            </button>
            <button onClick={() => setModalEntrega(true)}
              className="text-xs px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              + Registrar entrega
            </button>
          </div>
        </div>

        {alertas.length > 0 && (
          <div className="space-y-2 mb-5">
            {alertas.map((a, i) => (
              <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${a.nivel === 'danger' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-amber-50 border-amber-100 text-amber-700'}`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${a.nivel === 'danger' ? 'bg-red-500' : 'bg-amber-400'}`} />
                {a.mensaje}
              </div>
            ))}
          </div>
        )}
        {alertas.length === 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-green-50 border-green-100 text-green-700 text-sm mb-5">
            <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            Sin alertas activas
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {TIPOS.map(tipo => {
            const regs = registros.filter(r => r.tipo === tipo).sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
            const ultimo = regs[0]
            const lim = tipo === 'diesel' ? 0.4 : 1.2
            const pct = parseFloat(ultimo?.varianza_acumulada_pct || 0)
            const abs = Math.abs(pct)
            const color = abs > lim ? 'text-red-600' : abs > lim * 0.8 ? 'text-amber-600' : 'text-green-700'
            const bg = abs > lim ? 'border-red-200' : abs > lim * 0.8 ? 'border-amber-200' : 'border-gray-100'
            return (
              <button key={tipo}
                onClick={() => setTipoSeleccionado(tipo)}
                className={`bg-white rounded-xl border p-4 text-left transition-all ${tipoSeleccionado === tipo ? 'border-blue-400 ring-1 ring-blue-200' : bg}`}>
                <div className="flex items-center gap-1.5 mb-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: TIPO_COLOR[tipo] }} />
                  <span className="text-xs font-medium text-gray-600">{TIPO_LABEL[tipo]}</span>
                </div>
                <div className={`text-lg font-semibold ${color}`}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%
                </div>
                <div className="text-xs text-gray-400 mt-0.5">Var. acum. lim. {lim}%</div>
                <MiniBar pct={pct} limite={lim} />
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 mb-3">
          <div className="w-2.5 h-2.5 rounded-full" style={{ background: TIPO_COLOR[tipoSeleccionado] }} />
          <h2 className="text-sm font-semibold text-gray-700">{TIPO_LABEL[tipoSeleccionado]}</h2>
          <span className="text-xs text-gray-400">- Detalle mensual</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Ventas acumuladas</div>
            <div className="text-xl font-medium text-gray-900">{ventasAcum.toLocaleString('es-GT', { maximumFractionDigits: 0 })}</div>
            <div className="text-xs text-gray-400 mt-0.5">galones este mes</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Varianza acumulada</div>
            <div className={`text-xl font-medium ${varAcum < 0 ? 'text-red-600' : 'text-green-700'}`}>
              {varAcum >= 0 ? '+' : ''}{varAcum.toLocaleString('es-GT', { maximumFractionDigits: 1 })} gal
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{varAcumPct.toFixed(2)}% del total</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Dias perdida consecutiva</div>
            <div className={`text-xl font-medium ${diasConsec >= 5 ? 'text-red-600' : diasConsec >= 3 ? 'text-amber-600' : 'text-gray-900'}`}>
              {diasConsec}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">limite: 5 dias</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">Estado</div>
            <div className="mt-1">
              <Badge value={varAcum} pct={varAcumPct} limite={limite} />
            </div>
            <div className="text-xs text-gray-400 mt-1">limite: +/-{limite}%</div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-medium text-gray-700">Detalle diario - {TIPO_LABEL[tipoSeleccionado]}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Ventas: automatico (Fusion) · Nivel fisico: automatico (TLS-4) · Entrega: manual</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Inv. Inicial</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Entrega</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Ventas</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Inv. Teorico</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Inv. Fisico (TLS)</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Varianza (gal)</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Var. %</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Var. Acum. %</th>
                  <th className="px-4 py-2.5 text-center text-xs text-gray-400 font-normal">Estado</th>
                </tr>
              </thead>
              <tbody>
                {registrosTipo.length === 0 && (
                  <tr><td colSpan={10} className="px-5 py-6 text-center text-xs text-gray-400">Sin registros aun</td></tr>
                )}
                {registrosTipo.map(r => {
                  const varianza = parseFloat(r.varianza || 0)
                  const varPct = parseFloat(r.varianza_pct || 0)
                  const varAcumPctRow = parseFloat(r.varianza_acumulada_pct || 0)
                  const lim = r.tipo === 'diesel' ? 0.4 : 1.2
                  const esAlerta = Math.abs(varAcumPctRow) > lim
                  return (
                    <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50 ${esAlerta ? 'bg-red-50/20' : ''}`}>
                      <td className="px-4 py-2.5 text-gray-700 font-medium">{r.fecha}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{parseFloat(r.inventario_inicial || 0).toLocaleString('es-GT', { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">
                        {parseFloat(r.recepcion_auditoria || 0) > 0
                          ? <span className="text-blue-600 font-medium">+{parseFloat(r.recepcion_auditoria).toLocaleString('es-GT', { maximumFractionDigits: 0 })}</span>
                          : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{parseFloat(r.ventas || 0).toLocaleString('es-GT', { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-2.5 text-right text-gray-600">{parseFloat(r.inventario_teorico || 0).toLocaleString('es-GT', { maximumFractionDigits: 0 })}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700 font-medium">{parseFloat(r.inventario_fisico || 0).toLocaleString('es-GT', { maximumFractionDigits: 0 })}</td>
                      <td className={`px-3 py-2.5 text-right font-medium ${varianza < 0 ? 'text-red-600' : varianza > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                        {varianza >= 0 ? '+' : ''}{varianza.toLocaleString('es-GT', { maximumFractionDigits: 1 })}
                      </td>
                      <td className={`px-3 py-2.5 text-right ${Math.abs(varPct) > lim * 100 ? 'text-red-600' : 'text-gray-500'}`}>
                        {r.ventas > 0 ? `${varPct.toFixed(2)}%` : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`font-medium ${Math.abs(varAcumPctRow) > lim ? 'text-red-600' : 'text-gray-600'}`}>
                          {varAcumPctRow.toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge value={varianza} pct={varAcumPctRow} limite={lim} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 bg-gray-50 rounded-xl p-4 border border-gray-100">
          <h3 className="text-xs font-medium text-gray-600 mb-2 uppercase tracking-wide">Parametros de alerta</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs text-gray-500">
            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>Gasolinas: varianza acumulada mayor a 1.20%</div>
            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-amber-400"></div>Diesel: varianza acumulada mayor a 0.40%</div>
            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>5 dias consecutivos de perdida</div>
            <div className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>Diferencia acumulada menor a -50 gal sin compensacion</div>
          </div>
        </div>
      </div>
    </Layout>
  )
}
