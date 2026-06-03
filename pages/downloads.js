// pages/downloads.js
// Página simple para descargar el wrapper APK Julia POS desde un Sunmi
// nuevo (K2 mini, D3, D2s, etc) sin pasar por el Sunmi App Store privado.
//
// Servida en https://juliabakery.com/downloads (y previews).
//
// El archivo APK debe estar en /public/julia-pos-X.Y.Z.apk. Para actualizar:
//   1. Compilar release: cd android && ./build-release.sh
//   2. Copiar android/app/build/outputs/apk/release/app-release.apk → public/
//   3. Actualizar la constante APK_LATEST abajo + commit + push.

import Head from 'next/head'

const APK_LATEST = {
  filename: 'julia-pos-0.5.3.apk',
  version: '0.5.3',
  size: '~6 MB',
  changes: [
    'Cashbox: cascada de comandos para asegurar apertura del cajón',
    'Wrapper drawer + soporte K2 mini',
    'Modo armador K2 (web, sin recompile)',
  ],
}

export default function Downloads() {
  const apkUrl = `/${APK_LATEST.filename}`

  return (
    <>
      <Head>
        <title>Descargar Julia POS · Julia Bakery</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main style={{
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#fdf9f2',
        minHeight: '100vh',
        padding: '40px 20px',
        color: '#1c1c18',
      }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>

          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <img src="/logo.png" alt="Julia Bakery" style={{ height: 80, marginBottom: 16 }} />
            <h1 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>Julia POS · Wrapper</h1>
            <p style={{ color: '#5b403e', marginTop: 4 }}>Aplicación para Sunmi P3 Mix, K2 mini, D3</p>
          </div>

          <div style={{
            background: '#fff',
            border: '1px solid #e4beba',
            borderRadius: 16,
            padding: 24,
            marginBottom: 24,
          }}>
            <div style={{ fontSize: 12, color: '#5b403e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
              Versión más reciente
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color: '#a40016', marginBottom: 4 }}>
              v{APK_LATEST.version}
            </div>
            <div style={{ fontSize: 14, color: '#6a4645', marginBottom: 20 }}>
              Tamaño: {APK_LATEST.size}
            </div>

            <a
              href={apkUrl}
              download
              style={{
                display: 'block',
                width: '100%',
                background: '#c8242a',
                color: '#fff',
                textAlign: 'center',
                padding: '16px 0',
                borderRadius: 12,
                fontSize: 18,
                fontWeight: 600,
                textDecoration: 'none',
                marginBottom: 8,
              }}
            >
              ⬇ Descargar APK
            </a>
            <div style={{ fontSize: 12, color: '#8f6f6d', textAlign: 'center' }}>
              Tu navegador te va a pedir confirmar
            </div>
          </div>

          <div style={{
            background: '#fff',
            border: '1px solid #e4beba',
            borderRadius: 16,
            padding: 24,
            marginBottom: 24,
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginTop: 0, marginBottom: 12 }}>
              Cómo instalar
            </h2>
            <ol style={{ paddingLeft: 20, color: '#1c1c18', fontSize: 15, lineHeight: 1.6 }}>
              <li>Tocá <strong>"Descargar APK"</strong> arriba.</li>
              <li>Cuando el navegador te pregunte si querés permitir descarga, decí <strong>"Sí"</strong>.</li>
              <li>Una vez que termine, tocá la notificación de descarga.</li>
              <li>
                Si Android te dice <em>"Instalación bloqueada — fuentes desconocidas"</em>,
                tocá <strong>"Configuración"</strong> y activá el permiso para Chrome
                (o el navegador que estés usando).
              </li>
              <li>Volvé y tocá <strong>"Instalar"</strong>.</li>
              <li>Cuando termine, abrí <strong>Julia POS</strong> desde la pantalla de inicio.</li>
            </ol>
          </div>

          {APK_LATEST.changes?.length > 0 && (
            <div style={{
              background: '#f7f3ec',
              border: '1px solid #e4beba',
              borderRadius: 16,
              padding: 24,
            }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, marginTop: 0, marginBottom: 12 }}>
                Qué cambia en esta versión
              </h2>
              <ul style={{ paddingLeft: 20, color: '#1c1c18', fontSize: 14, lineHeight: 1.6, margin: 0 }}>
                {APK_LATEST.changes.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: 32, fontSize: 12, color: '#8f6f6d' }}>
            Julia Bakery · Página interna de instalación
          </div>
        </div>
      </main>
    </>
  )
}
