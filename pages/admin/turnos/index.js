// pages/admin/turnos/index.js
// /admin/turnos — Lista de todos los turnos (admin)
//
// Filtros: cajero, estado, fecha rango.
// Click en una card -> /admin/turnos/[id] (detalle).

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import Layout from '../../../components/Layout'
import { SkeletonRow } from '../../../components/Skeleton'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const fmtQ = (n) =>
  'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtHora(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  // Guatemala = UTC-6
  const gt = new Date(d.getTime() - 6 * 60 * 60 * 1000)
  return gt.toISOString().slice(11, 16) // HH:MM
}

function fmtFechaGT(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const gt = new Date(d.getTime() - 6 * 60 * 60 * 1000)
  return gt.toISOString().slice(0, 10) // YYYY-MM-DD
}

export default function AdminTurnos({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [turnos, setTurnos] = useState([])
  const [cargando, setCargando] = useState(true)
  const [cajeros, setCajeros] = useState([])
  // filtros
  const [filtroCajero, setFiltroCajero] = useState('')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroFecha, setFiltroFecha] = useState('') // YYYY-MM-DD

  useEffect(() => {
    if (!session) { router.push('/login'); return }
    supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (!data || data.rol !== 'admin') { router.push('/login'); return }
        setPerfil(data)
      })
    cargar()
    apiFetch('/api/admin/cajeros').then(r => r.json()).then(j => setCajeros(j.cajeros || []))
  }, [session])

  function cargar() {
    setCargando(true)
    const params = new URLSearchParams()
    if (filtroCajero) params.set('cajero_id', filtroCajero)
    if (filtroEstado === 'abierto' || filtroEstado === 'cerrado') params.set('estado', filtroEstado)
    params.set('limit', '500')
    apiFetch(`/api/admin/turnos?${params.toString()}`)
      .then(r => r.json())
      .then(j => setTurnos(j.turnos || []))
      .finally(() => setCargando(false))
  }

  useEffect(() => { if (perfil) cargar() }, [filtroCajero, filtroEstado])

  const turnosFiltrados = useMemo(() => {
    if (!filtroFecha) return turnos
    return turnos.filter(t => fmtFechaGT(t.fecha_apertura) === filtroFecha)
  }, [turnos, filtroFecha])

  // Agrupar por fecha
  const porFecha = useMemo(() => {
    const map = new Map()
    for (const t of turnosFiltrados) {
      const f = fmtFechaGT(t.fecha_apertura)
      if (!map.has(f)) map.set(f, [])
      map.get(f).push(t)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [turnosFiltrados])

  return (
    <>
      <Head><title>Turnos · Admin · Julia Bakery</title></Head>
      <Layout perfil={perfil} estacion={estacion}>
        <div className="max-w-6xl mx-auto p-4 md:p-6">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Historial de turnos</h1>
            <p className="text-sm text-gray-500 mt-0.5">Aperturas, cierres y diferencias por cajero</p>
          </div>

          {/* Filtros */}
          <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Cajero</label>
                <select
                  value={filtroCajero}
                  onChange={e => setFiltroCajero(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red focus:ring-2 focus:ring-julia-red/10">
                  <option value="">Todos</option>
                  {cajeros.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre_completo}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Estado</label>
                <select
                  value={filtroEstado}
                  onChange={e => setFiltroEstado(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red focus:ring-2 focus:ring-julia-red/10">
                  <option value="todos">Todos</option>
                  <option value="abierto">Abierto</option>
                  <option value="cerrado">Cerrado</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase mb-1.5">Fecha</label>
                <input
                  type="date"
                  value={filtroFecha}
                  onChange={e => setFiltroFecha(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red focus:ring-2 focus:ring-julia-red/10" />
              </div>
            </div>
            {(filtroCajero || filtroEstado !== 'todos' || filtroFecha) && (
              <button
                onClick={() => { setFiltroCajero(''); setFiltroEstado('todos'); setFiltroFecha('') }}
                className="mt-3 text-xs text-gray-400 hover:text-julia-red underline">
                Limpiar filtros
              </button>
            )}
          </div>

          {/* Lista */}
          {cargando ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <SkeletonRow key={i} />)}
            </div>
          ) : turnosFiltrados.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center text-gray-400">
              No hay turnos que coincidan con los filtros.
            </div>
          ) : (
            <div className="space-y-6">
              {porFecha.map(([fecha, ts]) => (
                <div key={fecha}>
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2 px-1">
                    {fechaLarga(fecha)}
                  </h3>
                  <div className="space-y-2">
                    {ts.map(t => <TurnoCard key={t.id} turno={t} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Layout>
    </>
  )
}

function fechaLarga(yyyyMmDd) {
  if (!yyyyMmDd) return ''
  const [y, m, d] = yyyyMmDd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.toLocaleDateString('es-GT', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

function TurnoCard({ turno }) {
  const cajero = turno.cajero?.nombre_completo || '—'
  const abierto = turno.estado === 'abierto'
  const diferencia = Number(turno.diferencia || 0)
  const tieneDescuadre = Math.abs(diferencia) > 0.01

  return (
    <Link href={`/admin/turnos/${turno.id}`}>
      <div className="bg-white border-2 border-gray-200 hover:border-julia-red/40 rounded-2xl p-4 shadow-sm hover:shadow-md cursor-pointer transition-all">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left: cajero + horas */}
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center gap-2">
              <span className="font-bold text-gray-900">{cajero}</span>
              {abierto ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                  ABIERTO
                </span>
              ) : (
                <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                  CERRADO
                </span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1 tabular-nums">
              {fmtHora(turno.fecha_apertura)} → {fmtHora(turno.fecha_cierre)} GT
            </div>
          </div>

          {/* Center: ventas */}
          <div className="text-right">
            <div className="text-xs text-gray-400 uppercase tracking-wide">Total</div>
            <div className="text-xl font-bold tabular-nums text-gray-900">{fmtQ(turno.ventas_total)}</div>
            <div className="text-xs text-gray-500">{turno.cantidad_facturas} facturas</div>
          </div>

          {/* Right: diferencia */}
          {!abierto && (
            <div className="text-right">
              <div className="text-xs text-gray-400 uppercase tracking-wide">Diferencia</div>
              <div className={`text-lg font-bold tabular-nums ${
                tieneDescuadre ? (diferencia < 0 ? 'text-red-600' : 'text-amber-600') : 'text-emerald-600'
              }`}>
                {tieneDescuadre ? (diferencia > 0 ? '+' : '') + fmtQ(diferencia) : '✓ Cuadra'}
              </div>
            </div>
          )}
        </div>
      </div>
    </Link>
  )
}
