// pages/pickup/exito/[id].js
// Pantalla de confirmación post-pago.
//
// Modo PWA normal: confeti + "Te enviamos confirmación al email" + link a /mis-pedidos.
//
// Modo K2 (kiosko armador): pantalla GRANDE con código del pedido + instrucción
// "Pasá al mostrador con este código". Si el pago fue por QR Recurrente, muestra
// "PAGADO" en verde. Si fue por "Cobrar en caja", muestra "COBRAR EN CAJA" en
// ámbar. Imprime ticket no-fiscal en la térmica del K2 (vía window.JuliaPOS.
// printTicket si el bridge está presente). Auto-reset a /pickup en 30s para
// dejar el K2 listo para el siguiente cliente.

import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import PickupShell from '../../../components/pickup/PickupShell'
import Ubicacion from '../../../components/pickup/Ubicacion'
import { useK2Mode } from '../../../lib/pickup/k2-mode'

const K2_RESET_SEGS = 30  // tiempo antes de volver al menú en el K2

export default function PickupExito() {
  const router = useRouter()
  const { id } = router.query
  const isK2 = useK2Mode()
  const pagadoEnQr = router.query?.pagado === '1'
  const cobrarEnCaja = router.query?.caja === '1'

  const [pedido, setPedido] = useState(null)
  const [segsRestantes, setSegsRestantes] = useState(K2_RESET_SEGS)
  const ticketImpreso = useRef(false)

  // Carga del pedido + confirmar-pago-sandbox (cuando aplica)
  useEffect(() => {
    if (!id || typeof id !== 'string') return
    let cancelled = false
    async function flow() {
      // Solo confirmamos sandbox si el flujo viene del checkout normal de la
      // PWA (no del modo K2 cobrar_en_caja, que ya entra en pendiente_entrega).
      if (!cobrarEnCaja) {
        try {
          await fetch('/api/pickup/confirmar-pago-sandbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_id: id }),
          })
        } catch (_) {}
      }
      try {
        const r = await fetch(`/api/pickup/orders/${id}`)
        const j = await r.json()
        if (!cancelled) setPedido(j.order || null)
      } catch (_) {}
    }
    flow()
    return () => { cancelled = true }
  }, [id, cobrarEnCaja])

  // Modo K2: imprimir ticket en térmica + countdown reset
  useEffect(() => {
    if (!isK2 || !pedido || ticketImpreso.current) return
    ticketImpreso.current = true

    // Print no-fiscal del ticket K2 — best-effort
    if (typeof window !== 'undefined' && window.JuliaPOS?.printTicket) {
      const payload = {
        // Reutilizamos el shape de printTicket pero con campos FEL en null
        // para que el wrapper imprima un ticket simple (sin sección SAT).
        merchantName: 'JULIA BAKERY',
        razonSocial: pedido.referencia || 'Tu pedido',
        direccion: '2 Avenida 11-08, Zona 10',
        nitEmisor: null,
        receptorNit: null,
        receptorNombre: pedido.receptor_nombre || pedido.receptor?.nombre || '',
        fecha: new Date().toLocaleString('es-GT'),
        cajeroNombre: 'K2 Mini · Auto-servicio',
        metodoPago: cobrarEnCaja ? 'COBRAR EN CAJA' : 'PAGADO',
        items: (pedido.items || []).map(it => ({
          descripcion: it.descripcion,
          cantidad: String(it.cantidad),
          precioUnitario: Number(it.precio_unitario),
          subtotal: Math.round(Number(it.cantidad) * Number(it.precio_unitario) * 100) / 100,
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
        textoFooter: cobrarEnCaja
          ? `Llevá este ticket al mostrador para cobro y factura.`
          : `Pagado. Llevá este ticket al mostrador para retirar.`,
      }
      Promise.resolve(window.JuliaPOS.printTicket(payload))
        .then(r => console.log('[K2 exito] printTicket result:', r))
        .catch(e => console.warn('[K2 exito] printTicket falló:', e?.message || e))
    }

    // Countdown + reset
    const t = setInterval(() => {
      setSegsRestantes(prev => {
        if (prev <= 1) {
          clearInterval(t)
          router.replace('/pickup')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [isK2, pedido, cobrarEnCaja, router])

  if (!id) return null

  const ref = pedido?.referencia || `JU-${String(id).slice(0, 8).toUpperCase()}`
  const slotLabel = pedido?.slot_label || ''
  const dayLabel = pedido?.day_label || ''
  const total = pedido?.total_estimado ? Number(pedido.total_estimado).toFixed(2) : null
  const email = pedido?.receptor_email || pedido?.receptor?.email

  // ====== Render modo K2 ======
  if (isK2) {
    return (
      <PickupShell title={`Pedido ${ref} · Julia Bakery`}>
        <main className="min-h-screen flex flex-col items-center justify-center px-container-margin-mobile py-stack-lg text-center">
          {/* Badge estado pago */}
          {cobrarEnCaja ? (
            <div className="inline-block bg-tertiary-container text-on-tertiary-container px-5 py-2 rounded-full font-caption-caps text-caption-caps tracking-wider mb-stack-md">
              💵 COBRAR EN CAJA
            </div>
          ) : (
            <div className="inline-block bg-secondary-container text-on-secondary-container px-5 py-2 rounded-full font-caption-caps text-caption-caps tracking-wider mb-stack-md">
              ✅ PAGADO
            </div>
          )}

          <h1 className="font-headline-xl-mobile text-headline-xl-mobile text-on-surface mb-2">
            {cobrarEnCaja ? 'Pasá al mostrador' : '¡Pago recibido!'}
          </h1>
          <p className="font-body-md text-on-surface-variant mb-stack-md max-w-sm">
            {cobrarEnCaja
              ? 'Llevá este número al cajero para pagar y retirar.'
              : 'Llevá este número al mostrador para retirar tu pedido.'}
          </p>

          {/* CÓDIGO GIGANTE */}
          <div className="font-headline-xl-mobile text-[96px] leading-none text-primary font-bold tabular-nums tracking-wider mb-stack-md">
            {ref}
          </div>

          {total && (
            <div className="bg-surface border border-outline-variant rounded-xl px-6 py-4 mb-stack-md">
              <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-1">
                {cobrarEnCaja ? 'A cobrar' : 'Total pagado'}
              </div>
              <div className="font-headline-lg text-[36px] tabular-nums text-on-surface">
                Q{total}
              </div>
            </div>
          )}

          {/* Auto-reset countdown */}
          <div className="text-on-surface-variant font-body-md mt-stack-md">
            Volvemos al inicio en <span className="tabular-nums font-semibold">{segsRestantes}s</span>
          </div>
          <button
            onClick={() => router.replace('/pickup')}
            className="mt-3 text-tertiary underline font-body-md"
          >
            Listo, volver ahora
          </button>
        </main>
      </PickupShell>
    )
  }

  // ====== Render modo PWA normal ======
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
