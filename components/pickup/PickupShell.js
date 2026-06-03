// components/pickup/PickupShell.js
//
// Wrapper único para todas las páginas de /pickup.
// Carga Tailwind CDN con el design system "Artisan Heritage" de Stitch +
// Google Fonts (Playfair Display, Inter, Material Symbols).
//
// Por qué CDN y no el Tailwind del proyecto:
//   El POS usa convenciones de tokens propios (julia.red, surface object,
//   ink). Stitch genera convenciones Material Design 3 (primary, secondary,
//   on-surface, surface-container-low, etc.) que CHOCARÍAN con las del POS.
//   Como /pickup es un árbol Next.js independiente, cargar el CDN solo acá
//   evita reescribir ambos sistemas.
//
// Una vez que el MVP esté estable y validado, se puede migrar a Tailwind
// compilado scopeado con prefix (`pk-*`) en el bundle principal.

import Head from 'next/head'
import Script from 'next/script'

const TAILWIND_CONFIG_JSON = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Material 3 tokens del design system "Artisan Heritage" (Stitch)
        background: '#fdf9f2',
        surface: '#fdf9f2',
        'surface-bright': '#fdf9f2',
        'surface-dim': '#dddad3',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f7f3ec',
        'surface-container': '#f1ede6',
        'surface-container-high': '#ebe8e1',
        'surface-container-highest': '#e6e2db',
        'surface-variant': '#e6e2db',
        'surface-tint': '#ba1822',
        'inverse-surface': '#31302c',
        'inverse-on-surface': '#f4f0e9',

        'on-background': '#1c1c18',
        'on-surface': '#1c1c18',
        'on-surface-variant': '#5b403e',

        primary: '#a40016',
        'on-primary': '#ffffff',
        'primary-container': '#c8242a',
        'on-primary-container': '#ffe0de',
        'inverse-primary': '#ffb3ad',
        'primary-fixed': '#ffdad7',
        'primary-fixed-dim': '#ffb3ad',
        'on-primary-fixed': '#410004',
        'on-primary-fixed-variant': '#930012',

        secondary: '#7c572d',
        'on-secondary': '#ffffff',
        'secondary-container': '#fecb97',
        'on-secondary-container': '#79542a',
        'secondary-fixed': '#ffdcbc',
        'secondary-fixed-dim': '#efbd8a',
        'on-secondary-fixed': '#2c1700',
        'on-secondary-fixed-variant': '#614018',

        tertiary: '#6a4645',
        'on-tertiary': '#ffffff',
        'tertiary-container': '#845e5d',
        'on-tertiary-container': '#ffe0df',
        'tertiary-fixed': '#ffdad8',
        'tertiary-fixed-dim': '#ebbbb9',
        'on-tertiary-fixed': '#2e1414',
        'on-tertiary-fixed-variant': '#603e3d',

        error: '#ba1a1a',
        'on-error': '#ffffff',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',

        outline: '#8f6f6d',
        'outline-variant': '#e4beba',
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      spacing: {
        'container-margin-mobile': '20px',
        'container-margin-desktop': '48px',
        'stack-sm': '8px',
        'stack-md': '24px',
        'stack-lg': '48px',
        gutter: '16px',
        unit: '4px',
      },
      fontFamily: {
        'accent-tag': ['"Playfair Display"', 'serif'],
        'headline-xl': ['"Playfair Display"', 'serif'],
        'headline-xl-mobile': ['"Playfair Display"', 'serif'],
        'headline-lg': ['"Playfair Display"', 'serif'],
        'body-lg': ['"Inter"', 'sans-serif'],
        'body-md': ['"Inter"', 'sans-serif'],
        'caption-caps': ['"Inter"', 'sans-serif'],
        'price-display': ['"Inter"', 'sans-serif'],
      },
      fontSize: {
        'accent-tag': ['16px', { lineHeight: '1', fontWeight: '400' }],
        'caption-caps': ['12px', { lineHeight: '1', letterSpacing: '0.1em', fontWeight: '500' }],
        'body-lg': ['18px', { lineHeight: '1.4', fontWeight: '600' }],
        'body-md': ['15px', { lineHeight: '1.6', fontWeight: '400' }],
        'headline-xl': ['48px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-xl-mobile': ['36px', { lineHeight: '1.1', fontWeight: '700' }],
        'price-display': ['24px', { lineHeight: '1', letterSpacing: '-0.01em', fontWeight: '700' }],
        'headline-lg': ['28px', { lineHeight: '1.2', fontWeight: '500' }],
      },
    },
  },
}

const PICKUP_CSS = `
  .material-symbols-outlined {
    font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
  }
  .hide-scrollbar::-webkit-scrollbar { display: none; }
  .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

  /* Base reset solo para /pickup — no afecta al POS */
  #pickup-root { font-family: 'Inter', system-ui, sans-serif; }
  #pickup-root img { display: block; max-width: 100%; }
`

/**
 * Wrapper común para las páginas /pickup/*.
 * Uso:
 *   <PickupShell title="Inicio · Julia Bakery">
 *     <main>...</main>
 *   </PickupShell>
 */
export default function PickupShell({ children, title = 'Julia Bakery' }) {
  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        {/* Fonts */}
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
        {/* Tailwind config inline ANTES de cargar Tailwind */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.tailwind = window.tailwind || {}; window.tailwind.config = ${JSON.stringify(
              TAILWIND_CONFIG_JSON,
            )};`,
          }}
        />
        <style dangerouslySetInnerHTML={{ __html: PICKUP_CSS }} />
      </Head>
      {/* Tailwind CDN — solo en /pickup */}
      <Script
        src="https://cdn.tailwindcss.com?plugins=forms,container-queries"
        strategy="beforeInteractive"
      />
      <div id="pickup-root" className="bg-background text-on-surface min-h-screen">
        {children}
      </div>
    </>
  )
}
