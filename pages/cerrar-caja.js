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
      supabase.from('perfiles').select('id, nombre_completo, email, rol').eq('id', session.user.id).single(),
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

  const esperado = data?.esperado ?? 0
  const apertura = Number(data?.turno?.monto_apertura) || 0
  const ventasEf = Number(data?.desglose?.ventas_efectivo) || 0
  const conteoNum = Number(conteo)
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
      body: JSON.stringify({ conteo_efectivo_cierre: conteoNum, observacion_cierre: obs }),
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
    return (
      <>
        <Head><title>Caja cerrada · Julia Bakery</title></Head>
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 w-full max-w-sm text-center">
            <div className="text-5xl mb-3">✓</div>
            <h1 className="text-2xl font-semibold text-emerald-700 mb-1">Caja cerrada</h1>
            <p className="text-xs text-gray-400 mb-5">El turno ha sido cerrado correctamente.</p>

            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-2 text-left mb-4">
              <Row k="Cajero" v={<span className="font-medium">{perfil?.nombre_completo || '—'}</span>} />
              <Row k="Apertura" v={fmtQ(resultado.monto_apertura)} />
              <Row k="Ventas efectivo" v={fmtQ(resultado.ventas_efectivo)} />
              <Row k="Ventas tarjeta" v={fmtQ(resultado.ventas_tarjeta)} muted />
              <Row k="Ventas transferencia" v={fmtQ(resultado.ventas_transferencia)} muted />
              <Row k="Ventas Pedidos Ya" v={fmtQ(resultado.ventas_pedidos_ya)} muted />
              <Row k="Ventas otro" v={fmtQ(resultado.ventas_otro)} muted />
              <hr className="border-gray-200" />
              <Row k="Total ventas" v={<span className="font-semibold">{fmtQ(resultado.ventas_total)}</span>} />
              <Row k="Esperado en caja" v={fmtQ(resultado.monto_cierre_esperado)} />
              <Row k="Contado" v={fmtQ(resultado.conteo_efectivo_cierre)} />
              <hr className="border-gray-200" />
              <Row k="Diferencia" v={
                <span className={`font-semibold ${
                  dif === 0 ? 'text-emerald-600' : dif > 0 ? 'text-amber-600' : 'text-red-600'
                }`}>
                  {dif > 0 ? '+' : ''}{fmtQ(dif)}
                </span>
              } />
            </div>

            {/* Estado del print del ticket de cierre */}
            {printMsg && (
              <div className={`text-xs rounded-lg px-3 py-2 mb-3 ${
                printMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
              }`}>
                {printMsg.ok
                  ? '🖨 Ticket de cierre impreso'
                  : `Impresión: ${printMsg.mensaje}`}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mb-2">
              <button onClick={reimprimir} disabled={reimprimiendo}
                className="py-4 border-2 border-gray-200 text-base text-gray-700 font-semibold rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {reimprimiendo ? 'Imprimiendo...' : 'Reimprimir'}
              </button>
              <button onClick={salir}
                className="py-4 bg-julia-red text-white text-base font-semibold rounded-lg hover:bg-red-700">
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-6 w-full max-w-md">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Cerrar caja</h1>
          <p className="text-xs text-gray-400 mb-5">
            Abierto: {new Date(data.turno.fecha_apertura).toLocaleString('es-GT')}
          </p>

          {/* Desglose */}
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-2 mb-5">
            <Row k="Apertura" v={fmtQ(apertura)} />
            <Row k="Ventas efectivo" v={fmtQ(ventasEf)} />
            <Row k="Ventas tarjeta" v={fmtQ(data.desglose.ventas_tarjeta)} muted />
            <Row k="Ventas transferencia" v={fmtQ(data.desglose.ventas_transferencia)} muted />
            <Row k="Ventas Pedidos Ya" v={fmtQ(data.desglose.ventas_pedidos_ya)} muted />
            <Row k="Ventas otro" v={fmtQ(data.desglose.ventas_otro)} muted />
            <hr className="border-gray-200" />
            <Row k="Esperado en caja" v={<span className="font-semibold tabular-nums text-base">{fmtQ(esperado)}</span>} />
            <div className="text-[10px] text-gray-400 pt-1">
              Esperado = apertura + ventas en efectivo. Las ventas con tarjeta/transferencia
              no afectan el efectivo de la caja.
            </div>
          </div>

          {/* Conteo */}
          <div className="mb-3">
            <label className="block text-sm text-gray-600 font-medium mb-1.5">Efectivo contado en caja</label>
            <input type="number" step="any" min="0" value={conteo} onChange={e => setConteo(e.target.value)}
              inputMode="decimal" autoFocus
              className="w-full text-3xl text-right tabular-nums px-4 py-4 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-julia-red"
              placeholder="0.00" />
          </div>

          {/* Diferencia en vivo */}
          {diferencia !== null && (
            <div className={`rounded-xl px-4 py-3 mb-3 text-base flex justify-between font-medium ${
              diferencia === 0 ? 'bg-emerald-50 text-emerald-700' :
              diferencia > 0   ? 'bg-amber-50 text-amber-700' :
                                 'bg-red-50 text-red-700'
            }`}>
              <span>Diferencia</span>
              <span className="font-bold tabular-nums">
                {diferencia > 0 ? '+' : ''}{fmtQ(diferencia)}
              </span>
            </div>
          )}

          <div className="mb-4">
            <label className="block text-sm text-gray-600 font-medium mb-1.5">Observación (opcional)</label>
            <textarea value={obs} onChange={e => setObs(e.target.value)} rows={2}
              className="w-full px-3 py-3 text-base border-2 border-gray-200 rounded-xl focus:outline-none focus:border-julia-red"
              placeholder={diferencia !== null && diferencia !== 0 ? 'Explicá la diferencia...' : ''} />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 text-sm text-red-700 mb-3">{error}</div>
          )}

          <div className="flex gap-2">
            <button onClick={() => router.push('/pos')}
              className="flex-1 py-5 border-2 border-gray-200 text-base font-semibold text-gray-700 rounded-xl hover:bg-gray-50">
              Cancelar
            </button>
            <button onClick={confirmar} disabled={enviando || conteo === ''}
              className="flex-1 py-5 bg-julia-red text-white text-base font-semibold rounded-xl disabled:opacity-50 hover:bg-red-700">
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
      <span className={muted ? 'text-gray-400' : 'text-gray-600'}>{k}</span>
      <span className={`tabular-nums ${muted ? 'text-gray-400' : 'text-gray-800'}`}>{v}</span>
    </div>
  )
}
