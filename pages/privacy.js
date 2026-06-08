// pages/privacy.js
// Política de Privacidad de Conduit POS (plataforma B2B SaaS).
//
// Audiencia: clientes (negocios) y sus clientes finales (consumidores
// que ordenan via PWA Pickup). Cumple con la Constitución de Guatemala
// art. 31 (derecho a información), Código Tributario art. 47 (retención
// de comprobantes fiscales mínimo 4 años), y mejores prácticas LATAM.

import Link from 'next/link'

const tokens = {
  cream: '#FBF7F0',
  espresso: '#1F1411',
  ink: '#3A2A22',
  inkSoft: '#6E5C52',
  primary: '#D7461C',
  paperLine: '#DDD3C1',
}

export default function Privacy() {
  return (
    <div style={{
      maxWidth: 760,
      margin: '80px auto',
      padding: '0 24px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: 1.65,
      color: tokens.espresso,
      background: tokens.cream,
    }}>
      <Link href="/" style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        color: tokens.inkSoft, textDecoration: 'none', fontSize: 13,
        marginBottom: 48,
      }}>← Volver a Conduit POS</Link>

      <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 48, lineHeight: 1.05, letterSpacing: '-0.025em', marginBottom: 8 }}>
        Política de Privacidad
      </h1>
      <p style={{ color: tokens.inkSoft, fontSize: 14, marginBottom: 48 }}>
        Última actualización: 8 de junio de 2026 · Vigente desde la fecha de publicación
      </p>

      <h2 style={h2}>1. Quiénes somos</h2>
      <p>Conduit POS (en adelante, &quot;Conduit&quot;, &quot;nosotros&quot;) es una plataforma B2B SaaS que provee software de punto de venta, facturación electrónica (FEL), gestión de inventario y experiencia de pickup para restaurantes, panaderías y cafés en Guatemala y Centroamérica. Operamos desde Ciudad de Guatemala.</p>

      <h2 style={h2}>2. A quién aplica esta política</h2>
      <p>Esta política aplica a tres tipos de personas:</p>
      <ul style={ul}>
        <li><strong>Clientes</strong> (titulares de cuentas Conduit): dueños y operadores de negocios que contratan nuestra plataforma.</li>
        <li><strong>Usuarios autorizados</strong>: cajeros, administradores y empleados de nuestros clientes que utilizan el sistema bajo el control del cliente.</li>
        <li><strong>Consumidores finales</strong>: personas que interactúan con la plataforma de nuestros clientes (por ejemplo, ordenando vía PWA Pickup, pagando con QR o recibiendo una factura electrónica).</li>
      </ul>

      <h2 style={h2}>3. Datos que procesamos</h2>

      <h3 style={h3}>3.1 De Clientes</h3>
      <ul style={ul}>
        <li>Datos de contacto del titular (nombre, correo, teléfono, NIT, dirección).</li>
        <li>Información del negocio (nombre comercial, dirección física, configuración FEL, claves Infile, claves Recurrente).</li>
        <li>Información de facturación (método de pago de la suscripción Conduit).</li>
      </ul>

      <h3 style={h3}>3.2 De Usuarios Autorizados</h3>
      <ul style={ul}>
        <li>Nombre completo, correo electrónico, PIN de acceso (cifrado).</li>
        <li>Rol asignado por el cliente (admin, cajero).</li>
        <li>Registros de actividad (apertura/cierre de turno, ventas procesadas).</li>
      </ul>

      <h3 style={h3}>3.3 De Consumidores Finales</h3>
      <ul style={ul}>
        <li>Datos para emisión de factura electrónica (NIT, nombre, dirección si la entrega el cliente — para consumidor final no identificado, se usa &quot;CF&quot;).</li>
        <li>Datos de orden de pickup (nombre, correo opcional, teléfono opcional, dirección de recogida).</li>
        <li>Datos de transacción (montos, método de pago, fecha y hora).</li>
        <li>NO almacenamos datos de tarjeta de crédito ni débito. Esos datos son procesados directamente por Recurrente o el procesador del cliente.</li>
      </ul>

      <h2 style={h2}>4. Cómo usamos los datos</h2>
      <ul style={ul}>
        <li>Para operar la plataforma (procesar ventas, emitir facturas, registrar inventario).</li>
        <li>Para emitir documentos fiscales válidos ante la SAT a través de Infile.</li>
        <li>Para procesar pagos (vía Recurrente u otros procesadores autorizados por el Cliente).</li>
        <li>Para sincronizar información operativa con otros sistemas autorizados por el Cliente (cuando aplique).</li>
        <li>Para notificar al Cliente sobre actualizaciones, fallas de servicio y temas operativos.</li>
        <li>Para enviar a los Consumidores Finales notificaciones de pickup (confirmación, estado, recogida lista) cuando proporcionan correo o teléfono.</li>
      </ul>

      <h2 style={h2}>5. Almacenamiento y seguridad</h2>
      <p>Los datos se almacenan en bases de datos PostgreSQL administradas por Supabase, en infraestructura cloud cifrada en reposo (AES-256) y en tránsito (TLS 1.3). Cada Cliente tiene su propia base de datos aislada (un tenant por instalación). Los accesos están restringidos por Row Level Security y claves de servicio que sólo residen en el servidor.</p>
      <p>Los archivos (PDF de facturas, fotografías de productos) se almacenan en Vercel Blob o en el almacenamiento del Cliente, también cifrado.</p>

      <h2 style={h2}>6. Compartir información con terceros</h2>
      <p>No vendemos ni alquilamos datos a terceros. Compartimos datos únicamente con los siguientes servicios, y exclusivamente para procesar la transacción específica que el Cliente o Consumidor Final solicitó:</p>
      <ul style={ul}>
        <li><strong>Infile</strong> (certificación FEL) — datos necesarios para emitir el documento ante la SAT.</li>
        <li><strong>Recurrente</strong> (procesamiento de pago QR) — monto y referencia del pago.</li>
        <li><strong>Resend / proveedores de correo</strong> — para enviar notificaciones transaccionales (confirmación de pickup, recibo).</li>
        <li><strong>Vercel</strong> (hosting) — necesariamente procesa solicitudes web pero no accede al contenido de las bases de datos del Cliente.</li>
      </ul>
      <p>Cualquier solicitud legal de información (orden judicial, requerimiento SAT) será atendida según la ley aplicable, notificando al Cliente cuando esté legalmente permitido.</p>

      <h2 style={h2}>7. Retención de datos</h2>
      <p>Los registros fiscales (facturas FEL, comprobantes) se retienen por el plazo mínimo establecido por la legislación tributaria guatemalteca: <strong>cuatro (4) años</strong> contados desde la fecha de emisión, conforme al Código Tributario de Guatemala. Los datos operativos (ventas, inventario, turnos) se retienen mientras la cuenta del Cliente esté activa.</p>
      <p>Si un Cliente cancela su suscripción, ofrecemos hasta 90 días para que exporte sus datos antes de eliminarlos definitivamente de nuestros sistemas, salvo aquellos que la ley requiere conservar (información fiscal).</p>

      <h2 style={h2}>8. Derechos del titular de los datos</h2>
      <p>Como titular, usted tiene derecho a:</p>
      <ul style={ul}>
        <li>Solicitar acceso a los datos personales que poseemos sobre usted.</li>
        <li>Solicitar la corrección de datos inexactos o incompletos.</li>
        <li>Solicitar la eliminación de sus datos (cuando no exista obligación legal de retenerlos).</li>
        <li>Solicitar la portabilidad de sus datos en formato CSV o Excel.</li>
        <li>Objetar el procesamiento con fines distintos a los descritos en esta política.</li>
      </ul>
      <p>Para ejercer cualquiera de estos derechos, contáctenos por los medios indicados en la sección 12.</p>

      <h2 style={h2}>9. Cookies y tecnologías similares</h2>
      <p>Utilizamos cookies estrictamente necesarias para el funcionamiento de la plataforma (autenticación de sesión, preferencias del usuario). No utilizamos cookies de terceros con fines publicitarios. Si en el futuro implementamos analíticas web (por ejemplo, Vercel Analytics), serán anónimas y no rastrearán comportamiento entre sitios.</p>

      <h2 style={h2}>10. Menores de edad</h2>
      <p>La plataforma Conduit está dirigida a empresas y profesionales. No solicitamos ni almacenamos información de menores de edad de manera consciente. Si detectamos que se han registrado datos de un menor sin consentimiento de su representante legal, los eliminaremos a la brevedad.</p>

      <h2 style={h2}>11. Cambios a esta política</h2>
      <p>Cualquier cambio sustancial a esta política será notificado a los Clientes con al menos 30 días de anticipación a través del correo registrado y mediante un aviso en la plataforma. Los cambios menores (correcciones de redacción, actualizaciones de contactos) entrarán en vigor desde su publicación.</p>

      <h2 style={h2}>12. Aplicaciones móviles y dispositivos POS</h2>
      <p>Conduit distribuye aplicaciones Android específicas para cada Cliente (por ejemplo, Hidrocom POS, Julia Bakery POS) instaladas en dispositivos certificados Sunmi mediante distribución privada (no disponibles públicamente en Google Play).</p>
      <p>Estas aplicaciones son únicamente envolventes (wrappers) de la plataforma web del Cliente correspondiente, accesible solo desde dispositivos autorizados por número de serie:</p>
      <ul style={ul}>
        <li><strong>Permisos solicitados</strong>: acceso a Internet, estado de red, lector de código de barras integrado, impresora térmica Sunmi, servicio NeoPOS (cuando aplica) y cámara del dispositivo (utilizada exclusivamente para leer códigos de barras EAN-13/UPC/QR cuando el equipo carece de escáner físico — la imagen no se almacena ni transmite a terceros, se procesa localmente dentro de la WebView). No solicitamos ubicación, contactos, micrófono, almacenamiento externo ni acceso a redes sociales.</li>
        <li><strong>Datos generados en el dispositivo</strong>: códigos de barras escaneados durante una venta, datos de la transacción (productos, montos, método de pago, NIT receptor). Estos datos se transmiten a la base de datos del Cliente y no se almacenan localmente en el dispositivo después de cerrada la sesión.</li>
        <li><strong>Sin telemetría externa</strong>: las aplicaciones no envían analíticas, eventos o crash reports a terceros (Google Analytics, Firebase, Crashlytics, etc.). Los logs operativos quedan en la base de datos del Cliente.</li>
        <li><strong>Sin tracking entre apps</strong>: no leemos identificadores del dispositivo (IDFA, Advertising ID) ni perfilamos al usuario.</li>
        <li><strong>Distribución y actualizaciones</strong>: las aplicaciones se entregan exclusivamente a través de la Sunmi App Store privada del Cliente, autorizadas por número de serie del dispositivo. Las actualizaciones siguen el mismo canal — no hay descargas desde fuentes públicas.</li>
        <li><strong>Verificación de integridad</strong>: las builds release verifican que el APK haya sido firmado con el certificado oficial. Si el APK fue alterado, la app no inicia.</li>
      </ul>
      <p>Para solicitar la eliminación de su dispositivo de la lista de autorizados o reportar incidentes de seguridad relacionados a la aplicación móvil, contactarnos por los medios indicados abajo.</p>

      <h2 style={h2}>13. Contacto</h2>
      <p>Para preguntas, solicitudes o reclamos relacionados con esta política, contactarnos:</p>
      <p style={{ marginTop: 12 }}>
        <strong>Conduit POS</strong><br/>
        Ciudad de Guatemala, Guatemala<br/>
        Correo: privacidad@conduitgt.net<br/>
        WhatsApp: <Link href="https://wa.me/50252400222" style={{ color: tokens.primary }}>+502 5240-0222</Link>
      </p>
    </div>
  )
}

const h2 = { fontFamily: 'Georgia, serif', fontSize: 24, marginTop: 40, marginBottom: 12, color: tokens.espresso, letterSpacing: '-0.015em' }
const h3 = { fontFamily: 'Georgia, serif', fontSize: 18, marginTop: 20, marginBottom: 8, color: tokens.ink, letterSpacing: '-0.01em' }
const ul = { paddingLeft: 24, marginBottom: 12, color: tokens.ink }
