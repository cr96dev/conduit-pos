// pages/mis-turnos.js
// Historial de turnos del cajero actual.

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

const fmtQ = (n) => 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function MisTurnos({ session }) {
  const router = useRouter()
  const [turnos, setTurnos] = useState([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (!session) { router.push('/cajero-login'); return }
    apiFetch('/api/turnos/mis-turnos?limit=100').then(r => r.json()).then(j => {
      setTurnos(j.turnos || [])
      setCargando(false)
    })
  }, [session])

  return (
    <>
      <Head><title>Mis turnos · Julia Bakery</title></Head>
      <div className="min-h-screen bg-surface-2 p-4 md:p-8">
        <div className="max-w-3xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-gray-900 leading-tight">Mis turnos</h1>
              <p className="text-sm text-ink-subtle leading-tight mt-0.5">Historial de aperturas y cierres de caja</p>
            </div>
            <button onClick={() => router.push('/pos')} className="btn-secundario">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Volver al POS
            </button>
          </div>

          {cargando ? (
            <div className="card-julia p-10 text-center text-sm text-ink-subtle">Cargando...</div>
          ) : turnos.length === 0 ? (
            <div className="card-julia p-10 text-center">
              <div className="text-3xl mb-2 opacity-40">🗒</div>
              <div className="text-sm font-semibold text-gray-700">No tenés turnos registrados</div>
              <div className="text-xs text-ink-subtle mt-1">Cuando abras y cierres caja, aparecen acá.</div>
            </div>
          ) : (
            <div className="space-y-3">
              {turnos.map(t => {
                const dif = Number(t.diferencia)
                const difColor = dif === 0 ? 'var(--success)' : dif > 0 ? 'var(--warning)' : 'var(--danger)'
                return (
                  <div key={t.id} className="card-julia p-4 md:p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0 flex-1">
                        <div className="label-tech mb-1">Apertura</div>
                        <div className="text-sm font-mono text-gray-900">{new Date(t.fecha_apertura).toLocaleString('es-GT')}</div>
                      </div>
                      <span className={`badge ${
                        t.estado === 'abierto' ? 'badge-success' : 'badge-neutral'
                      }`}>
                        {t.estado}
                      </span>
                    </div>

                    {t.estado === 'cerrado' && (
                      <>
                        <div className="mb-3">
                          <div className="label-tech mb-1">Cierre</div>
                          <div className="text-sm font-mono text-gray-900">{new Date(t.fecha_cierre).toLocaleString('es-GT')}</div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm pt-3 border-t border-gray-100">
                          <div className="text-gray-600">Apertura</div>
                          <div className="text-right font-mono tabular-nums text-gray-900">{fmtQ(t.monto_apertura)}</div>
                          <div className="text-gray-600">Ventas efectivo</div>
                          <div className="text-right font-mono tabular-nums text-gray-900">{fmtQ(t.ventas_efectivo)}</div>
                          <div className="text-gray-600">Esperado</div>
                          <div className="text-right font-mono tabular-nums text-gray-900">{fmtQ(t.monto_cierre_esperado)}</div>
                          <div className="text-gray-600">Contado</div>
                          <div className="text-right font-mono tabular-nums text-gray-900">{fmtQ(t.conteo_efectivo_cierre)}</div>
                          <div className="font-semibold text-gray-900 pt-1 border-t border-gray-100">Diferencia</div>
                          <div className="text-right font-bold font-mono tabular-nums pt-1 border-t border-gray-100"
                            style={{ color: difColor }}>
                            {dif > 0 ? '+' : ''}{fmtQ(dif)}
                          </div>
                        </div>
                      </>
                    )}
                    {t.estado === 'abierto' && (
                      <div className="text-sm text-gray-600">
                        Apertura: <span className="font-mono tabular-nums font-semibold text-gray-900">{fmtQ(t.monto_apertura)}</span>
                      </div>
                    )}
                    {t.observacion_apertura && (
                      <div className="mt-3 text-sm text-ink-muted italic bg-surface-2 rounded-lg px-3 py-2">
                        “{t.observacion_apertura}”
                      </div>
                    )}
                    {t.observacion_cierre && (
                      <div className="mt-2 text-sm text-ink-muted italic bg-surface-2 rounded-lg px-3 py-2">
                        <span className="label-tech mr-1">Cierre:</span>
                        “{t.observacion_cierre}”
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
