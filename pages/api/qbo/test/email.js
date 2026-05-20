// pages/api/qbo/test/email.js
// Test endpoint para validar que Brevo funciona

import { enviarReporteSync } from '../../../../lib/qbo/emailAlerts'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // Datos de prueba simulando un sync OK (con datos reales de tu Q1.16M del 2026-05-05)
  const resultadoSimulado = {
    combustible: {
      exitos: 12,
      errores: 0,
      detalle: [
        { estacion: 'Diagonal 6', sr_id: '146', monto: 307472.27 },
        { estacion: 'Hincapie', sr_id: '156', monto: 104079.38 },
        { estacion: 'Km 7', sr_id: '148', monto: 97855.97 },
        { estacion: 'Petapa', sr_id: '149', monto: 92134.64 },
        { estacion: 'Mirador', sr_id: '150', monto: 89673.83 },
        { estacion: 'San Pedrito', sr_id: '147', monto: 88059.80 },
        { estacion: 'Ciudad Quetzal', sr_id: '152', monto: 85756.14 },
        { estacion: 'Mateo Flores', sr_id: '153', monto: 76626.80 },
        { estacion: 'Brisas', sr_id: '155', monto: 64857.89 },
        { estacion: 'Km 13', sr_id: '151', monto: 60229.24 },
        { estacion: 'Rivera del Rio', sr_id: '157', monto: 52496.42 },
        { estacion: 'San Cristobal', sr_id: '154', monto: 43029.29 }
      ]
    },
    lubricantes: {
      exitos: 10,
      errores: 0,
      detalle: [
        { estacion: 'Hincapie', sr_id: '176', monto: 869 },
        { estacion: 'Km 7', sr_id: '177', monto: 741 },
        { estacion: 'Mirador', sr_id: '175', monto: 544.5 },
        { estacion: 'Ciudad Quetzal', sr_id: '171', monto: 429 },
        { estacion: 'Brisas', sr_id: '178', monto: 288 },
        { estacion: 'Petapa', sr_id: '173', monto: 274 },
        { estacion: 'San Cristobal', sr_id: '172', monto: 180.5 },
        { estacion: 'Rivera del Rio', sr_id: '174', monto: 127 },
        { estacion: 'Mateo Flores', sr_id: '179', monto: 121.5 },
        { estacion: 'San Pedrito', sr_id: '170', monto: 120 }
      ]
    },
    tienda: {
      exitos: 1,
      errores: 0,
      detalle: [
        { estacion: 'Diagonal 6', sr_id: '201', monto: 17802.42, fels: 437, lineas: 8 }
      ]
    }
  }

  const resultado = await enviarReporteSync(resultadoSimulado, '2026-05-12 (TEST)', '15.42')
  return res.status(200).json({
    test: true,
    brevo_resultado: resultado,
    vars_check: {
      BREVO_API_KEY: process.env.BREVO_API_KEY ? 'configurado' : 'FALTA',
      ALERT_EMAIL_FROM: process.env.ALERT_EMAIL_FROM || 'FALTA',
      ALERT_EMAIL_FROM_NAME: process.env.ALERT_EMAIL_FROM_NAME || 'FALTA',
      ALERT_EMAIL_TO: process.env.ALERT_EMAIL_TO || 'FALTA'
    }
  })
}
