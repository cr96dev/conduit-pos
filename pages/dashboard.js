import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useToast, ToastContainer } from '../components/Toast'
import { SkeletonDashboard } from '../components/Skeleton'

const ESTACIONES_AUTOMATICAS = [
  '85da69a8-1e81-48a7-8b0d-82df9eeec15e',
  'ae6216ff-18ee-4a7d-a8a8-3a9eab00c420',
  '64a4e5c8-781f-4f53-92a4-bb6f6ae387b9',
  'a5bf7621-fa0a-44b2-891c-982446488d53',
  '3ae77767-ffa0-47f7-b391-f787e025d6cf',
]

function BarChart({ data }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data.map(d => d.total), 1)

  return (
    <div className="flex items-end gap-1.5 h-24 w-full">
      {data.map((d, i) => {
        const pct = (d.total / max) * 100
        const isToday = i === data.length - 1
        return (
          <div key={d.fecha} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              Q{Math.round(d.total).toLocaleString('es-GT')}
            </div>
            <div className="w-full rounded-t-md transition-all duration-500"
              style={{
                height: `${Math.max(pct, 4)}%`,
                background: isToday ? '#2563EB' : '#BFDBFE',
                minHeight: '4px'
              }} />
            <span className="text-xs text-gray-400">{d.dia}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function Dashboard({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [ventasHoy, setVentasHoy] = useState(null)
  const [tanques, setTanques] = useState([])
  const [facturasPendientes, setFacturasPendientes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [grafica, setGrafica] = useState([])
  const [comparativo, setComparativo] = useState(null)
  const [esAutomatica, setEsAutomatica] = useState(false)
  const { toasts, toast } = useToast()

  useEffect(() => {
    if (!session) { router.push('/'); return }
    loadData()
  }, [session])

  async function loadData() {
    const { data: p } = await supabase.from('perfiles').select('*, estaciones(*)').eq('id', session.user.id).single()
    setPerfil(p)
    setEstacion(p?.estaciones)

    const automatica = ESTACIONES_AUTOMATICAS.includes(p?.estacion_id)
    setEsAutomatica(automatica)

    if (p?.estacion_id) {
      const hoy = new Date().toISOString().split('T')[0]

      // Ventas de hoy
      const { data: vh } = await supabase.from('ventas').select('*')
        .eq('estacion_id', p.estacion_id).eq('fecha', hoy).single()
      setVentasHoy(vh || null)

      // Tanques
      const { data: t } = await supabase.from('tanques').select('*').eq('estacion_id', p.estacion_id)
      setTanques(t || [])

      // Facturas pendientes
      const { count } = await supabase.from('facturas').select('*', { count: 'exact', head: true })
        .eq('estacion_id', p.estacion_id).in('estado', ['pendiente', 'vencida'])
      setFacturasPendientes(count || 0)

      // Gráfica últimos 7 días
      const dias = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        dias.push(d.toISOString().split('T')[0])
      }

      const { data: ventasSemana } = await supabase.from('ventas').select('fecha, regular_ingresos, premium_ingresos, diesel_ingresos, diesel_plus_ingresos')
        .eq('estacion_id', p.estacion_id)
        .gte('fecha', dias[0])
        .lte('fecha', dias[6])

      const graficaData = dias.map(fecha => {
        const v = ventasSemana?.find(x => x.fecha === fecha)
        const total = v ? parseFloat(v.regular_ingresos || 0) + parseFloat(v.premium_ingresos || 0) + parseFloat(v.diesel_ingresos || 0) + parseFloat(v.diesel_plus_ingresos || 0) : 0
        const d = new Date(fecha + 'T12:00:00')
        const dia = d.toLocaleDateString('es-GT', { weekday: 'short' }).slice(0, 3)
        return { fecha, dia, total }
      })
      setGrafica(graficaData)

      // Comparativo semana anterior
      const semanaActual = graficaData.reduce((s, d) => s + d.total, 0)
      const inicioSemanaAnterior = new Date()
      inicioSemanaAnterior.setDate(inicioSemanaAnterior.getDate() - 13)
      const finSemanaAnterior = new Date()
      finSemanaAnterior.setDate(finSemanaAnterior.getDate() - 7)

      const { data: ventasAnterior } = await supabase.from('ventas')
        .select('regular_ingresos, premium_ingresos, diesel_ingresos, diesel_plus_ingresos')
        .eq('estacion_id', p.estacion_id)
        .gte('fecha', inicioSemanaAnterior.toISOString().split('T')[0])
        .lte('fecha', finSemanaAnterior.toISOString().split('T')[0])

      const semanaAnterior = (ventasAnterior || []).reduce((s, v) =>
        s + parseFloat(v.regular_ingresos || 0) + parseFloat(v.premium_ingresos || 0) + parseFloat(v.diesel_ingresos || 0) + parseFloat(v.diesel_plus_ingresos || 0), 0)

      if (semanaAnterior > 0) {
        const diff = ((semanaActual - semanaAnterior) / semanaAnterior) * 100
        setComparativo({ diff: diff.toFixed(1), sube: diff >= 0 })
      }
    }
    setLoading(false)
  }

  if (loading) return <SkeletonDashboard />

  const totalHoy = ventasHoy
    ? parseFloat(ventasHoy.regular_ingresos || 0) + parseFloat(ventasHoy.premium_ingresos || 0) + parseFloat(ventasHoy.diesel_ingresos || 0) + parseFloat(ventasHoy.diesel_plus_ingresos || 0)
    : 0

  const totalGalonesHoy = ventasHoy
    ? parseFloat(ventasHoy.regular_litros || 0) + parseFloat(ventasHoy.premium_litros || 0) + parseFloat(ventasHoy.diesel_litros || 0) + parseFloat(ventasHoy.diesel_plus_litros || 0)
    : 0

  const tipoColor = { vpower: '#DC2626', super: '#16A34A', regular: '#CA8A04', diesel: '#1C1917' }
  const tipoLabel = { vpower: 'V-Power', super: 'Super', regular: 'Regular', diesel: 'Diesel' }
  const hoy = new Date().toLocaleDateString('es-GT', { dateStyle: 'long' })
  const diasSemana = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  const nombreDia = diasSemana[new Date().getDay()]

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <ToastContainer toasts={toasts} />
      <div className="p-6 max-w-2xl">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">Buenos días 👋</h1>
          <p className="text-sm text-gray-400 capitalize">{hoy} — {nombreDia}</p>
          <p className="text-xs text-blue-600 mt-0.5 font-medium">{estacion?.nombre}</p>
        </div>

        {/* Tarjetas métricas */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-500 mb-1">Ingresos de hoy</div>
            <div className="text-xl font-semibold text-gray-900">
              {ventasHoy ? `Q${Math.round(totalHoy).toLocaleString('es-GT')}` : '—'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {ventasHoy ? 'Registrado' : 'Sin registro hoy'}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-500 mb-1">Galones vendidos</div>
            <div className="text-xl font-semibold text-gray-900">
              {ventasHoy ? Math.round(totalGalonesHoy).toLocaleString('es-GT') : '—'}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {ventasHoy ? 'gal hoy' : 'Sin registro'}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-500 mb-1">Facturas pendientes</div>
            <div className={`text-xl font-semibold ${facturasPendientes > 0 ? 'text-amber-600' : 'text-gray-900'}`}>
              {facturasPendientes}
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {facturasPendientes === 0 ? 'Al día' : 'Por atender'}
            </div>
          </div>
        </div>

        {/* Gráfica 7 días */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-medium text-gray-800">Ventas últimos 7 días</h2>
              {comparativo && (
                <div className={`flex items-center gap-1 mt-0.5 ${comparativo.sube ? 'text-green-600' : 'text-red-500'}`}>
                  <span className="text-xs font-medium">
                    {comparativo.sube ? '↑' : '↓'} {Math.abs(comparativo.diff)}% vs semana anterior
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-blue-600"></div>
                <span className="text-xs text-gray-400">Hoy</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm bg-blue-200"></div>
                <span className="text-xs text-gray-400">Días anteriores</span>
              </div>
            </div>
          </div>
          <div className="pt-8">
            <BarChart data={grafica} />
          </div>
        </div>

        {/* Niveles de tanques */}
        {tanques.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-gray-800">Niveles de tanques</h2>
              <button onClick={() => router.push('/tanques')} className="text-xs text-blue-600 hover:text-blue-800">Ver detalle →</button>
            </div>
            <div className="space-y-2.5">
              {tanques.map(t => {
                const pct = t.capacidad_galones > 0 ? Math.round((t.nivel_galones / t.capacidad_galones) * 100) : 0
                const color = pct < 20 ? '#DC2626' : pct < 40 ? '#CA8A04' : tipoColor[t.tipo] || '#6B7280'
                return (
                  <div key={t.id}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ background: tipoColor[t.tipo] }}></div>
                        <span className="text-xs text-gray-700">{tipoLabel[t.tipo]}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{Math.round(t.nivel_galones).toLocaleString('es-GT')} gal</span>
                        <span className="text-xs font-medium" style={{ color }}>{pct}%</span>
                        {pct < 20 && <span className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded-full">Crítico</span>}
                        {pct >= 20 && pct < 40 && <span className="text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full">Bajo</span>}
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                )
              })}
            </div>
            {esAutomatica && (
              <p className="text-xs text-blue-500 mt-3">* Actualización automática TLS-4</p>
            )}
            {!esAutomatica && (
              <p className="text-xs text-gray-400 mt-3">* Actualizar manualmente en Tanques</p>
            )}
          </div>
        )}

        {/* Estado estación */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <h2 className="text-sm font-medium text-gray-800 mb-3">Estado de la estación</h2>
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-sm text-gray-600">Activa</span>
            <span className="text-xs text-gray-400 ml-auto">{estacion?.zona}</span>
          </div>
        </div>

        {/* Acciones rápidas */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="text-sm font-medium text-gray-800 mb-3">Acciones rápidas</h2>
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Registrar ventas del día', href: '/ventas', color: 'bg-blue-50 text-blue-700 hover:bg-blue-100', icon: 'M3 17l4-8 4 4 4-7 4 6' },
              { label: 'Actualizar tanques', href: '/tanques', color: 'bg-green-50 text-green-700 hover:bg-green-100', icon: 'M12 2C8 2 4 5 4 9c0 5 8 13 8 13s8-8 8-13c0-4-4-7-8-7zm0 9a2 2 0 110-4 2 2 0 010 4z' },
              { label: 'Registrar entrega', href: '/entregas', color: 'bg-amber-50 text-amber-700 hover:bg-amber-100', icon: 'M1 3h15v13H1V3zm15 5h4l3 3v5h-7V8z' },
              { label: 'Subir factura', href: '/facturacion', color: 'bg-purple-50 text-purple-700 hover:bg-purple-100', icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z' },
            ].map(item => (
              <button key={item.href} onClick={() => router.push(item.href)}
                className={`flex items-center gap-2.5 px-4 py-3 rounded-lg text-sm font-medium transition-colors text-left ${item.color}`}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </Layout>
  )
}
