// pages/pickup/index.js
// Home de la app pickup de Julia Bakery.

import { useEffect } from 'react'
import Link from 'next/link'
import PickupShell from '../../components/pickup/PickupShell'
import { PickupBottomNav } from '../../components/pickup/Nav'
import { useCart } from '../../lib/pickup/cart'

const CATEGORIAS_DESTACADAS = [
  { slug: 'panes',     label: 'Panes',      img: '/pickup/images/img_010.jpg' },
  { slug: 'pasteleria',label: 'Pastelería', img: '/pickup/images/img_011.jpg' },
  { slug: 'bebidas',   label: 'Bebidas',    img: '/pickup/images/img_012.jpg' },
  { slug: 'conservas', label: 'Conservas',  img: '/pickup/images/img_013.jpg' },
]

export default function PickupHome() {
  const { count } = useCart()

  useEffect(() => {
    const header = document.getElementById('top-app-bar-home')
    if (!header) return
    const onScroll = () => {
      if (window.scrollY > 50) {
        header.classList.add('shadow-md', 'bg-surface')
        header.classList.remove('bg-surface/80')
      } else {
        header.classList.remove('shadow-md', 'bg-surface')
        header.classList.add('bg-surface/80')
      }
    }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <PickupShell title="Julia Bakery — Pan recién horneado">
      <header
        id="top-app-bar-home"
        className="flex justify-between items-center w-full px-container-margin-mobile h-16 z-50 fixed top-0 bg-surface/80 backdrop-blur-md transition-all"
      >
        <button className="hover:opacity-80 transition-opacity active:scale-95 duration-150 text-primary">
          <span className="material-symbols-outlined">menu</span>
        </button>
        <Link href="/pickup" className="flex items-center hover:opacity-80 transition-opacity">
          <img src="/logo.png" alt="Julia Bakery" className="h-10 w-auto drop-shadow-sm" />
        </Link>
        <Link
          href="/pickup/canasta"
          className="text-primary hover:opacity-80 transition-opacity active:scale-95 duration-150 relative"
        >
          <span className="material-symbols-outlined">shopping_bag</span>
          {count > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-secondary text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {count}
            </span>
          )}
        </Link>
      </header>

      <main className="pt-0 pb-24">
        {/* Hero */}
        <section className="relative h-[85vh] w-full flex flex-col justify-end overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img className="w-full h-full object-cover" alt="Pan de masa madre recién horneado" src="/pickup/images/img_002.jpg" />
            <div className="absolute inset-0 bg-gradient-to-t from-on-surface/80 via-on-surface/20 to-transparent" />
          </div>
          <div className="relative z-10 px-container-margin-mobile pb-stack-lg max-w-2xl">
            <h2 className="font-headline-xl-mobile text-headline-xl-mobile text-white mb-stack-md leading-tight">
              Pan recién horneado, recogé cuando esté listo
            </h2>
            <div className="flex flex-col gap-stack-md">
              <Link
                href="/pickup/menu"
                className="bg-primary text-white font-body-lg h-14 px-8 rounded-lg flex items-center justify-center shadow-lg active:scale-[0.98] transition-all w-full md:w-fit"
              >
                Ordená tu pickup
              </Link>
              <div className="flex items-center gap-2 text-white/90">
                <span className="material-symbols-outlined text-[20px]">schedule</span>
                <span className="font-caption-caps text-caption-caps">Listo en 20 min · 5a Av 12-34, Z14</span>
              </div>
            </div>
          </div>
        </section>

        {/* Categorías */}
        <section className="py-stack-lg bg-background">
          <div className="px-container-margin-mobile mb-stack-md flex justify-between items-end">
            <h3 className="font-headline-lg text-headline-lg text-on-surface">Nuestras Especialidades</h3>
            <Link href="/pickup/menu" className="text-primary font-caption-caps text-caption-caps border-b border-primary pb-1">
              Ver todo
            </Link>
          </div>
          <div className="flex overflow-x-auto hide-scrollbar gap-gutter px-container-margin-mobile snap-x snap-mandatory">
            {CATEGORIAS_DESTACADAS.map((cat) => (
              <Link
                key={cat.slug}
                href={`/pickup/menu?categoria=${cat.slug}`}
                className="flex-shrink-0 w-48 snap-start group block"
              >
                <div className="aspect-[4/5] rounded-xl overflow-hidden mb-3 border border-outline-variant/30 shadow-sm transition-transform duration-300 group-hover:scale-[1.02]">
                  <img className="w-full h-full object-cover" alt={cat.label} src={cat.img} />
                </div>
                <span className="font-body-lg text-on-surface block text-center">{cat.label}</span>
              </Link>
            ))}
          </div>
        </section>

        {/* Newsletter */}
        <section className="mx-container-margin-mobile mb-8 p-8 rounded-2xl bg-surface-container-low border border-outline-variant/20 flex flex-col items-center text-center">
          <span className="material-symbols-outlined text-primary mb-4 text-4xl">favorite</span>
          <h4 className="font-headline-lg text-headline-lg mb-2">Unite a la familia Julia</h4>
          <p className="text-on-surface-variant font-body-md mb-6 max-w-sm">
            Recibí noticias sobre nuestros lanzamientos de temporada y eventos especiales.
          </p>
          <form
            className="w-full max-w-md flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              alert('¡Listo! Te avisamos cuando arranquemos con la newsletter.')
            }}
          >
            <input
              className="h-12 bg-white border border-outline-variant rounded-lg px-4 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="Ingresá tu correo"
              type="email"
              required
            />
            <button
              type="submit"
              className="h-12 bg-secondary text-white font-caption-caps text-caption-caps rounded-lg uppercase tracking-widest active:scale-[0.98] transition-all"
            >
              Registrate vos también
            </button>
          </form>
        </section>
      </main>

      <PickupBottomNav active="inicio" />
    </PickupShell>
  )
}
