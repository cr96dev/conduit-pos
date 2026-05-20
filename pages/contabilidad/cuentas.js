import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Layout from '../../components/Layout'

const TIPO_COLOR = {
  activo: 'bg-blue-50 text-blue-700 border-blue-200',
  pasivo: 'bg-red-50 text-red-700 border-red-200',
  patrimonio: 'bg-purple-50 text-purple-700 border-purple-200',
  ingreso: 'bg-green-50 text-green-700 border-green-200',
  cogs: 'bg-orange-50 text-orange-700 border-orange-200',
  gasto: 'bg-yellow-50 text-yellow-700 border-yellow-200',
}

const TIPO_LABEL = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio',
  ingreso: 'Ingreso',
  cogs: 'COGS',
  gasto: 'Gasto',
}

const TIPO_ICON = {
  activo: '💰',
  pasivo: '📋',
  patrimonio: '🏛️',
  ingreso: '📈',
  cogs: '📦',
  gasto: '💸',
}

export default function CuentasContables({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cuentas, setCuentas] = useState([])
  const [filtroTipo, setFiltroTipo] = useState('todos')
  const [busqueda, setBusqueda] = useState('')
  const [expandidos, setExpandidos] = useState(new Set(['1', '2', '3', '4', '5', '6']))
  const [cuentaDetalle, setCuentaDetalle] = useState(null)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    async function init() {
      const { data: p } = await supabase.from('perfiles').select('*, estaciones(*)').eq('id', session.user.id).single()
      if (!p || p.rol !== 'admin') { router.push('/dashboard'); return }
      setPerfil(p)
      setEstacion(p.estaciones)
      
      const { data: c } = await supabase.from('cuentas_contables').select('*').order('codigo').limit(500)
      setCuentas(c || [])
      setLoading(false)
    }
    init()
  }, [session])

  // Construir árbol jerárquico
  const arbol = useMemo(() => {
    const map = new Map()
    cuentas.forEach(c => map.set(c.id, { ...c, hijos: [] }))
    const raices = []
    cuentas.forEach(c => {
      if (c.cuenta_padre_id) {
        const padre = map.get(c.cuenta_padre_id)
        if (padre) padre.hijos.push(map.get(c.id))
        else raices.push(map.get(c.id))
      } else {
        raices.push(map.get(c.id))
      }
    })
    return raices
  }, [cuentas])

  // Filtrar cuentas según búsqueda y tipo
  const arbolFiltrado = useMemo(() => {
    if (!busqueda && filtroTipo === 'todos') return arbol

    function cumple(c) {
      const matchBusqueda = !busqueda || 
        c.codigo.toLowerCase().includes(busqueda.toLowerCase()) ||
        c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
        (c.codigo_diamante && c.codigo_diamante.includes(busqueda))
      const matchTipo = filtroTipo === 'todos' || c.tipo === filtroTipo
      return matchBusqueda && matchTipo
    }

    function filtrar(nodos) {
      const resultado = []
      for (const n of nodos) {
        const hijosFiltrados = filtrar(n.hijos)
        if (cumple(n) || hijosFiltrados.length > 0) {
          resultado.push({ ...n, hijos: hijosFiltrados })
        }
      }
      return resultado
    }

    return filtrar(arbol)
  }, [arbol, busqueda, filtroTipo])

  // Estadísticas
  const stats = useMemo(() => {
    const por_tipo = {}
    let movimientos = 0
    let con_dim_estacion = 0
    cuentas.forEach(c => {
      por_tipo[c.tipo] = (por_tipo[c.tipo] || 0) + 1
      if (c.es_de_movimiento) movimientos++
      if (c.requiere_estacion) con_dim_estacion++
    })
    return { total: cuentas.length, por_tipo, movimientos, con_dim_estacion }
  }, [cuentas])

  function toggleExpandir(id) {
    const next = new Set(expandidos)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandidos(next)
  }

  function expandirTodo() {
    setExpandidos(new Set(cuentas.map(c => c.id)))
  }

  function colapsarTodo() {
    setExpandidos(new Set())
  }

  function CuentaNodo({ cuenta, depth = 0 }) {
    const esExpandible = cuenta.hijos.length > 0
    const expandido = expandidos.has(cuenta.id)
    const padding = depth * 16

    return (
      <>
        <div 
          className={`flex items-center gap-2 px-3 py-2 hover:bg-gray-50 border-b border-gray-50 cursor-pointer transition-colors ${cuentaDetalle?.id === cuenta.id ? 'bg-blue-50' : ''}`}
          style={{ paddingLeft: padding + 12 }}
          onClick={() => esExpandible ? toggleExpandir(cuenta.id) : setCuentaDetalle(cuenta)}
        >
          {esExpandible ? (
            <button onClick={(e) => { e.stopPropagation(); toggleExpandir(cuenta.id) }} className="text-gray-400 hover:text-gray-600 w-4 text-xs">
              {expandido ? '▼' : '▶'}
            </button>
          ) : (
            <span className="w-4"></span>
          )}
          
          <span className="font-mono text-xs text-gray-500 w-20 flex-shrink-0">{cuenta.codigo}</span>
          
          <span className={`flex-1 text-sm ${cuenta.es_de_movimiento ? 'text-gray-900' : 'font-semibold text-gray-700'}`}>
            {cuenta.nombre}
          </span>

          <div className="flex items-center gap-1 flex-shrink-0">
            {cuenta.requiere_estacion && (
              <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">📍 estación</span>
            )}
            {cuenta.requiere_proveedor && (
              <span className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">🏢 proveedor</span>
            )}
            {cuenta.requiere_cliente && (
              <span className="text-[10px] bg-pink-100 text-pink-700 px-1.5 py-0.5 rounded">👤 cliente</span>
            )}
            {cuenta.moneda === 'USD' && (
              <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">$ USD</span>
            )}
            {!cuenta.es_de_movimiento && (
              <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">grupo</span>
            )}
          </div>

          <span className={`text-[10px] px-2 py-0.5 rounded border ${TIPO_COLOR[cuenta.tipo]} flex-shrink-0`}>
            {TIPO_ICON[cuenta.tipo]} {TIPO_LABEL[cuenta.tipo]}
          </span>
        </div>

        {expandido && cuenta.hijos.map(h => (
          <CuentaNodo key={h.id} cuenta={h} depth={depth + 1} />
        ))}
      </>
    )
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  )

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-1">
              <span>Contabilidad</span><span>›</span><span>Catálogo de cuentas</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Catálogo de cuentas contables</h1>
            <p className="text-sm text-gray-500 mt-1">
              {stats.total} cuentas · {stats.movimientos} de movimiento · {stats.con_dim_estacion} con dimensión estación
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={expandirTodo} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Expandir todo</button>
            <button onClick={colapsarTodo} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Colapsar</button>
          </div>
        </div>

        {/* KPI cards por tipo */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.entries(TIPO_LABEL).map(([tipo, label]) => (
            <button
              key={tipo}
              onClick={() => setFiltroTipo(filtroTipo === tipo ? 'todos' : tipo)}
              className={`text-left p-3 rounded-lg border transition-all ${filtroTipo === tipo ? TIPO_COLOR[tipo] + ' ring-2 ring-offset-1' : 'bg-white border-gray-200 hover:border-gray-300'}`}
            >
              <div className="text-xs text-gray-500 uppercase">{TIPO_ICON[tipo]} {label}</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">{stats.por_tipo[tipo] || 0}</div>
            </button>
          ))}
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-xl border border-gray-100 p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              placeholder="Buscar por código, nombre o código Diamante..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:border-blue-400"
            />
            <select
              value={filtroTipo}
              onChange={e => setFiltroTipo(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-md text-sm bg-white"
            >
              <option value="todos">Todos los tipos</option>
              {Object.entries(TIPO_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{TIPO_ICON[k]} {v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Layout 2 columnas: árbol + detalle */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          
          {/* Árbol de cuentas */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="text-sm font-medium text-gray-700">
                {arbolFiltrado.length === 0 ? 'Sin resultados' : `${arbolFiltrado.length} ${arbolFiltrado.length === 1 ? 'rama' : 'ramas'}`}
              </div>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {arbolFiltrado.length === 0 ? (
                <div className="py-12 text-center text-sm text-gray-400">
                  No se encontraron cuentas con esos filtros
                </div>
              ) : (
                arbolFiltrado.map(c => <CuentaNodo key={c.id} cuenta={c} />)
              )}
            </div>
          </div>

          {/* Panel de detalle */}
          <div className="bg-white rounded-xl border border-gray-100 p-4 sticky top-4 self-start max-h-[80vh] overflow-y-auto">
            {!cuentaDetalle ? (
              <div className="text-center py-12 text-sm text-gray-400">
                <div className="text-4xl mb-3">📚</div>
                <div>Click en una cuenta para ver su detalle</div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-gray-400 font-mono">{cuentaDetalle.codigo}</div>
                    <h3 className="font-semibold text-gray-900">{cuentaDetalle.nombre}</h3>
                  </div>
                  <button onClick={() => setCuentaDetalle(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                </div>

                <div className={`inline-block text-xs px-2 py-1 rounded border ${TIPO_COLOR[cuentaDetalle.tipo]}`}>
                  {TIPO_ICON[cuentaDetalle.tipo]} {TIPO_LABEL[cuentaDetalle.tipo]}
                  {cuentaDetalle.subtipo && ` · ${cuentaDetalle.subtipo}`}
                </div>

                <div className="border-t border-gray-100 pt-3 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Naturaleza</span>
                    <span className="font-medium">
                      {cuentaDetalle.naturaleza === 'D' ? 'Deudora (aumenta con débito)' : 'Acreedora (aumenta con crédito)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Nivel</span>
                    <span className="font-medium">{cuentaDetalle.nivel}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Tipo</span>
                    <span className="font-medium">{cuentaDetalle.es_de_movimiento ? 'De movimiento' : 'Agrupadora'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Moneda</span>
                    <span className="font-medium">{cuentaDetalle.moneda}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Estado</span>
                    <span className={`font-medium ${cuentaDetalle.activa ? 'text-green-600' : 'text-red-600'}`}>
                      {cuentaDetalle.activa ? '✓ Activa' : '✗ Inactiva'}
                    </span>
                  </div>
                </div>

                {/* Dimensiones requeridas */}
                {(cuentaDetalle.requiere_estacion || cuentaDetalle.requiere_proveedor || cuentaDetalle.requiere_cliente) && (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="text-xs text-gray-500 uppercase font-semibold mb-2">Dimensiones requeridas</div>
                    <div className="flex flex-wrap gap-1">
                      {cuentaDetalle.requiere_estacion && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">📍 Estación</span>}
                      {cuentaDetalle.requiere_proveedor && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded">🏢 Proveedor</span>}
                      {cuentaDetalle.requiere_cliente && <span className="text-xs bg-pink-100 text-pink-700 px-2 py-1 rounded">👤 Cliente</span>}
                    </div>
                  </div>
                )}

                {/* Información bancaria */}
                {cuentaDetalle.banco_nombre && (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="text-xs text-gray-500 uppercase font-semibold mb-2">Cuenta bancaria</div>
                    <div className="text-sm space-y-1">
                      <div><strong>Banco:</strong> {cuentaDetalle.banco_nombre}</div>
                      <div><strong>Número:</strong> {cuentaDetalle.numero_cuenta_banco}</div>
                    </div>
                  </div>
                )}

                {/* Mapeo Diamante */}
                {cuentaDetalle.codigo_diamante && (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Sistema Diamante</div>
                    <div className="text-sm font-mono">{cuentaDetalle.codigo_diamante}</div>
                  </div>
                )}

                {/* Código SAT */}
                {cuentaDetalle.codigo_sat && (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Código SAT</div>
                    <div className="text-sm font-mono">{cuentaDetalle.codigo_sat}</div>
                  </div>
                )}

                {cuentaDetalle.notas && (
                  <div className="border-t border-gray-100 pt-3">
                    <div className="text-xs text-gray-500 uppercase font-semibold mb-1">Notas</div>
                    <div className="text-sm text-gray-700">{cuentaDetalle.notas}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Leyenda */}
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-3 text-xs text-blue-800">
          <strong>Modelo moderno:</strong> cuentas únicas con dimensiones (estación/proveedor/cliente).
          La estación se asigna en cada línea del asiento, no en la cuenta.
          Reducción: 627 cuentas Diamante → 182 cuentas modernas (-71%).
        </div>
      </div>
    </Layout>
  )
}
