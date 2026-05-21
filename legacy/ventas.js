import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useToast, ToastContainer } from '../components/Toast'

// Orden visual: Super → Regular → Diesel → V-Power
// (los campos BD mantienen sus nombres legacy: regular_litros=Super, diesel_plus_litros=Regular, etc)
const todosLosCombustibles = [
  { key: 'regular',     label: 'Super',   tipo: 'super' },
  { key: 'diesel_plus', label: 'Regular', tipo: 'regular' },
  { key: 'diesel',      label: 'Diesel',  tipo: 'diesel' },
  { key: 'premium',     label: 'V-Power', tipo: 'vpower' },
]

const metodosPago = [
  { key: 'neonet', label: 'Neonet' },
  { key: 'bac', label: 'BAC' },
  { key: 'deposito', label: 'Depósito' },
  { key: 'cupon', label: 'Cupón' },
  { key: 'neonet_prepago', label: 'Neonet Prepago' },
  { key: 'descuento_club_bi', label: 'Descuento Club Bi' },
  { key: 'ach_transferencia', label: 'ACH / Transferencia' },
  { key: 'flota_credomatic', label: 'Flota Credomatic' },
  { key: 'caja_chica', label: 'Caja Chica' },
  { key: 'vales_clientes', label: 'Vales Clientes' },
  { key: 'uno_plus', label: 'Uno Plus' },
  { key: 'nomina', label: 'Nómina' },
  { key: 'descuento_amigo', label: 'Descuento Amigo' },
  { key: 'piloto', label: 'Piloto' },
  { key: 'gasoline', label: 'Gasoline' },
  { key: 'prueba_surtidor', label: 'Prueba de surtidor' },
]

const ESTACIONES_AUTOMATICAS = [
  'cef374e5-139b-4279-a62e-0fe9544c2fa2', // SS Brisas
]

// V-Power solo disponible en Oakland / Diagonal 6
const OAKLAND_ID = '85da69a8-1e81-48a7-8b0d-82df9eeec15e'

function getFechaGuatemala() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
}

function getAyerGuatemala() {
  const hoy = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Guatemala' }))
  hoy.setDate(hoy.getDate() - 1)
  return hoy.toLocaleDateString('en-CA')
}

export default function Ventas({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [historial, setHistorial] = useState([])
  const [registroFecha, setRegistroFecha] = useState(null)
  const [neonetAuto, setNeonetAuto] = useState(false)
  const [bacAuto, setBacAuto] = useState(false)
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [fechaSeleccionada, setFechaSeleccionada] = useState(getFechaGuatemala())
  const [completandoCobros, setCompletandoCobros] = useState(false)
  const [form, setForm] = useState({
    regular_litros: '', regular_ingresos: '',
    premium_litros: '', premium_ingresos: '',
    diesel_litros: '', diesel_ingresos: '',
    diesel_plus_litros: '', diesel_plus_ingresos: '',
    neonet: '', bac: '', deposito: '', cupon: '',
    neonet_prepago: '', descuento_club_bi: '', ach_transferencia: '',
    flota_credomatic: '', caja_chica: '', vales_clientes: '',
    uno_plus: '', nomina: '', descuento_amigo: '',
    piloto: '', gasoline: '', prueba_surtidor: '',
    notas: ''
  })
  const [formCobros, setFormCobros] = useState({
    neonet: '', bac: '', deposito: '', cupon: '',
    neonet_prepago: '', descuento_club_bi: '', ach_transferencia: '',
    flota_credomatic: '', caja_chica: '', vales_clientes: '',
    uno_plus: '', nomina: '', descuento_amigo: '',
    piloto: '', gasoline: '', prueba_surtidor: '',
    notas: ''
  })
  const { toasts, toast } = useToast()

  // V-Power solo se muestra en Oakland (Diagonal 6).
  // Si la estación tiene un array `combustibles` definido, lo respetamos pero igualmente filtramos vpower fuera de Oakland.
  const esOakland = perfil?.estacion_id === OAKLAND_ID
  const combustibles = (estacion?.combustibles
    ? todosLosCombustibles.filter(c => estacion.combustibles.includes(c.tipo))
    : todosLosCombustibles
  ).filter(c => c.tipo !== 'vpower' || esOakland)

  function esEstacionAutomatica() {
    return ESTACIONES_AUTOMATICAS.includes(perfil?.estacion_id)
  }

  function registroSinCobros(registro) {
    if (!registro) return false
    return metodosPago.every(m => !registro[m.key] || parseFloat(registro[m.key]) === 0)
  }

  useEffect(() => {
    if (!session) { router.push('/'); return }
    loadData()
  }, [session])

  useEffect(() => {
    if (perfil?.estacion_id) verificarFecha(fechaSeleccionada)
    setCompletandoCobros(false)
  }, [fechaSeleccionada, perfil])

  async function loadData() {
    const { data: p } = await supabase.from('perfiles').select('*, estaciones(*)').eq('id', session.user.id).single()
    setPerfil(p)
    setEstacion(p?.estaciones)
    if (p?.estacion_id) {
      await verificarFecha(fechaSeleccionada, p.estacion_id)
      const { data: h } = await supabase.from('ventas').select('*')
        .eq('estacion_id', p.estacion_id)
        .order('fecha', { ascending: false }).limit(15)
      setHistorial(h || [])
    }
    setLoading(false)
  }

  async function verificarFecha(fecha, estacionId) {
    const eid = estacionId || perfil?.estacion_id
    if (!eid) return
    const { data } = await supabase.from('ventas').select('*')
      .eq('estacion_id', eid).eq('fecha', fecha).single()
    setRegistroFecha(data || null)

    // ¿El neonet de esta fila vino del PDF Neonet automático?
    const { data: consumo } = await supabase.from('neonet_consumos')
      .select('id, total_q, valor_nuevo')
      .eq('estacion_id', eid)
      .eq('fecha_consumo', fecha)
      .eq('variante', 'neonet')
      .eq('estado', 'aplicado')
      .order('procesado_en', { ascending: false })
      .limit(1)
      .maybeSingle()
    setNeonetAuto(!!consumo)

    // ¿El BAC de esta fila vino de la integración BAC automática?
    const { data: bacRow } = await supabase.from('bac_consumos')
      .select('id')
      .eq('estacion_id', eid)
      .eq('fecha_remision', fecha)
      .eq('categoria', 'combustible')
      .eq('estado', 'aplicado')
      .limit(1)
      .maybeSingle()
    setBacAuto(!!bacRow)
  }

  function setField(key, val) { setForm(f => ({ ...f, [key]: val })) }
  function setFieldCobro(key, val) { setFormCobros(f => ({ ...f, [key]: val })) }

  function totalGalones() {
    return combustibles.reduce((s, c) => s + (parseFloat(form[`${c.key}_litros`]) || 0), 0)
  }
  function totalIngresos() {
    return combustibles.reduce((s, c) => s + (parseFloat(form[`${c.key}_ingresos`]) || 0), 0)
  }
  function totalMetodos() {
    return metodosPago.reduce((s, m) => s + (parseFloat(form[m.key]) || 0), 0)
  }
  function totalMetodosCobros() {
    return metodosPago.reduce((s, m) => s + (parseFloat(formCobros[m.key]) || 0), 0)
  }
  function diferencia() { return totalIngresos() - totalMetodos() }

  async function guardar(e) {
    e.preventDefault()
    setGuardando(true)
    const payload = {
      estacion_id: perfil.estacion_id,
      fecha: fechaSeleccionada,
      regular_litros: parseFloat(form.regular_litros) || 0,
      regular_ingresos: parseFloat(form.regular_ingresos) || 0,
      premium_litros: parseFloat(form.premium_litros) || 0,
      premium_ingresos: parseFloat(form.premium_ingresos) || 0,
      diesel_litros: parseFloat(form.diesel_litros) || 0,
      diesel_ingresos: parseFloat(form.diesel_ingresos) || 0,
      diesel_plus_litros: parseFloat(form.diesel_plus_litros) || 0,
      diesel_plus_ingresos: parseFloat(form.diesel_plus_ingresos) || 0,
      notas: form.notas,
      creado_por: session.user.id,
    }
    metodosPago.forEach(m => { payload[m.key] = parseFloat(form[m.key]) || 0 })
    const { error } = await supabase.from('ventas').insert(payload)
    if (error) {
      toast('Error al guardar. Intenta de nuevo.', 'error')
    } else {
      toast(`✓ Ventas del ${fechaSeleccionada} registradas correctamente`, 'success')
      await loadData()
    }
    setGuardando(false)
  }

  async function guardarCobros(e) {
    e.preventDefault()
    setGuardando(true)
    const payload = {}
    metodosPago.forEach(m => { payload[m.key] = parseFloat(formCobros[m.key]) || 0 })
    if (formCobros.notas) payload.notas = formCobros.notas
    const { error } = await supabase.from('ventas').update(payload).eq('id', registroFecha.id)
    if (error) {
      toast('Error al guardar formas de cobro.', 'error')
    } else {
      toast(`✓ Formas de cobro del ${fechaSeleccionada} guardadas correctamente`, 'success')
      setCompletandoCobros(false)
      await loadData()
    }
    setGuardando(false)
  }

  function editarCobros() {
    if (!registroFecha) return
    const precarga = { notas: registroFecha.notas || '' }
    metodosPago.forEach(m => {
      const v = parseFloat(registroFecha[m.key] || 0)
      precarga[m.key] = v ? String(v) : ''
    })
    setFormCobros(precarga)
    setCompletandoCobros(true)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm text-gray-400">Cargando ventas...</span>
      </div>
    </div>
  )

  const diff = diferencia()
  const totalI = totalIngresos()
  const totalM = totalMetodos()
  const hoy = getFechaGuatemala()
  const ayer = getAyerGuatemala()
  const esHoy = fechaSeleccionada === hoy
  const esFuturo = fechaSeleccionada > hoy
  const sinCobros = registroSinCobros(registroFecha)
  const automatica = esEstacionAutomatica()

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <ToastContainer toasts={toasts} />
      <div className="p-6 max-w-3xl">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-gray-900">Registro de ventas</h1>
          <p className="text-sm text-gray-400">{estacion?.nombre}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="text-xs text-gray-500 block mb-1">Fecha del registro</label>
              <input type="date" value={fechaSeleccionada}
                max={hoy}
                onChange={e => setFechaSeleccionada(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 w-full" />
            </div>
            <div className="flex gap-2 mt-4">
              <button type="button" onClick={() => setFechaSeleccionada(hoy)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${esHoy ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                Hoy
              </button>
              <button type="button" onClick={() => setFechaSeleccionada(ayer)}
                className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${fechaSeleccionada === ayer ? 'bg-blue-50 border-blue-200 text-blue-700 font-medium' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                Ayer
              </button>
            </div>
          </div>
          {!esHoy && (
            <div className="mt-2 flex items-center gap-2 text-amber-600">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-xs">Estás viendo el registro del {new Date(fechaSeleccionada + 'T12:00:00').toLocaleDateString('es-GT', { dateStyle: 'long' })}</span>
            </div>
          )}
        </div>

        {esFuturo ? null : registroFecha ? (
          <div className="space-y-4">
            {sinCobros && !completandoCobros && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <div className="text-sm font-medium text-blue-800">Ventas cargadas automáticamente</div>
                    <div className="text-xs text-blue-600 mt-0.5">Las ventas fueron extraídas del Wayne Fusion. Puedes ingresar las formas de cobro del día.</div>
                  </div>
                </div>
                <button onClick={() => setCompletandoCobros(true)}
                  className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 whitespace-nowrap">
                  Ingresar cobros
                </button>
              </div>
            )}

            {!sinCobros && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-5 py-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <div className="text-sm font-medium text-green-800">
                    Registro del {new Date(fechaSeleccionada + 'T12:00:00').toLocaleDateString('es-GT', { dateStyle: 'long' })} completo
                  </div>
                  <div className="text-xs text-green-600 mt-0.5">Las ventas y formas de cobro ya fueron registradas. Si hay un error, comunícate con el administrador.</div>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-medium text-gray-700 mb-3">Combustible vendido</h2>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="text-xs text-gray-400 font-medium">Tipo</div>
                <div className="text-xs text-gray-400 font-medium text-right">Galones</div>
                <div className="text-xs text-gray-400 font-medium text-right">Ingresos (Q)</div>
              </div>
              {combustibles.map(c => (
                <div key={c.key} className="grid grid-cols-3 gap-2 py-1.5 border-b border-gray-50">
                  <div className="text-sm text-gray-700">{c.label}</div>
                  <div className="text-sm text-gray-800 text-right">{parseFloat(registroFecha[`${c.key}_litros`] || 0).toLocaleString('es-GT')}</div>
                  <div className="text-sm text-gray-800 text-right">Q{parseFloat(registroFecha[`${c.key}_ingresos`] || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })}</div>
                </div>
              ))}
              <div className="grid grid-cols-3 gap-2 pt-2 mt-1">
                <div className="text-xs font-medium text-gray-600">Total</div>
                <div className="text-sm font-medium text-gray-800 text-right">
                  {combustibles.reduce((s, c) => s + parseFloat(registroFecha[`${c.key}_litros`] || 0), 0).toLocaleString('es-GT', { maximumFractionDigits: 1 })} gal
                </div>
                <div className="text-sm font-medium text-gray-800 text-right">
                  Q{combustibles.reduce((s, c) => s + parseFloat(registroFecha[`${c.key}_ingresos`] || 0), 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {completandoCobros && (
              <form onSubmit={guardarCobros} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} className="space-y-4">
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <h2 className="text-sm font-medium text-gray-700 mb-3">Formas de cobro</h2>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="text-xs text-gray-400 font-medium">Método</div>
                    <div className="text-xs text-gray-400 font-medium">Monto (Q)</div>
                  </div>
                  {metodosPago.map(m => (
                    <div key={m.key} className="grid grid-cols-2 gap-2 mb-2">
                      <div className="flex items-center gap-1.5 text-sm text-gray-700">
                        {m.label}
                        {m.key === 'neonet' && neonetAuto && (
                          <span title="Cargado automático desde Neonet" className="text-xs">✨</span>
                        )}
                        {m.key === 'bac' && bacAuto && (
                          <span title="Cargado automático desde BAC" className="text-xs">⚡</span>
                        )}
                      </div>
                      <input type="number" min="0" step="0.01"
                        value={formCobros[m.key]}
                        onChange={e => setFieldCobro(m.key, e.target.value)}
                        placeholder="0.00"
                        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                    </div>
                  ))}
                  <div className="border-t border-gray-100 pt-3 mt-2 space-y-1.5">
                    {(() => {
                      const totalIng = combustibles.reduce((s, c) => s + parseFloat(registroFecha[`${c.key}_ingresos`] || 0), 0)
                      const totalCob = totalMetodosCobros()
                      const dif = totalIng - totalCob
                      return (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Total ingresos</span>
                            <span className="font-medium text-gray-800">Q{totalIng.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Total formas de cobro</span>
                            <span className="font-medium text-gray-800">Q{totalCob.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className={`flex justify-between text-sm font-medium pt-1 border-t border-gray-100 ${Math.abs(dif) < 0.01 ? 'text-green-700' : 'text-red-600'}`}>
                            <span>Diferencia</span>
                            <span>{dif >= 0 ? '+' : ''}Q{dif.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                          </div>
                          {Math.abs(dif) < 0.01 && totalCob > 0 && (
                            <div className="text-xs text-green-600 text-right">✓ Cuadra perfectamente</div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <label className="text-xs text-gray-500 block mb-1">Observaciones (opcional)</label>
                  <textarea value={formCobros.notas} onChange={e => setFieldCobro('notas', e.target.value)}
                    rows={2} placeholder="Notas del día..."
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none" />
                </div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setCompletandoCobros(false)}
                    className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                    Cancelar
                  </button>
                  <button type="submit" disabled={guardando}
                    className="bg-blue-600 text-white text-sm px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2">
                    {guardando && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                    {guardando ? 'Guardando...' : 'Guardar formas de cobro'}
                  </button>
                </div>
              </form>
            )}

            {!completandoCobros && !sinCobros && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-medium text-gray-700">Formas de cobro</h2>
                  <button type="button" onClick={editarCobros}
                    className="group inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600 hover:shadow-sm transition-all">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    Editar formas de cobro
                  </button>
                </div>
                {metodosPago.map(m => {
                  const val = parseFloat(registroFecha[m.key] || 0)
                  if (val === 0) return null
                  return (
                    <div key={m.key} className="flex justify-between py-1.5 border-b border-gray-50">
                      <span className="text-sm text-gray-600 flex items-center gap-1.5">
                        {m.label}
                        {m.key === 'neonet' && neonetAuto && (
                          <span title="Cargado automático desde Neonet" className="text-xs">✨</span>
                        )}
                        {m.key === 'bac' && bacAuto && (
                          <span title="Cargado automático desde BAC" className="text-xs">⚡</span>
                        )}
                      </span>
                      <span className="text-sm text-gray-800">Q{val.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                    </div>
                  )
                })}
                {(() => {
                  const totalIng = combustibles.reduce((s, c) => s + parseFloat(registroFecha[`${c.key}_ingresos`] || 0), 0)
                  const totalCob = metodosPago.reduce((s, m) => s + parseFloat(registroFecha[m.key] || 0), 0)
                  const dif = totalIng - totalCob
                  return (
                    <div className="pt-2 mt-1 space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Total ingresos</span>
                        <span className="font-medium">Q{totalIng.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500">Total cobros</span>
                        <span className="font-medium">Q{totalCob.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                      </div>
                      <div className={`flex justify-between text-sm font-medium pt-1 border-t border-gray-100 ${Math.abs(dif) < 0.01 ? 'text-green-700' : 'text-red-600'}`}>
                        <span>Diferencia</span>
                        <span>{Math.abs(dif) < 0.01 ? '✓ Cuadra' : `Q${dif.toFixed(2)}`}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {registroFecha.notas && !completandoCobros && (
              <div className="bg-white rounded-xl border border-gray-100 p-5">
                <div className="text-xs text-gray-500 mb-1">Observaciones</div>
                <div className="text-sm text-gray-700">{registroFecha.notas}</div>
              </div>
            )}
          </div>

        ) : automatica ? (
          <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-8 text-center">
            <svg className="w-10 h-10 text-blue-400 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21a48.309 48.309 0 01-8.135-.687c-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            <div className="text-sm font-medium text-blue-800 mb-1">Ventas automáticas</div>
            <div className="text-xs text-blue-600 max-w-xs mx-auto">Las ventas de esta estación se extraen automáticamente del Wayne Fusion cada noche. No es necesario ingresar datos manualmente.</div>
          </div>

        ) : (
          <form onSubmit={guardar} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-medium text-gray-700 mb-3">Combustible vendido</h2>
              <div className="grid grid-cols-3 gap-2 mb-2">
                <div className="text-xs text-gray-400 font-medium">Tipo</div>
                <div className="text-xs text-gray-400 font-medium">Galones</div>
                <div className="text-xs text-gray-400 font-medium">Ingresos (Q)</div>
              </div>
              {combustibles.map(c => (
                <div key={c.key} className="grid grid-cols-3 gap-2 mb-2">
                  <div className="flex items-center text-sm text-gray-700">{c.label}</div>
                  <input type="number" min="0" step="0.01"
                    value={form[`${c.key}_litros`]}
                    onChange={e => setField(`${c.key}_litros`, e.target.value)}
                    placeholder="0"
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  <input type="number" min="0" step="0.01"
                    value={form[`${c.key}_ingresos`]}
                    onChange={e => setField(`${c.key}_ingresos`, e.target.value)}
                    placeholder="0.00"
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                </div>
              ))}
              <div className="border-t border-gray-100 pt-3 mt-2 grid grid-cols-3 gap-2">
                <div className="text-xs font-medium text-gray-600">Total</div>
                <div className="text-sm font-medium text-gray-800">{totalGalones().toLocaleString('es-GT', { maximumFractionDigits: 1 })} gal</div>
                <div className="text-sm font-medium text-gray-800">Q{totalI.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-medium text-gray-700 mb-3">Formas de cobro</h2>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="text-xs text-gray-400 font-medium">Método</div>
                <div className="text-xs text-gray-400 font-medium">Monto (Q)</div>
              </div>
              {metodosPago.map(m => (
                <div key={m.key} className="grid grid-cols-2 gap-2 mb-2">
                  <div className="flex items-center text-sm text-gray-700">{m.label}</div>
                  <input type="number" min="0" step="0.01"
                    value={form[m.key]}
                    onChange={e => setField(m.key, e.target.value)}
                    placeholder="0.00"
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                </div>
              ))}
              <div className="border-t border-gray-100 pt-3 mt-2 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total ingresos</span>
                  <span className="font-medium text-gray-800">Q{totalI.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total formas de cobro</span>
                  <span className="font-medium text-gray-800">Q{totalM.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className={`flex justify-between text-sm font-medium pt-1 border-t border-gray-100 ${Math.abs(diff) < 0.01 ? 'text-green-700' : 'text-red-600'}`}>
                  <span>Diferencia</span>
                  <span>{diff >= 0 ? '+' : ''}Q{diff.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                </div>
                {Math.abs(diff) < 0.01 && totalI > 0 && (
                  <div className="text-xs text-green-600 text-right">✓ Cuadra perfectamente</div>
                )}
                {Math.abs(diff) >= 0.01 && totalM > 0 && (
                  <div className="text-xs text-red-500 text-right">Diferencia de Q{Math.abs(diff).toLocaleString('es-GT', { maximumFractionDigits: 2 })}</div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <label className="text-xs text-gray-500 block mb-1">Observaciones (opcional)</label>
              <textarea value={form.notas} onChange={e => setField('notas', e.target.value)}
                rows={2} placeholder="Notas del día..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none" />
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3">
              <p className="text-xs text-amber-700">
                {esHoy
                  ? 'Una vez guardado el registro no podrá ser modificado. Verifica que los datos sean correctos.'
                  : `Estás registrando ventas retroactivas para el ${new Date(fechaSeleccionada + 'T12:00:00').toLocaleDateString('es-GT', { dateStyle: 'long' })}. Una vez guardado no podrá modificarse.`
                }
              </p>
            </div>

            <div className="flex justify-end">
              <button type="submit" disabled={guardando}
                className="bg-blue-600 text-white text-sm px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2">
                {guardando && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                {guardando ? 'Guardando...' : `Guardar ventas del ${new Date(fechaSeleccionada + 'T12:00:00').toLocaleDateString('es-GT', { day: 'numeric', month: 'short' })}`}
              </button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mt-6">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-medium text-gray-700">Historial reciente</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                  {combustibles.map(c => (
                    <th key={c.key} className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">{c.label}</th>
                  ))}
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Total Q</th>
                  <th className="px-3 py-2.5 text-center text-xs text-gray-400 font-normal">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 && (
                  <tr><td colSpan={combustibles.length + 3} className="px-5 py-6 text-center text-xs text-gray-400">Sin registros aún</td></tr>
                )}
                {historial.map(v => {
                  const total = v.regular_ingresos + v.premium_ingresos + v.diesel_ingresos + v.diesel_plus_ingresos
                  const cobros = metodosPago.reduce((s, m) => s + (parseFloat(v[m.key]) || 0), 0)
                  const dif = total - cobros
                  const esHoyReg = v.fecha === hoy
                  return (
                    <tr key={v.id}
                      onClick={() => setFechaSeleccionada(v.fecha)}
                      className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer">
                      <td className="px-5 py-3 text-gray-700">
                        {v.fecha}
                        {esHoyReg && <span className="ml-2 text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">Hoy</span>}
                      </td>
                      {combustibles.map(c => (
                        <td key={c.key} className="px-3 py-3 text-right text-gray-600">
                          {parseFloat(v[`${c.key}_litros`] || 0).toLocaleString('es-GT')} gal
                        </td>
                      ))}
                      <td className="px-3 py-3 text-right font-medium text-gray-800">Q{Math.round(total).toLocaleString('es-GT')}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${Math.abs(dif) < 0.01 ? 'bg-green-50 text-green-700' : cobros === 0 ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'}`}>
                          {Math.abs(dif) < 0.01 ? 'OK' : cobros === 0 ? 'Sin cobros' : `Q${dif.toFixed(2)}`}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}
