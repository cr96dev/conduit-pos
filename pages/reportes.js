import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useToast, ToastContainer } from '../components/Toast'
import * as XLSX from 'xlsx'

const metodosPago = ['neonet','bac','deposito','cupon','neonet_prepago','descuento_club_bi','ach_transferencia','flota_credomatic','caja_chica','vales_clientes','uno_plus','nomina','descuento_amigo','piloto','gasoline','prueba_surtidor']
const metodosLabel = { neonet:'Neonet', bac:'BAC', deposito:'Depósito', cupon:'Cupón', neonet_prepago:'Neonet Prepago', descuento_club_bi:'Descuento Club Bi', ach_transferencia:'ACH / Transferencia', flota_credomatic:'Flota Credomatic', caja_chica:'Caja Chica', vales_clientes:'Vales Clientes', uno_plus:'Uno Plus', nomina:'Nómina', descuento_amigo:'Descuento Amigo', piloto:'Piloto', gasoline:'Gasoline', prueba_surtidor:'Prueba de surtidor' }

export default function Reportes({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estaciones, setEstaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [generando, setGenerando] = useState(false)
  const [progreso, setProgreso] = useState('')
  const [fechaInicio, setFechaInicio] = useState(() => {
    const d = new Date(); d.setDate(1)
    return d.toISOString().split('T')[0]
  })
  const [fechaFin, setFechaFin] = useState(new Date().toISOString().split('T')[0])
  const [seccionesSeleccionadas, setSeccionesSeleccionadas] = useState({
    ventas: true, lubricantes: true, entregas: true, facturas: true, inventario: true
  })
  const { toasts, toast } = useToast()

  useEffect(() => {
    if (!session) { router.push('/'); return }
    async function init() {
      const { data: p } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single()
      if (!p || p.rol !== 'admin') { router.push('/dashboard'); return }
      setPerfil(p)
      const { data: ests } = await supabase.from('estaciones').select('*').eq('activa', true).order('nombre')
      setEstaciones(ests || [])
      setLoading(false)
    }
    init()
  }, [session])

  function toggleSeccion(key) {
    setSeccionesSeleccionadas(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function generarReporte() {
    setGenerando(true)
    const wb = XLSX.utils.book_new()
    const fechaStr = `${fechaInicio}_al_${fechaFin}`

    try {
      // ── VENTAS ──
      if (seccionesSeleccionadas.ventas) {
        setProgreso('Cargando ventas...')
        const { data: ventas } = await supabase.from('ventas').select('*, estaciones(nombre)')
          .gte('fecha', fechaInicio).lte('fecha', fechaFin)
          .order('fecha', { ascending: false })

        const filas = (ventas || []).map(v => {
          const totalIngresos = parseFloat(v.regular_ingresos||0)+parseFloat(v.premium_ingresos||0)+parseFloat(v.diesel_ingresos||0)+parseFloat(v.diesel_plus_ingresos||0)
          const totalCobros = metodosPago.reduce((s,m) => s+(parseFloat(v[m])||0), 0)
          const fila = {
            Estación: v.estaciones?.nombre || '',
            Fecha: v.fecha,
            'Regular (gal)': parseFloat(v.regular_litros||0),
            'Regular (Q)': parseFloat(v.regular_ingresos||0),
            'Super (gal)': parseFloat(v.premium_litros||0),
            'Super (Q)': parseFloat(v.premium_ingresos||0),
            'Diesel (gal)': parseFloat(v.diesel_litros||0),
            'Diesel (Q)': parseFloat(v.diesel_ingresos||0),
            'V-Power (gal)': parseFloat(v.diesel_plus_litros||0),
            'V-Power (Q)': parseFloat(v.diesel_plus_ingresos||0),
            'Total Ingresos (Q)': totalIngresos,
          }
          metodosPago.forEach(m => { fila[metodosLabel[m]] = parseFloat(v[m]||0) })
          fila['Total Cobros (Q)'] = totalCobros
          fila['Diferencia (Q)'] = parseFloat((totalIngresos - totalCobros).toFixed(2))
          fila['Notas'] = v.notas || ''
          return fila
        })

        // Agregar totales por estación
        const totalesPorEstacion = {}
        filas.forEach(f => {
          const est = f['Estación']
          if (!totalesPorEstacion[est]) totalesPorEstacion[est] = { ingresos: 0, galones: 0 }
          totalesPorEstacion[est].ingresos += f['Total Ingresos (Q)']
          totalesPorEstacion[est].galones += f['Regular (gal)']+f['Super (gal)']+f['Diesel (gal)']+f['V-Power (gal)']
        })

        const ws = XLSX.utils.json_to_sheet(filas)
        aplicarEstilos(ws, filas.length)
        XLSX.utils.book_append_sheet(wb, ws, 'Ventas')
      }

      // ── LUBRICANTES ──
      if (seccionesSeleccionadas.lubricantes) {
        setProgreso('Cargando lubricantes...')
        const { data: lubItems } = await supabase.from('facturas_fel_items')
          .select('descripcion, cantidad, total, precio_unitario, fecha, estacion_id, estaciones(nombre)')
          .gte('fecha', fechaInicio).lte('fecha', fechaFin)
          .order('fecha', { ascending: false })

        const EXCLUIR = new Set(['Ajuste de Distribución equitativa del mes de abril de 2026.'])
        const filas = (lubItems || [])
          .filter(i => !EXCLUIR.has(i.descripcion))
          .map(i => ({
            Estación: i.estaciones?.nombre || '',
            Fecha: i.fecha,
            Producto: i.descripcion || '',
            Cantidad: parseFloat(i.cantidad||0),
            'Precio unitario (Q)': parseFloat(i.precio_unitario||0),
            'Total (Q)': parseFloat(i.total||0),
          }))

        const ws = XLSX.utils.json_to_sheet(filas)
        aplicarEstilos(ws, filas.length)
        XLSX.utils.book_append_sheet(wb, ws, 'Lubricantes')
      }

      // ── ENTREGAS ──
      if (seccionesSeleccionadas.entregas) {
        setProgreso('Cargando entregas...')
        const { data: entregas } = await supabase.from('entregas')
          .select('*, estaciones(nombre)')
          .gte('fecha_entrega', fechaInicio).lte('fecha_entrega', fechaFin)
          .order('fecha_entrega', { ascending: false })

        const filas = (entregas || []).map(e => ({
          Estación: e.estaciones?.nombre || '',
          Fecha: e.fecha_entrega,
          Proveedor: e.proveedor || '',
          'Regular (gal)': parseFloat(e.regular_galones||0),
          'Super (gal)': parseFloat(e.premium_galones||0),
          'Diesel (gal)': parseFloat(e.diesel_galones||0),
          'V-Power (gal)': parseFloat(e.diesel_plus_galones||0),
          'Total galones': parseFloat(e.total_galones||e.volumen_litros||0),
          Estado: e.estado || '',
          Notas: e.notas || ''
        }))

        const ws = XLSX.utils.json_to_sheet(filas)
        aplicarEstilos(ws, filas.length)
        XLSX.utils.book_append_sheet(wb, ws, 'Entregas')
      }

      // ── FACTURAS ──
      if (seccionesSeleccionadas.facturas) {
        setProgreso('Cargando facturas...')
        const { data: facturas } = await supabase.from('facturas')
          .select('*, estaciones(nombre)')
          .gte('fecha_emision', fechaInicio).lte('fecha_emision', fechaFin)
          .order('fecha_emision', { ascending: false })

        const filas = (facturas || []).map(f => ({
          Estación: f.estaciones?.nombre || '',
          'No. Factura': f.numero_factura || '',
          Proveedor: f.proveedor || '',
          'Fecha emisión': f.fecha_emision,
          'Fecha vencimiento': f.fecha_vencimiento,
          'Monto (Q)': parseFloat(f.monto||0),
          Estado: f.estado || '',
          Notas: f.notas || ''
        }))

        const ws = XLSX.utils.json_to_sheet(filas)
        aplicarEstilos(ws, filas.length)
        XLSX.utils.book_append_sheet(wb, ws, 'Facturas')
      }

      // ── INVENTARIO ──
      if (seccionesSeleccionadas.inventario) {
        setProgreso('Cargando inventario...')
        const { data: inventario } = await supabase.from('inventario')
          .select('*, estaciones(nombre)')
          .order('estaciones(nombre)', { ascending: true })

        const filas = (inventario || []).map(i => ({
          Estación: i.estaciones?.nombre || '',
          Producto: i.producto || '',
          Categoría: i.categoria || '',
          'Stock actual': parseFloat(i.stock_actual || 0),
          'Stock mínimo': parseFloat(i.stock_minimo || 0),
          Unidad: i.unidad || '',
          Estado: parseFloat(i.stock_actual || 0) <= parseFloat(i.stock_minimo || 0) ? 'Bajo stock' : 'OK',
          'Última actualización': i.updated_at?.split('T')[0] || ''
        }))

        const ws = XLSX.utils.json_to_sheet(filas)
        aplicarEstilos(ws, filas.length)
        XLSX.utils.book_append_sheet(wb, ws, 'Inventario')
      }

      // ── RESUMEN EJECUTIVO ──
      setProgreso('Generando resumen ejecutivo...')
      const { data: ventasResumen } = await supabase.from('ventas')
        .select('estacion_id, regular_ingresos, premium_ingresos, diesel_ingresos, diesel_plus_ingresos, regular_litros, premium_litros, diesel_litros, diesel_plus_litros, estaciones(nombre)')
        .gte('fecha', fechaInicio).lte('fecha', fechaFin)

      const resumenMap = {}
      estaciones.forEach(est => {
        resumenMap[est.id] = { estacion: est.nombre, ingresos: 0, galones: 0 }
      })
      ;(ventasResumen || []).forEach(v => {
        if (!resumenMap[v.estacion_id]) return
        resumenMap[v.estacion_id].ingresos += parseFloat(v.regular_ingresos||0)+parseFloat(v.premium_ingresos||0)+parseFloat(v.diesel_ingresos||0)+parseFloat(v.diesel_plus_ingresos||0)
        resumenMap[v.estacion_id].galones += parseFloat(v.regular_litros||0)+parseFloat(v.premium_litros||0)+parseFloat(v.diesel_litros||0)+parseFloat(v.diesel_plus_litros||0)
      })

      const resumenFilas = Object.values(resumenMap).map(r => ({
        Estación: r.estacion,
        'Ingresos combustible (Q)': parseFloat(r.ingresos.toFixed(2)),
        'Galones vendidos': parseFloat(r.galones.toFixed(1)),
      }))

      const totalIngresos = resumenFilas.reduce((s,r) => s+r['Ingresos combustible (Q)'], 0)
      const totalGalones = resumenFilas.reduce((s,r) => s+r['Galones vendidos'], 0)
      resumenFilas.push({
        Estación: 'TOTAL RED',
        'Ingresos combustible (Q)': parseFloat(totalIngresos.toFixed(2)),
        'Galones vendidos': parseFloat(totalGalones.toFixed(1)),
      })

      const wsResumen = XLSX.utils.json_to_sheet(resumenFilas)
      aplicarEstilos(wsResumen, resumenFilas.length)
      XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen ejecutivo')

      // Descargar
      const nombreArchivo = `Reporte_Hidrocom_${fechaStr}.xlsx`
      XLSX.writeFile(wb, nombreArchivo)
      toast('✓ Reporte generado y descargado', 'success')

    } catch (err) {
      toast(`Error: ${err.message}`, 'error')
    }

    setProgreso('')
    setGenerando(false)
  }

  function aplicarEstilos(ws, numFilas) {
    if (!ws['!cols']) ws['!cols'] = []
    for (let i = 0; i < 20; i++) {
      ws['!cols'][i] = { wch: 20 }
    }
  }

  if (loading) return <div className="flex items-center justify-center h-screen text-sm text-gray-400">Cargando...</div>

  const secciones = [
    { key: 'ventas', label: 'Ventas de combustible', desc: 'Ingresos, galones y formas de cobro por estación', color: 'blue' },
    { key: 'lubricantes', label: 'Ventas de lubricantes', desc: 'Detalle de productos vendidos por estación', color: 'green' },
    { key: 'entregas', label: 'Entregas de combustible', desc: 'Registro de entregas recibidas por estación', color: 'amber' },
    { key: 'facturas', label: 'Facturas', desc: 'Facturas pendientes, pagadas y vencidas', color: 'purple' },
    { key: 'inventario', label: 'Inventario', desc: 'Registros de inventario por estación', color: 'gray' },
  ]

  const colorMap = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    purple: 'bg-purple-50 border-purple-200 text-purple-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
  }

  const seleccionadas = Object.values(seccionesSeleccionadas).filter(Boolean).length

  return (
    <Layout perfil={perfil} estacion={null}>
      <ToastContainer toasts={toasts} />
      <div className="p-6 max-w-2xl">
        <div className="mb-6">
          <h1 className="text-lg font-semibold text-gray-900">Reportes consolidados</h1>
          <p className="text-sm text-gray-400">Genera un Excel con todas las estaciones en un solo archivo</p>
        </div>

        {/* Rango de fechas */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Rango de fechas</h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Fecha inicio</label>
              <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Fecha fin</label>
              <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            {[
              { label: 'Este mes', fn: () => { const d = new Date(); setFechaInicio(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`); setFechaFin(d.toISOString().split('T')[0]) } },
              { label: 'Mes anterior', fn: () => { const d = new Date(); d.setMonth(d.getMonth()-1); const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dias = new Date(y, d.getMonth()+1, 0).getDate(); setFechaInicio(`${y}-${m}-01`); setFechaFin(`${y}-${m}-${dias}`) } },
              { label: 'Últimos 7 días', fn: () => { const fin = new Date(); const ini = new Date(); ini.setDate(ini.getDate()-6); setFechaInicio(ini.toISOString().split('T')[0]); setFechaFin(fin.toISOString().split('T')[0]) } },
              { label: 'Este año', fn: () => { const y = new Date().getFullYear(); setFechaInicio(`${y}-01-01`); setFechaFin(new Date().toISOString().split('T')[0]) } },
            ].map(btn => (
              <button key={btn.label} onClick={btn.fn}
                className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors">
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Secciones */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-gray-700">Pestañas a incluir</h2>
            <button onClick={() => setSeccionesSeleccionadas({ ventas: true, lubricantes: true, entregas: true, facturas: true, inventario: true })}
              className="text-xs text-blue-600 hover:text-blue-800">Seleccionar todas</button>
          </div>
          <div className="space-y-2">
            {secciones.map(s => (
              <label key={s.key} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${seccionesSeleccionadas[s.key] ? colorMap[s.color] : 'bg-gray-50 border-gray-100 text-gray-500'}`}>
                <input type="checkbox" checked={seccionesSeleccionadas[s.key]} onChange={() => toggleSeccion(s.key)} className="rounded" />
                <div>
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-xs opacity-70">{s.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-400">
            El reporte siempre incluye una pestaña de <span className="font-medium text-gray-600">Resumen ejecutivo</span> con totales por estación.
          </div>
        </div>

        {/* Estaciones incluidas */}
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
          <h2 className="text-sm font-medium text-gray-700 mb-3">Estaciones incluidas</h2>
          <div className="grid grid-cols-2 gap-2">
            {estaciones.map(est => (
              <div key={est.id} className="flex items-center gap-2 text-xs text-gray-600">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                {est.nombre}
              </div>
            ))}
          </div>
        </div>

        {/* Botón generar */}
        <button onClick={generarReporte} disabled={generando || seleccionadas === 0}
          className="w-full bg-blue-600 text-white text-sm font-medium py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-3">
          {generando ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>{progreso || 'Generando reporte...'}</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Generar y descargar Excel ({seleccionadas + 1} pestañas)
            </>
          )}
        </button>

        {generando && (
          <div className="mt-3 bg-blue-50 rounded-xl px-4 py-3 text-xs text-blue-700 text-center">
            Esto puede tomar unos segundos dependiendo del volumen de datos...
          </div>
        )}
      </div>
    </Layout>
  )
}
