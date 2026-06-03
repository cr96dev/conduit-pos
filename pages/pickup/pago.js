// pages/pickup/pago.js
// Resumen del pedido + botón "Pagar con tarjeta" → redirige a Recurrente checkout.
// Recurrente maneja el formulario de tarjeta seguro (no captamos PAN/CVV nosotros).

import { useState } from 'react'
import { useRouter } from 'next/router'
import PickupShell from '../../components/pickup/PickupShell'
import { PickupTopBar, PickupBottomNav } from '../../components/pickup/Nav'
import { useCart } from '../../lib/pickup/cart'

function loadStored(key) {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(window.localStorage.getItem(key) || '{}') } catch { return {} }
}

export default function PickupPago() {
  const router = useRouter()
  const { items, count, total, clear } = useCart()
  const receptor = loadStored('julia_pickup_receptor_v1')
  const slot     = loadStored('julia_pickup_slot_v1')

  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState(
    router.query?.cancelled === '1'
      ? 'El pago fue cancelado. Podés intentarlo de nuevo.'
      : ''
  )

  const ivaDesglose = total > 0 ? Number((total / 1.12 * 0.12).toFixed(2)) : 0
  const itemsListos = items.length > 0 && receptor?.email && slot?.slot_iso

  async function pagarConRecurrente() {
    if (!itemsListos) return
    setError('')
    setEnviando(true)
    try {
      // Paso 1: crear el pedido_pendiente en estado pendiente_pago
      const r1 = await fetch('/api/pickup/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(i => ({
            variant_id: i.variant_id,
            descripcion: i.variant_name ? `${i.item_name} (${i.variant_name})` : i.item_name,
            cantidad: i.cantidad,
            precio_unitario: i.precio,
          })),
          receptor,
          slot_iso: slot.slot_iso,
          slot_label: slot.slot_label,
          day_label: slot.day_label,
          pago: { metodo: 'recurrente', simulado: false },
        }),
      })
      const j1 = await r1.json()
      if (!r1.ok || !j1.ok) {
        setError(j1.error || 'No pudimos crear tu pedido')
        setEnviando(false)
        return
      }
      const orderId = j1.order.id

      // Paso 2: crear checkout en Recurrente
      const r2 = await fetch('/api/pickup/recurrente-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId }),
      })
      const j2 = await r2.json()
      if (!r2.ok || !j2.ok || !j2.checkout_url) {
        setError(j2.error || 'No pudimos iniciar el cobro. Probá de nuevo.')
        setEnviando(false)
        return
      }

      // Paso 3: limpiar carrito y redirigir al checkout hosted de Recurrente
      clear()
      window.location.href = j2.checkout_url
    } catch (e) {
      setError('Error de red. Verificá tu conexión.')
      setEnviando(false)
    }
  }

  return (
    <PickupShell title="Pago · Julia Bakery">
      <PickupTopBar cartCount={count} />

      <main className="px-container-margin-mobile pt-stack-md pb-32">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">Resumen del pedido</h1>
        <p className="font-body-md text-on-surface-variant mb-stack-md">
          Pagás con tarjeta de forma segura en la pasarela de Recurrente.
        </p>

        {/* Items resumen */}
        <div className="bg-surface border border-outline-variant rounded-xl p-4 mb-4">
          <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-3">Lo que vas a recoger</div>
          <div className="flex flex-col gap-2">
            {items.map(it => (
              <div key={it.variant_id} className="flex justify-between items-baseline gap-3">
                <span className="font-body-md text-on-surface flex-grow truncate">
                  {it.cantidad}× {it.item_name}
                </span>
                <span className="font-body-md tabular-nums text-on-surface flex-shrink-0">
                  Q{(it.precio * it.cantidad).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Detalles del pickup */}
        <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 mb-4">
          <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-2">Recogés</div>
          <div className="font-body-lg text-on-surface">
            {slot?.day_label} a las {slot?.slot_label}
          </div>
          <div className="text-[13px] text-tertiary mt-1">5a Av 12-34, Zona 14</div>
          <div className="h-px bg-outline-variant/30 my-3" />
          <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-1">A nombre de</div>
          <div className="font-body-md text-on-surface">{receptor?.nombre}</div>
          <div className="text-[13px] text-tertiary">{receptor?.email} · {receptor?.telefono}</div>
        </div>

        {/* Total */}
        <div className="bg-surface border border-outline-variant rounded-xl p-4 mb-4">
          <div className="flex justify-between text-on-surface-variant font-body-md">
            <span>Productos</span>
            <span className="tabular-nums">Q{(total - ivaDesglose).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-on-surface-variant font-body-md mt-1">
            <span>IVA</span>
            <span className="tabular-nums">Q{ivaDesglose.toFixed(2)}</span>
          </div>
          <div className="h-px bg-outline-variant/50 my-2" />
          <div className="flex justify-between text-on-surface items-baseline">
            <span className="font-body-lg">Total</span>
            <span className="font-headline-lg text-[32px] tabular-nums">Q{total.toFixed(2)}</span>
          </div>
        </div>

        {error && (
          <div className="bg-error-container text-on-error-container rounded-xl px-4 py-3 font-body-md mb-3">
            {error}
          </div>
        )}

        <p className="text-[11px] text-on-surface-variant text-center mt-4">
          🔒 Pasarela segura de Recurrente · Tus datos de tarjeta nunca pasan por nuestros servidores
        </p>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-outline-variant px-container-margin-mobile py-4 pb-safe">
        <button
          disabled={!itemsListos || enviando}
          onClick={pagarConRecurrente}
          className="w-full h-14 bg-primary text-on-primary rounded-lg font-body-lg flex items-center justify-center active:scale-[0.98] transition-all shadow-lg disabled:opacity-40"
        >
          {enviando ? 'Iniciando pago...' : `Pagar Q${total.toFixed(2)} con tarjeta`}
        </button>
      </div>

      <PickupBottomNav active="menu" />
    </PickupShell>
  )
}
