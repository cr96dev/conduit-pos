// pages/pickup/mis-pedidos.js
// Lista de pedidos del cliente — identificación por email guardado en
// localStorage (en MVP). Fase 2: auth con magic link via Supabase.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import PickupShell from '../../components/pickup/PickupShell'
import { PickupTopBar, PickupBottomNav } from '../../components/pickup/Nav'

const STATUS_LABELS = {
  pendiente_pago:    { label: 'Por preparar',         color: 'bg-surface-container text-on-surface' },
  pendiente_entrega: { label: 'En el horno',          color: 'bg-secondary-container text-on-secondary-container' },
  lista:             { label: 'Listo para recoger',   color: 'bg-secondary text-on-secondary animate-pulse' },
  facturada:         { label: 'Entregado',            color: 'bg-surface text-on-surface-variant border border-outline-variant' },
  cancelada:         { label: 'Cancelado',            color: 'bg-error-container text-on-error-container' },
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleString('es-GT', {
      day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    })
  } catch { return '' }
}

export default function PickupMisPedidos() {
  const [pedidos, setPedidos] = useState([])
  const [email, setEmail] = useState('')
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const data = JSON.parse(window.localStorage.getItem('julia_pickup_receptor_v1') || '{}')
      setEmail(data.email || '')
    } catch {}
  }, [])

  useEffect(() => {
    if (!email) { setCargando(false); return }
    fetch(`/api/pickup/orders?email=${encodeURIComponent(email)}`)
      .then(r => r.json())
      .then(j => setPedidos(j.orders || []))
      .catch(() => {})
      .finally(() => setCargando(false))
  }, [email])

  if (!email) {
    return (
      <PickupShell title="Mis pedidos · Julia Bakery">
        <PickupTopBar />
        <main className="px-container-margin-mobile pt-stack-lg pb-32 text-center">
          <span className="material-symbols-outlined text-7xl text-tertiary mb-3 block">receipt_long</span>
          <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">
            Tu primer pedido lo recordamos siempre
          </h1>
          <p className="font-body-md text-on-surface-variant mb-6">¡Vamos! Tu canasta te espera.</p>
          <Link
            href="/pickup/menu"
            className="inline-block bg-primary text-on-primary px-8 h-12 leading-[3rem] rounded-lg font-body-lg active:scale-[0.98]"
          >
            Empezá a ordenar
          </Link>
        </main>
        <PickupBottomNav active="pedidos" />
      </PickupShell>
    )
  }

  return (
    <PickupShell title="Mis pedidos · Julia Bakery">
      <PickupTopBar />

      <main className="px-container-margin-mobile pt-stack-md pb-32">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-stack-md">Mis pedidos</h1>

        {cargando ? (
          <div className="text-center py-12 text-on-surface-variant">Cargando...</div>
        ) : pedidos.length === 0 ? (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-6xl text-tertiary mb-2 block">bakery_dining</span>
            <p className="font-body-lg text-on-surface mb-2">Sin pedidos todavía</p>
            <Link href="/pickup/menu" className="text-primary underline">Ver menú</Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {pedidos.map(p => {
              const status = STATUS_LABELS[p.estado] || STATUS_LABELS.pendiente_entrega
              return (
                <Link
                  key={p.id}
                  href={`/pickup/pedido/${p.id}`}
                  className="bg-surface border border-outline-variant rounded-xl p-4 flex flex-col gap-2 active:scale-[0.98] transition-transform"
                >
                  <div className="flex justify-between items-start gap-3">
                    <span className="font-body-lg text-on-surface">{p.referencia}</span>
                    <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md ${status.color}`}>
                      {status.label}
                    </span>
                  </div>
                  <div className="text-[13px] text-on-surface-variant line-clamp-2">
                    {(p.items || []).map(i => `${i.cantidad}× ${i.descripcion}`).join(' · ')}
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-[12px] text-tertiary">{fmtDate(p.created_at)}</span>
                    <span className="font-price-display text-[20px] text-on-surface tabular-nums">
                      Q{Number(p.total_estimado || 0).toFixed(2)}
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </main>

      <PickupBottomNav active="pedidos" />
    </PickupShell>
  )
}
