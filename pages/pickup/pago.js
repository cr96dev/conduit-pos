// pages/pickup/pago.js
// Pago con tarjeta. Por ahora UI completa pero conecta a backend POST /api/pickup/orders
// que crea pedido en estado 'pendiente_pago' y devuelve order_id. La autorización
// real de tarjeta se conecta cuando Neonet confirme credenciales (Junio 5+).

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

  const [numero, setNumero] = useState('')
  const [vence,  setVence]  = useState('')
  const [cvv,    setCvv]    = useState('')
  const [nombre, setNombre] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState('')

  function fmtNumero(v) {
    const digits = v.replace(/\D/g, '').slice(0, 16)
    return digits.replace(/(.{4})/g, '$1 ').trim()
  }
  function fmtVence(v) {
    const d = v.replace(/\D/g, '').slice(0, 4)
    if (d.length <= 2) return d
    return d.slice(0, 2) + '/' + d.slice(2)
  }

  async function pagar(e) {
    e?.preventDefault()
    setError('')
    setEnviando(true)
    try {
      const r = await fetch('/api/pickup/orders', {
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
          slot_iso: slot?.slot_iso,
          slot_label: slot?.slot_label,
          pago: {
            metodo: 'tarjeta',
            // Datos de tarjeta NO se mandan al backend en MVP — pendiente
            // hasta que Neonet confirme credenciales. UI captura para futuro.
            ultimos4: numero.replace(/\D/g, '').slice(-4),
            simulado: true,
          },
        }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) {
        setError(j.error || 'No pudimos procesar el pago. Probá de nuevo.')
        setEnviando(false)
        return
      }
      clear()
      router.push(`/pickup/exito/${j.order.id}`)
    } catch (e) {
      setError('Error de red. Verificá tu conexión.')
      setEnviando(false)
    }
  }

  const numeroValido = numero.replace(/\D/g, '').length >= 13
  const venceValido  = /^\d{2}\/\d{2}$/.test(vence)
  const cvvValido    = /^\d{3,4}$/.test(cvv)
  const valido = numeroValido && venceValido && cvvValido && nombre.trim().length >= 3

  const ivaDesglose = total > 0 ? Number((total / 1.12 * 0.12).toFixed(2)) : 0

  return (
    <PickupShell title="Pago · Julia Bakery">
      <PickupTopBar cartCount={count} />

      <main className="px-container-margin-mobile pt-stack-md pb-32">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">Cobramos con tu tarjeta</h1>
        <p className="font-body-md text-on-surface-variant mb-stack-md">
          Pago seguro · No guardamos los datos de tu tarjeta.
        </p>

        <form onSubmit={pagar} className="flex flex-col gap-4">
          {/* Número */}
          <div>
            <label className="block font-caption-caps text-caption-caps text-on-surface-variant mb-1.5">
              Número de tarjeta
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant">credit_card</span>
              <input
                value={numero}
                onChange={(e) => setNumero(fmtNumero(e.target.value))}
                placeholder="1234 5678 9012 3456"
                inputMode="numeric"
                required
                className="w-full h-13 pl-10 pr-3 py-3 bg-white border border-outline-variant rounded-xl font-body-md tracking-wider focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Venc + CVV */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-caption-caps text-caption-caps text-on-surface-variant mb-1.5">Vencimiento</label>
              <input
                value={vence}
                onChange={(e) => setVence(fmtVence(e.target.value))}
                placeholder="MM/AA"
                inputMode="numeric"
                required
                className="w-full h-13 px-3 py-3 bg-white border border-outline-variant rounded-xl font-body-md tabular-nums focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-caption-caps text-caption-caps text-on-surface-variant mb-1.5">CVV</label>
              <input
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="123"
                inputMode="numeric"
                required
                className="w-full h-13 px-3 py-3 bg-white border border-outline-variant rounded-xl font-body-md tabular-nums focus:border-primary focus:outline-none"
              />
            </div>
          </div>

          {/* Nombre tarjeta */}
          <div>
            <label className="block font-caption-caps text-caption-caps text-on-surface-variant mb-1.5">
              Nombre en la tarjeta
            </label>
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value.toUpperCase())}
              placeholder="CARLOS ROLDAN"
              required
              className="w-full h-13 px-3 py-3 bg-white border border-outline-variant rounded-xl font-body-md tracking-wide focus:border-primary focus:outline-none"
            />
          </div>

          {/* Resumen total */}
          <div className="bg-surface-container-low border border-outline-variant rounded-xl p-4 flex flex-col gap-2">
            <div className="flex justify-between text-on-surface-variant font-body-md">
              <span>Productos</span>
              <span className="tabular-nums">Q{(total - ivaDesglose).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant font-body-md">
              <span>IVA</span>
              <span className="tabular-nums">Q{ivaDesglose.toFixed(2)}</span>
            </div>
            <div className="h-px bg-outline-variant/50 my-1" />
            <div className="flex justify-between text-on-surface items-baseline">
              <span className="font-body-lg">Total</span>
              <span className="font-headline-lg text-[32px] tabular-nums">Q{total.toFixed(2)}</span>
            </div>
            {slot?.slot_label && (
              <div className="text-[13px] text-secondary mt-1">
                Recogés {slot.day_label?.toLowerCase()} a las {slot.slot_label}
              </div>
            )}
          </div>

          {error && (
            <div className="bg-error-container text-on-error-container rounded-xl px-4 py-3 font-body-md">
              {error}
            </div>
          )}
        </form>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-outline-variant px-container-margin-mobile py-4 pb-safe">
        <button
          disabled={!valido || enviando}
          onClick={pagar}
          className="w-full h-14 bg-primary text-on-primary rounded-lg font-body-lg flex items-center justify-center active:scale-[0.98] transition-all shadow-lg disabled:opacity-40"
        >
          {enviando ? 'Procesando...' : `Pagar Q${total.toFixed(2)}`}
        </button>
        <p className="text-[11px] text-on-surface-variant text-center mt-2">
          🔒 Pago seguro · Tus datos nunca se guardan
        </p>
      </div>

      <PickupBottomNav active="menu" />
    </PickupShell>
  )
}
