import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import SelectUnidad from '../components/SelectUnidad'
import { factorEntre, parseUnidad, mismaUnidad } from '../lib/unidades'

// ============================================================================
// Helpers compartidos
// ============================================================================

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

function formatMoney(n) {
  return 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatNum(n) {
  return Number(n || 0).toLocaleString('es-GT', { maximumFractionDigits: 3 })
}
function formatFecha(s) {
  if (!s) return '—'
  return new Date(s + (s.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })
}
function hoyISO() {
  const ms = Date.now() - 6 * 60 * 60 * 1000 // GT = UTC-6
  return new Date(ms).toISOString().slice(0, 10)
}

const ESTADOS = {
  borrador: { label: 'Borrador', cls: 'bg-gray-100 text-gray-700' },
  recibida: { label: 'Recibida', cls: 'bg-green-100 text-green-700' },
  anulada:  { label: 'Anulada',  cls: 'bg-red-100 text-red-700' },
}

// ============================================================================
// Pagina
// ============================================================================

export default function Compras({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [tab, setTab] = useState('compras')

  useEffect(() => {
    if (!session) { router.push('/login'); return }
    (async () => {
      const { data } = await supabase.from('perfiles')
        .select('id, email, nombre_completo, rol, activo')
        .eq('id', session.user.id).single()
      setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' })
    })()
  }, [session])

  const esAdmin = perfil?.rol === 'admin'

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 mb-4">Compras</h1>

        <div className="flex gap-1 border-b border-gray-200 mb-5">
          <TabBtn active={tab === 'compras'}     onClick={() => setTab('compras')}>Órdenes</TabBtn>
          <TabBtn active={tab === 'proveedores'} onClick={() => setTab('proveedores')}>Proveedores</TabBtn>
        </div>

        {tab === 'compras'     && <TabCompras esAdmin={esAdmin} />}
        {tab === 'proveedores' && <TabProveedores esAdmin={esAdmin} />}
      </div>
    </Layout>
  )
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors ${
        active ? 'border-b-2 border-julia-red text-julia-red' : 'text-gray-500 hover:text-gray-800'
      }`}>{children}</button>
  )
}

// ============================================================================
// Tab Compras
// ============================================================================

function TabCompras({ esAdmin }) {
  const [compras, setCompras] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [insumos, setInsumos] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  // Filtros (rango ultimo mes por default)
  const hace30 = useMemo(() => {
    const d = new Date(Date.now() - 6 * 3600 * 1000 - 30 * 86400 * 1000)
    return d.toISOString().slice(0, 10)
  }, [])
  const [desde, setDesde] = useState(hace30)
  const [hasta, setHasta] = useState(hoyISO())
  const [estado, setEstado] = useState('')
  const [proveedorFiltro, setProveedorFiltro] = useState('')

  const [modal, setModal] = useState(null) // {tipo: 'crear'|'detalle'|'editar'|'anular', compra?, compraId?}

  useEffect(() => { cargarMaestros() }, [])
  useEffect(() => { cargarCompras() }, [desde, hasta, estado, proveedorFiltro])

  async function cargarMaestros() {
    const [pRes, iRes] = await Promise.all([
      apiFetch('/api/proveedores'),
      apiFetch('/api/insumos'),
    ])
    const pJson = await pRes.json()
    const iJson = await iRes.json()
    setProveedores(pJson.proveedores || [])
    setInsumos(iJson.insumos || [])
  }

  async function cargarCompras() {
    setLoading(true); setErr(null)
    const params = new URLSearchParams()
    if (desde)            params.set('desde', desde)
    if (hasta)            params.set('hasta', hasta)
    if (estado)           params.set('estado', estado)
    if (proveedorFiltro)  params.set('proveedor_id', proveedorFiltro)
    const res = await apiFetch('/api/compras?' + params.toString())
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Error'); setCompras([]) }
    else setCompras(json.compras || [])
    setLoading(false)
  }

  const totales = useMemo(() => {
    let cant = 0, totalQ = 0
    compras.forEach(c => {
      if (c.estado !== 'anulada') { cant++; totalQ += Number(c.total) || 0 }
    })
    return { cant, totalQ }
  }, [compras])

  return (
    <div>
      {/* Resumen + Boton nueva */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
        <div className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">{totales.cant}</span> compras (no anuladas) por <span className="font-medium text-gray-900">{formatMoney(totales.totalQ)}</span>
        </div>
        {esAdmin && (
          <button onClick={() => setModal({ tipo: 'crear' })}
            className="px-4 py-2 bg-julia-red text-white text-sm rounded-lg hover:bg-red-900">
            + Nueva compra
          </button>
        )}
      </div>

      {/* Filtros */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Desde</span>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-julia-red" />
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Hasta</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-julia-red" />
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Estado</span>
          <select value={estado} onChange={e => setEstado(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-julia-red">
            <option value="">Todos</option>
            <option value="borrador">Borrador</option>
            <option value="recibida">Recibida</option>
            <option value="anulada">Anulada</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          <span className="block mb-1">Proveedor</span>
          <select value={proveedorFiltro} onChange={e => setProveedorFiltro(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-julia-red">
            <option value="">Todos</option>
            {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </select>
        </label>
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      {/* Tabla */}
      <div className="card-julia overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Fecha</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Proveedor</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">N° factura</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Total</th>
              <th className="text-center text-xs text-gray-400 font-normal px-4 py-2">Estado</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1,2,3].map(i => <tr key={i}><td colSpan={6}><SkeletonRow /></td></tr>)}</>
            ) : compras.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-8">
                Sin compras en este rango.
              </td></tr>
            ) : (
              compras.map(c => {
                const est = ESTADOS[c.estado] || ESTADOS.borrador
                return (
                  <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700">{formatFecha(c.fecha)}</td>
                    <td className="px-4 py-2.5 text-gray-700">{c.proveedores?.nombre || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{c.numero_factura || '—'}</td>
                    <td className="px-4 py-2.5 text-right text-gray-800 font-medium tabular-nums">{formatMoney(c.total)}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${est.cls}`}>{est.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => setModal({ tipo: 'detalle', compraId: c.id })}
                        className="text-xs px-2 py-1 text-julia-red hover:underline">
                        Ver
                      </button>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        </div>
      </div>

      {modal?.tipo === 'crear' && (
        <ModalCompra
          proveedores={proveedores} insumos={insumos}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargarCompras() }}
        />
      )}
      {modal?.tipo === 'detalle' && (
        <ModalDetalleCompra
          compraId={modal.compraId} esAdmin={esAdmin}
          onClose={() => setModal(null)}
          onChanged={() => { cargarCompras() }}
          onEdit={(compra) => setModal({ tipo: 'editar', compra })}
        />
      )}
      {modal?.tipo === 'editar' && (
        <ModalCompra
          proveedores={proveedores} insumos={insumos} compra={modal.compra}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargarCompras() }}
        />
      )}
    </div>
  )
}

// ============================================================================
// Modal: Crear / Editar compra
// ============================================================================

function ModalCompra({ proveedores, insumos, compra, onClose, onSaved }) {
  const edicion = !!compra
  const [cab, setCab] = useState({
    proveedor_id:  compra?.proveedor_id || '',
    fecha:         compra?.fecha || hoyISO(),
    numero_factura: compra?.numero_factura || '',
    serie_factura: compra?.serie_factura || '',
    iva:           compra?.iva ?? 0,
    metodo_pago:   compra?.metodo_pago || 'efectivo',
    notas:         compra?.notas || '',
  })
  const [lineas, setLineas] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (edicion) {
      apiFetch(`/api/compras/${compra.id}`)
        .then(r => r.json())
        .then(j => {
          setLineas((j.compra?.lineas || []).map(l => ({
            descripcion: l.descripcion,
            insumo_id: l.insumo_id || '',
            cantidad: l.cantidad,
            costo_unitario: l.costo_unitario,
            unidad: l.unidad || '',
            // Al editar una compra existente, los costos ya fueron confirmados
            // por el usuario en su momento; tratarlos como manuales para no
            // pisarlos si decide cambiar la unidad.
            costoManual: true,
          })))
        })
    } else {
      setLineas([nuevaLinea()])
    }
  }, [edicion])

  function nuevaLinea() {
    return { descripcion: '', insumo_id: '', cantidad: '', costo_unitario: '', unidad: '', costoManual: false }
  }

  // Calcula el costo sugerido EN LA UNIDAD DE LA LINEA, considerando conversion.
  // Reglas:
  //  1. Si la unidad de la linea = unidad_compra del insumo y hay costo_compra → costo_compra.
  //  2. Si la unidad de la linea es la unidad base del insumo → costo_unitario.
  //  3. Si la unidad de la linea es convertible a la unidad base (mismo tipo de medida)
  //     → costo_unitario * factor(unidadLinea → unidadBase). Ej: 1 quintal × 0.1543 Q/g × 45,359 g/quintal = Q7000.
  //  4. Si la unidad de la linea coincide (vía parseUnidad) con unidad_compra → idem (1).
  //  5. Si no hay forma de calcular → devuelve null para que el usuario tipee.
  function calcularCostoSugerido(insumo, unidadLinea) {
    if (!insumo) return null
    const u = (unidadLinea || '').trim()
    // (1) y (4): match con unidad_compra (vía mismaUnidad: tolera plurales,
    // case y sinonimos lb/libra).
    if (insumo.unidad_compra && insumo.costo_compra != null) {
      if (mismaUnidad(u, insumo.unidad_compra)) return Number(insumo.costo_compra)
    }
    // (2) y (3): conversion contra unidad base
    if (insumo.costo_unitario != null) {
      if (!u || u === insumo.unidad) return Number(insumo.costo_unitario)
      const f = factorEntre(u, insumo.unidad)
      if (f != null) return Number(insumo.costo_unitario) * f
    }
    return null
  }

  function setLin(i, k, v) {
    setLineas(ls => ls.map((l, idx) => {
      if (idx !== i) return l
      const next = { ...l, [k]: v }
      // Si el usuario edita el costo a mano, marcamos manual para no pisarle el valor
      // cuando cambie la unidad despues.
      if (k === 'costo_unitario') next.costoManual = true
      // Si cambia la unidad y el costo NO fue editado manualmente, recalcular
      // el costo sugerido para esa nueva unidad. Esto resuelve: elijo "café" (base g),
      // cambio unidad a "quintal" → costo se ajusta de Q0.15/g a Q7000/quintal.
      if (k === 'unidad' && !l.costoManual && l.insumo_id) {
        const insumo = insumos.find(x => x.id === l.insumo_id)
        const sug = calcularCostoSugerido(insumo, v)
        if (sug != null) next.costo_unitario = round4(sug)
      }
      return next
    }))
  }

  function elegirInsumo(i, insumo_id) {
    const insumo = insumos.find(x => x.id === insumo_id)
    setLineas(ls => ls.map((l, idx) => {
      if (idx !== i) return l
      if (!insumo) return { ...l, insumo_id: '' }
      // Unidad sugerida: respetar lo que el usuario haya tipeado; sino
      // preferir unidad_compra del insumo; sino su unidad base.
      const unidadSugerida = l.unidad || insumo.unidad_compra || insumo.unidad
      // Costo sugerido: SIEMPRE en la unidad de la linea (con conversion).
      // Si el usuario habia editado el costo a mano, respetar ese valor.
      let costoSugerido = l.costo_unitario
      if (!costoSugerido) {
        const sug = calcularCostoSugerido(insumo, unidadSugerida)
        costoSugerido = sug != null ? round4(sug) : ''
      }
      return {
        ...l,
        insumo_id,
        descripcion: l.descripcion || insumo.nombre,
        unidad: unidadSugerida,
        costo_unitario: costoSugerido,
        costoManual: false,
      }
    }))
  }

  function round4(n) { return Math.round(Number(n) * 10000) / 10000 }

  const subtotal = useMemo(() => {
    return lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), 0)
  }, [lineas])
  const total = subtotal + (Number(cab.iva) || 0)

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const lineasPayload = lineas
      .filter(l => l.descripcion && Number(l.cantidad) > 0 && Number(l.costo_unitario) >= 0)
      .map(l => ({
        descripcion: l.descripcion,
        insumo_id: l.insumo_id || null,
        cantidad: Number(l.cantidad),
        costo_unitario: Number(l.costo_unitario),
        unidad: l.unidad || null,
      }))

    if (lineasPayload.length === 0) {
      setErr('Agregá al menos una línea válida (descripción, cantidad y costo).')
      setGuardando(false); return
    }

    const payload = { ...cab, lineas: lineasPayload, iva: Number(cab.iva) || 0 }
    const res = await apiFetch(
      edicion ? `/api/compras/${compra.id}` : '/api/compras',
      { method: edicion ? 'PATCH' : 'POST', body: JSON.stringify(payload) }
    )
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error al guardar'); return }
    onSaved()
  }

  return (
    <ModalShell titulo={edicion ? 'Editar compra' : 'Nueva compra'} onClose={onClose} maxWidth="max-w-3xl">
      <form onSubmit={guardar} className="space-y-4">
        {/* Cabecera */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Campo label="Proveedor" required>
            <select value={cab.proveedor_id} onChange={e => setCab({...cab, proveedor_id: e.target.value})} required
              className="input">
              <option value="">— elegir —</option>
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Fecha" required>
            <input type="date" value={cab.fecha} onChange={e => setCab({...cab, fecha: e.target.value})} required className="input" />
          </Campo>
          <Campo label="Método de pago">
            <select value={cab.metodo_pago} onChange={e => setCab({...cab, metodo_pago: e.target.value})} className="input">
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
              <option value="cheque">Cheque</option>
              <option value="credito">Crédito</option>
              <option value="tarjeta">Tarjeta</option>
            </select>
          </Campo>
          <Campo label="Serie">
            <input type="text" value={cab.serie_factura} onChange={e => setCab({...cab, serie_factura: e.target.value})} className="input" />
          </Campo>
          <Campo label="N° factura">
            <input type="text" value={cab.numero_factura} onChange={e => setCab({...cab, numero_factura: e.target.value})} className="input" />
          </Campo>
          <Campo label="IVA (Q)">
            <input type="number" step="any" value={cab.iva} onChange={e => setCab({...cab, iva: e.target.value})} className="input" />
          </Campo>
        </div>

        {/* Lineas */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wide">Líneas</div>
            <button type="button" onClick={() => setLineas(ls => [...ls, nuevaLinea()])}
              className="text-xs text-julia-red hover:underline">+ Agregar línea</button>
          </div>
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-normal">Insumo</th>
                  <th className="px-2 py-1.5 text-left font-normal">Descripción</th>
                  <th className="px-2 py-1.5 text-right font-normal w-20">Cant.</th>
                  <th className="px-2 py-1.5 text-left font-normal w-16">Unidad</th>
                  <th className="px-2 py-1.5 text-right font-normal w-24">Costo Q</th>
                  <th className="px-2 py-1.5 text-right font-normal w-24">Subtotal</th>
                  <th className="px-1 py-1.5 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => {
                  const sub = (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0)
                  const insumoSel = l.insumo_id && insumos.find(x => x.id === l.insumo_id)
                  // Calcular cuánta cantidad entrará al stock al recibir, para
                  // que el usuario vea el efecto de la conversión ANTES de guardar.
                  let entradaStock = null
                  let entradaWarn = null
                  if (insumoSel && l.cantidad && l.unidad) {
                    const cant = Number(l.cantidad)
                    const fCan = factorEntre(l.unidad, insumoSel.unidad)
                    if (fCan != null && fCan !== 1) {
                      entradaStock = `${(cant * fCan).toLocaleString('es-GT', { maximumFractionDigits: 2 })} ${insumoSel.unidad}`
                    } else if (fCan == null && insumoSel.unidad_compra && insumoSel.cantidad_por_unidad_compra) {
                      if (mismaUnidad(l.unidad, insumoSel.unidad_compra)) {
                        const total = cant * Number(insumoSel.cantidad_por_unidad_compra)
                        entradaStock = `${total.toLocaleString('es-GT', { maximumFractionDigits: 2 })} ${insumoSel.unidad}`
                      } else {
                        entradaWarn = `unidad "${l.unidad}" no reconocida → entrará como ${cant} ${insumoSel.unidad}`
                      }
                    } else if (fCan == null && l.unidad !== insumoSel.unidad) {
                      entradaWarn = `unidad "${l.unidad}" no estándar → entrará como ${cant} ${insumoSel.unidad}`
                    }
                  }
                  // Hint del costo sugerido para esta linea/unidad. Util cuando el
                  // insumo solo tiene costo_unitario (Q por unidad base) y la linea
                  // se compra en otra unidad (ej. cafe en g, compra en quintal).
                  let costoHint = null
                  let costoWarn = null
                  if (insumoSel && l.unidad) {
                    const sug = calcularCostoSugerido(insumoSel, l.unidad)
                    const cu  = Number(l.costo_unitario)
                    if (sug != null) {
                      const diff = Math.abs(cu - sug) / Math.max(sug, 1e-9)
                      // Mostrar hint solo si el costo cargado difiere >5% del sugerido
                      // (o esta vacio) — asi no es ruido cuando ya esta correcto.
                      if (!l.costo_unitario || diff > 0.05) {
                        const fCan2 = factorEntre(l.unidad, insumoSel.unidad)
                        if (fCan2 != null && fCan2 !== 1) {
                          costoHint = `💡 Q${Number(insumoSel.costo_unitario).toFixed(4)}/${insumoSel.unidad} × ${fCan2.toLocaleString('es-GT',{maximumFractionDigits:2})} ${insumoSel.unidad}/${l.unidad} ≈ Q${sug.toFixed(2)}`
                        } else {
                          costoHint = `💡 sugerido ≈ Q${sug.toFixed(4)}`
                        }
                      }
                    } else if (insumoSel.costo_unitario != null && l.unidad !== insumoSel.unidad) {
                      costoWarn = `elegí la unidad correcta (${insumoSel.unidad_compra || insumoSel.unidad}) o tipeá el costo`
                    }
                  }
                  return (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-2 py-1">
                        <select value={l.insumo_id} onChange={e => elegirInsumo(i, e.target.value)}
                          className="w-full border border-gray-200 rounded px-1 py-1 text-xs">
                          <option value="">— no inventariable —</option>
                          {insumos.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1">
                        <input type="text" value={l.descripcion} onChange={e => setLin(i, 'descripcion', e.target.value)}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs" placeholder="Detalle" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" step="any" value={l.cantidad} onChange={e => setLin(i, 'cantidad', e.target.value)}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right" />
                        {entradaStock && (
                          <div className="text-[10px] text-emerald-700 text-right tabular-nums mt-0.5" title="Cantidad que entrará al inventario tras conversión">
                            → {entradaStock}
                          </div>
                        )}
                        {entradaWarn && (
                          <div className="text-[10px] text-amber-700 text-right mt-0.5" title="Sin conversión automática">
                            ⚠ {entradaWarn}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <SelectUnidad
                          value={l.unidad}
                          onChange={v => setLin(i, 'unidad', v)}
                          permitirVacio
                          placeholder={insumoSel ? (insumoSel.unidad_compra || insumoSel.unidad) : 'unidad'}
                          className="w-full border border-gray-200 rounded px-1 py-1 text-xs"
                          title="Unidad en que se está recibiendo este insumo. Si difiere de la unidad base, el sistema convierte al recibir."
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" step="any" value={l.costo_unitario} onChange={e => setLin(i, 'costo_unitario', e.target.value)}
                          className="w-full border border-gray-200 rounded px-2 py-1 text-xs text-right" />
                        {costoHint && (
                          <div className="text-[10px] text-blue-700 text-right mt-0.5 leading-tight" title="Costo estimado a partir del costo por unidad base del insumo">
                            {costoHint}
                          </div>
                        )}
                        {costoWarn && (
                          <div className="text-[10px] text-amber-700 text-right mt-0.5 leading-tight">
                            ⚠ {costoWarn}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-gray-700">{formatMoney(sub).replace('Q ', '')}</td>
                      <td className="px-1 py-1 text-center">
                        <button type="button" onClick={() => setLineas(ls => ls.filter((_, idx) => idx !== i))}
                          className="text-gray-400 hover:text-red-500 text-sm">×</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totales */}
        <div className="flex justify-end">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between text-gray-600"><span>Subtotal</span><span className="tabular-nums">{formatMoney(subtotal)}</span></div>
            <div className="flex justify-between text-gray-600"><span>IVA</span><span className="tabular-nums">{formatMoney(Number(cab.iva) || 0)}</span></div>
            <div className="flex justify-between text-gray-900 font-semibold pt-1 border-t border-gray-100"><span>Total</span><span className="tabular-nums">{formatMoney(total)}</span></div>
          </div>
        </div>

        <Campo label="Notas">
          <textarea value={cab.notas} onChange={e => setCab({...cab, notas: e.target.value})} rows={2} className="input" />
        </Campo>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">
            {guardando ? 'Guardando…' : (edicion ? 'Guardar cambios' : 'Crear borrador')}
          </button>
        </div>

        <ModalStyles />
      </form>
    </ModalShell>
  )
}

// ============================================================================
// Modal: Detalle de compra (con acciones recibir/anular)
// ============================================================================

function ModalDetalleCompra({ compraId, esAdmin, onClose, onChanged, onEdit }) {
  const [compra, setCompra] = useState(null)
  const [err, setErr] = useState(null)
  const [accionando, setAccionando] = useState(false)
  const [motivoAnular, setMotivoAnular] = useState('')
  const [mostrarAnular, setMostrarAnular] = useState(false)

  useEffect(() => { cargar() }, [compraId])

  async function cargar() {
    const res = await apiFetch(`/api/compras/${compraId}`)
    const json = await res.json()
    if (!res.ok) setErr(json.error || 'Error')
    else setCompra(json.compra)
  }

  async function recibir() {
    if (!confirm('¿Confirmar recepción? Se generarán movimientos de entrada para cada línea con insumo.')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/compras/${compraId}/recibir`, { method: 'POST' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) {
      setErr(json.error || (json.errores || []).join('; '))
      return
    }
    if (json.partial) setErr(json.mensaje + ' ' + (json.errores || []).join('; '))
    await cargar()
    onChanged?.()
  }

  async function anular() {
    if (!motivoAnular.trim()) { setErr('Indicá motivo de anulación'); return }
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/compras/${compraId}/anular`, {
      method: 'POST', body: JSON.stringify({ motivo: motivoAnular }),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    setMostrarAnular(false); setMotivoAnular('')
    await cargar()
    onChanged?.()
  }

  async function borrar() {
    if (!confirm('¿Borrar este borrador? No se puede deshacer.')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/compras/${compraId}`, { method: 'DELETE' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onChanged?.()
    onClose()
  }

  if (!compra) {
    return <ModalShell titulo="Detalle compra" onClose={onClose}><div className="text-sm text-gray-400">Cargando…</div></ModalShell>
  }

  const est = ESTADOS[compra.estado]

  return (
    <ModalShell titulo={`Compra ${compra.numero_factura ? '#' + compra.numero_factura : ''}`} onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <Dato label="Estado"><span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${est.cls}`}>{est.label}</span></Dato>
          <Dato label="Proveedor">{compra.proveedores?.nombre || '—'}</Dato>
          <Dato label="Fecha">{formatFecha(compra.fecha)}</Dato>
          <Dato label="Pago">{compra.metodo_pago || '—'}</Dato>
          {compra.serie_factura && <Dato label="Serie">{compra.serie_factura}</Dato>}
        </div>

        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-400">
              <tr>
                <th className="px-2 py-1.5 text-left font-normal">Descripción</th>
                <th className="px-2 py-1.5 text-left font-normal">Insumo</th>
                <th className="px-2 py-1.5 text-right font-normal">Cant.</th>
                <th className="px-2 py-1.5 text-right font-normal">Costo Q</th>
                <th className="px-2 py-1.5 text-right font-normal">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {(compra.lineas || []).map(l => (
                <tr key={l.id} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 text-gray-700">{l.descripcion}</td>
                  <td className="px-2 py-1.5 text-gray-500">{l.insumos?.nombre || <span className="text-gray-300">—</span>}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatNum(l.cantidad)} <span className="text-gray-400">{l.unidad}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(l.costo_unitario).replace('Q ', '')}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(l.subtotal).replace('Q ', '')}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 text-xs">
              <tr><td colSpan={4} className="px-2 py-1 text-right text-gray-500">Subtotal</td><td className="px-2 py-1 text-right tabular-nums">{formatMoney(compra.subtotal)}</td></tr>
              <tr><td colSpan={4} className="px-2 py-1 text-right text-gray-500">IVA</td><td className="px-2 py-1 text-right tabular-nums">{formatMoney(compra.iva)}</td></tr>
              <tr><td colSpan={4} className="px-2 py-1 text-right font-semibold text-gray-800">Total</td><td className="px-2 py-1 text-right tabular-nums font-semibold">{formatMoney(compra.total)}</td></tr>
            </tfoot>
          </table>
        </div>

        {compra.notas && (
          <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-gray-400">Notas:</span> {compra.notas}
          </div>
        )}

        {compra.estado === 'anulada' && compra.anulada_motivo && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <span className="font-medium">Anulada:</span> {compra.anulada_motivo}
          </div>
        )}

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-end pt-2">
          <button
            onClick={() => window.open(`/compras-imprimir?compraId=${compra.id}`, '_blank')}
            className="text-xs px-3 py-2 border border-gray-200 text-gray-600 rounded-lg hover:border-julia-red hover:text-julia-red"
            title="Abre una vista lista para imprimir o guardar como PDF">
            Imprimir / PDF
          </button>
        </div>

        {esAdmin && (
          <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-gray-100">
            {compra.estado === 'borrador' && (
              <>
                <button onClick={borrar} disabled={accionando} className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">Borrar</button>
                <button onClick={() => onEdit(compra)} className="text-xs px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Editar</button>
                <button onClick={recibir} disabled={accionando} className="btn-primario">
                  {accionando ? 'Procesando…' : 'Marcar como recibida'}
                </button>
              </>
            )}
            {compra.estado === 'recibida' && (
              !mostrarAnular ? (
                <button onClick={() => setMostrarAnular(true)} className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">Anular compra</button>
              ) : (
                <div className="w-full flex gap-2 items-end">
                  <Campo label="Motivo de anulación" required>
                    <input type="text" value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)} className="input" autoFocus />
                  </Campo>
                  <button onClick={() => { setMostrarAnular(false); setMotivoAnular('') }} className="btn-secundario">Cancelar</button>
                  <button onClick={anular} disabled={accionando} className="btn-primario">{accionando ? '...' : 'Confirmar'}</button>
                </div>
              )
            )}
          </div>
        )}

        <ModalStyles />
      </div>
    </ModalShell>
  )
}

function Dato({ label, children }) {
  return <div><div className="text-xs text-gray-400">{label}</div><div className="text-sm text-gray-800">{children}</div></div>
}

// ============================================================================
// Tab Proveedores
// ============================================================================

function TabProveedores({ esAdmin }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true)
    const res = await apiFetch('/api/proveedores')
    const json = await res.json()
    setItems(json.proveedores || [])
    setLoading(false)
  }

  return (
    <div>
      <div className="flex justify-between items-baseline mb-3">
        <div className="text-sm text-gray-600">{items.length} proveedores activos</div>
        {esAdmin && (
          <button onClick={() => setModal({ tipo: 'crear' })}
            className="px-4 py-2 bg-julia-red text-white text-sm rounded-lg hover:bg-red-900">
            + Nuevo proveedor
          </button>
        )}
      </div>

      <div className="card-julia overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Nombre</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">NIT</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Contacto</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Teléfono</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1, 2, 3].map(i => <tr key={i}><td colSpan={5}><SkeletonRow /></td></tr>)}</>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="text-center text-xs text-gray-400 py-8">
                Aún no hay proveedores.
                {esAdmin && <button onClick={() => setModal({tipo:'crear'})} className="text-julia-red hover:underline ml-1">Crear el primero →</button>}
              </td></tr>
            ) : items.map(p => (
              <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50">
                <td className="px-4 py-2.5 text-gray-800">{p.nombre}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{p.nit || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{p.contacto || '—'}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500">{p.telefono || '—'}</td>
                <td className="px-4 py-2.5 text-right">
                  {esAdmin && (
                    <button onClick={() => setModal({ tipo: 'editar', proveedor: p })}
                      className="text-xs text-gray-400 hover:text-julia-red">Editar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <ModalProveedor proveedor={modal.proveedor} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); cargar() }} />
      )}
    </div>
  )
}

function ModalProveedor({ proveedor, onClose, onSaved }) {
  const edicion = !!proveedor
  const [f, setF] = useState({
    nombre:    proveedor?.nombre || '',
    nit:       proveedor?.nit || '',
    telefono:  proveedor?.telefono || '',
    email:     proveedor?.email || '',
    direccion: proveedor?.direccion || '',
    contacto:  proveedor?.contacto || '',
    notas:     proveedor?.notas || '',
    activo:    proveedor?.activo ?? true,
  })
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const res = await apiFetch(
      edicion ? `/api/proveedores/${proveedor.id}` : '/api/proveedores',
      { method: edicion ? 'PATCH' : 'POST', body: JSON.stringify(f) }
    )
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  return (
    <ModalShell titulo={edicion ? `Editar: ${proveedor.nombre}` : 'Nuevo proveedor'} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-3">
        <Campo label="Nombre" required>
          <input type="text" required value={f.nombre} onChange={e => setF({...f, nombre: e.target.value})} className="input" autoFocus />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="NIT">
            <input type="text" value={f.nit} onChange={e => setF({...f, nit: e.target.value})} className="input" placeholder="CF, 12345678 o NIT real" />
          </Campo>
          <Campo label="Teléfono">
            <input type="text" value={f.telefono} onChange={e => setF({...f, telefono: e.target.value})} className="input" />
          </Campo>
        </div>
        <Campo label="Contacto">
          <input type="text" value={f.contacto} onChange={e => setF({...f, contacto: e.target.value})} className="input" />
        </Campo>
        <Campo label="Email">
          <input type="email" value={f.email} onChange={e => setF({...f, email: e.target.value})} className="input" />
        </Campo>
        <Campo label="Dirección">
          <input type="text" value={f.direccion} onChange={e => setF({...f, direccion: e.target.value})} className="input" />
        </Campo>
        <Campo label="Notas">
          <textarea rows={2} value={f.notas} onChange={e => setF({...f, notas: e.target.value})} className="input" />
        </Campo>
        {edicion && (
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={f.activo} onChange={e => setF({...f, activo: e.target.checked})} className="rounded" />
            Activo
          </label>
        )}
        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">{guardando ? 'Guardando…' : 'Guardar'}</button>
        </div>
        <ModalStyles />
      </form>
    </ModalShell>
  )
}

// ============================================================================
// UI primitives
// ============================================================================

function ModalShell({ titulo, onClose, children, maxWidth = 'max-w-md' }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${maxWidth} my-8`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function Campo({ label, required, children }) {
  return (
    <div className="flex-1">
      <label className="text-xs text-gray-500 block mb-1">
        {label}{required && <span className="text-julia-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function ModalStyles() {
  return (
    <style jsx global>{`
      .input {
        width: 100%; border: 1px solid #e5e7eb; border-radius: 0.5rem;
        padding: 0.5rem 0.75rem; font-size: 0.875rem;
      }
      .input:focus { outline: none; border-color: #991b1b; }
      .btn-primario {
        padding: 0.5rem 1.25rem; background: #991b1b; color: white;
        border-radius: 0.5rem; font-size: 0.875rem;
      }
      .btn-primario:hover { background: #7f1d1d; }
      .btn-primario:disabled { opacity: 0.5; }
      .btn-secundario {
        padding: 0.5rem 1rem; border: 1px solid #e5e7eb; color: #4b5563;
        border-radius: 0.5rem; font-size: 0.875rem;
      }
      .btn-secundario:hover { background: #f9fafb; }
    `}</style>
  )
}
