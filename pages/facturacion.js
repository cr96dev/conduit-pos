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

const fmt = n => Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtQ = n => 'Q ' + fmt(n)
function formatFechaHora(s) {
  if (!s) return '—'
  return new Date(s).toLocaleString('es-GT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const ESTADOS = {
  borrador:    { label: 'Borrador',    cls: 'bg-gray-100 text-gray-700' },
  certificada: { label: 'Certificada', cls: 'bg-green-50 text-green-700' },
  anulada:     { label: 'Anulada',     cls: 'bg-red-50 text-red-700' },
  error:       { label: 'Error',       cls: 'bg-amber-50 text-amber-700' },
}

const TIPOS_DOC = {
  FACT: 'Factura',
  FCAM: 'Factura cambiaria',
  FPEQ: 'Pequeño contribuyente',
  FCAP: 'Cambiaria pequeño contr.',
  FESP: 'Especial',
  NABN: 'Nota de abono',
  RDON: 'Recibo por donación',
  RECI: 'Recibo',
  NDEB: 'Nota de débito',
  NCRE: 'Nota de crédito',
}

// Motivos pre-canned para reimprimir una factura. La opcion 'otro' deja
// escribir texto libre.
const MOTIVOS_REIMPRIMIR = {
  cliente_perdio: 'Cliente perdió el ticket',
  no_salio:      'El ticket no salió bien (papel/impresora)',
  duplicado:     'Cliente pidió duplicado',
  reclamo:       'Reclamo / aclaración con SAT',
}

// ============================================================================
// Pagina
// ============================================================================

export default function Facturacion({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [tab, setTab] = useState('facturas')

  useEffect(() => {
    if (!session) { router.push('/'); return }
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
        <h1 className="text-xl font-bold text-gray-900 mb-4">Facturación (FEL)</h1>

        <div className="flex gap-1 border-b border-gray-200 mb-5">
          <TabBtn active={tab === 'facturas'} onClick={() => setTab('facturas')}>Facturas</TabBtn>
          <TabBtn active={tab === 'config'}   onClick={() => setTab('config')}>Configuración emisor</TabBtn>
        </div>

        {tab === 'facturas' && <TabFacturas esAdmin={esAdmin} />}
        {tab === 'config'   && <TabConfig esAdmin={esAdmin} />}
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
// Tab Facturas
// ============================================================================

function TabFacturas({ esAdmin }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [estado, setEstado] = useState('')
  const [modal, setModal] = useState(null) // {tipo: 'nueva'|'detalle', id?}

  useEffect(() => { cargar() }, [estado])

  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch('/api/fel/facturas' + (estado ? `?estado=${estado}` : ''))
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Error'); setItems([]) }
    else setItems(json.facturas || [])
    setLoading(false)
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2 mb-3">
        <select value={estado} onChange={e => setEstado(e.target.value)} className="input max-w-xs">
          <option value="">Todos los estados</option>
          <option value="borrador">Borrador</option>
          <option value="certificada">Certificadas</option>
          <option value="anulada">Anuladas</option>
          <option value="error">Con error</option>
        </select>
        <div className="flex-1" />
        {esAdmin && (
          <button onClick={() => setModal({ tipo: 'nueva' })} className="btn-primario">+ Nueva factura</button>
        )}
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      <div className="card-julia overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Fecha</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Tipo</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Receptor</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">NIT</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Total</th>
              <th className="text-center text-xs text-gray-400 font-normal px-4 py-2">Estado</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">UUID SAT</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1,2,3].map(i => <tr key={i}><td colSpan={8}><SkeletonRow /></td></tr>)}</>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-xs text-gray-400 py-8">Sin facturas.</td></tr>
            ) : items.map(f => {
              const est = ESTADOS[f.estado] || ESTADOS.borrador
              return (
                <tr key={f.id} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2 text-xs text-gray-600">{formatFechaHora(f.fecha_emision)}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{TIPOS_DOC[f.tipo_documento] || f.tipo_documento}</td>
                  <td className="px-4 py-2 text-gray-800">{f.receptor_nombre}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{f.receptor_nit}</td>
                  <td className="px-4 py-2 text-right text-gray-900 font-medium tabular-nums">{fmtQ(f.total)}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${est.cls}`}>{est.label}</span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-400 font-mono">{f.uuid_sat ? f.uuid_sat.slice(0, 12) + '…' : '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setModal({ tipo: 'detalle', id: f.id })} className="text-xs text-julia-red hover:underline">Ver</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal?.tipo === 'nueva' && (
        <ModalNuevaFactura onClose={() => setModal(null)} onSaved={() => { setModal(null); cargar() }} />
      )}
      {modal?.tipo === 'detalle' && (
        <ModalDetalleFactura id={modal.id} esAdmin={esAdmin}
          onClose={() => setModal(null)} onChanged={cargar} />
      )}
    </div>
  )
}

// ============================================================================
// Modal: Nueva factura
// ============================================================================

function ModalNuevaFactura({ onClose, onSaved }) {
  const [receptor, setReceptor] = useState({ nit: 'CF', nombre: '', direccion: '', email: '' })
  const [tipo, setTipo] = useState('FACT')
  const [items, setItems] = useState([{ descripcion: '', cantidad: 1, precio_unitario: '', unidad_medida: 'UND', afecta_iva: true, descuento: 0 }])
  const [afectaIvaGlobal, setAfectaIvaGlobal] = useState(true)
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)
  const [buscandoNit, setBuscandoNit] = useState(false)

  function setIt(i, k, v) { setItems(arr => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it)) }

  const totales = useMemo(() => {
    let bruto = 0, exento = 0, iva = 0
    items.forEach(it => {
      const sub = (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0) - (Number(it.descuento) || 0)
      if (sub <= 0) return
      const afecta = it.afecta_iva !== undefined ? it.afecta_iva : afectaIvaGlobal
      if (afecta) {
        const grav = sub / 1.12
        bruto += grav
        iva += sub - grav
      } else {
        exento += sub
      }
    })
    return { gravado: bruto, exento, iva, total: bruto + exento + iva }
  }, [items, afectaIvaGlobal])

  async function buscarPorNIT() {
    if (!receptor.nit || receptor.nit === 'CF') return
    setBuscandoNit(true)
    // Endpoint Digifact RTU?NIT=
    const res = await apiFetch('/api/fel/consultar-nit?nit=' + encodeURIComponent(receptor.nit))
    setBuscandoNit(false)
    if (!res.ok) return
    const json = await res.json()
    if (json.ok && json.receptor) {
      setReceptor(r => ({ ...r, nombre: json.receptor.nombre || r.nombre, direccion: json.receptor.direccion || r.direccion }))
    }
  }

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const itemsValidos = items
      .filter(it => it.descripcion && Number(it.cantidad) > 0 && Number(it.precio_unitario) >= 0)
      .map(it => ({
        descripcion: it.descripcion,
        cantidad: Number(it.cantidad),
        precio_unitario: Number(it.precio_unitario),
        descuento: Number(it.descuento) || 0,
        unidad_medida: it.unidad_medida,
        afecta_iva: it.afecta_iva !== undefined ? it.afecta_iva : afectaIvaGlobal,
        bien_o_servicio: it.bien_o_servicio || 'B',
      }))
    if (itemsValidos.length === 0) { setErr('Agregá al menos un ítem'); setGuardando(false); return }
    const res = await apiFetch('/api/fel/facturas', {
      method: 'POST',
      body: JSON.stringify({
        receptor_nit: receptor.nit, receptor_nombre: receptor.nombre,
        receptor_direccion: receptor.direccion, receptor_email: receptor.email,
        tipo_documento: tipo, afecta_iva_global: afectaIvaGlobal, notas, items: itemsValidos,
      }),
    })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onSaved()
  }

  return (
    <ModalShell titulo="Nueva factura" onClose={onClose} maxWidth="max-w-3xl">
      <form onSubmit={guardar} className="space-y-4">
        {/* Receptor */}
        <div className="grid grid-cols-3 gap-3">
          <Campo label="NIT" required>
            <div className="flex gap-1">
              <input type="text" required value={receptor.nit} onChange={e => setReceptor({...receptor, nit: e.target.value.toUpperCase()})} className="input"
                placeholder="CF o NIT" />
              <button type="button" onClick={buscarPorNIT} disabled={buscandoNit || receptor.nit === 'CF'}
                className="btn-secundario whitespace-nowrap text-xs">{buscandoNit ? '...' : 'Buscar'}</button>
            </div>
          </Campo>
          <div className="col-span-2">
            <Campo label="Nombre del receptor" required>
              <input type="text" required value={receptor.nombre} onChange={e => setReceptor({...receptor, nombre: e.target.value})} className="input" />
            </Campo>
          </div>
          <div className="col-span-2">
            <Campo label="Dirección">
              <input type="text" value={receptor.direccion} onChange={e => setReceptor({...receptor, direccion: e.target.value})} className="input" placeholder="CIUDAD si no aplica" />
            </Campo>
          </div>
          <Campo label="Email">
            <input type="email" value={receptor.email} onChange={e => setReceptor({...receptor, email: e.target.value})} className="input" />
          </Campo>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Tipo de documento">
            <select value={tipo} onChange={e => setTipo(e.target.value)} className="input">
              {Object.entries(TIPOS_DOC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Campo>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700 self-end pb-2">
            <input type="checkbox" checked={afectaIvaGlobal} onChange={e => setAfectaIvaGlobal(e.target.checked)} className="rounded" />
            Por defecto los ítems afectan IVA 12% (incluido en precio)
          </label>
        </div>

        {/* Items */}
        <div>
          <div className="flex justify-between items-baseline mb-1">
            <div className="text-xs uppercase tracking-wide text-gray-500 font-medium">Ítems</div>
            <button type="button" onClick={() => setItems(arr => [...arr, { descripcion: '', cantidad: 1, precio_unitario: '', unidad_medida: 'UND', afecta_iva: afectaIvaGlobal, descuento: 0 }])}
              className="text-xs text-julia-red hover:underline">+ Agregar</button>
          </div>
          <div className="border border-gray-100 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-400">
                <tr>
                  <th className="px-2 py-1.5 text-left font-normal">Descripción</th>
                  <th className="px-2 py-1.5 text-right font-normal w-16">Cant.</th>
                  <th className="px-2 py-1.5 text-left font-normal w-16">UM</th>
                  <th className="px-2 py-1.5 text-right font-normal w-24">P. unit.</th>
                  <th className="px-2 py-1.5 text-right font-normal w-20">Desc.</th>
                  <th className="px-2 py-1.5 text-center font-normal w-14">IVA</th>
                  <th className="px-2 py-1.5 text-right font-normal w-24">Subtotal</th>
                  <th className="px-1 py-1.5 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const sub = (Number(it.cantidad) || 0) * (Number(it.precio_unitario) || 0) - (Number(it.descuento) || 0)
                  return (
                    <tr key={i} className="border-t border-gray-100">
                      <td className="px-2 py-1"><input type="text" value={it.descripcion} onChange={e => setIt(i, 'descripcion', e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1 text-xs" /></td>
                      <td className="px-2 py-1"><input type="number" step="any" value={it.cantidad} onChange={e => setIt(i, 'cantidad', e.target.value)} className="w-full border border-gray-200 rounded px-1 py-1 text-xs text-right" /></td>
                      <td className="px-2 py-1"><input type="text" value={it.unidad_medida} onChange={e => setIt(i, 'unidad_medida', e.target.value)} className="w-full border border-gray-200 rounded px-1 py-1 text-xs" /></td>
                      <td className="px-2 py-1"><input type="number" step="any" value={it.precio_unitario} onChange={e => setIt(i, 'precio_unitario', e.target.value)} className="w-full border border-gray-200 rounded px-1 py-1 text-xs text-right" /></td>
                      <td className="px-2 py-1"><input type="number" step="any" value={it.descuento} onChange={e => setIt(i, 'descuento', e.target.value)} className="w-full border border-gray-200 rounded px-1 py-1 text-xs text-right" /></td>
                      <td className="px-2 py-1 text-center"><input type="checkbox" checked={it.afecta_iva ?? afectaIvaGlobal} onChange={e => setIt(i, 'afecta_iva', e.target.checked)} className="rounded" /></td>
                      <td className="px-2 py-1 text-right tabular-nums">{fmt(sub)}</td>
                      <td className="px-1 py-1 text-center"><button type="button" onClick={() => setItems(arr => arr.filter((_, idx) => idx !== i))} className="text-gray-400 hover:text-red-500 text-sm">×</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totales */}
        <div className="flex justify-end">
          <div className="w-72 text-sm space-y-1">
            <div className="flex justify-between text-gray-600"><span>Gravado</span><span className="tabular-nums">{fmtQ(totales.gravado)}</span></div>
            <div className="flex justify-between text-gray-600"><span>Exento</span><span className="tabular-nums">{fmtQ(totales.exento)}</span></div>
            <div className="flex justify-between text-gray-600"><span>IVA</span><span className="tabular-nums">{fmtQ(totales.iva)}</span></div>
            <div className="flex justify-between border-t border-gray-100 pt-1 font-semibold text-gray-900"><span>Total</span><span className="tabular-nums">{fmtQ(totales.total)}</span></div>
          </div>
        </div>

        <Campo label="Notas">
          <textarea rows={2} value={notas} onChange={e => setNotas(e.target.value)} className="input" />
        </Campo>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">{guardando ? 'Guardando…' : 'Guardar borrador'}</button>
        </div>
      </form>
    </ModalShell>
  )
}

// ============================================================================
// Modal: Detalle factura
// ============================================================================

function ModalDetalleFactura({ id, esAdmin, onClose, onChanged }) {
  const [f, setF] = useState(null)
  const [err, setErr] = useState(null)
  const [accionando, setAccionando] = useState(false)
  const [modoManual, setModoManual] = useState(false)
  const [manualForm, setManualForm] = useState({ uuid_sat: '', serie_sat: '', numero_sat: '' })
  const [motivoAnular, setMotivoAnular] = useState('')
  const [mostrarAnular, setMostrarAnular] = useState(false)
  const [mostrarReimprimir, setMostrarReimprimir] = useState(false)
  const [motivoReimprimir, setMotivoReimprimir] = useState('cliente_perdio')
  const [motivoReimprimirOtro, setMotivoReimprimirOtro] = useState('')
  const [reimprimirInfo, setReimprimirInfo] = useState(null)  // {ok, num, when} feedback ultimo evento

  useEffect(() => { cargar() }, [id])

  async function cargar() {
    const res = await apiFetch(`/api/fel/facturas/${id}`)
    const json = await res.json()
    if (!res.ok) setErr(json.error || 'Error')
    else setF(json.factura)
  }

  async function certificar() {
    setAccionando(true); setErr(null)
    const body = modoManual ? { manual: true, ...manualForm } : {}
    const res = await apiFetch(`/api/fel/facturas/${id}/certificar`, {
      method: 'POST', body: JSON.stringify(body),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    setModoManual(false)
    await cargar(); onChanged?.()
  }

  async function anular() {
    if (!motivoAnular.trim()) { setErr('Motivo requerido'); return }
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/fel/facturas/${id}/anular`, {
      method: 'POST', body: JSON.stringify({ motivo: motivoAnular }),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    setMostrarAnular(false); setMotivoAnular('')
    await cargar(); onChanged?.()
  }

  async function borrar() {
    if (!confirm('¿Borrar este borrador?')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/fel/facturas/${id}`, { method: 'DELETE' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onChanged?.(); onClose()
  }

  // Reimprimir factura certificada. Llama al endpoint que devuelve la
  // data + audit, despues arma el TicketPayload y se lo pasa al bridge
  // del wrapper Sunmi (window.JuliaPOS.printTicket). Si no hay bridge
  // (desktop / preview en browser), avisa al usuario que abra la pagina
  // desde el Sunmi para que imprima.
  async function reimprimir() {
    const motivoFinal = motivoReimprimir === 'otro'
      ? motivoReimprimirOtro.trim()
      : MOTIVOS_REIMPRIMIR[motivoReimprimir] || motivoReimprimir
    if (!motivoFinal) { setErr('Especifica el motivo'); return }

    setAccionando(true); setErr(null); setReimprimirInfo(null)

    const res = await apiFetch(`/api/fel/facturas/${id}/reimprimir`, {
      method: 'POST',
      body: JSON.stringify({ motivo: motivoFinal }),
    })
    const json = await res.json()
    if (!res.ok || !json.ok) {
      setAccionando(false)
      setErr(json.error || 'No se pudo registrar la reimpresion')
      return
    }

    // Armar TicketPayload (mismo shape que /pos.js — ver pages/pos.js).
    const fac = json.factura
    const em = json.emisor || {}
    const direccion = [
      em.direccion,
      [em.municipio, em.departamento].filter(Boolean).join(', '),
    ].filter(Boolean).join(' ')

    const ticketPayload = {
      // EMISOR
      merchantName: em.nombre_comercial || 'Julia Bakery',
      razonSocial: em.razon_social || null,
      direccion: direccion || null,
      nitEmisor: em.nit_emisor || null,
      // RECEPTOR
      receptorNit: fac.receptor_nit,
      receptorNombre: fac.receptor_nombre,
      fecha: fac.fecha_certificacion
        ? new Date(fac.fecha_certificacion).toLocaleString('es-GT')
        : new Date(fac.fecha_emision).toLocaleString('es-GT'),
      cajeroNombre: null,                              // no aplica en reimpresion
      metodoPago: null,
      // ITEMS + TOTALES
      items: (json.items || []).map(it => ({
        descripcion: it.descripcion,
        cantidad: String(it.cantidad),
        precioUnitario: Number(it.precio_unitario),
        subtotal: Number(it.subtotal),
      })),
      totalGravado: Number(fac.total_gravado),
      iva: Number(fac.iva),
      total: Number(fac.total),
      // CERTIFICADOR (Infile)
      uuidSat: fac.uuid_sat,
      serieSat: fac.serie_sat,
      numeroSat: fac.numero_sat,
      certificadorNombre: 'INFILE, S.A.',
      certificadorNit: '12521329',
      fechaCertificacion: fac.fecha_certificacion
        ? new Date(fac.fecha_certificacion).toLocaleString('es-GT')
        : null,
      textoFooter: 'Sujeto a pago directo ISR',
      // MARCAR COMO REIMPRESION (banner en el ticket)
      esReimpresion: true,
      reimpresionNum: json.reimpresionNum || 1,
    }

    let printResult = { ok: false, message: 'sin_bridge' }
    try {
      if (typeof window !== 'undefined' && window.JuliaPOS && window.JuliaPOS.printTicket) {
        const r = await window.JuliaPOS.printTicket(ticketPayload)
        printResult = { ok: !!r?.ok, message: r?.error_message || (r?.ok ? 'impreso' : 'fallo') }
      } else {
        printResult = { ok: false, message: 'no_wrapper' }  // no esta en Sunmi
      }
    } catch (e) {
      printResult = { ok: false, message: e?.message || 'exception' }
    }

    setAccionando(false)
    setMostrarReimprimir(false)
    setMotivoReimprimirOtro('')
    setReimprimirInfo({
      ok: printResult.ok,
      num: json.reimpresionNum,
      when: new Date().toLocaleTimeString('es-GT'),
      message: printResult.message,
    })
    onChanged?.()
  }

  if (!f) return <ModalShell titulo="Factura" onClose={onClose}><div className="text-sm text-gray-400">{err || 'Cargando…'}</div></ModalShell>

  const est = ESTADOS[f.estado]

  return (
    <ModalShell titulo={`Factura ${f.serie_sat || ''}${f.numero_sat || f.id.slice(0, 8)}`} onClose={onClose} maxWidth="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div><div className="text-xs text-gray-400">Estado</div><span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${est.cls}`}>{est.label}</span></div>
          <div><div className="text-xs text-gray-400">Tipo</div><div>{TIPOS_DOC[f.tipo_documento] || f.tipo_documento}</div></div>
          <div><div className="text-xs text-gray-400">Emisión</div><div>{formatFechaHora(f.fecha_emision)}</div></div>
          {f.uuid_sat && <div className="flex-1"><div className="text-xs text-gray-400">UUID SAT</div><div className="font-mono text-xs">{f.uuid_sat}</div></div>}
        </div>

        <div className="bg-gray-50 rounded-lg p-3 text-sm">
          <div className="text-xs text-gray-400 mb-1">Receptor</div>
          <div className="text-gray-800 font-medium">{f.receptor_nombre}</div>
          <div className="text-xs text-gray-500">NIT: {f.receptor_nit}{f.receptor_email && ` · ${f.receptor_email}`}</div>
          {f.receptor_direccion && <div className="text-xs text-gray-500">{f.receptor_direccion}</div>}
        </div>

        <div className="border border-gray-100 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-400">
              <tr>
                <th className="px-2 py-1.5 text-left font-normal">Descripción</th>
                <th className="px-2 py-1.5 text-right font-normal">Cant.</th>
                <th className="px-2 py-1.5 text-right font-normal">P. unit.</th>
                <th className="px-2 py-1.5 text-right font-normal">Subtotal</th>
                <th className="px-2 py-1.5 text-center font-normal">IVA</th>
              </tr>
            </thead>
            <tbody>
              {(f.items || []).map(it => (
                <tr key={it.id} className="border-t border-gray-100">
                  <td className="px-2 py-1.5 text-gray-800">{it.descripcion}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(it.cantidad)} <span className="text-gray-400 text-[10px]">{it.unidad_medida}</span></td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(it.precio_unitario)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmt(it.subtotal)}</td>
                  <td className="px-2 py-1.5 text-center text-gray-500 text-[10px]">{it.afecta_iva ? '✓' : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-gray-50 text-xs">
              <tr><td colSpan={3} className="px-2 py-1 text-right text-gray-500">Gravado</td><td className="px-2 py-1 text-right tabular-nums">{fmt(f.total_gravado)}</td><td></td></tr>
              <tr><td colSpan={3} className="px-2 py-1 text-right text-gray-500">Exento</td><td className="px-2 py-1 text-right tabular-nums">{fmt(f.total_exento)}</td><td></td></tr>
              <tr><td colSpan={3} className="px-2 py-1 text-right text-gray-500">IVA</td><td className="px-2 py-1 text-right tabular-nums">{fmt(f.iva)}</td><td></td></tr>
              <tr><td colSpan={3} className="px-2 py-2 text-right font-semibold text-gray-800">Total</td><td className="px-2 py-2 text-right tabular-nums font-semibold">{fmtQ(f.total)}</td><td></td></tr>
            </tfoot>
          </table>
        </div>

        {f.notas && <div className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2"><span className="text-gray-400">Notas:</span> {f.notas}</div>}
        {f.error_mensaje && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2"><span className="font-medium">Error:</span> {f.error_mensaje}</div>}
        {f.motivo_anulacion && <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2"><span className="font-medium">Anulada:</span> {f.motivo_anulacion}</div>}
        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

        <div className="pt-3 border-t border-gray-100 space-y-2">
          {esAdmin && (f.estado === 'borrador' || f.estado === 'error') && (
            <>
              {modoManual ? (
                <div className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <div className="text-xs text-gray-600 font-medium">Certificación manual (sin llamar a Digifact)</div>
                  <div className="grid grid-cols-3 gap-2">
                    <input type="text" placeholder="UUID SAT" value={manualForm.uuid_sat} onChange={e => setManualForm({...manualForm, uuid_sat: e.target.value})} className="input col-span-3 font-mono text-xs" />
                    <input type="text" placeholder="Serie" value={manualForm.serie_sat} onChange={e => setManualForm({...manualForm, serie_sat: e.target.value})} className="input" />
                    <input type="text" placeholder="Número" value={manualForm.numero_sat} onChange={e => setManualForm({...manualForm, numero_sat: e.target.value})} className="input col-span-2" />
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 justify-end">
                {f.estado === 'borrador' && <button onClick={borrar} disabled={accionando} className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">Borrar</button>}
                <button onClick={() => setModoManual(!modoManual)} className="text-xs px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  {modoManual ? 'Cancelar manual' : 'Certificar manual'}
                </button>
                <button onClick={certificar} disabled={accionando} className="btn-primario">
                  {accionando ? '…' : (modoManual ? 'Guardar certificación' : 'Certificar con Digifact')}
                </button>
              </div>
            </>
          )}
          {f.estado === 'certificada' && (
              <>
                {/* Feedback del ultimo intento de reimpresion */}
                {reimprimirInfo && (
                  <div className={`text-xs rounded-lg px-3 py-2 ${reimprimirInfo.ok ? 'bg-green-50 border border-green-100 text-green-800' : 'bg-amber-50 border border-amber-100 text-amber-800'}`}>
                    {reimprimirInfo.ok
                      ? `Reimpresión N°${reimprimirInfo.num} disparada a la impresora (${reimprimirInfo.when}).`
                      : `Reimpresión N°${reimprimirInfo.num} registrada en el sistema, pero la impresora no respondió (${reimprimirInfo.message}). Abrí esta página desde el Sunmi para imprimir.`}
                  </div>
                )}

                {/* Formulario reimprimir */}
                {mostrarReimprimir ? (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-2">
                    <div className="text-xs text-blue-900 font-medium">Reimprimir factura certificada</div>
                    <div className="text-[11px] text-blue-700">
                      Se imprime una copia con la leyenda "REIMPRESIÓN N°X".
                      No se vuelve a certificar ante SAT — reusa el mismo UUID original.
                    </div>
                    <select
                      value={motivoReimprimir}
                      onChange={e => setMotivoReimprimir(e.target.value)}
                      className="input text-xs"
                    >
                      {Object.entries(MOTIVOS_REIMPRIMIR).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                      <option value="otro">Otro (especificar)</option>
                    </select>
                    {motivoReimprimir === 'otro' && (
                      <input
                        type="text"
                        placeholder="Motivo..."
                        maxLength={200}
                        value={motivoReimprimirOtro}
                        onChange={e => setMotivoReimprimirOtro(e.target.value)}
                        className="input text-xs"
                        autoFocus
                      />
                    )}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => { setMostrarReimprimir(false); setMotivoReimprimirOtro('') }}
                        className="text-xs px-3 py-2 text-gray-600 hover:bg-white rounded-lg"
                      >
                        Cancelar
                      </button>
                      <button onClick={reimprimir} disabled={accionando} className="btn-primario">
                        {accionando ? '…' : 'Reimprimir'}
                      </button>
                    </div>
                  </div>
                ) : !mostrarAnular ? (
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setMostrarReimprimir(true)}
                      className="text-xs px-3 py-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                    >
                      Reimprimir
                    </button>
                    {esAdmin && (
                      <button onClick={() => setMostrarAnular(true)} className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">
                        Anular factura
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2 items-end">
                    <Campo label="Motivo de anulación" required>
                      <input type="text" value={motivoAnular} onChange={e => setMotivoAnular(e.target.value)} className="input" autoFocus />
                    </Campo>
                    <button onClick={() => { setMostrarAnular(false); setMotivoAnular('') }} className="btn-secundario">Cancelar</button>
                    <button onClick={anular} disabled={accionando} className="btn-primario">{accionando ? '...' : 'Anular'}</button>
                  </div>
                )}
              </>
            )}
        </div>
      </div>
    </ModalShell>
  )
}

// ============================================================================
// Tab Configuración
// ============================================================================

function TabConfig({ esAdmin }) {
  const [config, setConfig] = useState(null)
  const [f, setF] = useState(null)
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    (async () => {
      const res = await apiFetch('/api/fel/config')
      const json = await res.json()
      setConfig(json.config)
      setF(json.config || {
        nit_emisor: '', nombre_comercial: '', razon_social: '', direccion: '',
        codigo_postal: '01010', municipio: 'GUATEMALA', departamento: 'GUATEMALA', pais: 'GT',
        afiliacion_iva: 'GEN', codigo_establecimiento: 1,
        email_emisor: '', telefono_emisor: '',
        digifact_url_base: 'https://fel.digifact.com.gt/api/',
        digifact_token: '', digifact_token_vence: '',
        digifact_usuario: '', digifact_ambiente: 'test',
      })
      setLoading(false)
    })()
  }, [])

  if (loading || !f) return <div className="text-sm text-gray-400 py-6">Cargando…</div>
  if (!esAdmin) return <div className="text-sm text-gray-500 py-6">Solo administradores pueden ver/editar esta configuración.</div>

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setMsg(null); setGuardando(true)
    const res = await apiFetch('/api/fel/config', { method: 'PUT', body: JSON.stringify(f) })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    setMsg('✓ Configuración guardada')
    setConfig(json.config)
  }

  return (
    <form onSubmit={guardar} className="max-w-2xl space-y-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 font-medium border-b border-gray-100 pb-1">Datos del emisor</div>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="NIT emisor" required>
          <input type="text" required value={f.nit_emisor} onChange={e => setF({...f, nit_emisor: e.target.value})} className="input" />
        </Campo>
        <Campo label="Nombre comercial" required>
          <input type="text" required value={f.nombre_comercial} onChange={e => setF({...f, nombre_comercial: e.target.value})} className="input" />
        </Campo>
      </div>
      <Campo label="Razón social">
        <input type="text" value={f.razon_social || ''} onChange={e => setF({...f, razon_social: e.target.value})} className="input" placeholder="Si difiere del nombre comercial" />
      </Campo>
      <Campo label="Dirección">
        <input type="text" value={f.direccion || ''} onChange={e => setF({...f, direccion: e.target.value})} className="input" />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Email emisor">
          <input type="email" value={f.email_emisor || ''} onChange={e => setF({...f, email_emisor: e.target.value})} className="input" />
        </Campo>
        <Campo label="Teléfono">
          <input type="text" value={f.telefono_emisor || ''} onChange={e => setF({...f, telefono_emisor: e.target.value})} className="input" />
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Afiliación IVA">
          <select value={f.afiliacion_iva} onChange={e => setF({...f, afiliacion_iva: e.target.value})} className="input">
            <option value="GEN">General</option>
            <option value="PEQ">Pequeño contribuyente</option>
            <option value="EXE">Exento</option>
          </select>
        </Campo>
        <Campo label="N° establecimiento">
          <input type="number" value={f.codigo_establecimiento} onChange={e => setF({...f, codigo_establecimiento: Number(e.target.value)})} className="input" />
        </Campo>
      </div>

      <div className="text-xs uppercase tracking-wide text-gray-500 font-medium border-b border-gray-100 pb-1 mt-6">Credenciales Digifact</div>
      <div className="text-xs text-gray-500 -mt-2">
        Solicitá las credenciales a <code className="text-julia-red">soporte@digifact.com.gt</code>. El token Bearer es válido por 360 días.
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="URL base">
          <input type="text" value={f.digifact_url_base || ''} onChange={e => setF({...f, digifact_url_base: e.target.value})} className="input" />
        </Campo>
        <Campo label="Ambiente">
          <select value={f.digifact_ambiente} onChange={e => setF({...f, digifact_ambiente: e.target.value})} className="input">
            <option value="test">Test</option>
            <option value="produccion">Producción</option>
          </select>
        </Campo>
      </div>
      <Campo label="Token Bearer">
        <textarea rows={3} value={f.digifact_token || ''} onChange={e => setF({...f, digifact_token: e.target.value})}
          className="input font-mono text-xs" placeholder="eyJhbGc..." />
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Usuario API">
          <input type="text" value={f.digifact_usuario || ''} onChange={e => setF({...f, digifact_usuario: e.target.value})} className="input" />
        </Campo>
        <Campo label="Vence el">
          <input type="date" value={f.digifact_token_vence || ''} onChange={e => setF({...f, digifact_token_vence: e.target.value})} className="input" />
        </Campo>
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}
      {msg && <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-xs text-green-700">{msg}</div>}

      <div className="flex justify-end pt-2">
        <button type="submit" disabled={guardando} className="btn-primario">{guardando ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  )
}

// ============================================================================
// Primitives
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
