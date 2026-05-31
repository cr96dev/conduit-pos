// pages/soporte.js
// Admin: ver todas las conversaciones de soporte de los cajeros. Click en
// una para leer el historial completo. Permite marcar como resuelta y
// agregar notas internas.

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

const fmtFecha = (s) => s ? new Date(s).toLocaleString('es-GT') : '—'

export default function SoporteAdmin({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [conversaciones, setConversaciones] = useState([])
  const [seleccionada, setSeleccionada] = useState(null)  // { conversacion, mensajes }
  const [filtroEstado, setFiltroEstado] = useState('')   // '' = todas
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (data?.rol !== 'admin') {
          router.push('/dashboard')
          return
        }
        setPerfil(data)
        cargarLista()
      })
  }, [session])

  async function cargarLista() {
    setCargando(true)
    const url = '/api/admin/soporte' + (filtroEstado ? `?estado=${filtroEstado}` : '')
    const r = await apiFetch(url)
    const j = await r.json()
    setConversaciones(j.conversaciones || [])
    setCargando(false)
  }

  useEffect(() => { if (perfil) cargarLista() }, [filtroEstado])

  async function abrirConversacion(c) {
    const r = await apiFetch(`/api/admin/soporte?id=${c.id}`)
    const j = await r.json()
    if (j.ok) setSeleccionada(j)
  }

  async function cambiarEstado(estado) {
    if (!seleccionada) return
    const r = await apiFetch('/api/soporte/conversacion', {
      method: 'PATCH',
      body: JSON.stringify({ id: seleccionada.conversacion.id, estado }),
    })
    const j = await r.json()
    if (j.ok) {
      setSeleccionada({ ...seleccionada, conversacion: j.conversacion })
      cargarLista()
    }
  }

  const ESTADOS_LABEL = {
    abierta: { txt: 'Abierta',   cls: 'bg-amber-100 text-amber-700' },
    resuelta: { txt: 'Resuelta', cls: 'bg-emerald-100 text-emerald-700' },
    escalada: { txt: 'Escalada', cls: 'bg-red-100 text-red-700' },
    archivada: { txt: 'Archivada', cls: 'bg-gray-100 text-gray-500' },
  }

  if (!perfil) return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">Cargando...</div>

  return (
    <Layout perfil={perfil}>
      <Head><title>Soporte · Julia Bakery</title></Head>

      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Soporte técnico</h1>
            <p className="text-xs text-gray-400">
              Conversaciones de los cajeros con el asistente. Detectá problemas recurrentes
              y resolvelas si requieren intervención manual.
            </p>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {['', 'abierta', 'resuelta', 'escalada', 'archivada'].map(e => (
            <button key={e || 'todas'} onClick={() => setFiltroEstado(e)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full ${
                filtroEstado === e
                  ? 'bg-julia-red text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>
              {e ? ESTADOS_LABEL[e].txt : 'Todas'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[400px_1fr] gap-4">
          {/* Lista */}
          <div className="card-julia overflow-hidden">
            {cargando ? (
              <div className="p-8 text-center text-xs text-gray-400">Cargando...</div>
            ) : conversaciones.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-400">
                Sin conversaciones {filtroEstado && `con estado "${filtroEstado}"`}.
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {conversaciones.map(c => {
                  const est = ESTADOS_LABEL[c.estado] || ESTADOS_LABEL.abierta
                  const activo = seleccionada?.conversacion?.id === c.id
                  return (
                    <button key={c.id} onClick={() => abrirConversacion(c)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${activo ? 'bg-julia-cream/30 border-l-2 border-l-julia-red' : ''}`}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-medium text-gray-900 text-sm leading-tight line-clamp-1">
                          {c.asunto || '(sin asunto)'}
                        </div>
                        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded font-bold flex-shrink-0 ${est.cls}`}>
                          {est.txt}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {c.cajero?.nombre_completo || '—'} · {c.cajero?.rol || ''}
                      </div>
                      <div className="text-[10px] text-gray-400 mt-1">
                        {fmtFecha(c.updated_at)} · {c.num_mensajes} mensajes
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Detalle */}
          <div className="card-julia min-h-[400px] flex flex-col">
            {!seleccionada ? (
              <div className="flex-1 flex items-center justify-center text-xs text-gray-400 p-8 text-center">
                Tocá una conversación para ver el historial completo.
              </div>
            ) : (
              <>
                <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-bold text-gray-900">
                      {seleccionada.conversacion.cajero?.nombre_completo}
                    </div>
                    <div className="text-xs text-gray-500">
                      {seleccionada.conversacion.asunto || '(sin asunto)'}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => cambiarEstado('resuelta')}
                      disabled={seleccionada.conversacion.estado === 'resuelta'}
                      className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 disabled:opacity-40">
                      Marcar resuelta
                    </button>
                    <button onClick={() => cambiarEstado('escalada')}
                      disabled={seleccionada.conversacion.estado === 'escalada'}
                      className="text-xs px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 disabled:opacity-40">
                      Escalar
                    </button>
                    <button onClick={() => cambiarEstado('archivada')}
                      className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                      Archivar
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-gray-50">
                  {seleccionada.mensajes.length === 0 ? (
                    <div className="text-xs text-gray-400 text-center py-8">Sin mensajes.</div>
                  ) : seleccionada.mensajes.map(m => (
                    <div key={m.id}
                      className={`flex ${m.rol === 'user' ? 'justify-end' : m.rol === 'system' ? 'justify-center' : 'justify-start'}`}>
                      {m.rol === 'system' ? (
                        <div className="text-[10px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">
                          ⚠ {m.contenido}
                        </div>
                      ) : (
                        <div className="max-w-[70%]">
                          <div className={`px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                            m.rol === 'user'
                              ? 'bg-julia-red text-white rounded-br-sm'
                              : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
                          }`}>
                            {m.contenido}
                          </div>
                          <div className="text-[10px] text-gray-400 mt-1 px-2">
                            {fmtFecha(m.created_at)}
                            {m.tokens_input && ` · ${m.tokens_input}+${m.tokens_output} tokens`}
                          </div>
                          {/* Mostrar contexto si lo hay (solo en user msgs) */}
                          {m.rol === 'user' && m.contexto && Object.keys(m.contexto).length > 0 && (
                            <details className="mt-1">
                              <summary className="text-[10px] text-gray-400 cursor-pointer">contexto operativo</summary>
                              <pre className="text-[9px] bg-gray-100 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(m.contexto, null, 2)}</pre>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
