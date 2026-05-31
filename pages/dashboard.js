import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonCard } from '../components/Skeleton'

// Hora Guatemala: UTC-6 sin DST.
function gtDateString(daysAgo = 0) {
  const now = new Date()
  const gtMs = now.getTime() - 6 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000
  return new Date(gtMs).toISOString().slice(0, 10) // YYYY-MM-DD
}

// Rango UTC que cubre un dia en hora Guatemala (00:00 GT -> proximo dia 00:00 GT).
// 00:00 GT == 06:00:00 UTC del mismo dia. 24h despues == 06:00:00 UTC del dia siguiente.
function gtDayRange(daysAgo = 0) {
  const ymd     = gtDateString(daysAgo)
  const ymdNext = gtDateString(daysAgo - 1) // dia siguiente en GT
  return {
    ymd,
    fromUtc: `${ymd}T06:00:00.000+00:00`,
    toUtc:   `${ymdNext}T06:00:00.000+00:00`, // exclusivo: usar con < no <=
  }
}

function fmtQ(n) {
  if (n == null) return 'Q 0.00'
  return 'Q ' + Number(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function BarChart({ data }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data.map(d => d.total), 1)
  const BAR_AREA_PX = 100
  return (
    <div className="flex gap-2 w-full h-32 items-stretch">
      {data.map((d, i) => {
        const pct = (d.total / max)
        const heightPx = Math.max(Math.round(pct * BAR_AREA_PX), 4)
        const isToday = i === data.length - 1
        return (
          <div key={d.ymd} className="flex-1 flex flex-col justify-end items-center gap-1.5 group relative">
            <div className="absolute -top-9 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-2xs font-mono px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none shadow-pop">
              {fmtQ(d.total)}
            </div>
            <div className={`w-full rounded-t-md transition-all duration-500 ease-out-soft ${
              isToday ? '' : 'opacity-90 group-hover:opacity-100'
            }`}
              style={{
                height: `${heightPx}px`,
                background: isToday ? 'var(--julia-red)' : 'var(--julia-cream)',
              }} />
            <span className="text-2xs font-mono text-ink-subtle leading-none uppercase">{d.dia}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function Dashboard({ session }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ hoyTotal: 0, hoyCount: 0, ayerTotal: 0 })
  const [grafica, setGrafica] = useState([])
  const [topItems, setTopItems] = useState([])
  const [ultimos, setUltimos] = useState([])
  const [syncState, setSyncState] = useState(null)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    loadData()
  }, [session])

  async function loadData() {
    setLoading(true)
    const hoy = gtDayRange(0)
    const ayer = gtDayRange(1)

    // Ventas hoy
    const { data: hoyRows } = await supabase
      .from('loyverse_receipts')
      .select('total_money')
      .eq('receipt_type', 'SALE')
      .gte('receipt_date', hoy.fromUtc)
      .lt('receipt_date', hoy.toUtc)

    const hoyTotal = (hoyRows || []).reduce((s, r) => s + Number(r.total_money || 0), 0)

    // Ventas ayer
    const { data: ayerRows } = await supabase
      .from('loyverse_receipts')
      .select('total_money')
      .eq('receipt_type', 'SALE')
      .gte('receipt_date', ayer.fromUtc)
      .lt('receipt_date', ayer.toUtc)

    const ayerTotal = (ayerRows || []).reduce((s, r) => s + Number(r.total_money || 0), 0)

    setStats({ hoyTotal, hoyCount: hoyRows?.length || 0, ayerTotal })

    // Grafica 7 dias
    const dias = []
    for (let i = 6; i >= 0; i--) dias.push(gtDayRange(i))

    const inicio = dias[0].fromUtc
    const fin = dias[dias.length - 1].toUtc
    const { data: semanaRows } = await supabase
      .from('loyverse_receipts')
      .select('receipt_date, total_money')
      .eq('receipt_type', 'SALE')
      .gte('receipt_date', inicio)
      .lt('receipt_date', fin)

    const labelDia = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb']
    const graficaData = dias.map(d => {
      const total = (semanaRows || [])
        .filter(r => r.receipt_date >= d.fromUtc && r.receipt_date < d.toUtc)
        .reduce((s, r) => s + Number(r.total_money || 0), 0)
      return {
        ymd: d.ymd,
        dia: labelDia[new Date(d.fromUtc).getUTCDay()],
        total,
      }
    })
    setGrafica(graficaData)

    // Top items hoy
    const { data: lineas } = await supabase
      .from('loyverse_receipt_line_items')
      .select('item_name, variant_name, quantity, total_money, receipt_id, loyverse_receipts!inner(receipt_date, receipt_type)')
      .eq('loyverse_receipts.receipt_type', 'SALE')
      .gte('loyverse_receipts.receipt_date', hoy.fromUtc)
      .lt('loyverse_receipts.receipt_date', hoy.toUtc)

    const acumulado = new Map()
    for (const l of lineas || []) {
      const key = l.item_name || '—'
      const prev = acumulado.get(key) || { name: key, qty: 0, money: 0 }
      prev.qty += Number(l.quantity || 0)
      prev.money += Number(l.total_money || 0)
      acumulado.set(key, prev)
    }
    setTopItems([...acumulado.values()].sort((a,b) => b.money - a.money).slice(0, 5))

    // Ultimos 10 recibos
    const { data: ult } = await supabase
      .from('loyverse_receipts')
      .select('loyverse_id, receipt_number, receipt_type, total_money, receipt_date, employee_id')
      .order('receipt_date', { ascending: false })
      .limit(10)
    setUltimos(ult || [])

    // Estado del sync
    const { data: ss } = await supabase
      .from('loyverse_sync_state')
      .select('resource, last_status, last_synced_at')
      .eq('resource', 'receipts')
      .maybeSingle()
    setSyncState(ss)

    setLoading(false)
  }

  const perfil = { email: session?.user?.email }
  const variacion = stats.ayerTotal > 0
    ? Math.round(((stats.hoyTotal - stats.ayerTotal) / stats.ayerTotal) * 100)
    : null

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 leading-tight">Inicio</h1>
            <p className="text-sm text-ink-subtle mt-0.5 capitalize">{new Date().toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
          {syncState && (
            <div className="flex items-center gap-2 text-2xs font-mono">
              <span className="label-tech">Sync</span>
              <span className={`badge ${syncState.last_status === 'ok' ? 'badge-success' : 'badge-warning'}`}>
                {syncState.last_status}
              </span>
              {syncState.last_synced_at && (
                <span className="text-ink-subtle">
                  {new Date(syncState.last_synced_at).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {loading ? (
            <>
              <SkeletonCard /><SkeletonCard /><SkeletonCard />
            </>
          ) : (
            <>
              <div className="card-julia p-5">
                <div className="label-tech mb-2">Ventas hoy</div>
                <div className="text-3xl font-bold text-gray-900 font-mono tabular-nums leading-none">{fmtQ(stats.hoyTotal)}</div>
                <div className="text-xs text-ink-subtle mt-2 font-medium">{stats.hoyCount} recibos</div>
              </div>

              <div className="card-julia p-5">
                <div className="label-tech mb-2">vs ayer</div>
                <div className="text-3xl font-bold text-gray-900 font-mono tabular-nums leading-none">{fmtQ(stats.ayerTotal)}</div>
                {variacion == null ? (
                  <div className="text-xs text-ink-subtle mt-2 font-medium">sin datos comparativos</div>
                ) : (
                  <div className="mt-2">
                    <span className={`badge ${variacion >= 0 ? 'badge-success' : 'badge-danger'}`}>
                      {variacion >= 0 ? '↑' : '↓'} {Math.abs(variacion)}%
                    </span>
                  </div>
                )}
              </div>

              <div className="card-julia p-5">
                <div className="label-tech mb-2">Promedio por recibo</div>
                <div className="text-3xl font-bold text-gray-900 font-mono tabular-nums leading-none">
                  {fmtQ(stats.hoyCount > 0 ? stats.hoyTotal / stats.hoyCount : 0)}
                </div>
                <div className="text-xs text-ink-subtle mt-2 font-medium">basado en recibos de hoy</div>
              </div>
            </>
          )}
        </div>

        {/* Grafica 7 dias */}
        <div className="card-julia p-5 md:p-6 mb-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">Últimos 7 días</h2>
            <div className="flex items-baseline gap-2">
              <span className="label-tech">Total</span>
              <span className="text-sm font-mono font-bold text-gray-900 tabular-nums">{fmtQ(grafica.reduce((s,d) => s + d.total, 0))}</span>
            </div>
          </div>
          {loading ? <div className="shimmer h-32 rounded-lg" /> : <BarChart data={grafica} />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top productos */}
          <div className="card-julia p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Top productos hoy</h2>
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="shimmer h-8 rounded"></div>)}
              </div>
            ) : topItems.length === 0 ? (
              <p className="text-sm text-ink-subtle py-4 text-center">Sin ventas hoy todavía.</p>
            ) : (
              <div className="space-y-2.5">
                {topItems.map((it, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1.5">
                    <div className="truncate flex items-center gap-2">
                      <span className="text-2xs font-mono font-bold text-ink-subtle w-5">{(i + 1).toString().padStart(2, '0')}</span>
                      <span className="text-gray-800 font-medium truncate">{it.name}</span>
                    </div>
                    <div className="flex items-baseline gap-3 flex-shrink-0">
                      <span className="text-xs font-mono text-ink-subtle">×{it.qty}</span>
                      <span className="font-mono tabular-nums font-semibold text-gray-900">{fmtQ(it.money)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Últimos recibos */}
          <div className="card-julia p-5">
            <h2 className="text-sm font-bold text-gray-900 mb-4">Últimos recibos</h2>
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="shimmer h-8 rounded"></div>)}
              </div>
            ) : ultimos.length === 0 ? (
              <p className="text-sm text-ink-subtle py-4 text-center">Sin recibos aún.</p>
            ) : (
              <div className="space-y-2.5">
                {ultimos.map(r => (
                  <div key={r.loyverse_id} className="flex items-center justify-between text-sm py-1.5">
                    <div className="truncate flex items-center gap-2 min-w-0">
                      <span className="font-mono text-2xs text-ink-subtle font-medium">{r.receipt_number}</span>
                      {r.receipt_type === 'REFUND' && <span className="badge badge-danger">devol</span>}
                      <span className="text-xs text-ink-subtle truncate">
                        {new Date(r.receipt_date).toLocaleString('es-GT', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                      </span>
                    </div>
                    <span className={`font-mono tabular-nums font-semibold ${r.receipt_type === 'REFUND' ? 'text-red-600' : 'text-gray-900'}`}>
                      {fmtQ(r.total_money)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
