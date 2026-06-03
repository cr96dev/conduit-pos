// pages/pickup/canasta.js
// Carrito. Diseño basado en design-source/pickup/screens/canasta.html

import Link from 'next/link'
import PickupShell from '../../components/pickup/PickupShell'
import { PickupTopBar, PickupBottomNav } from '../../components/pickup/Nav'
import { useCart } from '../../lib/pickup/cart'

export default function PickupCanasta() {
  const { items, count, total, updateQty, removeItem } = useCart()
  const ivaDesglose = total > 0 ? Number((total / 1.12 * 0.12).toFixed(2)) : 0

  return (
    <PickupShell title="Tu canasta · Julia Bakery">
      <PickupTopBar cartCount={count} />

      <main className="px-container-margin-mobile pt-stack-md pb-32">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-stack-md">Tu canasta</h1>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-7xl text-tertiary mb-3 block">bakery_dining</span>
            <p className="font-headline-lg text-headline-lg text-on-surface mb-2">Tu canasta está vacía</p>
            <p className="font-body-md text-on-surface-variant mb-6">¿Empezamos por algo dulce?</p>
            <Link
              href="/pickup/menu"
              className="inline-block bg-primary text-on-primary px-8 h-12 leading-[3rem] rounded-lg font-body-lg active:scale-[0.98] transition-all"
            >
              Ver menú
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-3 mb-stack-md">
              {items.map(it => (
                <div
                  key={it.variant_id}
                  className="bg-surface border border-outline-variant/30 rounded-xl p-3 flex gap-3 items-center"
                >
                  <div className="w-16 h-16 flex-shrink-0 bg-surface-container rounded-lg overflow-hidden">
                    <img alt={it.item_name} className="w-full h-full object-cover" src={it.image_url} />
                  </div>
                  <div className="flex-grow min-w-0">
                    <div className="font-body-lg text-on-surface truncate">{it.item_name}</div>
                    <div className="text-[12px] text-tertiary">Q{Number(it.precio).toFixed(2)} c/u</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => updateQty(it.variant_id, it.cantidad - 1)}
                      className="w-8 h-8 bg-surface-container border border-outline-variant rounded-full flex items-center justify-center active:scale-90"
                    >
                      <span className="material-symbols-outlined text-[18px]">remove</span>
                    </button>
                    <span className="font-price-display text-[18px] tabular-nums min-w-[20px] text-center">{it.cantidad}</span>
                    <button
                      onClick={() => updateQty(it.variant_id, it.cantidad + 1)}
                      className="w-8 h-8 bg-primary text-on-primary rounded-full flex items-center justify-center active:scale-90"
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>
                  </div>
                  <div className="font-price-display text-price-display text-on-surface tabular-nums min-w-[70px] text-right">
                    Q{(it.precio * it.cantidad).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>

            {/* Total breakdown */}
            <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-2">
              <div className="flex justify-between text-on-surface-variant font-body-md">
                <span>Productos</span>
                <span className="tabular-nums">Q{(total - ivaDesglose).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-on-surface-variant font-body-md">
                <span>IVA incluido</span>
                <span className="tabular-nums">Q{ivaDesglose.toFixed(2)}</span>
              </div>
              <div className="h-px bg-outline-variant/50 my-1" />
              <div className="flex justify-between text-on-surface font-headline-lg text-headline-lg items-baseline">
                <span>Total</span>
                <span className="tabular-nums">Q{total.toFixed(2)}</span>
              </div>
            </div>
          </>
        )}
      </main>

      {items.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-outline-variant px-container-margin-mobile py-4 pb-safe">
          <Link
            href="/pickup/horario"
            className="w-full h-14 bg-primary text-on-primary rounded-lg font-body-lg flex items-center justify-center active:scale-[0.98] transition-all shadow-lg"
          >
            Continuar al pago
          </Link>
        </div>
      )}

      <PickupBottomNav active="menu" />
    </PickupShell>
  )
}
