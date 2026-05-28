// pages/cerrar-caja.js
// Muestra desglose del turno (apertura + ventas) y pide conteo fisico.
// Calcula diferencia en vivo y permite confirmar el cierre.

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

export default function CerrarCaja({ session }) {
  const router = useRouter()
  const [data, setData] = useState(null)
  const [conteo, setConteo] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState(null)

  useEffect(() => {
    if (!session) { router.push('/cajero-login'); return }
    cargar()
  }, [session])

  async function cargar() {
    const r = await apiFetch('/api/turnos/actual')
    const j = await r.json()
    if (!j.turno) {
      // No hay turno abierto — ir al login de apertura
      router.replace('/abrir-caja')
      return
    }
    setData(j)
  }

  const esperado = data?.esperado ?? 0
  const apertura = Number(data?.turno?.monto_apertura) || 0
  const ventasEf = Number(data?.desglose?.ventas_efectivo) || 0
  const conteoNum = Number(conteo)
  const diferencia = Number.isFinite(conteoNum) ? Math.round((conteoNum - esperado) * 100) / 100 : null

  async function confirmar() {
    setError('')
    if (!Number.isFinite(conteoNum) || conteoNum < 0) {
      setError('Ingresá el monto contado (>= 0)')
      return
    }
    setEnviando(true)
    const r = await apiFetch('/api/turnos/cerrar', {
      method: 'POST',
      body: JSON.stringify({ conteo_efectivo_cierre: conteoNum, observacion_cierre: obs }),
    })
    const j = await r.json()
    setEnviando(false)
    if (!r.ok) { setError(j.error || 'Error cerrando caja'); return }
    setResultado(j.turno)
  }

  async function salir() {
    await supabase.auth.signOut()
    router.push('/cajero-login')
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400 text-sm">
        Cargando...
      </div>
    )
  }

  if (resultado) {
    const dif = Number(resultado.diferencia)
    return (
      <>
        <Head><title>Caja cerrada · Julia Bakery</title></Head>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 w-full max-w-sm text-center">
            <div className="text-5xl mb-3">✓</div>
            <h1 className="text-xl font-semibold text-emerald-700 mb-1">Caja cerrada</h1>
            <p className="text-xs text-gray-400 mb-5">El turno ha sido cerrado correctamente.</p>

            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-2 text-left mb-5">
              <Row k="Apertura" v={fmtQ(resultado.monto_apertura)} />
              <Row k="Ventas efectivo" v={fmtQ(resultado.ventas_efectivo)} />
              <Row k="Esperado" v={fmtQ(resultado.monto_cierre_esperado)} />
              <Row k="Contado" v={fmtQ(resultado.conteo_efectivo_cierre)} />
              <hr className="border-gray-200" />
              <Row k="Diferencia" v={
                <span className={`font-semibold ${
                  dif === 0 ? 'text-emerald-600' : dif > 0 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {dif > 0 ? '+' : ''}{fmtQ(dif)}
                </span>
              } />
            </div>

            <button onClick={salir}
              className="w-full py-3 bg-julia-red text-white font-medium rounded-lg hover:bg-red-700">
              Salir
            </button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Head><title>Cerrar caja · Julia Bakery</title></Head>
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 w-full max-w-md">
          <h1 className="text-lg font-semibold text-gray-900 mb-1">Cerrar caja</h1>
          <p className="text-xs text-gray-400 mb-5">
            Abierto: {new Date(data.turno.fecha_apertura).toLocaleString('es-GT')}
          </p>

          {/* Desglose */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-2 mb-5">
            <Row k="Apertura" v={fmtQ(apertura)} />
            <Row k="Ventas efectivo" v={fmtQ(ventasEf)} />
            <Row k="Ventas tarjeta" v={fmtQ(data.desglose.ventas_tarjeta)} muted />
            <Row k="Ventas transferencia" v={fmtQ(data.desglose.ventas_transferencia)} muted />
            <Row k="Ventas Pedidos Ya" v={fmtQ(data.desglose.ventas_pedidos_ya)} muted />
            <Row k="Ventas otro" v={fmtQ(data.desglose.ventas_otro)} muted />
            <hr className="border-gray-200" />
            <Row k="Esperado en caja" v={<span className="font-semibold tabular-nums">{fmtQ(esperado)}</span>} />
            <div className="text-[10px] text-gray-400 pt-1">
              Esperado = apertura + ventas en efectivo. Las ventas con tarjeta/transferencia
              no afectan el efectivo de la caja.
            </div>
          </div>

          {/* Conteo */}
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Efectivo contado en caja</label>
            <input type="number" step="any" min="0" value={conteo} onChange={e => setConteo(e.target.value)}
              inputMode="decimal" autoFocus
              className="w-full text-2xl text-right tabular-nums px-3 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red"
              placeholder="0.00" />
          </div>

          {/* Diferencia en vivo */}
          {diferencia !== null && (
            <div className={`rounded-lg px-3 py-2 mb-3 text-sm flex justify-between ${
              diferencia === 0 ? 'bg-emerald-50 text-emerald-700' :
              diferencia > 0   ? 'bg-amber-50 text-amber-700' :
                                 'bg-red-50 text-red-700'
            }`}>
              <span>Diferencia</span>
              <span className="font-semibold tabular-nums">
                {diferencia > 0 ? '+' : ''}{fmtQ(diferencia)}
              </span>
            </div>
          )}

          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Observación (opcional)</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red"
              placeholder={diferencia !== null && diferencia !== 0 ? 'Explicá la diferencia...' : ''} />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{error}</div>
          )}

          <div className="flex gap-2">
            <button onClick={() => router.push('/pos')}
              className="flex-1 py-3 border border-gray-200 text-sm text-gray-700 rounded-lg hover:bg-gray-50">
              Cancelar
            </button>
            <button onClick={confirmar} disabled={enviando || conteo === ''}
              className="flex-1 py-3 bg-julia-red text-white font-medium rounded-lg disabled:opacity-50 hover:bg-red-700">
              {enviando ? 'Cerrando...' : 'Confirmar cierre'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function Row({ k, v, muted }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className={muted ? 'text-gray-400' : 'text-gray-600'}>{k}</span>
      <span className={`tabular-nums ${muted ? 'text-gray-400' : 'text-gray-800'}`}>{v}</span>
    </div>
  )
}
