// pages/kiosko.js
//
// La interfaz "premium" del kiosko se retiró el 2026-06-01.
// El nuevo modelo: el K2 Mini se loguea como cajero normal con PIN propio
// y un flag `es_kiosko` en su perfil; el POS oculta efectivo + bandeja
// Pedidos Ya cuando ese cajero está activo. Así reutilizamos la misma UI
// de /pos en vez de mantener una segunda interfaz.
//
// Esta página solo redirige al login de cajero. Se mantiene el archivo para
// no romper bookmarks o accesos directos al K2.

import { useEffect } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

export default function KioskoRedirect() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/cajero-login')
  }, [])
  return (
    <>
      <Head><title>Kiosko · Julia Bakery</title></Head>
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-sm text-gray-400">
        Redirigiendo…
      </div>
    </>
  )
}
