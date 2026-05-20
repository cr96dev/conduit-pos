// pages/api/qbo/sync/daily.js
// Procesa: combustible + lubricantes + tienda (todo CF agrupado por categoria)
// Envia email de resumen via Brevo al finalizar

import { qboApi } from '../../../../lib/qbo/apiClient'
import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'
import { enviarReporteSync, enviarErrorFatal } from '../../../../lib/qbo/emailAlerts'

const OAKLAND_ID = '85da69a8-1e81-48a7-8b0d-82df9eeec15e'

// Categorizacion regex de items de tienda
function categorizarItem(descripcion) {
  const d = (descripcion || '').toUpperCase()
  if (d.match(/GALLO|MICHELADA|MICHELOB|CORONA|CABRO|MONTECARLO|CERVEZA|BREVA|HEINEKEN|MODELO|VICTORIA|VINO|RON|RHUM|WHISKY|VODKA|TEQUILA|GINEBRA|LICOR|JAGERMEISTER|SMIRNOFF|FOUR LOKO|VENADO/)) return 'TIENDA-BEBIDAS-ALC'
  if (d.match(/COCA|FANTA|SPRITE|PEPSI|GASEOSA|JUGO|HIDRAVIDA|SALVAVIDAS|AGUA |HATSU|GATORADE|POWERADE|MONSTER ENERGY|MONSTER GREEN|MONSTER ULTRA|RED BULL|TE FRIO|DASANI|SALUTARIS|SOBE|OKF|HIELO|FRAPPE|SMOOTHIE/)) return 'TIENDA-BEBIDAS-SOFT'
  if (d.match(/CAFE|CAPPUCCINO|EXPRESS|LATTE|MOCHA|CAFÉ/)) return 'TIENDA-CAFE'
  if (d.match(/MARLBORO|VUSE|TEREA|ALASKA|PALL MALL|CIGARRO|TABACO|VAPER|CIGARRILLO|PUFF|LUCKY STRIKE/)) return 'TIENDA-CIGARROS'
  if (d.match(/PAPALINAS|LAYS|CHIPS|OREO|GALLETA|CHEETOS|DORITOS|CHOCOLATE|SNACK|SABRITAS|KARATE|CHEEZ|SUSHI|JALAP|BOLSONA|NACHOS|TRIDENT|CHICLE|SARITA|HELADO|PIE DE|HALLS|MOSTAZA/)) return 'TIENDA-SNACKS'
  if (d.match(/HOT DOG|MONSTER DOG|CHEESE BACON|PEPPERONI|PIZZA|POLLONAZO|MUFFIN|CROISSANT|DONA|PAN |CIABATTA|HAMBURGUESA|TAQUITO|EMPANADA|BURRITO|SANDWICH|EMPAREDADO|SAND ENS|TAMAL|GARNACHA|TACO|QUESADILLA/)) return 'TIENDA-COMIDA'
  if (d.match(/HELIX|ACEITE|LUBRICANTE|MOTUL|MOBIL|CASTROL|VALVOLINE|REFRIGERANTE|ANTICONGELANTE|LIMPIA|FRENO/)) return 'TIENDA-AUTOMOTRIZ'
  return 'TIENDA-OTROS'
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Use POST or GET' })
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.INTERNAL_API_SECRET}` && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  const fechaDefault = ayer.toISOString().split('T')[0]
  const fecha = req.query.fecha || fechaDefault

  const startTime = Date.now()
  const resultados = {
    combustible: { exitos: 0, errores: 0, omitidos: 0, detalle: [] },
    lubricantes: { exitos: 0, errores: 0, omitidos: 0, detalle: [] },
    tienda: { exitos: 0, errores: 0, omitidos: 0, detalle: [] }
  }

  try {
    // Cargar mapeos
    const [estacionesRes, customersRes, itemsRes] = await Promise.all([
      supabaseAdmin.from('qbo_mapping_estaciones').select('*').eq('activo', true),
      supabaseAdmin.from('qbo_mapping_customers').select('*').eq('activo', true).eq('qbo_customer_type', 'CF_BY_STATION'),
      supabaseAdmin.from('qbo_mapping_skus').select('*').eq('activo', true)
    ])

    const estacionesByGasOpsId = {}
    estacionesRes.data?.forEach(e => { if (e.gasops_estacion_id) estacionesByGasOpsId[e.gasops_estacion_id] = e })

    const customersByEstacion = {}
    customersRes.data?.forEach(c => { customersByEstacion[c.estacion_codigo] = c })

    const itemsBySku = {}
    itemsRes.data?.forEach(i => { itemsBySku[i.sku] = i })

    // ============================================
    // 1. COMBUSTIBLE
    // ============================================
    const { data: ventasCombustible } = await supabaseAdmin
      .from('ventas').select('*').eq('fecha', fecha).eq('qbo_processed', false)

    for (const venta of ventasCombustible || []) {
      const estacion = estacionesByGasOpsId[venta.estacion_id]
      if (!estacion) { resultados.combustible.errores++; continue }
      const customer = customersByEstacion[estacion.estacion_codigo]
      if (!customer) { resultados.combustible.errores++; continue }

      const lines = []
      const productos = [
        { sku: 'COMB-REG', litros: venta.regular_litros, ingresos: venta.regular_ingresos, nombre: 'Combustible Regular' },
        { sku: 'COMB-PREM', litros: venta.premium_litros, ingresos: venta.premium_ingresos, nombre: 'Combustible Premium' },
        { sku: 'COMB-DIESEL', litros: venta.diesel_litros, ingresos: venta.diesel_ingresos, nombre: 'Diesel' },
        { sku: 'COMB-DIESELP', litros: venta.diesel_plus_litros, ingresos: venta.diesel_plus_ingresos, nombre: 'Diesel Plus' }
      ]
      for (const p of productos) {
        const ingresos = parseFloat(p.ingresos || 0)
        if (ingresos > 0) {
          lines.push({
            DetailType: 'SalesItemLineDetail',
            Amount: ingresos,
            Description: `${p.nombre} - ${p.litros} litros`,
            SalesItemLineDetail: {
              ItemRef: { value: itemsBySku[p.sku].qbo_item_id },
              Qty: parseFloat(p.litros),
              ClassRef: { value: estacion.qbo_class_id }
            }
          })
        }
      }

      if (lines.length === 0) {
        resultados.combustible.omitidos++
        await supabaseAdmin.from('ventas').update({ qbo_processed: true, qbo_sales_receipt_id: 'SKIPPED', qbo_processed_at: new Date().toISOString() }).eq('id', venta.id)
        continue
      }

      try {
        const result = await qboApi('POST', '/salesreceipt', {
          TxnDate: fecha,
          CustomerRef: { value: customer.qbo_customer_id },
          ClassRef: { value: estacion.qbo_class_id },
          Line: lines,
          PrivateNote: `Auto: combustible ${estacion.estacion_codigo} ${fecha}`
        })
        const sr = result.SalesReceipt
        await supabaseAdmin.from('ventas').update({ qbo_processed: true, qbo_sales_receipt_id: sr.Id, qbo_processed_at: new Date().toISOString() }).eq('id', venta.id)
        await supabaseAdmin.from('qbo_sync_audit').insert({
          fecha_proceso: fecha, bucket_key: `${fecha}|${estacion.estacion_codigo}|Combustible|CF`,
          estacion: estacion.estacion_codigo, categoria: 'Combustible', customer_type: 'CF',
          customer_nit: customer.nit, fel_count: 1, fel_ids: [venta.id],
          monto_total: parseFloat(sr.TotalAmt), qbo_sales_receipt_id: sr.Id, status: 'SUCCESS', attempts: 1
        })
        resultados.combustible.exitos++
        resultados.combustible.detalle.push({ estacion: estacion.estacion_nombre, sr_id: sr.Id, monto: sr.TotalAmt })
      } catch (err) {
        resultados.combustible.errores++
        resultados.combustible.detalle.push({ estacion: estacion.estacion_nombre, error: err.message })
      }
    }

    // ============================================
    // 2. LUBRICANTES
    // ============================================
    const { data: ventasLub } = await supabaseAdmin
      .from('ventas_lubricantes').select('*, ventas_lubricantes_detalle(*)')
      .eq('fecha', fecha).eq('qbo_processed', false)

    for (const venta of ventasLub || []) {
      const estacion = estacionesByGasOpsId[venta.estacion_id]
      if (!estacion) { resultados.lubricantes.errores++; continue }
      const customer = customersByEstacion[estacion.estacion_codigo]
      if (!customer) { resultados.lubricantes.errores++; continue }

      const totalVenta = parseFloat(venta.total_venta || 0)
      if (totalVenta <= 0) {
        resultados.lubricantes.omitidos++
        await supabaseAdmin.from('ventas_lubricantes').update({ qbo_processed: true, qbo_sales_receipt_id: 'SKIPPED', qbo_processed_at: new Date().toISOString() }).eq('id', venta.id)
        continue
      }

      const detalles = venta.ventas_lubricantes_detalle || []
      const lines = []
      if (detalles.length > 0) {
        for (const d of detalles) {
          lines.push({
            DetailType: 'SalesItemLineDetail',
            Amount: parseFloat(d.subtotal),
            Description: `${d.nombre || d.sku} x${d.cantidad}`,
            SalesItemLineDetail: {
              ItemRef: { value: itemsBySku['LUB-GEN'].qbo_item_id },
              Qty: parseFloat(d.cantidad || 1),
              UnitPrice: parseFloat(d.precio_unitario || d.subtotal),
              ClassRef: { value: estacion.qbo_class_id }
            }
          })
        }
      } else {
        lines.push({
          DetailType: 'SalesItemLineDetail', Amount: totalVenta, Description: `Lubricantes - venta agregada`,
          SalesItemLineDetail: {
            ItemRef: { value: itemsBySku['LUB-GEN'].qbo_item_id },
            Qty: 1, UnitPrice: totalVenta,
            ClassRef: { value: estacion.qbo_class_id }
          }
        })
      }

      try {
        const result = await qboApi('POST', '/salesreceipt', {
          TxnDate: fecha,
          CustomerRef: { value: customer.qbo_customer_id },
          ClassRef: { value: estacion.qbo_class_id },
          Line: lines,
          PrivateNote: `Auto: lubricantes ${estacion.estacion_codigo} ${fecha}`
        })
        const sr = result.SalesReceipt
        await supabaseAdmin.from('ventas_lubricantes').update({ qbo_processed: true, qbo_sales_receipt_id: sr.Id, qbo_processed_at: new Date().toISOString() }).eq('id', venta.id)
        await supabaseAdmin.from('qbo_sync_audit').insert({
          fecha_proceso: fecha, bucket_key: `${fecha}|${estacion.estacion_codigo}|Lubricantes|CF`,
          estacion: estacion.estacion_codigo, categoria: 'Lubricantes', customer_type: 'CF',
          customer_nit: customer.nit, fel_count: detalles.length || 1, fel_ids: [venta.id],
          monto_total: parseFloat(sr.TotalAmt), qbo_sales_receipt_id: sr.Id, status: 'SUCCESS', attempts: 1
        })
        resultados.lubricantes.exitos++
        resultados.lubricantes.detalle.push({ estacion: estacion.estacion_nombre, sr_id: sr.Id, monto: sr.TotalAmt })
      } catch (err) {
        resultados.lubricantes.errores++
        resultados.lubricantes.detalle.push({ estacion: estacion.estacion_nombre, error: err.message })
      }
    }

    // ============================================
    // 3. TIENDA (todo CF, agrupado por categoria, solo Oakland)
    // ============================================
    const { data: tiendaFels } = await supabaseAdmin
      .from('tienda_facturas_fel').select('id, fecha, monto, estacion_id, tienda_facturas_fel_items(descripcion, cantidad, total)')
      .eq('fecha', fecha).eq('qbo_processed', false)

    if (tiendaFels && tiendaFels.length > 0) {
      const porEstacion = {}
      for (const fel of tiendaFels) {
        const estId = fel.estacion_id || OAKLAND_ID
        if (!porEstacion[estId]) porEstacion[estId] = []
        porEstacion[estId].push(fel)
      }

      for (const estacionId of Object.keys(porEstacion)) {
        const estacion = estacionesByGasOpsId[estacionId]
        if (!estacion) { resultados.tienda.errores++; continue }
        const customer = customersByEstacion[estacion.estacion_codigo]
        if (!customer) { resultados.tienda.errores++; continue }

        const felsEst = porEstacion[estacionId]

        const porCategoria = {}
        let monto_sin_items = 0
        const fel_ids_procesados = []

        for (const fel of felsEst) {
          fel_ids_procesados.push(fel.id)
          const items = fel.tienda_facturas_fel_items || []
          if (items.length === 0) {
            monto_sin_items += parseFloat(fel.monto || 0)
            continue
          }
          for (const item of items) {
            const cat = categorizarItem(item.descripcion)
            if (!porCategoria[cat]) porCategoria[cat] = { total: 0, count: 0 }
            porCategoria[cat].total += parseFloat(item.total || 0)
            porCategoria[cat].count += 1
          }
        }

        if (monto_sin_items > 0) {
          if (!porCategoria['TIENDA-OTROS']) porCategoria['TIENDA-OTROS'] = { total: 0, count: 0 }
          porCategoria['TIENDA-OTROS'].total += monto_sin_items
        }

        const lines = []
        for (const [cat, data] of Object.entries(porCategoria)) {
          if (data.total <= 0) continue
          const item = itemsBySku[cat]
          if (!item || item.qbo_item_id === 'TBD') {
            resultados.tienda.errores++
            resultados.tienda.detalle.push({ estacion: estacion.estacion_nombre, error: `Item ${cat} no creado en QBO` })
            continue
          }
          lines.push({
            DetailType: 'SalesItemLineDetail',
            Amount: parseFloat(data.total.toFixed(2)),
            Description: `${item.descripcion} (${data.count} items)`,
            SalesItemLineDetail: {
              ItemRef: { value: item.qbo_item_id },
              Qty: 1,
              ClassRef: { value: estacion.qbo_class_id }
            }
          })
        }

        if (lines.length === 0) {
          resultados.tienda.omitidos++
          continue
        }

        try {
          const result = await qboApi('POST', '/salesreceipt', {
            TxnDate: fecha,
            CustomerRef: { value: customer.qbo_customer_id },
            ClassRef: { value: estacion.qbo_class_id },
            Line: lines,
            PrivateNote: `Auto: tienda ${estacion.estacion_codigo} ${fecha} (${felsEst.length} FEL)`
          })
          const sr = result.SalesReceipt

          await supabaseAdmin.from('tienda_facturas_fel')
            .update({ qbo_processed: true, qbo_sales_receipt_id: sr.Id, qbo_processed_at: new Date().toISOString() })
            .in('id', fel_ids_procesados)

          await supabaseAdmin.from('qbo_sync_audit').insert({
            fecha_proceso: fecha, bucket_key: `${fecha}|${estacion.estacion_codigo}|Tienda|CF`,
            estacion: estacion.estacion_codigo, categoria: 'Tienda', customer_type: 'CF',
            customer_nit: customer.nit, fel_count: felsEst.length, fel_ids: fel_ids_procesados,
            monto_total: parseFloat(sr.TotalAmt), qbo_sales_receipt_id: sr.Id, status: 'SUCCESS', attempts: 1
          })

          resultados.tienda.exitos++
          resultados.tienda.detalle.push({
            estacion: estacion.estacion_nombre, sr_id: sr.Id, monto: sr.TotalAmt,
            fels: felsEst.length, lineas: lines.length
          })
        } catch (err) {
          resultados.tienda.errores++
          resultados.tienda.detalle.push({ estacion: estacion.estacion_nombre, error: err.message })
        }
      }
    }

    const duracionMs = Date.now() - startTime
    const duracionSeg = (duracionMs / 1000).toFixed(2)

    // Enviar email de resumen (no bloqueante)
    try {
      await enviarReporteSync(resultados, fecha, duracionSeg)
    } catch (emailErr) {
      console.error('[Sync] Email error (no critico):', emailErr.message)
    }

    return res.status(200).json({
      success: true,
      fecha,
      duracion_ms: duracionMs,
      duracion_seg: duracionSeg,
      resultados
    })
  } catch (err) {
    // Enviar email de error fatal (no bloqueante)
    try {
      await enviarErrorFatal(err.message, fecha)
    } catch (emailErr) {
      console.error('[Sync] Email fatal error:', emailErr.message)
    }
    return res.status(500).json({ error: err.message, resultados })
  }
}
