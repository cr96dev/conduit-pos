// components/pickup/PickupShell.js
//
// Wrapper único para todas las páginas de /pickup.
// Carga el CSS Tailwind pre-compilado desde /pickup/styles.css (scoped a
// #pickup-root con `important` para no chocar con el Tailwind del POS).
//
// El CSS se genera en build con:
//   npm run build:pickup-css
// que corre `tailwindcss -c tailwind.pickup.config.js`. Ese script ya está
// encadenado en `npm run build` y `npm run dev`.

import Head from 'next/head'

export default function PickupShell({ children, title = 'Julia Bakery' }) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        {/* Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        {/* Tailwind compilado solo para /pickup, scoped a #pickup-root */}
        <link rel="stylesheet" href="/pickup/styles.css" />
      </Head>
      <div id="pickup-root">
        {children}
      </div>
    </>
  )
}
