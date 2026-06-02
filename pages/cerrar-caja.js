// pages/cerrar-caja.js
// Muestra desglose del turno (apertura + ventas) y pide conteo fisico.
// Calcula diferencia en vivo y permite confirmar el cierre.
// Al cerrar exitosamente, imprime un ticket de cierre con el desglose
// completo (cajero, fechas, ventas por metodo, total, conteo, diferencia)
// usando el mismo bridge nativo que ya usa /pos para los tickets de venta.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const fmtQ = (n) => 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Arma el payload de impresion para un cierre de turno. Reusa el contrato del
// bridge `window.JuliaPOS.printTicket()` que el wrapper ya implementa para
// facturas: el cajero ve el ticket como un comprobante operativo (no FEL).
//
// Cuando se actualice el wrapper a detectar `esCierreTurno: true`, podra usar
// un layout especifico (titulos distintos, sin UUID SAT, etc.). Mientras tanto
// se imprime con el layout de factura, mapeando las lineas del desglose como
// items — sale legible aunque no sea bonito.
function armarPayloadCierre({ perfil, turno, emisor }) {
  const e = emisor || {}
  const apertura = Number(turno.monto_apertura) || 0
  const ventasEf = Number(turno.ventas_efectivo) || 0
  const ventasTj = Number(turno.ventas_tarjeta) || 0
  const ventasTr = Number(turno.ventas_transferencia) || 0
  const ventasPY = Number(turno.ventas_pedidos_ya) || 0
  const ventasOt = Number(turno.ventas_otro) || 0
  const ventasTotal = Number(turno.ventas_total) || 0
  const cantFac = Number(turno.cantidad_facturas) || 0
  const esperado = Number(turno.monto_cierre_esperado) || 0
  const contado = Number(turno.conteo_efectivo_cierre) || 0
  const diff = Number(turno.diferencia) || 0

  // Lineas del desglose presentadas como "items" de factura. El wrapper las
  // imprime una por linea con descripcion + monto a la derecha.
  const items = [
    { descripcion: 'Apertura de caja',     cantidad: '1', precioUnitario: apertura, subtotal: apertura },
    { descripcion: '— Ventas en efectivo', cantidad: '', precioUnitario: 0, subtotal: ventasEf },
    { descripcion: '— Ventas con tarjeta', cantidad: '', precioUnitario: 0, subtotal: ventasTj },
    { descripcion: '— Transferencia',      cantidad: '', precioUnitario: 0, subtotal: ventasTr },
    { descripcion: '— Pedidos Ya',         cantidad: '', precioUnitario: 0, subtotal: ventasPY },
    { descripcion: '— Otro',               cantidad: '', precioUnitario: 0, subtotal: ventasOt },
    { descripcion: `Total ventas (${cantFac} facturas)`, cantidad: '', precioUnitario: 0, subtotal: ventasTotal },
    { descripcion: 'Efectivo esperado',    cantidad: '', precioUnitario: 0, subtotal: esperado },
    { descripcion: 'Efectivo contado',     cantidad: '', precioUnitario: 0, subtotal: contado },
    { descripcion: `Diferencia ${diff === 0 ? '(cuadrado)' : diff > 0 ? '(sobrante)' : '(faltante)'}`,
      cantidad: '', precioUnitario: 0, subtotal: diff },
  ]

  const direccion = [
    e.direccion,
    [e.municipio, e.departamento].filter(Boolean).join(', '),
  ].filter(Boolean).join(' ')

  return {
    // Marcador para versiones futuras del wrapper que tengan layout dedicado
    esCierreTurno: true,
    tipo: 'cierre_turno',

    // EMISOR / Encabezado del comprobante
    merchantName: e.nombre_comercial || 'Julia Bakery',
    razonSocial: 'CIERRE DE TURNO',  // titulo grande del ticket
    direccion: direccion || null,
    nitEmisor: e.nit_emisor || null,

    // "Receptor" = cajero
    receptorNit: '—',
    receptorNombre: perfil?.nombre_completo || 'Cajero',

    // Fechas relevantes
    fecha: new Date(turno.fecha_cierre || Date.now()).toLocaleString('es-GT'),
    fechaApertura: new Date(turno.fecha_apertura).toLocaleString('es-GT'),
    cajeroNombre: perfil?.nombre_completo || null,
    metodoPago: null,

    // Items con el desglose
    items,

    // Totales — el wrapper espera esto. Lo dejamos en cero para no confundir
    // con totales de factura. El total que importa va en el desglose.
    totalGravado: 0,
    iva: 0,
    total: ventasTotal,

    // Sin certificacion SAT
    uuidSat: null,
    serieSat: null,
    numeroSat: null,
    certificadorNombre: null,
    certificadorNit: null,
    fechaCertificacion: null,

    textoFooter: `Turno #${turno.id?.slice(0, 8) || ''} · Cerrado ${new Date(turno.fecha_cierre || Date.now()).toLocaleString('es-GT')}`,
  }
}

// Intenta imprimir el cierre. Devuelve {ok, mensaje} (best-effort: si no hay
// wrapper o falla la termica, no rompe el flujo de cierre).
async function imprimirCierre(payload) {
  try {
    if (typeof window === 'undefined' || !window.JuliaPOS || !window.JuliaPOS.printTicket) {
      return { ok: false, mensaje: 'Sin bridge nativo (no se imprime fuera del wrapper Sunmi)' }
    }
    const r = await window.JuliaPOS.printTicket(payload)
    return { ok: !!r?.ok, mensaje: r?.error_message || (r?.ok ? 'Impreso' : 'La termica no respondio') }
  } catch (e) {
    return { ok: false, mensaje: e?.message || 'Excepcion al imprimir' }
  }
}

export default function CerrarCaja({ session }) {
  const router = useRouter()
  const [data, setData] = useState(null)
  const [perfil, setPerfil] = useState(null)
  const [emisor, setEmisor] = useState(null)
  const [conteo, setConteo] = useState('')
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState(null)
  const [printMsg, setPrintMsg] = useState(null)   // estado de la impresion
  const [reimprimiendo, setReimprimiendo] = useState(false)

  useEffect(() => {
    if (!session) { router.push('/cajero-login'); return }
    cargar()
  }, [session])

  async function cargar() {
    // En paralelo: turno actual + perfil del cajero + datos del emisor (para el ticket)
    const [rT, rP, rE] = await Promise.all([
      apiFetch('/api/turnos/actual'),
      supabase.from('perfiles').select('id, nombre_completo, email, rol, es_kiosko').eq('id', session.user.id).single(),
      apiFetch('/api/fel/emisor').then(r => r.json()).catch(() => ({})),
    ])
    const j = await rT.json()
    if (!j.turno) {
      // No hay turno abierto — ir al login de apertura
      router.replace('/abrir-caja')
      return
    }
    setData(j)
    setPerfil(rP.data || { id: session.user.id, email: session.user.email })
    setEmisor(rE?.emisor || null)
  }

  const esKiosko = !!perfil?.es_kiosko
  const esperado = data?.esperado ?? 0
  const apertura = Number(data?.turno?.monto_apertura) || 0
  const ventasEf = Number(data?.desglose?.ventas_efectivo) || 0
  // En kiosko forzamos conteo=0 (no hay caja física). En atendido lee del input.
  const conteoNum = esKiosko ? 0 : Number(conteo)
  const diferencia = Number.isFinite(conteoNum) ? Math.round((conteoNum - esperado) * 100) / 100 : null

  async function confirmar() {
    setError('')
    if (!Number.isFinite(conteoNum) || conteoNum < 0) {
      setError('Ingresá el monto contado (>= 0)')
      return
    }
    setEnviando(true)
    const r = await apiFetch('/api/turnos/cerrar', {
      method: 'POST',
      body: JSON.stringify({
        conteo_efectivo_cierre: conteoNum,
        observacion_cierre: esKiosko
          ? (obs || 'Cierre kiosko · sin caja física (conteo Q0)')
          : obs,
      }),
    })
    const j = await r.json()
    setEnviando(false)
    if (!r.ok) { setError(j.error || 'Error cerrando caja'); return }
    setResultado(j.turno)

    // Auto-print del ticket de cierre — best effort. Si falla, queda el boton
    // "Reimprimir" en la pantalla de resultado y el cajero puede reintentar.
    const payload = armarPayloadCierre({ perfil, turno: j.turno, emisor })
    const pr = await imprimirCierre(payload)
    setPrintMsg(pr)
  }

  async function reimprimir() {
    if (!resultado) return
    setReimprimiendo(true)
    const payload = armarPayloadCierre({ perfil, turno: resultado, emisor })
    const pr = await imprimirCierre(payload)
    setPrintMsg(pr)
    setReimprimiendo(false)
  }

  async function salir() {
    await supabase.auth.signOut()
    router.push('/cajero-login')
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400 text-sm">
        Cargando...
      </div>
    )
  }

  if (resultado) {
    const dif = Number(resultado.diferencia)
    const difColor = dif === 0 ? 'var(--success)' : dif > 0 ? 'var(--warning)' : 'var(--danger)'
    const difBg    = dif === 0 ? 'var(--success-soft)' : dif > 0 ? 'var(--warning-soft)' : 'var(--danger-soft)'
    return (
      <>
        <Head><title>Caja cerrada · Julia Bakery</title></Head>
        <div className="min-h-screen bg-surface-2 flex items-center justify-center p-6">
          <div className="card-julia shadow-md p-6 w-full max-w-sm text-center animate-slide-up">
            <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-3" style={{ background: 'var(--success-soft)' }}>
              <svg className="w-7 h-7" fill="none" stroke="var(--success)" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-1">Caja cerrada</h1>
            <p className="text-sm text-ink-subtle mb-5">El turno ha sido cerrado correctamente</p>

            <div className="bg-surface-2 border border-gray-100 rounded-xl p-4 space-y-2 text-left mb-4">
              <Row k="Cajero" v={<span className="font-semibold">{perfil?.nombre_completo || '—'}</span>} />
              <Row k="Apertura" v={fmtQ(resultado.monto_apertura)} />
              <Row k="Ventas efectivo" v={fmtQ(resultado.ventas_efectivo)} />
              <Row k="Ventas tarjeta" v={fmtQ(resultado.ventas_tarjeta)} muted />
              <Row k="Ventas transferencia" v={fmtQ(resultado.ventas_transferencia)} muted />
              <Row k="Ventas Pedidos Ya" v={fmtQ(resultado.ventas_pedidos_ya)} muted />
              <Row k="Ventas otro" v={fmtQ(resultado.ventas_otro)} muted />
              <hr className="border-gray-100" />
              <Row k="Total ventas" v={<span className="font-bold">{fmtQ(resultado.ventas_total)}</span>} />
              <Row k="Esperado en caja" v={fmtQ(resultado.monto_cierre_esperado)} />
              <Row k="Contado" v={fmtQ(resultado.conteo_efectivo_cierre)} />
              <hr className="border-gray-100" />
              <div className="flex justify-between items-center text-sm">
                <span className="font-medium text-gray-700">Diferencia</span>
                <span className="font-bold font-mono tabular-nums" style={{ color: difColor }}>
                  {dif > 0 ? '+' : ''}{fmtQ(dif)}
                </span>
              </div>
            </div>

            {printMsg && (
              <div className="text-2xs font-medium rounded-lg px-3 py-2 mb-3 uppercase tracking-wider"
                style={{ background: printMsg.ok ? 'var(--success-soft)' : 'var(--warning-soft)', color: printMsg.ok ? 'var(--success)' : 'var(--warning)' }}>
                {printMsg.ok ? '🖨  Ticket de cierre impreso' : `Impresión: ${printMsg.mensaje}`}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <button onClick={reimprimir} disabled={reimprimiendo}
                className="btn-secundario justify-center py-3.5">
                {reimprimiendo ? 'Imprimiendo...' : 'Reimprimir'}
              </button>
              <button onClick={salir} className="btn-primario justify-center py-3.5">
                Salir
              </button>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Head><title>Cerrar caja · Julia Bakery</title></Head>
      <div className="min-h-screen bg-surface-2 flex items-center justify-center p-6">
        <div className="card-julia shadow-md p-6 w-full max-w-md animate-slide-up">
          {/* Header */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-julia-red/10 text-julia-red flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7M3 10h18M7 15h.01M11 15h2M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-gray-900 leading-tight">Cerrar caja</h1>
              <p className="text-2xs text-ink-subtle font-mono">
                Abierto: {new Date(data.turno.fecha_apertura).toLocaleString('es-GT')}
              </p>
            </div>
          </div>

          {/* Desglose */}
          <div className="bg-surface-2 border border-gray-100 rounded-xl p-4 space-y-2 mb-5">
            <div className="label-tech mb-2">Desglose del turno</div>
            <Row k="Apertura" v={fmtQ(apertura)} />
            <Row k="Ventas efectivo" v={fmtQ(ventasEf)} />
            <Row k="Ventas tarjeta" v={fmtQ(data.desglose.ventas_tarjeta)} muted />
            <Row k="Ventas transferencia" v={fmtQ(data.desglose.ventas_transferencia)} muted />
            <Row k="Ventas Pedidos Ya" v={fmtQ(data.desglose.ventas_pedidos_ya)} muted />
            <Row k="Ventas otro" v={fmtQ(data.desglose.ventas_otro)} muted />
            <hr className="border-gray-100" />
            <div className="flex justify-between items-center text-sm">
              <span className="font-semibold text-gray-700">Esperado en caja</span>
              <span className="font-bold font-mono tabular-nums text-base">{fmtQ(esperado)}</span>
            </div>
            <div className="text-2xs text-ink-subtle pt-1 leading-relaxed">
              Esperado = apertura + ventas en efectivo. Las ventas con tarjeta y transferencia
              no afectan el efectivo de la caja.
            </div>
          </div>

          {/* Conteo de efectivo — oculto en kiosko (no hay caja física) */}
          {esKiosko ? (
            <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 mb-3 text-sm text-purple-900 leading-relaxed">
              Este kiosko no maneja efectivo. El cierre se registra con conteo
              <strong> Q 0.00</strong> y diferencia <strong>Q 0.00</strong>.
            </div>
          ) : (
            <div className="mb-3">
              <label className="label-tech block mb-1.5">Efectivo contado en caja</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-subtle font-mono text-base">Q</span>
                <input type="number" step="any" min="0" value={conteo} onChange={e => setConteo(e.target.value)}
                  inputMode="decimal" autoFocus
                  className="input pl-10 text-2xl font-bold text-right tabular-nums py-4 font-mono"
                  placeholder="0.00" />
              </div>
            </div>
          )}

          {/* Diferencia en vivo */}
          {!esKiosko && diferencia !== null && (
            <div className="rounded-xl px-4 py-3 mb-3 flex justify-between items-center font-medium"
              style={{
                background: diferencia === 0 ? 'var(--success-soft)' : diferencia > 0 ? 'var(--warning-soft)' : 'var(--danger-soft)',
                borderLeft: `3px solid ${diferencia === 0 ? 'var(--success)' : diferencia > 0 ? 'var(--warning)' : 'var(--danger)'}`,
              }}>
              <span className="text-sm font-semibold" style={{ color: diferencia === 0 ? 'var(--success)' : diferencia > 0 ? 'var(--warning)' : 'var(--danger)' }}>
                Diferencia
              </span>
              <span className="font-bold font-mono tabular-nums text-lg" style={{ color: diferencia === 0 ? 'var(--success)' : diferencia > 0 ? 'var(--warning)' : 'var(--danger)' }}>
                {diferencia > 0 ? '+' : ''}{fmtQ(diferencia)}
              </span>
            </div>
          )}

          <div className="mb-4">
            <label className="label-tech block mb-1.5">Observación (opcional)</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
              className="input resize-none"
              placeholder={diferencia !== null && diferencia !== 0 ? 'Explicá la diferencia...' : ''} />
          </div>

          {error && (
            <div className="rounded-lg px-3 py-2.5 text-sm font-medium mb-3"
              style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
              {error}
            </div>
          )}

          <div className="flex gap-2.5">
            <button onClick={() => router.push('/pos')}
              className="btn-secundario flex-1 justify-center py-3.5 text-base">
              Cancelar
            </button>
            <button onClick={confirmar} disabled={enviando || (!esKiosko && conteo === '')}
              className="btn-primario flex-1 justify-center py-3.5 text-base">
              {enviando ? 'Cerrando...' : 'Confirmar cierre'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function Row({ k, v, muted }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className={`${muted ? 'text-ink-subtle' : 'text-gray-700'} font-medium`}>{k}</span>
      <span className={`font-mono tabular-nums ${muted ? 'text-ink-subtle' : 'text-gray-900'}`}>{v}</span>
    </div>
  )
}
