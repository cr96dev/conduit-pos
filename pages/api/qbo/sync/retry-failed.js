// pages/api/qbo/sync/retry-failed.js
// Reintenta SRs que quedaron en status FAILED en qbo_sync_audit
// POST /api/qbo/sync/retry-failed
// O GET para que el cron Vercel lo pueda llamar

import { qboApi } from '../../../../lib/qbo/apiClient'
import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'
import { enviarReporteSync, enviarErrorFatal } from '../../../../lib/qbo/emailAlerts'

const MAX_ATTEMPTS = 3
const OAKLAND_ID = '85da69a8-1e81-48a7-8b0d-82df9eeec15e'

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

  const startTime = Date.now()
  const resultados = {
    combustible: { exitos: 0, errores: 0, omitidos: 0, detalle: [] },
    lubricantes: { exitos: 0, errores: 0, omitidos: 0, detalle: [] },
    tienda: { exitos: 0, errores: 0, omitidos: 0, detalle: [] },
    permanently_failed: 0
  }

  try {
    // Buscar todos los FAILED con menos de MAX_ATTEMPTS intentos
    const { data: failed } = await supabaseAdmin
      .from('qbo_sync_audit')
      .select('*')
      .eq('status', 'FAILED')
      .lt('attempts', MAX_ATTEMPTS)
      .order('fecha_proceso', { ascending: true })
      .limit(50)

    if (!failed || failed.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No hay FAILED para reintentar',
        duracion_seg: ((Date.now() - startTime) / 1000).toFixed(2),
        resultados
      })
    }

    // Cargar mapeos una sola vez
    const [estacionesRes, customersRes, itemsRes] = await Promise.all([
      supabaseAdmin.from('qbo_mapping_estaciones').select('*').eq('activo', true),
      supabaseAdmin.from('qbo_mapping_customers').select('*').eq('activo', true).eq('qbo_customer_type', 'CF_BY_STATION'),
      supabaseAdmin.from('qbo_mapping_skus').select('*').eq('activo', true)
    ])

    const estacionesByCodigo = {}
    estacionesRes.data?.forEach(e => { estacionesByCodigo[e.estacion_codigo] = e })
    const customersByEstacion = {}
    customersRes.data?.forEach(c => { customersByEstacion[c.estacion_codigo] = c })
    const itemsBySku = {}
    itemsRes.data?.forEach(i => { itemsBySku[i.sku] = i })

    for (const audit of failed) {
      const estacion = estacionesByCodigo[audit.estacion]
      const customer = customersByEstacion[audit.estacion]
      const categoria = audit.categoria
      const felIds = audit.fel_ids || []
      const fecha = audit.fecha_proceso
      const newAttempts = (audit.attempts || 0) + 1

      if (!estacion || !customer) {
        await supabaseAdmin.from('qbo_sync_audit').update({
          attempts: newAttempts,
          error_message: 'Estacion o customer no encontrado en retry',
          updated_at: new Date().toISOString()
        }).eq('id', audit.id)
        if (resultados[categoria.toLowerCase()]) resultados[categoria.toLowerCase()].errores++
        continue
      }

      const catKey = categoria.toLowerCase()

      try {
        let lines = []

        // RECONSTRUIR las lineas segun categoria
        if (categoria === 'Combustible') {
          const { data: ventas } = await supabaseAdmin.from('ventas').select('*').in('id', felIds)
          for (const venta of ventas || []) {
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
          }
        } else if (categoria === 'Lubricantes') {
          const { data: lubs } = await supabaseAdmin.from('ventas_lubricantes').select('*, ventas_lubricantes_detalle(*)').in('id', felIds)
          for (const venta of lubs || []) {
            const detalles = venta.ventas_lubricantes_detalle || []
            const totalVenta = parseFloat(venta.total_venta || 0)
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
            } else if (totalVenta > 0) {
              lines.push({
                DetailType: 'SalesItemLineDetail', Amount: totalVenta, Description: `Lubricantes - venta agregada`,
                SalesItemLineDetail: {
                  ItemRef: { value: itemsBySku['LUB-GEN'].qbo_item_id },
                  Qty: 1, UnitPrice: totalVenta,
                  ClassRef: { value: estacion.qbo_class_id }
                }
              })
            }
          }
        } else if (categoria === 'Tienda') {
          const { data: tiendaFels } = await supabaseAdmin
            .from('tienda_facturas_fel').select('id, monto, tienda_facturas_fel_items(descripcion, cantidad, total)')
            .in('id', felIds)

          const porCategoria = {}
          let monto_sin_items = 0
          for (const fel of tiendaFels || []) {
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
          for (const [cat, data] of Object.entries(porCategoria)) {
            if (data.total <= 0) continue
            const item = itemsBySku[cat]
            if (!item || item.qbo_item_id === 'TBD') continue
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
        }

        if (lines.length === 0) {
          throw new Error('No se pudieron reconstruir lineas para retry')
        }

        // POST a QBO
        const result = await qboApi('POST', '/salesreceipt', {
          TxnDate: fecha,
          CustomerRef: { value: customer.qbo_customer_id },
          ClassRef: { value: estacion.qbo_class_id },
          Line: lines,
          PrivateNote: `Retry: ${categoria} ${estacion.estacion_codigo} ${fecha}`
        })
        const sr = result.SalesReceipt

        // Actualizar audit a SUCCESS
        await supabaseAdmin.from('qbo_sync_audit').update({
          qbo_sales_receipt_id: sr.Id,
          monto_total: parseFloat(sr.TotalAmt),
          status: 'SUCCESS',
          attempts: newAttempts,
          error_message: null,
          updated_at: new Date().toISOString()
        }).eq('id', audit.id)

        // Actualizar tabla origen
        const tabla = categoria === 'Combustible' ? 'ventas' :
                      categoria === 'Lubricantes' ? 'ventas_lubricantes' :
                      categoria === 'Tienda' ? 'tienda_facturas_fel' : null
        if (tabla) {
          await supabaseAdmin.from(tabla).update({
            qbo_processed: true,
            qbo_sales_receipt_id: sr.Id,
            qbo_processed_at: new Date().toISOString()
          }).in('id', felIds)
        }

        resultados[catKey].exitos++
        resultados[catKey].detalle.push({ estacion: estacion.estacion_nombre, sr_id: sr.Id, monto: sr.TotalAmt })

      } catch (err) {
        // Decidir si es PERMANENTLY_FAILED
        const status = newAttempts >= MAX_ATTEMPTS ? 'PERMANENTLY_FAILED' : 'FAILED'
        await supabaseAdmin.from('qbo_sync_audit').update({
          status,
          attempts: newAttempts,
          error_message: err.message?.substring(0, 500),
          updated_at: new Date().toISOString()
        }).eq('id', audit.id)

        if (status === 'PERMANENTLY_FAILED') {
          resultados.permanently_failed++
        }
        resultados[catKey].errores++
        resultados[catKey].detalle.push({ estacion: estacion.estacion_nombre, error: err.message })
      }
    }

    const duracionMs = Date.now() - startTime
    const duracionSeg = (duracionMs / 1000).toFixed(2)

    // Enviar email solo si hubo intentos (no si no habia nada)
    if (failed.length > 0) {
      try {
        await enviarReporteSync(resultados, 'RETRY-FAILED', duracionSeg)
      } catch (emailErr) {
        console.error('[Retry] Email error:', emailErr.message)
      }
    }

    return res.status(200).json({
      success: true,
      intentados: failed.length,
      duracion_seg: duracionSeg,
      resultados
    })

  } catch (err) {
    try {
      await enviarErrorFatal(err.message, 'RETRY-FAILED')
    } catch (emailErr) {}
    return res.status(500).json({ error: err.message, resultados })
  }
}
