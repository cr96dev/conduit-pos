// pages/cotizaciones.js
//
// Módulo de cotizaciones formales (eventos, catering, mayoristas, etc).
// Listado + crear/editar + descargar PDF con logo angelito.
//
// No se confunde con facturas FEL. Esto es PRE-venta; cuando el cliente
// acepta, se factura en /pos o /facturacion como cualquier otra venta.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const fmtQ = (n) => 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const ESTADO_COLOR = {
  borrador:  'bg-gray-100 text-gray-700',
  enviada:   'bg-blue-100 text-blue-800',
  aceptada:  'bg-emerald-100 text-emerald-800',
  rechazada: 'bg-rose-100 text-rose-800',
  vencida:   'bg-amber-100 text-amber-800',
}

export default function Cotizaciones({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)  // { tipo: 'nueva' | 'editar', id? }
  const [filtroEstado, setFiltroEstado] = useState('todas')
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setPerfil(data))
    cargar()
  }, [session, filtroEstado])

  async function cargar() {
    setLoading(true)
    const params = new URLSearchParams()
    if (filtroEstado !== 'todas') params.set('estado', filtroEstado)
    if (q.trim()) params.set('q', q.trim())
    const res = await apiFetch(`/api/cotizaciones?${params}`)
    const j = await res.json()
    if (j.ok) setItems(j.cotizaciones || [])
    setLoading(false)
  }

  async function descargarPDF(id) {
    try {
      const res = await apiFetch(`/api/cotizaciones/${id}`)
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'Falla al cargar')
      const { generarPDFCotizacion } = await import('../lib/pdf/cotizaciones')
      await generarPDFCotizacion(j.cotizacion)
    } catch (e) {
      alert('Error generando PDF: ' + (e?.message || e))
    }
  }

  async function cambiarEstado(id, estado) {
    const res = await apiFetch(`/api/cotizaciones/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ estado }),
    })
    const j = await res.json()
    if (!j.ok) return alert(j.error || 'Falla')
    cargar()
  }

  async function borrar(id) {
    if (!confirm('¿Borrar esta cotización? Solo se pueden borrar borradores.')) return
    const res = await apiFetch(`/api/cotizaciones/${id}`, { method: 'DELETE' })
    const j = await res.json()
    if (!j.ok) return alert(j.error || 'No se pudo borrar')
    cargar()
  }

  if (!perfil) return null

  return (
    <Layout perfil={perfil}>
      <div className="max-w-6xl mx-auto p-4 sm:p-6">

        <div className="flex items-start justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Cotizaciones</h1>
            <p className="text-sm text-ink-subtle">
              Propuestas comerciales para eventos, catering y mayoristas. Descargá el PDF para mandárselo al cliente.
            </p>
          </div>
          <button
            onClick={() => setModal({ tipo: 'nueva' })}
            className="bg-julia-red text-white px-4 py-2 rounded-lg font-semibold hover:opacity-90 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Nueva cotización
          </button>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap gap-2 mb-4 items-center">
          {['todas','borrador','enviada','aceptada','rechazada','vencida'].map(e => (
            <button
              key={e}
              onClick={() => setFiltroEstado(e)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium border ${filtroEstado === e
                ? 'bg-julia-red text-white border-julia-red'
                : 'bg-white text-gray-700 border-gray-200 hover:border-julia-red'}`}
            >
              {e[0].toUpperCase() + e.slice(1)}
            </button>
          ))}
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && cargar()}
            placeholder="Buscar por cliente, empresa, NIT o número..."
            className="text-sm px-3 py-1.5 border border-gray-200 rounded-lg ml-auto w-full sm:w-64"
          />
        </div>

        {/* Tabla */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="text-left px-3 py-2.5">Número</th>
                <th className="text-left px-3 py-2.5">Cliente</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Fecha</th>
                <th className="text-right px-3 py-2.5">Total</th>
                <th className="text-center px-3 py-2.5">Estado</th>
                <th className="text-right px-3 py-2.5">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading && (<><SkeletonRow cols={6} /><SkeletonRow cols={6} /></>)}
              {!loading && items.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-12 text-center text-ink-subtle">
                  No hay cotizaciones {filtroEstado !== 'todas' && `en estado "${filtroEstado}"`}. Tocá "Nueva cotización" para crear la primera.
                </td></tr>
              )}
              {items.map(c => (
                <tr key={c.id} className="border-t border-gray-100">
                  <td className="px-3 py-2.5 font-mono text-xs font-semibold text-gray-900">
                    {c.numero || c.id.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-gray-900">{c.cliente_nombre}</div>
                    {c.cliente_empresa && <div className="text-xs text-ink-subtle">{c.cliente_empresa}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-700 hidden md:table-cell">
                    {new Date(c.fecha + 'T00:00:00').toLocaleDateString('es-GT')}
                  </td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{fmtQ(c.total)}</td>
                  <td className="px-3 py-2.5 text-center">
                    <select
                      value={c.estado}
                      onChange={e => cambiarEstado(c.id, e.target.value)}
                      className={`text-xs px-2 py-1 rounded-md font-medium border-0 cursor-pointer ${ESTADO_COLOR[c.estado] || 'bg-gray-100'}`}
                    >
                      <option value="borrador">borrador</option>
                      <option value="enviada">enviada</option>
                      <option value="aceptada">aceptada</option>
                      <option value="rechazada">rechazada</option>
                      <option value="vencida">vencida</option>
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => descargarPDF(c.id)} className="text-xs text-gray-700 hover:text-julia-red font-medium" title="Descargar PDF">
                        PDF
                      </button>
                      {c.estado === 'borrador' && (
                        <button onClick={() => borrar(c.id)} className="text-xs text-rose-600 hover:underline">borrar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

      </div>

      {modal?.tipo === 'nueva' && (
        <ModalNuevaCotizacion
          onClose={() => setModal(null)}
          onSaved={(c) => { setModal(null); cargar(); descargarPDF(c.id) }}
        />
      )}

    </Layout>
  )
}

// ============================================================================
// Modal nueva cotización
// ============================================================================

function ModalNuevaCotizacion({ onClose, onSaved }) {
  const [nombre, setNombre] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [nit, setNit] = useState('')
  const [email, setEmail] = useState('')
  const [telefono, setTelefono] = useState('')
  const [validez, setValidez] = useState(15)
  const [notas, setNotas] = useState('')
  const [items, setItems] = useState([
    { descripcion: '', cantidad: 1, precio_unitario: 0 },
  ])
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState('')

  function setItem(i, k, v) {
    setItems(arr => arr.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  }
  function agregarItem() {
    setItems(arr => [...arr, { descripcion: '', cantidad: 1, precio_unitario: 0 }])
  }
  function quitarItem(i) {
    setItems(arr => arr.filter((_, idx) => idx !== i))
  }

  const subtotal = items.reduce((s, it) => s + Number(it.cantidad || 0) * Number(it.precio_unitario || 0), 0)
  const iva = Math.round((subtotal - subtotal / 1.12) * 100) / 100
  const total = Math.round(subtotal * 100) / 100

  async function guardar() {
    if (!nombre.trim()) return setErr('Nombre del cliente requerido')
    if (items.length === 0 || items.every(it => !it.descripcion?.trim())) {
      return setErr('Agregá al menos 1 item con descripción')
    }
    setGuardando(true); setErr('')
    try {
      const res = await apiFetch('/api/cotizaciones', {
        method: 'POST',
        body: JSON.stringify({
          cliente_nombre: nombre,
          cliente_empresa: empresa,
          cliente_nit: nit,
          cliente_email: email,
          cliente_telefono: telefono,
          validez_dias: validez,
          notas,
          items: items.filter(it => it.descripcion?.trim()),
        }),
      })
      const j = await res.json()
      if (!j.ok) throw new Error(j.error || 'Falla al guardar')
      onSaved(j.cotizacion)
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-2xl">
          <h2 className="text-lg font-bold text-gray-900">Nueva cotización</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-5">

          {/* Cliente */}
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-subtle mb-2">Cliente</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre completo *" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Empresa (opcional)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input value={nit} onChange={e => setNit(e.target.value)} placeholder="NIT (opcional)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input value={telefono} onChange={e => setTelefono(e.target.value)} placeholder="Teléfono" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <input type="number" min={1} max={180} value={validez} onChange={e => setValidez(Number(e.target.value))} placeholder="Días de validez" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs uppercase tracking-wider text-ink-subtle">Detalle (precios IVA incluido)</div>
              <button onClick={agregarItem} className="text-xs text-julia-red font-semibold hover:underline">+ Agregar item</button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    value={it.descripcion}
                    onChange={e => setItem(i, 'descripcion', e.target.value)}
                    placeholder="Descripción"
                    className="col-span-6 border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="number" min={0} step={0.1}
                    value={it.cantidad}
                    onChange={e => setItem(i, 'cantidad', Number(e.target.value))}
                    placeholder="Cant."
                    className="col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm text-right tabular-nums"
                  />
                  <input
                    type="number" min={0} step={0.01}
                    value={it.precio_unitario}
                    onChange={e => setItem(i, 'precio_unitario', Number(e.target.value))}
                    placeholder="Precio"
                    className="col-span-2 border border-gray-200 rounded-lg px-3 py-2 text-sm text-right tabular-nums"
                  />
                  <div className="col-span-1 text-right font-semibold tabular-nums text-sm">
                    {fmtQ(Number(it.cantidad || 0) * Number(it.precio_unitario || 0))}
                  </div>
                  <button onClick={() => quitarItem(i)} className="col-span-1 text-rose-500 hover:text-rose-700 text-lg">×</button>
                </div>
              ))}
            </div>
          </div>

          {/* Totales */}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex justify-between text-sm text-gray-700">
              <span>Base imponible</span>
              <span className="tabular-nums">{fmtQ(subtotal / 1.12)}</span>
            </div>
            <div className="flex justify-between text-sm text-gray-700 mt-1">
              <span>IVA 12%</span>
              <span className="tabular-nums">{fmtQ(iva)}</span>
            </div>
            <div className="h-px bg-gray-200 my-2" />
            <div className="flex justify-between text-base font-bold text-gray-900">
              <span>TOTAL</span>
              <span className="tabular-nums text-julia-red">{fmtQ(total)}</span>
            </div>
          </div>

          {/* Notas */}
          <div>
            <div className="text-xs uppercase tracking-wider text-ink-subtle mb-2">Notas (opcional)</div>
            <textarea
              value={notas}
              onChange={e => setNotas(e.target.value)}
              rows={3}
              placeholder="Condiciones especiales, detalles de entrega, etc."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {err && (
            <div className="bg-rose-50 text-rose-700 px-3 py-2 rounded-lg text-sm">{err}</div>
          )}

        </div>

        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex items-center justify-end gap-2 rounded-b-2xl">
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 font-semibold">Cancelar</button>
          <button
            onClick={guardar}
            disabled={guardando}
            className="bg-julia-red text-white px-5 py-2 rounded-lg font-semibold hover:opacity-90 disabled:opacity-40"
          >
            {guardando ? 'Guardando...' : 'Crear y descargar PDF'}
          </button>
        </div>

      </div>
    </div>
  )
}
