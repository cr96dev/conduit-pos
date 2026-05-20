// pages/admin/ventas-retroactivas.js
// SOLO visible para Charles y Miguel
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Layout from '../../components/Layout'

const AUTHORIZED_EMAILS = ['adoffice569@gmail.com', 'estacionesdeservicioguatemala@gmail.com']

export default function VentasRetroactivas() {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [accessToken, setAccessToken] = useState(null)
  const [estaciones, setEstaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)

  const [categoria, setCategoria] = useState('combustible')
  const [fecha, setFecha] = useState(() => {
    const ayer = new Date()
    ayer.setDate(ayer.getDate() - 1)
    return ayer.toISOString().split('T')[0]
  })
  const [estacionId, setEstacionId] = useState('')
  const [combustiblesEstacion, setCombustiblesEstacion] = useState(['super', 'vpower', 'diesel', 'regular'])
  const [notas, setNotas] = useState('')

  const [reg, setReg] = useState({ litros: '', ingresos: '' })
  const [pre, setPre] = useState({ litros: '', ingresos: '' })
  const [die, setDie] = useState({ litros: '', ingresos: '' })
  const [diep, setDiep] = useState({ litros: '', ingresos: '' })

  const [lubTotal, setLubTotal] = useState('')

  const [tiendaMonto, setTiendaMonto] = useState('')
  const [tiendaNumFactura, setTiendaNumFactura] = useState('')
  const [tiendaUuid, setTiendaUuid] = useState('')

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }

      if (!AUTHORIZED_EMAILS.includes(session.user.email)) {
        router.push('/dashboard')
        return
      }

      setAccessToken(session.access_token)

      const { data: p } = await supabase
        .from('perfiles')
        .select('id, nombre_completo, rol, estacion_id')
        .eq('id', session.user.id)
        .single()
      setPerfil(p)

      // Obtener datos de estacion del usuario (para el Layout)
      if (p?.estacion_id) {
        const { data: e } = await supabase
          .from('estaciones')
          .select('id, nombre, zona')
          .eq('id', p.estacion_id)
          .single()
        setEstacion(e)
      }

      const { data: ests } = await supabase
        .from('qbo_mapping_estaciones')
        .select('gasops_estacion_id, estacion_nombre, estacion_codigo')
        .eq('activo', true)
        .order('estacion_nombre')
      setEstaciones(ests || [])
      setLoading(false)
    }
    init()
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    setResultado(null)

    let datos = {}
    if (categoria === 'combustible') {
      datos = {
        regular_litros: parseFloat(reg.litros) || 0,
        regular_ingresos: parseFloat(reg.ingresos) || 0,
        premium_litros: parseFloat(pre.litros) || 0,
        premium_ingresos: parseFloat(pre.ingresos) || 0,
        diesel_litros: parseFloat(die.litros) || 0,
        diesel_ingresos: parseFloat(die.ingresos) || 0,
        diesel_plus_litros: parseFloat(diep.litros) || 0,
        diesel_plus_ingresos: parseFloat(diep.ingresos) || 0
      }
    } else if (categoria === 'lubricantes') {
      datos = { total_venta: parseFloat(lubTotal) || 0 }
    } else if (categoria === 'tienda') {
      datos = {
        fels: [{
          numero_factura: tiendaNumFactura,
          uuid_fel: tiendaUuid,
          nit_cliente: 'CF',
          nombre_cliente: 'CONSUMIDOR FINAL',
          monto: parseFloat(tiendaMonto) || 0
        }]
      }
    }

    try {
      const res = await fetch('/api/admin/carga-retroactiva', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          categoria, fecha, estacion_id: estacionId, datos, notas
        })
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error)
      } else {
        setResultado(data)
        setReg({ litros: '', ingresos: '' })
        setPre({ litros: '', ingresos: '' })
        setDie({ litros: '', ingresos: '' })
        setDiep({ litros: '', ingresos: '' })
        setLubTotal('')
        setTiendaMonto('')
        setTiendaNumFactura('')
        setTiendaUuid('')
        setNotas('')
      }
    } catch (err) {
      setError(err.message)
    }
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Cargando...</div>
      </div>
    )
  }
  if (!perfil) return null

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <div className="max-w-3xl mx-auto p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Carga Retroactiva de Ventas</h1>
        <p className="text-sm text-gray-500 mb-6">
          Usuario: <b>{perfil.nombre_completo}</b> · Rol: <b>{perfil.rol}</b>
        </p>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-6 text-sm text-amber-800">
          Funcionalidad de acceso restringido. Todas las cargas quedan auditadas. 
          Una vez creado el registro, el cron del dia siguiente lo procesara automaticamente a QBO.
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1 font-medium">Categoría</label>
            <select value={categoria} onChange={e => setCategoria(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
              <option value="combustible">Combustible</option>
              <option value="lubricantes">Lubricantes</option>
              <option value="tienda">Tienda (FEL individual)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1 font-medium">Fecha</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1 font-medium">Estación</label>
              <select value={estacionId} onChange={async (e) => {
                  const newId = e.target.value
                  setEstacionId(newId)
                  if (newId) {
                    const { data } = await supabase.from('estaciones').select('combustibles').eq('id', newId).single()
                    setCombustiblesEstacion(data?.combustibles || [])
                  }
                }}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
                <option value="">-- Seleccionar --</option>
                {estaciones.map(e => (
                  <option key={e.gasops_estacion_id} value={e.gasops_estacion_id}>
                    {e.estacion_nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {categoria === 'combustible' && (
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
              <h3 className="font-medium text-gray-800 mb-3 text-sm">Combustible (galones e ingresos por producto)</h3>
              {[['Super', reg, setReg, 'super'], ['V-Power', pre, setPre, 'vpower'],
                ['Diesel', die, setDie, 'diesel'], ['Regular', diep, setDiep, 'regular']]
                .filter(([_n, _v, _s, key]) => combustiblesEstacion.includes(key))
                .map(([nombre, val, setter]) => (
                <div key={nombre} className="flex gap-2 mb-2 items-center">
                  <span className="w-24 text-sm font-medium text-gray-700">{nombre}:</span>
                  <input type="number" step="0.01" placeholder="Galones" value={val.litros}
                    onChange={e => setter({...val, litros: e.target.value})}
                    className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  <input type="number" step="0.01" placeholder="Ingresos Q" value={val.ingresos}
                    onChange={e => setter({...val, ingresos: e.target.value})}
                    className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                </div>
              ))}
            </div>
          )}

          {categoria === 'lubricantes' && (
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
              <h3 className="font-medium text-gray-800 mb-3 text-sm">Lubricantes</h3>
              <label className="text-xs text-gray-500 block mb-1">Total venta (Q, con IVA incluido)</label>
              <input type="number" step="0.01" value={lubTotal} onChange={e => setLubTotal(e.target.value)}
                required
                className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          )}

          {categoria === 'tienda' && (
            <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
              <h3 className="font-medium text-gray-800 mb-3 text-sm">Tienda (1 FEL individual)</h3>
              <label className="text-xs text-gray-500 block mb-1">Número de factura</label>
              <input value={tiendaNumFactura} onChange={e => setTiendaNumFactura(e.target.value)}
                required
                className="w-full border border-gray-200 rounded px-3 py-2 text-sm mb-2 focus:outline-none focus:border-blue-400" />
              <label className="text-xs text-gray-500 block mb-1">UUID FEL</label>
              <input value={tiendaUuid} onChange={e => setTiendaUuid(e.target.value)}
                required
                className="w-full border border-gray-200 rounded px-3 py-2 text-sm mb-2 focus:outline-none focus:border-blue-400" />
              <label className="text-xs text-gray-500 block mb-1">Monto (Q, con IVA)</label>
              <input type="number" step="0.01" value={tiendaMonto} onChange={e => setTiendaMonto(e.target.value)}
                required
                className="w-full border border-gray-200 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          )}

          <div>
            <label className="text-xs text-gray-500 block mb-1 font-medium">Notas (opcional)</label>
            <textarea value={notas} onChange={e => setNotas(e.target.value)}
              placeholder="Razón de la carga retroactiva..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[60px] focus:outline-none focus:border-blue-400" />
          </div>

          <button type="submit" disabled={submitting}
            className="w-full md:w-auto px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 text-sm">
            {submitting ? 'Guardando...' : 'Cargar venta'}
          </button>
        </form>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-lg p-3 mt-4 text-sm text-red-700">
            Error: {error}
          </div>
        )}

        {resultado && (
          <div className="bg-green-50 border border-green-100 rounded-lg p-3 mt-4 text-sm text-green-800">
            <div className="font-medium mb-2">{resultado.mensaje}</div>
            <div className="text-xs space-y-0.5">
              <div><b>Estación:</b> {resultado.estacion}</div>
              <div><b>Fecha:</b> {resultado.fecha}</div>
              <div><b>Monto:</b> Q{resultado.monto_total.toFixed(2)}</div>
              <div><b>Acción:</b> {resultado.accion}</div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
