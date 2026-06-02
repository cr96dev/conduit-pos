// pages/cajero-login.js
// Login PIN-only para cajeros (modo kiosko).
// Teclado numerico, 4 dots de progreso, lockout 1 min tras 5 fallos.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

// Devuelve el path interno seguro al que redirigir tras el login.
// Acepta solo paths internos absolutos ('/comandas', '/pos/algo'). Bloquea
// URLs externas, protocol-relative ('//evil.com') y paths sospechosos.
// Default: '/pos' (comportamiento histórico).
function destinoSeguro(next) {
  if (typeof next !== 'string' || !next) return '/pos'
  if (!next.startsWith('/')) return '/pos'
  if (next.startsWith('//')) return '/pos'      // protocol-relative
  if (next.includes('\\')) return '/pos'        // backslash tricks
  return next
}

export default function CajeroLogin({ session }) {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [bloqueoSeg, setBloqueoSeg] = useState(0)
  const [shake, setShake] = useState(false)

  const destino = destinoSeguro(router.query.next)

  useEffect(() => {
    if (session) router.push(destino)
  }, [session])

  useEffect(() => {
    if (bloqueoSeg <= 0) return
    const t = setInterval(() => setBloqueoSeg(s => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [bloqueoSeg])

  async function enviarLogin(p) {
    setEnviando(true)
    setError('')
    try {
      const r = await fetch('/api/cajeros/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: p }),
      })
      const json = await r.json()
      if (!r.ok) {
        if (json.bloqueado) {
          setBloqueoSeg(json.segundos_restantes || 60)
          setError('Demasiados intentos. Esperá un momento.')
        } else {
          setError(json.error || 'PIN incorrecto')
        }
        setShake(true)
        setTimeout(() => setShake(false), 500)
        setPin('')
        setEnviando(false)
        return
      }
      const { error: setErr } = await supabase.auth.setSession({
        access_token: json.session.access_token,
        refresh_token: json.session.refresh_token,
      })
      if (setErr) {
        setError('Error iniciando sesión: ' + setErr.message)
        setEnviando(false)
        return
      }
      router.push(destino)
    } catch (e) {
      setError('Error de red: ' + (e?.message || e))
      setEnviando(false)
    }
  }

  function teclear(d) {
    if (enviando || bloqueoSeg > 0) return
    if (pin.length >= 4) return
    const nuevo = pin + d
    setPin(nuevo)
    if (nuevo.length === 4) {
      setTimeout(() => enviarLogin(nuevo), 80)
    }
  }

  function borrar() {
    if (enviando) return
    setPin(p => p.slice(0, -1))
    setError('')
  }

  const teclas = ['1','2','3','4','5','6','7','8','9']

  return (
    <>
      <Head><title>Cajero · Julia Bakery</title></Head>
      <div className="min-h-screen bg-surface-2 flex flex-col items-center justify-center p-6">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-8">
          <img src="/logo.png" alt="" className="h-12 w-auto" />
          <div>
            <div className="text-lg font-bold text-gray-900 leading-tight">Julia Bakery</div>
            <div className="text-2xs text-ink-subtle font-medium uppercase tracking-wider leading-tight">Punto de venta</div>
          </div>
        </div>

        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-gray-900 mb-1">Ingresá tu PIN</h1>
          <p className="text-sm text-ink-subtle">4 dígitos</p>
        </div>

        {/* Dots de progreso */}
        <div className={`flex gap-3 mb-6 ${shake ? 'animate-shake' : ''}`}>
          {[0,1,2,3].map(i => (
            <div key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
                pin.length > i
                  ? 'bg-julia-red border-julia-red scale-110'
                  : 'border-gray-300'
              }`} />
          ))}
        </div>

        {error && bloqueoSeg <= 0 && (
          <div className="text-sm font-medium mb-4 text-center max-w-xs rounded-lg px-4 py-2.5"
            style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}
        {bloqueoSeg > 0 && (
          <div className="rounded-xl px-5 py-3 mb-4 text-center max-w-xs"
            style={{ background: 'var(--danger-soft)', borderLeft: '3px solid var(--danger)' }}>
            <div className="label-tech mb-1" style={{ color: 'var(--danger)' }}>Bloqueado por seguridad</div>
            <div className="text-3xl font-bold font-mono tabular-nums" style={{ color: 'var(--danger)' }}>{bloqueoSeg}s</div>
            <div className="text-2xs mt-1" style={{ color: 'var(--danger)' }}>Demasiados PINs incorrectos seguidos</div>
          </div>
        )}

        {/* Teclado numerico */}
        <div className="grid grid-cols-3 gap-3 max-w-xs w-full">
          {teclas.map(d => (
            <button key={d} onClick={() => teclear(d)} disabled={enviando || bloqueoSeg > 0}
              className="aspect-square bg-white border border-gray-200 rounded-xl text-2xl font-semibold text-gray-800 active:bg-gray-100 active:scale-[0.97] disabled:opacity-40 transition-all shadow-xs">
              {d}
            </button>
          ))}
          <div></div>
          <button onClick={() => teclear('0')} disabled={enviando || bloqueoSeg > 0}
            className="aspect-square bg-white border border-gray-200 rounded-xl text-2xl font-semibold text-gray-800 active:bg-gray-100 active:scale-[0.97] disabled:opacity-40 transition-all shadow-xs">
            0
          </button>
          <button onClick={borrar} disabled={enviando || bloqueoSeg > 0}
            className="aspect-square bg-white border border-gray-200 rounded-xl text-ink-subtle active:bg-gray-100 active:scale-[0.97] disabled:opacity-40 transition-all shadow-xs flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l-7-7 7-7m-7 7h18" />
            </svg>
          </button>
        </div>

        <button
          onClick={() => router.push('/')}
          className="mt-8 text-2xs text-ink-subtle hover:text-julia-red font-medium uppercase tracking-wider transition-colors">
          Ingresar como administrador
        </button>

        <style jsx global>{`
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-8px); }
            75% { transform: translateX(8px); }
          }
          .animate-shake { animation: shake 0.4s ease-in-out; }
        `}</style>
      </div>
    </>
  )
}
