import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useToast, ToastContainer } from '../components/Toast'
import { SkeletonTable } from '../components/Skeleton'

const estadoColor = { pendiente: 'text-amber-600 bg-amber-50', confirmada: 'text-green-700 bg-green-50', cancelada: 'text-red-600 bg-red-50' }

const combustibles = [
  { key: 'regular',     label: 'Regular', color: '#CA8A04', tanque: 'regular' },
  { key: 'premium',     label: 'Super',   color: '#16A34A', tanque: 'super'   },
  { key: 'diesel',      label: 'Diesel',  color: '#1C1917', tanque: 'diesel'  },
  { key: 'diesel_plus', label: 'V-Power', color: '#DC2626', tanque: 'vpower'  },
]

export default function Entregas({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [entregas, setEntregas] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [detalleAbierto, setDetalleAbierto] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const { toasts, toast } = useToast()

  const formVacio = {
    proveedor: '',
    fecha_entrega: new Date().toISOString().split('T')[0],
    estado: 'confirmada',
    notas: '',
    regular_galones: '',
    premium_galones: '',
    diesel_galones: '',
    diesel_plus_galones: '',
  }
  const [form, setForm] = useState(formVacio)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    loadData()
  }, [session])

  async function loadData() {
    const { data: p } = await supabase.from('perfiles').select('*, estaciones(*)').eq('id', session.user.id).single()
    setPerfil(p); setEstacion(p?.estaciones)
    if (p?.estacion_id) {
      const { data } = await supabase.from('entregas').select('*')
        .eq('estacion_id', p.estacion_id)
        .order('fecha_entrega', { ascending: false })
        .limit(30)
      setEntregas(data || [])
    }
    setLoading(false)
  }

  function totalGalones() {
    return combustibles.reduce((s, c) => s + (parseFloat(form[`${c.key}_galones`]) || 0), 0)
  }

  async function guardar(e) {
    e.preventDefault()
    setErrorMsg('')

    if (totalGalones() === 0) {
      setErrorMsg('Ingresa al menos un combustible con galones.')
      return
    }

    setGuardando(true)

    const regular_galones = parseFloat(form.regular_galones) || 0
    const premium_galones = parseFloat(form.premium_galones) || 0
    const diesel_galones = parseFloat(form.diesel_galones) || 0
    const diesel_plus_galones = parseFloat(form.diesel_plus_galones) || 0
    const total_galones = regular_galones + premium_galones + diesel_galones + diesel_plus_galones
    const primerCombustible = combustibles.find(c => parseFloat(form[`${c.key}_galones`]) > 0)?.key || 'regular'

    const payload = {
      estacion_id: perfil.estacion_id,
      proveedor: form.proveedor,
      fecha_entrega: form.fecha_entrega,
      estado: form.estado,
      notas: form.notas,
      tipo_combustible: primerCombustible,
      volumen_litros: total_galones,
      precio_por_litro: 0,
      regular_galones,
      premium_galones,
      diesel_galones,
      diesel_plus_galones,
      total_galones,
      costo_total_entrega: 0,
      creado_por: session.user.id,
    }

    const { error } = await supabase.from('entregas').insert(payload).select()

    if (error) {
      setErrorMsg(`Error: ${error.message}`)
      setGuardando(false)
      return
    }

    // Actualizar tanques
    for (const c of combustibles) {
      const galones = parseFloat(form[`${c.key}_galones`]) || 0
      if (galones === 0) continue

      const { data: tanqueActual } = await supabase.from('tanques')
        .select('nivel_galones, capacidad_galones')
        .eq('estacion_id', perfil.estacion_id)
        .eq('tipo', c.tanque)
        .single()

      if (tanqueActual) {
        const nuevoNivel = Math.min(
          parseFloat(tanqueActual.nivel_galones) + galones,
          parseFloat(tanqueActual.capacidad_galones)
        )
        await supabase.from('tanques').update({
          nivel_galones: nuevoNivel,
          updated_at: new Date().toISOString()
        }).eq('estacion_id', perfil.estacion_id).eq('tipo', c.tanque)

        await supabase.from('tanques_historial').insert({
          estacion_id: perfil.estacion_id,
          tipo: c.tanque,
          nivel_galones: nuevoNivel,
          capacidad_galones: tanqueActual.capacidad_galones,
          creado_por: session.user.id,
        })
      }
    }

    setShowForm(false)
    setForm(formVacio)
    toast('✓ Entrega registrada y tanques actualizados', 'success')
    await loadData()
    setGuardando(false)
  }

  async function cambiarEstado(id, estado) {
    await supabase.from('entregas').update({ estado }).eq('id', id)
    setEntregas(prev => prev.map(e => e.id === id ? { ...e, estado } : e))
    toast(`Estado actualizado a ${estado}`, 'info')
  }

  if (loading) return (
    <Layout perfil={null} estacion={null}>
      <div className="p-6 max-w-3xl">
        <div className="h-6 bg-gray-200 rounded w-48 mb-6 animate-pulse"></div>
        <SkeletonTable rows={5} />
      </div>
    </Layout>
  )

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <ToastContainer toasts={toasts} />
      <div className="p-6 max-w-3xl">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Entregas de combustible</h1>
            <p className="text-sm text-gray-400">{estacion?.nombre}</p>
          </div>
          <button onClick={() => setShowForm(true)}
            className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            + Registrar entrega
          </button>
        </div>

        {showForm && (
          <form onSubmit={guardar} className="bg-white rounded-xl border border-blue-100 p-5 mb-5">
            <h2 className="text-sm font-medium text-gray-700 mb-4">Nueva entrega</h2>

            <div className="grid grid-cols-2 gap-3 mb-5">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Proveedor</label>
                <input value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} required
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                  placeholder="TGSA Guatemala" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Fecha de entrega</label>
                <input type="date" value={form.fecha_entrega}
                  onChange={e => setForm(f => ({ ...f, fecha_entrega: e.target.value }))} required
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Estado</label>
                <select value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                  <option value="confirmada">Confirmada</option>
                  <option value="pendiente">Pendiente</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notas (opcional)</label>
                <input value={form.notas} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400"
                  placeholder="No. remisión, conductor..." />
              </div>
            </div>

            <div className="border border-gray-100 rounded-xl overflow-hidden mb-4">
              <div className="grid grid-cols-2 bg-gray-50 px-4 py-2.5 border-b border-gray-100">
                <div className="text-xs text-gray-400 font-medium">Combustible</div>
                <div className="text-xs text-gray-400 font-medium text-center">Galones recibidos</div>
              </div>
              {combustibles.map((c, i) => (
                <div key={c.key} className={`grid grid-cols-2 gap-4 px-4 py-3 items-center ${i < combustibles.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }}></div>
                    <span className="text-sm font-medium text-gray-700">{c.label}</span>
                  </div>
                  <input type="number" min="0" step="0.01"
                    value={form[`${c.key}_galones`]}
                    onChange={e => setForm(f => ({ ...f, [`${c.key}_galones`]: e.target.value }))}
                    placeholder="0"
                    className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none focus:border-blue-400 w-full" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-4 px-4 py-3 bg-gray-50 border-t border-gray-100">
                <div className="text-xs font-medium text-gray-600">Total galones</div>
                <div className="text-sm font-medium text-gray-800 text-center">
                  {totalGalones() > 0 ? `${totalGalones().toLocaleString('es-GT', { maximumFractionDigits: 1 })} gal` : '—'}
                </div>
              </div>
            </div>

            {errorMsg && (
              <div className="mb-3 bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-xs text-red-700">
                {errorMsg}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { setShowForm(false); setForm(formVacio); setErrorMsg('') }}
                className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="submit" disabled={guardando}
                className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {guardando && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                {guardando ? 'Guardando...' : 'Guardar entrega'}
              </button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-5 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Proveedor</th>
                <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Total gal</th>
                <th className="px-3 py-2.5 text-center text-xs text-gray-400 font-normal">Estado</th>
                <th className="px-4 py-2.5 text-center text-xs text-gray-400 font-normal">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {entregas.length === 0 && (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-xs text-gray-400">Sin entregas registradas aún</td></tr>
              )}
              {entregas.map(e => (
                <>
                  <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-5 py-3 text-gray-700">{e.fecha_entrega}</td>
                    <td className="px-3 py-3 text-gray-700">{e.proveedor}</td>
                    <td className="px-3 py-3 text-right text-gray-700">
                      {parseFloat(e.total_galones || e.volumen_litros || 0).toLocaleString('es-GT', { maximumFractionDigits: 1 })} gal
                    </td>
                    <td className="px-3 py-3 text-center">
                      <select value={e.estado} onChange={ev => cambiarEstado(e.id, ev.target.value)}
                        className={`text-xs px-2.5 py-0.5 rounded-full font-medium border-0 cursor-pointer focus:outline-none ${estadoColor[e.estado]}`}>
                        <option value="pendiente">Pendiente</option>
                        <option value="confirmada">Confirmada</option>
                        <option value="cancelada">Cancelada</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => setDetalleAbierto(detalleAbierto === e.id ? null : e.id)}
                        className="text-xs text-blue-600 hover:text-blue-800">
                        {detalleAbierto === e.id ? '▲ Cerrar' : '▼ Ver'}
                      </button>
                    </td>
                  </tr>
                  {detalleAbierto === e.id && (
                    <tr key={`${e.id}-detalle`} className="border-b border-gray-100">
                      <td colSpan={5} className="px-5 py-3 bg-gray-50">
                        <div className="grid grid-cols-4 gap-3">
                          {combustibles.map(c => {
                            const gal = parseFloat(e[`${c.key}_galones`] || 0)
                            if (gal === 0) return null
                            return (
                              <div key={c.key} className="bg-white rounded-lg border border-gray-100 p-3">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <div className="w-2 h-2 rounded-full" style={{ background: c.color }}></div>
                                  <span className="text-xs font-medium text-gray-700">{c.label}</span>
                                </div>
                                <div className="text-sm font-medium text-gray-800">{gal.toLocaleString('es-GT')} gal</div>
                              </div>
                            )
                          })}
                        </div>
                        {e.notas && <div className="mt-2 text-xs text-gray-400">Notas: {e.notas}</div>}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
