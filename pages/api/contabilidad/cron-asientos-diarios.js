// pages/api/contabilidad/cron-asientos-diarios.js
//
// Cron diario que procesa asientos contables pendientes:
// - Ventas combustible nuevas (modelo custodia UNO)
// - Ventas tienda + COGS tienda
// - Ventas lubricantes + COGS lubricantes
// - Compras FEL con estación
//
// Schedule: 0 9 * * * (9:00 UTC = 3:00 AM GT, después del sync FEL)
//
// Las compras_fel SIN estación NO entran al cron — esas las clasifica
// Willian manualmente desde /contabilidad/compras-pendientes.
//
// La RPC ejecutar_cron_asientos() en Supabase es idempotente:
// - Solo genera asientos que NO existen aún
// - Procesa últimos 7 días (margen de seguridad por delays de FEL)
// - Guarda log en tabla cron_asientos_log

import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // Verificar autenticación (Vercel Cron envía un header especial)
  const authHeader = req.headers.authorization
  const expectedSecret = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET
  
  // Permitir GET (Vercel cron) y POST (manual con secret)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  // Vercel cron incluye este header automáticamente
  const isVercelCron = req.headers['user-agent']?.includes('vercel-cron')
  const hasValidSecret = authHeader === `Bearer ${expectedSecret}`
  
  if (!isVercelCron && !hasValidSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const inicio = Date.now()
  
  try {
    // Conexión con service role para llamar la RPC
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    
    // Llamar la RPC maestra
    const origen = isVercelCron ? 'vercel_cron' : 'manual_post'
    const { data, error } = await supabase.rpc('ejecutar_cron_asientos', {
      p_origen: origen
    })
    
    if (error) {
      console.error('Error ejecutar_cron_asientos:', error)
      return res.status(500).json({ 
        ok: false, 
        error: error.message,
        details: error
      })
    }
    
    const duracion = ((Date.now() - inicio) / 1000).toFixed(2)
    
    // Log para Vercel logs
    console.log(`[cron-asientos-diarios] ${origen} | ${duracion}s | ${data.total_asientos_nuevos} asientos`)
    console.log(JSON.stringify(data, null, 2))
    
    return res.status(200).json({
      ok: true,
      duracion_segundos: parseFloat(duracion),
      resultado: data
    })
    
  } catch (e) {
    console.error('Excepción cron-asientos:', e)
    return res.status(500).json({ 
      ok: false, 
      error: e.message,
      stack: e.stack
    })
  }
}

export const config = {
  maxDuration: 60
}
