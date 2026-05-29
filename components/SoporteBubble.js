// components/SoporteBubble.js
// Burbuja flotante de soporte tecnico en el POS. El cajero la abre, escribe
// su problema, y el modelo (Claude haiku-4-5) responde con contexto operativo
// automatico (turno, carrito, receptor, errores recientes).
//
// Uso:
//   <SoporteBubble perfil={perfil} obtenerContexto={() => ({ turno, carrito, ... })} />
//
// obtenerContexto es una funcion que retorna un objeto JSON con el estado
// operativo actual del POS. Se llama cada vez que el cajero manda un mensaje.

import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

export default function SoporteBubble({ perfil, obtenerContexto }) {
  const [abierto, setAbierto] = useState(false)
  const [convId, setConvId] = useState(null)
  const [mensajes, setMensajes] = useState([])
  const [input, setInput] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [cargandoInicial, setCargandoInicial] = useState(false)
  const scrollRef = useRef(null)

  // Auto-scroll al final cuando hay mensajes nuevos
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [mensajes, enviando])

  // Al abrir el panel, cargar la conversacion mas reciente del cajero (si hay)
  async function abrir() {
    setAbierto(true)
    if (!convId) {
      setCargandoInicial(true)
      try {
        const r = await apiFetch('/api/soporte/conversacion')
        const j = await r.json()
        if (j.conversacion) {
          setConvId(j.conversacion.id)
          setMensajes(j.mensajes || [])
        }
      } catch (_) {}
      setCargandoInicial(false)
    }
  }

  async function enviar(e) {
    e?.preventDefault?.()
    const texto = input.trim()
    if (!texto || enviando) return

    // Optimista: mostrar mensaje del cajero ya
    const ahora = new Date().toISOString()
    setMensajes(m => [...m, { rol: 'user', contenido: texto, created_at: ahora }])
    setInput('')
    setEnviando(true)

    let contexto = {}
    try { contexto = (obtenerContexto && obtenerContexto()) || {} } catch (_) {}

    try {
      const r = await apiFetch('/api/soporte/chat', {
        method: 'POST',
        body: JSON.stringify({ conversacion_id: convId, mensaje: texto, contexto }),
      })
      const j = await r.json()
      if (!r.ok) {
        setMensajes(m => [...m, {
          rol: 'assistant',
          contenido: '⚠ Error: ' + (j.error || 'no se pudo enviar'),
          created_at: new Date().toISOString(),
        }])
      } else {
        if (!convId) setConvId(j.conversacion_id)
        setMensajes(m => [...m, {
          rol: 'assistant',
          contenido: j.respuesta,
          created_at: new Date().toISOString(),
        }])
      }
    } catch (err) {
      setMensajes(m => [...m, {
        rol: 'assistant',
        contenido: '⚠ Error de red: ' + (err?.message || err),
        created_at: new Date().toISOString(),
      }])
    } finally {
      setEnviando(false)
    }
  }

  // No mostrar burbuja a no-operativos
  if (!perfil || !['admin', 'cajero', 'barista'].includes(perfil.rol)) return null

  return (
    <>
      {/* FAB cuando está cerrado */}
      {!abierto && (
        <button
          onClick={abrir}
          aria-label="Soporte técnico"
          className="lg:hidden fixed bottom-6 left-6 z-40 w-14 h-14 rounded-full bg-julia-red text-white shadow-2xl flex items-center justify-center active:scale-95 transition-transform">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}
      {/* También una versión desktop (esquina inferior izquierda) */}
      {!abierto && (
        <button
          onClick={abrir}
          aria-label="Soporte técnico"
          className="hidden lg:flex fixed bottom-6 left-6 z-40 items-center gap-2 px-4 py-3 rounded-full bg-julia-red text-white shadow-2xl active:scale-95 transition-transform hover:bg-red-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-sm font-medium">Soporte</span>
        </button>
      )}

      {/* Panel chat */}
      {abierto && (
        <div className="fixed bottom-0 left-0 lg:bottom-6 lg:left-6 z-50 w-full lg:w-[380px] h-[80vh] lg:h-[600px] bg-white border border-gray-200 lg:rounded-2xl shadow-2xl flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-100 bg-julia-red text-white lg:rounded-t-2xl flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-bold">Soporte Julia</div>
                <div className="text-[10px] opacity-80">Respuesta automática</div>
              </div>
            </div>
            <button
              onClick={() => setAbierto(false)}
              aria-label="Cerrar"
              className="text-white/80 hover:text-white p-1 -mr-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Mensajes */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
            {cargandoInicial ? (
              <div className="text-center text-xs text-gray-400 py-4">Cargando conversación...</div>
            ) : mensajes.length === 0 ? (
              <div className="text-center text-xs text-gray-400 py-8 px-2">
                <div className="text-4xl mb-2">👋</div>
                <div className="font-medium text-gray-600">Hola, soy tu asistente.</div>
                <div className="mt-1">
                  Contame cualquier problema operativo y te ayudo a resolverlo.
                </div>
              </div>
            ) : (
              mensajes.map((m, i) => (
                <div key={m.id || i}
                  className={`flex ${m.rol === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                      m.rol === 'user'
                        ? 'bg-julia-red text-white rounded-br-sm'
                        : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                    }`}>
                    {m.contenido}
                  </div>
                </div>
              ))
            )}
            {enviando && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm text-gray-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse"></span>
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style={{animationDelay: '0.15s'}}></span>
                  <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-pulse" style={{animationDelay: '0.3s'}}></span>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={enviar} className="flex-shrink-0 px-3 py-3 border-t border-gray-100 bg-white lg:rounded-b-2xl flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  enviar()
                }
              }}
              rows={1}
              placeholder="Escribí tu problema..."
              disabled={enviando}
              className="flex-1 resize-none px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-julia-red disabled:bg-gray-50 max-h-32" />
            <button
              type="submit"
              disabled={enviando || !input.trim()}
              className="flex-shrink-0 w-10 h-10 rounded-xl bg-julia-red text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 hover:bg-red-700 transition-all">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  )
}
