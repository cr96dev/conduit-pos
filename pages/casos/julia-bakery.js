// pages/casos/julia-bakery.js
// Caso de estudio público — Julia Bakery primer cliente piloto Conduit POS.

import Head from 'next/head'
import Link from 'next/link'

const t = {
  cream: '#FBF7F0',
  creamDeep: '#F4EEE3',
  creamDarker: '#E8E0D1',
  paperLine: '#DDD3C1',
  espresso: '#1F1411',
  ink: '#3A2A22',
  inkSoft: '#6E5C52',
  inkMute: '#9C8A7E',
  primary: '#D7461C',
  primarySoft: '#FCE4DB',
  success: '#38754D',
}

function ConduitMark({ size = 24, color = 'currentColor' }) {
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} fill={color} aria-hidden="true">
      <path d="M 95.355 25.355 A 50 50 0 1 0 95.355 94.645 L 84.041 83.331 A 34 34 0 1 1 84.041 36.669 Z"/>
      <rect x="40" y="52" width="80" height="16" rx="2"/>
    </svg>
  )
}

export default function CasoJulia() {
  return (
    <>
      <Head>
        <title>Caso Julia Bakery — Conduit POS</title>
        <meta name="description" content="Cómo Julia Bakery cerró 3 turnos en cero con Conduit POS. 100 facturas FEL, Q8,227 facturado, una sola plataforma." />
        <meta property="og:title" content="Caso Julia Bakery — Conduit POS" />
        <meta property="og:type" content="article" />
        <link rel="canonical" href="https://conduitgt.net/casos/julia-bakery" />

        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,600,700,800&f[]=switzer@400,500,600,700&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        <link rel="icon" type="image/svg+xml" href="/favicon-tomato.svg" />
      </Head>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }
        body {
          font-family: 'Switzer', system-ui, sans-serif;
          background: ${t.cream};
          color: ${t.espresso};
          line-height: 1.55;
          -webkit-font-smoothing: antialiased;
        }
        a { color: inherit; }
      `}</style>

      <main>
        {/* Top minimal nav */}
        <nav style={{
          padding: '20px 32px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          maxWidth: 1280, margin: '0 auto',
        }}>
          <Link href="/" style={{
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: 'Cabinet Grotesk, sans-serif', fontWeight: 700, fontSize: 19,
            textDecoration: 'none', color: t.espresso, letterSpacing: '-0.01em',
          }}>
            <ConduitMark size={24} color={t.primary} />
            Conduit
          </Link>
          <Link href="/" style={{
            fontSize: 13, color: t.inkSoft, textDecoration: 'none',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>← Volver al inicio</Link>
        </nav>

        {/* Hero del caso */}
        <header style={{ padding: '64px 32px 48px', maxWidth: 880, margin: '0 auto' }}>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: t.primary, marginBottom: 24,
          }}>
            <span style={{ borderLeft: `2px solid ${t.primary}`, paddingLeft: 12, marginRight: 12 }}></span>
            Caso de estudio · Cliente piloto
          </div>

          <h1 style={{
            fontFamily: 'Cabinet Grotesk, sans-serif',
            fontSize: 'clamp(40px, 6vw, 76px)', lineHeight: 1, letterSpacing: '-0.035em',
            fontWeight: 700, color: t.espresso, marginBottom: 24,
          }}>
            Julia Bakery cerró tres turnos<br/>
            con <em style={{ color: t.primary, fontStyle: 'italic', fontWeight: 500 }}>cero diferencia</em>.
          </h1>

          <p style={{
            fontSize: 20, lineHeight: 1.5, color: t.inkSoft, maxWidth: 640,
          }}>
            100 facturas FEL emitidas en un día normal. Q8,227 facturados.
            Tres cajeros operando simultáneamente. Sin Excel. Sin cuadre manual.
            Sin un solo problema.
          </p>
        </header>

        {/* Stats reales */}
        <section style={{
          background: t.espresso, color: t.cream,
          padding: '64px 32px',
        }}>
          <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 32 }}>
            {[
              { num: 'Q 8,227', label: 'Facturado el día reportado (jueves 4 jun 2026)' },
              { num: '100', label: 'Facturas FEL certificadas · 0 fallas técnicas' },
              { num: '3 / 3', label: 'Turnos cerrados con cuadre exacto · Q0 diferencia' },
              { num: '15 s', label: 'Tiempo promedio por venta · de carrito a ticket' },
            ].map(s => (
              <div key={s.label} style={{ paddingTop: 24, borderTop: '1px solid rgba(251, 247, 240, 0.18)' }}>
                <div style={{
                  fontFamily: 'Cabinet Grotesk, sans-serif',
                  fontSize: 56, fontWeight: 700, lineHeight: 1,
                  letterSpacing: '-0.03em', marginBottom: 12,
                  fontFeatureSettings: '"tnum"',
                }}>{s.num}</div>
                <div style={{ fontSize: 13, color: 'rgba(251, 247, 240, 0.6)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Cuerpo narrativo */}
        <article style={{
          maxWidth: 720, margin: '80px auto', padding: '0 32px',
          fontSize: 17, lineHeight: 1.7, color: t.ink,
        }}>

          <h2 style={H2}>El problema</h2>
          <p style={P}>
            Julia Bakery es una panadería boutique en Ciudad de Guatemala. Vende
            entre 100 y 150 productos diarios — café, pastelería, panadería
            laminada — operando con tres cajeros, una cocina y una vitrina.
          </p>
          <p style={P}>
            Antes de Conduit usaban un POS internacional con plugin de FEL
            tercerizado. Cada cierre de día tomaba 45 minutos, con Excel para
            cuadrar lo que el POS no cuadraba. Los reportes llegaban
            por correo al día siguiente. Y cada vez que la SAT cambiaba algo, el
            plugin se rompía.
          </p>

          <h2 style={H2}>La implementación</h2>
          <p style={P}>
            La migración duró cuatro horas. El equipo de Conduit configuró las
            claves Infile, importó los 252 productos del catálogo desde un
            archivo Excel exportado del POS anterior, conectó la pasarela
            Recurrente para QR, y entrenó a las dos cajeras principales
            (Dalia y Alexander) en una videollamada de 30 minutos.
          </p>
          <p style={P}>
            Esa misma tarde Julia Bakery empezó a vender con Conduit. Sin
            doble facturación. Sin transición gradual. Cambio limpio.
          </p>

          <h2 style={H2}>El resultado</h2>
          <p style={P}>
            Tres semanas después, los números hablan solos. Las facturas FEL se
            emiten en menos de 4 segundos. El cuadre de turno toma 90 segundos —
            el cajero ingresa el efectivo contado, Conduit muestra la diferencia
            exacta, y el turno cierra con un click. Si hay descuadre, la
            plataforma identifica la transacción específica donde se origina.
          </p>
          <p style={P}>
            En el día reportado en este caso de estudio (jueves 4 de junio
            2026), Julia Bakery facturó <strong>Q8,227 en 100 ventas
            certificadas</strong>. Los tres turnos del día (Alexander con
            Q5,055, Dalia con Q3,085, Kiosko autoservicio con Q87) cerraron con
            cero diferencia. Dos facturas fueron anuladas durante el día por
            razones operativas normales — el flujo de anulación funcionó sin
            intervención técnica.
          </p>

          <blockquote style={{
            background: t.cream, padding: '32px 32px 28px',
            borderLeft: `3px solid ${t.primary}`,
            borderRadius: '0 12px 12px 0',
            margin: '40px 0',
            fontFamily: 'Cabinet Grotesk, sans-serif',
            fontSize: 24, lineHeight: 1.3, letterSpacing: '-0.015em',
            fontWeight: 500, color: t.espresso, fontStyle: 'italic',
          }}>
            “Antes hacía el cuadre tres veces y nunca cuadraba. Con Conduit
            lo cierro en dos minutos. Y duermo.”
            <div style={{
              marginTop: 16, fontSize: 12, fontWeight: 600,
              color: t.inkSoft, letterSpacing: '0.05em',
              textTransform: 'uppercase', fontFamily: 'JetBrains Mono, monospace',
              fontStyle: 'normal',
            }}>
              Dalia Mishel · Cajera · Julia Bakery
            </div>
          </blockquote>

          <h2 style={H2}>Qué cambió en la operación</h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: '20px 0 40px' }}>
            {[
              ['Tiempo de cierre de día', 'De 45 minutos a 90 segundos por turno'],
              ['Diferencia de caja', 'De Q47–Q120 promedio a Q0 (cuadre exacto)'],
              ['Visibilidad', 'De reportes al día siguiente a métricas en tiempo real'],
              ['Falla FEL', 'De 1–2 por semana a 0 en 21 días de operación'],
              ['Capacitación cajero nuevo', 'De 2 días a 10 minutos'],
            ].map(([k, v]) => (
              <li key={k} style={{
                display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 24,
                padding: '16px 0', borderBottom: `1px solid ${t.paperLine}`,
                alignItems: 'baseline',
              }}>
                <span style={{ fontWeight: 600, color: t.espresso }}>{k}</span>
                <span style={{ color: t.inkSoft }}>{v}</span>
              </li>
            ))}
          </ul>

          <h2 style={H2}>Próximos pasos para Julia</h2>
          <p style={P}>
            Con la operación estable, Julia Bakery activa el módulo de PWA
            Pickup en las próximas dos semanas — los clientes podrán ordenar
            café y pastelería desde el celular y pasar a recoger sin esperar
            cola. Sigue después la integración con QuickBooks Online para
            cerrar el flujo contable completo.
          </p>
        </article>

        {/* CTA final */}
        <section style={{ padding: '0 32px 96px' }}>
          <div style={{
            maxWidth: 1080, margin: '0 auto',
            background: t.primary, color: t.cream,
            borderRadius: 28, padding: '64px 48px', textAlign: 'center',
            position: 'relative', overflow: 'hidden',
          }}>
            <h2 style={{
              fontFamily: 'Cabinet Grotesk, sans-serif',
              fontSize: 'clamp(32px, 4.5vw, 56px)', lineHeight: 1,
              letterSpacing: '-0.03em', fontWeight: 700,
              maxWidth: 640, margin: '0 auto 24px',
              position: 'relative', zIndex: 1,
            }}>
              ¿Listo para vender así?
            </h2>
            <p style={{
              fontSize: 18, color: 'rgba(251, 247, 240, 0.85)',
              maxWidth: 480, margin: '0 auto 32px', position: 'relative', zIndex: 1,
            }}>
              45 minutos de configuración. Cero contratos atados. Operando esta semana.
            </p>
            <Link href="/#cta" style={{
              display: 'inline-block', background: t.cream, color: t.primary,
              padding: '16px 36px', borderRadius: 12, textDecoration: 'none',
              fontWeight: 700, fontSize: 16, position: 'relative', zIndex: 1,
              boxShadow: '0 10px 30px rgba(31, 0, 0, 0.25)',
            }}>
              Solicitar demostración
            </Link>
          </div>
        </section>

        <footer style={{
          padding: '40px 32px', textAlign: 'center',
          color: t.inkMute, fontSize: 13, borderTop: `1px solid ${t.paperLine}`,
        }}>
          © 2026 Conduit POS · Guatemala City ·{' '}
          <Link href="/privacy" style={{ color: t.inkSoft }}>Privacidad</Link> ·{' '}
          <Link href="/terms" style={{ color: t.inkSoft }}>Términos</Link>
        </footer>
      </main>
    </>
  )
}

const H2 = {
  fontFamily: 'Cabinet Grotesk, sans-serif',
  fontSize: 32, fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em',
  color: t.espresso, marginTop: 48, marginBottom: 16,
}
const P = { marginBottom: 16 }
