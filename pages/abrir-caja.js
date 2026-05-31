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
      <div className="min-h-screen bg-surface-2 flex flex-col items-center justify-center p-6">
        <div className="card-julia shadow-md p-6 w-full max-w-sm animate-slide-up">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-julia-red/10 text-julia-red flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h.01M11 15h2M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-900 leading-tight">Abrir caja</h1>
                <p className="text-sm text-ink-subtle leading-tight">{perfil?.nombre_completo || 'Cajero'}</p>
              </div>
            </div>
            <button onClick={logout}
              className="text-2xs text-ink-subtle hover:text-julia-red font-medium uppercase tracking-wider transition-colors">
              Salir
            </button>
          </div>

          <form onSubmit={abrir} className="space-y-4">
            <div>
              <label className="label-tech block mb-1.5">Monto inicial en efectivo</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-subtle font-mono text-base">Q</span>
                <input
                  type="number" step="any" min="0" value={monto}
                  onChange={e => setMonto(e.target.value)} autoFocus required
                  inputMode="decimal"
                  className="input pl-10 text-2xl font-bold text-right tabular-nums py-4 font-mono"
                  placeholder="0.00" />
              </div>
            </div>
            <div>
              <label className="label-tech block mb-1.5">Observación (opcional)</label>
              <textarea
                value={obs} onChange={e => setObs(e.target.value)} rows={2}
                className="input resize-none"
                placeholder="Notas de apertura..." />
            </div>
            {error && (
              <div className="rounded-lg px-3 py-2.5 text-sm font-medium"
                style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                {error}
              </div>
            )}
            <button type="submit" disabled={enviando}
              className="btn-primario w-full justify-center py-3.5 text-base">
              {enviando ? 'Abriendo...' : 'Abrir caja y entrar al POS'}
            </button>
          </form>
        </div>
      </div>
    </>
  )
}
