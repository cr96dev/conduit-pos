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
      <div className="min-h-screen bg-gray-50 p-4 md:p-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-semibold text-gray-900">Mis turnos</h1>
              <p className="text-xs text-gray-400">Historial de tus aperturas y cierres de caja</p>
            </div>
            <button onClick={() => router.push('/pos')}
              className="text-xs px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">
              ← Volver al POS
            </button>
          </div>

          {cargando ? (
            <div className="text-sm text-gray-400 py-12 text-center">Cargando...</div>
          ) : turnos.length === 0 ? (
            <div className="bg-white border border-gray-100 rounded-xl py-12 px-6 text-center text-sm text-gray-400">
              No tenés turnos registrados.
            </div>
          ) : (
            <div className="space-y-2">
              {turnos.map(t => (
                <div key={t.id} className="bg-white border border-gray-100 rounded-xl p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-xs text-gray-400">Apertura</div>
                      <div className="text-sm text-gray-800">{new Date(t.fecha_apertura).toLocaleString('es-GT')}</div>
                    </div>
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded ${
                      t.estado === 'abierto'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>{t.estado}</span>
                  </div>
                  {t.estado === 'cerrado' && (
                    <>
                      <div className="text-xs text-gray-400 mb-0.5">Cierre</div>
                      <div className="text-sm text-gray-800 mb-3">{new Date(t.fecha_cierre).toLocaleString('es-GT')}</div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="text-gray-500">Apertura</div>
                        <div className="text-right tabular-nums text-gray-700">{fmtQ(t.monto_apertura)}</div>
                        <div className="text-gray-500">Ventas efectivo</div>
                        <div className="text-right tabular-nums text-gray-700">{fmtQ(t.ventas_efectivo)}</div>
                        <div className="text-gray-500">Esperado</div>
                        <div className="text-right tabular-nums text-gray-700">{fmtQ(t.monto_cierre_esperado)}</div>
                        <div className="text-gray-500">Contado</div>
                        <div className="text-right tabular-nums text-gray-700">{fmtQ(t.conteo_efectivo_cierre)}</div>
                        <div className="text-gray-500 font-medium">Diferencia</div>
                        <div className={`text-right tabular-nums font-semibold ${
                          Number(t.diferencia) === 0 ? 'text-emerald-600'
                          : Number(t.diferencia) > 0 ? 'text-amber-600'
                          : 'text-red-600'
                        }`}>
                          {Number(t.diferencia) > 0 ? '+' : ''}{fmtQ(t.diferencia)}
                        </div>
                      </div>
                    </>
                  )}
                  {t.estado === 'abierto' && (
                    <div className="text-xs text-gray-500">
                      Apertura: <span className="tabular-nums">{fmtQ(t.monto_apertura)}</span>
                    </div>
                  )}
                  {t.observacion_apertura && (
                    <div className="mt-2 text-[11px] text-gray-500 italic">"{t.observacion_apertura}"</div>
                  )}
                  {t.observacion_cierre && (
                    <div className="mt-1 text-[11px] text-gray-500 italic">Cierre: "{t.observacion_cierre}"</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
