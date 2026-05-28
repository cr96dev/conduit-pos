// pages/abrir-caja.js
// Pantalla "Abrir caja" para cajero. Pide monto inicial + observacion opcional.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

export default function AbrirCaja({ session }) {
  const router = useRouter()
  const [monto, setMonto] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [perfil, setPerfil] = useState(null)

  useEffect(() => {
    if (!session) { router.push('/cajero-login'); return }
    supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => setPerfil(data))
    // Si ya hay turno abierto, redirigir al POS.
    apiFetch('/api/turnos/actual').then(r => r.json()).then(j => {
      if (j?.turno) router.replace('/pos')
    })
  }, [session])

  async function abrir(e) {
    e.preventDefault()
    setError('')
    const m = Number(monto)
    if (!Number.isFinite(m) || m < 0) { setError('Monto inválido'); return }
    setEnviando(true)
    const r = await apiFetch('/api/turnos/abrir', {
      method: 'POST',
      body: JSON.stringify({ monto_apertura: m, observacion_apertura: obs }),
    })
    const j = await r.json()
    setEnviando(false)
    if (!r.ok) { setError(j.error || 'Error abriendo caja'); return }
    router.replace('/pos')
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push('/cajero-login')
  }

  return (
    <>
      <Head><title>Abrir caja · Julia Bakery</title></Head>
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 w-full max-w-sm">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Abrir caja</h1>
              <p className="text-xs text-gray-400">{perfil?.nombre_completo || 'Cajero'}</p>
            </div>
            <button onClick={logout} className="text-xs text-gray-400 hover:text-julia-red">Salir</button>
          </div>

          <form onSubmit={abrir} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Monto inicial en efectivo (Q)</label>
              <input
                type="number" step="any" min="0" value={monto}
                onChange={e => setMonto(e.target.value)} autoFocus required
                inputMode="decimal"
                className="w-full text-2xl text-right tabular-nums px-3 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red"
                placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Observación (opcional)</label>
              <textarea
                value={obs} onChange={e => setObs(e.target.value)} rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red"
                placeholder="Notas de apertura..." />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{error}</div>
            )}
            <button type="submit" disabled={enviando}
              className="w-full py-3 bg-julia-red text-white font-medium rounded-lg disabled:opacity-50 hover:bg-red-700">
              {enviando ? 'Abriendo...' : 'Abrir caja y entrar al POS'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
