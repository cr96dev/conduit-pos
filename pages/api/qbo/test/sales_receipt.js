// pages/api/qbo/test/sales_receipt.js
// Test: crea UN Sales Receipt en sandbox QBO usando datos reales de ventas
// POST /api/qbo/test/sales_receipt?fecha=2026-05-07&estacion=DIAG6

import { qboApi } from '../../../../lib/qbo/apiClient'
import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })

  if (req.headers.authorization !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const fecha = req.query.fecha || '2026-05-07'
  const estacionCodigo = req.query.estacion || 'DIAG6'

  try {
    // 1. Obtener mapeo de estacion
    const { data: estacion } = await supabaseAdmin
      .from('qbo_mapping_estaciones')
      .select('*')
      .eq('estacion_codigo', estacionCodigo)
      .single()

    if (!estacion) return res.status(404).json({ error: `Estacion no encontrada: ${estacionCodigo}` })
    if (!estacion.gasops_estacion_id) return res.status(400).json({ error: `Estacion sin gasops_estacion_id: ${estacionCodigo}` })

    // 2. Obtener mapeo de customer CF para esta estacion
    const { data: customer } = await supabaseAdmin
      .from('qbo_mapping_customers')
      .select('*')
      .eq('estacion_codigo', estacionCodigo)
      .eq('qbo_customer_type', 'CF_BY_STATION')
      .single()

    if (!customer) return res.status(404).json({ error: `Customer CF no encontrado para ${estacionCodigo}` })

    // 3. Obtener venta de combustible del dia
    const { data: venta } = await supabaseAdmin
      .from('ventas')
      .select('*')
      .eq('estacion_id', estacion.gasops_estacion_id)
      .eq('fecha', fecha)
      .single()

    if (!venta) return res.status(404).json({ error: `No hay venta para ${estacionCodigo} en ${fecha}` })

    // 4. Obtener mapeo de items (combustibles)
    const { data: items } = await supabaseAdmin
      .from('qbo_mapping_skus')
      .select('*')
      .in('sku', ['COMB-REG', 'COMB-PREM', 'COMB-DIESEL', 'COMB-DIESELP'])

    const itemMap = {}
    items.forEach(it => { itemMap[it.sku] = it })

    // 5. Construir lineas del Sales Receipt
    const lines = []

    if (venta.regular_ingresos && parseFloat(venta.regular_ingresos) > 0) {
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: parseFloat(venta.regular_ingresos),
        Description: `Combustible Regular - ${venta.regular_litros} litros`,
        SalesItemLineDetail: {
          ItemRef: { value: itemMap['COMB-REG'].qbo_item_id },
          Qty: parseFloat(venta.regular_litros),
          ClassRef: { value: estacion.qbo_class_id }
        }
      })
    }

    if (venta.premium_ingresos && parseFloat(venta.premium_ingresos) > 0) {
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: parseFloat(venta.premium_ingresos),
        Description: `Combustible Premium - ${venta.premium_litros} litros`,
        SalesItemLineDetail: {
          ItemRef: { value: itemMap['COMB-PREM'].qbo_item_id },
          Qty: parseFloat(venta.premium_litros),
          ClassRef: { value: estacion.qbo_class_id }
        }
      })
    }

    if (venta.diesel_ingresos && parseFloat(venta.diesel_ingresos) > 0) {
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: parseFloat(venta.diesel_ingresos),
        Description: `Diesel - ${venta.diesel_litros} litros`,
        SalesItemLineDetail: {
          ItemRef: { value: itemMap['COMB-DIESEL'].qbo_item_id },
          Qty: parseFloat(venta.diesel_litros),
          ClassRef: { value: estacion.qbo_class_id }
        }
      })
    }

    if (venta.diesel_plus_ingresos && parseFloat(venta.diesel_plus_ingresos) > 0) {
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: parseFloat(venta.diesel_plus_ingresos),
        Description: `Diesel Plus - ${venta.diesel_plus_litros} litros`,
        SalesItemLineDetail: {
          ItemRef: { value: itemMap['COMB-DIESELP'].qbo_item_id },
          Qty: parseFloat(venta.diesel_plus_litros),
          ClassRef: { value: estacion.qbo_class_id }
        }
      })
    }

    if (lines.length === 0) return res.status(400).json({ error: 'No hay ingresos en esta venta' })

    // 6. Construir Sales Receipt completo
    const salesReceipt = {
      TxnDate: fecha,
      CustomerRef: { value: customer.qbo_customer_id },
      ClassRef: { value: estacion.qbo_class_id },
      Line: lines,
      PrivateNote: `Auto: ventas combustible ${estacionCodigo} ${fecha}`
    }

    console.log('[Test SR] Creando Sales Receipt:', JSON.stringify(salesReceipt, null, 2))

    // 7. Crear en QBO
    const result = await qboApi('POST', '/salesreceipt', salesReceipt)
    const sr = result.SalesReceipt

    // 8. Marcar venta como procesada
    await supabaseAdmin
      .from('ventas')
      .update({
        qbo_processed: true,
        qbo_sales_receipt_id: sr.Id,
        qbo_processed_at: new Date().toISOString()
      })
      .eq('id', venta.id)

    return res.status(200).json({
      success: true,
      sales_receipt: {
        Id: sr.Id,
        DocNumber: sr.DocNumber,
        TxnDate: sr.TxnDate,
        TotalAmt: sr.TotalAmt,
        Customer: customer.nombre,
        Class: estacion.estacion_nombre,
        Lines: sr.Line.length
      },
      detalle_lineas: sr.Line.filter(l => l.SalesItemLineDetail).map(l => ({
        Description: l.Description,
        Amount: l.Amount,
        Qty: l.SalesItemLineDetail?.Qty
      }))
    })

  } catch (err) {
    console.error('[Test SR] Error:', err.message, err.body)
    return res.status(500).json({
      error: err.message,
      qbo_response: err.body
    })
  }
}
