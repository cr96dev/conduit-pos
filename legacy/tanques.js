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
  'cef374e5-139b-4279-a62e-0fe9544c2fa2'
]

const tiposTanque = [
  { key: 'vpower',  label: 'V-Power',  color: '#DC2626', border: '#FECACA' },
  { key: 'super',   label: 'Super',    color: '#16A34A', border: '#BBF7D0' },
  { key: 'regular', label: 'Regular',  color: '#CA8A04', border: '#FEF08A' },
  { key: 'diesel',  label: 'Diesel',   color: '#1C1917', border: '#D6D3D1' },
]

function CirculoTanque({ tipo, nivel, capacidad, onClick, automatica }) {
  const [animado, setAnimado] = useState(0)
  const pct = capacidad > 0 ? Math.min(100, (nivel / capacidad) * 100) : 0

  useEffect(() => {
    const t = setTimeout(() => setAnimado(pct), 100)
    return () => clearTimeout(t)
  }, [pct])

  const r = 54
  const circ = 2 * Math.PI * r
  const offset = circ - (animado / 100) * circ
  const alertColor = pct < 20 ? '#DC2626' : pct < 40 ? '#CA8A04' : tipo.color

  return (
    <div className={`flex flex-col items-center gap-3 ${!automatica && onClick ? 'cursor-pointer group' : 'cursor-default'}`}
      onClick={!automatica && onClick ? onClick : undefined}>
      <div className="relative" style={{ width: 140, height: 140 }}>
        <svg width="140" height="140" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="70" cy="70" r={r} fill="none" stroke="#E5E7EB" strokeWidth="12" />
          <circle cx="70" cy="70" r={r} fill="none"
            stroke={alertColor} strokeWidth="12"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 1s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold" style={{ color: alertColor }}>{Math.round(pct)}%</span>
          <span className="text-xs text-gray-400">{Math.round(nivel).toLocaleString('es-GT')} gal</span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-sm font-medium" style={{ color: tipo.color }}>{tipo.label}</div>
        <div className="text-xs text-gray-400">Cap: {Math.round(capacidad).toLocaleString('es-GT')} gal</div>
        {pct < 20 && <div className="text-xs text-red-500 font-medium mt-0.5">⚠ Nivel crítico</div>}
        {pct >= 20 && pct < 40 && <div className="text-xs text-amber-500 font-medium mt-0.5">Nivel bajo</div>}
        {pct >= 40 && <div className="text-xs text-green-600 mt-0.5">Normal</div>}
      </div>
    </div>
  )
}

export default function Tanques({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [tanques, setTanques] = useState({})
  const [historial, setHistorial] = useState([])
  const [loading, setLoading] = useState(true)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState({ capacidad_galones: '', nivel_galones: '' })
  const [guardando, setGuardando] = useState(false)
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
      const { data: t } = await supabase.from('tanques').select('*').eq('estacion_id', p.estacion_id)
      const map = {}
      ;(t || []).forEach(x => { map[x.tipo] = x })
      setTanques(map)
      const { data: h } = await supabase.from('tanques_historial').select('*')
        .eq('estacion_id', p.estacion_id)
        .order('created_at', { ascending: false }).limit(30)
      setHistorial(h || [])
    }
    setLoading(false)
  }

  function abrirEdicion(tipo) {
    if (esAutomatica) return
    const t = tanques[tipo.key]
    setEditando(tipo)
    setForm({ capacidad_galones: t?.capacidad_galones || '', nivel_galones: t?.nivel_galones || '' })
  }

  async function guardar(e) {
    e.preventDefault()
    if (esAutomatica) return
    setGuardando(true)
    const capacidad = parseFloat(form.capacidad_galones) || 0
    const nivel = parseFloat(form.nivel_galones) || 0
    await supabase.from('tanques').upsert({
      estacion_id: perfil.estacion_id,
      tipo: editando.key,
      capacidad_galones: capacidad,
      nivel_galones: nivel,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'estacion_id,tipo' })
    await supabase.from('tanques_historial').insert({
      estacion_id: perfil.estacion_id,
      tipo: editando.key,
      nivel_galones: nivel,
      capacidad_galones: capacidad,
      creado_por: session.user.id,
    })
    setEditando(null)
    toast(`✓ Tanque de ${editando.label} actualizado`, 'success')
    await loadData()
    setGuardando(false)
  }

  if (loading) return <SkeletonDashboard />

  const totalGalones = tiposTanque.reduce((s, t) => s + (tanques[t.key]?.nivel_galones || 0), 0)
  const totalCapacidad = tiposTanque.reduce((s, t) => s + (tanques[t.key]?.capacidad_galones || 0), 0)
  const tipoLabel = { vpower: 'V-Power', super: 'Super', regular: 'Regular', diesel: 'Diesel' }
  const tipoColor = { vpower: '#DC2626', super: '#16A34A', regular: '#CA8A04', diesel: '#1C1917' }
  const ultimaActualizacion = tanques[tiposTanque.find(t => tanques[t.key])?.key]?.updated_at
    ? new Date(tanques[tiposTanque.find(t => tanques[t.key])?.key]?.updated_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })
    : null

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <ToastContainer toasts={toasts} />
      <div className="p-6 max-w-2xl">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Tanques de combustible</h1>
            <p className="text-sm text-gray-400">{estacion?.nombre}</p>
            {esAutomatica && ultimaActualizacion && (
              <p className="text-xs text-blue-500 mt-0.5">Última actualización: {ultimaActualizacion}</p>
            )}
          </div>
        </div>

        {esAutomatica && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-5 flex items-start gap-3">
            <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <div className="text-xs font-medium text-blue-800">Actualización automática</div>
              <div className="text-xs text-blue-600 mt-0.5">Los niveles se actualizan automáticamente cada noche desde el sistema TLS-4.</div>
            </div>
          </div>
        )}

        {totalCapacidad > 0 && (
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">Total en tanques</div>
              <div className="text-xl font-medium text-gray-900">{Math.round(totalGalones).toLocaleString('es-GT')} gal</div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="text-xs text-gray-500 mb-1">Capacidad total</div>
              <div className="text-xl font-medium text-gray-900">{Math.round(totalCapacidad).toLocaleString('es-GT')} gal</div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 p-6 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 justify-items-center">
            {tiposTanque.map(tipo => (
              <CirculoTanque key={tipo.key} tipo={tipo}
                nivel={tanques[tipo.key]?.nivel_galones || 0}
                capacidad={tanques[tipo.key]?.capacidad_galones || 0}
                onClick={() => abrirEdicion(tipo)}
                automatica={esAutomatica} />
            ))}
          </div>
          {!esAutomatica && (
            <p className="text-xs text-gray-400 text-center mt-4">Haz clic en cualquier tanque para registrar un nuevo nivel</p>
          )}
        </div>

        {!esAutomatica && editando && (
          <form onSubmit={guardar} className="bg-white rounded-xl border-2 p-5 mb-4"
            style={{ borderColor: editando.border }}>
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 rounded-full" style={{ background: editando.color }}></div>
              <h2 className="text-sm font-medium text-gray-800">Registrar nivel — {editando.label}</h2>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Capacidad total (gal)</label>
                <input type="number" min="0" step="0.01" value={form.capacidad_galones}
                  onChange={e => setForm(f => ({ ...f, capacidad_galones: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Nivel actual (gal)</label>
                <input type="number" min="0" step="0.01" value={form.nivel_galones}
                  onChange={e => setForm(f => ({ ...f, nivel_galones: e.target.value }))}
                  placeholder="0"
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
              </div>
            </div>
            {form.capacidad_galones && form.nivel_galones && (
              <div className="text-xs text-gray-500 mb-3">
                Nivel: <span className="font-medium text-gray-800">
                  {Math.round((parseFloat(form.nivel_galones) / parseFloat(form.capacidad_galones)) * 100)}%
                </span>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEditando(null)}
                className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
              <button type="submit" disabled={guardando}
                className="text-sm px-4 py-1.5 text-white rounded-lg disabled:opacity-50 flex items-center gap-2"
                style={{ background: editando.color }}>
                {guardando && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                {guardando ? 'Guardando...' : 'Guardar registro'}
              </button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Combustible</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Nivel (gal)</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Capacidad</th>
                  {esAutomatica && <>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Altura (pulg)</th>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Temp (°F)</th>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Agua (gal)</th>
                  </>}
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">%</th>
                  <th className="px-4 py-2.5 text-center text-xs text-gray-400 font-normal">Estado</th>
                </tr>
              </thead>
              <tbody>
                {tiposTanque.map(tipo => {
                  const t = tanques[tipo.key]
                  const pct = t?.capacidad_galones > 0 ? Math.round((t.nivel_galones / t.capacidad_galones) * 100) : 0
                  return (
                    <tr key={tipo.key}
                      className={`border-b border-gray-50 ${!esAutomatica ? 'hover:bg-gray-50 cursor-pointer' : ''}`}
                      onClick={!esAutomatica ? () => abrirEdicion(tipo) : undefined}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ background: tipo.color }}></div>
                          <span className="font-medium text-gray-800">{tipo.label}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right text-gray-700">{t ? Math.round(t.nivel_galones).toLocaleString('es-GT') : '—'}</td>
                      <td className="px-3 py-3 text-right text-gray-500">{t ? Math.round(t.capacidad_galones).toLocaleString('es-GT') : '—'}</td>
                      {esAutomatica && <>
                        <td className="px-3 py-3 text-right text-gray-500">{t?.altura_pulgadas > 0 ? t.altura_pulgadas.toFixed(2) : '—'}</td>
                        <td className="px-3 py-3 text-right text-gray-500">{t?.temperatura_f > 0 ? `${t.temperatura_f.toFixed(1)}°F` : '—'}</td>
                        <td className="px-3 py-3 text-right text-gray-500">{t ? t.volumen_agua_galones?.toFixed(2) || '0.00' : '—'}</td>
                      </>}
                      <td className="px-3 py-3 text-right font-medium" style={{ color: tipo.color }}>{t ? `${pct}%` : '—'}</td>
                      <td className="px-4 py-3 text-center">
                        {t ? (
                          <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${pct < 20 ? 'bg-red-50 text-red-600' : pct < 40 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-700'}`}>
                            {pct < 20 ? 'Crítico' : pct < 40 ? 'Bajo' : 'Normal'}
                          </span>
                        ) : <span className="text-xs text-gray-400">Sin datos</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <h2 className="text-sm font-medium text-gray-700">Historial de registros</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-5 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha y hora</th>
                  <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Combustible</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Nivel (gal)</th>
                  <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Capacidad</th>
                  {esAutomatica && <>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Temp (°F)</th>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Agua (gal)</th>
                  </>}
                  <th className="px-5 py-2.5 text-right text-xs text-gray-400 font-normal">%</th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 && (
                  <tr><td colSpan={esAutomatica ? 7 : 5} className="px-5 py-6 text-center text-xs text-gray-400">Sin registros aún</td></tr>
                )}
                {historial.map(h => {
                  const pct = h.capacidad_galones > 0 ? Math.round((h.nivel_galones / h.capacidad_galones) * 100) : 0
                  const fecha = new Date(h.created_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })
                  return (
                    <tr key={h.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-5 py-2.5 text-gray-600 text-xs">{fecha}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full" style={{ background: tipoColor[h.tipo] }}></div>
                          <span className="text-xs text-gray-700">{tipoLabel[h.tipo]}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs text-gray-700">{parseFloat(h.nivel_galones).toLocaleString('es-GT')}</td>
                      <td className="px-3 py-2.5 text-right text-xs text-gray-500">{parseFloat(h.capacidad_galones).toLocaleString('es-GT')}</td>
                      {esAutomatica && <>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-500">{h.temperatura_f > 0 ? `${parseFloat(h.temperatura_f).toFixed(1)}°F` : '—'}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-500">{h.volumen_agua_galones ? parseFloat(h.volumen_agua_galones).toFixed(2) : '0.00'}</td>
                      </>}
                      <td className="px-5 py-2.5 text-right">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pct < 20 ? 'bg-red-50 text-red-600' : pct < 40 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-700'}`}>
                          {pct}%
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
