import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Layout from '../../components/Layout'
import { useToast, ToastContainer } from '../../components/Toast'

export default function ComprasPendientes({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [loading, setLoading] = useState(true)
  const [compras, setCompras] = useState([])
  const [estaciones, setEstaciones] = useState([])
  const [cuentasGasto, setCuentasGasto] = useState([])
  const [sugerencias, setSugerencias] = useState({}) // { nit: { estacion_id, cuenta_codigo, cuenta_nombre, usos } }
  const [expandidos, setExpandidos] = useState({}) // { nit: bool }
  const [seleccion, setSeleccion] = useState({}) // { compra_id: { estacion_id, cuenta_codigo } }
  const [filtroProveedor, setFiltroProveedor] = useState('')
  const [filtroFechaDesde, setFiltroFechaDesde] = useState('')
  const [filtroFechaHasta, setFiltroFechaHasta] = useState('')
  const [filtroMontoMin, setFiltroMontoMin] = useState('')
  const [guardando, setGuardando] = useState(false)
  const { toasts, toast } = useToast()

  useEffect(() => {
    if (!session) { router.push('/'); return }
    loadData()
  }, [session])

  async function loadData() {
    setLoading(true)
    
    // Perfil
    const { data: p } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single()
    setPerfil(p)
    
    if (p?.rol !== 'admin') {
      toast('Solo administradores pueden clasificar compras', 'error')
      router.push('/contabilidad')
      return
    }
    
    // Estaciones
    const { data: e } = await supabase.from('estaciones').select('id, nombre').eq('activa', true).order('nombre')
    setEstaciones(e || [])
    
    // Cuentas gasto
    const { data: cg } = await supabase.from('cuentas_contables')
      .select('id, codigo, nombre, tipo')
      .in('tipo', ['gasto', 'cogs', 'activo'])
      .eq('es_de_movimiento', true)
      .eq('activa', true)
      .order('codigo')
    setCuentasGasto(cg || [])
    
    // Compras sin estación
    const { data: c } = await supabase.from('compras_fel')
      .select('id, fecha_emision, nit_emisor, nombre_emisor, numero_factura, monto, tipo_documento')
      .is('estacion_id', null)
      .neq('estado', 'ANULADO')
      .order('fecha_emision', { ascending: false })
    
    setCompras(c || [])
    
    // Cargar sugerencias para cada NIT único
    const nitsUnicos = [...new Set((c || []).map(x => x.nit_emisor).filter(Boolean))]
    const sug = {}
    for (const nit of nitsUnicos) {
      try {
        const { data: s } = await supabase.rpc('sugerencia_proveedor', { p_nit: nit })
        if (s && s.length > 0) sug[nit] = s[0]
      } catch (e) {
        // Ignorar errores individuales
      }
    }
    setSugerencias(sug)
    
    setLoading(false)
  }

  // Agrupar compras por proveedor (NIT)
  function getComprasFiltradas() {
    let filtradas = compras
    if (filtroProveedor) {
      filtradas = filtradas.filter(c => 
        (c.nombre_emisor || '').toLowerCase().includes(filtroProveedor.toLowerCase()) ||
        (c.nit_emisor || '').includes(filtroProveedor)
      )
    }
    if (filtroFechaDesde) filtradas = filtradas.filter(c => c.fecha_emision >= filtroFechaDesde)
    if (filtroFechaHasta) filtradas = filtradas.filter(c => c.fecha_emision <= filtroFechaHasta)
    if (filtroMontoMin) filtradas = filtradas.filter(c => parseFloat(c.monto) >= parseFloat(filtroMontoMin))
    return filtradas
  }

  function agruparPorProveedor() {
    const filtradas = getComprasFiltradas()
    const grupos = {}
    filtradas.forEach(c => {
      const key = c.nit_emisor || 'SIN_NIT'
      if (!grupos[key]) {
        grupos[key] = {
          nit: c.nit_emisor,
          nombre: c.nombre_emisor,
          compras: [],
          total: 0
        }
      }
      grupos[key].compras.push(c)
      grupos[key].total += parseFloat(c.monto || 0)
    })
    return Object.values(grupos).sort((a, b) => b.total - a.total)
  }

  function toggleExpand(nit) {
    setExpandidos(prev => ({ ...prev, [nit]: !prev[nit] }))
  }

  function setSeleccionCompra(compraId, campo, valor) {
    setSeleccion(prev => ({
      ...prev,
      [compraId]: { ...prev[compraId], [campo]: valor }
    }))
  }

  function aplicarSugerencia(grupo) {
    const sug = sugerencias[grupo.nit]
    if (!sug) {
      toast('Sin sugerencia previa para este proveedor', 'info')
      return
    }
    const nuevoSel = { ...seleccion }
    grupo.compras.forEach(c => {
      nuevoSel[c.id] = {
        estacion_id: sug.estacion_id,
        cuenta_codigo: sug.cuenta_codigo
      }
    })
    setSeleccion(nuevoSel)
    toast(`✓ Sugerencia aplicada a ${grupo.compras.length} facturas`, 'success')
  }

  function aplicarABulkProveedor(grupo, estacionId, cuentaCodigo) {
    if (!estacionId) {
      toast('Selecciona una estación primero', 'error')
      return
    }
    const nuevoSel = { ...seleccion }
    grupo.compras.forEach(c => {
      nuevoSel[c.id] = {
        estacion_id: estacionId,
        cuenta_codigo: cuentaCodigo || null
      }
    })
    setSeleccion(nuevoSel)
    toast(`✓ Aplicado a ${grupo.compras.length} facturas de ${grupo.nombre}`, 'success')
  }

  async function guardarSeleccion() {
    const items = Object.entries(seleccion).filter(([_, v]) => v.estacion_id)
    if (items.length === 0) {
      toast('No hay nada que guardar. Selecciona al menos una estación.', 'info')
      return
    }
    
    if (!confirm(`¿Clasificar ${items.length} compras? Se generarán los asientos contables automáticamente.`)) return
    
    setGuardando(true)
    let exitosas = 0
    let errores = 0
    
    for (const [compraId, sel] of items) {
      try {
        const { error } = await supabase.rpc('clasificar_compra_fel', {
          p_compra_id: compraId,
          p_estacion_id: sel.estacion_id,
          p_cuenta_gasto_codigo: sel.cuenta_codigo || null
        })
        if (error) {
          errores++
          console.error('Error compra', compraId, error)
        } else {
          exitosas++
        }
      } catch (e) {
        errores++
      }
    }
    
    if (exitosas > 0) {
      toast(`✓ ${exitosas} compras clasificadas y contabilizadas`, 'success')
    }
    if (errores > 0) {
      toast(`⚠ ${errores} con error`, 'error')
    }
    
    setSeleccion({})
    await loadData()
    setGuardando(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm text-gray-400">Cargando compras...</span>
      </div>
    </div>
  )

  const grupos = agruparPorProveedor()
  const totalCompras = grupos.reduce((s, g) => s + g.compras.length, 0)
  const totalQ = grupos.reduce((s, g) => s + g.total, 0)
  const totalSeleccionado = Object.keys(seleccion).filter(k => seleccion[k].estacion_id).length

  return (
    <Layout perfil={perfil}>
      <ToastContainer toasts={toasts} />
      <div className="p-6 max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <div className="text-sm text-gray-500 mb-2">
          <button onClick={() => router.push('/contabilidad')} className="hover:text-blue-600">Contabilidad</button>
          <span className="mx-2">›</span>
          <span>Compras pendientes</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Compras pendientes de clasificar</h1>
            <p className="text-sm text-gray-500 mt-1">
              {totalCompras} facturas · Q{totalQ.toLocaleString('es-GT', { maximumFractionDigits: 2 })} · {grupos.length} proveedores
            </p>
          </div>
          {totalSeleccionado > 0 && (
            <button
              onClick={guardarSeleccion}
              disabled={guardando}
              className="bg-blue-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {guardando && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
              {guardando ? 'Guardando...' : `Guardar ${totalSeleccionado} clasificación${totalSeleccionado === 1 ? '' : 'es'}`}
            </button>
          )}
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
          <div className="grid grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Proveedor o NIT</label>
              <input type="text" value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)}
                placeholder="Buscar..."
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Desde</label>
              <input type="date" value={filtroFechaDesde} onChange={e => setFiltroFechaDesde(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Hasta</label>
              <input type="date" value={filtroFechaHasta} onChange={e => setFiltroFechaHasta(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Monto mínimo (Q)</label>
              <input type="number" value={filtroMontoMin} onChange={e => setFiltroMontoMin(e.target.value)}
                placeholder="0"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          </div>
        </div>

        {/* Grupos por proveedor */}
        {grupos.length === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
            <svg className="w-12 h-12 text-green-500 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-sm font-medium text-green-800 mb-1">¡Todo clasificado!</h3>
            <p className="text-xs text-green-600">No hay compras pendientes de clasificar.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {grupos.map(grupo => {
              const expanded = expandidos[grupo.nit] !== false // default expanded para los 5 primeros
              const sug = sugerencias[grupo.nit]
              const seleccionadasGrupo = grupo.compras.filter(c => seleccion[c.id]?.estacion_id).length
              
              return (
                <div key={grupo.nit || 'sin-nit'} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  {/* Header del grupo */}
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div className="flex items-center gap-3 flex-1">
                      <button onClick={() => toggleExpand(grupo.nit)} className="text-gray-400 hover:text-gray-600">
                        <svg className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{grupo.nombre}</div>
                        <div className="text-xs text-gray-500">
                          NIT {grupo.nit || '—'} · {grupo.compras.length} factura{grupo.compras.length === 1 ? '' : 's'} · 
                          <span className="font-medium text-gray-700 ml-1">Q{grupo.total.toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span>
                          {seleccionadasGrupo > 0 && (
                            <span className="ml-2 text-blue-600">· {seleccionadasGrupo} seleccionada{seleccionadasGrupo === 1 ? '' : 's'}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Botón sugerencia */}
                    {sug && (
                      <button onClick={() => aplicarSugerencia(grupo)}
                        className="text-xs px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg hover:bg-amber-100 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        Usar sugerencia: {sug.estacion_nombre}
                      </button>
                    )}
                  </div>

                  {/* Bulk update para todo el grupo */}
                  {expanded && (
                    <div className="px-5 py-3 bg-blue-50/30 border-b border-gray-100 flex items-center gap-3">
                      <span className="text-xs text-gray-600 font-medium whitespace-nowrap">Aplicar a todas:</span>
                      <BulkSelector grupo={grupo} estaciones={estaciones} cuentasGasto={cuentasGasto} onApply={aplicarABulkProveedor} />
                    </div>
                  )}

                  {/* Lista de compras */}
                  {expanded && (
                    <div className="divide-y divide-gray-50">
                      {grupo.compras.map(compra => {
                        const sel = seleccion[compra.id] || {}
                        return (
                          <div key={compra.id} className="px-5 py-3 grid grid-cols-12 gap-3 items-center hover:bg-gray-50/50">
                            <div className="col-span-2 text-sm text-gray-700">{compra.fecha_emision}</div>
                            <div className="col-span-2 text-sm text-gray-600">{compra.numero_factura || '—'}</div>
                            <div className="col-span-2 text-sm font-medium text-gray-900 text-right">
                              Q{parseFloat(compra.monto).toLocaleString('es-GT', { maximumFractionDigits: 2 })}
                            </div>
                            <div className="col-span-3">
                              <select value={sel.estacion_id || ''} onChange={e => setSeleccionCompra(compra.id, 'estacion_id', e.target.value)}
                                className={`w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 ${sel.estacion_id ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
                                <option value="">Sin estación</option>
                                {estaciones.map(e => (
                                  <option key={e.id} value={e.id}>{e.nombre}</option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-3">
                              <select value={sel.cuenta_codigo || ''} onChange={e => setSeleccionCompra(compra.id, 'cuenta_codigo', e.target.value)}
                                className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400">
                                <option value="">Cuenta por defecto</option>
                                {cuentasGasto.map(c => (
                                  <option key={c.id} value={c.codigo}>{c.codigo} {c.nombre}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Layout>
  )
}

// Componente para aplicar bulk a todo el grupo
function BulkSelector({ grupo, estaciones, cuentasGasto, onApply }) {
  const [bulkEst, setBulkEst] = useState('')
  const [bulkCta, setBulkCta] = useState('')
  
  return (
    <>
      <select value={bulkEst} onChange={e => setBulkEst(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 flex-1 max-w-xs">
        <option value="">Estación...</option>
        {estaciones.map(e => (
          <option key={e.id} value={e.id}>{e.nombre}</option>
        ))}
      </select>
      <select value={bulkCta} onChange={e => setBulkCta(e.target.value)}
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-blue-400 flex-1 max-w-xs">
        <option value="">Cuenta (opcional)...</option>
        {cuentasGasto.map(c => (
          <option key={c.id} value={c.codigo}>{c.codigo} {c.nombre}</option>
        ))}
      </select>
      <button
        onClick={() => { onApply(grupo, bulkEst, bulkCta); setBulkEst(''); setBulkCta('') }}
        disabled={!bulkEst}
        className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap">
        Aplicar a {grupo.compras.length}
      </button>
    </>
  )
}
