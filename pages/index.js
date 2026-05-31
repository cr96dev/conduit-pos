// pages/index.js
// Login admin (email/password). En kiosko Sunmi redirige a /cajero-login (PIN).

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRouter } from 'next/router'
import { esKiosko } from '../lib/kiosko'

export default function Login({ session }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function destinoPostLogin() {
    return esKiosko() ? '/pos' : '/dashboard'
  }

  useEffect(() => {
    if (session) {
      router.push(destinoPostLogin())
      return
    }
    if (esKiosko()) {
      router.push('/cajero-login')
    }
  }, [session])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError('Correo o contraseña incorrectos.')
    else router.push(destinoPostLogin())
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-surface-2 flex items-center justify-center px-4">
      <div className="card-julia shadow-md p-8 w-full max-w-sm animate-slide-up">

        {/* Brand */}
        <div className="flex flex-col items-center mb-7">
          <img src="/logo.png" alt="" className="h-20 w-auto object-contain mb-3" />
          <div className="text-lg font-bold text-gray-900 leading-tight">Julia Bakery</div>
          <div className="label-tech mt-1">Sistema de operación</div>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="label-tech block mb-1.5">Correo electrónico</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="input" placeholder="tu-correo@juliabakery.com" autoComplete="email" />
          </div>
          <div>
            <label className="label-tech block mb-1.5">Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="input" placeholder="••••••••" autoComplete="current-password" />
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2.5"
              style={{ background: 'var(--danger-soft)' }}>
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="var(--danger)" strokeWidth={2.2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm font-medium" style={{ color: 'var(--danger)' }}>{error}</p>
            </div>
          )}
          <button type="submit" disabled={loading}
            className="btn-primario w-full justify-center py-3 text-base">
            {loading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
            {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
          </button>
        </form>

        <div className="divider-text mt-6">o</div>

        <button
          onClick={() => router.push('/cajero-login')}
          className="w-full text-2xs text-ink-subtle hover:text-julia-red transition-colors font-medium uppercase tracking-wider flex items-center justify-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
          </svg>
          Soy cajero · ingresar con PIN
        </button>

        <div className="mt-7 pt-5 border-t border-gray-100 text-center">
          <p className="text-2xs text-ink-subtle font-medium uppercase tracking-wider">Julia Bakery · Guatemala</p>
        </div>
      </div>
    </div>
  )
}
