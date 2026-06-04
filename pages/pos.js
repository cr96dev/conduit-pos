// pages/pos.js
// Punto de Venta propio: ventas que NO pasan por Loyverse (mayoreo, catering,
// Pedidos Ya, pedidos especiales). Cada venta emite factura FEL via Infile,
// descuenta inventario PT, y genera asiento contable. Si la certificacion FEL
// falla, la venta NO se completa.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { QRCodeSVG } from 'qrcode.react'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import SoporteBubble from '../components/SoporteBubble'
import { useEsKiosko, esKiosko } from '../lib/kiosko'

// Wrapper de layout: en modo kiosko (wrapper Android Sunmi) renderiza un
// header minimo con logo + cajero + logout. En desktop usa el Layout
// completo con sidebar y navegacion a otros modulos.
function POSChrome({ perfil, kiosko, turno, onMostrarHistorial, onMostrarBandeja, pedidosPendientesCount, children }) {
  // Admin desktop -> Layout completo con sidebar. (Si admin es cajero, no
  // queremos perder el sidebar.) Solo en kiosko o si rol=cajero mostramos
  // el chrome minimo con cajero/turno + Cerrar caja + Mis turnos.
  const esCajero = perfil?.rol === 'cajero'
  const esKioskoCajero = !!perfil?.es_kiosko
  if (!kiosko && !esCajero) return <Layout perfil={perfil}>{children}</Layout>

  // Modo K2 autoservicio: ocultamos todo lo administrativo (cerrar caja,
  // historial, bandeja, salir, nombre cajero, estado turno). Triple tap en
  // el logo abre "modo admin temporal" por 60s — suficiente para que el
  // dueño/admin haga Cerrar Caja al final del día sin reiniciar la app.
  const [adminOverride, setAdminOverride] = useState(false)
  const tapsRef = useRef([])
  function onTapLogo() {
    if (!esKioskoCajero) return
    const now = Date.now()
    tapsRef.current = tapsRef.current.filter(t => now - t < 800)
    tapsRef.current.push(now)
    if (tapsRef.current.length >= 3) {
      tapsRef.current = []
      if (window.confirm('¿Activar modo admin temporal? (60s)')) {
        setAdminOverride(true)
        setTimeout(() => setAdminOverride(false), 60000)
      }
    }
  }
  const ocultarAdmin = esKioskoCajero && !adminOverride

  return (
    <div className="min-h-screen bg-surface-2 flex flex-col">
      <header className="bg-white border-b border-gray-100 px-4 py-2.5 flex items-center justify-between flex-shrink-0 gap-2 shadow-xs">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/logo.png"
            alt=""
            className="h-9 w-auto flex-shrink-0"
            onClick={onTapLogo}
            style={esKioskoCajero ? { cursor: 'pointer' } : undefined}
          />
          <div className="min-w-0">
            {ocultarAdmin ? (
              <div className="text-base font-bold text-gray-900 truncate leading-tight">
                Julia Bakery
              </div>
            ) : (
              <>
                <div className="text-base font-bold text-gray-900 truncate leading-tight">
                  {perfil?.nombre_completo || 'Cajero'}
                  {adminOverride && (
                    <span className="ml-2 text-2xs uppercase tracking-wider text-julia-red font-semibold">
                      · modo admin
                    </span>
                  )}
                </div>
                {turno && (
                  <button onClick={() => window.location.href = '/mis-turnos'}
                    className="text-2xs font-mono text-ink-subtle hover:text-julia-red transition-colors flex items-center gap-1 leading-tight mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                    Caja abierta · {new Date(turno.fecha_apertura).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!ocultarAdmin && turno && onMostrarBandeja && (
            <button onClick={onMostrarBandeja}
              className={`text-sm px-3.5 py-2.5 rounded-lg font-bold flex items-center gap-2 transition-all ${
                pedidosPendientesCount > 0
                  ? 'bg-amber-100 text-amber-900 hover:bg-amber-200 ring-2 ring-amber-300/60'
                  : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
              }`}
              title="Bandeja de pedidos pendientes (Pedidos Ya)">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4" />
              </svg>
              Pedidos
              {pedidosPendientesCount > 0 && (
                <span className="bg-amber-600 text-white rounded-full px-2 py-0.5 text-2xs font-bold tabular-nums min-w-[22px] text-center">
                  {pedidosPendientesCount}
                </span>
              )}
            </button>
          )}
          {!ocultarAdmin && turno && onMostrarHistorial && (
            <button onClick={onMostrarHistorial}
              className="text-sm bg-blue-50 text-blue-700 hover:bg-blue-100 px-3.5 py-2.5 rounded-lg font-bold flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Historial
            </button>
          )}
          {!ocultarAdmin && esCajero && (
            <>
              <button onClick={() => window.location.href = '/mis-turnos'}
                className="text-sm text-ink-muted hover:text-julia-red hover:bg-gray-50 px-3 py-2.5 font-semibold rounded-lg transition-colors">
                Mis turnos
              </button>
              {turno && (
                <button onClick={() => window.location.href = '/cerrar-caja'}
                  className="text-sm bg-amber-100 text-amber-900 hover:bg-amber-200 px-4 py-2.5 rounded-lg font-bold flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  Cerrar caja
                </button>
              )}
            </>
          )}
          {!ocultarAdmin && (
            <button
              onClick={async () => {
                await supabase.auth.signOut()
                window.location.href = esCajero ? '/cajero-login' : '/'
              }}
              className="text-sm text-ink-subtle hover:text-red-500 hover:bg-gray-50 px-3 py-2.5 font-semibold rounded-lg transition-colors flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Salir
            </button>
          )}
        </div>
      </header>
      <main className="flex-1 min-h-0">{children}</main>
    </div>
  )
}

// Sugerencias frecuentes de modificadores para items (especialmente bebidas de
// barra). El cajero las toca como chips para agregar/quitar. Tambien hay un
// textarea libre debajo. La nota final se concatena a la descripcion del item
// antes de enviarla al FEL — asi aparece en la factura, en el ticket impreso
// y en la comanda de barra sin tocar el backend.
const SUGERENCIAS_NOTA = [
  'Leche deslactosada',
  'Leche de soya',
  'Leche de almendra',
  'Sin azucar',
  'Extra azucar',
  'Doble shot',
  'Descafeinado',
  'Caliente',
  'Frio',
  'Hielo extra',
  'Sin hielo',
  'Para llevar',
]

// Modal de edicion de nota para una linea del carrito. El cajero puede tocar
// chips de sugerencias (las activa/desactiva) y/o escribir texto libre.
function ModalNotaItem({ descripcion, value, onClose, onSave }) {
  const [text, setText] = useState(value || '')

  function toggleSugerencia(sug) {
    const lower = sug.toLowerCase()
    const partes = text.split(/[,·]/).map(s => s.trim()).filter(Boolean)
    const idx = partes.findIndex(p => p.toLowerCase() === lower)
    if (idx >= 0) partes.splice(idx, 1)
    else partes.push(sug)
    setText(partes.join(', '))
  }

  function estaActiva(sug) {
    return text.toLowerCase().split(/[,·]/).map(s => s.trim()).includes(sug.toLowerCase())
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-2xl font-bold text-gray-900 mb-1">Nota del producto</h3>
        <p className="text-base font-semibold text-gray-700 mb-1">{descripcion}</p>
        <p className="text-sm text-gray-500 mb-5">
          Aparece en el ticket impreso, en la factura y en la comanda de barra.
        </p>

        <div className="flex flex-wrap gap-2 mb-5">
          {SUGERENCIAS_NOTA.map(s => {
            const activa = estaActiva(s)
            return (
              <button key={s} onClick={() => toggleSugerencia(s)}
                className={`text-base px-4 py-3 rounded-full font-bold border-2 transition-colors ${
                  activa
                    ? 'bg-julia-red text-white border-julia-red'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-julia-red/40'
                }`}>
                {activa ? '✓ ' : '+ '}{s}
              </button>
            )
          })}
        </div>

        <label className="block text-sm text-gray-600 mb-1.5 font-bold uppercase tracking-wide">O escribí libremente</label>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
          maxLength={200}
          placeholder="Ej: latte con leche deslactosada, sin azucar..."
          className="w-full px-4 py-3.5 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-julia-red" />
        <div className="text-sm text-gray-500 text-right mt-1.5 font-medium">{text.length}/200</div>

        <div className="grid grid-cols-2 gap-2.5 mt-5">
          <button onClick={onClose}
            className="py-5 border-2 border-gray-200 text-lg font-bold text-gray-700 rounded-xl hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={() => onSave(text.trim())}
            className="py-5 bg-julia-red text-white text-lg font-bold rounded-xl hover:bg-red-700">
            Guardar nota
          </button>
        </div>
      </div>
    </div>
  )
}

// Modal para guardar el carrito actual como pedido pendiente (Pedidos Ya).
// El cajero ingresa una referencia (ej: "Pedidos Ya #4521" o nombre cliente).
// Al guardar, el carrito se persiste en la tabla pedidos_pendientes y aparece
// en la bandeja para que cualquier cajero del turno lo facture cuando llegue
// el driver. NO emite factura todavia.
function ModalGuardarPedido({ totalEstimado, cantItems, onClose, onGuardar }) {
  const [referencia, setReferencia] = useState('')
  const [origen, setOrigen] = useState('pedidos_ya')
  const [notas, setNotas] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(null)

  async function submit() {
    setError(null)
    if (!referencia.trim()) { setError('Ingresá una referencia (cliente o #pedido)'); return }
    setEnviando(true)
    try {
      await onGuardar({ referencia: referencia.trim(), origen, notas: notas.trim() })
    } catch (e) {
      setError(e?.message || 'No se pudo guardar')
      setEnviando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-2xl font-bold text-gray-900 mb-1">Guardar pedido pendiente</h3>
        <p className="text-base text-gray-600 mb-5">
          El pedido queda en la bandeja sin facturar.<br/>
          Se factura cuando el driver recoge.
        </p>

        <div className="bg-gray-50 border-2 border-gray-200 rounded-xl px-4 py-4 mb-5 flex justify-between items-center">
          <span className="text-base text-gray-700 font-semibold">{cantItems} ítems</span>
          <span className="text-2xl font-bold text-julia-red tabular-nums">{fmtQ(totalEstimado)}</span>
        </div>

        <label className="block text-sm text-gray-700 font-bold uppercase tracking-wide mb-1.5">
          Referencia <span className="text-red-500">*</span>
        </label>
        <input type="text" value={referencia} onChange={e => setReferencia(e.target.value)}
          autoFocus maxLength={200}
          placeholder="Ej: Pedidos Ya #4521 · Juan"
          className="w-full px-4 py-3.5 text-base border-2 border-gray-200 rounded-xl mb-5 focus:outline-none focus:border-julia-red" />

        <label className="block text-sm text-gray-700 font-bold uppercase tracking-wide mb-1.5">Canal del pedido</label>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {[
            { id: 'pedidos_ya', label: 'Pedidos Ya' },
            { id: 'telefono',   label: 'Teléfono' },
            { id: 'walkin',     label: 'Mostrador' },
          ].map(o => (
            <button key={o.id} onClick={() => setOrigen(o.id)}
              className={`text-base py-4 rounded-lg font-bold transition-colors ${
                origen === o.id
                  ? 'bg-julia-red text-white'
                  : 'border-2 border-gray-200 text-gray-700 hover:border-julia-red/40'
              }`}>{o.label}</button>
          ))}
        </div>

        <label className="block text-sm text-gray-700 font-bold uppercase tracking-wide mb-1.5">Notas internas (opcional)</label>
        <textarea value={notas} onChange={e => setNotas(e.target.value)} rows={2}
          maxLength={500}
          placeholder="Ej: cliente paga al recibir, sin pan tostado..."
          className="w-full px-4 py-3.5 text-base border-2 border-gray-200 rounded-xl mb-4 focus:outline-none focus:border-julia-red" />

        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-base font-medium text-red-700 mb-4">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={onClose} disabled={enviando}
            className="py-5 border-2 border-gray-200 text-lg font-bold text-gray-700 rounded-xl hover:bg-gray-50 disabled:opacity-50">
            Cancelar
          </button>
          <button onClick={submit} disabled={enviando}
            className="py-5 bg-julia-red text-white text-lg font-bold rounded-xl hover:bg-red-700 disabled:opacity-50">
            {enviando ? 'Guardando...' : 'Guardar pedido'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Bandeja: lista los pedidos pendientes del turno actual con accion
// Continuar (carga al carrito + permite editar y cobrar) y Cancelar.
// Auto-refresca al abrir.
function ModalBandejaPedidos({ pedidos, cargando, onClose, onContinuar, onCancelar, onMarcarListo, onRefresh }) {
  const [cancelandoId, setCancelandoId] = useState(null)
  const [marcandoListoId, setMarcandoListoId] = useState(null)
  const [motivos, setMotivos] = useState({})

  async function cancelar(p) {
    const motivo = (motivos[p.id] || '').trim()
    setCancelandoId(p.id)
    try {
      await onCancelar(p.id, motivo || 'Sin motivo especificado')
    } finally {
      setCancelandoId(null)
    }
  }

  async function marcarListo(p) {
    setMarcandoListoId(p.id)
    try {
      await onMarcarListo(p.id)
    } finally {
      setMarcandoListoId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-amber-50">
          <div>
            <div className="text-xl font-bold text-gray-900">📦 Pedidos pendientes</div>
            <div className="text-sm text-gray-700 mt-0.5">Sin facturar — esperando que el driver recoja</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onRefresh} title="Recargar"
              className="text-gray-700 hover:text-julia-red w-11 h-11 flex items-center justify-center rounded-lg hover:bg-amber-100">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button onClick={onClose}
              className="text-gray-500 hover:text-gray-700 text-3xl leading-none w-11 h-11 flex items-center justify-center">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
          {cargando && (
            <div className="text-center py-10 text-base text-gray-500 font-medium">Cargando pedidos…</div>
          )}
          {!cargando && pedidos.length === 0 && (
            <div className="text-center py-12">
              <div className="text-6xl mb-3 opacity-50">📦</div>
              <div className="text-lg font-bold text-gray-700">No hay pedidos pendientes</div>
              <div className="text-base text-gray-500 mt-1.5">Cuando armes un pedido y lo guardes, aparecerá acá.</div>
            </div>
          )}
          {pedidos.map(p => {
            const items = Array.isArray(p.items) ? p.items : []
            const totalItems = items.reduce((s, it) => s + Number(it.cantidad || 0), 0)
            const minutos = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 60000)
            return (
              <div key={p.id} className="bg-white border-2 border-gray-100 rounded-xl p-4 hover:border-amber-200 transition-colors">
                <div className="flex justify-between items-start gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-lg font-bold text-gray-900 truncate">{p.referencia}</div>
                    <div className="text-sm text-gray-600 mt-1 font-medium">
                      <span className="capitalize">{p.origen?.replace('_', ' ')}</span>
                      {' · '}
                      <span>{p.cajero_creador_nombre || 'cajero'}</span>
                      {' · '}
                      <span className={minutos > 30 ? 'text-red-600 font-bold' : ''}>hace {minutos}min</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-2xl font-bold text-gray-900 tabular-nums">{fmtQ(p.total_estimado)}</div>
                    <div className="text-sm text-gray-500 font-medium">{totalItems} ítems</div>
                  </div>
                </div>

                {/* Preview de items */}
                <div className="text-base text-gray-700 mb-3 bg-gray-50 rounded-lg px-3 py-2.5 max-h-28 overflow-y-auto font-medium">
                  {items.slice(0, 5).map((it, i) => (
                    <div key={i} className="flex justify-between gap-2">
                      <span className="truncate">{it.cantidad}× {it.descripcion}</span>
                    </div>
                  ))}
                  {items.length > 5 && (
                    <div className="text-gray-500 italic text-sm mt-1">y {items.length - 5} más…</div>
                  )}
                </div>

                {p.notas && (
                  <div className="text-sm font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
                    📝 {p.notas}
                  </div>
                )}

                {/* Badge PAGADO: pedido del kiosko K2 ya cobrado vía QR Recurrente */}
                {p.pagado_at && (
                  <div className="mb-3 px-3 py-2 rounded-lg bg-emerald-100 border border-emerald-300 flex items-center justify-between gap-2">
                    <div className="text-sm font-bold text-emerald-900">
                      ✅ PAGADO · {p.origen === 'pos_kiosko' ? 'K2 QR Recurrente' : 'tarjeta'}
                    </div>
                    <div className="text-xs text-emerald-800 font-medium">
                      Cobrá NO — entregá y facturá
                    </div>
                  </div>
                )}

                {/* Badge especial si es pickup app */}
                {p.origen === 'app_pickup' && (
                  <div className={`mb-3 px-3 py-2 rounded-lg flex items-center justify-between gap-2 ${
                    p.estado === 'lista'
                      ? 'bg-amber-100 border border-amber-300'
                      : 'bg-blue-50 border border-blue-200'
                  }`}>
                    <div className="text-sm font-bold">
                      {p.estado === 'lista' ? (
                        <span className="text-amber-900">🔔 Listo · cliente notificado</span>
                      ) : (
                        <span className="text-blue-900">📱 Pickup app · {p.receptor_email}</span>
                      )}
                    </div>
                    {p.slot_label && (
                      <div className="text-xs text-gray-700 font-medium">
                        {p.day_label} {p.slot_label}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  {/* Botón principal cambia según estado, origen y si está pagado */}
                  {p.pagado_at ? (
                    /* Ya pagado vía QR → solo entregar + facturar */
                    <button onClick={() => onContinuar(p)}
                      className="py-4 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 text-base shadow">
                      📥 Entregar y facturar
                    </button>
                  ) : p.origen === 'app_pickup' && p.estado === 'pendiente_entrega' ? (
                    <button onClick={() => marcarListo(p)} disabled={marcandoListoId === p.id}
                      className="py-4 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 text-base shadow disabled:opacity-50">
                      {marcandoListoId === p.id ? 'Avisando...' : '🔔 Marcar listo (avisa al cliente)'}
                    </button>
                  ) : (
                    <button onClick={() => onContinuar(p)}
                      className="py-4 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 text-base shadow">
                      📥 Cobrar / Facturar
                    </button>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <input type="text" placeholder="Motivo cancelación..."
                      value={motivos[p.id] || ''}
                      onChange={e => setMotivos({ ...motivos, [p.id]: e.target.value })}
                      className="text-sm border-2 border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-julia-red" />
                    <button onClick={() => cancelar(p)} disabled={cancelandoId === p.id}
                      className="py-2.5 border-2 border-red-200 text-red-700 font-bold rounded-lg hover:bg-red-50 text-sm disabled:opacity-50">
                      {cancelandoId === p.id ? 'Cancelando...' : 'Cancelar pedido'}
                    </button>
                  </div>
                </div>

                {/* Si el pickup ya está marcado listo, mostrar también el botón de facturar */}
                {p.origen === 'app_pickup' && p.estado === 'lista' && (
                  <button onClick={() => onContinuar(p)}
                    className="w-full mt-2 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 text-base shadow">
                    📥 Cliente vino — Cobrar / Facturar
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Modal para dividir el pago entre varios metodos. El cajero agrega pagos
// (metodo + monto) hasta llegar al total de la venta. Al guardar, el carrito
// se cobra con pagos[] (multi-metodo); en facturas_fel queda metodo_pago='mixto'.
function ModalDividirPago({ totalVenta, pagosInicial, onClose, onGuardar }) {
  const [pagos, setPagos] = useState(
    pagosInicial && pagosInicial.length > 0
      ? pagosInicial.map(p => ({ ...p }))
      : [{ metodo: 'efectivo', monto: '' }]
  )
  const [error, setError] = useState(null)

  const sumaActual = pagos.reduce((s, p) => s + (Number(p.monto) || 0), 0)
  const restante = Math.round((totalVenta - sumaActual) * 100) / 100
  const cuadra = Math.abs(restante) < 0.01

  function agregar() {
    // Agrega un pago nuevo precargado con el restante (si lo hay)
    setPagos(prev => [...prev, { metodo: 'efectivo', monto: restante > 0 ? restante.toFixed(2) : '' }])
  }
  function quitar(i) {
    setPagos(prev => prev.filter((_, idx) => idx !== i))
  }
  function actualizar(i, patch) {
    setPagos(prev => prev.map((p, idx) => idx === i ? { ...p, ...patch } : p))
  }

  function guardar() {
    setError(null)
    if (pagos.length === 0) { setError('Agregá al menos un pago'); return }
    for (const [i, p] of pagos.entries()) {
      const m = Number(p.monto)
      if (!Number.isFinite(m) || m <= 0) {
        setError(`Pago ${i + 1}: monto inválido (> 0)`); return
      }
    }
    if (!cuadra) {
      setError(`La suma (Q${sumaActual.toFixed(2)}) no cuadra con el total (Q${totalVenta.toFixed(2)})`)
      return
    }
    // Normalizar montos a numero
    onGuardar(pagos.map(p => ({
      metodo: p.metodo,
      monto: Number(p.monto),
      referencia: p.referencia || null,
    })))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <h3 className="text-2xl font-bold text-gray-900 mb-1">Dividir pago</h3>
        <p className="text-base text-gray-600 mb-5">
          Agregá varios pagos hasta cubrir el total.
        </p>

        <div className="bg-gray-50 border-2 border-gray-200 rounded-xl px-4 py-4 mb-5 grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-sm uppercase tracking-wide text-gray-600 font-bold">Total</div>
            <div className="text-xl font-bold text-gray-900 tabular-nums mt-1">{fmtQ(totalVenta)}</div>
          </div>
          <div>
            <div className="text-sm uppercase tracking-wide text-gray-600 font-bold">Cubierto</div>
            <div className="text-xl font-bold text-emerald-600 tabular-nums mt-1">{fmtQ(sumaActual)}</div>
          </div>
          <div>
            <div className="text-sm uppercase tracking-wide text-gray-600 font-bold">Falta</div>
            <div className={`text-xl font-bold tabular-nums mt-1 ${
              restante > 0 ? 'text-amber-600' : restante < 0 ? 'text-red-600' : 'text-emerald-600'
            }`}>
              {fmtQ(restante)}
            </div>
          </div>
        </div>

        <div className="space-y-3 mb-4">
          {pagos.map((p, i) => (
            <div key={i} className="bg-white border-2 border-gray-200 rounded-xl p-3 flex items-center gap-2">
              <div className="text-lg text-gray-700 font-bold w-7 text-center bg-gray-100 rounded h-10 flex items-center justify-center">{i + 1}</div>
              <select value={p.metodo} onChange={e => actualizar(i, { metodo: e.target.value })}
                className="flex-1 text-base border-2 border-gray-200 rounded-lg px-3 py-3 bg-white font-semibold focus:outline-none focus:border-julia-red">
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
                <option value="pedidos_ya">Pedidos Ya</option>
                <option value="otro">Otro</option>
              </select>
              <input type="number" step="0.01" min="0" value={p.monto}
                onChange={e => actualizar(i, { monto: e.target.value })}
                inputMode="decimal"
                placeholder="0.00"
                className="w-32 text-right text-lg font-bold px-3 py-3 border-2 border-gray-200 rounded-lg tabular-nums focus:outline-none focus:border-julia-red" />
              {pagos.length > 1 && (
                <button onClick={() => quitar(i)}
                  title="Quitar este pago"
                  className="text-gray-400 hover:text-red-500 w-11 h-11 flex items-center justify-center bg-gray-50 border-2 border-gray-200 rounded-lg hover:border-red-200 hover:bg-red-50">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>

        <button onClick={agregar}
          className="w-full py-4 border-2 border-dashed border-gray-300 text-gray-700 font-bold rounded-xl hover:border-julia-red hover:text-julia-red text-lg mb-4">
          + Agregar otro pago
        </button>

        {error && (
          <div className="bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3 text-base font-medium text-red-700 mb-4">{error}</div>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={onClose}
            className="py-5 border-2 border-gray-200 text-lg font-bold text-gray-700 rounded-xl hover:bg-gray-50">
            Cancelar
          </button>
          <button onClick={guardar} disabled={!cuadra}
            className="py-5 bg-julia-red text-white text-lg font-bold rounded-xl hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
            Guardar pagos
          </button>
        </div>
      </div>
    </div>
  )
}

// Motivos pre-canned para reimprimir factura desde POS (mismo set que /facturacion).
const MOTIVOS_REIMPRIMIR_POS = {
  cliente_perdio: 'Cliente perdió el ticket',
  no_salio:      'No salió bien la primera vez',
  duplicado:     'Cliente pidió duplicado',
}

// Modal: historial de facturas emitidas por este cajero en su turno actual.
// Permite reimprimir cualquiera con leyenda "REIMPRESION N°X".
function ModalHistorialFacturas({ perfil, turno, emisor, onClose, toast }) {
  const [items, setItems] = useState(null)
  const [err, setErr] = useState(null)
  const [reimprimiendo, setReimprimiendo] = useState(null) // id en proceso
  const [motivos, setMotivos] = useState({})               // id -> 'cliente_perdio' | 'otro' | etc
  const [otrosTexto, setOtrosTexto] = useState({})         // id -> texto libre

  useEffect(() => {
    (async () => {
      // Solo facturas certificadas, de este cajero, desde la apertura del turno.
      const params = new URLSearchParams({
        creado_por: perfil.id,
        desde: turno.fecha_apertura,
        estado: 'certificada',
        limit: '50',
      })
      const r = await apiFetch(`/api/fel/facturas?${params.toString()}`)
      const j = await r.json()
      if (!r.ok || !j.ok) { setErr(j.error || 'No pude cargar el historial'); setItems([]); return }
      setItems(j.facturas || [])
    })()
  }, [perfil.id, turno.fecha_apertura])

  async function reimprimir(factura) {
    const motivoKey = motivos[factura.id] || 'cliente_perdio'
    const motivoFinal = motivoKey === 'otro'
      ? (otrosTexto[factura.id] || '').trim()
      : MOTIVOS_REIMPRIMIR_POS[motivoKey]
    if (!motivoFinal) { setErr('Especifica el motivo'); return }

    setReimprimiendo(factura.id); setErr(null)
    const r = await apiFetch(`/api/fel/facturas/${factura.id}/reimprimir`, {
      method: 'POST',
      body: JSON.stringify({ motivo: motivoFinal }),
    })
    const j = await r.json()
    if (!r.ok || !j.ok) {
      setReimprimiendo(null)
      setErr(j.error || 'Falló reimpresión')
      return
    }

    // Mismo payload que pos.js arma al imprimir un ticket nuevo.
    const fac = j.factura
    const em = j.emisor || emisor || {}
    const direccion = [
      em.direccion,
      [em.municipio, em.departamento].filter(Boolean).join(', '),
    ].filter(Boolean).join(' ')
    const payload = {
      merchantName: em.nombre_comercial || 'Julia Bakery',
      razonSocial: em.razon_social || null,
      direccion: direccion || null,
      nitEmisor: em.nit_emisor || null,
      receptorNit: fac.receptor_nit,
      receptorNombre: fac.receptor_nombre,
      fecha: fac.fecha_certificacion
        ? new Date(fac.fecha_certificacion).toLocaleString('es-GT')
        : new Date(fac.fecha_emision).toLocaleString('es-GT'),
      cajeroNombre: null,
      metodoPago: null,
      items: (j.items || []).map(it => ({
        descripcion: it.descripcion,
        cantidad: String(it.cantidad),
        precioUnitario: Number(it.precio_unitario),
        subtotal: Number(it.subtotal),
      })),
      totalGravado: Number(fac.total_gravado),
      iva: Number(fac.iva),
      total: Number(fac.total),
      uuidSat: fac.uuid_sat,
      serieSat: fac.serie_sat,
      numeroSat: fac.numero_sat,
      certificadorNombre: 'INFILE, S.A.',
      certificadorNit: '12521329',
      fechaCertificacion: fac.fecha_certificacion
        ? new Date(fac.fecha_certificacion).toLocaleString('es-GT')
        : null,
      textoFooter: 'Sujeto a pago directo ISR (5111420251235387 - 01/04/2025)',
      esReimpresion: true,
      reimpresionNum: j.reimpresionNum || 1,
    }

    let printedOk = false
    let printMsg = 'sin_bridge'
    try {
      if (typeof window !== 'undefined' && window.JuliaPOS && window.JuliaPOS.printTicket) {
        const pr = await window.JuliaPOS.printTicket(payload)
        printedOk = !!pr?.ok
        printMsg = pr?.error_message || (pr?.ok ? 'impreso' : 'fallo')
      } else {
        printMsg = 'no_wrapper'
      }
    } catch (e) {
      printMsg = e?.message || 'exception'
    }

    setReimprimiendo(null)
    if (toast) {
      toast(printedOk
        ? `Reimpresión N°${j.reimpresionNum} OK`
        : `Audit OK, impresora: ${printMsg}`)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-100 flex justify-between items-center">
          <div className="text-sm font-semibold text-gray-900">Historial del turno</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {err && <div className="text-xs bg-red-50 text-red-700 rounded-lg px-3 py-2">{err}</div>}
          {items === null && <div className="text-xs text-gray-400 text-center py-8">Cargando…</div>}
          {items?.length === 0 && <div className="text-xs text-gray-400 text-center py-8">No emitiste facturas certificadas en este turno todavía.</div>}
          {items?.map(f => {
            const motivoSel = motivos[f.id] || 'cliente_perdio'
            return (
              <div key={f.id} className="border border-gray-100 rounded-xl p-3 space-y-2 bg-gray-50">
                <div className="flex justify-between items-start gap-3 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 truncate">
                      {f.serie_sat ? `${f.serie_sat}-` : ''}{f.numero_sat || f.id.slice(0, 8)}
                    </div>
                    <div className="text-gray-500">{f.receptor_nombre} · NIT {f.receptor_nit}</div>
                    <div className="text-[10px] text-gray-400">{new Date(f.fecha_emision).toLocaleString('es-GT')}</div>
                  </div>
                  <div className="text-right tabular-nums font-semibold text-gray-900">{fmtQ(f.total)}</div>
                </div>
                <div className="flex gap-2 items-center">
                  <select
                    value={motivoSel}
                    onChange={e => setMotivos({ ...motivos, [f.id]: e.target.value })}
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
                  >
                    {Object.entries(MOTIVOS_REIMPRIMIR_POS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                    <option value="otro">Otro</option>
                  </select>
                  <button
                    onClick={() => reimprimir(f)}
                    disabled={reimprimiendo === f.id}
                    className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
                  >
                    {reimprimiendo === f.id ? '…' : 'Reimprimir'}
                  </button>
                </div>
                {motivoSel === 'otro' && (
                  <input
                    type="text"
                    placeholder="Motivo..."
                    maxLength={200}
                    value={otrosTexto[f.id] || ''}
                    onChange={e => setOtrosTexto({ ...otrosTexto, [f.id]: e.target.value })}
                    className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5"
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const fmtQ = (n) => 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Escapa caracteres especiales de regex (usado para reconstruir descripcion
// limpia cuando volvemos a editar un pedido pendiente).
function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Genera un idsale corto (8 hex chars) — sirve para correlacionar la venta
// con la respuesta del Intent NeoPOS, y como UNIQUE en neonet_transacciones
// (previene duplicados por doble-click).
function generarIdsale() {
  const u = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36)
  return u.replace(/-/g, '').slice(0, 12)
}

// Cobra una tarjeta. Default: backend-mediado (Neonet enruta a la P5L).
// Para testing sin P5L: agregar ?mock=1 en la URL del POS.
//
// Devuelve { ok, respuesta_lector, error_message?, origen }.
async function cobrarTarjetaNeonet({ idsale, amountCents }) {
  const usarMock = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('mock') === '1'

  if (usarMock) {
    try {
      const r = await apiFetch('/api/neonet/mock-sale', {
        method: 'POST',
        body: JSON.stringify({ idsale, amount_cents: amountCents }),
      })
      const json = await r.json()
      if (!r.ok || !json.ok) {
        return { ok: false, error_message: json.error_message || json.error || 'Mock rechazo', origen: 'mock' }
      }
      return { ok: true, respuesta_lector: json.respuesta_lector, origen: 'mock' }
    } catch (e) {
      return { ok: false, error_message: e?.message || 'Error llamando al mock', origen: 'mock' }
    }
  }

  // Path real: backend llama authorizationpaymentcommerce -> P5L.
  // Esto puede tardar 30-90s mientras el cajero pasa la tarjeta.
  try {
    const r = await apiFetch('/api/pos/cobrar-tarjeta', {
      method: 'POST',
      body: JSON.stringify({ idsale, amount_cents: amountCents }),
    })
    const json = await r.json()
    if (!r.ok) {
      return { ok: false, error_message: json.error_message || json.error || `Backend HTTP ${r.status}`, origen: 'prod' }
    }
    if (!json.ok) {
      // Cobro rechazado por la red Visanet o por el cajero. El backend ya
      // mapeo a respuesta_lector con response_code != '00'.
      return {
        ok: false,
        error_message: json.error_message || json.respuesta_lector?.response_message || 'Tarjeta rechazada',
        respuesta_lector: json.respuesta_lector,
        origen: 'prod',
      }
    }
    return { ok: true, respuesta_lector: json.respuesta_lector, origen: 'prod' }
  } catch (e) {
    return { ok: false, error_message: e?.message || 'Error de red llamando al backend', origen: 'prod' }
  }
}

// Label del metodo "tarjeta" cambia segun el flag NEXT_PUBLIC_TARJETA_INTEGRADA:
// - 'true' -> "Tarjeta" (a secas; el POS llama a Neonet automaticamente)
// - cualquier otro valor -> "Tarjeta (lector externo)" (la cajera cobra en
//   un dispositivo aparte ej. BAC PAX; el POS solo registra la venta)
const TARJETA_INTEGRADA_FE = String(
  typeof process !== 'undefined' ? (process.env.NEXT_PUBLIC_TARJETA_INTEGRADA || 'false') : 'false'
).toLowerCase() === 'true'

const METODOS_PAGO = [
  { id: 'efectivo',      label: 'Efectivo' },
  { id: 'tarjeta',       label: TARJETA_INTEGRADA_FE ? 'Tarjeta' : 'Tarjeta (lector externo)' },
  { id: 'transferencia', label: 'Transferencia' },
  { id: 'pedidos_ya',    label: 'Pedidos Ya' },
  { id: 'otro',          label: 'Otro' },
]

// Métodos exclusivos del POS modo kiosko (es_kiosko=true). El cliente
// autoservicio del K2 solo ve estos dos botones — sin efectivo, sin tarjeta
// física, sin transferencia manual.
//   recurrente_qr   → modal QR en pantalla, cliente paga con su celular,
//                     POS factura automático al confirmar.
//   pagar_en_caja   → crea pedido_pendiente con código P-NNNN, cliente lleva
//                     ticket/pantalla a la P3 Mix y el cajero ahí cobra y
//                     emite la factura desde la bandeja.
const METODOS_PAGO_KIOSKO = [
  { id: 'recurrente_qr', label: '📱 Pagar con QR' },
  { id: 'pagar_en_caja', label: '💵 Pagar en caja' },
]

// Extrae variants de loyverse_items + resuelve imagen con fallback a categoria.
// categoriasInfo: { [loyverse_id]: { name, image_url } }
function expandirVariantes(items, categoriasInfo) {
  const out = []
  for (const it of items) {
    const catInfo = categoriasInfo[it.category_id] || { name: '', image_url: null }
    for (const v of (Array.isArray(it.variants) ? it.variants : [])) {
      if (!v?.variant_id) continue
      const stores = Array.isArray(v.stores) ? v.stores : []
      const price = stores[0]?.price ?? v.default_price ?? null
      out.push({
        variant_id: v.variant_id,
        item_id: it.loyverse_id,
        item_name: it.item_name || '?',
        variant_name: v.option1_value || v.option2_value || '',
        sku: v.sku || '',
        precio: price != null ? Number(price) : null,
        // Imagen del producto -> imagen de categoria -> null (fallback iniciales en UI)
        image_url: it.image_url || catInfo.image_url || null,
        categoria: catInfo.name,
      })
    }
  }
  out.sort((a, b) => (a.item_name || '').localeCompare(b.item_name || '', 'es'))
  return out
}

export default function POS({ session }) {
  const router = useRouter()
  const kiosko = useEsKiosko()
  const [perfil, setPerfil] = useState(null)
  const [productos, setProductos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [cargandoCat, setCargandoCat] = useState(true)
  const [busqueda, setBusqueda] = useState('')
  const [catSel, setCatSel] = useState('')
  const [carrito, setCarrito] = useState([])  // [{variant_id, descripcion, cantidad, precio_unitario, descuenta_insumos, receta_id?}]
  const [receptor, setReceptor] = useState({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '', modo: 'cf' })
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [montoRecibido, setMontoRecibido] = useState(0)  // calculadora vuelto efectivo
  const [enviando, setEnviando] = useState(false)
  const [resultado, setResultado] = useState(null)
  // Payload de comanda guardado para poder imprimirla bajo demanda desde
  // PantallaExito (boton manual). Se arma durante el cobro y se guarda
  // junto con el resultado.
  const [payloadComanda, setPayloadComanda] = useState(null)
  const [consultando, setConsultando] = useState(false)
  const [nitMsg, setNitMsg] = useState(null)        // 'NIT no encontrado en RTU' o null
  const [mostrarHistorial, setMostrarHistorial] = useState(false)
  const [toastMsg, setToastMsg] = useState(null)    // mensaje breve, auto-dismiss
  function flashToast(msg) {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 3500)
  }
  const [err, setErr] = useState(null)
  const [mostrarCarritoMobile, setMostrarCarritoMobile] = useState(false)
  // Edicion de nota/extras de una linea del carrito. { idx, descripcion, value } o null.
  const [lineaConNota, setLineaConNota] = useState(null)
  // Fase de autorización Neonet (cuando metodoPago='tarjeta' y estamos
  // esperando respuesta del bridge / mock). { idsale, monto } o null.
  const [neonetFase, setNeonetFase] = useState(null)
  // Memoria del ultimo NIT consultado para no repetir el call al RTU si el
  // usuario sale del input y vuelve sin cambiar.
  const ultimoNitConsultado = useRef('')
  const debounceTimer = useRef(null)
  const [turno, setTurno] = useState(null)
  const [turnoCargado, setTurnoCargado] = useState(false)
  const [emisor, setEmisor] = useState(null)  // datos del emisor para imprimir en ticket

  // ===== Bandeja de pedidos pendientes (Pedidos Ya) =====
  // pedidoEditando: si el carrito proviene de un pedido pendiente, este id
  // hace que "Cobrar" llame a /api/pos/pedidos/:id/facturar en vez de
  // /api/pos/ventas — asi el pedido se marca como entregado_facturado.
  const [pedidosPendientes, setPedidosPendientes] = useState([])
  const [cargandoPedidos, setCargandoPedidos] = useState(false)
  const [mostrarBandeja, setMostrarBandeja] = useState(false)
  const [mostrarGuardarPedido, setMostrarGuardarPedido] = useState(false)
  const [pedidoEditando, setPedidoEditando] = useState(null)  // { id, referencia } o null

  // Split payments: si !== null, se manda pagos[] al endpoint y queda 'mixto'
  // en facturas_fel. null = comportamiento legacy (1 metodo plano).
  const [pagosDivididos, setPagosDivididos] = useState(null)  // null | [{metodo, monto, ...}]
  const [mostrarDividirPago, setMostrarDividirPago] = useState(false)

  // Modales del POS kiosko: QR Recurrente y código "Pagar en caja"
  //   modalQR     = { checkoutUrl, orderId, segsRestantes } | null
  //   modalCaja   = { referencia, total, segsRestantes } | null
  const [modalQR, setModalQR] = useState(null)
  const [modalCaja, setModalCaja] = useState(null)

  async function recargarPedidos({ silent = false } = {}) {
    if (!silent) setCargandoPedidos(true)
    try {
      // Traer pedidos en preparación Y los marcados como 'lista' (esperando
      // que el cliente venga a recoger) para que el cajero vea ambos.
      const r = await apiFetch('/api/pos/pedidos?estado=activos&limit=50')
      const j = await r.json()
      if (j.ok) setPedidosPendientes(j.pedidos || [])
    } finally {
      if (!silent) setCargandoPedidos(false)
    }
  }

  // Polling del modal QR Recurrente. Mientras está abierto, pega cada 3s al
  // endpoint /api/pickup/pedido-status/[id] y avanza cuando estado pasa a
  // pendiente_entrega (pago confirmado por webhook o por confirmar-sandbox).
  useEffect(() => {
    if (!modalQR || modalQR.estado !== 'esperando') return
    let cancel = false
    const poll = async () => {
      try {
        const r = await fetch(`/api/pickup/pedido-status/${modalQR.orderId}`, { cache: 'no-store' })
        const j = await r.json()
        if (cancel) return
        if (j.ok && (j.estado === 'pendiente_entrega' || j.estado === 'lista')) {
          // Pago confirmado. El pedido queda en pendiente_entrega con
          // pagado_at seteado en BD. El cajero P3 Mix lo verá en su bandeja
          // con badge PAGADO y podrá facturar cuando entregue. NO facturamos
          // automáticamente desde acá — la factura la emite el cajero al
          // entregar el producto.
          setModalQR(m => m ? { ...m, estado: 'pagado', referencia: j.referencia } : null)
          setTimeout(() => mostrarConfirmacionPagoKioskoQR(modalQR.orderId).catch(() => {}), 800)
        }
      } catch (_) {}
    }
    const interval = setInterval(poll, 3000)
    poll()
    return () => { cancel = true; clearInterval(interval) }
  }, [modalQR?.orderId, modalQR?.estado])

  // Countdown timeout del modal QR — 10 mins. Si vence, cancelamos.
  useEffect(() => {
    if (!modalQR || modalQR.estado !== 'esperando') return
    const t = setInterval(() => {
      setModalQR(m => {
        if (!m) return null
        if (m.segsRestantes <= 1) {
          clearInterval(t)
          return { ...m, estado: 'timeout', segsRestantes: 0 }
        }
        return { ...m, segsRestantes: m.segsRestantes - 1 }
      })
    }, 1000)
    return () => clearInterval(t)
  }, [modalQR?.estado])

  // Countdown del modal "Pagar en caja" — 30s y vuelve a inicio
  useEffect(() => {
    if (!modalCaja) return
    const t = setInterval(() => {
      setModalCaja(m => {
        if (!m) return null
        if (m.segsRestantes <= 1) {
          clearInterval(t)
          // reset al estado limpio del POS para próximo cliente
          setCarrito([])
          setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '', modo: 'cf' })
          return null
        }
        return { ...m, segsRestantes: m.segsRestantes - 1 }
      })
    }, 1000)
    return () => clearInterval(t)
  }, [!!modalCaja])

  // Después del QR: cuando se confirma el pago, llamamos al endpoint que
  // emite la factura del pedido pendiente. Reusa /api/pos/pedidos/[id]/facturar
  // que ya marca el pedido como entregado_facturado + emite FEL + asiento.
  // Después de facturar, imprime el ticket en la térmica del K2 via el
  // bridge nativo window.JuliaPOS.printTicket.
  //
  // IMPORTANTE: los items para el ticket NO los tomamos del state `carrito`
  // (que puede haber cambiado durante el polling de 3s+) sino del pedido
  // devuelto por el endpoint — es la fuente de verdad.
  async function mostrarConfirmacionPagoKioskoQR(orderId) {
    // NUEVO flujo: el K2 NO factura más. Solo confirma pago al cliente +
    // imprime comprobante no fiscal con el número de pedido. El cajero
    // P3 Mix ve el pedido en bandeja con badge PAGADO y emite el FEL
    // cuando el cliente llega a recoger (botón "Entregar y facturar").
    //
    // Acá solo:
    //   1. Obtener datos del pedido para el ticket
    //   2. Imprimir comprobante no fiscal "Pasá al mostrador"
    //   3. flashToast confirmando + reset del POS
    let datosImprimir = null
    try {
      const r = await fetch(`/api/pickup/orders/${orderId}`)
      const j = await r.json()
      if (j.ok && j.order) {
        datosImprimir = { pedido: j.order }
        flashToast(`✅ Pago confirmado · ${j.order.referencia} · Pasá al mostrador`)
      } else {
        flashToast('✅ Pago confirmado · Pasá al mostrador')
      }
    } catch (e) {
      console.error('[kiosko-qr] exc al cargar pedido:', e)
      flashToast('✅ Pago confirmado')
    }

    // Print COMPROBANTE NO FISCAL en la térmica del K2 (best-effort).
    // Sin datos SAT — solo pedido + total + instrucción "Pasá al mostrador".
    // La factura FEL se emite cuando el cajero P3 Mix entrega la orden.
    if (datosImprimir && typeof window !== 'undefined' && window.JuliaPOS?.printTicket) {
      try {
        const pedido = datosImprimir.pedido
        const items = Array.isArray(pedido?.items) ? pedido.items : []
        if (items.length === 0) {
          console.warn('[kiosko-qr] pedido sin items — no imprimo')
        } else {
          const e = emisor || {}
          const payload = {
            merchantName: e.nombre_comercial || 'Julia Bakery',
            razonSocial: pedido.referencia || 'COMPROBANTE DE PAGO',
            direccion: '2 Avenida 11-08, Zona 10',
            nitEmisor: null,
            receptorNit: null,
            receptorNombre: pedido.receptor_nombre || 'CONSUMIDOR FINAL',
            fecha: new Date().toLocaleString('es-GT'),
            cajeroNombre: 'K2 · QR Recurrente',
            metodoPago: 'PAGADO con tarjeta vía QR',
            items: items.map(l => ({
              descripcion: String(l.descripcion || ''),
              cantidad: String(l.cantidad || 1),
              precioUnitario: Number(l.precio_unitario || 0),
              subtotal: Math.round(Number(l.cantidad || 0) * Number(l.precio_unitario || 0) * 100) / 100,
            })),
            totalGravado: null,
            iva: null,
            total: Number(pedido.total_estimado || 0),
            uuidSat: null,
            serieSat: null,
            numeroSat: null,
            certificadorNombre: null,
            certificadorNit: null,
            fechaCertificacion: null,
            textoFooter: `*** COMPROBANTE NO FISCAL ***\nTu pedido ${pedido.referencia} está PAGADO.\nPasá al mostrador para recogerlo.\nLa factura electrónica se entrega ahí.`,
          }
          const pr = await window.JuliaPOS.printTicket(payload)
          console.log('[kiosko-qr] printTicket result:', pr)
        }
      } catch (e) {
        console.warn('[kiosko-qr] printTicket falló:', e?.message || e)
      }
    }

    // Reset del POS pase lo que pase
    setModalQR(null)
    setCarrito([])
    setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '', modo: 'cf' })
  }

  // Auto-refresh: mientras la bandeja esté abierta, refrescamos cada 20s para
  // que pedidos nuevos (pickup PWA, K2 armador) aparezcan sin que el cajero
  // tenga que cerrar/abrir el modal. silent=true evita el skeleton flickering.
  useEffect(() => {
    if (!mostrarBandeja) return
    const t = setInterval(() => { recargarPedidos({ silent: true }) }, 20000)
    return () => clearInterval(t)
  }, [mostrarBandeja])

  // Cargar perfil + catálogo + turno (si cajero)
  useEffect(() => {
    // Sin sesion: en kiosko (wrapper Sunmi) -> PIN del cajero. En desktop ->
    // login admin email/password. Asi el cajero no ve un form de email que
    // no sabe usar y el admin no esta forzado a tener PIN.
    //
    // Usamos esKiosko() directo (no el hook) porque el hook parte en false
    // por SSR-safe y se actualiza tras montar. En este punto (useEffect post
    // montaje) el bridge ya inyecto su User-Agent / window.JuliaPOS, asi que
    // el check sincrono es confiable.
    if (!session) {
      const k = esKiosko()
      console.log('[POS] sin sesion. kiosko=' + k + ' ua=' + (typeof navigator !== 'undefined' ? navigator.userAgent : '?'))
      router.push(k ? '/cajero-login' : '/')
      return
    }
    supabase.from('perfiles').select('id, email, nombre_completo, rol, es_kiosko').eq('id', session.user.id).single()
      .then(({ data }) => {
        const p = data || { id: session.user.id, email: session.user.email, rol: 'empleado' }
        setPerfil(p)
        // Si es cajero, chequear turno abierto. Si no hay, mandar a abrir caja.
        if (p.rol === 'cajero') {
          apiFetch('/api/turnos/actual').then(r => r.json()).then(j => {
            if (!j.turno) {
              router.replace('/abrir-caja')
            } else {
              setTurno(j.turno)
              setTurnoCargado(true)
            }
          })
        } else {
          setTurnoCargado(true)
        }
      })
    Promise.all([
      supabase.from('loyverse_categories').select('loyverse_id, name, image_url'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, category_id, variants, image_url').is('deleted_at', null),
    ]).then(([{ data: cats }, { data: its }]) => {
      // categoriasInfo: id -> { name, image_url } para resolver fallback de imagen
      const categoriasInfo = {}
      const nombresPorId = {}
      for (const c of cats || []) {
        categoriasInfo[c.loyverse_id] = { name: c.name, image_url: c.image_url || null }
        nombresPorId[c.loyverse_id] = c.name
      }
      setCategorias(nombresPorId)  // mantiene compat con el filtro de categorías
      setProductos(expandirVariantes(its || [], categoriasInfo))
      setCargandoCat(false)
    })
    // Cargar datos del emisor para incluirlos en el ticket impreso
    apiFetch('/api/fel/emisor').then(r => r.json()).then(j => {
      if (j?.emisor) setEmisor(j.emisor)
    }).catch(() => {})
    // Cargar pedidos pendientes del turno (best effort)
    recargarPedidos()
  }, [session])

  // Nota: la suscripción realtime a pedidos de "kiosko separado" se eliminó.
  // Desde 2026-06-01 el kiosko es un cajero más (PIN propio, flag es_kiosko en
  // perfil), factura directamente y no genera pedidos pendientes que otro
  // cajero deba recoger.

  const esAdmin = perfil?.rol === 'admin'
  const esCajero = perfil?.rol === 'cajero'
  // Cajero "Kiosko" (K2 Mini autoservicio). En kiosko reemplazamos los métodos
  // de pago por sólo 2: QR Recurrente (pago digital en el momento) y Pagar en
  // caja (genera pedido pendiente, el cliente va a la P3 Mix a cobrar/facturar).
  const esKioskoCajero = !!perfil?.es_kiosko
  const metodosPagoDisponibles = esKioskoCajero ? METODOS_PAGO_KIOSKO : METODOS_PAGO

  // Si entra como kiosko y el método activo no es válido (default 'efectivo'),
  // forzamos al primer método del kiosko.
  useEffect(() => {
    if (esKioskoCajero && !metodosPagoDisponibles.some(m => m.id === metodoPago)) {
      setMetodoPago(METODOS_PAGO_KIOSKO[0].id)
    }
  }, [esKioskoCajero])

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return productos.filter(p => {
      if (catSel && p.categoria !== catSel) return false
      if (!q) return true
      return (p.item_name || '').toLowerCase().includes(q) || (p.variant_name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)
    }).slice(0, 200)  // limit para no laguear con miles
  }, [productos, busqueda, catSel])

  const categoriasUnicas = useMemo(() => {
    const s = new Set(productos.map(p => p.categoria).filter(Boolean))
    return Array.from(s).sort()
  }, [productos])

  const totales = useMemo(() => {
    const total = carrito.reduce((s, l) => s + Number(l.cantidad) * Number(l.precio_unitario), 0)
    const gravable = total / 1.12
    const iva = total - gravable
    return {
      total: Math.round(total * 100) / 100,
      gravable: Math.round(gravable * 100) / 100,
      iva: Math.round(iva * 100) / 100,
    }
  }, [carrito])

  function agregarProducto(p) {
    setCarrito(prev => {
      // Solo agrupar con una linea existente si NINGUNA de las dos tiene nota.
      // Asi si el cajero ya armo "1 latte deslactosado", el siguiente tap del
      // mismo latte crea una linea nueva (sin nota) — listo para personalizar
      // diferente o cobrar como normal.
      const idx = prev.findIndex(l => l.variant_id === p.variant_id && !l.notas)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], cantidad: next[idx].cantidad + 1 }
        return next
      }
      return [...prev, {
        variant_id: p.variant_id,
        descripcion: p.item_name + (p.variant_name ? ` (${p.variant_name})` : ''),
        cantidad: 1,
        precio_unitario: p.precio || 0,
        descuenta_insumos: false,
        notas: '',
      }]
    })
  }

  function setLinea(i, patch) {
    setCarrito(prev => prev.map((l, idx) => idx === i ? { ...l, ...patch } : l))
  }
  function quitarLinea(i) {
    setCarrito(prev => prev.filter((_, idx) => idx !== i))
  }

  // Sanea el NIT: quita guiones/espacios/letras minúsculas; SAT acepta sufijo
  // "K" en mayúscula (digito verificador).
  function normalizarNit(s) {
    return String(s || '').replace(/[^0-9Kk]/g, '').toUpperCase()
  }

  async function consultarNit(nitArg) {
    const nit = normalizarNit(nitArg ?? receptor.nit)
    if (!nit || nit === 'CF') return
    if (nit === ultimoNitConsultado.current) return  // ya consultado, no repetir
    setConsultando(true); setNitMsg(null)
    ultimoNitConsultado.current = nit
    try {
      const r = await apiFetch(`/api/fel/consultar-nit?nit=${encodeURIComponent(nit)}`)
      const j = await r.json()
      if (r.ok && j.receptor?.nombre) {
        setReceptor(rec => ({ ...rec, nombre: j.receptor.nombre }))
        setNitMsg(null)
      } else if (r.ok) {
        // Endpoint OK pero NIT no figura en RTU. Dejamos el nombre editable.
        setNitMsg(j.mensaje || 'NIT no encontrado en RTU — ingresá el nombre manualmente')
      } else {
        // Error en endpoint o en Infile — NO bloquea la venta.
        setNitMsg(j.error || 'No se pudo consultar el RTU — ingresá el nombre manualmente')
      }
    } catch (e) {
      setNitMsg('Sin conexión al RTU — ingresá el nombre manualmente')
    } finally {
      setConsultando(false)
    }
  }

  // Consulta CUI/DPI (personas naturales). 13 digitos. Devuelve nombre + flag
  // fallecido (alerta amarilla — no bloquea la venta).
  async function consultarDpi(dpiArg) {
    const dpi = String(dpiArg ?? receptor.nit).replace(/\D/g, '')
    if (!dpi || dpi.length !== 13) return
    if (dpi === ultimoNitConsultado.current) return
    setConsultando(true); setNitMsg(null)
    ultimoNitConsultado.current = dpi
    try {
      const r = await apiFetch(`/api/fel/consultar-cui?cui=${encodeURIComponent(dpi)}`)
      const j = await r.json()
      if (r.ok && j.receptor?.nombre) {
        setReceptor(rec => ({ ...rec, nombre: j.receptor.nombre }))
        if (j.fallecido) {
          setNitMsg(j.mensaje || '⚠️ La persona figura como FALLECIDA en RENAP')
        } else {
          setNitMsg(null)
        }
      } else if (r.ok) {
        setNitMsg(j.mensaje || 'DPI no encontrado — ingresá el nombre manualmente')
      } else {
        setNitMsg(j.error || 'No se pudo consultar el DPI — ingresá el nombre manualmente')
      }
    } catch (e) {
      setNitMsg('Sin conexión al RENAP — ingresá el nombre manualmente')
    } finally {
      setConsultando(false)
    }
  }

  // Debounce automático: consulta 600 ms despues de que el usuario dejo de
  // tipear, si el NIT/DPI cambio. Si pierde foco (onBlur del input) se gatilla
  // inmediato. Validacion: 5+ chars para NIT, 13 exactos para DPI.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current)
    const id = String(receptor.nit || '').replace(/\D/g, '')
    if (receptor.modo === 'dpi') {
      if (id.length !== 13) return
      if (id === ultimoNitConsultado.current) return
      debounceTimer.current = setTimeout(() => consultarDpi(id), 600)
    } else if (receptor.modo === 'nit') {
      const nit = normalizarNit(receptor.nit)
      if (!nit || nit === 'CF' || nit.length < 5) return
      if (nit === ultimoNitConsultado.current) return
      debounceTimer.current = setTimeout(() => consultarNit(nit), 600)
    }
    return () => debounceTimer.current && clearTimeout(debounceTimer.current)
  }, [receptor.nit, receptor.modo])

  // Cambia entre los 3 modos del receptor: cf | nit | dpi.
  function setReceptorModo(modo) {
    ultimoNitConsultado.current = ''
    setNitMsg(null)
    if (modo === 'cf') {
      setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '', modo: 'cf' })
    } else {
      setReceptor(r => ({ ...r, nit: '', nombre: '', modo }))
    }
  }

  // ============================================================
  // KIOSKO — Pagar en caja
  //
  // El cliente arma su carrito en el K2 pero NO paga ahí. POS crea un
  // pedido_pendiente con origen='pos_kiosko', estado='pendiente_entrega'.
  // En la P3 Mix del cajero aparece en la bandeja con prefijo P-NNNN. El
  // cajero cobra (efectivo/tarjeta/lo que sea) y factura desde la bandeja
  // como cualquier otro pedido pendiente.
  // ============================================================
  async function cobrarKioskoEnCaja() {
    setEnviando(true)
    try {
      // Receptor: usa el NIT ingresado por el cajero/cliente si hay uno
      // real; si está como CF (default), va CONSUMIDOR FINAL.
      const receptorParaPedido = (receptor?.nit && receptor.nit !== 'CF' && receptor.nombre?.trim())
        ? { nit: receptor.nit, nombre: receptor.nombre.trim(), email: receptor.email || '', telefono: '-' }
        : { nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '', telefono: '-' }
      const body = {
        origen: 'pos_kiosko',
        items: carrito.map(l => ({
          variant_id: l.variant_id,
          descripcion: l.notas ? `${l.descripcion} · ${l.notas}` : l.descripcion,
          cantidad: Number(l.cantidad),
          precio_unitario: Number(l.precio_unitario),
        })),
        receptor: receptorParaPedido,
        pago: { metodo: 'cobrar_en_caja', simulado: true },
      }
      const r = await fetch('/api/pickup/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        setErr(j.error || 'No pudimos generar el pedido')
        setEnviando(false)
        return
      }
      setEnviando(false)
      // Mostrar pantalla con código grande y countdown 30s
      const total = (j.order?.total_estimado || 0)
      setModalCaja({
        referencia: j.order.referencia,
        total: Number(total),
        segsRestantes: 30,
      })
    } catch (e) {
      setEnviando(false)
      setErr('Error de red al crear el pedido')
    }
  }

  // ============================================================
  // KIOSKO — Pagar con QR Recurrente
  //
  // Crea pedido pendiente + checkout en Recurrente. Muestra QR. POS hace
  // polling al estado del pedido cada 3s. Cuando se confirma el pago, el
  // backend ya marcó el pedido como pendiente_entrega; el POS llama al
  // endpoint /facturar para emitir el FEL y luego sigue el flujo normal
  // (impresión de ticket + reset).
  // ============================================================
  async function cobrarKioskoQR() {
    setEnviando(true)
    try {
      // Receptor: usa NIT real del cajero/cliente si lo ingresó; si no, CF
      const receptorParaPedido = (receptor?.nit && receptor.nit !== 'CF' && receptor.nombre?.trim())
        ? { nit: receptor.nit, nombre: receptor.nombre.trim(), email: receptor.email || '', telefono: '-' }
        : { nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '', telefono: '-' }
      // 1) Crear pedido pendiente con origen pos_kiosko
      const r1 = await fetch('/api/pickup/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origen: 'pos_kiosko',
          items: carrito.map(l => ({
            variant_id: l.variant_id,
            descripcion: l.notas ? `${l.descripcion} · ${l.notas}` : l.descripcion,
            cantidad: Number(l.cantidad),
            precio_unitario: Number(l.precio_unitario),
          })),
          receptor: receptorParaPedido,
          pago: { metodo: 'recurrente', simulado: false },
        }),
      })
      const j1 = await r1.json()
      if (!r1.ok || !j1.ok) {
        setErr(j1.error || 'No pudimos crear el pedido')
        setEnviando(false)
        return
      }
      const orderId = j1.order.id

      // 2) Crear checkout en Recurrente
      const r2 = await fetch('/api/pickup/recurrente-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId }),
      })
      const j2 = await r2.json()
      if (!r2.ok || !j2.ok || !j2.checkout_url) {
        setErr(j2.error || 'No pudimos iniciar el cobro QR')
        setEnviando(false)
        return
      }

      setEnviando(false)
      // 3) Mostrar modal QR (polling lo maneja el useEffect de modalQR)
      setModalQR({
        checkoutUrl: j2.checkout_url,
        orderId,
        referencia: j1.order.referencia,
        total: Number(j1.order.total_estimado || 0),
        segsRestantes: 600,  // 10 min timeout
        estado: 'esperando',
      })
    } catch (e) {
      setEnviando(false)
      setErr('Error de red al iniciar cobro QR')
    }
  }

  async function cobrar() {
    setErr(null)
    if (carrito.length === 0) { setErr('Carrito vacío'); return }
    if (receptor.nit !== 'CF' && !receptor.nombre.trim()) { setErr('Nombre del receptor requerido (o usá CF)'); return }

    // ===== Flujos exclusivos del POS modo kiosko (K2 mini autoservicio) =====
    // Estos métodos NO emiten factura en este paso — generan un pedido
    // pendiente. recurrente_qr factura cuando el pago se confirma;
    // pagar_en_caja factura cuando el cajero P3 Mix cobra desde su bandeja.
    if (esKioskoCajero && metodoPago === 'recurrente_qr') {
      return await cobrarKioskoQR()
    }
    if (esKioskoCajero && metodoPago === 'pagar_en_caja') {
      return await cobrarKioskoEnCaja()
    }

    setEnviando(true)

    // Si es tarjeta y tenemos integracion automatica habilitada, primero
    // autorizar con Neonet (bridge Sunmi en prod, mock en desktop). Si
    // rechaza, abortar antes de tocar el FEL.
    //
    // Si tarjetaIntegrada=false (default), se asume que el cajero pasó la
    // tarjeta en un lector EXTERNO (ej. BAC PAX standalone), recibió aprobado
    // ahí mismo, y ahora solo registra la venta en el POS para certificar +
    // imprimir. No llamamos a ningun procesador.
    //
    // Toggle desde Vercel: NEXT_PUBLIC_TARJETA_INTEGRADA='true' habilita el
    // flujo integrado. Cualquier otro valor (o falta) = modo externo.
    const tarjetaIntegrada = String(process.env.NEXT_PUBLIC_TARJETA_INTEGRADA || 'false').toLowerCase() === 'true'

    let neonet_resultado = null
    if (metodoPago === 'tarjeta' && tarjetaIntegrada) {
      const amountCents = Math.round(totales.total * 100)
      if (amountCents <= 0) {
        setEnviando(false); setErr('Monto inválido para tarjeta')
        return
      }
      const idsale = generarIdsale()
      setNeonetFase({ idsale, monto: totales.total })
      try {
        const r = await cobrarTarjetaNeonet({ idsale, amountCents })
        setNeonetFase(null)
        if (!r.ok) {
          setEnviando(false)
          setErr(`Cobro con tarjeta no autorizado: ${r.error_message || 'sin detalle'}`)
          return
        }
        // Si el tarjetahabiente tiene NIT en RTU y el receptor sigue siendo CF,
        // ofrecer usarlo (el usuario confirma — no auto-cambia para evitar fraude).
        const sugerido = r.respuesta_lector.suggested_nit
        if (sugerido && receptor.nit === 'CF') {
          if (confirm(`La tarjeta tiene NIT ${sugerido} registrado. ¿Facturar a ese NIT en vez de Consumidor Final?`)) {
            setReceptor(rec => ({ ...rec, nit: sugerido, nombre: '' }))
            // Disparamos consulta de RTU para autocompletar nombre. Como es
            // sincrono no podemos esperar acá; el usuario verá la sugerencia
            // de nombre cuando el endpoint responda. Igual avanzamos con el flow.
            consultarNit(sugerido)
          }
        }
        neonet_resultado = {
          idsale,
          amount_cents: amountCents,
          respuesta_lector: r.respuesta_lector,
          origen: r.origen,
        }
      } catch (e) {
        setNeonetFase(null)
        setEnviando(false)
        setErr(`Error al autorizar tarjeta: ${e?.message || e}`)
        return
      }
    }

    // Si la linea tiene una nota (ej "leche deslactosada"), la concatenamos a
    // la descripcion antes de mandar al FEL. Asi sale tal cual en la factura,
    // en el ticket impreso y en la comanda de barra (que toma el snapshot de
    // items) sin tocar el backend.
    const fusionarDesc = (l) => l.notas
      ? `${l.descripcion} · ${l.notas}`
      : l.descripcion

    const body = {
      items: carrito.map(l => ({
        variant_id: l.variant_id,
        descripcion: fusionarDesc(l),
        cantidad: Number(l.cantidad),
        precio_unitario: Number(l.precio_unitario),
        descuenta_insumos: l.descuenta_insumos,
        receta_id: l.receta_id || null,
        unidad_medida: 'UND',
      })),
      receptor,
      metodo_pago: metodoPago,
      ...(pagosDivididos ? { pagos: pagosDivididos } : {}),
      ...(neonet_resultado ? { neonet_resultado } : {}),
    }
    // Si veniamos editando un pedido pendiente, lo facturamos via el endpoint
    // que ademas marca el pedido como entregado. Reusa /api/pos/ventas
    // internamente — mismo flujo de certificacion + descuento + asiento.
    const url = pedidoEditando
      ? `/api/pos/pedidos/${pedidoEditando.id}/facturar`
      : '/api/pos/ventas'
    const res = await apiFetch(url, { method: 'POST', body: JSON.stringify(body) })
    const json = await res.json()
    setEnviando(false)
    if (!res.ok) {
      setErr(`[${json.etapa || 'error'}] ${json.error || 'Falla'}`)
      setResultado({ error: true, ...json })
      return
    }
    setResultado(json)

    // ⚠️ Fallback Infile: si la venta entró en cola de certificación
    // (Infile caído), avisamos al cajero con toast claro. La factura va
    // a salir automáticamente cuando Infile vuelva.
    if (json.pendiente_certificacion) {
      flashToast('⚠️ Venta guardada — Infile caído, factura se certifica sola al volver')
    }

    // Imprimir ticket cliente en la termica del Sunmi (si esta el bridge nativo).
    // Best-effort: si falla, la venta sigue OK; el cajero puede re-imprimir
    // manual mas tarde.
    try {
      if (typeof window !== 'undefined' && window.JuliaPOS && window.JuliaPOS.printTicket) {
        const f = json.factura
        const e = emisor || {}
        const enCertificacion = !!json.pendiente_certificacion
        // Direccion completa del emisor en una linea
        const direccion = [
          e.direccion,
          [e.municipio, e.departamento].filter(Boolean).join(', '),
        ].filter(Boolean).join(' ')
        const payload = {
          // EMISOR
          merchantName: e.nombre_comercial || 'Julia Bakery',
          razonSocial: e.razon_social || null,
          direccion: direccion || null,
          nitEmisor: e.nit_emisor || null,
          // RECEPTOR
          receptorNit: f.receptor_nit,
          receptorNombre: f.receptor_nombre,
          fecha: new Date(f.fecha_certificacion || Date.now()).toLocaleString('es-GT'),
          cajeroNombre: perfil?.nombre_completo || null,
          metodoPago: f.metodo_pago || null,
          // ITEMS + TOTALES. La descripcion incluye la nota/extras si la hay,
          // igual que en el body del FEL — para que el ticket impreso refleje
          // exactamente lo facturado.
          items: carrito.map(l => ({
            descripcion: fusionarDesc(l),
            cantidad: String(l.cantidad),
            precioUnitario: Number(l.precio_unitario),
            subtotal: Math.round(Number(l.cantidad) * Number(l.precio_unitario) * 100) / 100,
          })),
          totalGravado: Math.round((Number(f.total) / 1.12) * 100) / 100,
          iva: Number(f.iva),
          total: Number(f.total),
          // CERTIFICADOR (Infile) — solo si está certificada de verdad
          uuidSat: enCertificacion ? null : f.uuid_sat,
          serieSat: enCertificacion ? null : f.serie_sat,
          numeroSat: enCertificacion ? null : f.numero_sat,
          certificadorNombre: enCertificacion ? 'PENDIENTE CERTIFICACIÓN' : 'INFILE, S.A.',
          certificadorNit: enCertificacion ? null : '12521329',
          fechaCertificacion: f.fecha_certificacion
            ? new Date(f.fecha_certificacion).toLocaleString('es-GT')
            : null,
          // Footer: si está en cola, advertencia al cliente
          textoFooter: enCertificacion
            ? '*** COMPROBANTE NO FISCAL ***\nInfile no disponible al momento de la venta.\nFactura electrónica se enviará por email al certificar.\nConservar este comprobante como respaldo.'
            : 'Sujeto a pago directo ISR (5111420251235387 - 01/04/2025)',
        }
        const r = await window.JuliaPOS.printTicket(payload)
        console.log('[POS] printTicket result:', r)

        // ---- COMANDA bajo demanda ----
        // El D3 Mini no tiene cuchilla automatica — solo barra rasgable.
        // Si imprimimos ticket+comanda automatico, salen pegados y al
        // cajero no le queda claro donde rasgar.
        // En su lugar guardamos el payload de comanda en state y
        // PantallaExito muestra un boton 'Imprimir comanda' que el
        // cajero toca DESPUES de rasgar el ticket de venta.
        const refComanda = (f.uuid_sat || '').slice(-6).toUpperCase() || String(f.numero_sat || '').slice(-6)
        setPayloadComanda({
          ...payload,
          esComanda: true,
          numeroComanda: refComanda,
          items: carrito.map(l => ({
            descripcion: fusionarDesc(l),
            cantidad: String(l.cantidad),
            precioUnitario: 0,
            subtotal: 0,
          })),
          totalGravado: 0,
          iva: 0,
          total: 0,
          uuidSat: null,
          serieSat: null,
          numeroSat: null,
          certificadorNombre: null,
          certificadorNit: null,
          fechaCertificacion: null,
          textoFooter: null,
        })
      }
    } catch (e) {
      console.warn('[POS] printTicket fallo (no crashea venta):', e?.message || e)
    }
  }

  function nuevaVenta() {
    setCarrito([])
    setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '' })
    // En kiosko nunca hay efectivo — default a tarjeta para evitar estado inválido
    setMetodoPago(esKioskoCajero ? 'tarjeta' : 'efectivo')
    setMontoRecibido(0)
    setPagosDivididos(null)
    setResultado(null)
    setPayloadComanda(null)
    setErr(null)
    setMostrarCarritoMobile(false)
    setPedidoEditando(null)  // si veniamos de un pedido, salir del modo edicion
    if (!esKioskoCajero) recargarPedidos()  // refrescar bandeja despues de cualquier venta
  }

  // ===== Handlers de pedidos pendientes =====

  // Guarda el carrito actual como pedido pendiente. Sale del modal con
  // referencia/origen/notas. Limpia el carrito tras guardar.
  async function guardarPedidoActual({ referencia, origen, notas }) {
    if (carrito.length === 0) throw new Error('Carrito vacío')
    const body = {
      referencia,
      origen,
      notas,
      receptor,
      items: carrito.map(l => ({
        variant_id: l.variant_id,
        descripcion: l.notas ? `${l.descripcion} · ${l.notas}` : l.descripcion,
        cantidad: Number(l.cantidad),
        precio_unitario: Number(l.precio_unitario),
        descuenta_insumos: l.descuenta_insumos,
        receta_id: l.receta_id || null,
        unidad_medida: 'UND',
        notas: l.notas || null,  // tambien por separado para poder editar despues
      })),
    }
    const r = await apiFetch('/api/pos/pedidos', { method: 'POST', body: JSON.stringify(body) })
    const j = await r.json()
    if (!r.ok || !j.ok) throw new Error(j.error || 'No se pudo guardar el pedido')
    // Limpia el carrito y refresca la bandeja
    setCarrito([])
    setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '' })
    setMetodoPago('efectivo')
    setMontoRecibido(0)
    setMostrarGuardarPedido(false)
    flashToast(`Pedido "${referencia}" guardado en bandeja`)
    recargarPedidos()
  }

  // Carga los items de un pedido al carrito + entra en modo edicion.
  // Al cobrar despues, en vez de POST /api/pos/ventas llama
  // /api/pos/pedidos/:id/facturar (que marca el pedido como entregado).
  function continuarPedido(pedido) {
    // Mapear items del pedido al shape del carrito (preservando notas si las hay)
    const lineas = (pedido.items || []).map(it => ({
      variant_id: it.variant_id || null,
      // Si la nota viene separada, restaurar la descripcion limpia; sino dejar
      // la descripcion tal cual (puede contener la nota concatenada del save).
      descripcion: it.notas
        ? String(it.descripcion).replace(new RegExp(`\\s·\\s${escapeRegex(it.notas)}$`), '')
        : it.descripcion,
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio_unitario),
      descuenta_insumos: !!it.descuenta_insumos,
      receta_id: it.receta_id || null,
      notas: it.notas || '',
    }))
    setCarrito(lineas)
    setReceptor({
      nit: pedido.receptor_nit || 'CF',
      nombre: pedido.receptor_nombre || 'CONSUMIDOR FINAL',
      email: pedido.receptor_email || '',
    })
    // Si el pedido ya viene PAGADO (K2 QR Recurrente), preseleccionamos
    // tarjeta. El cajero solo confirma y se factura — el cobro ya pasó.
    if (pedido.pagado_at) {
      setMetodoPago('tarjeta')
    } else {
      setMetodoPago('pedidos_ya')
    }
    setPedidoEditando({ id: pedido.id, referencia: pedido.referencia })
    setMostrarBandeja(false)
    setMostrarCarritoMobile(true)
  }

  async function cancelarPedido(pedidoId, motivo) {
    const url = `/api/pos/pedidos/${pedidoId}?motivo=${encodeURIComponent(motivo || '')}`
    const r = await apiFetch(url, { method: 'DELETE' })
    const j = await r.json()
    if (!r.ok || !j.ok) {
      flashToast(`Error: ${j.error || 'no se pudo cancelar'}`)
      return
    }
    flashToast('Pedido cancelado')
    recargarPedidos()
  }

  // Marca pedido pickup como 'lista' y dispara email al cliente.
  // Solo aplica a origen=app_pickup en estado pendiente_entrega.
  async function marcarPedidoListo(pedidoId) {
    const r = await apiFetch(`/api/pos/pedidos/${pedidoId}/marcar-listo`, { method: 'POST' })
    const j = await r.json()
    if (!r.ok || !j.ok) {
      flashToast(`Error: ${j.error || 'no se pudo marcar como listo'}`)
      return
    }
    if (j.email?.ok) {
      flashToast('✅ Marcado listo · email enviado al cliente')
    } else if (j.email?.skipped) {
      flashToast('✅ Marcado listo (email no configurado)')
    } else if (j.email?.error) {
      flashToast(`✅ Marcado listo · email falló: ${j.email.error}`)
    } else {
      flashToast('✅ Pedido marcado como listo')
    }
    recargarPedidos()
  }

  // Cantidades por variant_id en el carrito — para mostrar badge en cards.
  // OJO: este hook DEBE estar antes de cualquier early return; si quedaba
  // despues, React tiraba "Rendered fewer hooks than expected" (error #300).
  const carritoPorVariant = useMemo(() => {
    const m = new Map()
    for (const l of carrito) {
      if (l.variant_id) m.set(l.variant_id, (m.get(l.variant_id) || 0) + Number(l.cantidad))
    }
    return m
  }, [carrito])

  if (perfil && !esAdmin && !esCajero) {
    return (
      <POSChrome perfil={perfil} kiosko={kiosko} turno={turno}>
        <Head><title>POS · Julia Bakery</title></Head>
        <div className="p-8 text-center text-sm text-gray-500">
          Solo administradores o cajeros pueden emitir facturas desde el POS.
        </div>
      </POSChrome>
    )
  }

  // Cajero sin turno cargado todavia (esperando redirect a /abrir-caja)
  if (esCajero && !turnoCargado) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-400">
        Verificando turno...
      </div>
    )
  }

  return (
    <POSChrome perfil={perfil} kiosko={kiosko} turno={turno}
      onMostrarHistorial={turno ? () => setMostrarHistorial(true) : null}
      onMostrarBandeja={turno && !esKioskoCajero ? () => { setMostrarBandeja(true); recargarPedidos() } : null}
      pedidosPendientesCount={pedidosPendientes.length}>
      <Head><title>Punto de Venta · Julia Bakery</title></Head>

      {/* Modal historial de facturas del turno actual */}
      {mostrarHistorial && perfil && turno && (
        <ModalHistorialFacturas
          perfil={perfil}
          turno={turno}
          emisor={emisor}
          onClose={() => setMostrarHistorial(false)}
          toast={flashToast}
        />
      )}

      {/* Modal nota/extras de un item del carrito */}
      {lineaConNota && (
        <ModalNotaItem
          descripcion={lineaConNota.descripcion}
          value={lineaConNota.value}
          onClose={() => setLineaConNota(null)}
          onSave={(texto) => {
            setLinea(lineaConNota.idx, { notas: texto })
            setLineaConNota(null)
          }}
        />
      )}

      {/* Modal: guardar carrito como pedido pendiente (Pedidos Ya) */}
      {mostrarGuardarPedido && (
        <ModalGuardarPedido
          totalEstimado={totales.total}
          cantItems={carrito.length}
          onClose={() => setMostrarGuardarPedido(false)}
          onGuardar={guardarPedidoActual}
        />
      )}

      {/* Modal: bandeja de pedidos pendientes — el cajero ve y maneja */}
      {mostrarBandeja && (
        <ModalBandejaPedidos
          pedidos={pedidosPendientes}
          cargando={cargandoPedidos}
          onClose={() => setMostrarBandeja(false)}
          onContinuar={continuarPedido}
          onCancelar={cancelarPedido}
          onMarcarListo={marcarPedidoListo}
          onRefresh={recargarPedidos}
        />
      )}

      {/* Modal: dividir pago en multiples metodos */}
      {mostrarDividirPago && (
        <ModalDividirPago
          totalVenta={totales.total}
          pagosInicial={pagosDivididos}
          onClose={() => setMostrarDividirPago(false)}
          onGuardar={(pagos) => {
            setPagosDivididos(pagos)
            setMostrarDividirPago(false)
          }}
        />
      )}

      {/* Modal QR Recurrente (kiosko) — pantalla completa para que el cliente
          escanee con su celular. Polling automático al estado. */}
      {modalQR && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-6 text-center overflow-y-auto">
          {modalQR.estado === 'esperando' && (
            <>
              <h2 className="text-4xl font-bold text-gray-900 mb-2">Escaneá con tu celular</h2>
              <p className="text-lg text-gray-600 mb-6">
                Abrí la cámara del teléfono y enfocá este código
              </p>
              <div className="bg-white border-4 border-julia-red rounded-3xl p-6 shadow-2xl mb-6">
                <QRCodeSVG value={modalQR.checkoutUrl} size={320} level="M" marginSize={2} />
              </div>
              <div className="bg-gray-50 border border-gray-200 rounded-2xl px-8 py-4 mb-4">
                <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">Total a pagar</div>
                <div className="text-5xl font-bold tabular-nums text-gray-900">
                  Q{modalQR.total.toFixed(2)}
                </div>
                <div className="text-sm text-gray-500 mt-1">Pedido {modalQR.referencia}</div>
              </div>
              <div className="text-gray-500 text-base mb-6">
                Tiempo restante:{' '}
                <span className="tabular-nums font-bold text-gray-900">
                  {String(Math.floor(modalQR.segsRestantes / 60)).padStart(2, '0')}
                  :
                  {String(modalQR.segsRestantes % 60).padStart(2, '0')}
                </span>
              </div>
              <button
                onClick={() => setModalQR(null)}
                className="text-julia-red underline text-base"
              >
                Cancelar
              </button>
            </>
          )}
          {modalQR.estado === 'pagado' && (
            <>
              <div className="text-8xl mb-4">✅</div>
              <h2 className="text-5xl font-bold text-green-600 mb-2">¡Pago recibido!</h2>
              <p className="text-xl text-gray-600">Generando tu factura...</p>
            </>
          )}
          {modalQR.estado === 'timeout' && (
            <>
              <div className="text-6xl mb-4">⏱️</div>
              <h2 className="text-3xl font-bold text-gray-900 mb-2">Se acabó el tiempo</h2>
              <p className="text-lg text-gray-600 mb-6">El QR expiró. Probá de nuevo.</p>
              <button
                onClick={() => setModalQR(null)}
                className="bg-julia-red text-white text-lg font-semibold px-8 py-4 rounded-xl"
              >
                Volver al menú
              </button>
            </>
          )}
        </div>
      )}

      {/* Modal "Pagar en caja" (kiosko) — muestra código gigante para que el
          cliente lo lleve a la P3 Mix donde el cajero cobra y factura. */}
      {modalCaja && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center p-6 text-center">
          <div className="inline-block bg-amber-100 text-amber-900 px-6 py-2 rounded-full text-sm font-semibold uppercase tracking-wider mb-6">
            💵 Pasá a la caja
          </div>
          <h2 className="text-3xl font-bold text-gray-900 mb-2">
            Llevá este código al mostrador
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            El cajero te va a cobrar y entregar la factura.
          </p>
          <div className="font-bold text-julia-red mb-6 tabular-nums tracking-wider"
            style={{ fontSize: '12rem', lineHeight: 1 }}>
            {modalCaja.referencia}
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-2xl px-8 py-4 mb-8">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">A pagar</div>
            <div className="text-5xl font-bold tabular-nums text-gray-900">
              Q{modalCaja.total.toFixed(2)}
            </div>
          </div>
          <div className="text-gray-500 text-base mb-3">
            Volvemos al menú en{' '}
            <span className="tabular-nums font-bold">{modalCaja.segsRestantes}s</span>
          </div>
          <button
            onClick={() => {
              setModalCaja(null)
              setCarrito([])
              setReceptor({ nit: 'CF', nombre: 'CONSUMIDOR FINAL', email: '', modo: 'cf' })
            }}
            className="text-julia-red underline text-base"
          >
            Listo, volver ahora
          </button>
        </div>
      )}

      {/* Toast breve - confirma reimpresion / errores menores */}
      {toastMsg && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-xs px-4 py-2 rounded-full shadow-lg">
          {toastMsg}
        </div>
      )}

      {/* Overlay mientras se esta autorizando la tarjeta con NeoPOS */}
      {neonetFase && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-5 border-4 border-julia-cream border-t-julia-red rounded-full animate-spin"></div>
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Procesando tarjeta</h2>
            <p className="text-4xl font-bold text-julia-red tabular-nums my-4">{fmtQ(neonetFase.monto)}</p>
            <p className="text-sm text-gray-500">
              {typeof window !== 'undefined' && window.JuliaPOS
                ? 'Insertá o acercá la tarjeta al lector y seguí las instrucciones del PIN pad.'
                : '⚙ Modo desarrollo (mock) — no hay dispositivo real conectado.'}
            </p>
            <p className="text-[10px] text-gray-300 mt-4 font-mono">idsale {neonetFase.idsale}</p>
          </div>
        </div>
      )}

      {/* Resultado de venta exitosa: pantalla completa con detalle */}
      {resultado && resultado.ok && (
        <PantallaExito resultado={resultado} payloadComanda={payloadComanda} onNueva={nuevaVenta} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_440px] gap-0 min-h-[calc(100vh-3.5rem)] bg-gray-50">

        {/* ============================================================
            COLUMNA IZQUIERDA — Catálogo de productos
           ============================================================ */}
        <div className="flex flex-col min-h-0">
          {/* Header sticky con búsqueda + filtros + título */}
          <div className="bg-white border-b border-gray-100 px-5 md:px-8 pt-5 pb-4 sticky top-0 z-20">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Punto de venta</h1>
                <p className="text-xs text-gray-400 mt-0.5">
                  Cada cobro emite factura FEL e impacta inventario
                </p>
              </div>
              <div className="text-right hidden sm:block">
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">Total venta</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">{fmtQ(totales.total)}</div>
              </div>
            </div>

            <div className="flex gap-2 items-center">
              <div className="relative flex-1">
                <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" />
                </svg>
                <input
                  type="text" placeholder="Buscar producto, SKU o variante..."
                  value={busqueda} onChange={e => setBusqueda(e.target.value)}
                  className="w-full pl-10 pr-3 py-3 text-base border border-gray-200 rounded-xl focus:outline-none focus:border-julia-red focus:ring-2 focus:ring-julia-red/10 transition-all"
                  autoFocus />
              </div>
              <select value={catSel} onChange={e => setCatSel(e.target.value)}
                className="text-sm border border-gray-200 rounded-xl px-3 py-3 bg-white focus:outline-none focus:border-julia-red min-w-[160px]">
                <option value="">Todas las categorías</option>
                {categoriasUnicas.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>

            {/* Pills de categorías para filtro rápido */}
            {!cargandoCat && categoriasUnicas.length > 0 && (
              <div className="flex gap-1.5 mt-3 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
                <button onClick={() => setCatSel('')}
                  className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                    catSel === ''
                      ? 'bg-julia-red text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}>
                  Todas
                </button>
                {categoriasUnicas.map(c => (
                  <button key={c} onClick={() => setCatSel(c)}
                    className={`flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${
                      catSel === c
                        ? 'bg-julia-red text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Grid de productos */}
          <div className="flex-1 overflow-y-auto px-5 md:px-8 py-5">
            {cargandoCat ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="bg-white border border-gray-100 rounded-2xl overflow-hidden animate-pulse">
                    <div className="aspect-square bg-gray-100" />
                    <div className="p-3 space-y-2">
                      <div className="h-3 bg-gray-100 rounded w-3/4" />
                      <div className="h-5 bg-gray-100 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : productosFiltrados.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <div className="text-6xl mb-3">🥖</div>
                <div className="text-base font-medium text-gray-600">
                  {productos.length === 0 ? 'Sin productos sincronizados desde Loyverse' : 'Sin resultados para tu búsqueda'}
                </div>
                <div className="text-xs mt-1">
                  {productos.length === 0 ? 'El cron de Loyverse corre cada 15 minutos' : 'Probá con otro término o categoría'}
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {productosFiltrados.map(p => {
                  const cantEnCarrito = carritoPorVariant.get(p.variant_id) || 0
                  return (
                    <button
                      key={p.variant_id}
                      onClick={() => agregarProducto(p)}
                      className={`group relative text-left bg-white border-2 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all active:scale-[0.98] ${
                        cantEnCarrito > 0 ? 'border-julia-red/40 ring-2 ring-julia-red/10' : 'border-gray-100 hover:border-julia-red/30'
                      }`}>
                      {/* Imagen / placeholder */}
                      <div className="aspect-square bg-gray-50 overflow-hidden relative">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt={p.item_name}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={(e) => { e.target.style.display = 'none' }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-julia-cream/40 to-julia-cream/10">
                            <span className="text-4xl font-bold text-julia-red/30 tracking-tight">
                              {(p.item_name || '?').slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                        )}
                        {/* Badge con cantidad en carrito */}
                        {cantEnCarrito > 0 && (
                          <div className="absolute top-2 right-2 bg-julia-red text-white text-xs font-bold rounded-full w-7 h-7 flex items-center justify-center shadow-lg">
                            {cantEnCarrito}
                          </div>
                        )}
                        {/* Categoría pill */}
                        {p.categoria && (
                          <div className="absolute top-2 left-2 bg-white/95 backdrop-blur-sm text-gray-600 text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wide">
                            {p.categoria}
                          </div>
                        )}
                      </div>
                      {/* Info */}
                      <div className="p-3">
                        <div className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 min-h-[2.5rem]">
                          {p.item_name}
                        </div>
                        {p.variant_name && (
                          <div className="text-[11px] text-gray-500 mt-1 truncate">{p.variant_name}</div>
                        )}
                        <div className="text-lg font-bold text-julia-red mt-2 tabular-nums">
                          {p.precio != null ? fmtQ(p.precio) : '—'}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* ============================================================
            COLUMNA DERECHA — Carrito + checkout
            Altura fija (viewport) en mobile y desktop → flex-col con
            scrollable interno y boton Cobrar sticky abajo.
           ============================================================ */}
        <div className={`bg-white border-t-2 lg:border-t-0 lg:border-l border-gray-100 flex flex-col h-screen lg:h-[calc(100vh-3.5rem)] lg:sticky lg:top-[3.5rem] ${mostrarCarritoMobile ? 'fixed inset-0 z-40 lg:static lg:inset-auto' : 'hidden lg:flex'}`}>
          {/* Header */}
          <div className="flex-shrink-0 px-5 py-3.5 border-b border-gray-100 flex items-center justify-between bg-white">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {pedidoEditando ? '📦 Facturando pedido' : 'Venta actual'}
              </h2>
              <p className="text-sm text-gray-500 font-medium">
                {pedidoEditando
                  ? <span className="text-amber-700 font-bold">{pedidoEditando.referencia}</span>
                  : (carrito.length === 0 ? 'Sin productos aún' : `${carrito.length} ${carrito.length === 1 ? 'línea' : 'líneas'}`)}
              </p>
            </div>
            {carrito.length > 0 && (
              <button onClick={() => setCarrito([])}
                className="text-sm font-semibold text-gray-500 hover:text-red-500 transition-colors px-3 py-2 rounded-lg hover:bg-red-50">
                Vaciar
              </button>
            )}
            <button onClick={() => setMostrarCarritoMobile(false)} className="lg:hidden text-gray-400 hover:text-gray-700 text-3xl ml-2">✕</button>
          </div>

          {/* TODO el contenido scrolleable (líneas + total + receptor + metodos) */}
          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 space-y-2">
            {carrito.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-5xl mb-3 opacity-50">🛒</div>
                <div className="text-sm font-medium text-gray-500">El carrito está vacío</div>
                <div className="text-xs mt-1">Tocá un producto para agregarlo</div>
              </div>
            ) : carrito.map((l, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-3 hover:border-gray-300 transition-colors shadow-xs">
                {/* Fila 1: descripcion + acciones (horizontales para no amontonar) */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-bold text-gray-900 leading-tight line-clamp-2">{l.descripcion}</div>
                    {l.notas && (
                      <div className="text-sm text-amber-800 italic font-medium mt-1.5 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                        ✏️ {l.notas}
                      </div>
                    )}
                  </div>
                  {/* Acciones lado a lado en lugar de apiladas */}
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => setLineaConNota({ idx: i, descripcion: l.descripcion, value: l.notas || '' })}
                      title={l.notas ? 'Editar nota' : 'Agregar nota / extras'}
                      className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
                        l.notas
                          ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                          : 'bg-gray-50 border border-gray-200 text-ink-subtle hover:text-julia-red hover:border-julia-red/40 hover:bg-white'
                      }`}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button onClick={() => quitarLinea(i)}
                      title="Quitar producto"
                      className="w-9 h-9 flex items-center justify-center bg-gray-50 border border-gray-200 text-ink-subtle hover:text-red-500 hover:border-red-200 hover:bg-white rounded-lg transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Fila 2: control de cantidad + precio unitario + subtotal */}
                <div className="flex items-center gap-2">
                  {/* Stepper cohesivo — un solo grupo, divisores 1px */}
                  <div className="flex items-center bg-white border border-gray-300 rounded-lg overflow-hidden h-11">
                    <button
                      onClick={() => setLinea(i, { cantidad: Math.max(1, Number(l.cantidad) - 1) })}
                      className="w-10 h-full text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors font-bold text-xl flex items-center justify-center">
                      −
                    </button>
                    <div className="min-w-[40px] px-2 h-full text-center text-base font-bold text-gray-900 tabular-nums border-x border-gray-200 flex items-center justify-center select-none bg-gray-50">
                      {l.cantidad}
                    </div>
                    <button
                      onClick={() => setLinea(i, { cantidad: Number(l.cantidad) + 1 })}
                      className="w-10 h-full text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-colors font-bold text-xl flex items-center justify-center">
                      +
                    </button>
                  </div>
                  <span className="text-sm text-ink-subtle">×</span>
                  <input type="number" step="any" min="0" value={l.precio_unitario}
                    onChange={e => setLinea(i, { precio_unitario: Number(e.target.value) || 0 })}
                    className="w-20 text-right text-base font-semibold px-2.5 h-11 bg-white border border-gray-300 rounded-lg tabular-nums font-mono focus:outline-none focus:border-julia-red" />
                  <span className="flex-1 text-base font-bold text-gray-900 tabular-nums font-mono text-right">
                    {fmtQ(Number(l.cantidad) * Number(l.precio_unitario))}
                  </span>
                </div>
              </div>
            ))}
            </div>

          {/* Totales */}
          <div className="border-t border-gray-100 px-5 py-4 bg-gradient-to-b from-gray-50/50 to-white space-y-2">
            <div className="flex justify-between text-base text-gray-600 font-medium">
              <span>Subtotal (sin IVA)</span><span className="tabular-nums">{fmtQ(totales.gravable)}</span>
            </div>
            <div className="flex justify-between text-base text-gray-600 font-medium">
              <span>IVA 12%</span><span className="tabular-nums">{fmtQ(totales.iva)}</span>
            </div>
            <div className="flex justify-between text-3xl font-bold text-gray-900 pt-3 mt-2 border-t-2 border-gray-200">
              <span>Total</span><span className="tabular-nums text-julia-red">{fmtQ(totales.total)}</span>
            </div>
          </div>

          {/* Receptor */}
          <div className="px-5 py-4 border-t border-gray-100 space-y-3">
            <div className="text-sm uppercase tracking-wider text-gray-600 font-bold">Receptor</div>
            <div className="flex gap-1.5 bg-gray-100 p-1.5 rounded-xl">
              <button onClick={() => setReceptorModo('cf')}
                className={`flex-1 text-sm py-3 rounded-lg font-bold transition-colors ${
                  receptor.modo === 'cf' ? 'bg-white shadow-sm text-julia-red' : 'text-gray-500'
                }`}>
                Cons. final
              </button>
              <button onClick={() => setReceptorModo('nit')}
                className={`flex-1 text-sm py-3 rounded-lg font-bold transition-colors ${
                  receptor.modo === 'nit' ? 'bg-white shadow-sm text-julia-red' : 'text-gray-500'
                }`}>
                Con NIT
              </button>
              <button onClick={() => setReceptorModo('dpi')}
                className={`flex-1 text-sm py-3 rounded-lg font-bold transition-colors ${
                  receptor.modo === 'dpi' ? 'bg-white shadow-sm text-julia-red' : 'text-gray-500'
                }`}>
                Con DPI
              </button>
            </div>
            {receptor.modo !== 'cf' && (
              <div className="space-y-2.5">
                <div className="relative">
                  <input type="text"
                    placeholder={receptor.modo === 'dpi' ? 'DPI (13 dígitos)' : 'NIT (sin guiones)'}
                    value={receptor.nit}
                    onChange={e => setReceptor(r => ({ ...r, nit: e.target.value }))}
                    onBlur={() => receptor.modo === 'dpi' ? consultarDpi(receptor.nit) : consultarNit(receptor.nit)}
                    className="w-full px-4 py-3.5 text-base font-mono border-2 border-gray-200 rounded-lg focus:outline-none focus:border-julia-red pr-11"
                    inputMode={receptor.modo === 'dpi' ? 'numeric' : 'text'}
                    maxLength={receptor.modo === 'dpi' ? 13 : 20}
                    autoComplete="off" />
                  {consultando ? (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 border-2 border-gray-200 border-t-julia-red rounded-full animate-spin" title="Consultando RTU…" />
                  ) : (
                    receptor.nit && ultimoNitConsultado.current === normalizarNit(receptor.nit) && receptor.nombre && !nitMsg && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-600" title="NIT confirmado en RTU">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )
                  )}
                </div>
                <input type="text" placeholder="Nombre receptor" value={receptor.nombre}
                  onChange={e => setReceptor(r => ({ ...r, nombre: e.target.value }))}
                  className="w-full px-4 py-3.5 text-base border-2 border-gray-200 rounded-lg focus:outline-none focus:border-julia-red" />
                <input type="email" placeholder="Email (opcional)" value={receptor.email}
                  onChange={e => setReceptor(r => ({ ...r, email: e.target.value }))}
                  className="w-full px-4 py-3.5 text-base border-2 border-gray-200 rounded-lg focus:outline-none focus:border-julia-red" />
                {nitMsg && (
                  <div className="text-sm text-amber-800 font-medium bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                    {nitMsg}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Método de pago — botones grandes para uso táctil */}
          <div className="px-5 py-4 border-t border-gray-100">
            <div className="text-sm uppercase tracking-wider text-gray-600 font-bold mb-3">Método de pago</div>

            {pagosDivididos ? (
              // Vista expandida del split — botones grandes para uso tactil
              <div className="space-y-3">
                <div className="bg-blue-50 border-2 border-blue-300 rounded-xl p-4 space-y-2.5">
                  <div className="text-sm uppercase tracking-wider text-blue-700 font-bold mb-1">
                    {pagosDivididos.length} pagos divididos
                  </div>
                  {pagosDivididos.map((p, i) => (
                    <div key={i} className="flex justify-between items-center text-lg bg-white rounded-lg px-3 py-2.5 border border-blue-200">
                      <span className="capitalize text-blue-900 font-bold">
                        {i + 1}. {String(p.metodo).replace('_', ' ')}
                      </span>
                      <span className="font-bold text-blue-900 tabular-nums text-lg">{fmtQ(p.monto)}</span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <button onClick={() => setMostrarDividirPago(true)}
                    className="text-base py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow">
                    Editar pagos
                  </button>
                  <button onClick={() => setPagosDivididos(null)}
                    className="text-base py-4 border-2 border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50">
                    Quitar
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2.5">
                  {metodosPagoDisponibles.map(m => (
                    <button key={m.id} onClick={() => setMetodoPago(m.id)}
                      className={`text-base py-5 rounded-xl font-bold transition-all ${
                        metodoPago === m.id
                          ? 'bg-julia-red text-white shadow-md ring-2 ring-julia-red/20'
                          : 'border-2 border-gray-200 text-gray-700 hover:border-julia-red/40 bg-white'
                      }`}>{m.label}</button>
                  ))}
                </div>
                {/* Calculadora de vuelto — solo cuando efectivo + hay items */}
                {metodoPago === 'efectivo' && carrito.length > 0 && (
                  <div className="mt-4 bg-white border-2 border-gray-200 rounded-2xl overflow-hidden shadow-sm">
                    {/* Header con label e input */}
                    <div className="px-4 pt-4 pb-3 bg-gradient-to-b from-gray-50 to-white">
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                          Efectivo recibido
                        </label>
                        {montoRecibido > 0 && (
                          <button
                            type="button"
                            onClick={() => setMontoRecibido(0)}
                            className="text-xs font-bold text-gray-400 hover:text-julia-red px-2 py-1 rounded-md hover:bg-red-50 transition-colors">
                            ✕ Limpiar
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-400 pointer-events-none">Q</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.01"
                          min="0"
                          value={montoRecibido === 0 ? '' : montoRecibido}
                          onChange={e => {
                            const v = parseFloat(e.target.value)
                            setMontoRecibido(Number.isFinite(v) && v >= 0 ? v : 0)
                          }}
                          placeholder="0.00"
                          className="w-full text-3xl font-bold tabular-nums pl-10 pr-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-julia-red focus:bg-white focus:ring-4 focus:ring-julia-red/10 text-right transition-all" />
                      </div>
                    </div>

                    {/* Botones de denominación — 3x2 grandes para tap */}
                    <div className="px-4 pb-3">
                      <div className="grid grid-cols-3 gap-2">
                        {[5, 10, 20, 50, 100, 200].map(d => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setMontoRecibido(prev => Math.round((Number(prev || 0) + d) * 100) / 100)}
                            className="py-3.5 text-base font-bold bg-white border-2 border-gray-200 rounded-xl text-gray-700 hover:border-julia-red hover:text-julia-red hover:bg-red-50 active:scale-95 transition-all shadow-sm">
                            + Q{d}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Display de resultado — banner grande prominente */}
                    {montoRecibido > 0 && (
                      <div className={`px-4 py-3.5 border-t-2 ${
                        montoRecibido >= totales.total
                          ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200'
                          : 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
                      }`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-xl ${
                              montoRecibido >= totales.total ? 'text-green-600' : 'text-red-600'
                            }`}>
                              {montoRecibido >= totales.total ? '✓' : '⚠'}
                            </span>
                            <span className={`text-sm font-bold uppercase tracking-wide ${
                              montoRecibido >= totales.total ? 'text-green-700' : 'text-red-700'
                            }`}>
                              {montoRecibido >= totales.total ? 'Vuelto a dar' : 'Falta cobrar'}
                            </span>
                          </div>
                          <span className={`text-3xl font-bold tabular-nums ${
                            montoRecibido >= totales.total ? 'text-green-700' : 'text-red-700'
                          }`}>
                            {fmtQ(Math.abs(Math.round((montoRecibido - totales.total) * 100) / 100))}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {/* Botón "Dividir pago" — primario y grande para Sunmi táctil */}
                {carrito.length > 0 && (
                  <button
                    onClick={() => setMostrarDividirPago(true)}
                    className="w-full mt-3 py-4 text-base font-bold rounded-xl bg-blue-50 text-blue-700 border-2 border-blue-200 hover:bg-blue-100 hover:border-blue-300 transition-colors flex items-center justify-center">
                    Dividir pago
                  </button>
                )}
              </>
            )}
          </div>

          {err && (
            <div className="px-5 pb-2">
              <div className="bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 text-sm text-red-700 flex items-start gap-2">
                <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{err}</span>
              </div>
            </div>
          )}
          </div>{/* fin del flex-1 overflow-y-auto */}

          {/* Botones cobrar / guardar pedido SIEMPRE visibles (fuera del scroll) — grandes para uso táctil */}
          <div className="flex-shrink-0 px-5 py-3 border-t border-gray-200 bg-white shadow-[0_-4px_12px_rgba(0,0,0,0.06)] space-y-2">
            <button onClick={cobrar} disabled={enviando || carrito.length === 0}
              className="w-full py-6 bg-julia-red text-white text-2xl font-bold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-700 active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-3">
              {enviando ? (
                <>
                  <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  <span>Procesando...</span>
                </>
              ) : (
                <>
                  <span>{pedidoEditando ? 'Facturar pedido' : 'Cobrar'}</span>
                  <span className="tabular-nums">{fmtQ(totales.total)}</span>
                </>
              )}
            </button>

            {/* Botones secundarios: Guardar pedido (modo normal) o Cancelar edicion (modo pedido) */}
            {pedidoEditando ? (
              <button
                onClick={() => {
                  if (confirm('Volver al modo de venta normal? Se descarta el carrito (el pedido sigue en la bandeja).')) {
                    nuevaVenta()
                  }
                }}
                className="w-full py-3 border-2 border-amber-300 text-amber-800 font-semibold rounded-xl hover:bg-amber-50 text-sm">
                Salir sin facturar (deja el pedido pendiente)
              </button>
            ) : (
              carrito.length > 0 && (
                <button onClick={() => setMostrarGuardarPedido(true)} disabled={enviando}
                  className="w-full py-3 border-2 border-amber-300 text-amber-800 font-semibold rounded-xl hover:bg-amber-50 text-base disabled:opacity-50 flex items-center justify-center gap-2">
                  📦 Guardar como pedido pendiente
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* FAB para abrir carrito en mobile */}
      {!mostrarCarritoMobile && carrito.length > 0 && (
        <button onClick={() => setMostrarCarritoMobile(true)}
          className="lg:hidden fixed bottom-6 right-6 z-30 bg-julia-red text-white rounded-2xl px-5 py-3.5 shadow-2xl flex items-center gap-3 font-medium active:scale-95 transition-transform">
          <div className="relative">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <span className="absolute -top-2 -right-2 bg-white text-julia-red text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {carrito.length}
            </span>
          </div>
          <span className="tabular-nums font-bold">{fmtQ(totales.total)}</span>
        </button>
      )}

      {/* Burbuja de soporte tecnico — Claude responde con contexto operativo */}
      <SoporteBubble
        perfil={perfil}
        obtenerContexto={() => ({
          pagina: 'pos',
          kiosko,
          turno_abierto: turno
            ? { id: turno.id, monto_apertura: turno.monto_apertura }
            : null,
          carrito_items: carrito.length,
          carrito_total: totales.total,
          carrito_descripciones: carrito.map(l => `${l.cantidad}× ${l.descripcion}`).slice(0, 5),
          receptor: receptor.nit !== 'CF'
            ? `${receptor.nit} - ${receptor.nombre}`
            : 'CONSUMIDOR FINAL',
          metodo_pago: metodoPago,
          ultimo_error: err || null,
          puente_nativo_disponible: typeof window !== 'undefined' && !!window.JuliaPOS,
        })}
      />
    </POSChrome>
  )
}

function PantallaExito({ resultado, payloadComanda, onNueva }) {
  const f = resultado.factura
  const comandaCreada = resultado.comanda?.ok && resultado.comanda?.comanda
  const [verDetalles, setVerDetalles] = useState(false)
  const [imprimiendoComanda, setImprimiendoComanda] = useState(false)
  const [comandaImpresa, setComandaImpresa] = useState(false)
  const tieneBridge = typeof window !== 'undefined' && window.JuliaPOS && window.JuliaPOS.printTicket

  async function imprimirComanda() {
    if (!payloadComanda || !tieneBridge) return
    setImprimiendoComanda(true)
    try {
      await window.JuliaPOS.printTicket(payloadComanda)
      setComandaImpresa(true)
    } catch (e) {
      console.warn('[POS] imprimirComanda fallo:', e?.message || e)
      // Permitir reintentar
      setComandaImpresa(false)
    } finally {
      setImprimiendoComanda(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-lg text-center flex flex-col items-center">
        {/* Check verde grande con halo */}
        <div className="relative mb-5">
          <div className="absolute inset-0 bg-emerald-200/50 rounded-full blur-2xl animate-pulse"></div>
          <div className="relative w-28 h-28 bg-emerald-500 rounded-full flex items-center justify-center shadow-2xl">
            <svg className="w-16 h-16 text-white" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>

        <h2 className="text-3xl font-bold text-gray-900 mb-1">Venta certificada</h2>
        <p className="text-sm text-gray-500 mb-4">UUID SAT confirmado por Infile</p>

        {/* Total prominente */}
        <div className="text-6xl font-bold text-julia-red tabular-nums my-3 leading-none">
          {'Q ' + Number(f.total).toLocaleString('es-GT', { minimumFractionDigits: 2 })}
        </div>

        {/* Status chips */}
        <div className="flex flex-wrap gap-2 my-5 justify-center">
          <StatusChip
            ok={resultado.descuento?.pt?.ok}
            label="Inventario"
            detail={resultado.descuento?.pt?.ok
              ? `${resultado.descuento.pt.lineas_procesadas} líneas`
              : '⚠'} />
          <StatusChip
            ok={resultado.asiento?.ok}
            label="Asiento"
            detail={resultado.asiento?.ok ? `#${resultado.asiento.numero}` : '⚠'} />
          {comandaCreada && <StatusChip ok={true} label="Barra" detail="enviada" />}
        </div>

        {/* Botón Imprimir comanda — solo si hay payload y wrapper presente */}
        {payloadComanda && tieneBridge && (
          <button
            onClick={imprimirComanda}
            disabled={imprimiendoComanda}
            className={`w-full max-w-sm block px-8 py-5 mb-3 text-lg font-bold rounded-2xl active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-3 ${
              comandaImpresa
                ? 'bg-emerald-50 text-emerald-700 border-2 border-emerald-200 hover:bg-emerald-100'
                : 'bg-amber-500 text-white hover:bg-amber-600 ring-4 ring-amber-200/50'
            } ${imprimiendoComanda ? 'opacity-60 cursor-wait' : ''}`}>
            {imprimiendoComanda ? (
              <>
                <div className="w-6 h-6 border-2 border-white/40 border-t-white rounded-full animate-spin"></div>
                <span>Imprimiendo…</span>
              </>
            ) : comandaImpresa ? (
              <>
                <span className="text-2xl">✓</span>
                <span>Comanda impresa — repetir</span>
              </>
            ) : (
              <>
                <span className="text-2xl">🖨️</span>
                <span>Imprimir comanda</span>
              </>
            )}
          </button>
        )}

        {/* Botón Nueva venta grande, centrado */}
        <button onClick={onNueva}
          className="w-full max-w-sm block px-8 py-5 mt-2 bg-julia-red text-white text-lg font-bold rounded-2xl hover:bg-red-700 active:scale-[0.98] transition-all shadow-xl flex items-center justify-center gap-3">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Nueva venta
        </button>

        {/* Toggle ver detalles */}
        <button
          onClick={() => setVerDetalles(v => !v)}
          className="mt-5 text-xs text-gray-400 hover:text-gray-700 flex items-center gap-1">
          {verDetalles ? '▴ Ocultar detalles' : '▾ Ver detalles SAT, NIT, voucher'}
        </button>

        {verDetalles && (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 w-full max-w-sm space-y-2 mt-3 text-left">
            <Row k="Receptor" v={`${f.receptor_nit} — ${f.receptor_nombre}`} />
            <Row k="Pago" v={<span className="capitalize">{f.metodo_pago}</span>} />
            {resultado.neonet && (
              <>
                <div className="border-t border-gray-100 my-1.5"></div>
                <Row k="Tarjeta" v={<span className="font-mono text-xs">{resultado.neonet.pan_masked || '—'}</span>} />
                <Row k="Autoriz." v={<span className="font-mono text-xs">{resultado.neonet.authorization_code || '—'}</span>} />
                {resultado.neonet.origen !== 'prod' && (
                  <Row k="" v={<span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-bold">{resultado.neonet.origen}</span>} />
                )}
              </>
            )}
            <div className="border-t border-gray-100 my-1.5"></div>
            <Row k="UUID SAT" v={<span className="font-mono text-[9px] break-all">{f.uuid_sat}</span>} />
            <Row k="Serie/Núm" v={<span className="font-mono text-xs">{f.serie_sat || '—'} / {f.numero_sat || '—'}</span>} />
          </div>
        )}
      </div>
    </div>
  )
}

function Row({ k, v }) {
  return (
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-xs uppercase tracking-wider text-gray-400 font-medium flex-shrink-0">{k}</span>
      <span className="text-sm text-gray-800 text-right break-words">{v}</span>
    </div>
  )
}

function StatusChip({ ok, label, detail }) {
  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${
      ok
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-amber-50 border-amber-200 text-amber-700'
    }`}>
      <span className="text-xs">{ok ? '✓' : '⚠'}</span>
      <span className="text-xs font-medium">{label}:</span>
      <span className="text-xs">{detail}</span>
    </div>
  )
}
