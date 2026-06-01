// pages/admin/turnos/[id].js
// /admin/turnos/[id] — Detalle de un turno
//
// Muestra:
//   - Header con cajero, horas, estado
//   - 4 cards: total, efectivo, tarjeta, diferencia
//   - Desglose de ventas por método (snapshot del turno vs live recalculado)
//   - Lista de facturas certificadas + anuladas del turno
//   - Observaciones de cierre

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import Layout from '../../../components/Layout'
import { SkeletonCard } from '../../../components/Skeleton'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const fmtQ = (n) =>
  'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtFechaHoraGT(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('es-GT', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/Guatemala',
  })
}

function fmtHoraGT(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-GT', {
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'America/Guatemala',
  })
}

const LABELS_METODO = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  pedidos_ya: 'Pedidos Ya',
  mixto: 'Mixto (split)',
  otro: 'Otro',
}

export default function TurnoDetalle({ session }) {
  const router = useRouter()
  const { id } = router.query
  const [perfil, setPerfil] = useState(null)
  const [data, setData] = useState(null)
  const [cargando, setCargando] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (!data || data.rol !== 'admin') { router.push('/'); return }
        setPerfil(data)
      })
  }, [session])

  useEffect(() => {
    if (!id) return
    setCargando(true)
    apiFetch(`/api/admin/turnos/${id}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) { setErr(j.error); return }
        setData(j)
      })
      .finally(() => setCargando(false))
  }, [id])

  if (cargando) {
    return (
      <Layout perfil={perfil}>
        <div className="max-w-6xl mx-auto p-4 md:p-6">
          <SkeletonCard />
        </div>
      </Layout>
    )
  }

  if (err) {
    return (
      <Layout perfil={perfil}>
        <div className="max-w-6xl mx-auto p-4 md:p-6">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-700">{err}</div>
        </div>
      </Layout>
    )
  }

  if (!data) return null

  const { turno, facturas, agregados_live } = data
  const cajero = turno.cajero?.nombre_completo || '—'
  const abierto = turno.estado === 'abierto'
  const diferencia = Number(turno.diferencia || 0)
  const tieneDescuadre = Math.abs(diferencia) > 0.01

  // Métodos: union de snapshot turno + agregados live
  const metodosSnapshot = {
    efectivo: Number(turno.ventas_efectivo || 0),
    tarjeta: Number(turno.ventas_tarjeta || 0),
    transferencia: Number(turno.ventas_transferencia || 0),
    pedidos_ya: Number(turno.ventas_pedidos_ya || 0),
    otro: Number(turno.ventas_otro || 0),
  }

  return (
    <>
      <Head><title>Turno {cajero} · Julia Bakery</title></Head>
      <Layout perfil={perfil}>
        <div className="max-w-6xl mx-auto p-4 md:p-6">
          {/* Breadcrumb */}
          <div className="mb-4">
            <Link href="/admin/turnos" className="text-sm text-gray-500 hover:text-julia-red flex items-center gap-1">
              ← Volver al historial
            </Link>
          </div>

          {/* Header */}
          <div className="bg-white border-2 border-gray-200 rounded-2xl p-5 mb-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-2xl font-bold text-gray-900">{cajero}</h1>
                  {abierto ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                      TURNO ABIERTO
                    </span>
                  ) : (
                    <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">
                      CERRADO
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-500">{turno.cajero?.email || ''}</div>
                <div className="text-sm text-gray-700 mt-2 space-y-0.5">
                  <div><span className="font-semibold">Apertura:</span> {fmtFechaHoraGT(turno.fecha_apertura)} GT</div>
                  {turno.fecha_cierre && (
                    <div><span className="font-semibold">Cierre:</span> {fmtFechaHoraGT(turno.fecha_cierre)} GT</div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase tracking-wider text-gray-400 font-bold mb-1">Monto apertura</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">{fmtQ(turno.monto_apertura)}</div>
              </div>
            </div>
          </div>

          {/* 4 Cards de resumen */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard
              label="Ventas total"
              valor={fmtQ(agregados_live.total_certificado)}
              sub={`${agregados_live.cantidad_certificadas} facturas`} />
            <StatCard
              label="Efectivo"
              valor={fmtQ(metodosSnapshot.efectivo)}
              sub="Snapshot del turno" />
            <StatCard
              label="Tarjeta"
              valor={fmtQ(metodosSnapshot.tarjeta)}
              sub="Snapshot del turno" />
            {!abierto && (
              <StatCard
                label="Diferencia caja"
                valor={tieneDescuadre ? (diferencia > 0 ? '+' : '') + fmtQ(diferencia) : '✓ Q 0.00'}
                sub={tieneDescuadre ? '⚠ revisar' : 'Cuadra'}
                color={tieneDescuadre ? (diferencia < 0 ? 'red' : 'amber') : 'green'} />
            )}
            {abierto && (
              <StatCard label="Anuladas" valor={agregados_live.cantidad_anuladas} sub={fmtQ(agregados_live.total_anulado)} />
            )}
          </div>

          {/* Desglose por método (live recalculado vs snapshot) */}
          <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-sm">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
              Ventas por método de pago
            </h2>
            <div className="space-y-2">
              {Object.entries(LABELS_METODO).map(([k, label]) => {
                const snap = metodosSnapshot[k] || 0
                const live = agregados_live.por_metodo_pago[k] || 0
                if (snap === 0 && live === 0) return null
                const diff = live - snap
                return (
                  <div key={k} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <span className="text-sm font-medium text-gray-700">{label}</span>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Snapshot</div>
                        <div className="text-sm font-semibold tabular-nums">{fmtQ(snap)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">Live recalc</div>
                        <div className={`text-sm font-bold tabular-nums ${Math.abs(diff) > 0.01 ? 'text-amber-700' : 'text-gray-900'}`}>
                          {fmtQ(live)}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            {Math.abs(agregados_live.total_certificado - Number(turno.ventas_total || 0)) > 0.01 && (
              <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                ⚠ Live recalculado ≠ snapshot del turno. Cambios posteriores (anulaciones / reclasificaciones) reflejados en live.
              </div>
            )}
          </div>

          {/* Cierre details (si cerrado) */}
          {!abierto && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6 shadow-sm">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">Cuadre de caja</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Field label="Monto apertura" v={fmtQ(turno.monto_apertura)} />
                <Field label="+ Ventas efectivo" v={fmtQ(turno.ventas_efectivo)} />
                <Field label="= Esperado" v={fmtQ(turno.monto_cierre_esperado)} />
                <Field label="Conteo físico" v={fmtQ(turno.conteo_efectivo_cierre)} />
              </div>
              {turno.observacion_cierre && (
                <div className="mt-4 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                  <div className="text-xs font-bold text-gray-400 uppercase mb-1">Observación</div>
                  {turno.observacion_cierre}
                </div>
              )}
            </div>
          )}

          {/* Lista de facturas */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-5 border-b border-gray-100">
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">
                Facturas del turno ({facturas.length})
              </h2>
            </div>
            {facturas.length === 0 ? (
              <div className="p-8 text-center text-gray-400">Aún no hay facturas en este turno.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {facturas.map(f => <FacturaRow key={f.id} f={f} />)}
              </div>
            )}
          </div>
        </div>
      </Layout>
    </>
  )
}

function StatCard({ label, valor, sub, color = 'gray' }) {
  const colorMap = {
    gray: 'border-gray-200 bg-white',
    red: 'border-red-200 bg-red-50',
    amber: 'border-amber-200 bg-amber-50',
    green: 'border-emerald-200 bg-emerald-50',
  }
  const textColor = {
    gray: 'text-gray-900',
    red: 'text-red-700',
    amber: 'text-amber-700',
    green: 'text-emerald-700',
  }
  return (
    <div className={`border-2 rounded-2xl p-4 shadow-sm ${colorMap[color]}`}>
      <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">{label}</div>
      <div className={`text-2xl font-bold tabular-nums mt-1 ${textColor[color]}`}>{valor}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function Field({ label, v }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-gray-400 font-bold">{label}</div>
      <div className="text-base font-semibold tabular-nums text-gray-900 mt-0.5">{v}</div>
    </div>
  )
}

function FacturaRow({ f }) {
  const certificada = f.estado === 'certificada'
  return (
    <div className="px-5 py-3 hover:bg-gray-50 transition-colors flex items-center gap-4">
      <div className="text-xs font-mono text-gray-500 tabular-nums w-16">{fmtHoraGT(f.fecha_emision)}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{f.receptor_nombre}</div>
        <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
          <span className="font-mono">{f.serie_sat}-{f.numero_sat}</span>
          <span>·</span>
          <span className="capitalize">{f.metodo_pago}</span>
          {f.receptor_nit !== 'CF' && (<>
            <span>·</span>
            <span className="font-mono">NIT {f.receptor_nit}</span>
          </>)}
        </div>
        {!certificada && f.motivo_anulacion && (
          <div className="text-xs text-red-600 mt-0.5">⨯ {f.motivo_anulacion}</div>
        )}
      </div>
      <div className="text-right">
        <div className={`text-base font-bold tabular-nums ${certificada ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
          {fmtQ(f.total)}
        </div>
        {certificada ? (
          <div className="text-xs text-emerald-700 font-semibold">✓ certificada</div>
        ) : (
          <div className="text-xs text-red-600 font-semibold">⨯ anulada</div>
        )}
      </div>
    </div>
  )
}
