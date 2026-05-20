import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { useToast, ToastContainer } from '../components/Toast'

function TanquesEstacion({ estacion }) {
  const [historial, setHistorial] = useState([])
  const [loading, setLoading] = useState(true)
  const [abierto, setAbierto] = useState(false)
  const tipoColor = { vpower: '#DC2626', super: '#16A34A', regular: '#CA8A04', diesel: '#1C1917' }
  const tipoLabel = { vpower: 'V-Power', super: 'Super', regular: 'Regular', diesel: 'Diesel' }

  async function cargar() {
    if (abierto) { setAbierto(false); return }
    setLoading(true); setAbierto(true)
    const { data } = await supabase.from('tanques_historial').select('*')
      .eq('estacion_id', estacion.id).order('created_at', { ascending: false }).limit(30)
    setHistorial(data || [])
    setLoading(false)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button onClick={cargar} className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors">
        <div className="text-left">
          <div className="text-sm font-medium text-gray-800">{estacion.nombre}</div>
          <div className="text-xs text-gray-400">{estacion.zona}</div>
        </div>
        <span className="text-xs text-blue-500">{abierto ? '▲ Cerrar' : '▼ Ver historial'}</span>
      </button>
      {abierto && (
        <div className="border-t border-gray-100">
          {loading ? <div className="px-5 py-4 text-xs text-gray-400">Cargando...</div> :
            historial.length === 0 ? <div className="px-5 py-4 text-xs text-gray-400">Sin registros aún</div> : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-5 py-2 text-left text-xs text-gray-400 font-normal">Fecha y hora</th>
                    <th className="px-3 py-2 text-left text-xs text-gray-400 font-normal">Combustible</th>
                    <th className="px-3 py-2 text-right text-xs text-gray-400 font-normal">Nivel (gal)</th>
                    <th className="px-3 py-2 text-right text-xs text-gray-400 font-normal">Capacidad</th>
                    <th className="px-5 py-2 text-right text-xs text-gray-400 font-normal">%</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map(h => {
                    const pct = h.capacidad_galones > 0 ? Math.round((h.nivel_galones / h.capacidad_galones) * 100) : 0
                    const fecha = new Date(h.created_at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' })
                    return (
                      <tr key={h.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-5 py-2.5 text-gray-600 text-xs">{fecha}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ background: tipoColor[h.tipo] }}></div>
                            <span className="text-xs text-gray-700">{tipoLabel[h.tipo]}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-700">{parseFloat(h.nivel_galones).toLocaleString('es-GT')}</td>
                        <td className="px-3 py-2.5 text-right text-xs text-gray-500">{parseFloat(h.capacidad_galones).toLocaleString('es-GT')}</td>
                        <td className="px-5 py-2.5 text-right">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${pct < 20 ? 'bg-red-50 text-red-600' : pct < 40 ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-700'}`}>{pct}%</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
        </div>
      )}
    </div>
  )
}

const metodosPago = ['neonet','bac','deposito','cupon','neonet_prepago','descuento_club_bi','ach_transferencia','flota_credomatic','caja_chica','vales_clientes','uno_plus','nomina','descuento_amigo','piloto','gasoline','prueba_surtidor']
const metodosLabel = { neonet:'Neonet', bac:'BAC', deposito:'Depósito', cupon:'Cupón', neonet_prepago:'Neonet Prepago', descuento_club_bi:'Descuento Club Bi', ach_transferencia:'ACH / Transferencia', flota_credomatic:'Flota Credomatic', caja_chica:'Caja Chica', vales_clientes:'Vales Clientes', uno_plus:'Uno Plus', nomina:'Nómina', descuento_amigo:'Descuento Amigo', piloto:'Piloto', gasoline:'Gasoline', prueba_surtidor:'Prueba de surtidor' }

function ModalEdicion({ registro, tipo, onClose, onGuardado }) {
  const [form, setForm] = useState({ ...registro })
  const [guardando, setGuardando] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function guardar() {
    setGuardando(true); setErrorMsg('')
    let error = null
    if (tipo === 'ventas') {
      const { error: e } = await supabase.from('ventas').update({
        fecha: form.fecha,
        regular_litros: parseFloat(form.regular_litros)||0, regular_ingresos: parseFloat(form.regular_ingresos)||0,
        premium_litros: parseFloat(form.premium_litros)||0, premium_ingresos: parseFloat(form.premium_ingresos)||0,
        diesel_litros: parseFloat(form.diesel_litros)||0, diesel_ingresos: parseFloat(form.diesel_ingresos)||0,
        diesel_plus_litros: parseFloat(form.diesel_plus_litros)||0, diesel_plus_ingresos: parseFloat(form.diesel_plus_ingresos)||0,
        ...metodosPago.reduce((acc,m) => ({ ...acc, [m]: parseFloat(form[m])||0 }), {}),
        notas: form.notas,
      }).eq('id', registro.id)
      error = e
    }
    if (tipo === 'entregas') {
      const { error: e } = await supabase.from('entregas').update({
        proveedor: form.proveedor, fecha_entrega: form.fecha_entrega,
        regular_galones: parseFloat(form.regular_galones)||0, premium_galones: parseFloat(form.premium_galones)||0,
        diesel_galones: parseFloat(form.diesel_galones)||0, diesel_plus_galones: parseFloat(form.diesel_plus_galones)||0,
        total_galones: (parseFloat(form.regular_galones)||0)+(parseFloat(form.premium_galones)||0)+(parseFloat(form.diesel_galones)||0)+(parseFloat(form.diesel_plus_galones)||0),
        estado: form.estado, notas: form.notas,
      }).eq('id', registro.id)
      error = e
    }
    if (tipo === 'facturas') {
      const { error: e } = await supabase.from('facturas').update({
        numero_factura: form.numero_factura, proveedor: form.proveedor,
        fecha_emision: form.fecha_emision, fecha_vencimiento: form.fecha_vencimiento,
        monto: parseFloat(form.monto)||0, estado: form.estado, notas: form.notas,
      }).eq('id', registro.id)
      error = e
    }
    if (tipo === 'lubricantes') {
      const { error: e } = await supabase.from('ventas_lubricantes').update({
        fecha: form.fecha, neonet: parseFloat(form.neonet)||0,
        efectivo: parseFloat(form.efectivo)||0, total_venta: parseFloat(form.total_venta)||0, notas: form.notas,
      }).eq('id', registro.id)
      error = e
    }
    if (error) setErrorMsg(`Error: ${error.message}`)
    else { onGuardado(); onClose() }
    setGuardando(false)
  }

  function campo(label, key, type='text') {
    return (
      <div>
        <label className="text-xs text-gray-500 block mb-1">{label}</label>
        <input type={type} value={form[key]||''} onChange={e => setForm(f=>({...f,[key]:e.target.value}))}
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            Editar {tipo==='ventas'?'ventas':tipo==='entregas'?'entrega':tipo==='lubricantes'?'lubricantes':'factura'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {tipo==='ventas' && (
            <>
              {campo('Fecha','fecha','date')}
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="grid grid-cols-3 bg-gray-50 px-4 py-2 border-b border-gray-100 text-xs text-gray-400 font-medium">
                  <div>Combustible</div><div className="text-center">Galones</div><div className="text-center">Ingresos (Q)</div>
                </div>
                {[['Super','regular'],['V-Power','premium'],['Diesel','diesel'],['Regular','diesel_plus']].map(([label,key]) => (
                  <div key={key} className="grid grid-cols-3 gap-2 px-4 py-2.5 border-b border-gray-50 items-center">
                    <span className="text-sm text-gray-700">{label}</span>
                    <input type="number" value={form[`${key}_litros`]||''} onChange={e=>setForm(f=>({...f,[`${key}_litros`]:e.target.value}))}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-400" />
                    <input type="number" value={form[`${key}_ingresos`]||''} onChange={e=>setForm(f=>({...f,[`${key}_ingresos`]:e.target.value}))}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-400" />
                  </div>
                ))}
              </div>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="grid grid-cols-2 bg-gray-50 px-4 py-2 border-b border-gray-100 text-xs text-gray-400 font-medium">
                  <div>Forma de cobro</div><div className="text-center">Monto (Q)</div>
                </div>
                {metodosPago.map(m => (
                  <div key={m} className="grid grid-cols-2 gap-2 px-4 py-2 border-b border-gray-50 items-center">
                    <span className="text-sm text-gray-700">{metodosLabel[m]}</span>
                    <input type="number" value={form[m]||''} onChange={e=>setForm(f=>({...f,[m]:e.target.value}))}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-400" />
                  </div>
                ))}
              </div>
              {campo('Notas','notas')}
            </>
          )}
          {tipo==='entregas' && (
            <>
              <div className="grid grid-cols-2 gap-3">{campo('Proveedor','proveedor')}{campo('Fecha','fecha_entrega','date')}</div>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="grid grid-cols-2 bg-gray-50 px-4 py-2 border-b border-gray-100 text-xs text-gray-400 font-medium">
                  <div>Combustible</div><div className="text-center">Galones</div>
                </div>
                {[['Super','regular'],['V-Power','premium'],['Diesel','diesel'],['Regular','diesel_plus']].map(([label,key]) => (
                  <div key={key} className="grid grid-cols-2 gap-2 px-4 py-2.5 border-b border-gray-50 items-center">
                    <span className="text-sm text-gray-700">{label}</span>
                    <input type="number" value={form[`${key}_galones`]||''} onChange={e=>setForm(f=>({...f,[`${key}_galones`]:e.target.value}))}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:border-blue-400" />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Estado</label>
                <select value={form.estado||''} onChange={e=>setForm(f=>({...f,estado:e.target.value}))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                  <option value="confirmada">Confirmada</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="cancelada">Cancelada</option>
                </select>
              </div>
              {campo('Notas','notas')}
            </>
          )}
          {tipo==='facturas' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                {campo('No. Factura','numero_factura')}{campo('Proveedor','proveedor')}
                {campo('Fecha emisión','fecha_emision','date')}{campo('Fecha vencimiento','fecha_vencimiento','date')}
                {campo('Monto (Q)','monto','number')}
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Estado</label>
                  <select value={form.estado||''} onChange={e=>setForm(f=>({...f,estado:e.target.value}))}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                    <option value="pendiente">Pendiente</option>
                    <option value="pagada">Pagada</option>
                    <option value="vencida">Vencida</option>
                  </select>
                </div>
              </div>
              {campo('Notas','notas')}
            </>
          )}
          {tipo==='lubricantes' && (
            <>
              {campo('Fecha','fecha','date')}
              <div className="grid grid-cols-2 gap-3">
                {campo('Total venta (Q)','total_venta','number')}
                {campo('Neonet (Q)','neonet','number')}
                {campo('Efectivo (Q)','efectivo','number')}
              </div>
              {campo('Notas','notas')}
            </>
          )}
          {errorMsg && <div className="bg-red-50 border border-red-100 rounded-lg px-4 py-3 text-xs text-red-700">{errorMsg}</div>}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50">Cancelar</button>
          <button onClick={guardar} disabled={guardando}
            className="text-sm px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {guardando && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
            {guardando ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  )
}

const TIPOS_GESTION = ['ventas','lubricantes','entregas','facturas','inventario']

export default function Admin({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [estaciones, setEstaciones] = useState([])
  const [resumen, setResumen] = useState({})
  const [mensual, setMensual] = useState({})
  const [facturas, setFacturas] = useState({})
  const [loading, setLoading] = useState(true)
  const [ultimaActualizacion, setUltimaActualizacion] = useState(null)
  const [vistaDetalle, setVistaDetalle] = useState(null)
  const [estacionSeleccionada, setEstacionSeleccionada] = useState(null)
  const [registros, setRegistros] = useState([])
  const [loadingRegistros, setLoadingRegistros] = useState(false)
  const [eliminando, setEliminando] = useState(null)
  const [segundos, setSegundos] = useState(30)
  const [exportando, setExportando] = useState(null)
  const [facturasDetalle, setFacturasDetalle] = useState([])
  const [estacionFacturas, setEstacionFacturas] = useState(null)
  const [loadingFacturas, setLoadingFacturas] = useState(false)
  const [modalEdicion, setModalEdicion] = useState(null)
  const [seccion, setSeccion] = useState('ayer')
  const { toasts, toast } = useToast()

  const getAyer = () => { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0] }
  const getPrimerDiaMes = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01` }

  const cargarDatos = useCallback(async () => {
    const ayer=getAyer(); const primerDia=getPrimerDiaMes()
    const { data: ventasAyer } = await supabase.from('ventas').select('*').eq('fecha',ayer)
    const ventasMap={}; (ventasAyer||[]).forEach(v=>{ ventasMap[v.estacion_id]=v }); setResumen(ventasMap)
    const { data: ventasMes } = await supabase.from('ventas')
      .select('estacion_id,regular_ingresos,premium_ingresos,diesel_ingresos,diesel_plus_ingresos,regular_litros,premium_litros,diesel_litros,diesel_plus_litros')
      .gte('fecha',primerDia)
    const mensualMap={}
    ;(ventasMes||[]).forEach(v => {
      if (!mensualMap[v.estacion_id]) mensualMap[v.estacion_id]={ingresos:0,galones:0}
      mensualMap[v.estacion_id].ingresos+=v.regular_ingresos+v.premium_ingresos+v.diesel_ingresos+v.diesel_plus_ingresos
      mensualMap[v.estacion_id].galones+=v.regular_litros+v.premium_litros+v.diesel_litros+v.diesel_plus_litros
    })
    setMensual(mensualMap)
    setUltimaActualizacion(new Date().toLocaleTimeString('es-GT'))
    setSegundos(30)
  }, [])

  const cargarFacturasResumen = useCallback(async () => {
    const { data: facts } = await supabase.from('facturas').select('estacion_id,estado,monto').in('estado',['pendiente','vencida'])
    const factMap={}
    ;(facts||[]).forEach(f => {
      if (!factMap[f.estacion_id]) factMap[f.estacion_id]={pendiente:0,vencida:0,total:0}
      factMap[f.estacion_id][f.estado]+=1
      factMap[f.estacion_id].total+=parseFloat(f.monto)
    })
    setFacturas(factMap)
  }, [])

  useEffect(() => {
    if (!session) { router.push('/'); return }
    async function init() {
      const { data: p } = await supabase.from('perfiles').select('*').eq('id',session.user.id).single()
      if (!p||p.rol!=='admin') { router.push('/dashboard'); return }
      setPerfil(p)
      const { data: ests } = await supabase.from('estaciones').select('*').eq('activa',true).order('nombre')
      setEstaciones(ests||[])
      await cargarDatos(); await cargarFacturasResumen()
      setLoading(false)
    }
    init()
  }, [session])

  useEffect(() => {
    if (!perfil) return
    const intervalo = setInterval(async () => { await cargarDatos(); await cargarFacturasResumen() }, 30000)
    return () => clearInterval(intervalo)
  }, [perfil, cargarDatos, cargarFacturasResumen])

  useEffect(() => {
    if (!perfil) return
    const tick = setInterval(() => setSegundos(s=>s>0?s-1:30), 1000)
    return () => clearInterval(tick)
  }, [perfil])

  async function verFacturasEstacion(est) {
    setEstacionFacturas(est); setLoadingFacturas(true)
    const { data } = await supabase.from('facturas').select('*').eq('estacion_id',est.id).order('fecha_emision',{ascending:false})
    setFacturasDetalle(data||[]); setLoadingFacturas(false)
  }

  function descargarCSV(datos, nombreArchivo) {
    if (!datos||datos.length===0) return
    const keys=Object.keys(datos[0])
    const csv=[keys.join(','),...datos.map(row=>keys.map(k=>`"${String(row[k]??'').replace(/"/g,'""')}"`).join(','))].join('\n')
    const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'})
    const url=URL.createObjectURL(blob)
    const a=document.createElement('a'); a.href=url; a.download=nombreArchivo; a.click()
    URL.revokeObjectURL(url)
  }

  function ventaAFila(v, estacionNombre, combustiblesEst, modoConsolidado) {
    const totalIngresos=parseFloat(v.regular_ingresos||0)+parseFloat(v.premium_ingresos||0)+parseFloat(v.diesel_ingresos||0)+parseFloat(v.diesel_plus_ingresos||0)
    const totalCobros=metodosPago.reduce((s,m)=>s+(parseFloat(v[m])||0),0)
    const fila={}
    if (estacionNombre) fila['Estacion']=estacionNombre
    fila['Fecha']=v.fecha

    // Modo individual: filtrar columnas por combustibles de la estacion
    // Modo consolidado: mostrar las 4 columnas siempre, vacio donde no aplica
    const combustibles = combustiblesEst || []
    const tieneSuper = combustibles.includes('super')
    const tieneVPower = combustibles.includes('vpower')
    const tieneDiesel = combustibles.includes('diesel')
    const tieneRegular = combustibles.includes('regular')

    if (modoConsolidado) {
      fila['Super (gal)'] = tieneSuper ? (v.regular_litros||0) : ''
      fila['Super (Q)'] = tieneSuper ? (v.regular_ingresos||0) : ''
      fila['V-Power (gal)'] = tieneVPower ? (v.premium_litros||0) : ''
      fila['V-Power (Q)'] = tieneVPower ? (v.premium_ingresos||0) : ''
      fila['Diesel (gal)'] = tieneDiesel ? (v.diesel_litros||0) : ''
      fila['Diesel (Q)'] = tieneDiesel ? (v.diesel_ingresos||0) : ''
      fila['Regular (gal)'] = tieneRegular ? (v.diesel_plus_litros||0) : ''
      fila['Regular (Q)'] = tieneRegular ? (v.diesel_plus_ingresos||0) : ''
    } else {
      if (tieneSuper) {
        fila['Super (gal)']=v.regular_litros||0
        fila['Super (Q)']=v.regular_ingresos||0
      }
      if (tieneVPower) {
        fila['V-Power (gal)']=v.premium_litros||0
        fila['V-Power (Q)']=v.premium_ingresos||0
      }
      if (tieneDiesel) {
        fila['Diesel (gal)']=v.diesel_litros||0
        fila['Diesel (Q)']=v.diesel_ingresos||0
      }
      if (tieneRegular) {
        fila['Regular (gal)']=v.diesel_plus_litros||0
        fila['Regular (Q)']=v.diesel_plus_ingresos||0
      }
    }

    fila['Total Q']=totalIngresos
    metodosPago.forEach(m=>{ fila[metodosLabel[m]]=parseFloat(v[m])||0 })
    fila['Total cobros']=totalCobros
    fila['Diferencia']=parseFloat((totalIngresos-totalCobros).toFixed(2))
    fila['Notas']=v.notas||''
    return fila
  }

  async function exportar(estacion, tipo) {
    setExportando(`${estacion.id}-${tipo}`)
    const nombre=estacion.nombre.replace(/\s+/g,'_'); const fecha=new Date().toISOString().split('T')[0]
    if (tipo==='ventas') {
      const { data } = await supabase.from('ventas').select(`fecha,regular_litros,regular_ingresos,premium_litros,premium_ingresos,diesel_litros,diesel_ingresos,diesel_plus_litros,diesel_plus_ingresos,${metodosPago.join(', ')},notas`).eq('estacion_id',estacion.id).order('fecha',{ascending:false})
      descargarCSV((data||[]).map(v=>ventaAFila(v,null,estacion.combustibles||[],false)),`ventas_${nombre}_${fecha}.csv`)
    }
    if (tipo==='lubricantes') {
      const { data } = await supabase.from('ventas_lubricantes').select('fecha,total_venta,neonet,efectivo,notas').eq('estacion_id',estacion.id).order('fecha',{ascending:false})
      descargarCSV((data||[]).map(l=>({Fecha:l.fecha,'Total venta (Q)':l.total_venta,'Neonet (Q)':l.neonet,'Efectivo (Q)':l.efectivo,Notas:l.notas||''})),`lubricantes_${nombre}_${fecha}.csv`)
    }
    if (tipo==='entregas') {
      const { data } = await supabase.from('entregas').select('fecha_entrega,proveedor,total_galones,regular_galones,premium_galones,diesel_galones,diesel_plus_galones,estado,notas').eq('estacion_id',estacion.id).order('fecha_entrega',{ascending:false})
      descargarCSV((data||[]).map(e=>({Fecha:e.fecha_entrega,Proveedor:e.proveedor,'Super (gal)':e.regular_galones||0,'V-Power (gal)':e.premium_galones||0,'Diesel (gal)':e.diesel_galones||0,'Regular (gal)':e.diesel_plus_galones||0,'Total galones':e.total_galones||0,Estado:e.estado,Notas:e.notas||''})),`entregas_${nombre}_${fecha}.csv`)
    }
    if (tipo==='facturas') {
      const { data } = await supabase.from('facturas').select('numero_factura,proveedor,fecha_emision,fecha_vencimiento,monto,estado,notas').eq('estacion_id',estacion.id).order('fecha_emision',{ascending:false})
      descargarCSV((data||[]).map(f=>({'No. Factura':f.numero_factura,Proveedor:f.proveedor,'Fecha emisión':f.fecha_emision,'Fecha vencimiento':f.fecha_vencimiento,'Monto (Q)':f.monto,Estado:f.estado,Notas:f.notas||''})),`facturas_${nombre}_${fecha}.csv`)
    }
    if (tipo==='inventario') {
      const { data } = await supabase.from('inventario').select('*').eq('estacion_id',estacion.id).order('created_at',{ascending:false})
      descargarCSV((data||[]).map(i=>({Fecha:i.created_at?.split('T')[0]||'',Producto:i.producto||'',Cantidad:i.cantidad||0,Unidad:i.unidad||'',Notas:i.notas||''})),`inventario_${nombre}_${fecha}.csv`)
    }
    setExportando(null)
  }

  async function exportarTodaLaRed(tipo) {
    setExportando(`red-${tipo}`)
    const todasFilas=[]; const fecha=new Date().toISOString().split('T')[0]
    for (const est of estaciones) {
      if (tipo==='ventas') {
        const { data } = await supabase.from('ventas').select(`fecha,regular_litros,regular_ingresos,premium_litros,premium_ingresos,diesel_litros,diesel_ingresos,diesel_plus_litros,diesel_plus_ingresos,${metodosPago.join(', ')},notas`).eq('estacion_id',est.id).order('fecha',{ascending:false})
        ;(data||[]).forEach(v=>todasFilas.push(ventaAFila(v,est.nombre,est.combustibles||[],true)))
      }
      if (tipo==='lubricantes') {
        const { data } = await supabase.from('ventas_lubricantes').select('fecha,total_venta,neonet,efectivo,notas').eq('estacion_id',est.id).order('fecha',{ascending:false})
        ;(data||[]).forEach(l=>todasFilas.push({Estacion:est.nombre,Fecha:l.fecha,'Total venta (Q)':l.total_venta,'Neonet (Q)':l.neonet,'Efectivo (Q)':l.efectivo,Notas:l.notas||''}))
      }
      if (tipo==='entregas') {
        const { data } = await supabase.from('entregas').select('fecha_entrega,proveedor,total_galones,regular_galones,premium_galones,diesel_galones,diesel_plus_galones,estado,notas').eq('estacion_id',est.id).order('fecha_entrega',{ascending:false})
        ;(data||[]).forEach(e=>todasFilas.push({Estacion:est.nombre,Fecha:e.fecha_entrega,Proveedor:e.proveedor,'Super (gal)':e.regular_galones||0,'V-Power (gal)':e.premium_galones||0,'Diesel (gal)':e.diesel_galones||0,'Regular (gal)':e.diesel_plus_galones||0,'Total galones':e.total_galones||0,Estado:e.estado,Notas:e.notas||''}))
      }
      if (tipo==='facturas') {
        const { data } = await supabase.from('facturas').select('numero_factura,proveedor,fecha_emision,fecha_vencimiento,monto,estado,notas').eq('estacion_id',est.id).order('fecha_emision',{ascending:false})
        ;(data||[]).forEach(f=>todasFilas.push({Estacion:est.nombre,'No. Factura':f.numero_factura,Proveedor:f.proveedor,'Fecha emisión':f.fecha_emision,'Fecha vencimiento':f.fecha_vencimiento,'Monto (Q)':f.monto,Estado:f.estado,Notas:f.notas||''}))
      }
      if (tipo==='inventario') {
        const { data } = await supabase.from('inventario').select('*').eq('estacion_id',est.id).order('created_at',{ascending:false})
        ;(data||[]).forEach(i=>todasFilas.push({Estacion:est.nombre,Fecha:i.created_at?.split('T')[0]||'',Producto:i.producto||'',Cantidad:i.cantidad||0,Unidad:i.unidad||'',Notas:i.notas||''}))
      }
    }
    descargarCSV(todasFilas,`${tipo}_todas_${fecha}.csv`)
    setExportando(null)
  }

  async function abrirDetalle(estacion, tipo) {
    setEstacionSeleccionada(estacion); setVistaDetalle(tipo); setLoadingRegistros(true)
    let data=[]
    if (tipo==='ventas') { const r=await supabase.from('ventas').select('*').eq('estacion_id',estacion.id).order('fecha',{ascending:false}).limit(30); data=r.data||[] }
    else if (tipo==='lubricantes') { const r=await supabase.from('ventas_lubricantes').select('*,ventas_lubricantes_detalle(*)').eq('estacion_id',estacion.id).order('fecha',{ascending:false}).limit(30); data=r.data||[] }
    else if (tipo==='entregas') { const r=await supabase.from('entregas').select('*').eq('estacion_id',estacion.id).order('fecha_entrega',{ascending:false}).limit(30); data=r.data||[] }
    else if (tipo==='facturas') { const r=await supabase.from('facturas').select('*').eq('estacion_id',estacion.id).order('fecha_emision',{ascending:false}).limit(30); data=r.data||[] }
    else if (tipo==='inventario') { const r=await supabase.from('inventario').select('*').eq('estacion_id',estacion.id).order('created_at',{ascending:false}).limit(30); data=r.data||[] }
    setRegistros(data); setLoadingRegistros(false)
  }

  async function eliminar(tabla, id) {
    if (!confirm('¿Eliminar este registro? Esta acción no se puede deshacer.')) return
    setEliminando(id)
    await supabase.from(tabla).delete().eq('id',id)
    setRegistros(prev=>prev.filter(r=>r.id!==id))
    if (tabla==='ventas') cargarDatos()
    if (tabla==='facturas') cargarFacturasResumen()
    toast('Registro eliminado','info')
    setEliminando(null)
  }

  if (loading) return <div className="flex items-center justify-center h-screen text-sm text-gray-400">Cargando...</div>

  const totalAyer=Object.values(resumen).reduce((s,v)=>s+v.regular_ingresos+v.premium_ingresos+v.diesel_ingresos+v.diesel_plus_ingresos,0)
  const totalGalonesAyer=Object.values(resumen).reduce((s,v)=>s+v.regular_litros+v.premium_litros+v.diesel_litros+v.diesel_plus_litros,0)
  const totalMensual=Object.values(mensual).reduce((s,m)=>s+m.ingresos,0)
  const totalGalonesMes=Object.values(mensual).reduce((s,m)=>s+m.galones,0)
  const estacionesConAlerta=estaciones.filter(e=>facturas[e.id]?.vencida>0).length
  const totalFacturasPendientes=Object.values(facturas).reduce((s,f)=>s+f.total,0)
  const reportaronAyer=estaciones.filter(e=>resumen[e.id]).length
  const mesActual=new Date().toLocaleDateString('es-GT',{month:'long',year:'numeric'})
  const diasTranscurridos=new Date().getDate()-1
  const estadoColor={pendiente:'bg-amber-50 text-amber-600',pagada:'bg-green-50 text-green-700',vencida:'bg-red-50 text-red-600'}

  return (
    <Layout perfil={perfil} estacion={null}>
      <ToastContainer toasts={toasts} />

      {modalEdicion && (
        <ModalEdicion
          registro={modalEdicion.registro}
          tipo={modalEdicion.tipo}
          onClose={() => setModalEdicion(null)}
          onGuardado={async () => {
            toast('✓ Registro actualizado','success')
            await abrirDetalle(estacionSeleccionada, vistaDetalle)
            if (vistaDetalle==='ventas') cargarDatos()
            if (vistaDetalle==='facturas') cargarFacturasResumen()
          }}
        />
      )}

      <div className="p-6">

        {estacionFacturas && (
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => { setEstacionFacturas(null); setFacturasDetalle([]) }} className="text-sm text-blue-600 hover:text-blue-800">← Volver</button>
              <h2 className="text-base font-medium text-gray-900">Facturas — {estacionFacturas.nombre}</h2>
            </div>
            {loadingFacturas ? <div className="text-sm text-gray-400 py-4">Cargando...</div> : (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {facturasDetalle.length===0 && <div className="px-5 py-6 text-center text-xs text-gray-400">Sin facturas</div>}
                {facturasDetalle.length>0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Factura</th>
                        <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Proveedor</th>
                        <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Emisión</th>
                        <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Vencimiento</th>
                        <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Monto</th>
                        <th className="px-3 py-2.5 text-center text-xs text-gray-400 font-normal">Estado</th>
                        <th className="px-3 py-2.5 text-center text-xs text-gray-400 font-normal">Archivo</th>
                        <th className="px-4 py-2.5"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {facturasDetalle.map(f => (
                        <tr key={f.id} className={`border-b border-gray-50 hover:bg-gray-50 ${f.estado==='vencida'?'bg-red-50/30':''}`}>
                          <td className="px-4 py-3 font-medium text-gray-800">{f.numero_factura}</td>
                          <td className="px-3 py-3 text-gray-600">{f.proveedor}</td>
                          <td className="px-3 py-3 text-gray-600">{f.fecha_emision}</td>
                          <td className="px-3 py-3 text-gray-600">{f.fecha_vencimiento}</td>
                          <td className="px-3 py-3 text-right font-medium text-gray-800">Q{Math.round(f.monto).toLocaleString('es-GT')}</td>
                          <td className="px-3 py-3 text-center"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoColor[f.estado]}`}>{f.estado}</span></td>
                          <td className="px-3 py-3 text-center">
                            {f.archivo_url ? (
                              <div className="flex items-center justify-center gap-2">
                                <button onClick={() => window.open(f.archivo_url,'_blank')} className="text-xs text-blue-600 hover:text-blue-800">Ver</button>
                                <a href={f.archivo_url} download className="text-xs text-green-600 hover:text-green-800">↓</a>
                              </div>
                            ) : <span className="text-xs text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <button onClick={() => setModalEdicion({registro:f,tipo:'facturas'})} className="text-xs text-blue-500 hover:text-blue-700">Editar</button>
                              <button onClick={() => eliminar('facturas',f.id)} disabled={eliminando===f.id} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40">{eliminando===f.id?'...':'Eliminar'}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}

        {vistaDetalle && !estacionFacturas && (
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <button onClick={() => { setVistaDetalle(null); setEstacionSeleccionada(null) }} className="text-sm text-blue-600 hover:text-blue-800">← Volver</button>
              <h2 className="text-base font-medium text-gray-900">{vistaDetalle.charAt(0).toUpperCase()+vistaDetalle.slice(1)} — {estacionSeleccionada?.nombre}</h2>
            </div>
            {loadingRegistros ? <div className="text-sm text-gray-400 py-4">Cargando...</div> : (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                {registros.length===0 && <div className="px-5 py-6 text-center text-xs text-gray-400">Sin registros</div>}
                {vistaDetalle==='ventas' && registros.length>0 && (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Super</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">V-Power</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Diesel</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Regular</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Total Q</th>
                      <th className="px-3 py-2.5 text-center text-xs text-gray-400 font-normal">Dif.</th>
                      <th className="px-4 py-2.5"></th>
                    </tr></thead>
                    <tbody>
                      {registros.map(v => {
                        const total=v.regular_ingresos+v.premium_ingresos+v.diesel_ingresos+v.diesel_plus_ingresos
                        const cobros=metodosPago.reduce((s,m)=>s+(parseFloat(v[m])||0),0)
                        const dif=total-cobros
                        return (
                          <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-700">{v.fecha}</td>
                            <td className="px-3 py-3 text-right text-gray-600">{parseFloat(v.regular_litros).toLocaleString('es-GT')} gal</td>
                            <td className="px-3 py-3 text-right text-gray-600">{parseFloat(v.premium_litros).toLocaleString('es-GT')} gal</td>
                            <td className="px-3 py-3 text-right text-gray-600">{parseFloat(v.diesel_litros).toLocaleString('es-GT')} gal</td>
                            <td className="px-3 py-3 text-right text-gray-600">{parseFloat(v.diesel_plus_litros).toLocaleString('es-GT')} gal</td>
                            <td className="px-3 py-3 text-right font-medium text-gray-800">Q{Math.round(total).toLocaleString('es-GT')}</td>
                            <td className="px-3 py-3 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${Math.abs(dif)<0.01?'bg-green-50 text-green-700':'bg-red-50 text-red-600'}`}>
                                {Math.abs(dif)<0.01?'OK':`Q${dif.toFixed(2)}`}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center gap-2 justify-end">
                                <button onClick={() => setModalEdicion({registro:v,tipo:'ventas'})} className="text-xs text-blue-500 hover:text-blue-700">Editar</button>
                                <button onClick={() => eliminar('ventas',v.id)} disabled={eliminando===v.id} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40">{eliminando===v.id?'...':'Eliminar'}</button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
                {vistaDetalle==='lubricantes' && registros.length>0 && (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Total venta</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Neonet</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Efectivo</th>
                      <th className="px-4 py-2.5"></th>
                    </tr></thead>
                    <tbody>
                      {registros.map(l => (
                        <tr key={l.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-700">{l.fecha}</td>
                          <td className="px-3 py-3 text-right font-medium text-gray-800">Q{parseFloat(l.total_venta||0).toLocaleString('es-GT',{maximumFractionDigits:2})}</td>
                          <td className="px-3 py-3 text-right text-gray-600">{parseFloat(l.neonet||0)>0?`Q${parseFloat(l.neonet).toLocaleString('es-GT',{maximumFractionDigits:2})}`:'—'}</td>
                          <td className="px-3 py-3 text-right text-gray-600">{parseFloat(l.efectivo||0)>0?`Q${parseFloat(l.efectivo).toLocaleString('es-GT',{maximumFractionDigits:2})}`:'—'}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <button onClick={() => setModalEdicion({registro:l,tipo:'lubricantes'})} className="text-xs text-blue-500 hover:text-blue-700">Editar</button>
                              <button onClick={() => eliminar('ventas_lubricantes',l.id)} disabled={eliminando===l.id} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40">{eliminando===l.id?'...':'Eliminar'}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {vistaDetalle==='entregas' && registros.length>0 && (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                      <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Proveedor</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Total gal</th>
                      <th className="px-3 py-2.5 text-center text-xs text-gray-400 font-normal">Estado</th>
                      <th className="px-4 py-2.5"></th>
                    </tr></thead>
                    <tbody>
                      {registros.map(e => (
                        <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-700">{e.fecha_entrega}</td>
                          <td className="px-3 py-3 text-gray-600">{e.proveedor}</td>
                          <td className="px-3 py-3 text-right text-gray-700">{parseFloat(e.total_galones||0).toLocaleString('es-GT')} gal</td>
                          <td className="px-3 py-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${e.estado==='confirmada'?'bg-green-50 text-green-700':e.estado==='cancelada'?'bg-red-50 text-red-600':'bg-amber-50 text-amber-600'}`}>{e.estado}</span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <button onClick={() => setModalEdicion({registro:e,tipo:'entregas'})} className="text-xs text-blue-500 hover:text-blue-700">Editar</button>
                              <button onClick={() => eliminar('entregas',e.id)} disabled={eliminando===e.id} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40">{eliminando===e.id?'...':'Eliminar'}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {vistaDetalle==='facturas' && registros.length>0 && (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Factura</th>
                      <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Proveedor</th>
                      <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Emisión</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Monto</th>
                      <th className="px-3 py-2.5 text-center text-xs text-gray-400 font-normal">Estado</th>
                      <th className="px-4 py-2.5"></th>
                    </tr></thead>
                    <tbody>
                      {registros.map(f => (
                        <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-800">{f.numero_factura}</td>
                          <td className="px-3 py-3 text-gray-600">{f.proveedor}</td>
                          <td className="px-3 py-3 text-gray-600">{f.fecha_emision}</td>
                          <td className="px-3 py-3 text-right font-medium text-gray-800">Q{Math.round(f.monto).toLocaleString('es-GT')}</td>
                          <td className="px-3 py-3 text-center"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${estadoColor[f.estado]}`}>{f.estado}</span></td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center gap-2 justify-end">
                              <button onClick={() => setModalEdicion({registro:f,tipo:'facturas'})} className="text-xs text-blue-500 hover:text-blue-700">Editar</button>
                              <button onClick={() => eliminar('facturas',f.id)} disabled={eliminando===f.id} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40">{eliminando===f.id?'...':'Eliminar'}</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {vistaDetalle==='inventario' && registros.length>0 && (
                  <table className="w-full text-sm">
                    <thead><tr className="border-b border-gray-100">
                      <th className="px-4 py-2.5 text-left text-xs text-gray-400 font-normal">Fecha</th>
                      <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Producto</th>
                      <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Cantidad</th>
                      <th className="px-3 py-2.5 text-left text-xs text-gray-400 font-normal">Unidad</th>
                      <th className="px-4 py-2.5"></th>
                    </tr></thead>
                    <tbody>
                      {registros.map(i => (
                        <tr key={i.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-700">{i.created_at?.split('T')[0]}</td>
                          <td className="px-3 py-3 text-gray-700">{i.producto}</td>
                          <td className="px-3 py-3 text-right text-gray-700">{i.cantidad}</td>
                          <td className="px-3 py-3 text-gray-600">{i.unidad}</td>
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => eliminar('inventario',i.id)} disabled={eliminando===i.id} className="text-xs text-red-500 hover:text-red-700 disabled:opacity-40">{eliminando===i.id?'...':'Eliminar'}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        )}

        {!vistaDetalle && !estacionFacturas && (
          <>
            <div className="flex items-start justify-between mb-5">
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Panel general</h1>
                <p className="text-sm text-gray-400">{new Date().toLocaleDateString('es-GT',{dateStyle:'long'})}</p>
              </div>
              <div className="flex items-center gap-3">
                {ultimaActualizacion && <span className="text-xs text-gray-400">Actualizado: {ultimaActualizacion}</span>}
                <button onClick={() => { cargarDatos(); cargarFacturasResumen() }} className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">Actualizar</button>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                  <span className="text-xs text-green-700 font-medium">Auto {segundos}s</span>
                </div>
              </div>
            </div>

            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Ayer</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs text-gray-500 mb-1">Ingresos red</div>
                <div className="text-2xl font-medium text-gray-900">Q{Math.round(totalAyer).toLocaleString('es-GT')}</div>
                <div className="text-xs text-gray-400 mt-1">{reportaronAyer} de {estaciones.length} reportaron</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs text-gray-500 mb-1">Galones vendidos</div>
                <div className="text-2xl font-medium text-gray-900">{Math.round(totalGalonesAyer).toLocaleString('es-GT')}</div>
                <div className="text-xs text-gray-400 mt-1">Red completa</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs text-gray-500 mb-1">Estaciones con alerta</div>
                <div className={`text-2xl font-medium ${estacionesConAlerta>0?'text-red-600':'text-gray-900'}`}>{estacionesConAlerta}</div>
                <div className="text-xs text-gray-400 mt-1">{estacionesConAlerta>0?'Facturas vencidas':'Sin alertas'}</div>
              </div>
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="text-xs text-gray-500 mb-1">Total por cobrar</div>
                <div className="text-2xl font-medium text-gray-900">Q{Math.round(totalFacturasPendientes).toLocaleString('es-GT')}</div>
                <div className="text-xs text-gray-400 mt-1">Pendiente + vencido</div>
              </div>
            </div>

            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide capitalize">{mesActual}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="text-xs text-blue-600 mb-1">Ingresos del mes</div>
                <div className="text-2xl font-medium text-blue-800">Q{Math.round(totalMensual).toLocaleString('es-GT')}</div>
                <div className="text-xs text-blue-400 mt-1">Acumulado red</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="text-xs text-blue-600 mb-1">Galones del mes</div>
                <div className="text-2xl font-medium text-blue-800">{Math.round(totalGalonesMes).toLocaleString('es-GT')}</div>
                <div className="text-xs text-blue-400 mt-1">Acumulado red</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="text-xs text-blue-600 mb-1">Días transcurridos</div>
                <div className="text-2xl font-medium text-blue-800">{diasTranscurridos}</div>
                <div className="text-xs text-blue-400 mt-1">Del mes actual</div>
              </div>
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="text-xs text-blue-600 mb-1">Promedio diario</div>
                <div className="text-2xl font-medium text-blue-800">{diasTranscurridos>0?`Q${Math.round(totalMensual/diasTranscurridos).toLocaleString('es-GT')}`:'—'}</div>
                <div className="text-xs text-blue-400 mt-1">Por día red completa</div>
              </div>
            </div>

            <div className="flex gap-1 mb-4 border-b border-gray-100 overflow-x-auto">
              {[['ayer','Ventas de ayer'],['mensual','Acumulado mensual'],['tanques','Tanques'],['facturas-pdf','Facturas y PDFs'],['gestionar','Gestionar registros'],['facturas','Facturas pendientes']].map(([key,label]) => (
                <button key={key} onClick={() => setSeccion(key)}
                  className={`px-4 py-2 text-sm border-b-2 transition-colors whitespace-nowrap ${seccion===key?'border-blue-600 text-blue-700 font-medium':'border-transparent text-gray-500 hover:text-gray-700'}`}>
                  {label}
                </button>
              ))}
            </div>

            {seccion==='ayer' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {estaciones.map(est => {
                  const v=resumen[est.id]
                  const total=v?v.regular_ingresos+v.premium_ingresos+v.diesel_ingresos+v.diesel_plus_ingresos:0
                  const galones=v?v.regular_litros+v.premium_litros+v.diesel_litros+v.diesel_plus_litros:0
                  const tieneAlerta=facturas[est.id]?.vencida>0
                  return (
                    <div key={est.id} className={`bg-white rounded-xl border p-4 ${tieneAlerta?'border-l-4 border-l-red-400 border-gray-100':'border-gray-100'}`}>
                      <div className="flex justify-between items-start mb-1">
                        <div className="text-sm font-medium text-gray-800">{est.nombre}</div>
                        {tieneAlerta && <span className="text-xs bg-red-50 text-red-600 px-2 py-0.5 rounded-full">Alerta</span>}
                        {!tieneAlerta && v && <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">Reportó</span>}
                        {!v && <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Sin reporte</span>}
                      </div>
                      <div className="text-xs text-gray-400 mb-2">{est.zona}</div>
                      <div className="text-xl font-medium text-gray-900 mb-1">{v?`Q${Math.round(total).toLocaleString('es-GT')}`:'—'}</div>
                      <div className="text-xs text-gray-400">{v?`${Math.round(galones).toLocaleString('es-GT')} gal vendidos`:'Sin registro ayer'}</div>
                    </div>
                  )
                })}
              </div>
            )}

            {seccion==='mensual' && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100">
                    <th className="px-5 py-2.5 text-left text-xs text-gray-400 font-normal">Estación</th>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Ingresos mes</th>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Galones mes</th>
                    <th className="px-5 py-2.5 text-right text-xs text-gray-400 font-normal">Promedio diario</th>
                  </tr></thead>
                  <tbody>
                    {estaciones.map(est => {
                      const m=mensual[est.id]
                      return (
                        <tr key={est.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-5 py-3 font-medium text-gray-800">{est.nombre}</td>
                          <td className="px-3 py-3 text-right text-gray-800 font-medium">{m?`Q${Math.round(m.ingresos).toLocaleString('es-GT')}`:'—'}</td>
                          <td className="px-3 py-3 text-right text-gray-600">{m?Math.round(m.galones).toLocaleString('es-GT'):'—'}</td>
                          <td className="px-5 py-3 text-right text-gray-500">{m&&diasTranscurridos>0?`Q${Math.round(m.ingresos/diasTranscurridos).toLocaleString('es-GT')}`:'—'}</td>
                        </tr>
                      )
                    })}
                    <tr className="bg-blue-50">
                      <td className="px-5 py-3 font-medium text-blue-800">Total red</td>
                      <td className="px-3 py-3 text-right font-medium text-blue-800">Q{Math.round(totalMensual).toLocaleString('es-GT')}</td>
                      <td className="px-3 py-3 text-right font-medium text-blue-800">{Math.round(totalGalonesMes).toLocaleString('es-GT')}</td>
                      <td className="px-5 py-3 text-right font-medium text-blue-800">{diasTranscurridos>0?`Q${Math.round(totalMensual/diasTranscurridos).toLocaleString('es-GT')}`:'—'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {seccion==='tanques' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 mb-3">Haz clic en cada estación para ver su historial de niveles.</p>
                {estaciones.map(est => <TanquesEstacion key={est.id} estacion={est} />)}
              </div>
            )}

            {seccion==='facturas-pdf' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 mb-3">Selecciona una estación para ver sus facturas y PDFs.</p>
                {estaciones.map(est => (
                  <div key={est.id} className="bg-white rounded-xl border border-gray-100 px-5 py-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-medium text-gray-800">{est.nombre}</div>
                      <div className="text-xs text-gray-400">{est.zona}</div>
                    </div>
                    <button onClick={() => verFacturasEstacion(est)} className="text-xs px-3 py-1.5 bg-blue-50 border border-blue-100 rounded-lg hover:bg-blue-100 text-blue-700">Ver facturas</button>
                  </div>
                ))}
              </div>
            )}

            {seccion==='gestionar' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs text-gray-400">Exporta, edita y elimina registros por estación.</p>
                  <div className="flex gap-2 flex-wrap justify-end">
                    <span className="text-xs text-gray-400 self-center">Toda la red:</span>
                    {TIPOS_GESTION.map(tipo => (
                      <button key={tipo} onClick={() => exportarTodaLaRed(tipo)} disabled={exportando===`red-${tipo}`}
                        className="text-xs px-3 py-1.5 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 text-green-700 disabled:opacity-40 capitalize">
                        {exportando===`red-${tipo}`?'...':`↓ ${tipo}`}
                      </button>
                    ))}
                  </div>
                </div>
                {estaciones.map(est => (
                  <div key={est.id} className="bg-white rounded-xl border border-gray-100 px-5 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-gray-800">{est.nombre}</div>
                        <div className="text-xs text-gray-400">{est.zona}</div>
                      </div>
                      <div className="flex gap-2 flex-wrap justify-end">
                        {TIPOS_GESTION.map(tipo => (
                          <div key={tipo} className="flex gap-1">
                            <button onClick={() => abrirDetalle(est,tipo)}
                              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 capitalize">{tipo}</button>
                            <button onClick={() => exportar(est,tipo)} disabled={exportando===`${est.id}-${tipo}`}
                              className="text-xs px-2 py-1.5 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 text-green-700 disabled:opacity-40">
                              {exportando===`${est.id}-${tipo}`?'...':'↓'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {seccion==='facturas' && (
              <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100">
                    <th className="px-5 py-2.5 text-left text-xs text-gray-400 font-normal">Estación</th>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Pendientes</th>
                    <th className="px-3 py-2.5 text-right text-xs text-gray-400 font-normal">Vencidas</th>
                    <th className="px-5 py-2.5 text-right text-xs text-gray-400 font-normal">Total Q</th>
                  </tr></thead>
                  <tbody>
                    {estaciones.filter(e=>facturas[e.id]).length===0 && <tr><td colSpan={4} className="px-5 py-6 text-center text-xs text-gray-400">No hay facturas pendientes</td></tr>}
                    {estaciones.filter(e=>facturas[e.id]).map(est => (
                      <tr key={est.id} className={`border-b border-gray-50 ${facturas[est.id]?.vencida>0?'bg-red-50/30':''}`}>
                        <td className="px-5 py-3 font-medium text-gray-800">{est.nombre}</td>
                        <td className="px-3 py-3 text-right text-amber-600">{facturas[est.id]?.pendiente||0}</td>
                        <td className="px-3 py-3 text-right text-red-600 font-medium">{facturas[est.id]?.vencida||0}</td>
                        <td className="px-5 py-3 text-right font-medium text-gray-800">Q{Math.round(facturas[est.id]?.total||0).toLocaleString('es-GT')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  )
}
