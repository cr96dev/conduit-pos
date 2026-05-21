import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'

function getFechaGuatemala() {
  const d = new Date()
  const gtOffset = -6 * 60
  const local = new Date(d.getTime() + (d.getTimezoneOffset() + gtOffset) * 60000)
  return local.toISOString().slice(0, 10)
}
function hace(dias) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  const gtOffset = -6 * 60
  const local = new Date(d.getTime() + (d.getTimezoneOffset() + gtOffset) * 60000)
  return local.toISOString().slice(0, 10)
}

const ESTADO_LABEL = {
  aplicado: { txt: 'Aplicado',     cls: 'bg-green-50 text-green-700 border-green-200' },
  pendiente: { txt: 'Pendiente',   cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  fallido: { txt: 'Fallido',       cls: 'bg-red-50 text-red-700 border-red-200' },
  sin_venta_destino: { txt: 'Sin fila destino', cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  afiliado_desconocido: { txt: 'Afiliado desconocido', cls: 'bg-purple-50 text-purple-700 border-purple-200' }
}

const CAT_LABEL = {
  combustible: { txt: 'combustible', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  tienda: { txt: 'tienda', cls: 'bg-pink-50 text-pink-700 border-pink-200' },
  lubricantes: { txt: 'lubricantes', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200' }
}

export default function AdminBac() {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estaciones, setEstaciones] = useState([])
  const [loading, setLoading] = useState(true)

  const [fechaInicio, setFechaInicio] = useState(hace(7))
  const [fechaFin, setFechaFin] = useState(getFechaGuatemala())
  const [estacionFiltro, setEstacionFiltro] = useState('')
  const [estadoFiltro, setEstadoFiltro] = useState('')
  const [categoriaFiltro, setCategoriaFiltro] = useState('')

  const [consumos, setConsumos] = useState([])
  const [refreshing, setRefreshing] = useState(false)

  const [reintentandoId, setReintentandoId] = useState(null)
  const [reintentandoMasivo, setReintentandoMasivo] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    cargar()
  }, [])

  useEffect(() => {
    if (perfil) buscar()
  }, [perfil, fechaInicio, fechaFin, estacionFiltro, estadoFiltro, categoriaFiltro])

  async function cargar() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { router.push("/"); return }
    const { data: p } = await supabase.from("perfiles").select("*").eq("id", session.user.id).single()
    setPerfil(p)
    if (p?.rol !== 'admin') {
      setLoading(false)
      return
    }
    const { data: ests } = await supabase
      .from('estaciones').select('id, nombre').order('nombre')
    setEstaciones(ests || [])
    setLoading(false)
  }

  async function buscar() {
    if (perfil?.rol !== 'admin') return
    setRefreshing(true)
    let q = supabase
      .from('bac_consumos')
      .select(`
        id, liquidacion_no, no_afiliado, fecha_remision, fecha_pago, lote_pos,
        cuenta_destino, cantidad_transac, total_ventas, comision, neto_pagado,
        estacion_id, categoria, valor_anterior, valor_nuevo, estado, error_msg, procesado_en
      `)
      .gte('fecha_remision', fechaInicio)
      .lte('fecha_remision', fechaFin)
      .order('fecha_remision', { ascending: false })
      .order('procesado_en', { ascending: false })
      .limit(500)

    if (estacionFiltro) q = q.eq('estacion_id', estacionFiltro)
    if (estadoFiltro)   q = q.eq('estado', estadoFiltro)
    if (categoriaFiltro) q = q.eq('categoria', categoriaFiltro)

    const { data } = await q
    setConsumos(data || [])
    setRefreshing(false)
  }

  function mostrarToast(tipo, texto) {
    setToast({ tipo, texto })
    setTimeout(() => setToast(null), 4500)
  }

  async function reintentarUno(consumoId) {
    if (reintentandoId) return
    setReintentandoId(consumoId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        mostrarToast('error', 'Sesión inválida, recarga la página.')
        setReintentandoId(null)
        return
      }
      const resp = await fetch('/api/bac/reintentar', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ consumo_id: consumoId })
      })
      const json = await resp.json()
      if (!resp.ok) {
        mostrarToast('error', json.error || 'Error al reintentar')
      } else if (json.aplicado) {
        mostrarToast('ok', `Aplicado: Q${parseFloat(json.valor_anterior).toFixed(2)} → Q${parseFloat(json.valor_nuevo).toFixed(2)}`)
      } else {
        mostrarToast('warn', json.mensaje || 'Aún sin fila destino')
      }
      await buscar()
    } catch (e) {
      mostrarToast('error', e.message)
    } finally {
      setReintentandoId(null)
    }
  }

  async function reintentarTodos() {
    const pendientes = consumos.filter(c => c.estado === 'sin_venta_destino')
    if (pendientes.length === 0) {
      mostrarToast('warn', 'No hay registros sin fila destino en el filtro actual.')
      return
    }
    if (!confirm(`¿Reintentar ${pendientes.length} registros sin fila destino?`)) return

    setReintentandoMasivo(true)
    let aplicados = 0, sigueSinDestino = 0, errores = 0
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        mostrarToast('error', 'Sesión inválida, recarga la página.')
        setReintentandoMasivo(false)
        return
      }
      for (const c of pendientes) {
        try {
          const resp = await fetch('/api/bac/reintentar', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({ consumo_id: c.id })
          })
          const json = await resp.json()
          if (!resp.ok) errores++
          else if (json.aplicado) aplicados++
          else sigueSinDestino++
        } catch {
          errores++
        }
      }
      mostrarToast('ok', `Resultado: ${aplicados} aplicados, ${sigueSinDestino} aún sin destino, ${errores} errores.`)
      await buscar()
    } finally {
      setReintentandoMasivo(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Cargando...</div>
  if (perfil?.rol !== 'admin') {
    return <Layout perfil={perfil}><div className="p-8 text-gray-700">Solo admin.</div></Layout>
  }

  const estacionesMap = Object.fromEntries((estaciones || []).map(e => [e.id, e.nombre]))

  // Resumen
  const totalRegistros = consumos.length
  const totalAplicados = consumos.filter(c => c.estado === 'aplicado').length
  const totalSinDestino = consumos.filter(c => c.estado === 'sin_venta_destino').length
  const totalFallidos = consumos.filter(c => c.estado === 'fallido' || c.estado === 'afiliado_desconocido').length
  const sumVentas = consumos
    .filter(c => c.estado === 'aplicado')
    .reduce((s, c) => s + parseFloat(c.total_ventas || 0), 0)

  const toastCls = {
    ok: 'bg-green-50 border-green-200 text-green-800',
    warn: 'bg-amber-50 border-amber-200 text-amber-800',
    error: 'bg-red-50 border-red-200 text-red-800',
  }

  return (
    <Layout perfil={perfil}>
      <div className="px-4 py-6 max-w-7xl mx-auto">
        <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl font-medium text-gray-900">Auditoría BAC</h1>
            <p className="text-sm text-gray-500 mt-1">Liquidaciones BAC Credomatic procesadas desde email</p>
          </div>
          {totalSinDestino > 0 && (
            <button onClick={reintentarTodos} disabled={reintentandoMasivo || reintentandoId}
              className="text-sm bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors">
              {reintentandoMasivo ? 'Reintentando...' : `Reintentar ${totalSinDestino} sin destino`}
            </button>
          )}
        </div>

        {toast && (
          <div className={`mb-4 px-4 py-2 rounded-lg border text-sm ${toastCls[toast.tipo]}`}>
            {toast.texto}
          </div>
        )}

        {/* Resumen */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <Tarjeta titulo="Registros" valor={totalRegistros} />
          <Tarjeta titulo="Aplicados" valor={totalAplicados} color="text-green-700" />
          <Tarjeta titulo="Sin fila destino" valor={totalSinDestino} color="text-orange-700" />
          <Tarjeta titulo="Fallidos" valor={totalFallidos} color="text-red-700" />
          <Tarjeta titulo="Total Ventas (Q)" valor={sumVentas.toLocaleString('es-GT',{maximumFractionDigits:2})} color="text-blue-700" />
        </div>

        {/* Filtros */}
        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-4">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Desde</label>
              <input type="date" value={fechaInicio} onChange={e => setFechaInicio(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Hasta</label>
              <input type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Estación</label>
              <select value={estacionFiltro} onChange={e => setEstacionFiltro(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                <option value="">Todas</option>
                {estaciones.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Categoría</label>
              <select value={categoriaFiltro} onChange={e => setCategoriaFiltro(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                <option value="">Todas</option>
                <option value="combustible">Combustible</option>
                <option value="tienda">Tienda</option>
                <option value="lubricantes">Lubricantes</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Estado</label>
              <select value={estadoFiltro} onChange={e => setEstadoFiltro(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                <option value="">Todos</option>
                <option value="aplicado">Aplicado</option>
                <option value="pendiente">Pendiente</option>
                <option value="sin_venta_destino">Sin fila destino</option>
                <option value="afiliado_desconocido">Afiliado desconocido</option>
                <option value="fallido">Fallido</option>
              </select>
            </div>
            <div>
              <button onClick={buscar} disabled={refreshing}
                className="w-full bg-blue-600 text-white text-sm px-4 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {refreshing ? 'Buscando...' : 'Actualizar'}
              </button>
            </div>
          </div>
        </div>

        {/* Tabla */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th>Fecha Remisión</Th>
                  <Th>Estación</Th>
                  <Th>Cat</Th>
                  <Th>Afiliado</Th>
                  <Th>Liquidación</Th>
                  <Th>Lote POS</Th>
                  <Th className="text-right">Cant</Th>
                  <Th className="text-right">Total Ventas</Th>
                  <Th className="text-right">Comisión</Th>
                  <Th className="text-right">Neto</Th>
                  <Th>Estado</Th>
                  <Th>Acción</Th>
                  <Th>Procesado</Th>
                </tr>
              </thead>
              <tbody>
                {consumos.length === 0 && (
                  <tr><td colSpan={13} className="text-center text-gray-400 py-8 text-sm">
                    {refreshing ? 'Cargando...' : 'No hay registros'}
                  </td></tr>
                )}
                {consumos.map(c => {
                  const est = ESTADO_LABEL[c.estado] || { txt: c.estado, cls: 'bg-gray-50 text-gray-700 border-gray-200' }
                  const cat = CAT_LABEL[c.categoria] || null
                  const puedeReintentar = c.estado === 'sin_venta_destino'
                  const estaReintentando = reintentandoId === c.id
                  return (
                    <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-3 py-2 text-gray-700">{c.fecha_remision}</td>
                      <td className="px-3 py-2 text-gray-700">{estacionesMap[c.estacion_id] || '—'}</td>
                      <td className="px-3 py-2">
                        {cat ? (
                          <span className={`inline-block text-[10px] px-2 py-0.5 rounded border ${cat.cls}`}>{cat.txt}</span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600 font-mono text-xs">{c.no_afiliado}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{c.liquidacion_no}</td>
                      <td className="px-3 py-2 text-gray-500 font-mono text-xs">{c.lote_pos || '—'}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{c.cantidad_transac || '—'}</td>
                      <td className="px-3 py-2 text-right font-medium text-gray-900">
                        {parseFloat(c.total_ventas || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-3 py-2 text-right text-red-600">
                        {c.comision != null ? `-${parseFloat(c.comision).toLocaleString('es-GT', { maximumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-700">
                        {c.neto_pagado != null ? parseFloat(c.neto_pagado).toLocaleString('es-GT', { maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span title={c.error_msg || ''}
                          className={`inline-block text-[10px] px-2 py-0.5 rounded border ${est.cls}`}>{est.txt}</span>
                      </td>
                      <td className="px-3 py-2">
                        {puedeReintentar ? (
                          <button onClick={() => reintentarUno(c.id)}
                            disabled={estaReintentando || reintentandoMasivo}
                            className="text-[11px] px-2 py-1 rounded bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100 disabled:opacity-50">
                            {estaReintentando ? 'Reintentando...' : 'Reintentar'}
                          </button>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-400 text-xs">
                        {c.procesado_en ? new Date(c.procesado_en).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-4 text-xs text-gray-400">
          Mostrando hasta 500 registros. Para ver más, ajusta las fechas.
        </div>
      </div>
    </Layout>
  )
}

function Tarjeta({ titulo, valor, color = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3">
      <div className="text-xs text-gray-500">{titulo}</div>
      <div className={`text-lg font-medium mt-0.5 ${color}`}>{valor}</div>
    </div>
  )
}

function Th({ children, className = '' }) {
  return <th className={`text-left text-xs font-medium text-gray-500 px-3 py-2 whitespace-nowrap ${className}`}>{children}</th>
}
