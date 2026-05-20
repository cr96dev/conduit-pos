import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useToast, ToastContainer } from '../components/Toast'

const fmt  = n => 'Q' + Number(n||0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const round = n => Math.round((n + Number.EPSILON) * 100) / 100

const TIPO_BAJA = {
  despido_injustificado: { label: 'Despido injustificado', color: 'bg-red-50 text-red-700', art: 'Art. 82 CT' },
  despido_justificado:   { label: 'Despido justificado',   color: 'bg-amber-50 text-amber-700', art: 'Art. 77 CT' },
  renuncia_voluntaria:   { label: 'Renuncia voluntaria',   color: 'bg-blue-50 text-blue-700', art: 'Art. 83 CT' },
}

function Badge({ tipo }) {
  const t = TIPO_BAJA[tipo]
  if (!t) return null
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.color}`}>{t.label}</span>
}

function Spinner() {
  return <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
}

// ── Salarios mínimos históricos CE1 no agrícola (Acuerdos Gubernativos) ──
const SAL_MIN_HISTORICO = {
  2024: 3384.59,  // Acuerdo 307-2023 — vigente 1-ene-2024
  2025: 3473.05,  // Acuerdo 264-2024 — vigente 1-ene-2025
  2026: 3752.28,  // Acuerdo 256-2025 — vigente 1-ene-2026
}

function salMinVigente(anio) {
  return SAL_MIN_HISTORICO[anio] || SAL_MIN_HISTORICO[2026]
}

// Promedio de los últimos 6 meses según salarios mínimos históricos por período
function calcularPromedio6Meses(fechaIngreso, fechaBaja, salarioActual) {
  const esEspecial = salarioActual >= 4500  // admins Q5,000 fijo
  const baja = new Date(fechaBaja)
  const salarios = []
  for (let i = 1; i <= 6; i++) {
    let m = baja.getMonth() - i
    let a = baja.getFullYear()
    while (m < 0) { m += 12; a-- }
    const inicioMes = new Date(a, m, 1)
    if (inicioMes >= new Date(fechaIngreso)) {
      salarios.push(esEspecial ? salarioActual : salMinVigente(a))
    }
  }
  if (salarios.length === 0) return salarioActual
  return round(salarios.reduce((s, v) => s + v, 0) / salarios.length)
}

// ── Calcular prestaciones de ley Guatemala ────────────────────────────────
function calcularLiquidacion({ empleado, fechaBaja, tipoBaja, diasSalarioPendiente = 0, deducciones = 0 }) {
  const sal = parseFloat(empleado.salario_mensual) || 0
  const salDia = round(sal / 30)

  const ingreso = new Date(empleado.fecha_ingreso)
  const baja    = new Date(fechaBaja)

  const msTotal   = baja - ingreso
  const diasTotal = Math.floor(msTotal / (1000 * 60 * 60 * 24))
  const aniosTrabajados = diasTotal / 365.25
  const mesesTrabajados = Math.floor(diasTotal / 30.44)

  // Promedio últimos 6 meses con salarios históricos por período
  const salProm6m = calcularPromedio6Meses(empleado.fecha_ingreso, fechaBaja, sal)

  // ── Indemnización (solo despido injustificado) ─────────────────────────
  // Base: promedio 6 meses × años trabajados
  let indemnizacion = 0
  if (tipoBaja === 'despido_injustificado') {
    if (aniosTrabajados >= 1) {
      indemnizacion = round(salProm6m * aniosTrabajados)
    } else if (mesesTrabajados >= 6) {
      indemnizacion = round(salProm6m * (mesesTrabajados / 12))
    }
  }

  // ── Preaviso ───────────────────────────────────────────────────────────
  let preaviso = 0
  if (tipoBaja === 'despido_injustificado') {
    if (aniosTrabajados >= 2) {
      preaviso = sal
    } else if (mesesTrabajados >= 6) {
      preaviso = round(sal * (mesesTrabajados / 24))
    }
  }

  // ── Vacaciones proporcionales ──────────────────────────────────────────
  const diasVacProporcionales = round((aniosTrabajados % 1) * 15)
  const vacaciones = round(diasVacProporcionales * salDia)

  // ── Aguinaldo proporcional — ponderado por salario histórico ───────────
  const inicioAguinaldo = baja.getMonth() >= 11
    ? new Date(baja.getFullYear(), 11, 1)
    : new Date(baja.getFullYear() - 1, 11, 1)
  const diasAguinaldo = Math.max(0, Math.floor((baja - inicioAguinaldo) / (1000*60*60*24)))
  // Ponderar por año: días en 2024 × sal2024 + días en 2025 × sal2025 + ...
  let aguinaldo = 0
  const esEsp = sal >= 4500
  for (let a = inicioAguinaldo.getFullYear(); a <= baja.getFullYear(); a++) {
    const iniA = new Date(Math.max(inicioAguinaldo, new Date(a, 0, 1)))
    const finA = new Date(Math.min(baja, new Date(a, 11, 31)))
    const dias = Math.max(0, Math.floor((finA - iniA) / (1000*60*60*24)) + 1)
    aguinaldo += round(dias / 365 * (esEsp ? sal : salMinVigente(a)))
  }
  aguinaldo = round(aguinaldo)

  // ── Bono 14 proporcional — ponderado por salario histórico ─────────────
  const inicioBono14 = baja.getMonth() >= 6
    ? new Date(baja.getFullYear(), 6, 1)
    : new Date(baja.getFullYear() - 1, 6, 1)
  const diasBono14 = Math.max(0, Math.floor((baja - inicioBono14) / (1000*60*60*24)))
  let bono14 = 0
  for (let a = inicioBono14.getFullYear(); a <= baja.getFullYear(); a++) {
    const iniA = new Date(Math.max(inicioBono14, new Date(a, 0, 1)))
    const finA = new Date(Math.min(baja, new Date(a, 11, 31)))
    const dias = Math.max(0, Math.floor((finA - iniA) / (1000*60*60*24)) + 1)
    bono14 += round(dias / 365 * (esEsp ? sal : salMinVigente(a)))
  }
  bono14 = round(bono14)

  // ── Salario pendiente ──────────────────────────────────────────────────
  const salarioPendiente = round(diasSalarioPendiente * salDia)

  // ── Totales ────────────────────────────────────────────────────────────
  const totalBruto = round(indemnizacion + preaviso + vacaciones + aguinaldo + bono14 + salarioPendiente)
  const totalNeto  = round(totalBruto - (parseFloat(deducciones)||0))

  return {
    aniosTrabajados: round(aniosTrabajados),
    mesesTrabajados,
    diasTrabajados: diasTotal,
    salProm6m,
    indemnizacion,
    preaviso,
    vacaciones,
    diasVacProporcionales,
    aguinaldo,
    diasAguinaldo,
    bono14,
    diasBono14,
    salarioPendiente,
    diasSalarioPendiente,
    totalBruto,
    deducciones: parseFloat(deducciones)||0,
    totalNeto,
  }
}


// ── Modal: Nueva liquidación ──────────────────────────────────────────────
function ModalLiquidacion({ empleado, onClose, onGuardado, session }) {
  const [fechaBaja, setFechaBaja]     = useState(new Date().toISOString().split('T')[0])
  const [tipoBaja, setTipoBaja]       = useState('despido_injustificado')
  const [motivo, setMotivo]           = useState('')
  const [diasPendientes, setDiasPend] = useState(0)
  const [deducciones, setDeducciones] = useState(0)
  const [notas, setNotas]             = useState('')
  const [guardando, setGuardando]     = useState(false)
  const { toasts, toast } = useToast()

  const calc = calcularLiquidacion({
    empleado, fechaBaja, tipoBaja,
    diasSalarioPendiente: parseFloat(diasPendientes)||0,
    deducciones: parseFloat(deducciones)||0,
  })

  async function handleGuardar() {
    setGuardando(true)
    // 1. Insertar liquidación
    const { error } = await supabase.from('liquidaciones').insert({
      empleado_id:           empleado.id,
      nombre:                empleado.nombre,
      puesto:                empleado.puesto,
      estacion:              empleado.estacion,
      salario_mensual:       empleado.salario_mensual,
      fecha_ingreso:         empleado.fecha_ingreso,
      fecha_baja:            fechaBaja,
      tipo_baja:             tipoBaja,
      motivo,
      anios_trabajados:      calc.aniosTrabajados,
      meses_trabajados:      calc.mesesTrabajados,
      dias_trabajados:       calc.diasTrabajados,
      indemnizacion:         calc.indemnizacion,
      preaviso:              calc.preaviso,
      vacaciones_pendientes: calc.vacaciones,
      aguinaldo_proporcional:calc.aguinaldo,
      bono14_proporcional:   calc.bono14,
      salario_pendiente:     calc.salarioPendiente,
      total_liquidacion:     calc.totalBruto,
      deducciones:           calc.deducciones,
      total_neto:            calc.totalNeto,
      notas,
      creado_por:            session.user.id,
    })
    if (error) { toast('Error al guardar la liquidación.', 'error'); setGuardando(false); return }

    // 2. Marcar empleado como inactivo
    await supabase.from('empleados').update({ activo: false }).eq('id', empleado.id)

    toast('✓ Liquidación guardada y empleado dado de baja', 'success')
    onGuardado()
    setGuardando(false)
  }

  const sal = parseFloat(empleado.salario_mensual)||0
  const ingreso = empleado.fecha_ingreso ? new Date(empleado.fecha_ingreso).toLocaleDateString('es-GT') : '—'

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <ToastContainer toasts={toasts} />
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Liquidación laboral</h2>
            <p className="text-xs text-gray-400 mt-0.5">{empleado.nombre}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Info empleado */}
          <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400 text-xs">Puesto</span><div className="font-medium text-gray-800">{empleado.puesto}</div></div>
            <div><span className="text-gray-400 text-xs">Estación</span><div className="font-medium text-gray-800">{empleado.estacion}</div></div>
            <div><span className="text-gray-400 text-xs">Salario mensual</span><div className="font-medium text-gray-800">{fmt(sal)}</div></div>
            <div><span className="text-gray-400 text-xs">Fecha de ingreso</span><div className="font-medium text-gray-800">{ingreso}</div></div>
          </div>

          {/* Tipo y fecha de baja */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Tipo de baja</label>
              <select value={tipoBaja} onChange={e => setTipoBaja(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
                <option value="despido_injustificado">Despido injustificado (Art. 82)</option>
                <option value="despido_justificado">Despido justificado (Art. 77)</option>
                <option value="renuncia_voluntaria">Renuncia voluntaria (Art. 83)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Fecha de baja</label>
              <input type="date" value={fechaBaja} onChange={e => setFechaBaja(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Motivo</label>
            <input value={motivo} onChange={e => setMotivo(e.target.value)}
              placeholder="Descripción del motivo de la baja..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Días de salario pendiente</label>
              <input type="number" min="0" max="31" value={diasPendientes} onChange={e => setDiasPend(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Deducciones (préstamos, etc.)</label>
              <input type="number" min="0" step="0.01" value={deducciones} onChange={e => setDeducciones(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          </div>

          {/* Cálculo en tiempo real */}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">Cálculo de prestaciones</span>
                <span className="text-xs text-gray-400">
                  {calc.aniosTrabajados.toFixed(2)} años · {calc.mesesTrabajados} meses · {calc.diasTrabajados} días
                </span>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {[
                { label: `Indemnización ${tipoBaja==='despido_injustificado'?'(prom. 6m × años)':'— No aplica'}`, val: calc.indemnizacion, nota: tipoBaja==='despido_injustificado'?`Prom. 6 meses: ${fmt(calc.salProm6m)} × ${calc.aniosTrabajados.toFixed(2)} años`:null, aplica: tipoBaja==='despido_injustificado' },
                { label: `Preaviso ${tipoBaja==='despido_injustificado'?'(1 mes)':'— No aplica'}`, val: calc.preaviso, aplica: tipoBaja==='despido_injustificado' },
                { label: `Vacaciones proporcionales`, val: calc.vacaciones, nota: `${calc.diasVacProporcionales} días × ${fmt(sal/30)}/día` },
                { label: `Aguinaldo proporcional`, val: calc.aguinaldo, nota: `${calc.diasAguinaldo} días del período` },
                { label: `Bono 14 proporcional`, val: calc.bono14, nota: `${calc.diasBono14} días del período` },
                { label: `Salario pendiente`, val: calc.salarioPendiente, nota: `${calc.diasSalarioPendiente} días × ${fmt(sal/30)}/día` },
              ].map(row => (
                <div key={row.label} className={`flex items-center justify-between px-4 py-2.5 ${!row.aplica && row.aplica!==undefined ? 'opacity-40' : ''}`}>
                  <div>
                    <span className="text-sm text-gray-700">{row.label}</span>
                    {row.nota && <div className="text-xs text-gray-400">{row.nota}</div>}
                  </div>
                  <span className={`text-sm font-medium ${row.val > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{fmt(row.val)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                <span className="text-sm font-medium text-gray-700">Total bruto</span>
                <span className="text-sm font-bold text-gray-900">{fmt(calc.totalBruto)}</span>
              </div>
              {calc.deducciones > 0 && (
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-red-600">Deducciones</span>
                  <span className="text-sm font-medium text-red-600">- {fmt(calc.deducciones)}</span>
                </div>
              )}
              <div className="flex items-center justify-between px-4 py-4 bg-blue-50">
                <span className="text-base font-bold text-blue-900">TOTAL A PAGAR</span>
                <span className="text-xl font-bold text-blue-700">{fmt(calc.totalNeto)}</span>
              </div>
            </div>
          </div>

          {/* Notas legales según tipo */}
          <div className={`rounded-xl px-4 py-3 text-xs ${tipoBaja==='despido_injustificado'?'bg-red-50 text-red-700':tipoBaja==='despido_justificado'?'bg-amber-50 text-amber-700':'bg-blue-50 text-blue-700'}`}>
            {tipoBaja==='despido_injustificado' && '⚖ Despido injustificado (Art. 82 CT): Incluye indemnización + preaviso + prestaciones proporcionales. El empleado NO estaba sujeto a causal de despido.'}
            {tipoBaja==='despido_justificado' && '⚖ Despido justificado (Art. 77 CT): Solo prestaciones proporcionales (vacaciones, aguinaldo, bono 14). Sin indemnización ni preaviso.'}
            {tipoBaja==='renuncia_voluntaria' && '⚖ Renuncia voluntaria (Art. 83 CT): Solo prestaciones proporcionales (vacaciones, aguinaldo, bono 14). Sin indemnización. El empleado debe dar preaviso de 1 mes.'}
          </div>

          <div>
            <label className="text-xs text-gray-500 block mb-1">Notas adicionales</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none" />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose} className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancelar</button>
            <button onClick={handleGuardar} disabled={guardando}
              className="text-sm px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2">
              {guardando && <Spinner />}
              {guardando ? 'Guardando...' : 'Dar de baja y guardar liquidación'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Modal: Ver liquidación histórica ─────────────────────────────────────
function ModalVerLiquidacion({ liq, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Liquidación</h2>
            <p className="text-xs text-gray-400">{liq.nombre}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400 text-xs">Tipo de baja</span><div><Badge tipo={liq.tipo_baja} /></div></div>
            <div><span className="text-gray-400 text-xs">Fecha de baja</span><div className="font-medium">{new Date(liq.fecha_baja+'T12:00:00').toLocaleDateString('es-GT')}</div></div>
            <div><span className="text-gray-400 text-xs">Fecha de ingreso</span><div className="font-medium">{new Date(liq.fecha_ingreso+'T12:00:00').toLocaleDateString('es-GT')}</div></div>
            <div><span className="text-gray-400 text-xs">Tiempo trabajado</span><div className="font-medium">{liq.anios_trabajados} años · {liq.meses_trabajados} meses</div></div>
            <div><span className="text-gray-400 text-xs">Salario mensual</span><div className="font-medium">{fmt(liq.salario_mensual)}</div></div>
            <div><span className="text-gray-400 text-xs">Estación</span><div className="font-medium">{liq.estacion}</div></div>
          </div>
          {liq.motivo && <div className="text-sm text-gray-600 bg-amber-50 rounded-lg px-4 py-3"><span className="font-medium">Motivo: </span>{liq.motivo}</div>}
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            {[
              { label: 'Indemnización', val: liq.indemnizacion },
              { label: 'Preaviso', val: liq.preaviso },
              { label: 'Vacaciones proporcionales', val: liq.vacaciones_pendientes },
              { label: 'Aguinaldo proporcional', val: liq.aguinaldo_proporcional },
              { label: 'Bono 14 proporcional', val: liq.bono14_proporcional },
              { label: 'Salario pendiente', val: liq.salario_pendiente },
            ].map(row => (
              <div key={row.label} className="flex justify-between px-4 py-2.5 border-b border-gray-50">
                <span className="text-sm text-gray-600">{row.label}</span>
                <span className={`text-sm font-medium ${parseFloat(row.val)>0?'text-gray-900':'text-gray-300'}`}>{fmt(row.val)}</span>
              </div>
            ))}
            <div className="flex justify-between px-4 py-3 bg-gray-50">
              <span className="text-sm font-medium">Total bruto</span>
              <span className="text-sm font-bold">{fmt(liq.total_liquidacion)}</span>
            </div>
            {parseFloat(liq.deducciones)>0 && (
              <div className="flex justify-between px-4 py-2.5 border-t border-gray-100">
                <span className="text-sm text-red-600">Deducciones</span>
                <span className="text-sm font-medium text-red-600">- {fmt(liq.deducciones)}</span>
              </div>
            )}
            <div className="flex justify-between px-4 py-4 bg-blue-50">
              <span className="font-bold text-blue-900">TOTAL A PAGAR</span>
              <span className="text-xl font-bold text-blue-700">{fmt(liq.total_neto)}</span>
            </div>
          </div>
          {liq.notas && <p className="text-xs text-gray-500 italic">{liq.notas}</p>}
        </div>
      </div>
    </div>
  )
}

// ── Página principal ──────────────────────────────────────────────────────
export default function Liquidaciones({ session }) {
  const router = useRouter()
  const [perfil, setPerfil]   = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('activos')
  const [empleados, setEmpleados] = useState([])
  const [liquidaciones, setLiquidaciones] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [modalNueva, setModalNueva]   = useState(null)  // empleado seleccionado
  const [modalVer, setModalVer]       = useState(null)  // liquidación a ver
  const { toasts, toast } = useToast()

  useEffect(() => { if (!session) { router.push('/'); return }; init() }, [session])

  async function init() {
    const { data: p } = await supabase.from('perfiles').select('*, estaciones(*)').eq('id', session.user.id).single()
    if (p?.rol !== 'admin') { router.push('/dashboard'); return }
    setPerfil(p); setEstacion(p?.estaciones)
    await Promise.all([cargarEmpleados(), cargarLiquidaciones()])
    setLoading(false)
  }

  async function cargarEmpleados() {
    const { data } = await supabase.from('empleados').select('*').order('estacion').order('nombre')
    setEmpleados(data || [])
  }

  async function cargarLiquidaciones() {
    const { data } = await supabase.from('liquidaciones').select('*').order('created_at', { ascending: false })
    setLiquidaciones(data || [])
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="flex flex-col items-center gap-3"><Spinner /><span className="text-sm text-gray-400">Cargando...</span></div>
    </div>
  )

  const activos   = empleados.filter(e => e.activo)
  const inactivos = empleados.filter(e => !e.activo)

  const filtrarEmps = (lista) => lista.filter(e =>
    !busqueda || e.nombre?.toLowerCase().includes(busqueda.toLowerCase()) ||
    e.estacion?.toLowerCase().includes(busqueda.toLowerCase()) ||
    e.puesto?.toLowerCase().includes(busqueda.toLowerCase())
  )

  const totalLiquidaciones = liquidaciones.reduce((s,l) => s + (parseFloat(l.total_neto)||0), 0)

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <ToastContainer toasts={toasts} />

      {modalNueva && (
        <ModalLiquidacion
          empleado={modalNueva} session={session}
          onClose={() => setModalNueva(null)}
          onGuardado={() => { setModalNueva(null); cargarEmpleados(); cargarLiquidaciones(); toast('✓ Baja procesada', 'success') }}
        />
      )}
      {modalVer && (
        <ModalVerLiquidacion liq={modalVer} onClose={() => setModalVer(null)} />
      )}

      <div className="p-6 max-w-5xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Bajas y Liquidaciones</h1>
            <p className="text-sm text-gray-400">{activos.length} activos · {inactivos.length} dados de baja · {liquidaciones.length} liquidaciones</p>
          </div>
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Empleados activos', value: activos.length, sub: 'en nómina' },
            { label: 'Dados de baja', value: inactivos.length, sub: 'histórico' },
            { label: 'Total liquidado', value: fmt(totalLiquidaciones), sub: 'histórico', blue: true },
          ].map(c => (
            <div key={c.label} className={`rounded-xl p-4 border ${c.blue ? 'bg-blue-50 border-blue-100' : 'bg-white border-gray-100'}`}>
              <p className="text-xs text-gray-400 mb-1">{c.label}</p>
              <p className={`text-xl font-semibold ${c.blue ? 'text-blue-700' : 'text-gray-900'}`}>{c.value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b border-gray-100">
          {[
            { key: 'activos',       label: `Empleados activos (${activos.length})` },
            { key: 'liquidaciones', label: `Historial de liquidaciones (${liquidaciones.length})` },
            { key: 'inactivos',     label: `Dados de baja (${inactivos.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`text-sm px-4 py-2 border-b-2 transition-colors -mb-px ${tab===t.key?'border-blue-600 text-blue-700 font-medium':'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Búsqueda */}
        {tab !== 'liquidaciones' && (
          <div className="mb-4">
            <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, estación o puesto..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
          </div>
        )}

        {/* Tab: Activos */}
        {tab === 'activos' && (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-5 py-2.5 text-left text-xs text-gray-400 font-normal">Nombre</th>
                    <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Estación</th>
                    <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Puesto</th>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Salario</th>
                    <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Ingreso</th>
                    <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Antigüedad</th>
                    <th className="px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtrarEmps(activos).length === 0 ? (
                    <tr><td colSpan={7} className="px-5 py-8 text-center text-xs text-gray-400">Sin resultados</td></tr>
                  ) : filtrarEmps(activos).map(emp => {
                    const ingreso = emp.fecha_ingreso ? new Date(emp.fecha_ingreso) : null
                    const hoy     = new Date()
                    const anios   = ingreso ? ((hoy - ingreso) / (1000*60*60*24*365.25)).toFixed(1) : '—'
                    return (
                      <tr key={emp.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <div className="font-medium text-gray-800">{emp.nombre}</div>
                          <div className="text-xs text-gray-400">{emp.codigo}</div>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-500">{emp.estacion}</td>
                        <td className="px-3 py-3 text-xs text-gray-500">{emp.puesto}</td>
                        <td className="px-3 py-3 text-right text-sm font-medium text-gray-800">{fmt(emp.salario_mensual)}</td>
                        <td className="px-3 py-3 text-xs text-gray-500">
                          {ingreso ? ingreso.toLocaleDateString('es-GT') : '—'}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-500">{anios} años</td>
                        <td className="px-3 py-3">
                          <button onClick={() => setModalNueva(emp)}
                            className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 font-medium">
                            Dar de baja
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tab: Historial de liquidaciones */}
        {tab === 'liquidaciones' && (
          <div className="space-y-3">
            {liquidaciones.length === 0 ? (
              <div className="bg-white border border-gray-100 rounded-xl px-6 py-12 text-center">
                <p className="text-sm text-gray-400">Sin liquidaciones registradas</p>
              </div>
            ) : liquidaciones.map(liq => (
              <div key={liq.id} onClick={() => setModalVer(liq)}
                className="bg-white border border-gray-100 rounded-xl px-5 py-4 flex items-center justify-between hover:border-gray-200 cursor-pointer">
                <div>
                  <div className="text-sm font-medium text-gray-900">{liq.nombre}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge tipo={liq.tipo_baja} />
                    <span className="text-xs text-gray-400">
                      Baja: {new Date(liq.fecha_baja+'T12:00:00').toLocaleDateString('es-GT')} · {liq.anios_trabajados} años trabajados
                    </span>
                  </div>
                  {liq.motivo && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-md">{liq.motivo}</div>}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-sm font-bold text-blue-700">{fmt(liq.total_neto)}</div>
                    <div className="text-xs text-gray-400">total neto</div>
                  </div>
                  <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Tab: Inactivos */}
        {tab === 'inactivos' && (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-5 py-2.5 text-left text-xs text-gray-400 font-normal">Nombre</th>
                    <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Estación</th>
                    <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Puesto</th>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Salario</th>
                    <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Ingreso</th>
                    <th className="px-3 py-2.5 text-center text-xs text-gray-400 font-normal">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrarEmps(inactivos).length === 0 ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-xs text-gray-400">Sin empleados inactivos</td></tr>
                  ) : filtrarEmps(inactivos).map(emp => (
                    <tr key={emp.id} className="border-b border-gray-50 hover:bg-gray-50 opacity-75">
                      <td className="px-5 py-3"><div className="font-medium text-gray-600">{emp.nombre}</div></td>
                      <td className="px-3 py-3 text-xs text-gray-400">{emp.estacion}</td>
                      <td className="px-3 py-3 text-xs text-gray-400">{emp.puesto}</td>
                      <td className="px-3 py-3 text-right text-sm text-gray-500">{fmt(emp.salario_mensual)}</td>
                      <td className="px-3 py-3 text-xs text-gray-400">{emp.fecha_ingreso ? new Date(emp.fecha_ingreso).toLocaleDateString('es-GT') : '—'}</td>
                      <td className="px-3 py-3 text-center"><span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 font-medium">Inactivo</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
