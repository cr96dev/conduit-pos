import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

export default function Inventario() {
  const [perfil, setPerfil] = useState(null)
  const [estaciones, setEstaciones] = useState([])
  const [inventario, setInventario] = useState([])
  const [cargando, setCargando] = useState(true)
  
  // Filtros
  const [tab, setTab] = useState('stock')  // 'stock' | 'entrega' | 'carga'
  const [vista, setVista] = useState('consolidada')  // 'consolidada' | 'estacion'
  const [estacionSel, setEstacionSel] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('todas')
  const [soloProblemas, setSoloProblemas] = useState(false)
  
  // ────────────────────────────────────────────────────────────
  // Carga inicial
  // ────────────────────────────────────────────────────────────
  useEffect(() => {
    cargarTodo()
  }, [])
  
  async function cargarTodo() {
    setCargando(true)
    
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setCargando(false); return }
    
    const { data: perf } = await supabase
      .from('perfiles')
      .select('*')
      .eq('id', user.id)
      .single()
    setPerfil(perf)
    
    const { data: ests } = await supabase
      .from('estaciones')
      .select('id, nombre')
      .order('nombre')
    setEstaciones(ests || [])
    
    if (perf?.rol === 'manager' && perf?.estacion_id) {
      setEstacionSel(perf.estacion_id)
      setVista('estacion')
    }
    
    const { data: inv } = await supabase
      .from('inventario')
      .select('*')
      .order('producto')
      .limit(2000)
    setInventario(inv || [])
    
    setCargando(false)
  }
  
  // ────────────────────────────────────────────────────────────
  // Categorías disponibles
  // ────────────────────────────────────────────────────────────
  const categorias = useMemo(() => {
    const set = new Set()
    inventario.forEach(i => {
      if (i.categoria) set.add(i.categoria)
    })
    return ['todas', ...Array.from(set).sort()]
  }, [inventario])
  
  // ────────────────────────────────────────────────────────────
  // Helper: clasificar estado del stock
  // ────────────────────────────────────────────────────────────
  function estadoStock(stockActual, stockMinimo) {
    if (stockActual < 0) return 'negativo'
    if (stockActual === 0) return 'cero'
    if (stockMinimo > 0 && stockActual < stockMinimo) return 'bajo'
    return 'ok'
  }
  
  function colorEstado(estado) {
    switch(estado) {
      case 'negativo': return 'text-red-600 font-bold'
      case 'cero':     return 'text-orange-500 font-semibold'
      case 'bajo':     return 'text-yellow-600 font-semibold'
      default:         return 'text-gray-900'
    }
  }
  
  function bgEstado(estado) {
    switch(estado) {
      case 'negativo': return 'bg-red-50'
      case 'cero':     return 'bg-orange-50'
      case 'bajo':     return 'bg-yellow-50'
      default:         return ''
    }
  }
  
  // ────────────────────────────────────────────────────────────
  // Estadísticas: productos críticos (KPIs)
  // ────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let negativos = 0
    let cero = 0
    let bajos = 0
    let oks = 0
    let totalUnidades = 0
    
    inventario.forEach(i => {
      const est = estadoStock(parseFloat(i.stock_actual), parseFloat(i.stock_minimo))
      if (est === 'negativo') negativos++
      else if (est === 'cero') cero++
      else if (est === 'bajo') bajos++
      else oks++
      
      if (parseFloat(i.stock_actual) > 0) totalUnidades += parseFloat(i.stock_actual)
    })
    
    return { negativos, cero, bajos, oks, totalUnidades, total: inventario.length }
  }, [inventario])
  
  // ────────────────────────────────────────────────────────────
  // Productos críticos: lista para sección dedicada
  // ────────────────────────────────────────────────────────────
  const productosCriticos = useMemo(() => {
    return inventario
      .filter(i => parseFloat(i.stock_actual) < 0)
      .map(i => ({
        ...i,
        estacion_nombre: estaciones.find(e => e.id === i.estacion_id)?.nombre || '?'
      }))
      .sort((a, b) => parseFloat(a.stock_actual) - parseFloat(b.stock_actual))  // más negativos primero
  }, [inventario, estaciones])
  
  // ────────────────────────────────────────────────────────────
  // Filtrado para la tabla
  // ────────────────────────────────────────────────────────────
  const inventarioFiltrado = useMemo(() => {
    return inventario.filter(i => {
      // Filtro búsqueda
      if (busqueda && !i.producto.toLowerCase().includes(busqueda.toLowerCase())) return false
      
      // Filtro categoría
      if (categoria !== 'todas' && i.categoria !== categoria) return false
      
      // Filtro problemas
      if (soloProblemas) {
        const est = estadoStock(parseFloat(i.stock_actual), parseFloat(i.stock_minimo))
        if (est === 'ok') return false
      }
      
      // Filtro estación (si vista por estación)
      if (vista === 'estacion' && estacionSel && i.estacion_id !== estacionSel) return false
      
      return true
    })
  }, [inventario, busqueda, categoria, soloProblemas, vista, estacionSel])
  
  // ────────────────────────────────────────────────────────────
  // Pivot: producto x estación
  // ────────────────────────────────────────────────────────────
  const pivot = useMemo(() => {
    const map = {}
    
    inventarioFiltrado.forEach(i => {
      if (!map[i.producto]) {
        map[i.producto] = {
          producto: i.producto,
          categoria: i.categoria,
          unidad: i.unidad,
          stock_minimo: parseFloat(i.stock_minimo) || 0,
          stocks: {},
          total: 0
        }
      }
      const stock = parseFloat(i.stock_actual) || 0
      map[i.producto].stocks[i.estacion_id] = {
        valor: stock,
        estado: estadoStock(stock, parseFloat(i.stock_minimo))
      }
      map[i.producto].total += stock
    })
    
    return Object.values(map).sort((a, b) => a.producto.localeCompare(b.producto))
  }, [inventarioFiltrado])
  
  // ────────────────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────────────────
  if (cargando) {
    return <Layout><div className="p-6 text-gray-500">Cargando…</div></Layout>
  }
  
  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        
        {/* HEADER */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inventario de lubricantes</h1>
            <p className="text-sm text-gray-500 mt-1">
              {estaciones.length} estaciones · {stats.total} registros · {stats.totalUnidades.toFixed(0)} unidades en stock
            </p>
          </div>
        </div>
        
        {/* KPI CARDS */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <div className="text-xs text-red-600 font-semibold uppercase tracking-wide">🔴 Negativos</div>
            <div className="text-2xl font-bold text-red-700 mt-1">{stats.negativos}</div>
            <div className="text-xs text-red-500 mt-0.5">requieren entrega urgente</div>
          </div>
          <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
            <div className="text-xs text-orange-600 font-semibold uppercase tracking-wide">⚪ En cero</div>
            <div className="text-2xl font-bold text-orange-700 mt-1">{stats.cero}</div>
            <div className="text-xs text-orange-500 mt-0.5">sin stock disponible</div>
          </div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <div className="text-xs text-yellow-700 font-semibold uppercase tracking-wide">🟡 Bajo mínimo</div>
            <div className="text-2xl font-bold text-yellow-800 mt-1">{stats.bajos}</div>
            <div className="text-xs text-yellow-600 mt-0.5">próximo a agotarse</div>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="text-xs text-green-700 font-semibold uppercase tracking-wide">🟢 OK</div>
            <div className="text-2xl font-bold text-green-700 mt-1">{stats.oks}</div>
            <div className="text-xs text-green-600 mt-0.5">stock adecuado</div>
          </div>
        </div>
        
        {/* SECCIÓN: PRODUCTOS CRÍTICOS (solo si hay) */}
        {productosCriticos.length > 0 && (
          <details className="mb-5 bg-red-50 border border-red-200 rounded-lg">
            <summary className="cursor-pointer p-3 font-semibold text-red-800 hover:bg-red-100 rounded-lg">
              🚨 Productos críticos: {productosCriticos.length} con stock negativo
              <span className="text-xs ml-2 text-red-600 font-normal">click para expandir</span>
            </summary>
            <div className="px-3 pb-3 max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-red-700 uppercase">
                  <tr>
                    <th className="text-left py-1">Estación</th>
                    <th className="text-left py-1">Producto</th>
                    <th className="text-right py-1">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {productosCriticos.map(p => (
                    <tr key={p.id} className="border-t border-red-100">
                      <td className="py-1.5 text-red-900">{p.estacion_nombre}</td>
                      <td className="py-1.5 text-red-900">{p.producto}</td>
                      <td className="py-1.5 text-right font-bold text-red-700">{parseFloat(p.stock_actual).toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
        
        {/* TABS */}
        <div className="flex gap-1 border-b mb-4">
          <button
            onClick={() => setTab('stock')}
            className={`px-4 py-2 text-sm font-medium ${tab === 'stock' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            Stock actual
          </button>
          <button
            onClick={() => setTab('entrega')}
            className={`px-4 py-2 text-sm font-medium ${tab === 'entrega' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            Registrar entrega
          </button>
          <button
            onClick={() => setTab('carga')}
            className={`px-4 py-2 text-sm font-medium ${tab === 'carga' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
          >
            Carga inicial (Excel)
          </button>
        </div>
        
        {/* CONTENIDO TAB: STOCK ACTUAL */}
        {tab === 'stock' && (
          <>
            {/* TOGGLES VISTA */}
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setVista('consolidada')}
                className={`px-3 py-1.5 text-sm rounded border ${vista === 'consolidada' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-300 text-gray-600'}`}
              >
                Vista consolidada
              </button>
              <button
                onClick={() => setVista('estacion')}
                className={`px-3 py-1.5 text-sm rounded border ${vista === 'estacion' ? 'bg-blue-50 border-blue-400 text-blue-700' : 'border-gray-300 text-gray-600'}`}
              >
                Por estación
              </button>
            </div>
            
            {/* FILTROS */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <input
                type="text"
                placeholder="Buscar producto…"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <select
                value={categoria}
                onChange={e => setCategoria(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                {categorias.map(c => (
                  <option key={c} value={c}>{c === 'todas' ? 'Todas las categorías' : c}</option>
                ))}
              </select>
              {vista === 'estacion' && (
                <select
                  value={estacionSel}
                  onChange={e => setEstacionSel(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                  disabled={perfil?.rol === 'manager'}
                >
                  <option value="">Selecciona estación</option>
                  {estaciones.map(e => (
                    <option key={e.id} value={e.id}>{e.nombre}</option>
                  ))}
                </select>
              )}
            </div>
            
            {/* TOGGLE PROBLEMAS */}
            <div className="mb-3">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={soloProblemas}
                  onChange={e => setSoloProblemas(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Mostrar solo productos con problemas (negativo / cero / bajo mínimo)
              </label>
            </div>
            
            {/* TABLA: VISTA CONSOLIDADA */}
            {vista === 'consolidada' && (
              <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                    <tr>
                      <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left min-w-[220px]">Producto</th>
                      {estaciones.map(e => (
                        <th key={e.id} className="px-2 py-2 text-center min-w-[80px]">
                          {e.nombre.replace('SS ', '')}
                        </th>
                      ))}
                      <th className="px-3 py-2 text-right bg-gray-100 font-bold text-gray-800 min-w-[70px]">TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pivot.length === 0 ? (
                      <tr><td colSpan={estaciones.length + 2} className="py-8 text-center text-gray-400">Sin productos con estos filtros</td></tr>
                    ) : pivot.map(p => (
                      <tr key={p.producto} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 align-top">
                          <div className="font-medium text-gray-900">{p.producto}</div>
                          <div className="text-xs text-gray-500">
                            {p.categoria || '(sin categoría)'} · {p.unidad || '?'}
                            {p.stock_minimo > 0 && <span className="ml-1">· mín {p.stock_minimo}</span>}
                          </div>
                        </td>
                        {estaciones.map(e => {
                          const cell = p.stocks[e.id]
                          if (!cell) {
                            return <td key={e.id} className="px-2 py-2 text-center text-gray-300">—</td>
                          }
                          return (
                            <td key={e.id} className={`px-2 py-2 text-center ${bgEstado(cell.estado)}`}>
                              <span className={colorEstado(cell.estado)}>
                                {cell.valor.toFixed(0)}
                              </span>
                            </td>
                          )
                        })}
                        <td className="px-3 py-2 text-right bg-gray-50 font-bold text-gray-800">
                          {p.total.toFixed(0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            
            {/* TABLA: POR ESTACIÓN */}
            {vista === 'estacion' && (
              <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
                {!estacionSel ? (
                  <div className="p-8 text-center text-gray-400">Selecciona una estación arriba</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                      <tr>
                        <th className="px-3 py-2 text-left">Producto</th>
                        <th className="px-3 py-2 text-left">Categoría</th>
                        <th className="px-3 py-2 text-right">Stock</th>
                        <th className="px-3 py-2 text-right">Mínimo</th>
                        <th className="px-3 py-2 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventarioFiltrado.length === 0 ? (
                        <tr><td colSpan={5} className="py-8 text-center text-gray-400">Sin productos con estos filtros</td></tr>
                      ) : inventarioFiltrado.map(i => {
                        const stock = parseFloat(i.stock_actual) || 0
                        const min = parseFloat(i.stock_minimo) || 0
                        const est = estadoStock(stock, min)
                        return (
                          <tr key={i.id} className={`border-t border-gray-100 ${bgEstado(est)}`}>
                            <td className="px-3 py-2 font-medium text-gray-900">{i.producto}</td>
                            <td className="px-3 py-2 text-gray-600 text-xs">{i.categoria || '—'} · {i.unidad || '?'}</td>
                            <td className={`px-3 py-2 text-right font-bold ${colorEstado(est)}`}>{stock.toFixed(0)}</td>
                            <td className="px-3 py-2 text-right text-gray-600">{min > 0 ? min.toFixed(0) : '—'}</td>
                            <td className="px-3 py-2 text-center">
                              {est === 'negativo' && <span className="text-red-600">🔴 Negativo</span>}
                              {est === 'cero' && <span className="text-orange-500">⚪ Cero</span>}
                              {est === 'bajo' && <span className="text-yellow-700">🟡 Bajo</span>}
                              {est === 'ok' && <span className="text-green-600">🟢 OK</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            )}
            
            <div className="text-xs text-gray-500 mt-3">
              🔴 negativo · ⚪ cero · 🟡 bajo mínimo · 🟢 ok
            </div>
          </>
        )}
        
        {/* TAB ENTREGA / CARGA */}
        {tab === 'entrega' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-800 text-sm">
            Ir a <strong>Entregas</strong> en el menú lateral para registrar una compra/entrega de lubricantes.
          </div>
        )}
        {tab === 'carga' && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-800 text-sm">
            La carga inicial por Excel se gestiona desde Admin. Solicítalo si necesitas cargar inventario masivo.
          </div>
        )}
        
      </div>
    </Layout>
  )
}
