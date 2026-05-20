import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useToast, ToastContainer } from '../components/Toast'

const NOMBRES_ESTACIONES = {
  'a5bf7621-fa0a-44b2-891c-982446488d53': 'Quetzal',
  'cef374e5-139b-4279-a62e-0fe9544c2fa2': 'Brisas',
  '6d616281-099b-49bf-9adc-5872ed1299ef': 'Hincapié',
  '3ae77767-ffa0-47f7-b391-f787e025d6cf': 'KM. 13',
  '507dbcbc-430e-4f98-935c-50e819df90b0': 'KM. 7',
  '82e478e3-2394-44c4-ab96-eff40f5159c7': 'Mateo Flores',
  '64a4e5c8-781f-4f53-92a4-bb6f6ae387b9': 'Mirador',
  '7e611589-c875-422a-ab81-979e8d7dd7d2': 'Petapa',
  'cc62be07-f32c-49f4-8da0-557ac479842b': 'Rivera del Río',
  'b04130a9-ac02-44a6-b995-5ee5ea8f19d8': 'San Cristóbal',
  'ae6216ff-18ee-4a7d-a8a8-3a9eab00c420': 'San Pedrito',
  '85da69a8-1e81-48a7-8b0d-82df9eeec15e': 'Oakland',
}

function getFechaGuatemala() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
}

function getPrimerDiaMes() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function Compras({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [compras, setCompras] = useState([])
  const [cargando, setCargando] = useState(false)
  const [facturaSeleccionada, setFacturaSeleccionada] = useState(null)
  const [items, setItems] = useState([])
  const [cargandoItems, setCargandoItems] = useState(false)

  // Filtros
  const [fechaInicio, setFechaInicio] = useState(getPrimerDiaMes())
  const [fechaFin, setFechaFin] = useState(getFechaGuatemala())
  const [filtroEstacion, setFiltroEstacion] = useState('')
  const [filtroProveedor, setFiltroProveedor] = useState('')

  const { toasts, toast } = useToast()

  useEffect(() => {
    if (!session) { router.push('/'); return }
    async function init() {
      const { data: p } = await supabase.from('perfiles').select('*, estaciones(*)').eq('id', session.user.id).single()
      if (!p || p.rol !== 'admin') { router.push('/dashboard'); return }
      setPerfil(p)
      setEstacion(p.estaciones)
      setLoading(false)
    }
    init()
  }, [session])

  useEffect(() => {
    if (!loading) cargarCompras()
  }, [loading, fechaInicio, fechaFin, filtroEstacion])

  async function cargarCompras() {
    setCargando(true)
    let q = supabase.from('compras_fel')
      .select('*')
      .gte('fecha_emision', fechaInicio)
      .lte('fecha_emision', fechaFin)
      .order('fecha_emision', { ascending: false })
      .limit(500)

    if (filtroEstacion) q = q.eq('estacion_id', filtroEstacion)

    const { data, error } = await q
    if (error) { toast('Error al cargar compras', 'error'); setCargando(false); return }
    setCompras(data || [])
    setCargando(false)
  }

  async function verItems(factura) {
    setFacturaSeleccionada(factura)
    setCargandoItems(true)
    const { data } = await supabase.from('compras_fel_items')
      .select('*')
      .eq('factura_id', factura.id)
      .order('id')
    setItems(data || [])
    setCargandoItems(false)
  }

  const comprasFiltradas = compras.filter(c => {
    if (!filtroProveedor) return true
    return (c.nombre_emisor || '').toLowerCase().includes(filtroProveedor.toLowerCase())
  })

  const totalGeneral = comprasFiltradas.reduce((s, c) => s + (parseFloat(c.monto) || 0), 0)

  const resumenPorEstacion = comprasFiltradas.reduce((acc, c) => {
    const key = c.estacion_id || 'sin_estacion'
    if (!acc[key]) acc[key] = { nombre: c.estacion_id ? (NOMBRES_ESTACIONES[c.estacion_id] || 'Desconocida') : 'Sin clasificar', total: 0, count: 0 }
    acc[key].total += parseFloat(c.monto) || 0
    acc[key].count++
    return acc
  }, {})

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  )

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <ToastContainer toasts={toasts} />
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Compras FEL</h1>
          <p className="text-sm text-gray-400 mt-0.5">Facturas de compra sincronizadas desde Infile</p>
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Desde</label>
              <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Hasta</label>
              <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Estación</label>
              <select value={filtroEstacion} onChange={e => setFiltroEstacion(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400 bg-white">
                <option value="">Todas</option>
                <option value="null">Sin clasificar</option>
                {Object.entries(NOMBRES_ESTACIONES).map(([id, nombre]) => (
                  <option key={id} value={id}>{nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Proveedor</label>
              <input type="text" value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)}
                placeholder="Buscar proveedor..."
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          </div>
        </div>

        {/* Resumen por estación */}
        {comprasFiltradas.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <h2 className="text-sm font-medium text-gray-700 mb-3">Resumen por estación</h2>
            <div className="space-y-2">
              {Object.values(resumenPorEstacion).sort((a, b) => b.total - a.total).map((est, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">{est.nombre}</span>
                    <span className="text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">{est.count}</span>
                  </div>
                  <span className="text-sm font-medium text-gray-800">
                    Q{est.total.toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              ))}
              <div className="border-t border-gray-100 pt-2 mt-2 flex justify-between">
                <span className="text-sm font-medium text-gray-700">Total</span>
                <span className="text-sm font-semibold text-gray-900">
                  Q{totalGeneral.toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Tabla */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700">
              {cargando ? 'Cargando...' : `${comprasFiltradas.length} facturas`}
            </h2>
            <span className="text-sm font-medium text-gray-900">
              Q{totalGeneral.toLocaleString('es-GT', { minimumFractionDigits: 2 })}
            </span>
          </div>

          {cargando ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : comprasFiltradas.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-400">
              No hay compras para el período seleccionado
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                    <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Proveedor</th>
                    <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">No. Factura</th>
                    <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Estación</th>
                    <th className="px-4 py-2.5 text-right text-xs text-gray-400 font-normal">Monto</th>
                    <th className="px-4 py-2.5 text-center text-xs text-gray-400 font-normal">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {comprasFiltradas.map(c => (
                    <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{c.fecha_emision}</td>
                      <td className="px-4 py-3 text-gray-700 max-w-[180px] truncate">{c.nombre_emisor || '—'}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{c.numero_factura || '—'}</td>
                      <td className="px-4 py-3">
                        {c.estacion_id ? (
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                            {NOMBRES_ESTACIONES[c.estacion_id] || 'Desconocida'}
                          </span>
                        ) : (
                          <span className="text-xs bg-gray-50 text-gray-400 px-2 py-0.5 rounded-full">Sin clasificar</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-800 whitespace-nowrap">
                        Q{parseFloat(c.monto || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => verItems(c)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal detalle */}
      {facturaSeleccionada && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setFacturaSeleccionada(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{facturaSeleccionada.nombre_emisor || 'Proveedor'}</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  {facturaSeleccionada.numero_factura} · {facturaSeleccionada.fecha_emision}
                </p>
              </div>
              <button onClick={() => setFacturaSeleccionada(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="px-5 py-3 border-b border-gray-100 grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-gray-400">NIT Emisor</div>
                <div className="text-sm font-mono text-gray-700">{facturaSeleccionada.nit_emisor || '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Estación</div>
                <div className="text-sm text-gray-700">
                  {facturaSeleccionada.estacion_id ? (NOMBRES_ESTACIONES[facturaSeleccionada.estacion_id] || 'Desconocida') : 'Sin clasificar'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Tipo</div>
                <div className="text-sm text-gray-700">{facturaSeleccionada.tipo_documento || 'FACT'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Total</div>
                <div className="text-sm font-semibold text-gray-900">
                  Q{parseFloat(facturaSeleccionada.monto || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {facturaSeleccionada.uuid_fel && (
              <div className="px-5 py-2 border-b border-gray-100">
                <div className="text-xs text-gray-400 mb-0.5">UUID FEL</div>
                <div className="text-xs font-mono text-gray-500 break-all">{facturaSeleccionada.uuid_fel}</div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto">
              <div className="px-5 py-3">
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Detalle de items</h3>
                {cargandoItems ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-sm text-gray-400 text-center py-6">Sin detalle disponible</div>
                ) : (
                  <div className="space-y-2">
                    {items.map((item, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg px-3 py-2.5">
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-sm text-gray-700 flex-1">{item.descripcion || '—'}</span>
                          <span className="text-sm font-medium text-gray-800 whitespace-nowrap">
                            Q{parseFloat(item.total || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {parseFloat(item.cantidad || 0).toLocaleString('es-GT')} {item.unidad} ×
                          Q{parseFloat(item.precio_unitario || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                          {item.tipo && <span className="ml-2 bg-white px-1.5 py-0.5 rounded text-gray-400">{item.tipo}</span>}
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between pt-2 border-t border-gray-200">
                      <span className="text-sm font-medium text-gray-600">Total</span>
                      <span className="text-sm font-semibold text-gray-900">
                        Q{parseFloat(facturaSeleccionada.monto || 0).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
