// pages/admin/diagnostico.js
//
// Panel de diagnostico de hardware del POS — solo admin.
// Permite probar el cajon monedero, la impresora termica y el bridge nativo
// sin tener que cobrar una venta de verdad.
//
// El bridge `window.JuliaPOS.openCashDrawer()` se inyecta desde el wrapper
// Android (MainActivity.JS_BOOTSTRAP). Si la app corre en un browser desktop
// (o un wrapper viejo), el boton avisa que no hay bridge disponible.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../../lib/supabase'
import Layout from '../../components/Layout'

export default function Diagnostico({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [bridgeInfo, setBridgeInfo] = useState({ disponible: false, version: null })
  const [resultados, setResultados] = useState([])

  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => {
        if (data?.rol !== 'admin') { router.push('/dashboard'); return }
        setPerfil(data)
      })
    // Detectar bridge nativo
    if (typeof window !== 'undefined') {
      const jp = window.JuliaPOS
      setBridgeInfo({
        disponible: !!jp,
        version: jp?.__version || null,
        cajon: typeof jp?.openCashDrawer === 'function',
        ticket: typeof jp?.printTicket === 'function',
        tarjeta: typeof jp?.startSale === 'function',
      })
    }
  }, [session])

  function logResultado(test, ok, mensaje) {
    setResultados(prev => [{
      test,
      ok,
      mensaje,
      hora: new Date().toLocaleTimeString('es-GT'),
    }, ...prev].slice(0, 20))
  }

  async function probarCajon() {
    if (!window.JuliaPOS?.openCashDrawer) {
      logResultado('Probar cajón', false, 'Bridge nativo no disponible (corre fuera del wrapper Sunmi)')
      return
    }
    logResultado('Probar cajón', null, 'Enviando 3 comandos en cascada...')
    try {
      const r = await window.JuliaPOS.openCashDrawer()
      if (r?.ok) {
        logResultado('Probar cajón', true, 'Comandos enviados. ¿Se abrió físicamente el cajón?')
      } else {
        logResultado('Probar cajón', false, r?.error_message || 'fallo desconocido')
      }
    } catch (e) {
      logResultado('Probar cajón', false, e?.message || String(e))
    }
  }

  async function probarImpresora() {
    if (!window.JuliaPOS?.printTicket) {
      logResultado('Probar impresora', false, 'Bridge nativo no disponible')
      return
    }
    logResultado('Probar impresora', null, 'Enviando ticket de prueba...')
    const payload = {
      merchantName: 'Julia Bakery',
      razonSocial: 'TICKET DE PRUEBA',
      direccion: null,
      receptorNit: '—',
      receptorNombre: 'Diagnóstico hardware',
      fecha: new Date().toLocaleString('es-GT'),
      cajeroNombre: perfil?.nombre_completo || 'admin',
      metodoPago: null,  // NO efectivo → NO dispara cajón
      items: [{ descripcion: 'Test de impresión', cantidad: '1', precioUnitario: 0, subtotal: 0 }],
      totalGravado: 0, iva: 0, total: 0,
      uuidSat: null, serieSat: null, numeroSat: null,
      certificadorNombre: null, certificadorNit: null, fechaCertificacion: null,
      textoFooter: 'Este NO es un ticket fiscal. Solo prueba de impresora.',
    }
    try {
      const r = await window.JuliaPOS.printTicket(payload)
      logResultado('Probar impresora', !!r?.ok, r?.error_message || (r?.ok ? 'Impreso OK' : 'fallo'))
    } catch (e) {
      logResultado('Probar impresora', false, e?.message || String(e))
    }
  }

  if (!perfil) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-gray-400">Cargando...</div>
  }

  return (
    <Layout perfil={perfil}>
      <Head><title>Diagnóstico hardware · Julia Bakery</title></Head>
      <div className="p-4 md:p-8 max-w-3xl mx-auto">
        <h1 className="text-xl font-bold text-gray-900 mb-1">Diagnóstico de hardware</h1>
        <p className="text-xs text-gray-500 mb-5">
          Prueba el cajón monedero, la impresora y el bridge nativo sin emitir factura real.
        </p>

        {/* Estado del bridge */}
        <div className="card-julia p-4 mb-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2">Bridge nativo</h2>
          <div className="space-y-1 text-xs">
            <Estado label="Wrapper Android" ok={bridgeInfo.disponible}
              detalle={bridgeInfo.version ? `v${bridgeInfo.version}` : 'no detectado (corre fuera del Sunmi)'} />
            <Estado label="API impresora" ok={bridgeInfo.ticket} />
            <Estado label="API cajón monedero" ok={bridgeInfo.cajon}
              detalle={bridgeInfo.cajon ? null : 'requiere wrapper 0.5.2+'} />
            <Estado label="API tarjeta integrada" ok={bridgeInfo.tarjeta} />
          </div>
        </div>

        {/* Tests */}
        <div className="card-julia p-4 mb-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">Tests</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={probarCajon} disabled={!bridgeInfo.cajon}
              className="text-base py-4 bg-julia-red text-white font-bold rounded-xl hover:bg-red-700 disabled:opacity-40">
              💰 Probar cajón
            </button>
            <button onClick={probarImpresora} disabled={!bridgeInfo.ticket}
              className="text-base py-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 disabled:opacity-40">
              🖨 Probar impresora
            </button>
          </div>
          {!bridgeInfo.disponible && (
            <div className="mt-3 bg-amber-50 border border-amber-100 text-amber-900 text-xs rounded-lg px-3 py-2">
              Esta página solo funciona dentro de la app Julia POS (wrapper Sunmi).
              Si estás en navegador desktop, los tests no se pueden ejecutar.
            </div>
          )}
        </div>

        {/* Resultados */}
        <div className="card-julia p-4">
          <h2 className="text-sm font-bold text-gray-900 mb-2">
            Resultados <span className="text-xs text-gray-400">(últimos 20)</span>
          </h2>
          {resultados.length === 0 ? (
            <div className="text-xs text-gray-400 py-3 text-center">
              Sin pruebas todavía. Tocá un botón arriba.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-gray-400">
                <tr>
                  <th className="text-left py-1 pr-2 font-medium">Hora</th>
                  <th className="text-left py-1 pr-2 font-medium">Test</th>
                  <th className="text-left py-1 font-medium">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {resultados.map((r, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="py-1.5 pr-2 text-gray-500 font-mono">{r.hora}</td>
                    <td className="py-1.5 pr-2 text-gray-700">{r.test}</td>
                    <td className="py-1.5 text-gray-600">
                      {r.ok === true && <span className="text-emerald-600">✓ </span>}
                      {r.ok === false && <span className="text-red-600">✗ </span>}
                      {r.ok === null && <span className="text-gray-400">… </span>}
                      {r.mensaje}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  )
}

function Estado({ label, ok, detalle }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-700">{label}</span>
      <span className={ok ? 'text-emerald-600 font-semibold' : 'text-gray-400'}>
        {ok ? '✓ disponible' : detalle || '— no disponible'}
      </span>
    </div>
  )
}
