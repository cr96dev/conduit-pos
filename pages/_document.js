// pages/_document.js
// Documento HTML inicial. Aca van los <link rel="icon"> y <meta> que se
// renderizan una sola vez en server-side. El <title> va en _app.js (con
// next/head) asi cada pagina puede sobreescribirlo si lo necesita.

import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="es">
      <Head>
        {/* Favicon: logo oficial del manual de marca (pagina "LOGO", v. canonica
            rojo sobre blanco). PNG 512x512 — los browsers lo escalan a 16/32
            para la pestaña, e iOS lo usa como apple-touch-icon. */}
        <link rel="icon" type="image/png" href="/favicon-marca.png" />
        <link rel="apple-touch-icon" href="/favicon-marca.png" />
        <meta name="theme-color" content="#C8232A" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}
