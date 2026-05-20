// pages/api/qbo/sync/daily-prod.js
// Sync diario contra QBO PRODUCTION
// Combustible -> Deposit a Custodia Combustible Bank (329) / CR Custodia (1150040016)
// Lubricantes -> Sales Receipt con NETO (bruto/1.12) + TaxCodeRef (2) IVA General
// Tienda      -> Sales Receipt con NETO (bruto/1.12) + TaxCodeRef (2) IVA General

import { supabaseAdmin } from '../../../../lib/qbo/supabaseAdmin'
import { enviarReporteSync, enviarErrorFatal } from '../../../../lib/qbo/emailAlerts'

const QBO_API_BASE = 'https://quickbooks.api.intuit.com'
const OAKLAND_ID = '85da69a8-1e81-48a7-8b0d-82df9eeec15e'

const CUSTODIA_BANK_ID = '329'
const CUSTODIA_LIABILITY_ID = '1150040016'
const TAX_CODE_IVA_GENERAL = '2'
const IVA_RATE = 0.12  // 12% IVA Guatemala

// Divide monto bruto (con IVA) entre 1.12 para obtener neto (sin IVA)
function brutoToNeto(bruto) {
  return parseFloat((bruto / (1 + IVA_RATE)).toFixed(2))
}

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

async function getAccessToken() {
  const { data: token, error } = await supabaseAdmin
    .from('qbo_tokens').select('*').eq('is_production', true).limit(1).single()
  if (error || !token) throw new Error('No hay token PRODUCTION en DB')

  const now = new Date()
  const accessExpires = new Date(token.access_token_expires_at)
  if (accessExpires - now > 5 * 60 * 1000) {
    return { accessToken: token.access_token, realmId: token.realm_id }
  }

  const r = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(`${process.env.QBO_CLIENT_ID_PROD}:${process.env.QBO_CLIENT_SECRET_PROD}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token }).toString()
  })
  if (!r.ok) throw new Error('Refresh PROD failed: ' + await r.text())
  const data = await r.json()
  await supabaseAdmin.from('qbo_tokens').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    access_token_expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
    refresh_token_expires_at: new Date(Date.now() + data.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString()
  }).eq('realm_id', token.realm_id)
  return { accessToken: data.access_token, realmId: token.realm_id }
}

async function qboCall(realmId, accessToken, method, path, body = null) {
  const url = `${QBO_API_BASE}/v3/company/${realmId}${path}${path.includes('?') ? '&' : '?'}minorversion=75`
  const options = {
    method,
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' }
  }
  if (body) {
    options.headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }
  const response = await fetch(url, options)
  const text = await response.text()
  if (!response.ok) throw new Error(`QBO ${response.status}: ${text.substring(0, 400)}`)
  return JSON.parse(text)
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
  const dryRun = req.query.dry_run === 'true'

  const startTime = Date.now()
  const resultados = {
    combustible: { exitos: 0, errores: 0, omitidos: 0, detalle: [] },
    lubricantes: { exitos: 0, errores: 0, omitidos: 0, detalle: [] },
    tienda: { exitos: 0, errores: 0, omitidos: 0, detalle: [] },
    mode: dryRun ? 'DRY-RUN' : 'EXECUTE',
    environment: 'PRODUCTION'
  }

  try {
    const { accessToken, realmId } = await getAccessToken()

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
    // 1. COMBUSTIBLE -> DEPOSIT (SIN cambios, ya funciona)
    // ============================================
    const { data: ventasCombustible } = await supabaseAdmin
      .from('ventas').select('*').eq('fecha', fecha).eq('qbo_processed_prod', false)

    for (const venta of ventasCombustible || []) {
      const estacion = estacionesByGasOpsId[venta.estacion_id]
      if (!estacion || !estacion.qbo_class_id_prod) { resultados.combustible.errores++; continue }

      const lineas = []
      const productos = [
        { galones: venta.regular_litros, ingresos: venta.regular_ingresos, nombre: 'Super' },
        { galones: venta.premium_litros, ingresos: venta.premium_ingresos, nombre: 'V-Power' },
        { galones: venta.diesel_litros, ingresos: venta.diesel_ingresos, nombre: 'Diesel' },
        { galones: venta.diesel_plus_litros, ingresos: venta.diesel_plus_ingresos, nombre: 'Regular' }
      ]
      for (const p of productos) {
        const monto = parseFloat(p.ingresos || 0)
        if (monto > 0) {
          lineas.push({
            DetailType: 'DepositLineDetail',
            Amount: monto,
            Description: `${p.nombre} - ${p.galones} galones (${estacion.estacion_nombre} ${fecha})`,
            DepositLineDetail: {
              AccountRef: { value: CUSTODIA_LIABILITY_ID },
              ClassRef: { value: estacion.qbo_class_id_prod }
            }
          })
        }
      }

      if (lineas.length === 0) {
        resultados.combustible.omitidos++
        if (!dryRun) {
          await supabaseAdmin.from('ventas').update({
            qbo_processed_prod: true,
            qbo_deposit_id_prod: 'SKIPPED',
            qbo_processed_at_prod: new Date().toISOString()
          }).eq('id', venta.id)
        }
        continue
      }

      const total = lineas.reduce((s, l) => s + l.Amount, 0)
      if (dryRun) {
        resultados.combustible.detalle.push({ estacion: estacion.estacion_nombre, lineas: lineas.length, total, dry_run: true })
        continue
      }

      try {
        const result = await qboCall(realmId, accessToken, 'POST', '/deposit', {
          TxnDate: fecha,
          DepositToAccountRef: { value: CUSTODIA_BANK_ID },
          PrivateNote: `Auto: combustible custodia ${estacion.estacion_codigo} ${fecha}`,
          Line: lineas
        })
        const deposit = result.Deposit
        await supabaseAdmin.from('ventas').update({
          qbo_processed_prod: true,
          qbo_deposit_id_prod: deposit.Id,
          qbo_processed_at_prod: new Date().toISOString()
        }).eq('id', venta.id)
        await supabaseAdmin.from('qbo_sync_audit').insert({
          fecha_proceso: fecha,
          bucket_key: `${fecha}|${estacion.estacion_codigo}|Combustible|CF|PROD`,
          estacion: estacion.estacion_codigo, categoria: 'Combustible', customer_type: 'CF',
          customer_nit: 'CF-' + estacion.estacion_codigo, fel_count: 1, fel_ids: [venta.id],
          monto_subtotal: parseFloat(deposit.TotalAmt), monto_iva: 0, monto_total: parseFloat(deposit.TotalAmt),
          qbo_deposit_id: deposit.Id, qbo_transaction_type: 'Deposit',
          status: 'SUCCESS', attempts: 1, is_production: true
        })
        resultados.combustible.exitos++
        resultados.combustible.detalle.push({ estacion: estacion.estacion_nombre, deposit_id: deposit.Id, monto: deposit.TotalAmt })
      } catch (err) {
        resultados.combustible.errores++
        resultados.combustible.detalle.push({ estacion: estacion.estacion_nombre, error: err.message })
      }
    }

    // ============================================
    // 2. LUBRICANTES -> SALES RECEIPT con NETO + TaxCodeRef
    // ============================================
    const { data: ventasLub } = await supabaseAdmin
      .from('ventas_lubricantes').select('*, ventas_lubricantes_detalle(*)')
      .eq('fecha', fecha).eq('qbo_processed_prod', false)

    for (const venta of ventasLub || []) {
      const estacion = estacionesByGasOpsId[venta.estacion_id]
      if (!estacion || !estacion.qbo_class_id_prod) { resultados.lubricantes.errores++; continue }
      const customer = customersByEstacion[estacion.estacion_codigo]
      if (!customer || !customer.qbo_customer_id_prod) { resultados.lubricantes.errores++; continue }

      const totalBruto = parseFloat(venta.total_venta || 0)
      if (totalBruto <= 0) {
        resultados.lubricantes.omitidos++
        if (!dryRun) {
          await supabaseAdmin.from('ventas_lubricantes').update({
            qbo_processed_prod: true,
            qbo_sales_receipt_id_prod: 'SKIPPED',
            qbo_processed_at_prod: new Date().toISOString()
          }).eq('id', venta.id)
        }
        continue
      }

      const detalles = venta.ventas_lubricantes_detalle || []
      const lubItem = itemsBySku['LUB-GEN']
      const itemIdProd = lubItem?.qbo_item_id_prod
      if (!itemIdProd) { resultados.lubricantes.errores++; continue }

      const lines = []
      if (detalles.length > 0) {
        for (const d of detalles) {
          const subtotalBruto = parseFloat(d.subtotal)
          const subtotalNeto = brutoToNeto(subtotalBruto)
          const qty = parseFloat(d.cantidad || 1)
          lines.push({
            DetailType: 'SalesItemLineDetail',
            Amount: subtotalNeto,
            Description: `${d.nombre || d.sku} x${qty}`,
            SalesItemLineDetail: {
              ItemRef: { value: itemIdProd },
              Qty: qty,
              UnitPrice: brutoToNeto(parseFloat(d.precio_unitario || subtotalBruto)),
              ClassRef: { value: estacion.qbo_class_id_prod },
              TaxCodeRef: { value: TAX_CODE_IVA_GENERAL }
            }
          })
        }
      } else {
        const neto = brutoToNeto(totalBruto)
        lines.push({
          DetailType: 'SalesItemLineDetail',
          Amount: neto,
          Description: 'Lubricantes - venta agregada',
          SalesItemLineDetail: {
            ItemRef: { value: itemIdProd },
            Qty: 1, UnitPrice: neto,
            ClassRef: { value: estacion.qbo_class_id_prod },
            TaxCodeRef: { value: TAX_CODE_IVA_GENERAL }
          }
        })
      }

      if (dryRun) {
        const totalNetoLineas = lines.reduce((s, l) => s + l.Amount, 0)
        resultados.lubricantes.detalle.push({
          estacion: estacion.estacion_nombre, lineas: lines.length,
          total_neto: totalNetoLineas, total_bruto_esperado: totalBruto, dry_run: true
        })
        continue
      }

      try {
        const result = await qboCall(realmId, accessToken, 'POST', '/salesreceipt', {
          TxnDate: fecha,
          CustomerRef: { value: customer.qbo_customer_id_prod },
          ClassRef: { value: estacion.qbo_class_id_prod },
          Line: lines,
          PrivateNote: `Auto: lubricantes ${estacion.estacion_codigo} ${fecha}`
        })
        const sr = result.SalesReceipt

        await supabaseAdmin.from('ventas_lubricantes').update({
          qbo_processed_prod: true,
          qbo_sales_receipt_id_prod: sr.Id,
          qbo_processed_at_prod: new Date().toISOString()
        }).eq('id', venta.id)

        await supabaseAdmin.from('qbo_sync_audit').insert({
          fecha_proceso: fecha,
          bucket_key: `${fecha}|${estacion.estacion_codigo}|Lubricantes|CF|PROD`,
          estacion: estacion.estacion_codigo, categoria: 'Lubricantes', customer_type: 'CF',
          customer_nit: customer.nit, fel_count: detalles.length || 1, fel_ids: [venta.id],
          monto_subtotal: parseFloat(sr.TotalAmt) - parseFloat(sr.TxnTaxDetail?.TotalTax || 0),
          monto_iva: parseFloat(sr.TxnTaxDetail?.TotalTax || 0),
          monto_total: parseFloat(sr.TotalAmt),
          qbo_sales_receipt_id: sr.Id, qbo_transaction_type: 'SalesReceipt',
          status: 'SUCCESS', attempts: 1, is_production: true
        })

        resultados.lubricantes.exitos++
        resultados.lubricantes.detalle.push({
          estacion: estacion.estacion_nombre, sr_id: sr.Id,
          neto: sr.TotalAmt - (sr.TxnTaxDetail?.TotalTax || 0),
          iva: sr.TxnTaxDetail?.TotalTax || 0,
          total: sr.TotalAmt
        })
      } catch (err) {
        resultados.lubricantes.errores++
        resultados.lubricantes.detalle.push({ estacion: estacion.estacion_nombre, error: err.message })
      }
    }

    // ============================================
    // 3. TIENDA -> SALES RECEIPT con NETO + TaxCodeRef
    // ============================================
    const { data: tiendaFels } = await supabaseAdmin
      .from('tienda_facturas_fel').select('id, fecha, monto, estacion_id, tienda_facturas_fel_items(descripcion, cantidad, total)')
      .eq('fecha', fecha).eq('qbo_processed_prod', false)

    if (tiendaFels && tiendaFels.length > 0) {
      const porEstacion = {}
      for (const fel of tiendaFels) {
        const estId = fel.estacion_id || OAKLAND_ID
        if (!porEstacion[estId]) porEstacion[estId] = []
        porEstacion[estId].push(fel)
      }

      for (const estacionId of Object.keys(porEstacion)) {
        const estacion = estacionesByGasOpsId[estacionId]
        if (!estacion || !estacion.qbo_class_id_prod) { resultados.tienda.errores++; continue }
        const customer = customersByEstacion[estacion.estacion_codigo]
        if (!customer || !customer.qbo_customer_id_prod) { resultados.tienda.errores++; continue }

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
        for (const [cat, dataCat] of Object.entries(porCategoria)) {
          if (dataCat.total <= 0) continue
          const item = itemsBySku[cat]
          if (!item || !item.qbo_item_id_prod) {
            resultados.tienda.errores++
            resultados.tienda.detalle.push({ estacion: estacion.estacion_nombre, error: `Item prod ${cat} no mapeado` })
            continue
          }
          const netoLinea = brutoToNeto(dataCat.total)
          lines.push({
            DetailType: 'SalesItemLineDetail',
            Amount: netoLinea,
            Description: `${item.descripcion} (${dataCat.count} items)`,
            SalesItemLineDetail: {
              ItemRef: { value: item.qbo_item_id_prod },
              Qty: 1,
              UnitPrice: netoLinea,
              ClassRef: { value: estacion.qbo_class_id_prod },
              TaxCodeRef: { value: TAX_CODE_IVA_GENERAL }
            }
          })
        }

        if (lines.length === 0) { resultados.tienda.omitidos++; continue }

        const totalLineasNeto = lines.reduce((s, l) => s + l.Amount, 0)
        const totalBrutoTienda = felsEst.reduce((s, f) => s + parseFloat(f.monto || 0), 0)
        if (dryRun) {
          resultados.tienda.detalle.push({
            estacion: estacion.estacion_nombre, lineas: lines.length,
            total_neto: totalLineasNeto, total_bruto_esperado: totalBrutoTienda,
            fels: felsEst.length, dry_run: true
          })
          continue
        }

        try {
          const result = await qboCall(realmId, accessToken, 'POST', '/salesreceipt', {
            TxnDate: fecha,
            CustomerRef: { value: customer.qbo_customer_id_prod },
            ClassRef: { value: estacion.qbo_class_id_prod },
            Line: lines,
            PrivateNote: `Auto: tienda ${estacion.estacion_codigo} ${fecha} (${felsEst.length} FEL)`
          })
          const sr = result.SalesReceipt

          await supabaseAdmin.from('tienda_facturas_fel').update({
            qbo_processed_prod: true,
            qbo_sales_receipt_id_prod: sr.Id,
            qbo_processed_at_prod: new Date().toISOString()
          }).in('id', fel_ids_procesados)

          await supabaseAdmin.from('qbo_sync_audit').insert({
            fecha_proceso: fecha,
            bucket_key: `${fecha}|${estacion.estacion_codigo}|Tienda|CF|PROD`,
            estacion: estacion.estacion_codigo, categoria: 'Tienda', customer_type: 'CF',
            customer_nit: customer.nit, fel_count: felsEst.length, fel_ids: fel_ids_procesados,
            monto_subtotal: parseFloat(sr.TotalAmt) - parseFloat(sr.TxnTaxDetail?.TotalTax || 0),
            monto_iva: parseFloat(sr.TxnTaxDetail?.TotalTax || 0),
            monto_total: parseFloat(sr.TotalAmt),
            qbo_sales_receipt_id: sr.Id, qbo_transaction_type: 'SalesReceipt',
            status: 'SUCCESS', attempts: 1, is_production: true
          })

          resultados.tienda.exitos++
          resultados.tienda.detalle.push({
            estacion: estacion.estacion_nombre, sr_id: sr.Id,
            neto: sr.TotalAmt - (sr.TxnTaxDetail?.TotalTax || 0),
            iva: sr.TxnTaxDetail?.TotalTax || 0,
            total: sr.TotalAmt,
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

    if (!dryRun) {
      try { await enviarReporteSync(resultados, fecha + ' (PROD)', duracionSeg) }
      catch (emailErr) { console.error('[Sync-PROD] Email error:', emailErr.message) }
    }

    return res.status(200).json({
      success: true,
      mode: dryRun ? 'DRY-RUN (no se creó nada)' : 'EXECUTED',
      environment: 'PRODUCTION',
      realm_id: realmId,
      fecha,
      duracion_seg: duracionSeg,
      resultados
    })
  } catch (err) {
    try { await enviarErrorFatal(err.message, fecha + ' (PROD)') } catch {}
    return res.status(500).json({ error: err.message, resultados })
  }
}
