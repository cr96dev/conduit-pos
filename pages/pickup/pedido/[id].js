// pages/pickup/pedido/[id].js
// Detalle del pedido. Muestra QR prominente si está "lista" para recoger.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import PickupShell from '../../../components/pickup/PickupShell'
import Ubicacion from '../../../components/pickup/Ubicacion'
import { PickupTopBar, PickupBottomNav } from '../../../components/pickup/Nav'
import { useCart } from '../../../lib/pickup/cart'

const STATUS_TIMELINE = [
  { key: 'pendiente_pago',    label: 'Pago confirmado' },
  { key: 'pendiente_entrega', label: 'En el horno' },
  { key: 'lista',             label: 'Listo para recoger' },
  { key: 'facturada',         label: 'Entregado' },
]

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('es-GT', {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch { return '' }
}

export default function PickupPedidoDetalle() {
  const router = useRouter()
  const { id } = router.query
  const { addItem } = useCart()
  const [pedido, setPedido] = useState(null)

  useEffect(() => {
    if (!id || typeof id !== 'string') return
    let cancelled = false
    async function load() {
      try {
        const r = await fetch(`/api/pickup/orders/${id}`)
        const j = await r.json()
        if (!cancelled) setPedido(j.order || null)
      } catch (_) {}
    }
    load()
    // Refrescar cada 10s para ver cambios de estado
    const t = setInterval(load, 10_000)
    return () => { cancelled = true; clearInterval(t) }
  }, [id])

  if (!pedido) {
    return (
      <PickupShell title="Pedido · Julia Bakery">
        <PickupTopBar />
        <main className="p-6 text-center text-on-surface-variant">Cargando pedido...</main>
      </PickupShell>
    )
  }

  const status = pedido.estado || 'pendiente_pago'
  const statusIdx = STATUS_TIMELINE.findIndex(s => s.key === status)
  const isLista = status === 'lista'
  const ref = pedido.referencia || `JU-${pedido.id?.slice(0,8).toUpperCase()}`

  function reordenar() {
    for (const it of (pedido.items || [])) {
      addItem({
        variant_id: it.variant_id,
        item_name: it.descripcion,
        variant_name: '',
        descripcion: '',
        precio: Number(it.precio_unitario || 0),
        prep_min: 20,
        image_url: '/pickup/images/img_002.jpg',
        cantidad: Number(it.cantidad || 1),
      })
    }
    router.push('/pickup/canasta')
  }

  return (
    <PickupShell title={`${ref} · Julia Bakery`}>
      <PickupTopBar />

      <main className="px-container-margin-mobile pt-stack-md pb-32 flex flex-col gap-stack-md">
        <div>
          <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-1">Pedido</div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tabular-nums tracking-wide">{ref}</h1>
          <div className="text-[13px] text-tertiary mt-1">{fmtDate(pedido.created_at)}</div>
        </div>

        {/* Aviso cuando está listo */}
        {isLista && (
          <div className="bg-secondary-container border-2 border-secondary rounded-2xl px-6 py-5 text-center animate-pulse-soft">
            <span className="material-symbols-outlined text-secondary text-[40px] mb-2 block">check_circle</span>
            <div className="font-headline-lg text-headline-lg text-on-secondary-container">¡Tu pedido está listo!</div>
            <div className="font-body-md text-on-secondary-container/80 mt-1">
              Mostrá tu pedido <strong>{ref}</strong> en el mostrador.
            </div>
            <div className="mt-3"><Ubicacion variant="inline" /></div>
          </div>
        )}

        {/* Timeline */}
        <div className="bg-surface border border-outline-variant rounded-xl p-4">
          <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-3">Estado</div>
          <div className="flex flex-col gap-3">
            {STATUS_TIMELINE.map((s, i) => {
              const done = i < statusIdx
              const current = i === statusIdx
              return (
                <div key={s.key} className="flex items-center gap-3">
                  <div className={
                    done
                      ? 'w-6 h-6 rounded-full bg-secondary text-on-secondary flex items-center justify-center'
                      : current
                      ? 'w-6 h-6 rounded-full bg-primary text-on-primary flex items-center justify-center'
                      : 'w-6 h-6 rounded-full bg-surface-container border border-outline-variant flex items-center justify-center'
                  }>
                    {done && <span className="material-symbols-outlined text-[16px]">check</span>}
                    {current && <span className="w-2 h-2 bg-white rounded-full" />}
                  </div>
                  <span className={
                    current
                      ? 'font-body-lg text-on-surface'
                      : done
                      ? 'font-body-md text-on-surface-variant line-through'
                      : 'font-body-md text-on-surface-variant/50'
                  }>
                    {s.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Items */}
        <div className="bg-surface border border-outline-variant rounded-xl p-4">
          <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-3">Lo que pediste</div>
          <div className="flex flex-col gap-2">
            {(pedido.items || []).map((it, i) => (
              <div key={i} className="flex justify-between items-baseline gap-3">
                <div className="flex-grow">
                  <span className="font-body-md text-on-surface">{it.cantidad}× {it.descripcion}</span>
                </div>
                <span className="font-body-md tabular-nums text-on-surface">
                  Q{(Number(it.cantidad) * Number(it.precio_unitario)).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <div className="h-px bg-outline-variant/50 my-3" />
          <div className="flex justify-between items-baseline">
            <span className="font-body-lg text-on-surface">Total</span>
            <span className="font-headline-lg text-[24px] tabular-nums text-on-surface">
              Q{Number(pedido.total_estimado || 0).toFixed(2)}
            </span>
          </div>
        </div>

        <button
          onClick={reordenar}
          className="h-13 border-2 border-secondary text-secondary rounded-lg font-body-lg active:scale-[0.98] transition-all"
        >
          Pedir de nuevo
        </button>
      </main>

      <PickupBottomNav active="pedidos" />

      <style jsx global>{`
        @keyframes pulse-soft {
          0%, 100% { box-shadow: 0 0 0 0 rgba(135,168,120,0.5); }
          50%      { box-shadow: 0 0 0 12px rgba(135,168,120,0); }
        }
        .animate-pulse-soft { animation: pulse-soft 2.2s infinite; }
      `}</style>
    </PickupShell>
  )
}
