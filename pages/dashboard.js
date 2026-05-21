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

// Rango UTC que cubre un dia en hora Guatemala (00:00 GT -> 23:59:59 GT).
function gtDayRange(daysAgo = 0) {
  const ymd = gtDateString(daysAgo)
  return {
    ymd,
    fromUtc: `${ymd}T06:00:00+00:00`,            // 00:00 GT
    toUtc:   `${ymd}T29:59:59.999+00:00`,        // 23:59:59 GT del mismo dia
  }
}

function fmtQ(n) {
  if (n == null) return 'Q 0'
  return 'Q ' + Number(n).toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function BarChart({ data }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data.map(d => d.total), 1)
  return (
    <div className="flex items-end gap-1.5 h-24 w-full">
      {data.map((d, i) => {
        const pct = (d.total / max) * 100
        const isToday = i === data.length - 1
        return (
          <div key={d.ymd} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10">
              {fmtQ(d.total)}
            </div>
            <div className="w-full rounded-t-md transition-all duration-500"
              style={{
                height: `${Math.max(pct, 4)}%`,
                background: isToday ? '#B45309' : '#FCD9A8',
                minHeight: '4px'
              }} />
            <span className="text-xs text-gray-400">{d.dia}</span>
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
      .lte('receipt_date', hoy.toUtc)

    const hoyTotal = (hoyRows || []).reduce((s, r) => s + Number(r.total_money || 0), 0)

    // Ventas ayer
    const { data: ayerRows } = await supabase
      .from('loyverse_receipts')
      .select('total_money')
      .eq('receipt_type', 'SALE')
      .gte('receipt_date', ayer.fromUtc)
      .lte('receipt_date', ayer.toUtc)

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
      .lte('receipt_date', fin)

    const labelDia = ['Dom','Lun','Mar','Mie','Jue','Vie','Sab']
    const graficaData = dias.map(d => {
      const total = (semanaRows || [])
        .filter(r => r.receipt_date >= d.fromUtc && r.receipt_date <= d.toUtc)
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
      .lte('loyverse_receipts.receipt_date', hoy.toUtc)

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
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Hola</h1>
            <p className="text-xs text-gray-400">{new Date().toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
          {syncState && (
            <div className="text-xs text-gray-400">
              Sync: <span className={syncState.last_status === 'ok' ? 'text-green-600' : 'text-amber-600'}>{syncState.last_status}</span>
              {syncState.last_synced_at && (
                <span> · {new Date(syncState.last_synced_at).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}</span>
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
              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="text-xs text-gray-400 mb-2">Ventas hoy</div>
                <div className="text-2xl font-semibold text-gray-900 mb-1">{fmtQ(stats.hoyTotal)}</div>
                <div className="text-xs text-gray-400">{stats.hoyCount} recibos</div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="text-xs text-gray-400 mb-2">vs ayer</div>
                <div className="text-2xl font-semibold text-gray-900 mb-1">{fmtQ(stats.ayerTotal)}</div>
                <div className={`text-xs ${variacion == null ? 'text-gray-400' : variacion >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {variacion == null ? 'sin datos comparativos' : `${variacion >= 0 ? '+' : ''}${variacion}%`}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-100 p-4">
                <div className="text-xs text-gray-400 mb-2">Promedio recibo hoy</div>
                <div className="text-2xl font-semibold text-gray-900 mb-1">
                  {fmtQ(stats.hoyCount > 0 ? stats.hoyTotal / stats.hoyCount : 0)}
                </div>
                <div className="text-xs text-gray-400">basado en recibos de hoy</div>
              </div>
            </>
          )}
        </div>

        {/* Grafica 7 dias */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-medium text-gray-700">Ultimos 7 dias</h2>
            <span className="text-xs text-gray-400">total {fmtQ(grafica.reduce((s,d) => s + d.total, 0))}</span>
          </div>
          {loading ? <div className="h-24 bg-gray-100 rounded animate-pulse"></div> : <BarChart data={grafica} />}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top productos */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="text-sm font-medium text-gray-700 mb-3">Top productos hoy</h2>
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse"></div>)}
              </div>
            ) : topItems.length === 0 ? (
              <p className="text-xs text-gray-400">Sin ventas hoy todavia.</p>
            ) : (
              <div className="space-y-2">
                {topItems.map((it, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <div className="truncate text-gray-700">
                      <span className="text-gray-400 mr-2">{i + 1}.</span>{it.name}
                    </div>
                    <div className="flex items-baseline gap-3 flex-shrink-0">
                      <span className="text-xs text-gray-400">×{it.qty}</span>
                      <span className="text-gray-700">{fmtQ(it.money)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Ultimos recibos */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="text-sm font-medium text-gray-700 mb-3">Ultimos recibos</h2>
            {loading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-100 rounded animate-pulse"></div>)}
              </div>
            ) : ultimos.length === 0 ? (
              <p className="text-xs text-gray-400">Sin recibos aun.</p>
            ) : (
              <div className="space-y-2">
                {ultimos.map(r => (
                  <div key={r.loyverse_id} className="flex items-center justify-between text-sm">
                    <div className="truncate text-gray-700">
                      <span className="text-gray-400 mr-2">{r.receipt_number}</span>
                      {r.receipt_type === 'REFUND' && <span className="text-xs text-red-500 mr-1">[devol]</span>}
                      <span className="text-xs text-gray-400">
                        {new Date(r.receipt_date).toLocaleString('es-GT', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                      </span>
                    </div>
                    <span className={`text-sm ${r.receipt_type === 'REFUND' ? 'text-red-600' : 'text-gray-700'}`}>
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
