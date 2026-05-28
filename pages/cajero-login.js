// pages/cajero-login.js
// Login PIN-only para cajeros (modo kiosko).
// Teclado numerico, 4 dots de progreso, lockout 1 min tras 5 fallos.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

export default function CajeroLogin({ session }) {
  const router = useRouter()
  const [pin, setPin] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [bloqueoSeg, setBloqueoSeg] = useState(0)
  const [shake, setShake] = useState(false)

  // Si ya hay sesion, ir directo al POS.
  useEffect(() => {
    if (session) router.push('/pos')
  }, [session])

  // Contador de bloqueo.
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
      // Setear sesion en el cliente con los tokens devueltos.
      const { error: setErr } = await supabase.auth.setSession({
        access_token: json.session.access_token,
        refresh_token: json.session.refresh_token,
      })
      if (setErr) {
        setError('Error iniciando sesion: ' + setErr.message)
        setEnviando(false)
        return
      }
      // Redirigir al POS — el POS redirigira a /abrir-caja si no hay turno.
      router.push('/pos')
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
      // Auto-enviar al cuarto digito
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
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <img src="/logo.png" alt="Julia Bakery" className="w-40 mb-6" />
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-gray-900 mb-1">Ingresá tu PIN</h1>
          <p className="text-xs text-gray-400">4 dígitos</p>
        </div>

        {/* Dots */}
        <div className={`flex gap-3 mb-6 ${shake ? 'animate-shake' : ''}`}>
          {[0,1,2,3].map(i => (
            <div key={i}
              className={`w-4 h-4 rounded-full border-2 transition-all ${
                pin.length > i
                  ? 'bg-julia-red border-julia-red scale-110'
                  : 'border-gray-300'
              }`} />
          ))}
        </div>

        {error && bloqueoSeg <= 0 && (
          <div className="text-xs text-red-600 mb-4 text-center max-w-xs">{error}</div>
        )}
        {bloqueoSeg > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 mb-4 text-center">
            <div className="text-xs text-red-700 font-medium">Bloqueado por seguridad</div>
            <div className="text-2xl font-semibold text-red-700 tabular-nums">{bloqueoSeg}s</div>
            <div className="text-[10px] text-red-500">Demasiados PINs incorrectos seguidos</div>
          </div>
        )}

        {/* Teclado numerico */}
        <div className="grid grid-cols-3 gap-3 max-w-xs w-full">
          {teclas.map(d => (
            <button key={d} onClick={() => teclear(d)} disabled={enviando || bloqueoSeg > 0}
              className="aspect-square bg-white border border-gray-200 rounded-2xl text-2xl font-medium text-gray-800 active:bg-gray-100 disabled:opacity-40 transition-colors shadow-sm">
              {d}
            </button>
          ))}
          <div></div>
          <button onClick={() => teclear('0')} disabled={enviando || bloqueoSeg > 0}
            className="aspect-square bg-white border border-gray-200 rounded-2xl text-2xl font-medium text-gray-800 active:bg-gray-100 disabled:opacity-40 transition-colors shadow-sm">
            0
          </button>
          <button onClick={borrar} disabled={enviando || bloqueoSeg > 0}
            className="aspect-square bg-white border border-gray-200 rounded-2xl text-base text-gray-500 active:bg-gray-100 disabled:opacity-40 transition-colors shadow-sm flex items-center justify-center">
            ⌫
          </button>
        </div>

        <button
          onClick={() => router.push('/')}
          className="mt-8 text-xs text-gray-400 hover:text-gray-700">
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
