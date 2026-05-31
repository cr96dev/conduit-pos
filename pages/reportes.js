import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'

// ============================================================================
// Helpers
// ============================================================================

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const fmtNum = (n, d = 0) => Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: d, maximumFractionDigits: d })
const fmtQ   = (n) => 'Q ' + fmtNum(n, 2)
const fmtPct = (n) => n == null ? '—' : fmtNum(n, 2) + '%'
const hoyGT  = () => new Date(Date.now() - 6*3600_000).toISOString().slice(0, 10)

function inicioMes()    { const h = hoyGT().split('-'); return `${h[0]}-${h[1]}-01` }
function inicioMesPrev(){ const [y, m] = hoyGT().split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 10) }
function finMesPrev()   { const [y, m] = hoyGT().split('-').map(Number); const d = new Date(Date.UTC(y, m - 1, 0)); return d.toISOString().slice(0, 10) }
function inicioAnio()   { return hoyGT().slice(0, 4) + '-01-01' }
function hace30dias()   { return new Date(Date.now() - 30*86_400_000 - 6*3600_000).toISOString().slice(0, 10) }

function formatFecha(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function descargarExcel(filename, sheets) {
  const XLSX = await import('xlsx')   // lazy: solo cuando se clickea Export
  const wb = XLSX.utils.book_new()
  for (const { name, data } of sheets) {
    if (!data || data.length === 0) continue
    const ws = XLSX.utils.json_to_sheet(data)
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

// ============================================================================
// Pagina
// ============================================================================

export default function Reportes({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [tab, setTab] = useState('dashboard')

  // Rango con default = mes actual
  const [desde, setDesde] = useState(inicioMes())
  const [hasta, setHasta] = useState(hoyGT())

  // Drill-down: cuenta seleccionada para abrir movimientos en un modal.
  // null = cerrado. Objeto = { id, codigo, nombre }.
  const [drillCuenta, setDrillCuenta] = useState(null)
  const onDrillCuenta = (c) => setDrillCuenta(c)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, email, nombre_completo, rol, activo').eq('id', session.user.id).single()
      .then(({ data }) => setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' }))
  }, [session])

  function setPreset(p) {
    if (p === 'mes')     { setDesde(inicioMes());      setHasta(hoyGT()) }
    if (p === 'prev')    { setDesde(inicioMesPrev());  setHasta(finMesPrev()) }
    if (p === '30d')     { setDesde(hace30dias());     setHasta(hoyGT()) }
    if (p === 'anio')    { setDesde(inicioAnio());     setHasta(hoyGT()) }
  }

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-10 py-7 max-w-7xl mx-auto">
        <div className="flex items-baseline justify-between mb-5 no-print">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Reportes</h1>
        </div>

        {/* Header: rango + presets */}
        <div className="card-julia p-5 mb-5 shadow-sm no-print">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wider text-gray-400 font-medium">Desde</label>
                <input type="date" value={desde} onChange={e => setDesde(e.target.value)} max={hasta}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-julia-red" />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs uppercase tracking-wider text-gray-400 font-medium">Hasta</label>
                <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} min={desde} max={hoyGT()}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-julia-red" />
              </div>
            </div>
            <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1 text-xs">
              <button onClick={() => setPreset('mes')}  className="px-3 py-1.5 rounded-md text-gray-600 hover:text-julia-red">Este mes</button>
              <button onClick={() => setPreset('prev')} className="px-3 py-1.5 rounded-md text-gray-600 hover:text-julia-red">Mes pasado</button>
              <button onClick={() => setPreset('30d')}  className="px-3 py-1.5 rounded-md text-gray-600 hover:text-julia-red">30 días</button>
              <button onClick={() => setPreset('anio')} className="px-3 py-1.5 rounded-md text-gray-600 hover:text-julia-red">Año actual</button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-gray-200 mb-6 no-print overflow-x-auto">
          <TabBtn active={tab === 'dashboard'}    onClick={() => setTab('dashboard')}>Dashboard</TabBtn>
          <TabBtn active={tab === 'pnl'}          onClick={() => setTab('pnl')}>Estado de Resultados</TabBtn>
          <TabBtn active={tab === 'balance'}      onClick={() => setTab('balance')}>Balance General</TabBtn>
          <TabBtn active={tab === 'flujo'}        onClick={() => setTab('flujo')}>Flujo de Caja</TabBtn>
          <TabBtn active={tab === 'ventas'}       onClick={() => setTab('ventas')}>Ventas</TabBtn>
          <TabBtn active={tab === 'rentabilidad'} onClick={() => setTab('rentabilidad')}>Rentabilidad</TabBtn>
          <TabBtn active={tab === 'libro-mayor'}  onClick={() => setTab('libro-mayor')}>Libro Mayor</TabBtn>
          <TabBtn active={tab === 'balance-comp'} onClick={() => setTab('balance-comp')}>Balance Comprobación</TabBtn>
        </div>

        {tab === 'dashboard'    && <TabDashboard    desde={desde} hasta={hasta} />}
        {tab === 'pnl'          && <TabPnL          desde={desde} hasta={hasta} onDrillCuenta={onDrillCuenta} setTab={setTab} />}
        {tab === 'balance'      && <TabBalanceGeneral hasta={hasta} onDrillCuenta={onDrillCuenta} />}
        {tab === 'flujo'        && <TabFlujoCaja    desde={desde} hasta={hasta} />}
        {tab === 'ventas'       && <TabVentas       desde={desde} hasta={hasta} />}
        {tab === 'rentabilidad' && <TabRentabilidad desde={desde} hasta={hasta} />}
        {tab === 'libro-mayor'  && <TabLibroMayor   desde={desde} hasta={hasta} />}
        {tab === 'balance-comp' && <TabBalanceComprobacion desde={desde} hasta={hasta} onDrillCuenta={onDrillCuenta} />}
      </div>

      {drillCuenta && (
        <DrillDownCuentaModal
          cuenta={drillCuenta}
          desde={desde}
          hasta={hasta}
          onClose={() => setDrillCuenta(null)}
        />
      )}

      {/* Print stylesheet — para "Save as PDF" del navegador */}
      <style jsx global>{`
        @media print {
          @page { size: A4; margin: 1.2cm; }
          body { background: white !important; }
          .no-print { display: none !important; }
          .print-shadow { box-shadow: none !important; }
          aside, nav, header { display: none !important; }
          main { padding: 0 !important; }
          table { page-break-inside: auto; }
          tr { page-break-inside: avoid; }
        }
      `}</style>
    </Layout>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
        active ? 'border-b-2 border-julia-red text-julia-red' : 'text-gray-500 hover:text-gray-800'
      }`}>
      {children}
    </button>
  )
}

// ============================================================================
// Dashboard
// ============================================================================

function TabDashboard({ desde, hasta }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => { cargar() }, [desde, hasta])
  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/reportes/dashboard?desde=${desde}&hasta=${hasta}`)
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error); return }
    setData(json)
  }

  if (loading) return <Loading />
  if (err) return <Error msg={err} />
  if (!data) return null

  const k = data.kpis

  function exportarExcel() {
    descargarExcel(`dashboard_${desde}_${hasta}.xlsx`, [
      { name: 'KPIs', data: [{ ...k, desde, hasta }] },
      { name: 'Ventas por día', data: data.serie_dias },
      { name: 'Top productos', data: data.top5_productos },
      { name: 'Top categorías', data: data.top5_categorias },
      { name: 'Métodos de pago', data: data.metodos_pago },
    ])
  }

  return (
    <div>
      <ExportBar onExcel={exportarExcel} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Ingresos (c/IVA)"        value={fmtQ(k.ingresos_total)}        hint={`${fmtNum(k.recibos)} recibos`} />
        <Kpi label="Ingresos sin IVA"        value={fmtQ(k.ingresos_sin_iva)}      hint="base de negocio" />
        <Kpi label="COGS teórico"            value={fmtQ(k.cogs_teorico)}          hint="costo de receta × vendidos" tone="amber" />
        <Kpi label="Utilidad bruta teórica"  value={fmtQ(k.utilidad_bruta)}        hint={k.margen_promedio_pct != null ? `margen prom. ${fmtPct(k.margen_promedio_pct)}` : ''} tone="green" />

        <Kpi label="Food cost"               value={fmtPct(k.food_cost_pct)}       hint="costo / ingresos sin IVA" />
        <Kpi label="Cobertura recetas"       value={fmtPct(k.cobertura_recetas_pct)} hint="% ingresos con receta" />
        <Kpi label="Ticket promedio"         value={fmtQ(k.ticket_promedio)}       hint={`${fmtNum(k.productos_unicos)} productos únicos`} />
        <Kpi label="Productos únicos"        value={fmtNum(k.productos_unicos)}    hint="vendidos en el rango" />
      </div>

      {/* Serie diaria */}
      <Section title="Ventas por día">
        <SimpleBars data={data.serie_dias.map(d => ({ label: d.fecha.slice(5), value: d.monto }))} />
        <div className="text-xs text-gray-400 mt-2">{data.serie_dias.length} días en el rango</div>
      </Section>

      {/* Top productos */}
      <Section title="Top 5 productos del período">
        <SimpleTable
          columns={[
            { k: 'item_name',  l: 'Producto' },
            { k: 'unidades',   l: 'Unid.',     align: 'right', fmt: v => fmtNum(v) },
            { k: 'ingresos',   l: 'Ingresos',  align: 'right', fmt: fmtQ },
            { k: 'costo_total', l: 'Costo',     align: 'right', fmt: v => v != null ? fmtQ(v) : '—' },
            { k: 'margen_pct', l: 'Margen',    align: 'right', fmt: v => v != null ? fmtPct(v) : '—' },
          ]}
          rows={data.top5_productos}
        />
      </Section>

      {/* Top categorías */}
      <Section title="Top 5 categorías del período">
        <SimpleTable
          columns={[
            { k: 'nombre',     l: 'Categoría' },
            { k: 'productos',  l: 'Productos', align: 'right', fmt: fmtNum },
            { k: 'unidades',   l: 'Unidades',  align: 'right', fmt: v => fmtNum(v, 0) },
            { k: 'monto',      l: 'Ingresos',  align: 'right', fmt: fmtQ },
          ]}
          rows={data.top5_categorias}
        />
      </Section>

      <Section title="Métodos de pago">
        <SimpleTable
          columns={[
            { k: 'nombre', l: 'Método' },
            { k: 'monto',  l: 'Monto',    align: 'right', fmt: fmtQ },
          ]}
          rows={data.metodos_pago}
        />
      </Section>
    </div>
  )
}

// ============================================================================
// P&L
// ============================================================================

function TabPnL({ desde, hasta, onDrillCuenta, setTab }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => { cargar() }, [desde, hasta])
  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/reportes/pnl?desde=${desde}&hasta=${hasta}`)
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error); return }
    setData(json)
  }

  if (loading) return <Loading />
  if (err) return <Error msg={err} />
  if (!data) return null

  function exportarExcel() {
    descargarExcel(`pnl_${desde}_${hasta}.xlsx`, [
      { name: 'Resumen', data: [{
        desde, hasta,
        ingresos_brutos_con_iva: data.ingresos.brutos_con_iva,
        ingresos_netos_sin_iva: data.ingresos.netos_sin_iva,
        iva_repercutido: data.ingresos.iva_repercutido,
        cogs_teorico: data.cogs.teorico,
        cobertura_pct: data.cogs.cobertura_pct,
        utilidad_bruta: data.utilidad_bruta.monto,
        margen_bruto_pct: data.utilidad_bruta.margen_pct,
        gastos_egresos_caja: data.gastos.egresos_caja,
        gastos_contables: data.gastos.contables,
        gastos_total: data.gastos.total,
        utilidad_operativa: data.utilidad_operativa.monto,
        margen_operativo_pct: data.utilidad_operativa.margen_pct,
      }] },
      { name: 'Gastos por cuenta', data: data.gastos.detalle_por_cuenta },
    ])
  }

  return (
    <div>
      <ExportBar onExcel={exportarExcel} />

      {/* Aviso COGS teorico */}
      <div className="bg-amber-50/60 border border-amber-100 rounded-xl px-4 py-3 mb-5 text-sm text-amber-900 no-print">
        <strong>COGS teórico</strong> — calculado como <em>costo de receta × unidades vendidas</em>.
        Cobertura actual: <strong>{fmtPct(data.cogs.cobertura_pct)}</strong> del ingreso. La carga masiva
        de insumos reales habilitará COGS real desde el inventario.
      </div>

      <PrintHeader titulo="Estado de Resultados" desde={desde} hasta={hasta} />

      <div className="card-julia shadow-sm overflow-hidden print-shadow">
        <table className="w-full text-sm">
          <tbody>
            <PnLSeccion titulo="INGRESOS" />
            <PnLFila label="Ventas brutas (incluye IVA)" valor={data.ingresos.brutos_con_iva} />
            <PnLFila label="( − ) IVA repercutido"        valor={-data.ingresos.iva_repercutido} muted />
            <PnLFila label="Ventas netas (base)"          valor={data.ingresos.netos_sin_iva} bold />

            <PnLSeccion titulo="COSTO DE VENTAS" />
            <PnLFila label={`COGS teórico (cobertura ${fmtPct(data.cogs.cobertura_pct)})`}
                     valor={-data.cogs.teorico}
                     onClick={() => setTab && setTab('rentabilidad')}
                     hintClick="ver desglose por producto" />

            <PnLFila label="UTILIDAD BRUTA" valor={data.utilidad_bruta.monto} bold highlight
                     subtexto={data.utilidad_bruta.margen_pct != null ? `Margen bruto ${fmtPct(data.utilidad_bruta.margen_pct)}` : null} />

            <PnLSeccion titulo="GASTOS OPERATIVOS" />
            <PnLFila label="Egresos de caja (cierres)"     valor={-data.gastos.egresos_caja} muted />
            <PnLFila label="Gastos contables (asientos)"   valor={-data.gastos.contables} muted />
            <PnLFila label="Total gastos operativos"       valor={-data.gastos.total} bold />

            <PnLFila label="UTILIDAD OPERATIVA" valor={data.utilidad_operativa.monto} bold highlight
                     subtexto={data.utilidad_operativa.margen_pct != null ? `Margen operativo ${fmtPct(data.utilidad_operativa.margen_pct)}` : null} />
          </tbody>
        </table>
      </div>

      {/* Desglose contable de ingresos por cuenta */}
      {data.ingresos.detalle_por_cuenta && data.ingresos.detalle_por_cuenta.length > 0 && (
        <Section title="Desglose contable de ingresos por cuenta">
          <DrillCuentasTable
            rows={data.ingresos.detalle_por_cuenta}
            onClick={onDrillCuenta}
          />
          <div className="text-xs text-gray-400 mt-2 no-print">
            Click en una fila para ver los movimientos del rango. Total contable: {fmtQ(data.ingresos.total_contable)}.
          </div>
        </Section>
      )}

      {/* Detalle de gastos por cuenta */}
      {data.gastos.detalle_por_cuenta.length > 0 && (
        <Section title="Detalle de gastos por cuenta">
          <DrillCuentasTable
            rows={data.gastos.detalle_por_cuenta}
            onClick={onDrillCuenta}
          />
          <div className="text-xs text-gray-400 mt-2 no-print">
            Click en una fila para ver las partidas que la componen.
          </div>
        </Section>
      )}
    </div>
  )
}

// Tabla reusable para gastos/ingresos por cuenta con drill-down al click.
function DrillCuentasTable({ rows, onClick }) {
  if (!rows || rows.length === 0) return <div className="text-xs text-gray-400 py-4">Sin datos</div>
  return (
    <div className="card-julia shadow-sm overflow-hidden print-shadow">
      <table className="w-full text-sm">
        <thead className="bg-gray-50/80 border-b border-gray-100">
          <tr>
            <th className="text-left text-xs text-gray-500 font-medium px-4 py-2.5">Código</th>
            <th className="text-left text-xs text-gray-500 font-medium px-4 py-2.5">Cuenta</th>
            <th className="text-right text-xs text-gray-500 font-medium px-4 py-2.5">Monto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const clickeable = onClick && r.id
            return (
              <tr
                key={r.id || i}
                className={`${i > 0 ? 'border-t border-gray-50' : ''} ${clickeable ? 'cursor-pointer hover:bg-julia-cream/30 transition-colors group' : ''}`}
                onClick={clickeable ? () => onClick({ id: r.id, codigo: r.codigo, nombre: r.nombre }) : undefined}
              >
                <td className="px-4 py-2 text-gray-500 font-mono text-xs">{r.codigo}</td>
                <td className="px-4 py-2 text-gray-700">
                  {r.nombre}
                  {clickeable && <span className="ml-2 text-[10px] text-gray-300 group-hover:text-julia-red no-print">→ ver detalle</span>}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-gray-700">{fmtQ(r.monto)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PnLSeccion({ titulo }) {
  return (
    <tr className="border-t border-gray-200 bg-gray-50">
      <td colSpan="2" className="px-5 py-2.5 text-[11px] uppercase tracking-wider font-semibold text-gray-500">{titulo}</td>
    </tr>
  )
}

function PnLFila({ label, valor, bold, highlight, muted, subtexto, onClick, hintClick }) {
  const clickeable = !!onClick
  return (
    <tr
      className={`border-t border-gray-50 ${highlight ? 'bg-julia-cream/30' : ''} ${clickeable ? 'cursor-pointer hover:bg-julia-cream/40 transition-colors group' : ''}`}
      onClick={clickeable ? onClick : undefined}
    >
      <td className={`px-5 py-2.5 ${bold ? 'font-semibold text-gray-900' : muted ? 'text-gray-500 pl-9' : 'text-gray-700 pl-9'}`}>
        {label}
        {subtexto && <span className="ml-2 text-xs text-gray-500 font-normal">· {subtexto}</span>}
        {clickeable && hintClick && (
          <span className="ml-2 text-[10px] text-gray-300 group-hover:text-julia-red no-print">→ {hintClick}</span>
        )}
      </td>
      <td className={`px-5 py-2.5 text-right tabular-nums ${bold ? 'font-semibold text-gray-900' : muted ? 'text-gray-500' : 'text-gray-700'} ${valor < 0 ? '' : ''}`}>
        {fmtQ(valor)}
      </td>
    </tr>
  )
}

// ============================================================================
// Ventas
// ============================================================================

function TabVentas({ desde, hasta }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => { cargar() }, [desde, hasta])
  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/reportes/ventas?desde=${desde}&hasta=${hasta}`)
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error); return }
    setData(json)
  }

  if (loading) return <Loading />
  if (err) return <Error msg={err} />
  if (!data) return null

  const r = data.resumen

  function exportarExcel() {
    descargarExcel(`ventas_${desde}_${hasta}.xlsx`, [
      { name: 'Resumen', data: [{ desde, hasta, ...r }] },
      { name: 'Por día', data: data.dias },
      { name: 'Por categoría', data: data.categorias },
      { name: 'Por producto', data: data.productos },
      { name: 'Métodos de pago', data: data.metodos_pago },
    ])
  }

  return (
    <div>
      <ExportBar onExcel={exportarExcel} />

      <PrintHeader titulo="Reporte de Ventas" desde={desde} hasta={hasta} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Ingresos (c/IVA)"   value={fmtQ(r.total)}           hint={`${fmtNum(r.recibos)} recibos`} />
        <Kpi label="Sin IVA"            value={fmtQ(r.total_sin_iva)}   hint={`IVA Q ${fmtNum(r.iva, 2)}`} />
        <Kpi label="Ticket promedio"    value={fmtQ(r.ticket_promedio)} />
        <Kpi label="Unidades vendidas"  value={fmtNum(r.unidades_totales)} hint={`${fmtNum(r.productos_unicos)} productos únicos`} />
      </div>

      <Section title="Por día">
        <SimpleBars data={data.dias.map(d => ({ label: d.fecha.slice(5), value: d.monto }))} />
      </Section>

      <Section title="Por categoría">
        <SimpleTable
          columns={[
            { k: 'nombre',    l: 'Categoría' },
            { k: 'productos', l: 'Productos', align: 'right', fmt: fmtNum },
            { k: 'unidades',  l: 'Unidades',  align: 'right', fmt: v => fmtNum(v, 0) },
            { k: 'monto',     l: 'Ingresos',  align: 'right', fmt: fmtQ },
          ]}
          rows={data.categorias}
        />
      </Section>

      <Section title="Métodos de pago">
        <SimpleTable
          columns={[
            { k: 'nombre', l: 'Método' },
            { k: 'monto',  l: 'Monto',    align: 'right', fmt: fmtQ },
          ]}
          rows={data.metodos_pago}
        />
      </Section>

      <Section title={`Productos (${data.productos.length})`}>
        <SimpleTable
          maxRows={50}
          columns={[
            { k: 'item_name',  l: 'Producto' },
            { k: 'cantidad',   l: 'Unidades', align: 'right', fmt: v => fmtNum(v, 0) },
            { k: 'lineas',     l: 'Líneas',   align: 'right', fmt: fmtNum },
            { k: 'monto',      l: 'Monto',    align: 'right', fmt: fmtQ },
          ]}
          rows={data.productos}
        />
      </Section>
    </div>
  )
}

// ============================================================================
// Rentabilidad
// ============================================================================

function TabRentabilidad({ desde, hasta }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [filtro, setFiltro] = useState('con-receta')

  useEffect(() => { cargar() }, [desde, hasta])
  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/reportes/rentabilidad?desde=${desde}&hasta=${hasta}`)
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error); return }
    setData(json)
  }

  const filtrados = useMemo(() => {
    if (!data) return []
    if (filtro === 'con-receta') return data.productos.filter(p => p.con_receta)
    if (filtro === 'sin-receta') return data.productos.filter(p => !p.con_receta)
    return data.productos
  }, [data, filtro])

  if (loading) return <Loading />
  if (err) return <Error msg={err} />
  if (!data) return null

  const r = data.resumen

  function exportarExcel() {
    descargarExcel(`rentabilidad_${desde}_${hasta}.xlsx`, [
      { name: 'Resumen', data: [{ desde, hasta, ...r }] },
      { name: 'Productos', data: data.productos },
    ])
  }

  return (
    <div>
      <ExportBar onExcel={exportarExcel} />

      <PrintHeader titulo="Rentabilidad por Producto" desde={desde} hasta={hasta} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Ventas (c/IVA)"           value={fmtQ(r.ventas_total)} />
        <Kpi label="Costo teórico"            value={fmtQ(r.costo_teorico_total)} tone="amber" />
        <Kpi label="Utilidad bruta teórica"   value={fmtQ(r.utilidad_bruta_teorica)} tone="green"
             hint={r.margen_promedio_pct != null ? `margen prom. ${fmtPct(r.margen_promedio_pct)}` : ''} />
        <Kpi label="Food cost"                value={fmtPct(r.food_cost_pct)} />
        <Kpi label="Cobertura recetas"        value={fmtPct(r.cobertura_pct)} hint="% ingresos con receta" />
        <Kpi label="Ingresos con receta"      value={fmtQ(r.ingresos_con_receta)} />
        <Kpi label="Ingresos sin receta"      value={fmtQ(r.ingresos_sin_receta)} tone={r.ingresos_sin_receta > 0 ? 'amber' : 'neutral'}
             hint={r.ingresos_sin_receta > 0 ? 'sin BOM definido' : ''} />
        <Kpi label="Productos con receta"     value={fmtNum(data.productos.filter(p => p.con_receta).length)} />
      </div>

      <div className="flex gap-1 bg-gray-50 border border-gray-200 rounded-lg p-1 text-xs mb-3 inline-flex no-print">
        {[
          { v: 'con-receta', l: 'Con receta' },
          { v: 'sin-receta', l: 'Sin receta' },
          { v: 'todos',      l: 'Todos' },
        ].map(o => (
          <button key={o.v} onClick={() => setFiltro(o.v)}
            className={`px-3 py-1.5 rounded-md transition ${filtro === o.v
              ? 'bg-white text-julia-red shadow-sm font-medium'
              : 'text-gray-500 hover:text-gray-800'}`}>{o.l}</button>
        ))}
      </div>

      <SimpleTable
        maxRows={100}
        columns={[
          { k: 'item_name',       l: 'Producto' },
          { k: 'unidades',        l: 'Unid.',         align: 'right', fmt: v => fmtNum(v, 0) },
          { k: 'ingresos',        l: 'Ingresos',      align: 'right', fmt: fmtQ },
          { k: 'ingresos_sin_iva', l: 'Sin IVA',      align: 'right', fmt: fmtQ },
          { k: 'costo_unitario',  l: 'Costo unit.',   align: 'right', fmt: v => v != null ? fmtQ(v) : '—' },
          { k: 'costo_total',     l: 'Costo total',   align: 'right', fmt: v => v != null ? fmtQ(v) : '—' },
          { k: 'margen_q',        l: 'Margen Q',      align: 'right', fmt: v => v != null ? fmtQ(v) : '—' },
          { k: 'margen_pct',      l: 'Margen %',      align: 'right', fmt: v => v != null ? fmtPct(v) : '—' },
        ]}
        rows={filtrados}
      />
    </div>
  )
}

// ============================================================================
// Componentes reusables
// ============================================================================

function ExportBar({ onExcel }) {
  return (
    <div className="flex justify-end gap-2 mb-3 no-print">
      <button onClick={onExcel}
        className="text-xs px-3 py-1.5 border border-gray-200 text-gray-700 rounded-md hover:border-julia-red hover:text-julia-red bg-white">
        ↓ Excel
      </button>
      <button onClick={() => window.print()}
        className="text-xs px-3 py-1.5 border border-gray-200 text-gray-700 rounded-md hover:border-julia-red hover:text-julia-red bg-white">
        ↓ PDF (imprimir)
      </button>
    </div>
  )
}

function PrintHeader({ titulo, desde, hasta }) {
  return (
    <div className="hidden print:block mb-4">
      <h1 className="text-2xl font-semibold">Julia Bakery — {titulo}</h1>
      <p className="text-sm text-gray-600">Período: {formatFecha(desde)} a {formatFecha(hasta)}</p>
      <hr className="mt-2 border-gray-300" />
    </div>
  )
}

function Kpi({ label, value, hint, tone = 'neutral' }) {
  const tones = {
    neutral: 'border-gray-100',
    amber:   'border-amber-200 bg-amber-50/40',
    green:   'border-emerald-200 bg-emerald-50/40',
    red:     'border-red-200 bg-red-50/40',
  }
  const valueTones = {
    neutral: 'text-gray-900',
    amber:   'text-amber-800',
    green:   'text-emerald-700',
    red:     'text-red-700',
  }
  return (
    <div className={`border rounded-xl px-4 py-3 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">{label}</div>
      <div className={`text-xl font-semibold mt-1 tabular-nums ${valueTones[tone]}`}>{value}</div>
      {hint && <div className="text-xs text-gray-500 mt-1">{hint}</div>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <h3 className="text-sm font-medium text-gray-900 mb-2">{title}</h3>
      {children}
    </div>
  )
}

function SimpleTable({ columns, rows, maxRows, onRowClick }) {
  const trim = maxRows && rows.length > maxRows
  const visibles = trim ? rows.slice(0, maxRows) : rows
  return (
    <div className="card-julia shadow-sm overflow-hidden print-shadow">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/80 border-b border-gray-100">
            <tr>
              {columns.map(c => (
                <th key={c.k} className={`text-${c.align || 'left'} text-xs text-gray-500 font-medium px-4 py-2.5`}>{c.l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 ? (
              <tr><td colSpan={columns.length} className="text-center text-xs text-gray-400 py-8">Sin datos en el rango.</td></tr>
            ) : visibles.map((r, i) => (
              <tr
                key={i}
                className={`${i > 0 ? 'border-t border-gray-50' : ''} ${onRowClick ? 'cursor-pointer hover:bg-julia-cream/30 transition-colors' : ''}`}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
              >
                {columns.map(c => (
                  <td key={c.k} className={`px-4 py-2 text-${c.align || 'left'} ${c.align === 'right' ? 'tabular-nums' : ''} text-gray-700`}>
                    {c.fmt ? c.fmt(r[c.k]) : (r[c.k] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {trim && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/40 text-xs text-gray-500 no-print">
          Mostrando primeros {maxRows} de {rows.length}. Descargá Excel para ver todo.
        </div>
      )}
    </div>
  )
}

function SimpleBars({ data }) {
  if (!data || data.length === 0) return <div className="text-xs text-gray-400 py-4">Sin datos</div>
  const max = Math.max(...data.map(d => Math.abs(d.value || 0)))
  return (
    <div className="card-julia p-4 print-shadow shadow-sm">
      <div className="flex items-end gap-1 h-32 overflow-x-auto">
        {data.map((d, i) => {
          const h = max > 0 ? (Math.abs(d.value) / max) * 100 : 0
          return (
            <div key={i} className="flex flex-col items-center flex-shrink-0" style={{ minWidth: '24px' }} title={`${d.label}: Q ${fmtNum(d.value, 2)}`}>
              <div className="flex-1 flex items-end w-full">
                <div className="bg-julia-red rounded-t w-full opacity-80" style={{ height: `${h}%`, minHeight: h > 0 ? '2px' : '0' }} />
              </div>
              <div className="text-[9px] text-gray-400 mt-1 transform -rotate-45 origin-top-left whitespace-nowrap">
                {d.label}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div className="card-julia p-5 shadow-sm">
      <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
    </div>
  )
}

function Error({ msg }) {
  return (
    <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700">{msg}</div>
  )
}

// ============================================================================
// Balance General
// ============================================================================

function TabBalanceGeneral({ hasta, onDrillCuenta }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => { cargar() }, [hasta])
  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/reportes/balance-general?hasta=${hasta}`)
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error); return }
    setData(json)
  }

  if (loading) return <Loading />
  if (err) return <Error msg={err} />
  if (!data) return null

  const g = data.grupos
  const t = data.totales

  function exportarExcel() {
    descargarExcel(`balance-general_al_${hasta}.xlsx`, [
      { name: 'Resumen', data: [{
        hasta,
        total_activo: t.activo,
        total_pasivo: g.pasivo.total,
        total_patrimonio_cuentas: g.patrimonio.total_cuentas,
        utilidad_ejercicio: g.patrimonio.utilidad_ejercicio,
        total_patrimonio: g.patrimonio.total,
        total_pasivo_y_patrimonio: t.pasivo_y_patrimonio,
        diferencia: t.diferencia,
        cuadra: t.cuadra,
      }] },
      { name: 'Activo',     data: g.activo.cuentas },
      { name: 'Pasivo',     data: g.pasivo.cuentas },
      { name: 'Patrimonio', data: g.patrimonio.cuentas },
    ])
  }

  return (
    <div>
      <ExportBar onExcel={exportarExcel} />

      <div className="text-xs text-gray-500 mb-3 no-print">
        Al cierre del <strong>{formatFecha(hasta)}</strong>. Las cuentas de resultado del año en curso
        ({formatFecha(g.patrimonio.inicio_ejercicio)} en adelante) se suman como <em>Utilidad del Ejercicio</em>.
      </div>

      <PrintHeader titulo="Balance General" desde={null} hasta={hasta} />

      {!t.cuadra && (
        <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 mb-4 text-sm text-red-800">
          ⚠ <strong>Balance no cuadra:</strong> diferencia de {fmtQ(t.diferencia)}.
          Activo {fmtQ(t.activo)} ≠ Pasivo+Patrimonio {fmtQ(t.pasivo_y_patrimonio)}.
          Revisar asientos posteados sin contra-partida o desbalanceados.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Columna izquierda: ACTIVO */}
        <BGGrupo titulo="ACTIVO" cuentas={g.activo.cuentas} total={g.activo.total} colorTotal={C_TONE_ACTIVO} onDrillCuenta={onDrillCuenta} />

        {/* Columna derecha: PASIVO + PATRIMONIO */}
        <div className="space-y-5">
          <BGGrupo titulo="PASIVO" cuentas={g.pasivo.cuentas} total={g.pasivo.total} colorTotal={C_TONE_PASIVO} onDrillCuenta={onDrillCuenta} />
          <BGGrupo
            titulo="PATRIMONIO"
            cuentas={[
              ...g.patrimonio.cuentas,
              {
                codigo: '',
                nombre: 'Utilidad del ejercicio en curso',
                saldo: g.patrimonio.utilidad_ejercicio,
                esEjercicio: true,
              },
            ]}
            total={g.patrimonio.total}
            colorTotal={C_TONE_PATRIMONIO}
            subtotalLabel="Subtotal cuentas"
            subtotal={g.patrimonio.total_cuentas}
            onDrillCuenta={onDrillCuenta}
          />
        </div>
      </div>

      {/* Totales finales */}
      <div className="mt-5 bg-white border-2 border-julia-red/20 rounded-2xl shadow-sm overflow-hidden print-shadow">
        <table className="w-full text-sm">
          <tbody>
            <tr>
              <td className="px-5 py-3 font-semibold text-gray-900">TOTAL ACTIVO</td>
              <td className="px-5 py-3 text-right tabular-nums font-semibold text-gray-900">{fmtQ(t.activo)}</td>
            </tr>
            <tr className="border-t border-gray-100">
              <td className="px-5 py-3 font-semibold text-gray-900">TOTAL PASIVO + PATRIMONIO</td>
              <td className="px-5 py-3 text-right tabular-nums font-semibold text-gray-900">{fmtQ(t.pasivo_y_patrimonio)}</td>
            </tr>
            <tr className={`border-t border-gray-100 ${t.cuadra ? 'bg-emerald-50/40' : 'bg-red-50/40'}`}>
              <td className="px-5 py-3 text-xs text-gray-600">Diferencia (debe ser 0)</td>
              <td className={`px-5 py-3 text-right tabular-nums font-semibold ${t.cuadra ? 'text-emerald-700' : 'text-red-700'}`}>
                {fmtQ(t.diferencia)}  {t.cuadra ? '✓' : '⚠'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

const C_TONE_ACTIVO     = 'border-blue-200 bg-blue-50/40 text-blue-900'
const C_TONE_PASIVO     = 'border-amber-200 bg-amber-50/40 text-amber-900'
const C_TONE_PATRIMONIO = 'border-emerald-200 bg-emerald-50/40 text-emerald-900'

function BGGrupo({ titulo, cuentas, total, colorTotal, subtotalLabel, subtotal, onDrillCuenta }) {
  return (
    <div className="card-julia shadow-sm overflow-hidden print-shadow">
      <div className="px-5 py-3 border-b border-gray-100 bg-gray-50/80">
        <h3 className="text-xs uppercase tracking-wider text-gray-600 font-semibold">{titulo}</h3>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {cuentas.length === 0 ? (
            <tr><td colSpan="2" className="px-5 py-6 text-center text-xs text-gray-400">Sin cuentas con saldo</td></tr>
          ) : cuentas.map((c, i) => {
            const clickeable = onDrillCuenta && c.id && !c.esEjercicio
            return (
            <tr
              key={c.id || c.nombre}
              className={`${i > 0 ? 'border-t border-gray-50' : ''} ${clickeable ? 'cursor-pointer hover:bg-julia-cream/30 transition-colors group' : ''}`}
              onClick={clickeable ? () => onDrillCuenta({ id: c.id, codigo: c.codigo, nombre: c.nombre }) : undefined}
            >
              <td className="px-5 py-2 text-gray-700">
                {c.codigo && <span className="text-xs text-gray-400 mr-2 font-mono">{c.codigo}</span>}
                <span className={c.esEjercicio ? 'italic' : ''}>{c.nombre}</span>
                {clickeable && <span className="ml-2 text-[10px] text-gray-300 group-hover:text-julia-red no-print">→</span>}
              </td>
              <td className="px-5 py-2 text-right tabular-nums text-gray-800">{fmtQ(c.saldo)}</td>
            </tr>
          )})}
          {subtotal != null && (
            <tr className="border-t border-gray-100 bg-gray-50/40">
              <td className="px-5 py-2 text-xs text-gray-500">{subtotalLabel}</td>
              <td className="px-5 py-2 text-right tabular-nums text-gray-700">{fmtQ(subtotal)}</td>
            </tr>
          )}
          <tr className={`border-t border-gray-100 ${colorTotal.split(' ').filter(c => c.includes('bg')).join(' ')}`}>
            <td className={`px-5 py-2.5 font-semibold ${colorTotal.split(' ').filter(c => c.includes('text')).join(' ')}`}>Total {titulo.toLowerCase()}</td>
            <td className={`px-5 py-2.5 text-right tabular-nums font-semibold ${colorTotal.split(' ').filter(c => c.includes('text')).join(' ')}`}>{fmtQ(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ============================================================================
// Flujo de Caja
// ============================================================================

function TabFlujoCaja({ desde, hasta }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => { cargar() }, [desde, hasta])
  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/reportes/flujo-caja?desde=${desde}&hasta=${hasta}`)
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error); return }
    setData(json)
  }

  if (loading) return <Loading />
  if (err) return <Error msg={err} />
  if (!data) return null

  const r = data.resumen

  function exportarExcel() {
    descargarExcel(`flujo-caja_${desde}_${hasta}.xlsx`, [
      { name: 'Resumen', data: [{ desde, hasta, ...r }] },
      { name: 'Día por día', data: data.dias },
    ])
  }

  return (
    <div>
      <ExportBar onExcel={exportarExcel} />

      <PrintHeader titulo="Flujo de Caja" desde={desde} hasta={hasta} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Entradas efectivo"   value={fmtQ(r.total_entradas)}   tone="green" hint="ventas efectivo del rango" />
        <Kpi label="Salidas (egresos)"   value={fmtQ(r.total_salidas)}    tone="amber" hint="pagos chicos de caja" />
        <Kpi label="Flujo neto"          value={fmtQ(r.flujo_neto)}       tone={r.flujo_neto >= 0 ? 'green' : 'red'} />
        <Kpi label="Ventas totales"      value={fmtQ(r.ventas_total_periodo)} hint="incluye tarjeta/otros" />
        <Kpi label="Días con cierre"     value={fmtNum(r.dias_cerrados)}  hint={`${r.dias_total} días con registro`} />
        <Kpi label="Días abiertos"       value={fmtNum(r.dias_abiertos)}  tone={r.dias_abiertos > 0 ? 'amber' : 'neutral'} hint="sin marcar cerrado" />
        <Kpi label="Días con diferencia" value={fmtNum(r.dias_con_diferencia)} tone={r.dias_con_diferencia > 0 ? 'amber' : 'neutral'} />
        <Kpi label="Suma diferencias"    value={fmtQ(r.suma_diferencias)} hint="conteo − esperado" />
      </div>

      {data.dias.length === 0 ? (
        <div className="card-julia p-8 text-center text-sm text-gray-400">
          Sin cierres de caja registrados en el rango.
        </div>
      ) : (
        <SimpleTable
          columns={[
            { k: 'fecha',           l: 'Fecha',           fmt: formatFecha },
            { k: 'estado',          l: 'Estado',         fmt: v => (
              <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-md font-medium ${v === 'cerrado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{v}</span>
            ) },
            { k: 'saldo_inicial',   l: 'Inicial',        align: 'right', fmt: fmtQ },
            { k: 'ventas_efectivo', l: 'Ventas efect.',  align: 'right', fmt: fmtQ },
            { k: 'egresos',         l: 'Egresos',        align: 'right', fmt: fmtQ },
            { k: 'saldo_esperado',  l: 'Esperado',       align: 'right', fmt: fmtQ },
            { k: 'conteo',          l: 'Conteo',         align: 'right', fmt: v => v != null ? fmtQ(v) : '—' },
            { k: 'diferencia',      l: 'Dif.',           align: 'right', fmt: v => {
              if (v == null) return '—'
              const cls = v > 0 ? 'text-emerald-700' : v < 0 ? 'text-red-700' : ''
              return <span className={cls}>{fmtQ(v)}</span>
            } },
            { k: 'recibos',         l: 'Recibos',        align: 'right', fmt: fmtNum },
          ]}
          rows={data.dias}
        />
      )}
    </div>
  )
}

// ============================================================================
// Libro Mayor
// ============================================================================

function TabLibroMayor({ desde, hasta }) {
  const [cuentas, setCuentas] = useState([])
  const [cuentaId, setCuentaId] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => { cargarCuentas() }, [])
  useEffect(() => { if (cuentaId) cargar() }, [cuentaId, desde, hasta])

  async function cargarCuentas() {
    const res = await apiFetch('/api/cuentas')
    const json = await res.json()
    if (res.ok) {
      const lista = (json.cuentas || []).filter(c => c.es_movimiento && c.activo)
      setCuentas(lista)
      if (lista.length > 0 && !cuentaId) setCuentaId(lista[0].id)
    }
  }

  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/contabilidad/libro-mayor?cuenta_id=${cuentaId}&desde=${desde}&hasta=${hasta}`)
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error); return }
    setData(json)
  }

  function exportarExcel() {
    if (!data) return
    descargarExcel(`libro-mayor_${data.cuenta.codigo}_${desde}_${hasta}.xlsx`, [
      { name: 'Resumen', data: [{
        cuenta_codigo: data.cuenta.codigo,
        cuenta_nombre: data.cuenta.nombre,
        desde, hasta,
        saldo_inicial: data.saldo_inicial,
        saldo_final: data.saldo_final,
        movimientos: data.movimientos.length,
      }] },
      { name: 'Movimientos', data: data.movimientos },
    ])
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 no-print">
        <label className="text-xs uppercase tracking-wider text-gray-400 font-medium">Cuenta</label>
        <select value={cuentaId} onChange={e => setCuentaId(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-julia-red flex-1 max-w-md">
          {cuentas.map(c => (
            <option key={c.id} value={c.id}>
              {c.codigo} — {c.nombre} ({c.tipo})
            </option>
          ))}
        </select>
        <button onClick={exportarExcel} disabled={!data}
          className="text-xs px-3 py-1.5 border border-gray-200 text-gray-700 rounded-md hover:border-julia-red hover:text-julia-red bg-white disabled:opacity-50">
          ↓ Excel
        </button>
        <button onClick={() => window.print()}
          className="text-xs px-3 py-1.5 border border-gray-200 text-gray-700 rounded-md hover:border-julia-red hover:text-julia-red bg-white">
          ↓ PDF
        </button>
      </div>

      {!cuentaId && <div className="text-sm text-gray-500">Cargando cuentas…</div>}
      {loading && <Loading />}
      {err && <Error msg={err} />}

      {data && !loading && (
        <>
          <PrintHeader titulo={`Libro Mayor — ${data.cuenta.codigo} ${data.cuenta.nombre}`} desde={desde} hasta={hasta} />

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Kpi label="Saldo inicial"    value={fmtQ(data.saldo_inicial)} hint={`al ${formatFecha(desde)}`} />
            <Kpi label="Movimientos"      value={fmtNum(data.movimientos.length)} />
            <Kpi label="Saldo final"      value={fmtQ(data.saldo_final)}   tone="green" hint={`al ${formatFecha(hasta)}`} />
            <Kpi label="Variación"        value={fmtQ(data.saldo_final - data.saldo_inicial)}
                 tone={data.saldo_final >= data.saldo_inicial ? 'green' : 'red'} />
          </div>

          <SimpleTable
            maxRows={200}
            columns={[
              { k: 'fecha',          l: 'Fecha',     fmt: formatFecha },
              { k: 'asiento_numero', l: 'Asiento',   align: 'right' },
              { k: 'descripcion',    l: 'Descripción' },
              { k: 'concepto',       l: 'Concepto',  fmt: v => v || '—' },
              { k: 'debe',           l: 'Debe',      align: 'right', fmt: v => v > 0 ? fmtQ(v) : '' },
              { k: 'haber',          l: 'Haber',     align: 'right', fmt: v => v > 0 ? fmtQ(v) : '' },
              { k: 'saldo',          l: 'Saldo',     align: 'right', fmt: fmtQ },
            ]}
            rows={data.movimientos}
          />
        </>
      )}
    </div>
  )
}

// ============================================================================
// Balance de Comprobación
// ============================================================================

function TabBalanceComprobacion({ desde, hasta, onDrillCuenta }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => { cargar() }, [desde, hasta])
  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch(`/api/contabilidad/balance?desde=${desde}&hasta=${hasta}`)
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error); return }
    setData(json)
  }

  if (loading) return <Loading />
  if (err) return <Error msg={err} />
  if (!data) return null

  const t = data.totales
  const debeCuadra  = Math.abs(t.debe - t.haber) < 0.01
  const saldosCuadra = Math.abs(t.saldo_deudor - t.saldo_acreedor) < 0.01

  function exportarExcel() {
    descargarExcel(`balance-comprobacion_${desde}_${hasta}.xlsx`, [
      { name: 'Resumen', data: [{ desde, hasta, ...t }] },
      { name: 'Por cuenta', data: data.filas },
    ])
  }

  return (
    <div>
      <ExportBar onExcel={exportarExcel} />

      <PrintHeader titulo="Balance de Comprobación" desde={desde} hasta={hasta} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Total Debe"          value={fmtQ(t.debe)}            tone={debeCuadra ? 'green' : 'red'} />
        <Kpi label="Total Haber"         value={fmtQ(t.haber)}           tone={debeCuadra ? 'green' : 'red'}
             hint={debeCuadra ? 'cuadra ✓' : `dif ${fmtQ(t.debe - t.haber)} ⚠`} />
        <Kpi label="Saldo deudor"        value={fmtQ(t.saldo_deudor)}    tone={saldosCuadra ? 'green' : 'neutral'} />
        <Kpi label="Saldo acreedor"      value={fmtQ(t.saldo_acreedor)}  tone={saldosCuadra ? 'green' : 'neutral'}
             hint={saldosCuadra ? 'cuadra ✓' : `dif ${fmtQ(t.saldo_deudor - t.saldo_acreedor)} ⚠`} />
      </div>

      <SimpleTable
        maxRows={300}
        onRowClick={onDrillCuenta ? (r) => onDrillCuenta({ id: r.id, codigo: r.codigo, nombre: r.nombre }) : null}
        columns={[
          { k: 'codigo',          l: 'Código' },
          { k: 'nombre',          l: 'Cuenta' },
          { k: 'tipo',            l: 'Tipo' },
          { k: 'debe',            l: 'Debe',           align: 'right', fmt: fmtQ },
          { k: 'haber',           l: 'Haber',          align: 'right', fmt: fmtQ },
          { k: 'saldo_deudor',    l: 'Saldo deudor',   align: 'right', fmt: v => v > 0 ? fmtQ(v) : '' },
          { k: 'saldo_acreedor',  l: 'Saldo acreedor', align: 'right', fmt: v => v > 0 ? fmtQ(v) : '' },
        ]}
        rows={data.filas}
      />
      {onDrillCuenta && (
        <div className="text-xs text-gray-400 mt-2 no-print">
          Click en una fila para ver los movimientos de la cuenta en el rango.
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Drill-down de cuenta: modal que reusa /api/contabilidad/libro-mayor
// ============================================================================

function DrillDownCuentaModal({ cuenta, desde, hasta, onClose }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancel = false
    setLoading(true); setErr(null); setData(null)
    apiFetch(`/api/contabilidad/libro-mayor?cuenta_id=${cuenta.id}&desde=${desde}&hasta=${hasta}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancel) return
        setLoading(false)
        if (!ok) setErr(j.error || 'Error cargando movimientos')
        else setData(j)
      })
    return () => { cancel = true }
  }, [cuenta.id, desde, hasta])

  // Cerrar con ESC.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const movimientos = data?.movimientos || []
  const totDebe  = movimientos.reduce((s, m) => s + (Number(m.debe)  || 0), 0)
  const totHaber = movimientos.reduce((s, m) => s + (Number(m.haber) || 0), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-start md:items-center justify-center bg-black/40 px-2 py-4 md:p-6 no-print" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-medium">Movimientos de cuenta</div>
            <h2 className="text-lg font-semibold text-gray-900 mt-0.5">
              {cuenta.codigo && <span className="text-gray-400 font-mono text-sm mr-2">{cuenta.codigo}</span>}
              {cuenta.nombre}
            </h2>
            <div className="text-xs text-gray-500 mt-0.5">
              Del {formatFecha(desde)} al {formatFecha(hasta)}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none p-1 -mt-1" aria-label="Cerrar">×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto">
          {loading && <div className="p-6"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>}
          {err && <div className="m-4"><Error msg={err} /></div>}
          {data && !loading && !err && (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-5 bg-gray-50/40 border-b border-gray-100">
                <Kpi label="Saldo inicial" value={fmtQ(data.saldo_inicial)} hint={`al ${formatFecha(desde)}`} />
                <Kpi label="Movimientos"   value={fmtNum(movimientos.length)} />
                <Kpi label="Saldo final"   value={fmtQ(data.saldo_final)} tone="green" hint={`al ${formatFecha(hasta)}`} />
                <Kpi label="Variación"     value={fmtQ(data.saldo_final - data.saldo_inicial)}
                     tone={data.saldo_final >= data.saldo_inicial ? 'green' : 'red'} />
              </div>

              {/* Tabla */}
              {movimientos.length === 0 ? (
                <div className="p-10 text-center text-sm text-gray-400">Sin movimientos en el rango.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50/80 border-b border-gray-100 sticky top-0">
                    <tr>
                      <th className="text-left text-xs text-gray-500 font-medium px-4 py-2.5">Fecha</th>
                      <th className="text-right text-xs text-gray-500 font-medium px-4 py-2.5">Asiento</th>
                      <th className="text-left text-xs text-gray-500 font-medium px-4 py-2.5">Descripción</th>
                      <th className="text-left text-xs text-gray-500 font-medium px-4 py-2.5">Concepto</th>
                      <th className="text-right text-xs text-gray-500 font-medium px-4 py-2.5">Debe</th>
                      <th className="text-right text-xs text-gray-500 font-medium px-4 py-2.5">Haber</th>
                      <th className="text-right text-xs text-gray-500 font-medium px-4 py-2.5">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientos.map((m, i) => (
                      <tr key={m.id || i} className={i > 0 ? 'border-t border-gray-50' : ''}>
                        <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{formatFecha(m.fecha)}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-500 font-mono text-xs">{m.asiento_numero ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-700">{m.descripcion || '—'}</td>
                        <td className="px-4 py-2 text-gray-600 text-xs">{m.concepto || '—'}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-700">{m.debe > 0  ? fmtQ(m.debe)  : ''}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-700">{m.haber > 0 ? fmtQ(m.haber) : ''}</td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-800 font-medium">{fmtQ(m.saldo)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50/60">
                      <td colSpan="4" className="px-4 py-2.5 text-xs uppercase tracking-wider text-gray-500 font-medium">Totales del rango</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">{fmtQ(totDebe)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-gray-800">{fmtQ(totHaber)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-between items-center bg-gray-50/40">
          <span className="text-xs text-gray-400">ESC o click fuera para cerrar</span>
          <button onClick={onClose}
            className="text-xs px-3 py-1.5 bg-white border border-gray-200 text-gray-700 rounded-md hover:border-julia-red hover:text-julia-red">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  )
}
