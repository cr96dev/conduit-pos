import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useToast, ToastContainer } from '../components/Toast'
import * as XLSX from 'xlsx'

const OAKLAND_ID = '85da69a8-1e81-48a7-8b0d-82df9eeec15e'

export default function Tienda({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('resumen')

  // Resumen
  const [vistaResumen, setVistaResumen] = useState('diaria')
  const [fechaResumen, setFechaResumen] = useState(new Date().toISOString().split('T')[0])
  const [fechaInicioResumen, setFechaInicioResumen] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`
  })
  const [fechaFinResumen, setFechaFinResumen] = useState(new Date().toISOString().split('T')[0])
  const [resumen, setResumen] = useState(null)
  const [cargandoResumen, setCargandoResumen] = useState(false)

  // Venta diaria
  const [registroVenta, setRegistroVenta] = useState(null)
  const [formVenta, setFormVenta] = useState({ efectivo: '', tarjeta: '', neonet: '', otros: '', notas: '' })
  const [guardandoVenta, setGuardandoVenta] = useState(false)

  // Gastos
  const [gastos, setGastos] = useState([])
  const [formGasto, setFormGasto] = useState({ descripcion: '', monto: '', categoria: 'General' })
  const [guardandoGasto, setGuardandoGasto] = useState(false)
  const [showFormGasto, setShowFormGasto] = useState(false)

  // Proveedores
  const [facturasProveedores, setFacturasProveedores] = useState([])
  const [showFormProveedor, setShowFormProveedor] = useState(false)
  const [formProveedor, setFormProveedor] = useState({
    proveedor: '', numero_factura: '',
    fecha_emision: new Date().toISOString().split('T')[0],
    fecha_vencimiento: '', descripcion: '', monto: '', estado: 'pendiente', notas: ''
  })
  const [guardandoProveedor, setGuardandoProveedor] = useState(false)

  const [itemsFEL, setItemsFEL] = useState([])
  const [categoriasAbiertas, setCategoriasAbiertas] = useState({})
  const [cargandoItemsFEL, setCargandoItemsFEL] = useState(false)
  const chartRef = useRef(null)
  const chartInstance = useRef(null)
  const { toasts, toast } = useToast()
  const hoy = new Date().toISOString().split('T')[0]
  const categorias = ['General', 'Limpieza', 'Mantenimiento', 'Personal', 'Servicios', 'Otros']

  useEffect(() => {
    if (!session) { router.push('/'); return }
    async function init() {
      const { data: p } = await supabase.from('perfiles').select('*, estaciones(*)').eq('id', session.user.id).single()
      if (!p) { router.push('/'); return }
      if (p.rol !== 'admin' && p.estacion_id !== OAKLAND_ID) { router.push('/dashboard'); return }
      setPerfil(p)
      setEstacion(p.estaciones)
      setLoading(false)
    }
    init()
  }, [session])

  useEffect(() => {
    if (!loading) {
      cargarResumen()
      cargarFacturasProveedores()
    }
  }, [loading])

  useEffect(() => {
    if (!loading) cargarResumen()
  }, [vistaResumen, fechaResumen, fechaInicioResumen, fechaFinResumen])

  useEffect(() => {
    if (resumen && vistaResumen !== 'diaria') renderizarGrafica()
  }, [resumen])

  function getRango() {
    if (vistaResumen === 'diaria') return { ini: fechaResumen, fin: fechaResumen }
    return { ini: fechaInicioResumen, fin: fechaFinResumen }
  }

  async function cargarResumen() {
    setCargandoResumen(true)
    const { ini, fin } = getRango()

    const [{ data: dataFEL }, { data: dataGastos }, { data: dataVentas }] = await Promise.all([
      supabase.rpc('resumen_tienda', { fecha_ini: ini, fecha_fin: fin }),
      supabase.rpc('resumen_gastos_tienda', { fecha_ini: ini, fecha_fin: fin }),
      supabase.rpc('resumen_ventas_tienda', { fecha_ini: ini, fecha_fin: fin }),
    ])

    const fel = dataFEL || {}
    const gs = dataGastos || {}
    const vs = dataVentas || {}

    const totalFEL = parseFloat(fel.total_fel || 0)
    const totalGastos = parseFloat(gs.total_gastos || 0)
    const totalEfectivo = parseFloat(vs.total_efectivo || 0)
    const totalTarjeta = parseFloat(vs.total_tarjeta || 0)
    const totalNeonet = parseFloat(vs.total_neonet || 0)
    const totalOtros = parseFloat(vs.total_otros || 0)
    const totalCobros = totalEfectivo + totalTarjeta + totalNeonet + totalOtros
    const cajaNeta = parseFloat(vs.caja_neta || 0)
    const cantidadFEL = parseInt(fel.cantidad_fel || 0)
    const porDia = fel.por_dia || {}
    const diasConVentas = Object.keys(porDia).length

    setResumen({
      totalFEL,
      cantidadFEL,
      porDia,
      diasConVentas,
      ticketPromedio: cantidadFEL > 0 ? totalFEL / cantidadFEL : 0,
      facturasDiarias: diasConVentas > 0 ? cantidadFEL / diasConVentas : cantidadFEL,
      ventaDiaria: diasConVentas > 0 ? totalFEL / diasConVentas : totalFEL,
      totalGastos,
      porCategoria: gs.por_categoria || {},
      totalEfectivo,
      totalTarjeta,
      totalNeonet,
      totalOtros,
      totalCobros,
      cajaNeta,
    })

    if (vistaResumen === 'diaria') {
      const { data: venta } = await supabase.from('tienda_ventas')
        .select('*').eq('fecha', fechaResumen).single()
      setRegistroVenta(venta || null)
      if (venta) {
        setFormVenta({ efectivo: venta.efectivo||'', tarjeta: venta.tarjeta||'', neonet: venta.neonet||'', otros: venta.otros||'', notas: venta.notas||'' })
      } else {
        setFormVenta({ efectivo: '', tarjeta: '', neonet: '', otros: '', notas: '' })
      }
      const { data: gsDetalle } = await supabase.from('tienda_gastos')
        .select('*').eq('fecha', fechaResumen).order('created_at', { ascending: false })
      setGastos(gsDetalle || [])
      await cargarItemsFEL(fechaResumen)
    } else {
      const { data: gsDetalle } = await supabase.from('tienda_gastos')
        .select('*').gte('fecha', ini).lte('fecha', fin).order('fecha', { ascending: false })
      setGastos(gsDetalle || [])
    }

    setCargandoResumen(false)
  }

  function renderizarGrafica() {
    if (!chartRef.current || !resumen) return
    const porCategoria = resumen.porCategoria
    const labels = Object.keys(porCategoria)
    if (labels.length === 0) return

    const cargarChart = () => {
      if (chartInstance.current) chartInstance.current.destroy()
      const datos = labels.map(l => parseFloat(porCategoria[l]))
      const colores = ['#3b82f6','#16a34a','#f59e0b','#dc2626','#8b5cf6','#0ea5e9','#f97316']
      chartInstance.current = new window.Chart(chartRef.current, {
        type: 'pie',
        data: {
          labels,
          datasets: [{
            data: datos,
            backgroundColor: colores.slice(0, labels.length),
            borderWidth: 2,
            borderColor: '#fff',
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } },
            tooltip: {
              callbacks: {
                label: ctx => ` Q${ctx.parsed.toLocaleString('es-GT', { minimumFractionDigits: 2 })} (${resumen.totalGastos > 0 ? ((ctx.parsed / resumen.totalGastos) * 100).toFixed(1) : 0}%)`
              }
            }
          }
        }
      })
    }

    if (window.Chart) cargarChart()
    else {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js'
      s.onload = cargarChart
      document.head.appendChild(s)
    }
  }

  async function cargarItemsFEL(fecha) {
    setCargandoItemsFEL(true)
    // Traer todos los items en páginas de 1000
    let todos = []
    let desde = 0
    const POR_PAGINA = 1000
    while (true) {
      const { data } = await supabase.from('tienda_facturas_fel_items')
        .select('descripcion, cantidad, total, precio_unitario')
        .eq('fecha', fecha)
        .range(desde, desde + POR_PAGINA - 1)
      if (!data || data.length === 0) break
      todos = todos.concat(data)
      if (data.length < POR_PAGINA) break
      desde += POR_PAGINA
    }
    // Agrupar por producto y categoría
    function getCategoria(desc) {
      const d = desc.toUpperCase()
      // Lubricantes
      if (d.includes('HELIX') || d.includes('RIMULA') || d.includes('SHELL ADVANCE') || d.includes('SHELL SPIRAX') || d.includes('UNO ULTRA') || d.includes('UNO FORZA') || d.includes('UNO IMPULSE') || d.includes('UNO SYNCHRON') || d.includes('FORZA EURO') || d.includes('LIQUIDO DE FRENOS') || d.includes('POWER STEERING') || d.includes('TOPGUARD') || d.includes('TOP GUARD') || d.includes('TP COOLANT') || d.includes('TP BRAKE') || d.includes('PRODIN') || d.includes('REFRIGERANTE') || d.includes('PLUMILLAS') || d.includes('GARANTIA') || d.includes('GARANTÍA')) return 'Lubricantes'
      // Bebidas Alcohólicas
      if (d.includes('CERVEZA') || d.includes('GALLO') || d.includes('CORONA') || d.includes('CABRO') || d.includes('MONTECARLO') || d.includes('HEINEKEN') || d.includes('MODELO') || d.includes('BRAHVA') || d.includes('PACIFICO') || d.includes('MOZA') || d.includes('MICHELADA BOTEL') || d.includes('JAGERMEISTER') || d.includes('BOTRAN') || d.includes('QUEZALTECA') || d.includes('BACARDI') || d.includes('SMIRNOFF') || d.includes('CUBATA') || d.includes('ADAN Y EVA') || d.includes('RON ') || d.includes('VINO ') || d.includes('RTD ')) return 'Bebidas Alcohólicas'
      // Bebidas No Alcohólicas
      if (d.includes('COCA') || d.includes('PEPSI') || d.includes('SPRITE') || d.includes('FANTA') || d.includes('AGUA ') || d.includes('AGUA PURA') || d.includes('SALVAVIDAS') || d.includes('DASANI') || d.includes('HIDRAVIDA') || d.includes('SALUTARIS') || d.includes('GATORADE') || d.includes('POWERADE') || d.includes('RED BULL') || d.includes('MONSTER') || d.includes('SOBE') || d.includes('ADRENALINE') || d.includes('7UP') || d.includes('MIRINDA') || d.includes('FRESCA') || d.includes('SANGRI') || d.includes('GRAPETTE') || d.includes('H2OH') || d.includes('MIX PARA MICHELADA') || d.includes('MICHELADA PREP') || d.includes('NECTAR') || d.includes('JUMEX') || d.includes('JUGOS') || d.includes('JUGO ') || d.includes('DEL VALLE') || d.includes('MARINERO') || d.includes('PELLEGRINO')) return 'Bebidas No Alcohólicas'
      // Café Premium
      if (d.includes('CAFE') || d.includes('CAFÉ') || d.includes('CAPPUCCINO') || d.includes('SMOOTHIE') || d.includes('LATTE') || d.includes('ESPRESSO')) return 'Café Premium'
      // Comida Rápida (hot dogs, pizzas, preparados del mostrador)
      if (d.includes('DOG') || d.includes('PIZZA') || d.includes('NACHOS') || d.includes('CROISSANT') || d.includes('MUFFIN') || d.includes('CIABATTA') || d.includes('DONA') || d.includes('POLLONAZO') || d.includes('BISTEQUESO') || d.includes('SANDWICH') || d.includes('SAND ') || d.includes('PAN INTEGRAL') || d.includes('PAN CIA')) return 'Comida Rápida'
      // Comida Preparada
      if (d.includes('PIZZA PER') || d.includes('PIZZA DOG') || d.includes('PIZZA PEPPER')) return 'Comida Preparada'
      // Tabaco
      if (d.includes('MARLBORO') || d.includes('PALL MALL') || d.includes('TEREA') || d.includes('VUSE') || d.includes('CIGARRO') || d.includes('ELECTRONICO') || d.includes('CAJETILLA') || d.includes('BENSON') || d.includes('WINSTON')) return 'Tabaco'
      // Snacks
      if (d.includes('PAPALINAS') || d.includes('LAYS') || d.includes('OREO') || d.includes('CHIKY') || d.includes('GALLETA') || d.includes('BOLSONA') || d.includes('SEÑORIAL') || d.includes('TRIDENT') || d.includes('CHICLE') || d.includes('CHOCOLATE') || d.includes('HERSHEY') || d.includes('SNICKER') || d.includes('TWIX') || d.includes('CHIPS') || d.includes('DORITOS') || d.includes('CHEETOS') || d.includes('MAIZ') || d.includes('PALOMITAS') || d.includes('GOMA') || d.includes('CARAMELO')) return 'Snacks'
      // Abarrotes
      if (d.includes('SOPA') || d.includes('CAFE MOLIDO') || d.includes('PANUELO') || d.includes('KLEENEX') || d.includes('PRESERVATIVO') || d.includes('DUREX') || d.includes('CREMA DENTAL') || d.includes('COLGATE') || d.includes('HIELO') || d.includes('IGLOO') || d.includes('ICEBERG')) return 'Abarrotes'
      // No Comestibles
      if (d.includes('ENCENDEDOR') || d.includes('PILA') || d.includes('BATERIA') || d.includes('BOLSA ') || d.includes('DESODORANTE') || d.includes('SHAMPOO')) return 'No Comestibles'
      // Perecederos
      if (d.includes('LECHE') || d.includes('YOGURT') || d.includes('QUESO') || d.includes('JAMON') || d.includes('HUEVO')) return 'Perecederos'
      return 'Otros'
    }
    const mapa = {}
    for (const item of todos) {
      const cat = getCategoria(item.descripcion)
      if (!mapa[cat]) mapa[cat] = {}
      if (!mapa[cat][item.descripcion]) mapa[cat][item.descripcion] = { descripcion: item.descripcion, cantidad: 0, total: 0, precio_unitario: parseFloat(item.precio_unitario) || 0 }
      mapa[cat][item.descripcion].cantidad += parseFloat(item.cantidad) || 0
      mapa[cat][item.descripcion].total += parseFloat(item.total) || 0
    }
    // Convertir a array por categoría ordenado por total desc
    const resultado = Object.entries(mapa).map(([cat, productos]) => ({
      categoria: cat,
      productos: Object.values(productos).sort((a, b) => b.total - a.total),
      total: Object.values(productos).reduce((s, p) => s + p.total, 0),
      cantidad: Object.values(productos).reduce((s, p) => s + p.cantidad, 0),
    })).sort((a, b) => b.total - a.total)
    setItemsFEL(resultado)
    setCargandoItemsFEL(false)
  }

  async function guardarVenta(e) {
    e.preventDefault()
    setGuardandoVenta(true)
    const efectivo = parseFloat(formVenta.efectivo) || 0
    const tarjeta = parseFloat(formVenta.tarjeta) || 0
    const neonet = parseFloat(formVenta.neonet) || 0
    const otros = parseFloat(formVenta.otros) || 0
    const totalVenta = efectivo + tarjeta + neonet + otros
    const totalGastosDia = gastos.reduce((s, g) => s + parseFloat(g.monto || 0), 0)
    const payload = {
      fecha: fechaResumen, total_venta: totalVenta,
      efectivo, tarjeta, neonet, otros,
      total_gastos: totalGastosDia,
      caja_neta: totalVenta - totalGastosDia,
      notas: formVenta.notas, creado_por: session.user.id
    }
    if (registroVenta) {
      const { error } = await supabase.from('tienda_ventas').update(payload).eq('id', registroVenta.id)
      if (error) toast('Error al actualizar', 'error')
      else toast('✓ Registro actualizado', 'success')
    } else {
      const { error } = await supabase.from('tienda_ventas').insert(payload)
      if (error) toast('Error al guardar', 'error')
      else toast('✓ Venta registrada', 'success')
    }
    await cargarResumen()
    setGuardandoVenta(false)
  }

  async function guardarGasto(e) {
    e.preventDefault()
    setGuardandoGasto(true)
    const { error } = await supabase.from('tienda_gastos').insert({
      fecha: fechaResumen, descripcion: formGasto.descripcion,
      monto: parseFloat(formGasto.monto) || 0,
      categoria: formGasto.categoria, creado_por: session.user.id
    })
    if (error) toast('Error al guardar', 'error')
    else {
      toast('✓ Gasto registrado', 'success')
      setFormGasto({ descripcion: '', monto: '', categoria: 'General' })
      setShowFormGasto(false)
      await cargarResumen()
    }
    setGuardandoGasto(false)
  }

  async function eliminarGasto(id) {
    if (!confirm('¿Eliminar este gasto?')) return
    await supabase.from('tienda_gastos').delete().eq('id', id)
    await cargarResumen()
    toast('Gasto eliminado', 'info')
  }

  async function cargarFacturasProveedores() {
    const { data } = await supabase.from('tienda_facturas_proveedores')
      .select('*').order('fecha_emision', { ascending: false })
    setFacturasProveedores(data || [])
  }

  async function guardarProveedor(e) {
    e.preventDefault()
    setGuardandoProveedor(true)
    const { error } = await supabase.from('tienda_facturas_proveedores').insert({
      ...formProveedor, monto: parseFloat(formProveedor.monto) || 0,
      creado_por: session.user.id
    })
    if (error) toast('Error al guardar', 'error')
    else {
      toast('✓ Factura registrada', 'success')
      setFormProveedor({ proveedor: '', numero_factura: '', fecha_emision: hoy, fecha_vencimiento: '', descripcion: '', monto: '', estado: 'pendiente', notas: '' })
      setShowFormProveedor(false)
      await cargarFacturasProveedores()
    }
    setGuardandoProveedor(false)
  }

  async function cambiarEstadoProveedor(id, estado) {
    await supabase.from('tienda_facturas_proveedores').update({ estado }).eq('id', id)
    setFacturasProveedores(prev => prev.map(f => f.id === id ? { ...f, estado } : f))
    toast('Estado actualizado', 'info')
  }

  function aplicarVistaResumen(v) {
    setVistaResumen(v)
    const d = new Date()
    const iso = x => x.toISOString().split('T')[0]
    if (v === 'diaria') {
      setFechaResumen(hoy)
    } else if (v === 'semanal') {
      const ini = new Date(); ini.setDate(d.getDate() - 6)
      setFechaInicioResumen(iso(ini)); setFechaFinResumen(hoy)
    } else if (v === 'mensual') {
      setFechaInicioResumen(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`)
      setFechaFinResumen(hoy)
    } else if (v === 'mes_anterior') {
      const ini = new Date(d.getFullYear(), d.getMonth()-1, 1)
      const fin = new Date(d.getFullYear(), d.getMonth(), 0)
      setFechaInicioResumen(iso(ini)); setFechaFinResumen(iso(fin))
    }
  }

  const [exportandoExcel, setExportandoExcel] = useState(false)

  async function exportarExcel() {
    setExportandoExcel(true)
    try {
      const { ini, fin } = getRango()

      // 1. Traer cobros diarios (tienda_ventas) - pequeño, sin paginar
      const { data: ventas } = await supabase.from('tienda_ventas')
        .select('fecha, efectivo, tarjeta, neonet, otros, notas')
        .gte('fecha', ini).lte('fecha', fin)
        .order('fecha')

      // 2. Traer FEL paginando (Supabase JS limita a 1000 filas por request)
      const PAGE_SIZE = 1000
      const fels = []
      let from = 0
      while (true) {
        const { data: page, error } = await supabase.from('tienda_facturas_fel')
          .select('fecha, numero_factura, uuid_fel, nit_cliente, nombre_cliente, monto, estado, tipo_documento')
          .eq('estacion_id', OAKLAND_ID)
          .gte('fecha', ini).lte('fecha', fin)
          .order('fecha').order('numero_factura')
          .range(from, from + PAGE_SIZE - 1)
        if (error) throw error
        if (!page || page.length === 0) break
        fels.push(...page)
        if (page.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }

      // 2. Hoja 1: resumen diario con cobros + FEL del dia
      const felPorDia = {}
      ;(fels || []).forEach(f => {
        const m = parseFloat(f.monto || 0)
        if (!felPorDia[f.fecha]) felPorDia[f.fecha] = { total: 0, cantidad: 0 }
        felPorDia[f.fecha].total += m
        felPorDia[f.fecha].cantidad += 1
      })

      // Set de todas las fechas con datos (ventas o FEL)
      const fechasSet = new Set([
        ...(ventas || []).map(v => v.fecha),
        ...Object.keys(felPorDia)
      ])
      const fechasOrdenadas = Array.from(fechasSet).sort()

      const ventaPorFecha = {}
      ;(ventas || []).forEach(v => { ventaPorFecha[v.fecha] = v })

      const hoja1 = fechasOrdenadas.map(fecha => {
        const v = ventaPorFecha[fecha] || {}
        const f = felPorDia[fecha] || { total: 0, cantidad: 0 }
        const efectivo = parseFloat(v.efectivo || 0)
        const tarjeta = parseFloat(v.tarjeta || 0)
        const neonet = parseFloat(v.neonet || 0)
        const otros = parseFloat(v.otros || 0)
        const totalCobros = efectivo + tarjeta + neonet + otros
        return {
          Fecha: fecha,
          Efectivo: efectivo,
          Tarjeta: tarjeta,
          Neonet: neonet,
          Otros: otros,
          'Total cobros': totalCobros,
          'Total FEL': f.total,
          'Cantidad FEL': f.cantidad,
          'Diferencia (cobros - FEL)': totalCobros - f.total,
          Notas: v.notas || ''
        }
      })

      // Fila de totales
      const totales = hoja1.reduce((acc, r) => ({
        Efectivo: acc.Efectivo + r.Efectivo,
        Tarjeta: acc.Tarjeta + r.Tarjeta,
        Neonet: acc.Neonet + r.Neonet,
        Otros: acc.Otros + r.Otros,
        'Total cobros': acc['Total cobros'] + r['Total cobros'],
        'Total FEL': acc['Total FEL'] + r['Total FEL'],
        'Cantidad FEL': acc['Cantidad FEL'] + r['Cantidad FEL'],
        'Diferencia (cobros - FEL)': acc['Diferencia (cobros - FEL)'] + r['Diferencia (cobros - FEL)'],
      }), { Efectivo:0, Tarjeta:0, Neonet:0, Otros:0, 'Total cobros':0, 'Total FEL':0, 'Cantidad FEL':0, 'Diferencia (cobros - FEL)':0 })

      hoja1.push({
        Fecha: 'TOTAL',
        ...totales,
        Notas: ''
      })

      // 3. Hoja 2: lista de FEL individuales
      const hoja2 = (fels || []).map(f => ({
        Fecha: f.fecha,
        'No. Factura': f.numero_factura,
        'UUID FEL': f.uuid_fel,
        NIT: f.nit_cliente,
        Cliente: f.nombre_cliente,
        Tipo: f.tipo_documento,
        Estado: f.estado,
        Monto: parseFloat(f.monto || 0)
      }))

      // 4. Construir workbook
      const wb = XLSX.utils.book_new()

      const ws1 = XLSX.utils.json_to_sheet(hoja1)
      ws1['!cols'] = [
        { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 },
        { wch: 13 }, { wch: 13 }, { wch: 11 }, { wch: 20 }, { wch: 30 }
      ]
      XLSX.utils.book_append_sheet(wb, ws1, 'Diario')

      const ws2 = XLSX.utils.json_to_sheet(hoja2)
      ws2['!cols'] = [
        { wch: 12 }, { wch: 14 }, { wch: 38 }, { wch: 14 },
        { wch: 30 }, { wch: 8 }, { wch: 12 }, { wch: 12 }
      ]
      XLSX.utils.book_append_sheet(wb, ws2, 'FEL detalle')

      // 5. Descargar
      const nombre = `tienda_${ini}_a_${fin}.xlsx`
      XLSX.writeFile(wb, nombre)
      toast(`Exportado ${hoja1.length - 1} dias / ${hoja2.length} facturas`, 'success')
    } catch (err) {
      console.error('[exportarExcel]', err)
      toast(`Error al exportar: ${err.message}`, 'error')
    }
    setExportandoExcel(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  )

  const totalCobrosForm = (parseFloat(formVenta.efectivo)||0) + (parseFloat(formVenta.tarjeta)||0) + (parseFloat(formVenta.neonet)||0) + (parseFloat(formVenta.otros)||0)
  const totalGastosDia = gastos.reduce((s, g) => s + parseFloat(g.monto||0), 0)
  const totalProvPendientes = facturasProveedores.filter(f => f.estado==='pendiente'||f.estado==='vencida').reduce((s,f)=>s+parseFloat(f.monto||0),0)
  const estadoColor = { pendiente:'bg-amber-50 text-amber-600', pagada:'bg-green-50 text-green-700', vencida:'bg-red-50 text-red-600' }

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <ToastContainer toasts={toasts} />
      <div className="p-6 max-w-4xl">
        <div className="mb-5">
          <h1 className="text-lg font-semibold text-gray-900">Tienda de Conveniencia Oakland</h1>
          <p className="text-sm text-gray-400">Panel administrativo</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 border-b border-gray-100">
          {[['resumen','Resumen'],['proveedores','Facturas proveedores']].map(([key,label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap ${tab===key?'border-blue-600 text-blue-700 font-medium':'border-transparent text-gray-500 hover:text-gray-700'}`}>
              {label}
              {key==='proveedores' && totalProvPendientes>0 && (
                <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                  Q{Math.round(totalProvPendientes).toLocaleString('es-GT')}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── Tab Resumen ── */}
        {tab === 'resumen' && (
          <div className="space-y-4">

            {/* Selector vista */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex gap-1.5 flex-wrap mb-3 items-center justify-between">
                <div className="flex gap-1.5 flex-wrap">
                  {[
                    {key:'diaria',label:'Hoy'},
                    {key:'semanal',label:'Esta semana'},
                    {key:'mensual',label:'Este mes'},
                    {key:'mes_anterior',label:'Mes anterior'},
                    {key:'personalizado',label:'Personalizado'},
                  ].map(v => (
                    <button key={v.key} onClick={() => aplicarVistaResumen(v.key)}
                      className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${vistaResumen===v.key?'bg-blue-600 border-blue-600 text-white font-medium':'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                      {v.label}
                    </button>
                  ))}
                </div>
                {perfil?.rol === 'admin' && (
                  <button onClick={exportarExcel} disabled={exportandoExcel}
                    className="text-xs px-3 py-1.5 rounded-lg border border-green-200 bg-green-50 text-green-700 hover:bg-green-100 disabled:opacity-50 font-medium flex items-center gap-1.5">
                    {exportandoExcel ? (
                      <>
                        <span className="w-3 h-3 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></span>
                        Generando...
                      </>
                    ) : (
                      <>↓ Descargar Excel</>
                    )}
                  </button>
                )}
              </div>
              {vistaResumen === 'diaria' && (
                <input type="date" value={fechaResumen} max={hoy}
                  onChange={e => setFechaResumen(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
              )}
              {vistaResumen === 'personalizado' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Inicio</label>
                    <input type="date" value={fechaInicioResumen} onChange={e => setFechaInicioResumen(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Fin</label>
                    <input type="date" value={fechaFinResumen} max={hoy} onChange={e => setFechaFinResumen(e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                </div>
              )}
            </div>

            {cargandoResumen ? (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              </div>
            ) : resumen && (
              <>
                {/* Tarjetas principales */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-blue-50 rounded-xl p-4">
                    <div className="text-xs text-blue-600 mb-1">Ventas FEL</div>
                    <div className="text-xl font-medium text-blue-800">Q{resumen.totalFEL.toLocaleString('es-GT',{maximumFractionDigits:2})}</div>
                    <div className="text-xs text-blue-400 mt-0.5">{resumen.cantidadFEL} facturas</div>
                  </div>
                  <div className="bg-green-50 rounded-xl p-4">
                    <div className="text-xs text-green-600 mb-1">Total cobros</div>
                    <div className="text-xl font-medium text-green-800">Q{resumen.totalCobros.toLocaleString('es-GT',{maximumFractionDigits:2})}</div>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-4">
                    <div className="text-xs text-amber-600 mb-1">Total gastos</div>
                    <div className="text-xl font-medium text-amber-800">Q{resumen.totalGastos.toLocaleString('es-GT',{maximumFractionDigits:2})}</div>
                  </div>
                  <div className={`rounded-xl p-4 ${resumen.cajaNeta>=0?'bg-gray-50':'bg-red-50'}`}>
                    <div className={`text-xs mb-1 ${resumen.cajaNeta>=0?'text-gray-600':'text-red-600'}`}>Caja neta</div>
                    <div className={`text-xl font-medium ${resumen.cajaNeta>=0?'text-gray-800':'text-red-700'}`}>Q{resumen.cajaNeta.toLocaleString('es-GT',{maximumFractionDigits:2})}</div>
                  </div>
                </div>

                {/* Métricas */}
                {resumen.cantidadFEL > 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 p-5">
                    <h2 className="text-sm font-medium text-gray-700 mb-3">
                      Métricas {vistaResumen === 'diaria' ? 'del día' : 'del período'}
                    </h2>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center p-4 bg-gray-50 rounded-xl">
                        <div className="text-xs text-gray-500 mb-1">Ticket promedio</div>
                        <div className="text-lg font-medium text-gray-800">
                          Q{resumen.ticketPromedio.toLocaleString('es-GT',{maximumFractionDigits:2})}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">por factura</div>
                      </div>
                      <div className="text-center p-4 bg-gray-50 rounded-xl">
                        <div className="text-xs text-gray-500 mb-1">Facturas por día</div>
                        <div className="text-lg font-medium text-gray-800">
                          {vistaResumen === 'diaria'
                            ? resumen.cantidadFEL
                            : resumen.facturasDiarias.toFixed(1)}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">promedio diario</div>
                      </div>
                      <div className="text-center p-4 bg-gray-50 rounded-xl">
                        <div className="text-xs text-gray-500 mb-1">Venta por día</div>
                        <div className="text-lg font-medium text-gray-800">
                          Q{(vistaResumen === 'diaria'
                            ? resumen.totalFEL
                            : resumen.ventaDiaria
                          ).toLocaleString('es-GT',{maximumFractionDigits:0})}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5">promedio diario</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Formas de cobro */}
                {resumen.totalCobros > 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 p-5">
                    <h2 className="text-sm font-medium text-gray-700 mb-3">Formas de cobro</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        {label:'Efectivo',val:resumen.totalEfectivo,color:'text-green-700'},
                        {label:'Tarjeta',val:resumen.totalTarjeta,color:'text-blue-700'},
                        {label:'Neonet',val:resumen.totalNeonet,color:'text-purple-700'},
                        {label:'Otros',val:resumen.totalOtros,color:'text-gray-700'},
                      ].map(m => (
                        <div key={m.label} className="text-center p-3 bg-gray-50 rounded-xl">
                          <div className="text-xs text-gray-500 mb-1">{m.label}</div>
                          <div className={`text-base font-medium ${m.color}`}>Q{m.val.toLocaleString('es-GT',{maximumFractionDigits:2})}</div>
                          {resumen.totalCobros > 0 && (
                            <div className="text-xs text-gray-400 mt-0.5">{((m.val/resumen.totalCobros)*100).toFixed(1)}%</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Gráfica pie gastos — solo períodos */}
                {vistaResumen !== 'diaria' && resumen.totalGastos > 0 && Object.keys(resumen.porCategoria).length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 p-5">
                    <h2 className="text-sm font-medium text-gray-700 mb-3">Gastos por categoría</h2>
                    <div style={{height:260,position:'relative'}}>
                      <canvas ref={chartRef}></canvas>
                    </div>
                  </div>
                )}

                {/* Ventas por día — solo períodos */}
                {vistaResumen !== 'diaria' && Object.keys(resumen.porDia).length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                      <h2 className="text-sm font-medium text-gray-700">Ventas FEL por día</h2>
                      <span className="text-xs text-gray-400">Total: Q{resumen.totalFEL.toLocaleString('es-GT',{maximumFractionDigits:2})}</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="px-5 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                          <th className="px-5 py-2.5 text-right text-xs text-gray-400 font-normal">Total (Q)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(resumen.porDia).sort((a,b)=>b[0].localeCompare(a[0])).map(([fecha,total]) => (
                          <tr key={fecha} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-5 py-2.5 text-gray-700">{fecha}</td>
                            <td className="px-5 py-2.5 text-right font-medium text-gray-800">Q{parseFloat(total).toLocaleString('es-GT',{maximumFractionDigits:2})}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Items FEL del día */}
                {vistaResumen === 'diaria' && (
                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                      <h2 className="text-sm font-medium text-gray-700">Detalle de ventas FEL — {fechaResumen}</h2>
                      {cargandoItemsFEL && <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>}
                    </div>
                    {itemsFEL.length === 0 ? (
                      <div className="py-6 text-center text-xs text-gray-400">
                        {cargandoItemsFEL ? 'Cargando...' : 'Sin ventas FEL para esta fecha'}
                      </div>
                    ) : (
                      <div>
                        {itemsFEL.map((cat, ci) => (
                          <div key={ci} className="border-b border-gray-100 last:border-0">
                            <button
                              onClick={() => setCategoriasAbiertas(prev => ({ ...prev, [cat.categoria]: !prev[cat.categoria] }))}
                              className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
                              <div className="flex items-center gap-2">
                                <svg className={`w-4 h-4 text-gray-400 transition-transform ${categoriasAbiertas[cat.categoria] ? 'rotate-180' : ''}`}
                                  fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                                </svg>
                                <span className="text-sm font-medium text-gray-800">{cat.categoria}</span>
                                <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{cat.productos.length} productos</span>
                              </div>
                              <div className="text-right">
                                <div className="text-sm font-semibold text-gray-900">Q{cat.total.toLocaleString('es-GT',{minimumFractionDigits:2})}</div>
                                <div className="text-xs text-gray-400">{cat.cantidad.toLocaleString('es-GT')} unidades</div>
                              </div>
                            </button>
                            {categoriasAbiertas[cat.categoria] && (
                              <table className="w-full text-xs border-t border-gray-50">
                                <thead>
                                  <tr className="bg-gray-50">
                                    <th className="px-8 py-2 text-left text-gray-400 font-normal">Producto</th>
                                    <th className="px-3 py-2 text-center text-gray-400 font-normal">Cant.</th>
                                    <th className="px-5 py-2 text-right text-gray-400 font-normal">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {cat.productos.map((p, pi) => (
                                    <tr key={pi} className="border-t border-gray-50 hover:bg-gray-50">
                                      <td className="px-8 py-2 text-gray-700">{p.descripcion}</td>
                                      <td className="px-3 py-2 text-center text-gray-500">{p.cantidad.toLocaleString('es-GT')}</td>
                                      <td className="px-5 py-2 text-right font-medium text-gray-800">Q{p.total.toLocaleString('es-GT',{minimumFractionDigits:2})}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        ))}
                        <div className="flex justify-between px-5 py-3 bg-gray-50 border-t border-gray-100">
                          <span className="text-sm font-semibold text-gray-700">Total general</span>
                          <span className="text-sm font-bold text-gray-900">
                            Q{itemsFEL.reduce((s,c) => s + c.total, 0).toLocaleString('es-GT',{minimumFractionDigits:2})}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Formulario diario */}
                {vistaResumen === 'diaria' && (
                  <>
                    <div className="bg-white rounded-xl border border-gray-100 p-5">
                      <h2 className="text-sm font-medium text-gray-700 mb-3">Formas de cobro del día</h2>
                      <form onSubmit={guardarVenta} onKeyDown={e => { if(e.key==='Enter') e.preventDefault() }}>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          {[{key:'efectivo',label:'Efectivo'},{key:'tarjeta',label:'Tarjeta'},{key:'neonet',label:'Neonet'},{key:'otros',label:'Otros'}].map(m => (
                            <div key={m.key}>
                              <label className="text-xs text-gray-500 block mb-1">{m.label} (Q)</label>
                              <input type="number" min="0" step="0.01" value={formVenta[m.key]}
                                onChange={e => setFormVenta(f=>({...f,[m.key]:e.target.value}))}
                                placeholder="0.00"
                                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                            </div>
                          ))}
                        </div>
                        {totalCobrosForm > 0 && (
                          <div className="border-t border-gray-100 pt-3 mb-3 flex justify-between text-sm font-medium text-gray-800">
                            <span>Total cobros</span>
                            <span>Q{totalCobrosForm.toLocaleString('es-GT',{maximumFractionDigits:2})}</span>
                          </div>
                        )}
                        <div className="mb-3">
                          <label className="text-xs text-gray-500 block mb-1">Notas</label>
                          <input value={formVenta.notas} onChange={e => setFormVenta(f=>({...f,notas:e.target.value}))}
                            placeholder="Observaciones del día..."
                            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                        </div>
                        <div className="flex justify-end">
                          <button type="submit" disabled={guardandoVenta}
                            className="bg-blue-600 text-white text-sm px-5 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                            {guardandoVenta && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                            {guardandoVenta ? 'Guardando...' : registroVenta ? 'Actualizar' : 'Guardar'}
                          </button>
                        </div>
                      </form>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-100 p-5">
                      <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-medium text-gray-700">Gastos del día</h2>
                        <button onClick={() => setShowFormGasto(!showFormGasto)}
                          className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">
                          + Agregar gasto
                        </button>
                      </div>
                      {showFormGasto && (
                        <form onSubmit={guardarGasto} onKeyDown={e => { if(e.key==='Enter') e.preventDefault() }}
                          className="bg-gray-50 rounded-xl p-4 mb-3 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="text-xs text-gray-500 block mb-1">Descripción</label>
                              <input value={formGasto.descripcion} onChange={e => setFormGasto(f=>({...f,descripcion:e.target.value}))} required
                                placeholder="Ej: Compra de bolsas"
                                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Monto (Q)</label>
                              <input type="number" min="0" step="0.01" value={formGasto.monto}
                                onChange={e => setFormGasto(f=>({...f,monto:e.target.value}))} required placeholder="0.00"
                                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                            </div>
                            <div>
                              <label className="text-xs text-gray-500 block mb-1">Categoría</label>
                              <select value={formGasto.categoria} onChange={e => setFormGasto(f=>({...f,categoria:e.target.value}))}
                                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                                {categorias.map(c => <option key={c}>{c}</option>)}
                              </select>
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => setShowFormGasto(false)}
                              className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                            <button type="submit" disabled={guardandoGasto}
                              className="text-sm px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                              {guardandoGasto ? 'Guardando...' : 'Guardar'}
                            </button>
                          </div>
                        </form>
                      )}
                      {gastos.length === 0 ? (
                        <div className="text-xs text-gray-400 text-center py-4">Sin gastos registrados</div>
                      ) : (
                        <div className="space-y-1">
                          {gastos.map(g => (
                            <div key={g.id} className="flex items-center justify-between py-2 border-b border-gray-50">
                              <div>
                                <div className="text-sm text-gray-700">{g.descripcion}</div>
                                <div className="text-xs text-gray-400">{g.categoria}</div>
                              </div>
                              <div className="flex items-center gap-3">
                                <span className="text-sm font-medium text-gray-800">Q{parseFloat(g.monto).toLocaleString('es-GT',{maximumFractionDigits:2})}</span>
                                <button onClick={() => eliminarGasto(g.id)} className="text-xs text-red-400 hover:text-red-600">Eliminar</button>
                              </div>
                            </div>
                          ))}
                          <div className="flex justify-between pt-2 text-sm font-medium text-gray-800">
                            <span>Total gastos</span>
                            <span>Q{totalGastosDia.toLocaleString('es-GT',{maximumFractionDigits:2})}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Gastos detalle períodos */}
                {vistaResumen !== 'diaria' && gastos.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                    <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                      <h2 className="text-sm font-medium text-gray-700">Detalle de gastos</h2>
                      <span className="text-xs text-gray-400">Total: Q{resumen.totalGastos.toLocaleString('es-GT',{maximumFractionDigits:2})}</span>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="px-5 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                          <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Descripción</th>
                          <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Categoría</th>
                          <th className="px-5 py-2.5 text-right text-xs text-gray-400 font-normal">Monto</th>
                        </tr>
                      </thead>
                      <tbody>
                        {gastos.map(g => (
                          <tr key={g.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-5 py-2.5 text-xs text-gray-500">{g.fecha}</td>
                            <td className="px-3 py-2.5 text-gray-700">{g.descripcion}</td>
                            <td className="px-3 py-2.5 text-xs text-gray-500">{g.categoria}</td>
                            <td className="px-5 py-2.5 text-right font-medium text-gray-800">Q{parseFloat(g.monto).toLocaleString('es-GT',{maximumFractionDigits:2})}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Tab Proveedores ── */}
        {tab === 'proveedores' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex gap-3">
                <div className="bg-amber-50 rounded-xl px-4 py-3">
                  <div className="text-xs text-amber-600 mb-0.5">Por pagar</div>
                  <div className="text-lg font-medium text-amber-800">
                    Q{facturasProveedores.filter(f=>f.estado==='pendiente'||f.estado==='vencida').reduce((s,f)=>s+parseFloat(f.monto||0),0).toLocaleString('es-GT',{maximumFractionDigits:0})}
                  </div>
                </div>
                <div className="bg-red-50 rounded-xl px-4 py-3">
                  <div className="text-xs text-red-600 mb-0.5">Vencidas</div>
                  <div className="text-lg font-medium text-red-800">{facturasProveedores.filter(f=>f.estado==='vencida').length}</div>
                </div>
              </div>
              <button onClick={() => setShowFormProveedor(!showFormProveedor)}
                className="bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700">
                + Registrar factura
              </button>
            </div>

            {showFormProveedor && (
              <form onSubmit={guardarProveedor} onKeyDown={e => { if(e.key==='Enter') e.preventDefault() }}
                className="bg-white rounded-xl border border-blue-100 p-5">
                <h2 className="text-sm font-medium text-gray-700 mb-4">Nueva factura de proveedor</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Proveedor</label>
                    <input value={formProveedor.proveedor} onChange={e => setFormProveedor(f=>({...f,proveedor:e.target.value}))} required
                      placeholder="Nombre del proveedor"
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">No. Factura</label>
                    <input value={formProveedor.numero_factura} onChange={e => setFormProveedor(f=>({...f,numero_factura:e.target.value}))}
                      placeholder="001-001-000001"
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Fecha emisión</label>
                    <input type="date" value={formProveedor.fecha_emision} onChange={e => setFormProveedor(f=>({...f,fecha_emision:e.target.value}))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Fecha vencimiento</label>
                    <input type="date" value={formProveedor.fecha_vencimiento} onChange={e => setFormProveedor(f=>({...f,fecha_vencimiento:e.target.value}))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Monto (Q)</label>
                    <input type="number" min="0" step="0.01" value={formProveedor.monto}
                      onChange={e => setFormProveedor(f=>({...f,monto:e.target.value}))} required placeholder="0.00"
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 block mb-1">Estado</label>
                    <select value={formProveedor.estado} onChange={e => setFormProveedor(f=>({...f,estado:e.target.value}))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                      <option value="pendiente">Pendiente</option>
                      <option value="pagada">Pagada</option>
                      <option value="vencida">Vencida</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 block mb-1">Descripción</label>
                    <input value={formProveedor.descripcion} onChange={e => setFormProveedor(f=>({...f,descripcion:e.target.value}))}
                      placeholder="Descripción de la factura"
                      className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
                  </div>
                </div>
                <div className="flex gap-2 justify-end mt-4">
                  <button type="button" onClick={() => setShowFormProveedor(false)}
                    className="text-sm px-4 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
                  <button type="submit" disabled={guardandoProveedor}
                    className="text-sm px-5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                    {guardandoProveedor ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </form>
            )}

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {facturasProveedores.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">Sin facturas de proveedores registradas</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Proveedor</th>
                      <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Emisión</th>
                      <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Vencimiento</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Monto</th>
                      <th className="px-3 py-2.5 text-center text-xs text-gray-400 font-normal">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facturasProveedores.map(f => (
                      <tr key={f.id} className={`border-b border-gray-50 hover:bg-gray-50 ${f.estado==='vencida'?'bg-red-50/30':''}`}>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-gray-800">{f.proveedor}</div>
                          {f.numero_factura && <div className="text-xs text-gray-400">{f.numero_factura}</div>}
                          {f.descripcion && <div className="text-xs text-gray-400">{f.descripcion}</div>}
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-600">{f.fecha_emision}</td>
                        <td className="px-3 py-3 text-xs text-gray-600">{f.fecha_vencimiento||'—'}</td>
                        <td className="px-3 py-3 text-right font-medium text-gray-800">Q{parseFloat(f.monto).toLocaleString('es-GT',{maximumFractionDigits:2})}</td>
                        <td className="px-3 py-3 text-center">
                          <select value={f.estado} onChange={e => cambiarEstadoProveedor(f.id,e.target.value)}
                            className={`text-xs px-2.5 py-0.5 rounded-full font-medium border-0 cursor-pointer focus:outline-none ${estadoColor[f.estado]}`}>
                            <option value="pendiente">Pendiente</option>
                            <option value="pagada">Pagada</option>
                            <option value="vencida">Vencida</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
