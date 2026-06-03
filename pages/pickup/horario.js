// pages/pickup/horario.js
// Selector de fecha + slot de pickup. Diseño basado en horario.html

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import PickupShell from '../../components/pickup/PickupShell'
import { PickupTopBar, PickupBottomNav } from '../../components/pickup/Nav'
import { useCart } from '../../lib/pickup/cart'

const STORAGE_PICKUP = 'julia_pickup_slot_v1'

// Configuración del local — futuro: leer de config_pickup en Supabase
const APERTURA_HORA = 7      // 7:00 AM
const CIERRE_HORA = 19       // 7:00 PM
const SLOT_MINUTOS = 15

function dayLabel(date, idx) {
  if (idx === 0) return 'Hoy'
  if (idx === 1) return 'Mañana'
  return date.toLocaleDateString('es-GT', { weekday: 'long' }).replace(/^./, c => c.toUpperCase())
}

function buildDays(numDays = 4) {
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  const arr = []
  for (let i = 0; i < numDays; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    arr.push({
      iso: d.toISOString().slice(0, 10),
      label: dayLabel(d, i),
      fecha: d.toLocaleDateString('es-GT', { day: 'numeric', month: 'short' }),
      date: d,
    })
  }
  return arr
}

function buildSlots(day, maxPrepMin) {
  const slots = []
  const ahora = new Date()
  const isHoy = day.iso === ahora.toISOString().slice(0, 10)
  // Slot mínimo = ahora + tiempo de prep + 5 min buffer
  const minTime = new Date(ahora.getTime() + (maxPrepMin + 5) * 60_000)
  for (let h = APERTURA_HORA; h < CIERRE_HORA; h++) {
    for (let m = 0; m < 60; m += SLOT_MINUTOS) {
      const slotDate = new Date(day.date)
      slotDate.setHours(h, m, 0, 0)
      const disponible = isHoy ? slotDate >= minTime : true
      slots.push({
        time: slotDate,
        label: slotDate.toLocaleTimeString('es-GT', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s/g, ' '),
        disponible,
      })
    }
  }
  return slots
}

export default function PickupHorario() {
  const router = useRouter()
  const { items, count, maxPrepMin } = useCart()
  const days = useMemo(() => buildDays(4), [])
  const [activeDayIso, setActiveDayIso] = useState(days[0].iso)
  const [selectedSlot, setSelectedSlot] = useState(null)

  // Si la canasta está vacía → volver al menú
  useEffect(() => {
    if (items.length === 0 && typeof window !== 'undefined') {
      router.replace('/pickup/menu')
    }
  }, [items.length, router])

  const activeDay = days.find(d => d.iso === activeDayIso) || days[0]
  const slots = useMemo(() => buildSlots(activeDay, maxPrepMin || 0), [activeDay, maxPrepMin])

  function confirmar() {
    if (!selectedSlot) return
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_PICKUP, JSON.stringify({
        slot_iso: selectedSlot.time.toISOString(),
        slot_label: selectedSlot.label,
        day_iso: activeDayIso,
        day_label: activeDay.label,
      }))
    }
    router.push('/pickup/datos')
  }

  return (
    <PickupShell title="Hora de pickup · Julia Bakery">
      <PickupTopBar cartCount={count} />

      <main className="px-container-margin-mobile pt-stack-md pb-32">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">¿A qué hora pasás?</h1>
        <p className="font-body-md text-on-surface-variant mb-stack-md">
          Tu pedido necesita {maxPrepMin || 20} min para estar listo. Elegí un horario.
        </p>

        {/* Day pills */}
        <div className="flex gap-2 overflow-x-auto hide-scrollbar mb-stack-md">
          {days.map(d => {
            const isActive = d.iso === activeDayIso
            return (
              <button
                key={d.iso}
                onClick={() => { setActiveDayIso(d.iso); setSelectedSlot(null) }}
                className={
                  isActive
                    ? 'flex-shrink-0 px-4 py-3 bg-primary text-on-primary rounded-full font-caption-caps text-caption-caps tracking-wider'
                    : 'flex-shrink-0 px-4 py-3 bg-surface border border-outline-variant text-on-surface-variant rounded-full font-caption-caps text-caption-caps tracking-wider'
                }
              >
                {d.label} · {d.fecha}
              </button>
            )
          })}
        </div>

        {/* Slot grid */}
        <div className="grid grid-cols-2 gap-3">
          {slots.map(s => {
            const isSelected = selectedSlot?.time.getTime() === s.time.getTime()
            return (
              <button
                key={s.time.toISOString()}
                disabled={!s.disponible}
                onClick={() => setSelectedSlot(s)}
                className={
                  isSelected
                    ? 'h-14 bg-primary text-on-primary rounded-xl font-body-lg shadow-lg active:scale-95 transition-all'
                    : !s.disponible
                    ? 'h-14 bg-surface-container-low text-on-surface-variant/40 border border-outline-variant/20 rounded-xl font-body-md line-through cursor-not-allowed'
                    : 'h-14 bg-surface text-on-surface border border-outline-variant rounded-xl font-body-md hover:border-primary active:scale-95 transition-all'
                }
              >
                {s.label}
              </button>
            )
          })}
        </div>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-outline-variant px-container-margin-mobile py-4 pb-safe">
        <button
          disabled={!selectedSlot}
          onClick={confirmar}
          className="w-full h-14 bg-primary text-on-primary rounded-lg font-body-lg flex items-center justify-center active:scale-[0.98] transition-all shadow-lg disabled:opacity-40"
        >
          {selectedSlot ? `Continuar · ${selectedSlot.label}` : 'Elegí un horario'}
        </button>
      </div>

      <PickupBottomNav active="menu" />
    </PickupShell>
  )
}
