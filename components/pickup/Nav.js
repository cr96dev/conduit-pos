// components/pickup/Nav.js
//
// TopAppBar y BottomNav reusables para todas las páginas /pickup.

import Link from 'next/link'

export function PickupTopBar({ cartCount = 0 }) {
  return (
    <header className="bg-surface sticky top-0 flex justify-between items-center w-full px-container-margin-mobile h-16 z-50">
      <Link href="/pickup" className="text-primary hover:opacity-80 transition-opacity active:scale-95 duration-150">
        <span className="material-symbols-outlined">menu</span>
      </Link>
      <Link href="/pickup" className="flex items-center hover:opacity-80 transition-opacity">
        <img src="/logo.svg" alt="Julia Bakery" className="h-9 w-auto" />
      </Link>
      <Link href="/pickup/canasta" className="text-primary hover:opacity-80 transition-opacity active:scale-95 duration-150 relative">
        <span className="material-symbols-outlined">shopping_bag</span>
        {cartCount > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-secondary text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {cartCount}
          </span>
        )}
      </Link>
    </header>
  )
}

export function PickupBottomNav({ active = 'inicio' }) {
  const items = [
    { key: 'inicio',  href: '/pickup',             icon: 'home',           label: 'Inicio' },
    { key: 'menu',    href: '/pickup/menu',        icon: 'bakery_dining',  label: 'Menú' },
    { key: 'pedidos', href: '/pickup/mis-pedidos', icon: 'receipt_long',   label: 'Mis Pedidos' },
    { key: 'perfil',  href: '/pickup/perfil',      icon: 'person',         label: 'Perfil' },
  ]
  return (
    <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 py-3 bg-surface shadow-lg rounded-t-xl border-t border-outline-variant">
      {items.map((it) => {
        const isActive = it.key === active
        return (
          <Link
            key={it.key}
            href={it.href}
            className={
              isActive
                ? 'flex flex-col items-center justify-center text-primary font-bold active:scale-90 duration-200'
                : 'flex flex-col items-center justify-center text-on-surface-variant hover:text-primary transition-colors duration-200 active:scale-90'
            }
          >
            <span
              className="material-symbols-outlined"
              style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}
            >
              {it.icon}
            </span>
            <span className="font-caption-caps text-caption-caps mt-1">{it.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function PickupCartFAB({ count = 0 }) {
  if (count <= 0) return null
  return (
    <Link
      href="/pickup/canasta"
      className="fixed bottom-24 right-6 z-[55] w-16 h-16 bg-primary text-on-primary rounded-full flex items-center justify-center shadow-2xl active:scale-90 transition-transform"
    >
      <span className="material-symbols-outlined text-[28px]">shopping_bag</span>
      <span className="absolute -top-1 -right-1 w-6 h-6 bg-secondary text-white text-[11px] font-bold rounded-full flex items-center justify-center border-2 border-background">
        {count}
      </span>
    </Link>
  )
}
