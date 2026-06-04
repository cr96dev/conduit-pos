// pages/pickup/qr/[id].js
//
// Pantalla del K2 mini que muestra el QR de Recurrente para que el cliente
// pague desde su propio celular. K2 hace polling al estado del pedido cada
// 3 segs. Cuando detecta cambio a 'pendiente_entrega' (pago confirmado),
// redirige automáticamente a /pickup/exito/[id] que se encarga de imprimir
// el ticket en la térmica del K2 y reset.
//
// Flujo:
//   1. Mount: lee order_id del query, llama POST /api/pickup/recurrente-checkout
//   2. Recibe checkout_url, renderiza QR
//   3. Polling cada 3s a /api/pickup/pedido-status/[id]
//   4. Cuando estado === 'pendiente_entrega' → router.replace('/pickup/exito/[id]?modo=k2')
//   5. Botón "Cancelar" → cancela pedido y vuelve a /pickup/pago

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { QRCodeSVG } from 'qrcode.react'
import PickupShell from '../../../components/pickup/PickupShell'
import { useK2Mode } from '../../../lib/pickup/k2-mode'

const POLL_MS = 3000
const TIMEOUT_MIN = 10  // si tras 10 mins no paga, autocancelamos

export default function PickupQR() {
  const router = useRouter()
  const { id } = router.query
  const isK2 = useK2Mode()

  const [estado, setEstado] = useState('cargando')   // cargando | esperando | pagado | error | timeout
  const [checkoutUrl, setCheckoutUrl] = useState('')
  const [pedido, setPedido] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [segsRestantes, setSegsRestantes] = useState(TIMEOUT_MIN * 60)

  const pollRef = useRef(null)
  const tickRef = useRef(null)

  // Paso 1: crear checkout Recurrente al cargar la página
  useEffect(() => {
    if (!id || typeof id !== 'string') return
    let cancelado = false
    ;(async () => {
      try {
        const r = await fetch('/api/pickup/recurrente-checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: id }),
        })
        const j = await r.json()
        if (cancelado) return
        if (!r.ok || !j.ok || !j.checkout_url) {
          setEstado('error')
          setErrorMsg(j.error || 'No pudimos iniciar el cobro')
          return
        }
        setCheckoutUrl(j.checkout_url)
        setEstado('esperando')
      } catch (e) {
        if (!cancelado) {
          setEstado('error')
          setErrorMsg('Error de red al conectar con la pasarela')
        }
      }
    })()
    return () => { cancelado = true }
  }, [id])

  // Paso 2: polling al estado del pedido + countdown
  useEffect(() => {
    if (estado !== 'esperando' || !id) return

    async function checkEstado() {
      try {
        const r = await fetch(`/api/pickup/pedido-status/${id}`, { cache: 'no-store' })
        const j = await r.json()
        if (!r.ok || !j.ok) return
        setPedido({ referencia: j.referencia, total: j.total })
        if (j.estado === 'pendiente_entrega' || j.estado === 'lista') {
          setEstado('pagado')
          clearInterval(pollRef.current)
          // Pequeño delay para mostrar la animación verde antes de avanzar
          setTimeout(() => {
            router.replace(`/pickup/exito/${id}?modo=k2&pagado=1`)
          }, 1500)
        }
      } catch (_) {
        // Silenciar errores de red transitorios — el siguiente tick reintenta
      }
    }

    pollRef.current = setInterval(checkEstado, POLL_MS)
    checkEstado()  // primer check inmediato

    // Timeout countdown
    tickRef.current = setInterval(() => {
      setSegsRestantes(prev => {
        const next = prev - 1
        if (next <= 0) {
          setEstado('timeout')
          clearInterval(pollRef.current)
          clearInterval(tickRef.current)
        }
        return next
      })
    }, 1000)

    return () => {
      clearInterval(pollRef.current)
      clearInterval(tickRef.current)
    }
  }, [estado, id, router])

  function cancelar() {
    // En MVP solo navegamos atrás — el pedido queda como pendiente_pago
    // huérfano (limpiado por cron). Si querés que se cancele activamente,
    // agregamos un DELETE /api/pickup/orders/[id] que cambie el estado.
    router.replace('/pickup/pago?cancelled=1')
  }

  const mm = String(Math.floor(segsRestantes / 60)).padStart(2, '0')
  const ss = String(segsRestantes % 60).padStart(2, '0')

  return (
    <PickupShell title="Escaneá para pagar · Julia Bakery">
      <main className="px-container-margin-mobile pt-6 pb-32 flex flex-col items-center text-center">

        <div className="w-full max-w-md">

          {estado === 'cargando' && (
            <div className="py-20">
              <div className="text-on-surface-variant font-body-lg">Conectando con la pasarela...</div>
            </div>
          )}

          {estado === 'error' && (
            <div className="bg-error-container text-on-error-container rounded-2xl p-6 my-12">
              <div className="font-headline-md text-headline-md mb-2">No pudimos iniciar el cobro</div>
              <div className="font-body-md mb-6">{errorMsg}</div>
              <button onClick={cancelar} className="w-full h-12 bg-primary text-on-primary rounded-lg font-body-lg">
                Volver
              </button>
            </div>
          )}

          {estado === 'timeout' && (
            <div className="bg-surface border border-outline-variant rounded-2xl p-6 my-12">
              <div className="font-headline-md text-headline-md mb-2">⏱️ Se acabó el tiempo</div>
              <div className="font-body-md text-on-surface-variant mb-6">
                El QR expiró. Empezá de nuevo o pasá a caja.
              </div>
              <button onClick={cancelar} className="w-full h-12 bg-primary text-on-primary rounded-lg font-body-lg">
                Volver al inicio
              </button>
            </div>
          )}

          {estado === 'pagado' && (
            <div className="py-20">
              <div className="text-6xl mb-4">✅</div>
              <div className="font-headline-lg text-headline-lg text-on-surface mb-2">
                ¡Pago recibido!
              </div>
              <div className="font-body-md text-on-surface-variant">
                Preparando tu ticket...
              </div>
            </div>
          )}

          {estado === 'esperando' && checkoutUrl && (
            <>
              <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
                Escaneá con tu celular
              </h1>
              <p className="font-body-md text-on-surface-variant mb-6">
                Abrí la cámara de tu teléfono y enfocá este código.
                <br />
                Vas a pagar de forma segura con Recurrente.
              </p>

              <div className="bg-white border-4 border-primary rounded-2xl p-6 inline-block shadow-lg mb-6">
                <QRCodeSVG
                  value={checkoutUrl}
                  size={280}
                  level="M"
                  marginSize={2}
                />
              </div>

              {pedido?.total > 0 && (
                <div className="bg-surface border border-outline-variant rounded-xl p-4 mb-4">
                  <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-1">
                    Total a pagar
                  </div>
                  <div className="font-headline-lg text-[36px] tabular-nums text-on-surface">
                    Q{pedido.total.toFixed(2)}
                  </div>
                  {pedido.referencia && (
                    <div className="text-[13px] text-tertiary mt-1">
                      Pedido {pedido.referencia}
                    </div>
                  )}
                </div>
              )}

              <div className="text-on-surface-variant font-body-md mt-4">
                ⏱️ Tiempo restante: <span className="tabular-nums font-semibold">{mm}:{ss}</span>
              </div>

              <button
                onClick={cancelar}
                className="mt-8 text-tertiary underline font-body-md"
              >
                Cancelar y volver
              </button>
            </>
          )}

        </div>
      </main>
    </PickupShell>
  )
}
