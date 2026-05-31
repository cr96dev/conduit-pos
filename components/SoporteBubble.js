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

// Labels humanos para tools (las que el asistente puede invocar).
// Cuando una respuesta del asistente incluye `tool_calls`, mostramos un
// chip por cada una con este label.
const LABELS_TOOL = {
  // Read (Fase 1)
  buscar_factura:           'Buscó factura',
  estado_turno_actual:      'Verificó turno',
  estado_fel_infile:        'Verificó certificador',
  ultimos_errores_recientes:'Listó errores recientes',
  buscar_recibo_loyverse:   'Buscó recibo Loyverse',
  consultar_nit_rtu:        'Consultó NIT en SAT',
  estado_impresora:         'Verificó impresora',
  // Write (Fase 2)
  reimprimir_factura:        'Reimprimir factura',
  reintentar_certificar:     'Reintentar certificación',
  actualizar_correo_receptor:'Actualizar email del receptor',
  anular_factura:            'Anular factura',
}
function labelTool(name) {
  return LABELS_TOOL[name] || name
}

// Red de seguridad: si el modelo manda markdown por error (asteriscos,
// guiones bajos, almohadillas), lo dejamos como texto plano legible.
// El system prompt le pide al modelo no usarlo, pero por las dudas.
function limpiarMarkdown(text) {
  if (typeof text !== 'string') return text
  return text
    // **bold** o __bold__ -> bold
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // *italic* o _italic_ -> italic, pero respetando guiones bajos en
    // identificadores tipo my_var (que pierdan formato no es problema).
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
    // Headings #/##/### al inicio de linea -> quitamos los hashes
    .replace(/^#{1,6}\s+/gm, '')
    // backticks de inline code
    .replace(/`([^`]+)`/g, '$1')
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
          tool_calls: j.tool_calls || [],
          pending_actions: j.pending_actions || [],
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

  /**
   * Resuelve una accion pendiente que el agente propuso.
   * decision: 'confirmar' | 'rechazar'
   * Optimistic UI: marca el mensaje como resolviendose y agrega el nuevo
   * mensaje del assistant cuando responde el endpoint.
   */
  async function resolverPending(actionId, decision, msgIdx) {
    // Marcar como en-progreso visualmente (deshabilitar botones)
    setMensajes(m => m.map((msg, i) => i !== msgIdx ? msg : {
      ...msg,
      _resolving: actionId,
    }))
    try {
      const res = await apiFetch(`/api/soporte/acciones/${actionId}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      })
      const j = await res.json()
      if (!res.ok) {
        // Marcar la pending como fallida pero seguir mostrando el mensaje
        setMensajes(m => m.map((msg, i) => i !== msgIdx ? msg : {
          ...msg,
          _resolving: null,
          pending_actions: (msg.pending_actions || []).map(pa =>
            pa.id === actionId ? { ...pa, estado: 'error', error: j.error } : pa
          ),
        }))
        return
      }

      // Si el endpoint devolvio un payload de impresion (caso reimprimir),
      // disparamos el print fisico via el bridge JuliaPOS de la WebView.
      // Si no hay bridge (desktop o wrapper sin instalar), salta el warning.
      const r = j.resultado || {}
      if (r.factura && r.items && (r.esReimpresion || r.reimpresionNum)) {
        try {
          if (typeof window !== 'undefined' && window.JuliaPOS && window.JuliaPOS.printTicket) {
            const direccion = [
              r.emisor?.direccion,
              [r.emisor?.municipio, r.emisor?.departamento].filter(Boolean).join(', '),
            ].filter(Boolean).join(' ')
            const payload = {
              merchantName: r.emisor?.nombre_comercial || 'Julia Bakery',
              razonSocial: r.emisor?.razon_social || null,
              direccion: direccion || null,
              nitEmisor: r.emisor?.nit_emisor || null,
              receptorNit: r.factura.receptor_nit,
              receptorNombre: r.factura.receptor_nombre,
              fecha: r.factura.fecha_certificacion
                ? new Date(r.factura.fecha_certificacion).toLocaleString('es-GT')
                : new Date(r.factura.fecha_emision).toLocaleString('es-GT'),
              cajeroNombre: null,
              metodoPago: null,
              items: (r.items || []).map(it => ({
                descripcion: it.descripcion,
                cantidad: String(it.cantidad),
                precioUnitario: Number(it.precio_unitario),
                subtotal: Number(it.subtotal),
              })),
              totalGravado: Number(r.factura.total_gravado),
              iva: Number(r.factura.iva),
              total: Number(r.factura.total),
              uuidSat: r.factura.uuid_sat,
              serieSat: r.factura.serie_sat,
              numeroSat: r.factura.numero_sat,
              certificadorNombre: 'INFILE, S.A.',
              certificadorNit: '12521329',
              fechaCertificacion: r.factura.fecha_certificacion
                ? new Date(r.factura.fecha_certificacion).toLocaleString('es-GT')
                : null,
              textoFooter: 'Sujeto a pago directo ISR (5111420251235387 - 01/04/2025)',
              esReimpresion: true,
              reimpresionNum: r.reimpresionNum || r.reimpresion_num || 1,
            }
            await window.JuliaPOS.printTicket(payload)
          }
        } catch (e) {
          console.warn('[Soporte] print fisico fallo:', e?.message || e)
        }
      }

      // Marcar la pending como resuelta + agregar el nuevo mensaje del assistant
      setMensajes(m => {
        const conNuevo = [...m]
        if (j.mensaje) {
          conNuevo.push({
            rol: 'assistant',
            contenido: j.mensaje.contenido,
            created_at: j.mensaje.created_at || new Date().toISOString(),
          })
        }
        return conNuevo.map((msg, i) => i !== msgIdx ? msg : {
          ...msg,
          _resolving: null,
          pending_actions: (msg.pending_actions || []).map(pa =>
            pa.id === actionId ? { ...pa, estado: j.estado || 'confirmada' } : pa
          ),
        })
      })
    } catch (e) {
      setMensajes(m => m.map((msg, i) => i !== msgIdx ? msg : {
        ...msg,
        _resolving: null,
      }))
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
                  className={`flex flex-col ${m.rol === 'user' ? 'items-end' : 'items-start'}`}>
                  <div
                    className={`max-w-[82%] px-3.5 py-2.5 rounded-2xl text-[14.5px] leading-relaxed whitespace-pre-wrap break-words tracking-[0.005em] ${
                      m.rol === 'user'
                        ? 'bg-julia-red text-white rounded-br-sm font-sans'
                        : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm font-sans'
                    }`}>
                    {limpiarMarkdown(m.contenido)}
                  </div>
                  {/* Tool calls que el asistente ejecuto para responder este mensaje */}
                  {m.rol === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 && (
                    <div className="mt-1 ml-1 flex flex-wrap gap-1">
                      {m.tool_calls.map((tc, idx) => (
                        <span key={idx}
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            tc.ok
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                              : 'bg-amber-50 border-amber-200 text-amber-700'
                          }`}
                          title={`${tc.name} · ${tc.duracion_ms}ms · ${tc.ok ? 'OK' : 'error'}`}
                        >
                          {tc.ok ? '✓' : '⚠'} {labelTool(tc.name)}
                        </span>
                      ))}
                    </div>
                  )}
                  {/* Acciones pendientes de confirmacion (Fase 2) */}
                  {m.rol === 'assistant' && Array.isArray(m.pending_actions) && m.pending_actions.length > 0 && (
                    <div className="mt-2 ml-1 space-y-2 w-[82%]">
                      {m.pending_actions.map(pa => {
                        const estado = pa.estado || 'pendiente'
                        const resolviendo = m._resolving === pa.id
                        return (
                          <div key={pa.id}
                            className={`border rounded-xl p-3 ${
                              estado === 'confirmada' ? 'bg-emerald-50 border-emerald-200' :
                              estado === 'rechazada' ? 'bg-gray-50 border-gray-200' :
                              estado === 'error' ? 'bg-amber-50 border-amber-200' :
                              'bg-blue-50 border-blue-200'
                            }`}>
                            <div className="text-[11px] font-medium text-gray-700 mb-1">
                              {labelTool(pa.tool_name)}
                            </div>
                            <div className="text-[13px] text-gray-800 leading-snug mb-2">
                              {pa.resumen}
                            </div>
                            {estado === 'pendiente' && (
                              <div className="flex gap-2">
                                <button
                                  disabled={resolviendo}
                                  onClick={() => resolverPending(pa.id, 'confirmar', i)}
                                  className="flex-1 text-xs bg-julia-red text-white px-3 py-1.5 rounded-lg font-medium hover:bg-red-700 disabled:opacity-50"
                                >
                                  {resolviendo ? '…' : 'Confirmar'}
                                </button>
                                <button
                                  disabled={resolviendo}
                                  onClick={() => resolverPending(pa.id, 'rechazar', i)}
                                  className="flex-1 text-xs bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg font-medium hover:bg-gray-50 disabled:opacity-50"
                                >
                                  Cancelar
                                </button>
                              </div>
                            )}
                            {estado === 'confirmada' && <div className="text-[11px] text-emerald-700">✓ Confirmada y ejecutada.</div>}
                            {estado === 'rechazada' && <div className="text-[11px] text-gray-500">Cancelada por el usuario.</div>}
                            {estado === 'error' && <div className="text-[11px] text-amber-700">⚠ Error al ejecutar: {pa.error || 'detalle no disponible'}</div>}
                          </div>
                        )
                      })}
                    </div>
                  )}
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
