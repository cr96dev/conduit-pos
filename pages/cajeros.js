// pages/cajeros.js
// Admin: gestion de cajeros + turnos. Lista cajeros, resetea PIN, ve historial
// completo de turnos.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const fmtQ = (n) => 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function CajerosAdmin({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [cajeros, setCajeros] = useState([])
  const [turnos, setTurnos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [tab, setTab] = useState('cajeros')

  // Modal crear cajero
  const [creando, setCreando] = useState(false)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [nuevoEmail, setNuevoEmail] = useState('')

  // Modal reset PIN
  const [resetCajero, setResetCajero] = useState(null)
  // PIN devuelto tras crear/resetear (se muestra UNA SOLA VEZ)
  const [pinRevelado, setPinRevelado] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (data?.rol !== 'admin') {
          router.push('/dashboard')
          return
        }
        setPerfil(data)
        cargarTodo()
      })
  }, [session])

  async function cargarTodo() {
    setCargando(true)
    const [c, t] = await Promise.all([
      apiFetch('/api/admin/cajeros').then(r => r.json()),
      apiFetch('/api/admin/turnos?limit=200').then(r => r.json()),
    ])
    setCajeros(c.cajeros || [])
    setTurnos(t.turnos || [])
    setCargando(false)
  }

  async function crearCajero(e) {
    e?.preventDefault()
    setError('')
    if (!nuevoNombre.trim() || !nuevoEmail.trim()) { setError('Nombre y email requeridos'); return }
    const r = await apiFetch('/api/admin/cajeros', {
      method: 'POST',
      body: JSON.stringify({ nombre_completo: nuevoNombre, email: nuevoEmail }),
    })
    const j = await r.json()
    if (!r.ok) { setError(j.error || 'Error creando cajero'); return }
    setPinRevelado({ cajero: j.cajero, pin: j.pin, tipo: 'creado' })
    setCreando(false)
    setNuevoNombre(''); setNuevoEmail('')
    cargarTodo()
  }

  async function resetearPin(cajeroId) {
    setError('')
    const r = await apiFetch('/api/admin/cajeros/reset-pin', {
      method: 'POST',
      body: JSON.stringify({ cajero_id: cajeroId }),
    })
    const j = await r.json()
    if (!r.ok) { setError(j.error || 'Error reseteando PIN'); return }
    setPinRevelado({ cajero: j.cajero, pin: j.pin, tipo: 'reset' })
    setResetCajero(null)
    cargarTodo()
  }

  if (!perfil) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">Cargando...</div>

  return (
    <Layout perfil={perfil}>
      <Head><title>Cajeros · Julia Bakery</title></Head>

      <div className="p-4 md:p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Cajeros y turnos</h1>
            <p className="text-xs text-gray-400">Gestión de cuentas de cajero, PINs y aperturas/cierres de caja.</p>
          </div>
          <button onClick={() => setCreando(true)}
            className="text-xs px-4 py-2 bg-julia-red text-white rounded-lg hover:bg-red-700">
            + Nuevo cajero
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-100">
          {['cajeros', 'turnos'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm border-b-2 transition-colors ${
                tab === t
                  ? 'border-julia-red text-julia-red font-medium'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {t === 'cajeros' ? `Cajeros (${cajeros.length})` : `Turnos (${turnos.length})`}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{error}</div>
        )}

        {cargando ? (
          <div className="text-sm text-gray-400 py-12 text-center">Cargando...</div>
        ) : tab === 'cajeros' ? (
          <div className="card-julia overflow-hidden">
            {cajeros.length === 0 ? (
              <div className="py-12 px-6 text-center text-sm text-gray-400">
                No hay cajeros registrados. Crea uno con el botón "+ Nuevo cajero".
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Nombre</th>
                    <th className="text-left px-4 py-2 font-medium">Email</th>
                    <th className="text-center px-4 py-2 font-medium">Turno</th>
                    <th className="text-center px-4 py-2 font-medium">PIN</th>
                    <th className="text-right px-4 py-2 font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {cajeros.map(c => (
                    <tr key={c.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-800">{c.nombre_completo}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{c.email}</td>
                      <td className="px-4 py-3 text-center">
                        {c.turno_abierto ? (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-1 rounded uppercase tracking-wide">Abierto</span>
                        ) : (
                          <span className="text-[10px] text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-500">
                        {c.tiene_pin
                          ? <span className="text-emerald-600">✓ configurado</span>
                          : <span className="text-amber-600">⚠ sin PIN</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => setResetCajero(c)}
                          className="text-xs text-julia-red hover:underline">
                          Reset PIN
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="card-julia overflow-hidden">
            {turnos.length === 0 ? (
              <div className="py-12 px-6 text-center text-sm text-gray-400">No hay turnos registrados.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Cajero</th>
                    <th className="text-left px-4 py-2 font-medium">Apertura</th>
                    <th className="text-left px-4 py-2 font-medium">Cierre</th>
                    <th className="text-right px-4 py-2 font-medium">Apertura</th>
                    <th className="text-right px-4 py-2 font-medium">Ventas ef.</th>
                    <th className="text-right px-4 py-2 font-medium">Esperado</th>
                    <th className="text-right px-4 py-2 font-medium">Contado</th>
                    <th className="text-right px-4 py-2 font-medium">Diferencia</th>
                  </tr>
                </thead>
                <tbody>
                  {turnos.map(t => (
                    <tr key={t.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-800 text-xs">{t.cajero?.nombre_completo || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{new Date(t.fecha_apertura).toLocaleString('es-GT')}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">
                        {t.fecha_cierre
                          ? new Date(t.fecha_cierre).toLocaleString('es-GT')
                          : <span className="text-emerald-600">— abierto —</span>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs">{fmtQ(t.monto_apertura)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs">{fmtQ(t.ventas_efectivo)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs">{t.monto_cierre_esperado != null ? fmtQ(t.monto_cierre_esperado) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-xs">{t.conteo_efectivo_cierre != null ? fmtQ(t.conteo_efectivo_cierre) : '—'}</td>
                      <td className={`px-4 py-3 text-right tabular-nums text-xs font-medium ${
                        t.diferencia == null ? 'text-gray-400'
                          : Number(t.diferencia) === 0 ? 'text-emerald-600'
                          : Number(t.diferencia) > 0 ? 'text-amber-600'
                          : 'text-red-600'
                      }`}>
                        {t.diferencia == null ? '—'
                          : (Number(t.diferencia) > 0 ? '+' : '') + fmtQ(t.diferencia)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Modal: crear cajero */}
      {creando && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setCreando(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h2 className="text-base font-semibold text-gray-900">Nuevo cajero</h2>
              <button onClick={() => setCreando(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <form onSubmit={crearCajero} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Nombre completo</label>
                <input value={nuevoNombre} onChange={e => setNuevoNombre(e.target.value)} required autoFocus
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email interno</label>
                <input type="email" value={nuevoEmail} onChange={e => setNuevoEmail(e.target.value)} required
                  placeholder="nombre.apellido@cajeros.juliabakery.gt"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red" />
                <div className="text-[10px] text-gray-400 mt-1">El cajero nunca ve este email. Solo usa PIN.</div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCreando(false)}
                  className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                  Cancelar
                </button>
                <button type="submit"
                  className="text-sm px-5 py-2 bg-julia-red text-white rounded-lg hover:bg-red-700">
                  Crear (PIN automático)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: confirmar reset PIN */}
      {resetCajero && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setResetCajero(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5">
              <h2 className="text-base font-semibold text-gray-900 mb-1">Resetear PIN</h2>
              <p className="text-sm text-gray-600 mb-1">¿Generar PIN nuevo para <strong>{resetCajero.nombre_completo}</strong>?</p>
              <p className="text-xs text-gray-400 mb-5">El PIN anterior deja de funcionar. El nuevo se mostrará una sola vez.</p>
              <div className="flex justify-end gap-2">
                <button onClick={() => setResetCajero(null)}
                  className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Cancelar</button>
                <button onClick={() => resetearPin(resetCajero.id)}
                  className="text-sm px-5 py-2 bg-julia-red text-white rounded-lg hover:bg-red-700">Sí, resetear</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: PIN revelado (mostrar 1 sola vez) */}
      {pinRevelado && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
            <div className="px-6 py-6 text-center">
              <div className="text-3xl mb-2">🔐</div>
              <h2 className="text-base font-semibold text-gray-900 mb-1">
                PIN {pinRevelado.tipo === 'creado' ? 'asignado' : 'reseteado'}
              </h2>
              <p className="text-xs text-gray-500 mb-4">{pinRevelado.cajero.nombre_completo}</p>
              <div className="bg-gray-50 border border-gray-200 rounded-xl py-4 mb-3">
                <div className="text-4xl font-mono font-bold text-gray-900 tracking-widest">{pinRevelado.pin}</div>
              </div>
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-3 py-2 mb-4">
                ⚠ Anotalo ahora. No se vuelve a mostrar. El hash queda en BD.
              </p>
              <button onClick={() => setPinRevelado(null)}
                className="w-full py-2 bg-julia-red text-white text-sm font-medium rounded-lg hover:bg-red-700">
                Lo anoté
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  )
}
