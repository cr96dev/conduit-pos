// pages/privacy.js
// Politica de Privacidad de Julia Bakery (plataforma interna de operaciones).

export default function Privacy() {
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', padding: 24, fontFamily: 'system-ui, sans-serif', lineHeight: 1.6, color: '#1f2937' }}>
      <h1>Política de Privacidad</h1>
      <p><strong>Última actualización:</strong> 27 de mayo de 2026</p>

      <h2>1. Introducción</h2>
      <p>Esta Política de Privacidad describe cómo Julia Bakery (Ciudad de Guatemala, Guatemala) maneja la información procesada a través de su plataforma interna de operaciones (la &quot;Aplicación&quot;), utilizada para administrar ventas, inventario, recetas, planillas, contabilidad y la integración con servicios externos (Loyverse POS, QuickBooks Online y servicios de facturación electrónica).</p>

      <h2>2. Alcance</h2>
      <p>La Aplicación es una herramienta interna utilizada exclusivamente por el personal autorizado de Julia Bakery para gestionar las operaciones del negocio. No se ofrece al público general ni a terceros.</p>

      <h2>3. Datos que se procesan</h2>
      <p>La Aplicación procesa los siguientes tipos de información:</p>
      <ul>
        <li>Datos de ventas y transacciones provenientes del POS (Loyverse) y de la facturación electrónica.</li>
        <li>Datos de empleados necesarios para nómina y obligaciones laborales (DPI, NIT, IGSS, salario, fechas).</li>
        <li>Datos de proveedores e insumos (catálogo, costos, movimientos de inventario).</li>
        <li>Datos contables (plan de cuentas, asientos, mappings) y bancarios (movimientos importados de los extractos).</li>
        <li>Tokens de autenticación OAuth para los servicios integrados.</li>
      </ul>

      <h2>4. Almacenamiento</h2>
      <p>Los datos se almacenan en Supabase (Postgres administrado, cifrado en reposo). El acceso a la base de datos está restringido mediante Row Level Security y claves de servicio que sólo residen en el entorno del servidor.</p>

      <h2>5. Compartir información</h2>
      <p>Julia Bakery no comparte, vende ni distribuye la información procesada a través de la Aplicación con terceros. Las integraciones con servicios externos (Loyverse, QuickBooks Online, certificador FEL) se realizan exclusivamente con las cuentas propias del negocio.</p>

      <h2>6. Retención de datos</h2>
      <p>Los registros contables y fiscales se conservan según los plazos exigidos por la legislación tributaria guatemalteca (mínimo 5 años). Los tokens OAuth se conservan hasta que son revocados.</p>

      <h2>7. Seguridad</h2>
      <p>La Aplicación implementa medidas de seguridad estándar de la industria: autenticación OAuth 2.0 con los servicios integrados, HTTPS, gestión de secretos mediante variables de entorno, y políticas de Row Level Security en la base de datos.</p>

      <h2>8. Derechos del personal</h2>
      <p>Los controles de acceso de la Aplicación se administran internamente. Para preguntas relativas al manejo de datos, contactar al administrador de Julia Bakery.</p>

      <h2>9. Cambios a esta política</h2>
      <p>Esta Política de Privacidad puede actualizarse periódicamente. Las versiones actualizadas se publicarán en esta URL.</p>

      <h2>10. Contacto</h2>
      <p>Julia Bakery<br/>Ciudad de Guatemala, Guatemala</p>
    </div>
  )
}
