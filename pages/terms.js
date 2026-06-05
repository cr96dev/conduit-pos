// pages/terms.js
// Términos y Condiciones de uso de Conduit POS (plataforma B2B SaaS).

import Link from 'next/link'

const tokens = {
  cream: '#FBF7F0',
  espresso: '#1F1411',
  ink: '#3A2A22',
  inkSoft: '#6E5C52',
  primary: '#D7461C',
}

export default function Terms() {
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
        Términos y Condiciones
      </h1>
      <p style={{ color: tokens.inkSoft, fontSize: 14, marginBottom: 48 }}>
        Última actualización: 5 de junio de 2026 · Vigente desde la fecha de publicación
      </p>

      <h2 style={h2}>1. Aceptación de los términos</h2>
      <p>Al contratar, instalar, acceder o utilizar la plataforma Conduit POS (en adelante, &quot;Conduit&quot;, &quot;la Plataforma&quot;, &quot;el Servicio&quot;), usted (en adelante, &quot;el Cliente&quot;) acepta de manera expresa estos Términos y Condiciones. Si no está de acuerdo con cualquier punto, debe abstenerse de utilizar el Servicio.</p>

      <h2 style={h2}>2. Descripción del servicio</h2>
      <p>Conduit es una plataforma de software como servicio (SaaS) que provee:</p>
      <ul style={ul}>
        <li>Sistema de punto de venta (POS) para cajeros y administradores.</li>
        <li>Emisión y certificación de facturación electrónica (FEL) mediante integración con Infile.</li>
        <li>Gestión de inventario, recetas y comandas.</li>
        <li>Aplicación web progresiva (PWA) para órdenes de pickup desde el celular del cliente final.</li>
        <li>Reportes operativos, cuadre de turnos y cierre de caja.</li>
        <li>Exportación de información operativa (CSV, Excel) y, cuando aplique, integraciones con sistemas autorizados por el Cliente.</li>
      </ul>

      <h2 style={h2}>3. Suscripción y precio</h2>
      <p>El servicio se contrata bajo modalidad de suscripción mensual.</p>
      <ul style={ul}>
        <li><strong>Precio:</strong> Q1,500.00 (mil quinientos quetzales) más IVA por mes, por instalación.</li>
        <li><strong>Facturación:</strong> mensual, emitida los primeros 5 días del mes siguiente al servicio prestado.</li>
        <li><strong>Plazo:</strong> no hay contrato de permanencia. La suscripción se renueva mes a mes automáticamente.</li>
        <li><strong>Métodos de pago aceptados:</strong> transferencia bancaria, QR Recurrente, tarjeta de crédito.</li>
        <li><strong>Cambios de precio:</strong> Conduit puede modificar el precio mensual con un aviso mínimo de 60 días al Cliente. El Cliente puede cancelar antes del cambio sin penalización.</li>
      </ul>

      <h2 style={h2}>4. Período de prueba</h2>
      <p>Conduit ofrece un período inicial de prueba de catorce (14) días corridos sin costo. Durante este período, el Cliente tiene acceso completo a la Plataforma. Al finalizar la prueba, si el Cliente no formaliza la suscripción, su acceso será suspendido y los datos cargados se conservarán hasta 30 días adicionales antes de eliminarse.</p>

      <h2 style={h2}>5. Implementación y migración</h2>
      <p>Conduit incluye sin costo adicional:</p>
      <ul style={ul}>
        <li>Configuración inicial de la cuenta y conexión con Infile.</li>
        <li>Migración del catálogo actual del Cliente (hasta 500 productos, formatos Excel, CSV o API exportable).</li>
        <li>Entrenamiento de hasta dos (2) usuarios autorizados via videollamada o WhatsApp.</li>
      </ul>
      <p>Migración de catálogos mayores a 500 productos o personalizaciones específicas pueden requerir cargo adicional, comunicado y aceptado por el Cliente antes de ejecutar el trabajo.</p>

      <h2 style={h2}>6. Disponibilidad del servicio (SLA)</h2>
      <p>Conduit hace su mejor esfuerzo para mantener una disponibilidad mensual del 99.5% del Servicio. La disponibilidad se calcula excluyendo:</p>
      <ul style={ul}>
        <li>Ventanas de mantenimiento programado (comunicadas con 48 horas de anticipación).</li>
        <li>Fallas atribuibles a terceros (Infile, Recurrente, proveedor de internet del Cliente).</li>
        <li>Fuerza mayor (catástrofes naturales, cortes de energía nacional, ataques cibernéticos masivos).</li>
      </ul>
      <p>Si la disponibilidad mensual cae por debajo del 99.5% por causas atribuibles a Conduit, el Cliente tiene derecho a un crédito proporcional en su siguiente factura.</p>

      <h2 style={h2}>7. Obligaciones del Cliente</h2>
      <p>El Cliente se compromete a:</p>
      <ul style={ul}>
        <li>Utilizar el Servicio conforme a la ley guatemalteca aplicable.</li>
        <li>No utilizar el Servicio para emitir facturas falsas, eludir obligaciones tributarias, ni para actividades ilícitas.</li>
        <li>Mantener confidenciales las credenciales de acceso de sus usuarios.</li>
        <li>Pagar puntualmente las facturas mensuales.</li>
        <li>Proveer información veraz al registrarse (NIT, razón social, datos de contacto).</li>
      </ul>

      <h2 style={h2}>8. Propiedad intelectual</h2>
      <p>El software, marcas, logos y documentación de Conduit son propiedad exclusiva de los titulares de Conduit POS. Esta suscripción otorga al Cliente una licencia limitada, no exclusiva, no transferible para utilizar la Plataforma durante el período de la suscripción. El Cliente no puede revender, sublicenciar, modificar, descompilar o realizar ingeniería reversa del software.</p>
      <p>Los datos cargados por el Cliente (catálogos, ventas, fotos, recetas) son propiedad del Cliente. Conduit no reclama derecho alguno sobre ellos.</p>

      <h2 style={h2}>9. Limitación de responsabilidad</h2>
      <p>En la máxima medida permitida por la ley:</p>
      <ul style={ul}>
        <li>Conduit no responde por daños indirectos, lucro cesante o pérdida de oportunidad comercial del Cliente.</li>
        <li>La responsabilidad total de Conduit ante cualquier reclamo está limitada al equivalente de tres (3) meses de la cuota mensual pagada por el Cliente.</li>
        <li>Conduit no responde por errores de los servicios de terceros integrados (Infile, Recurrente, bancos, u otros sistemas autorizados por el Cliente), aunque hará el mejor esfuerzo para resolver incidencias relacionadas.</li>
      </ul>

      <h2 style={h2}>10. Cancelación</h2>
      <p>El Cliente puede cancelar su suscripción en cualquier momento notificando por WhatsApp o correo electrónico al equipo de Conduit. La cancelación entra en vigor al final del período mensual ya pagado. No hay reembolsos parciales por días no utilizados.</p>
      <p>Al cancelar, el Cliente recibe:</p>
      <ul style={ul}>
        <li>Acceso de exportación a sus datos por 90 días adicionales (CSV, Excel).</li>
        <li>Copia respaldada de facturas FEL emitidas durante el período del servicio.</li>
        <li>Eliminación definitiva de datos operativos al final del período de exportación, salvo aquellos que la ley exige retener (registros fiscales).</li>
      </ul>

      <h2 style={h2}>11. Suspensión por incumplimiento</h2>
      <p>Conduit puede suspender el Servicio si el Cliente:</p>
      <ul style={ul}>
        <li>Se atrasa más de 15 días en el pago de la factura mensual.</li>
        <li>Utiliza el Servicio para actividades ilícitas o que violen estos Términos.</li>
        <li>Intenta acceder, comprometer o vulnerar la infraestructura de Conduit o de otros Clientes.</li>
      </ul>
      <p>En caso de suspensión, Conduit notificará al Cliente y permitirá la regularización por al menos 7 días antes de proceder a la cancelación definitiva.</p>

      <h2 style={h2}>12. Soporte técnico</h2>
      <p>Conduit ofrece soporte por WhatsApp en horario de 7:00 a 20:00, hora de Guatemala, días laborales. Para incidencias críticas (caída del Servicio, fallas que impiden vender) el equipo intentará responder dentro de los 15 minutos. Para consultas no críticas el tiempo de respuesta objetivo es de 2 horas.</p>

      <h2 style={h2}>13. Modificaciones a los términos</h2>
      <p>Conduit puede actualizar estos Términos y Condiciones de tiempo en tiempo. Los cambios sustanciales se comunicarán al Cliente por correo y aviso en la Plataforma con al menos 30 días de anticipación. El uso continuado del Servicio después de la fecha de entrada en vigor implica aceptación de los nuevos términos.</p>

      <h2 style={h2}>14. Ley aplicable y jurisdicción</h2>
      <p>Estos Términos se rigen por las leyes de la República de Guatemala. Cualquier disputa será resuelta primero por negociación de buena fe entre las partes. De no llegar a acuerdo, la disputa se someterá a la jurisdicción de los tribunales competentes de la Ciudad de Guatemala.</p>

      <h2 style={h2}>15. Contacto</h2>
      <p>Para preguntas relacionadas con estos Términos:</p>
      <p style={{ marginTop: 12 }}>
        <strong>Conduit POS</strong><br/>
        Ciudad de Guatemala, Guatemala<br/>
        Correo: legal@conduitgt.net<br/>
        WhatsApp: <Link href="https://wa.me/50252400222" style={{ color: tokens.primary }}>+502 5240-0222</Link>
      </p>
    </div>
  )
}

const h2 = { fontFamily: 'Georgia, serif', fontSize: 24, marginTop: 40, marginBottom: 12, color: tokens.espresso, letterSpacing: '-0.015em' }
const ul = { paddingLeft: 24, marginBottom: 12, color: tokens.ink }
