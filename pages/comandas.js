// pages/comandas.js
// Pantalla "Loyverse Display"-style para el iPad de la barra.
//
// Fullscreen en Safari. Cards grandes con items, timer en vivo, color por
// antiguedad. Tap = preparando -> lista -> entregada. Beep al llegar nueva.
//
// Auth: admin | cajero | barista. Subscribe a Supabase Realtime sobre comandas.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

// Beep corto generado con Web Audio (no requiere archivo).
function beep(audioCtx) {
  if (!audioCtx) return
  try {
    const o = audioCtx.createOscillator()
    const g = audioCtx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.value = 0.15
    o.connect(g); g.connect(audioCtx.destination)
    const t = audioCtx.currentTime
    g.gain.setValueAtTime(0.15, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    o.start(t)
    o.stop(t + 0.25)
    // segundo beep mas grave
    setTimeout(() => {
      const o2 = audioCtx.createOscillator()
      const g2 = audioCtx.createGain()
      o2.type = 'sine'; o2.frequency.value = 660; g2.gain.value = 0.15
      o2.connect(g2); g2.connect(audioCtx.destination)
      const t2 = audioCtx.currentTime
      g2.gain.setValueAtTime(0.15, t2)
      g2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.25)
      o2.start(t2); o2.stop(t2 + 0.25)
    }, 200)
  } catch (_) {}
}

function clasificarColor(minutos) {
  if (minutos < 2)  return 'bg-emerald-50 border-emerald-300'
  if (minutos < 5)  return 'bg-amber-50 border-amber-300'
  return 'bg-red-50 border-red-400'
}

function ComandaCard({ c, onTap, ahora }) {
  const minutosDesdeCreacion = useMemo(() => {
    const ms = ahora - new Date(c.fecha_creacion).getTime()
    return Math.max(0, Math.floor(ms / 60000))
  }, [c.fecha_creacion, ahora])
  const segs = useMemo(() => {
    const ms = ahora - new Date(c.fecha_creacion).getTime()
    return Math.max(0, Math.floor((ms % 60000) / 1000))
  }, [c.fecha_creacion, ahora])

  const colorBase =
    c.estado === 'lista'      ? 'bg-blue-50 border-blue-300'
  : c.estado === 'preparando' ? 'bg-yellow-50 border-yellow-300'
  :                              clasificarColor(minutosDesdeCreacion)

  return (
    <div
      onClick={() => onTap(c)}
      className={`${colorBase} border-2 rounded-2xl p-4 shadow-sm cursor-pointer transition-transform active:scale-[0.98]`}>
      <div className="flex items-start justify-between mb-3">
        <div className="text-[11px] uppercase tracking-wider font-bold text-gray-500">
          {c.estado === 'pendiente'  && 'Nuevo'}
          {c.estado === 'preparando' && 'Preparando'}
          {c.estado === 'lista'      && '✓ Listo'}
        </div>
        <div className="text-xl font-bold tabular-nums text-gray-800">
          {String(minutosDesdeCreacion).padStart(2, '0')}:{String(segs).padStart(2, '0')}
        </div>
      </div>

      <div className="space-y-2 mb-3">
        {(c.items || []).map((it, i) => (
          <div key={i} className="flex items-baseline gap-3">
            <span className="text-2xl font-bold tabular-nums text-gray-900 min-w-[2ch]">
              {it.cantidad}×
            </span>
            <div className="flex-1">
              <div className="text-lg font-semibold text-gray-900 leading-tight">{it.descripcion}</div>
              {it.notas && (
                <div className="text-xs text-gray-500 italic mt-0.5">"{it.notas}"</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {c.notas_generales && (
        <div className="text-xs text-gray-500 border-t border-gray-200 pt-2 italic">
          {c.notas_generales}
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-gray-200 flex items-center justify-between text-[10px] text-gray-400">
        <span>{c.cajero?.nombre_completo || '—'}</span>
        <span>{new Date(c.fecha_creacion).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>

      {/* CTA */}
      <button
        onClick={(e) => { e.stopPropagation(); onTap(c) }}
        className={`mt-3 w-full py-3 rounded-xl text-base font-semibold transition-colors ${
          c.estado === 'pendiente'  ? 'bg-yellow-500 text-white' :
          c.estado === 'preparando' ? 'bg-blue-600 text-white' :
                                       'bg-emerald-600 text-white'
        }`}>
        {c.estado === 'pendiente'  && 'Empezar a preparar'}
        {c.estado === 'preparando' && 'Marcar lista'}
        {c.estado === 'lista'      && 'Entregar al cliente'}
      </button>
    </div>
  )
}

export default function Comandas({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [comandas, setComandas] = useState([])
  const [cargando, setCargando] = useState(true)
  const [ahora, setAhora] = useState(Date.now())
  const audioCtxRef = useRef(null)
  const ultimoIdRef = useRef(new Set())  // para detectar nuevas y beepear

  // Auth + carga inicial
  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => {
        const p = data || {}
        if (!['admin', 'cajero', 'barista'].includes(p.rol)) {
          router.push('/')
          return
        }
        setPerfil(p)
        recargar()
      })
  }, [session])

  async function recargar() {
    setCargando(true)
    const r = await apiFetch('/api/comandas')
    const j = await r.json()
    const lista = j.comandas || []
    setComandas(lista)
    ultimoIdRef.current = new Set(lista.map(c => c.id))
    setCargando(false)
  }

  // Realtime subscription
  useEffect(() => {
    if (!perfil) return
    const channel = supabase
      .channel('comandas-stream')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'comandas' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const nueva = payload.new
            if (['pendiente','preparando','lista'].includes(nueva.estado)) {
              setComandas(prev => {
                if (prev.find(c => c.id === nueva.id)) return prev
                ultimoIdRef.current.add(nueva.id)
                beep(audioCtxRef.current)
                return [...prev, nueva].sort((a, b) =>
                  new Date(a.fecha_creacion) - new Date(b.fecha_creacion))
              })
            }
          } else if (payload.eventType === 'UPDATE') {
            const upd = payload.new
            setComandas(prev => {
              const yaSinEsta = prev.filter(c => c.id !== upd.id)
              if (['entregada','cancelada'].includes(upd.estado)) {
                return yaSinEsta
              }
              return [...yaSinEsta, upd].sort((a, b) =>
                new Date(a.fecha_creacion) - new Date(b.fecha_creacion))
            })
          } else if (payload.eventType === 'DELETE') {
            setComandas(prev => prev.filter(c => c.id !== payload.old.id))
          }
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [perfil])

  // Timer global para refrescar timestamps cada segundo
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Inicializar audio context tras el primer tap (Safari requiere user gesture)
  function inicializarAudio() {
    if (!audioCtxRef.current && typeof window !== 'undefined' && window.AudioContext) {
      audioCtxRef.current = new AudioContext()
    }
  }

  const TRANSICION = {
    pendiente: 'preparando',
    preparando: 'lista',
    lista: 'entregada',
  }

  async function tap(c) {
    inicializarAudio()
    const destino = TRANSICION[c.estado]
    if (!destino) return
    // Optimista: actualizar localmente
    setComandas(prev => prev.map(x => x.id === c.id ? { ...x, estado: destino } : x))
    const r = await apiFetch(`/api/comandas/${c.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado: destino }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      alert('Error: ' + (j.error || 'No se pudo actualizar'))
      recargar()
    }
  }

  const pendientes  = comandas.filter(c => c.estado === 'pendiente')
  const preparando  = comandas.filter(c => c.estado === 'preparando')
  const listas      = comandas.filter(c => c.estado === 'lista')

  return (
    <>
      <Head>
        <title>Barra · Julia Bakery</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
      </Head>
      <div className="min-h-screen bg-gray-100 select-none" onClick={inicializarAudio}>
        <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-8 w-auto" />
            <h1 className="text-base font-bold text-gray-900">Barra</h1>
            <span className="text-xs text-gray-400">· {perfil?.nombre_completo || perfil?.rol || ''}</span>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded">
              Nuevas: {pendientes.length}
            </span>
            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded">
              En curso: {preparando.length}
            </span>
            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded">
              Listas: {listas.length}
            </span>
            <button
              onClick={async () => { await supabase.auth.signOut(); router.push('/') }}
              className="text-gray-400 hover:text-red-600 ml-2">
              Salir
            </button>
          </div>
        </header>

        <main className="p-4">
          {cargando ? (
            <div className="text-center text-gray-400 py-20">Cargando comandas...</div>
          ) : comandas.length === 0 ? (
            <div className="text-center text-gray-400 py-20">
              <div className="text-6xl mb-4">☕</div>
              <div className="text-lg">No hay comandas activas</div>
              <div className="text-xs mt-1">Las nuevas aparecerán solas. Tocá la pantalla una vez para activar sonido.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {[...pendientes, ...preparando, ...listas].map(c => (
                <ComandaCard key={c.id} c={c} onTap={tap} ahora={ahora} />
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  )
}
