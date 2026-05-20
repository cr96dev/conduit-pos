// pages/api/qbo/sync/status.js
// Devuelve el estado de salud del integrador QBO
// GET /api/qbo/sync/status

import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET' })
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.INTERNAL_API_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const now = new Date()
    const hace7dias = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

    // 1. Estado del token QBO
    const { data: token } = await supabaseAdmin
      .from('qbo_tokens')
      .select('realm_id, access_token_expires_at, refresh_token_expires_at, updated_at')
      .limit(1)
      .single()

    const accessExpires = token ? new Date(token.access_token_expires_at) : null
    const refreshExpires = token ? new Date(token.refresh_token_expires_at) : null

    const tokenStatus = {
      realm_id: token?.realm_id || null,
      access_token_status: accessExpires && accessExpires > now ? 'VALIDO' : 'EXPIRADO',
      access_token_min_restantes: accessExpires ? Math.floor((accessExpires - now) / 60000) : null,
      refresh_token_dias_restantes: refreshExpires ? Math.floor((refreshExpires - now) / 86400000) : null,
      ultima_renovacion: token?.updated_at || null
    }

    // 2. Ultimo sync exitoso
    const { data: ultimoSync } = await supabaseAdmin
      .from('qbo_sync_audit')
      .select('fecha_proceso, created_at, status')
      .eq('status', 'SUCCESS')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // 3. Stats ultimos 7 dias por categoria
    const { data: audits7d } = await supabaseAdmin
      .from('qbo_sync_audit')
      .select('categoria, status, monto_total, fel_count')
      .gte('created_at', hace7dias)

    const stats7d = {
      Combustible: { srs: 0, monto: 0, errores: 0 },
      Lubricantes: { srs: 0, monto: 0, errores: 0 },
      Tienda: { srs: 0, monto: 0, fels: 0, errores: 0 }
    }
    for (const a of audits7d || []) {
      const cat = stats7d[a.categoria]
      if (!cat) continue
      if (a.status === 'SUCCESS') {
        cat.srs++
        cat.monto += parseFloat(a.monto_total || 0)
        if (a.categoria === 'Tienda') cat.fels += a.fel_count || 0
      } else {
        cat.errores++
      }
    }

    // 4. Dias pendientes por procesar
    const [ventasPend, lubPend, tiendaPend] = await Promise.all([
      supabaseAdmin.from('ventas').select('fecha').eq('qbo_processed', false),
      supabaseAdmin.from('ventas_lubricantes').select('fecha').eq('qbo_processed', false),
      supabaseAdmin.from('tienda_facturas_fel').select('fecha').eq('qbo_processed', false)
    ])

    const diasPendientes = new Set()
    ventasPend.data?.forEach(v => diasPendientes.add(v.fecha))
    lubPend.data?.forEach(v => diasPendientes.add(v.fecha))
    tiendaPend.data?.forEach(v => diasPendientes.add(v.fecha))

    const pendientes = {
      ventas_combustible: ventasPend.data?.length || 0,
      ventas_lubricantes: lubPend.data?.length || 0,
      facturas_tienda: tiendaPend.data?.length || 0,
      dias_distintos: diasPendientes.size,
      dias_lista: Array.from(diasPendientes).sort().slice(0, 10)
    }

    // 5. Estado de FAILED y PERMANENTLY_FAILED
    const { data: errores } = await supabaseAdmin
      .from('qbo_sync_audit')
      .select('status, fecha_proceso, estacion, categoria, error_message, attempts')
      .in('status', ['FAILED', 'PERMANENTLY_FAILED'])
      .order('created_at', { ascending: false })
      .limit(20)

    // 6. Total acumulado (todos los tiempos)
    const { data: totales } = await supabaseAdmin
      .from('qbo_sync_audit')
      .select('monto_total')
      .eq('status', 'SUCCESS')

    const totalAcumulado = (totales || []).reduce((s, r) => s + parseFloat(r.monto_total || 0), 0)
    const srsAcumulados = totales?.length || 0

    // 7. Sincronia GasOps (ultimo dato disponible)
    const [ultimaVenta, ultimaLub, ultimaTienda] = await Promise.all([
      supabaseAdmin.from('ventas').select('fecha').order('fecha', { ascending: false }).limit(1).single(),
      supabaseAdmin.from('ventas_lubricantes').select('fecha').order('fecha', { ascending: false }).limit(1).single(),
      supabaseAdmin.from('tienda_facturas_fel').select('fecha').order('fecha', { ascending: false }).limit(1).single()
    ])

    const datosGasOps = {
      ultima_venta_combustible: ultimaVenta.data?.fecha,
      ultima_venta_lubricantes: ultimaLub.data?.fecha,
      ultima_fel_tienda: ultimaTienda.data?.fecha
    }

    // Determinar salud general
    let salud = 'OK'
    if (pendientes.dias_distintos > 7) salud = 'WARNING_DIAS_PENDIENTES'
    if ((errores?.length || 0) > 5) salud = 'WARNING_ERRORES'
    if (tokenStatus.refresh_token_dias_restantes !== null && tokenStatus.refresh_token_dias_restantes < 7) salud = 'CRITICAL_TOKEN'

    return res.status(200).json({
      success: true,
      generado_en: now.toISOString(),
      salud,
      token: tokenStatus,
      ultimo_sync_exitoso: ultimoSync ? {
        fecha_proceso: ultimoSync.fecha_proceso,
        hace_horas: Math.floor((now - new Date(ultimoSync.created_at)) / 3600000)
      } : null,
      stats_ultimos_7_dias: stats7d,
      pendientes,
      errores_recientes: errores || [],
      datos_gasops: datosGasOps,
      total_acumulado: {
        srs: srsAcumulados,
        monto: totalAcumulado.toFixed(2)
      }
    })

  } catch (err) {
    console.error('[Status] Error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
