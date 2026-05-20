import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

// Productos de inventario para LUBRICANTES (subset del archivo lubricantes.js)
const PRODUCTOS_LUBRICANTES = [
  'LIQUIDO DE FRENOS', 'POWER STEERING 12 ONZAS', 'TP COOLANT 50/50 1 LITRO',
  'TP COOLANT 50/50 1 GALON', 'SHELL ADVANCE S2 DOS TT LITRO', 'SHELL ADVANCE AX5 4T 20W50 LITRO',
  'HELIX HX3 SAE 40 LITRO', 'HELIX HX8 5W-30 LITRO', 'HELIX HX5 20W-50 GALÓN',
  'HELIX HX5 20W-50 LITRO', 'HELIX HX7 SN 10W-30 AZUL GALÓN', 'HELIX HX7 SN 10W-30 AZUL LITRO',
  'RIMULA R4X 15W-40 GRIS GALÓN', 'RIMULA R4X 15W-40 GRIS LITRO', 'SHELL SPIRAX S5 ATF X',
  'UNO Ultra 10W-30 1 LITRO', 'UNO Ultra 10W-30 GALON', 'UNO Impulse 4T 20W-50 1 LITRO',
  'UNO Ultra 20W-50 1 LITRO', 'UNO Ultra 20W-50 1 GALON', 'UNO Ultra 40 1 LITRO',
  'UNO Ultra 40 1 GALON', 'UNO Synchron ATF 1 LITRO', 'TP Brake Fluid PINTA 12 OZ',
  'TP Power Steering F PINTA 12 OZ', 'UNO Forza 15W-40 1 LITRO', 'UNO Forza 50 1 LITRO',
  'UNO ULTRA FULL SYNT 5W-30', 'FORZA EURO SAE 5W-40 1 LITRO', 'UNO Impulse 2T LITRO',
  'HELIX HX3 SAE 40 GALÓN', 'HELIX HX3 25W-60 LITRO', 'HELIX HX3 25W-60 GALÓN',
  'HELIX ULTRA 5W-30 LITRO', 'HELIX ULTRA 5W-30 GALÓN', 'HELIX ULTRA 5W-40 LITRO',
  'HELIX ULTRA 5W-40 GALÓN', 'UNO Ultra 15W-40 1 GALON', 'REFRIGERANTE TOP GUARD',
  'SHELL SPIRAX S3 ATF MD3 LITRO', 'SHELL ADVANCE SAE 10W-40 ULTRA',
  'Prodin Activador Electrolitico 18oz', 'Prodin Agua Destilada 18oz',
  'PLUMILLAS BOSCH', 'Garantía x Lluvia'
]

const PROVEEDORES_LUBRICANTES = [
  'LUBRI-IMPORT EL CORTIJO', 'UNO GUATEMALA', 'OTRO'
]

const CATEGORIAS_LUBRICANTES = [
  'Aceites Motor', 'Aceites Diesel', 'Aceites 2T', 'Aceites 4T',
  'ATF', 'Fluidos', 'Refrigerantes', 'Accesorios'
]

const CATEGORIAS_TIENDA = [
  'Snacks', 'Bebidas Alcohólicas', 'Bebidas No Alcohólicas',
  'Café', 'Comida preparada', 'Cigarros y tabaco', 'Accesorios Automotrices', 'Otros'
]

function getHoyGuatemala() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' })
}

function formatQ(n) {
  return 'Q' + parseFloat(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function EntregasProductos({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estacion, setEstacion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('lubricantes') // lubricantes | tienda
  const [vista, setVista] = useState('historial') // historial | nueva

  // Form cabecera
  const [fecha, setFecha] = useState(getHoyGuatemala())
  const [proveedor, setProveedor] = useState('')
  const [proveedorOtro, setProveedorOtro] = useState('')
  const [nitProveedor, setNitProveedor] = useState('')
  const [numeroFactura, setNumeroFactura] = useState('')
  const [uuidFel, setUuidFel] = useState('')
  const [totalFactura, setTotalFactura] = useState('')
  const [notas, setNotas] = useState('')

  // Form items
  const [items, setItems] = useState([
    { producto: '', categoria: '', cantidad: '', unidad: 'unidades', precio_unitario: '', subtotal: 0 }
  ])

  const [guardando, setGuardando] = useState(false)
  const [errorGuardar, setErrorGuardar] = useState('')
  const [exitoGuardar, setExitoGuardar] = useState(false)

  // Historial
  const [historial, setHistorial] = useState([])
  const [cargandoHistorial, setCargandoHistorial] = useState(false)
  const [estaciones, setEstaciones] = useState([])
  const [estacionFiltro, setEstacionFiltro] = useState('')

  useEffect(() => {
    if (!session) { router.push('/'); return }
    async function init() {
      const { data: p } = await supabase.from('perfiles').select('*, estaciones(*)').eq('id', session.user.id).single()
      if (!p) { router.push('/'); return }
      setPerfil(p)
      setEstacion(p.estaciones)

      // Si es admin, traer todas las estaciones para filtro
      if (p.rol === 'admin') {
        const { data: ests } = await supabase.from('estaciones').select('id, nombre').eq('activa', true).order('nombre')
        setEstaciones(ests || [])
      }
      setLoading(false)
    }
    init()
  }, [session])

  useEffect(() => {
    if (perfil) cargarHistorial()
  }, [perfil, tab, estacionFiltro])

  async function cargarHistorial() {
    setCargandoHistorial(true)
    const tabla = tab === 'lubricantes' ? 'entregas_lubricantes' : 'entregas_tienda'
    let q = supabase.from(tabla).select('*, estaciones(nombre)').order('fecha_entrega', { ascending: false }).limit(50)
    if (perfil?.rol !== 'admin') {
      q = q.eq('estacion_id', perfil.estacion_id)
    } else if (estacionFiltro) {
      q = q.eq('estacion_id', estacionFiltro)
    }
    const { data } = await q
    setHistorial(data || [])
    setCargandoHistorial(false)
  }

  function agregarItem() {
    setItems([...items, { producto: '', categoria: '', cantidad: '', unidad: 'unidades', precio_unitario: '', subtotal: 0 }])
  }

  function eliminarItem(idx) {
    if (items.length === 1) return
    setItems(items.filter((_, i) => i !== idx))
  }

  function actualizarItem(idx, campo, valor) {
    const nuevos = [...items]
    nuevos[idx][campo] = valor
    if (campo === 'cantidad' || campo === 'precio_unitario') {
      const cant = parseFloat(nuevos[idx].cantidad) || 0
      const prec = parseFloat(nuevos[idx].precio_unitario) || 0
      nuevos[idx].subtotal = (cant * prec).toFixed(2)
    }
    setItems(nuevos)
  }

  function resetForm() {
    setFecha(getHoyGuatemala())
    setProveedor('')
    setProveedorOtro('')
    setNitProveedor('')
    setNumeroFactura('')
    setUuidFel('')
    setTotalFactura('')
    setNotas('')
    setItems([{ producto: '', categoria: '', cantidad: '', unidad: 'unidades', precio_unitario: '', subtotal: 0 }])
    setErrorGuardar('')
    setExitoGuardar(false)
  }

  async function guardarEntrega(e) {
    e.preventDefault()
    setErrorGuardar('')
    setExitoGuardar(false)

    const provFinal = proveedor === 'OTRO' ? proveedorOtro : proveedor
    if (!provFinal) { setErrorGuardar('Indica el proveedor'); return }

    const itemsValidos = items.filter(it => it.producto && parseFloat(it.cantidad) > 0)
    if (itemsValidos.length === 0) {
      setErrorGuardar('Debes agregar al menos un producto con cantidad > 0')
      return
    }

    setGuardando(true)

    const tablaCab = tab === 'lubricantes' ? 'entregas_lubricantes' : 'entregas_tienda'
    const tablaDet = tab === 'lubricantes' ? 'entregas_lubricantes_detalle' : 'entregas_tienda_detalle'

    // 1. Insertar cabecera
    const { data: cab, error: errCab } = await supabase.from(tablaCab).insert({
      estacion_id: perfil.estacion_id,
      fecha_entrega: fecha,
      proveedor: provFinal,
      nit_proveedor: nitProveedor || null,
      numero_factura: numeroFactura || null,
      uuid_fel: uuidFel || null,
      total_factura: parseFloat(totalFactura) || 0,
      notas: notas || null,
      creado_por: perfil.id
    }).select('id').single()

    if (errCab) {
      setErrorGuardar('Error al crear entrega: ' + errCab.message)
      setGuardando(false)
      return
    }

    // 2. Insertar items
    const detalles = itemsValidos.map(it => ({
      entrega_id: cab.id,
      producto: it.producto,
      categoria: it.categoria || null,
      cantidad: parseFloat(it.cantidad),
      unidad: it.unidad || 'unidades',
      precio_unitario: parseFloat(it.precio_unitario) || 0,
      subtotal: parseFloat(it.subtotal) || 0
    }))

    const { error: errDet } = await supabase.from(tablaDet).insert(detalles)

    if (errDet) {
      // Si fallan items, intentar borrar la cabecera para no dejar huerfana
      await supabase.from(tablaCab).delete().eq('id', cab.id)
      setErrorGuardar('Error al guardar items: ' + errDet.message)
      setGuardando(false)
      return
    }

    // Exito: el trigger ya actualizo el inventario automaticamente
    setExitoGuardar(true)
    setGuardando(false)
    resetForm()
    cargarHistorial()
    setTimeout(() => {
      setVista('historial')
      setExitoGuardar(false)
    }, 2000)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500 text-sm">Cargando...</div>
    </div>
  )

  const productosDisponibles = tab === 'lubricantes' ? PRODUCTOS_LUBRICANTES : []
  const categoriasDisponibles = tab === 'lubricantes' ? CATEGORIAS_LUBRICANTES : CATEGORIAS_TIENDA

  return (
    <Layout perfil={perfil} estacion={estacion}>
      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Entregas de productos</h1>
          <p className="text-sm text-gray-500 mt-1">
            Registra entregas recibidas. El inventario se actualiza automaticamente.
          </p>
        </div>

        {/* Tabs Lubricantes / Tienda */}
        <div className="flex gap-2 border-b border-gray-200 mb-5">
          <button
            onClick={() => { setTab('lubricantes'); resetForm() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'lubricantes' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>
            Lubricantes
          </button>
          <button
            onClick={() => { setTab('tienda'); resetForm() }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === 'tienda' ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}>
            Tienda
          </button>
        </div>

        {/* Sub-tabs Historial / Nueva */}
        <div className="flex gap-2 mb-5">
          <button onClick={() => setVista('historial')}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              vista === 'historial' ? 'bg-blue-50 text-blue-700 font-medium' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}>
            Historial
          </button>
          <button onClick={() => setVista('nueva')}
            className={`text-sm px-3 py-1.5 rounded-lg transition-colors ${
              vista === 'nueva' ? 'bg-blue-50 text-blue-700 font-medium' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
            }`}>
            + Nueva entrega
          </button>
        </div>

        {/* VISTA: HISTORIAL */}
        {vista === 'historial' && (
          <>
            {perfil?.rol === 'admin' && (
              <div className="mb-4">
                <label className="text-xs text-gray-500 block mb-1">Filtrar por estación</label>
                <select value={estacionFiltro} onChange={e => setEstacionFiltro(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64">
                  <option value="">Todas las estaciones</option>
                  {estaciones.map(e => (
                    <option key={e.id} value={e.id}>{e.nombre}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {cargandoHistorial ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">Cargando...</div>
              ) : historial.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  No hay entregas registradas todavía.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium">Fecha</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium">Estación</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium">Proveedor</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium">Factura</th>
                      <th className="px-4 py-2 text-right text-xs text-gray-500 font-medium">Total</th>
                      <th className="px-4 py-2 text-left text-xs text-gray-500 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map(h => (
                      <tr key={h.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-2.5 text-gray-700">{h.fecha_entrega}</td>
                        <td className="px-4 py-2.5 text-gray-600">{h.estaciones?.nombre || '-'}</td>
                        <td className="px-4 py-2.5 text-gray-700">{h.proveedor}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{h.numero_factura || '-'}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-800">{formatQ(h.total_factura)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            h.estado === 'pagado' ? 'bg-green-50 text-green-700' :
                            h.estado === 'recibido' ? 'bg-blue-50 text-blue-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{h.estado}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {/* VISTA: NUEVA ENTREGA */}
        {vista === 'nueva' && (
          <form onSubmit={guardarEntrega} className="space-y-5">

            {/* Cabecera */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-medium text-gray-800 mb-3 text-sm">Datos de la entrega</h3>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Fecha</label>
                  <input type="date" value={fecha} onChange={e => setFecha(e.target.value)}
                    max={getHoyGuatemala()} required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Proveedor</label>
                  <select value={proveedor} onChange={e => setProveedor(e.target.value)} required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
                    <option value="">-- Seleccionar --</option>
                    {(tab === 'lubricantes' ? PROVEEDORES_LUBRICANTES : ['ADMARK', 'DISTRIBUIDORA ME LLEGA', 'DISTRIBUIDORA MARTE', 'DINANT', 'OTRO']).map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </div>

              {proveedor === 'OTRO' && (
                <div className="mb-4">
                  <label className="text-xs text-gray-500 block mb-1">Nombre del proveedor</label>
                  <input value={proveedorOtro} onChange={e => setProveedorOtro(e.target.value)} required
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
              )}

              <div className="grid grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">NIT (opcional)</label>
                  <input value={nitProveedor} onChange={e => setNitProveedor(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Número de factura</label>
                  <input value={numeroFactura} onChange={e => setNumeroFactura(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Total factura (Q)</label>
                  <input type="number" step="0.01" value={totalFactura} onChange={e => setTotalFactura(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Notas (opcional)</label>
                <textarea value={notas} onChange={e => setNotas(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm min-h-[50px] focus:outline-none focus:border-blue-400" />
              </div>
            </div>

            {/* Items */}
            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h3 className="font-medium text-gray-800 mb-3 text-sm">Productos recibidos</h3>

              {items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 mb-3 items-end pb-3 border-b border-gray-50 last:border-0">
                  <div className="col-span-4">
                    <label className="text-xs text-gray-500 block mb-1">Producto</label>
                    {tab === 'lubricantes' ? (
                      <select value={it.producto} onChange={e => actualizarItem(idx, 'producto', e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400">
                        <option value="">-- Seleccionar --</option>
                        {productosDisponibles.map(p => <option key={p} value={p}>{p}</option>)}
                        <option value="__otro__">Otro (escribir)</option>
                      </select>
                    ) : (
                      <input value={it.producto} onChange={e => actualizarItem(idx, 'producto', e.target.value)}
                        placeholder="Nombre del producto"
                        className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400" />
                    )}
                  </div>
                  {it.producto === '__otro__' && (
                    <div className="col-span-12">
                      <input placeholder="Escribir producto nuevo" onChange={e => actualizarItem(idx, 'producto', e.target.value)}
                        className="w-full border border-amber-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-amber-400" />
                    </div>
                  )}
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 block mb-1">Categoría</label>
                    <select value={it.categoria} onChange={e => actualizarItem(idx, 'categoria', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400">
                      <option value="">-</option>
                      {categoriasDisponibles.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className="text-xs text-gray-500 block mb-1">Cant.</label>
                    <input type="number" step="0.01" value={it.cantidad}
                      onChange={e => actualizarItem(idx, 'cantidad', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400" />
                  </div>
                  <div className="col-span-1">
                    <label className="text-xs text-gray-500 block mb-1">Unidad</label>
                    <select value={it.unidad} onChange={e => actualizarItem(idx, 'unidad', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-1 py-1.5 text-xs focus:outline-none focus:border-blue-400">
                      <option value="unidades">unid</option>
                      <option value="Litro">L</option>
                      <option value="Galón">Gal</option>
                      <option value="Caja">Caja</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="text-xs text-gray-500 block mb-1">Precio unit</label>
                    <input type="number" step="0.01" value={it.precio_unitario}
                      onChange={e => actualizarItem(idx, 'precio_unitario', e.target.value)}
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400" />
                  </div>
                  <div className="col-span-1 text-xs text-gray-600 text-right">
                    {formatQ(it.subtotal)}
                  </div>
                  <div className="col-span-1">
                    <button type="button" onClick={() => eliminarItem(idx)}
                      disabled={items.length === 1}
                      className="text-xs text-red-500 hover:text-red-700 disabled:text-gray-300">
                      ✕
                    </button>
                  </div>
                </div>
              ))}

              <button type="button" onClick={agregarItem}
                className="text-sm text-blue-600 hover:text-blue-700 mt-2">
                + Agregar otro producto
              </button>
            </div>

            {/* Mensajes */}
            {errorGuardar && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-2.5 text-sm text-red-700">
                {errorGuardar}
              </div>
            )}
            {exitoGuardar && (
              <div className="bg-green-50 border border-green-100 rounded-lg px-4 py-2.5 text-sm text-green-800">
                ✓ Entrega guardada. Inventario actualizado automaticamente.
              </div>
            )}

            {/* Submit */}
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => { resetForm(); setVista('historial') }}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                Cancelar
              </button>
              <button type="submit" disabled={guardando}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
                {guardando ? 'Guardando...' : 'Guardar entrega'}
              </button>
            </div>
          </form>
        )}

      </div>
    </Layout>
  )
}
