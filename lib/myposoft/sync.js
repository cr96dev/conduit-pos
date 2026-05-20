// lib/myposoft/sync.js
// Capa de sincronización MyPOSoft -> Supabase
// Trae ventas via /Sale/getList y hace upsert masivo

import { MyPOSoftClient } from './client.js'
import { supabaseAdmin } from '../qbo/supabaseAdmin.js'

// ============================================================================
// Helpers de parseo
// ============================================================================

// MyPOSoft devuelve numeros como strings con muchos decimales: "22.0000000000"
function parseNumber(v, defaultVal = 0) {
  if (v == null || v === '') return defaultVal
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : defaultVal
}

// MyPOSoft devuelve fechas en formato "2026-05-18 23:31:38" (hora Guatemala, sin TZ)
// Las guardamos como timestamptz asumiendo America/Guatemala (UTC-6)
function parseDateGT(dateStr) {
  if (!dateStr) return null
  // Forzar interpretacion como hora Guatemala -> UTC
  // Guatemala no tiene DST, siempre es UTC-6
  return `${dateStr.replace(' ', 'T')}-06:00`
}

// Mapea una venta cruda de MyPOSoft a row de tabla myposoft_sales
function mapSaleRow(raw, tradeMapping) {
  const tradeId = parseInt(raw.tradeCode, 10)  // No, tradeCode es codigo visible. Necesitamos cruzar por nombre
  // ACTUALIZACION: lookup por nombre porque el response no trae el id interno
  const mapped = tradeMapping.get(raw.tradeName)
  
  return {
    sale_id: parseInt(raw.id, 10),
    fel_uuid: raw.felUuid,
    fel_number: raw.felNumber || null,
    fel_serie: raw.felSerie || null,
    correlative: raw.correlative,
    correlative_internal: raw.correlativeInternal || null,
    
    myposoft_trade_id: mapped?.myposoft_trade_id ?? null,
    estacion_id: mapped?.estacion_id ?? null,
    trade_code: raw.tradeCode || null,
    trade_name: raw.tradeName || null,
    
    user_login: raw.userLogin || null,
    user_name: raw.userName || null,
    
    sale_status: raw.saleStatus,
    
    customer_name: raw.customerName || null,
    customer_nit: raw.customerNit || null,
    customer_address: raw.customerAddress || null,
    customer_email: raw.customerEmail || null,
    
    date_document: parseDateGT(raw.dateDocument),
    
    currency_name: raw.currencyName || 'Quetzales',
    total_taxes: parseNumber(raw.totalTaxes),
    total_net: parseNumber(raw.totalNet),
    total: parseNumber(raw.total),
    
    payment_1: parseNumber(raw['payment-1']),
    payment_2: parseNumber(raw['payment-2']),
    payment_voucher_2: raw['payment-voucher-2'] || null,
    
    tax_3: parseNumber(raw['tax-3']),
    
    // Guardar el JSON crudo pero sin el HTML enorme de "actions" (links a XML/PDF)
    raw_data: (() => {
      const { actions, ...rest } = raw
      return rest
    })(),
  }
}

// ============================================================================
// Carga del mapeo trade -> estacion
// ============================================================================

async function loadTradeMapping() {
  const { data, error } = await supabaseAdmin
    .from('myposoft_trades_mapping')
    .select('myposoft_trade_id, myposoft_trade_name, estacion_id')
  
  if (error) throw new Error(`loadTradeMapping: ${error.message}`)
  
  // Map por nombre (porque /Sale/getList devuelve tradeName, no el id interno)
  const byName = new Map()
  for (const row of data || []) {
    byName.set(row.myposoft_trade_name, {
      myposoft_trade_id: row.myposoft_trade_id,
      estacion_id: row.estacion_id,
    })
  }
  return byName
}

// ============================================================================
// Logging
// ============================================================================

async function startSyncLog({ endpoint, startDate, endDate, tradeId, triggeredBy, metadata }) {
  const { data, error } = await supabaseAdmin
    .from('myposoft_sync_log')
    .insert({
      endpoint,
      start_date: startDate,
      end_date: endDate,
      myposoft_trade_id: tradeId ?? null,
      status: 'pending',
      triggered_by: triggeredBy || 'manual',
      metadata: metadata || {},
    })
    .select('id')
    .single()
  
  if (error) throw new Error(`startSyncLog: ${error.message}`)
  return data.id
}

async function finishSyncLog(logId, { status, recordsReceived, recordsUpserted, errorMessage, durationMs }) {
  const { error } = await supabaseAdmin
    .from('myposoft_sync_log')
    .update({
      status,
      records_received: recordsReceived ?? null,
      records_upserted: recordsUpserted ?? null,
      error_message: errorMessage ?? null,
      finished_at: new Date().toISOString(),
      duration_ms: durationMs ?? null,
    })
    .eq('id', logId)
  
  if (error) console.error('finishSyncLog error:', error.message)
}

// ============================================================================
// Upsert masivo
// ============================================================================

async function upsertSales(rows) {
  if (rows.length === 0) return 0
  
  // Filtramos rows sin sale_id valido (defensivo)
  const valid = rows.filter(r => Number.isFinite(r.sale_id) && r.fel_uuid)
  const invalid = rows.length - valid.length
  if (invalid > 0) console.warn(`upsertSales: ${invalid} rows invalidos descartados`)
  
  // Batch de 500 para no exceder limites de Supabase
  const BATCH = 500
  let upserted = 0
  for (let i = 0; i < valid.length; i += BATCH) {
    const chunk = valid.slice(i, i + BATCH)
    const { error } = await supabaseAdmin
      .from('myposoft_sales')
      .upsert(chunk, { onConflict: 'sale_id' })
    
    if (error) throw new Error(`upsert batch ${i}: ${error.message}`)
    upserted += chunk.length
  }
  return upserted
}

// ============================================================================
// API publica
// ============================================================================

/**
 * Sincroniza ventas de MyPOSoft a Supabase
 * @param {object} opts
 * @param {string} opts.startDate - 'YYYY-MM-DD'
 * @param {string} opts.endDate - 'YYYY-MM-DD'
 * @param {number} [opts.tradeId] - estacion especifica (opcional)
 * @param {string} [opts.triggeredBy] - 'cron' | 'manual' | 'api'
 * @param {object} [opts.metadata]
 * @returns {Promise<{success: boolean, recordsReceived: number, recordsUpserted: number, durationMs: number}>}
 */
export async function syncSales({ startDate, endDate, tradeId, triggeredBy = 'manual', metadata } = {}) {
  const t0 = Date.now()
  
  const logId = await startSyncLog({
    endpoint: 'Sale/getList',
    startDate,
    endDate,
    tradeId,
    triggeredBy,
    metadata,
  })
  
  try {
    // 1) Login a MyPOSoft
    const client = new MyPOSoftClient()
    await client.login()
    
    // 2) Cargar mapeo trade -> estacion
    const tradeMapping = await loadTradeMapping()
    
    // 3) Traer ventas
    const { records, sales } = await client.getSales({ startDate, endDate, tradeId })
    
    // 4) Mapear
    const rows = sales.map(s => mapSaleRow(s, tradeMapping))
    
    // 5) Upsert
    const upserted = await upsertSales(rows)
    
    const durationMs = Date.now() - t0
    await finishSyncLog(logId, {
      status: 'success',
      recordsReceived: records,
      recordsUpserted: upserted,
      durationMs,
    })
    
    return {
      success: true,
      recordsReceived: records,
      recordsUpserted: upserted,
      durationMs,
      logId,
    }
  } catch (e) {
    const durationMs = Date.now() - t0
    await finishSyncLog(logId, {
      status: 'error',
      errorMessage: e.message?.slice(0, 1000),
      durationMs,
    })
    throw e
  }
}

/**
 * Reconcilia los totales de ventas_lubricantes con MyPOSoft para un rango de fechas.
 * NO actualiza, solo devuelve diferencias.
 * Util para validar antes de tocar producción.
 * 
 * IMPORTANTE: Las fechas se calculan en hora Guatemala (America/Guatemala),
 * no en UTC, para que las ventas nocturnas (ej. 23:30 GT) queden en el día correcto.
 */
export async function reconcileLubricantes({ startDate, endDate } = {}) {
  // 1) Agregado POS por (estacion, fecha_gt) — usa SQL para que la conversion TZ sea correcta
  const { data: posData, error: posErr } = await supabaseAdmin.rpc('myposoft_reconcile_aggregate', {
    p_start_date: startDate,
    p_end_date: endDate,
  })
  
  if (posErr) {
    // Si la RPC no existe, fallback a calcular en JS leyendo crudo y agrupando por hora GT
    if (posErr.code === 'PGRST202' || posErr.message?.includes('function')) {
      return await reconcileFallbackJS({ startDate, endDate })
    }
    throw new Error(`reconcile POS: ${posErr.message}`)
  }
  
  // 2) Agregado lubricantes
  const { data: supData, error: supErr } = await supabaseAdmin
    .from('ventas_lubricantes')
    .select('estacion_id, fecha, total_venta, efectivo, neonet')
    .gte('fecha', startDate)
    .lte('fecha', endDate)
  
  if (supErr) throw new Error(`reconcile SUP: ${supErr.message}`)
  
  // 3) Build report
  const supByKey = new Map()
  for (const r of supData || []) {
    supByKey.set(`${r.estacion_id}|${r.fecha}`, r)
  }
  
  const posByKey = new Map()
  for (const r of posData || []) {
    posByKey.set(`${r.estacion_id}|${r.fecha_gt}`, r)
  }
  
  const allKeys = new Set([...posByKey.keys(), ...supByKey.keys()])
  const reporte = []
  
  for (const key of allKeys) {
    const [estacionId, fecha] = key.split('|')
    const pos = posByKey.get(key) || { facturas: 0, total: 0, efectivo: 0, tarjeta: 0 }
    const sup = supByKey.get(key) || { total_venta: 0, efectivo: 0, neonet: 0 }
    
    const posTotal = parseFloat(pos.total || 0)
    const supTotal = parseFloat(sup.total_venta || 0)
    const posEfe = parseFloat(pos.efectivo || 0)
    const supEfe = parseFloat(sup.efectivo || 0)
    const posTar = parseFloat(pos.tarjeta || 0)
    const supTar = parseFloat(sup.neonet || 0)
    
    const diffTotal = posTotal - supTotal
    const diffEfe = posEfe - supEfe
    const diffTar = posTar - supTar
    
    if (Math.abs(diffTotal) > 0.5 || Math.abs(diffEfe) > 0.5 || Math.abs(diffTar) > 0.5) {
      reporte.push({
        estacion_id: estacionId,
        fecha,
        pos_facturas: pos.facturas || 0,
        pos_total: Math.round(posTotal * 100) / 100,
        sup_total: supTotal,
        diff_total: Math.round(diffTotal * 100) / 100,
        pos_efectivo: Math.round(posEfe * 100) / 100,
        sup_efectivo: supEfe,
        diff_efectivo: Math.round(diffEfe * 100) / 100,
        pos_tarjeta: Math.round(posTar * 100) / 100,
        sup_neonet: supTar,
        diff_tarjeta: Math.round(diffTar * 100) / 100,
      })
    }
  }
  
  return {
    startDate,
    endDate,
    descuadres: reporte.length,
    detalles: reporte.sort((a, b) => Math.abs(b.diff_total) - Math.abs(a.diff_total)),
  }
}

// Fallback si la RPC no existe — agrupa en JS convirtiendo a hora GT manualmente
async function reconcileFallbackJS({ startDate, endDate }) {
  const { data, error } = await supabaseAdmin
    .from('myposoft_sales')
    .select('estacion_id, date_document, total, payment_1, payment_2, sale_status')
    .gte('date_document', `${startDate}T00:00:00-06:00`)
    .lte('date_document', `${endDate}T23:59:59-06:00`)
    .eq('sale_status', 'EMITIDA')
  
  if (error) throw new Error(`reconcile fallback: ${error.message}`)
  
  // Agrupar por estacion + fecha GT
  const aggr = new Map()
  for (const r of data || []) {
    // Convertir UTC a hora GT manualmente: restar 6h
    const utcMs = new Date(r.date_document).getTime()
    const gtMs = utcMs - 6 * 60 * 60 * 1000
    const fechaGT = new Date(gtMs).toISOString().slice(0, 10)
    
    const key = `${r.estacion_id}|${fechaGT}`
    if (!aggr.has(key)) {
      aggr.set(key, { 
        estacion_id: r.estacion_id, 
        fecha_gt: fechaGT,
        facturas: 0, total: 0, efectivo: 0, tarjeta: 0 
      })
    }
    const acc = aggr.get(key)
    acc.facturas++
    acc.total += parseFloat(r.total || 0)
    acc.efectivo += parseFloat(r.payment_1 || 0)
    acc.tarjeta += parseFloat(r.payment_2 || 0)
  }
  
  // Continuar con el mismo flujo que la version con RPC
  const { data: supData, error: supErr } = await supabaseAdmin
    .from('ventas_lubricantes')
    .select('estacion_id, fecha, total_venta, efectivo, neonet')
    .gte('fecha', startDate)
    .lte('fecha', endDate)
  
  if (supErr) throw new Error(`reconcile SUP fallback: ${supErr.message}`)
  
  const supByKey = new Map()
  for (const r of supData || []) {
    supByKey.set(`${r.estacion_id}|${r.fecha}`, r)
  }
  
  const allKeys = new Set([...aggr.keys(), ...supByKey.keys()])
  const reporte = []
  
  for (const key of allKeys) {
    const [estacionId, fecha] = key.split('|')
    const pos = aggr.get(key) || { facturas: 0, total: 0, efectivo: 0, tarjeta: 0 }
    const sup = supByKey.get(key) || { total_venta: 0, efectivo: 0, neonet: 0 }
    
    const posTotal = pos.total
    const supTotal = parseFloat(sup.total_venta || 0)
    const posEfe = pos.efectivo
    const supEfe = parseFloat(sup.efectivo || 0)
    const posTar = pos.tarjeta
    const supTar = parseFloat(sup.neonet || 0)
    
    const diffTotal = posTotal - supTotal
    const diffEfe = posEfe - supEfe
    const diffTar = posTar - supTar
    
    if (Math.abs(diffTotal) > 0.5 || Math.abs(diffEfe) > 0.5 || Math.abs(diffTar) > 0.5) {
      reporte.push({
        estacion_id: estacionId,
        fecha,
        pos_facturas: pos.facturas,
        pos_total: Math.round(posTotal * 100) / 100,
        sup_total: supTotal,
        diff_total: Math.round(diffTotal * 100) / 100,
        pos_efectivo: Math.round(posEfe * 100) / 100,
        sup_efectivo: supEfe,
        diff_efectivo: Math.round(diffEfe * 100) / 100,
        pos_tarjeta: Math.round(posTar * 100) / 100,
        sup_neonet: supTar,
        diff_tarjeta: Math.round(diffTar * 100) / 100,
      })
    }
  }
  
  return {
    startDate,
    endDate,
    descuadres: reporte.length,
    detalles: reporte.sort((a, b) => Math.abs(b.diff_total) - Math.abs(a.diff_total)),
  }
}