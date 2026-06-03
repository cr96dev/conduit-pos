// pages/pickup/exito/[id].js
// Pantalla de confirmación post-pago. QR + confeti.
//
// QR: usamos qrserver.com (API pública, cero deps). Si en el futuro queremos
// QR generado client-side, instalar `qrcode` y reemplazar.
// Confeti: animación CSS pura, sin deps.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import PickupShell from '../../../components/pickup/PickupShell'
import Ubicacion from '../../../components/pickup/Ubicacion'

export default function PickupExito() {
  const router = useRouter()
  const { id } = router.query
  const [pedido, setPedido] = useState(null)

  useEffect(() => {
    if (!id || typeof id !== 'string') return
    let cancelled = false
    async function flow() {
      // 1. Confirmar pago en sandbox (en LIVE este endpoint es idempotente)
      try {
        await fetch('/api/pickup/confirmar-pago-sandbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: id }),
        })
      } catch (_) { /* ignorar — el pedido se lee igual abajo */ }
      // 2. Cargar pedido (ya con estado actualizado si era sandbox)
      try {
        const r = await fetch(`/api/pickup/orders/${id}`)
        const j = await r.json()
        if (!cancelled) setPedido(j.order || null)
      } catch (_) {}
    }
    flow()
    return () => { cancelled = true }
  }, [id])

  if (!id) return null

  const ref = pedido?.referencia || `JU-${String(id).slice(0, 8).toUpperCase()}`
  const slotLabel = pedido?.slot_label || ''
  const dayLabel = pedido?.day_label || ''
  const total = pedido?.total_estimado ? Number(pedido.total_estimado).toFixed(2) : null
  const email = pedido?.receptor_email || pedido?.receptor?.email

  return (
    <PickupShell title="¡Listo! · Julia Bakery">
      <div className="fixed inset-0 pointer-events-none z-[60] confetti-container" aria-hidden="true">
        {Array.from({ length: 40 }).map((_, i) => (
          <span
            key={i}
            className="confetti"
            style={{
              left: `${(i * 2.5) % 100}%`,
              animationDelay: `${(i * 0.07) % 1.5}s`,
              backgroundColor: ['#a40016', '#d4a574', '#87a878', '#7c572d'][i % 4],
            }}
          />
        ))}
      </div>

      <main className="min-h-screen flex flex-col items-center justify-center px-container-margin-mobile py-stack-lg text-center">
        <div className="w-16 h-16 rounded-full bg-secondary-container flex items-center justify-center mb-stack-md">
          <span className="material-symbols-outlined text-[40px] text-secondary">check</span>
        </div>

        <h1 className="font-headline-xl-mobile text-headline-xl-mobile text-on-surface mb-2">
          Tu pedido está agendado
        </h1>
        <p className="font-body-md text-on-surface-variant mb-stack-md">
          Te avisamos por mail y teléfono cuando esté listo
        </p>

        <div className="font-headline-lg text-headline-lg text-primary mb-stack-md tabular-nums tracking-wider">
          Pedido {ref}
        </div>

        {/* Aviso email — reemplaza al QR */}
        {email && (
          <div className="w-full max-w-sm bg-surface-container-low border border-outline-variant rounded-xl px-5 py-4 mb-stack-md flex items-start gap-3 text-left">
            <span className="material-symbols-outlined text-secondary text-[24px] flex-shrink-0 mt-0.5">mail</span>
            <div className="flex-grow">
              <div className="font-body-lg text-on-surface leading-tight">Te enviamos la confirmación</div>
              <div className="text-[13px] text-on-surface-variant break-all mt-0.5">{email}</div>
              <div className="text-[12px] text-tertiary mt-2">
                Si no te llega en 5 minutos, revisá tu carpeta de spam.
              </div>
            </div>
          </div>
        )}

        {/* Hora pickup destacada */}
        {slotLabel && (
          <div className="w-full max-w-sm bg-surface-container-low border border-outline-variant rounded-xl px-6 py-5 mb-stack-md">
            <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-1">Listo para recoger</div>
            <div className="font-headline-lg text-[28px] text-on-surface leading-tight">
              {dayLabel} a las {slotLabel}
            </div>
            <div className="mt-3"><Ubicacion variant="inline" /></div>
          </div>
        )}

        {total && (
          <div className="font-body-md text-on-surface-variant mb-stack-lg">
            Total cobrado: <span className="font-bold tabular-nums">Q{total}</span>
          </div>
        )}

        <div className="w-full max-w-sm flex flex-col gap-3">
          <Link
            href="/pickup/mis-pedidos"
            className="h-13 bg-primary text-on-primary rounded-lg font-body-lg flex items-center justify-center active:scale-[0.98] transition-all shadow-lg"
          >
            Ver mis pedidos
          </Link>
          <Link
            href="/pickup"
            className="h-13 text-on-surface-variant font-caption-caps text-caption-caps tracking-wider flex items-center justify-center"
          >
            Volver al inicio
          </Link>
        </div>
      </main>

      <style jsx>{`
        .confetti-container { overflow: hidden; }
        .confetti {
          position: absolute;
          top: -10px;
          width: 8px;
          height: 14px;
          opacity: 0.85;
          animation: fall 1.6s ease-in forwards;
          border-radius: 2px;
        }
        @keyframes fall {
          0%   { transform: translateY(0) rotate(0deg);   opacity: 0; }
          10%  { opacity: 0.9; }
          100% { transform: translateY(100vh) rotate(540deg); opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .confetti { display: none; }
        }
      `}</style>
    </PickupShell>
  )
}
