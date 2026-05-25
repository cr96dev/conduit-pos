// pages/_document.js
// Documento HTML inicial. Aca van los <link rel="icon"> y <meta> que se
// renderizan una sola vez en server-side. El <title> va en _app.js (con
// next/head) asi cada pagina puede sobreescribirlo si lo necesita.

import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="es">
      <Head>
        {/* Favicon: SVG vectorial para browsers modernos (se ve nitido en
            cualquier tamaño), PNG raster como fallback / apple-touch-icon. */}
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="alternate icon" type="image/png" href="/logo.png" />
        <link rel="apple-touch-icon" href="/logo.png" />
        <meta name="theme-color" content="#8B5A3C" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
