// pages/pickup/index.js
//
// Home de la app pickup de Julia Bakery. Diseño generado en Stitch
// (design-source/pickup/screens/inicio.html) y adaptado a React.
//
// Imágenes de hero/categorías sirven desde /public/pickup/images/. URLs
// originales de Google Storage están mapeadas en
// design-source/pickup/img-manifest.json.

import Link from 'next/link'
import PickupShell from '../../components/pickup/PickupShell'

const CATEGORIAS_DESTACADAS = [
  { slug: 'panes', label: 'Panes', img: '/pickup/images/img_010.jpg' },
  { slug: 'pasteleria', label: 'Pastelería', img: '/pickup/images/img_011.jpg' },
  { slug: 'bebidas', label: 'Bebidas', img: '/pickup/images/img_012.jpg' },
  { slug: 'conservas', label: 'Conservas', img: '/pickup/images/img_013.jpg' },
]

export default function PickupHome() {
  return (
    <PickupShell title="Julia Bakery — Pan recién horneado, recogé cuando esté listo">
      {/* TopAppBar */}
      <header
        id="top-app-bar"
        className="flex justify-between items-center w-full px-container-margin-mobile h-16 z-50 fixed top-0 bg-surface/80 backdrop-blur-md"
      >
        <div className="flex items-center gap-4">
          <button className="hover:opacity-80 transition-opacity active:scale-95 duration-150 text-primary">
            <span className="material-symbols-outlined">menu</span>
          </button>
          <h1 className="font-headline-lg text-headline-lg font-bold text-primary">
            Julia Bakery
          </h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/pickup/canasta" className="hover:opacity-80 transition-opacity active:scale-95 duration-150 text-primary">
            <span className="material-symbols-outlined">shopping_bag</span>
          </Link>
        </div>
      </header>

      <main className="pt-0 pb-24">
        {/* Hero Section */}
        <section className="relative h-[85vh] w-full flex flex-col justify-end overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img
              className="w-full h-full object-cover"
              alt="Macro de pan de masa madre con corteza crujiente sobre lino, luz dorada, ambiente artesanal"
              src="/pickup/images/img_002.jpg"
            />
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
                <span className="font-caption-caps text-caption-caps">
                  Listo en 20 min · 5a Av 12-34, Z14
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Categorías Destacadas */}
        <section className="py-stack-lg bg-background">
          <div className="px-container-margin-mobile mb-stack-md flex justify-between items-end">
            <h3 className="font-headline-lg text-headline-lg text-on-surface">
              Nuestras Especialidades
            </h3>
            <Link
              href="/pickup/menu"
              className="text-primary font-caption-caps text-caption-caps border-b border-primary pb-1"
            >
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
                  <img
                    className="w-full h-full object-cover"
                    alt={`Categoría ${cat.label} — Julia Bakery`}
                    src={cat.img}
                  />
                </div>
                <span className="font-body-lg text-on-surface block text-center">
                  {cat.label}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Newsletter / Familia */}
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
              // TODO: conectar a newsletter
              alert('Pronto: te avisamos cuando esté listo')
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

      {/* BottomNavBar */}
      <BottomNav active="inicio" />

      {/* Micro-interactions */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function(){
              var header = document.getElementById('top-app-bar');
              if (!header) return;
              window.addEventListener('scroll', function(){
                if (window.scrollY > 50) {
                  header.classList.add('shadow-md');
                  header.classList.remove('bg-surface/80');
                  header.classList.add('bg-surface');
                } else {
                  header.classList.remove('shadow-md');
                  header.classList.add('bg-surface/80');
                  header.classList.remove('bg-surface');
                }
              });
            })();
          `,
        }}
      />
    </PickupShell>
  )
}

// BottomNav — barra de navegación inferior persistente
function BottomNav({ active = 'inicio' }) {
  const items = [
    { key: 'inicio', href: '/pickup', icon: 'home', label: 'Inicio' },
    { key: 'menu', href: '/pickup/menu', icon: 'bakery_dining', label: 'Menú' },
    { key: 'pedidos', href: '/pickup/mis-pedidos', icon: 'receipt_long', label: 'Mis Pedidos' },
    { key: 'perfil', href: '/pickup/perfil', icon: 'person', label: 'Perfil' },
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
                : 'flex flex-col items-center justify-center text-on-surface-variant hover:text-primary transition-colors duration-200'
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
