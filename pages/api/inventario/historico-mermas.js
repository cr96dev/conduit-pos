// pages/api/inventario/historico-mermas.js
// GET /api/inventario/historico-mermas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&store_id=&limit=20
//
// Cruza conteos_diarios_producto en un rango con loyverse_receipt_line_items
// para reconstruir la variacion diaria por variante = final - (inicial - ventas).
// Acumula las variaciones negativas (= merma) por variante, ranquea por monto
// estimado en Q (usando precio promedio del periodo como proxy) y devuelve top N
// con una serie diaria para sparkline.

import { requireAuth } from '../../../lib/auth'
import { rangoUTCDeDiaGT } from '../../../lib/fecha-gt'

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { desde, hasta, store_id = '', limit = '20' } = req.query
  if (!desde || !/^\d{4}-\d{2}-\d{2}$/.test(desde)) return res.status(400).json({ error: 'desde (YYYY-MM-DD) requerida' })
  if (!hasta || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) return res.status(400).json({ error: 'hasta (YYYY-MM-DD) requerida' })
  if (desde > hasta) return res.status(400).json({ error: 'desde debe ser <= hasta' })

  const topN = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100)

  try {
    // 1) Conteos del periodo CON ambos inicial y final (los que aportan a variacion).
    let conteosQuery = auth.admin
      .from('conteos_diarios_producto')
      .select('fecha, variant_id, store_id, inventario_inicial, inventario_final')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .not('inventario_inicial', 'is', null)
      .not('inventario_final', 'is', null)
    if (store_id) conteosQuery = conteosQuery.eq('store_id', store_id)
    const { data: conteos, error: conteosErr } = await conteosQuery
    if (conteosErr) throw new Error('conteos: ' + conteosErr.message)

    if (!conteos || conteos.length === 0) {
      return res.status(200).json({
        ok: true, desde, hasta,
        resumen: { productos_afectados: 0, merma_unidades_total: 0, merma_monto_estimado: 0, dias_con_conteo: 0 },
        ranking: [],
      })
    }

    // 2) Ventana UTC que cubre todo el rango GT.
    const { desdeUTC } = rangoUTCDeDiaGT(desde)
    const { hastaUTC } = rangoUTCDeDiaGT(hasta)

    // 3) Recibos del periodo.
    let recsQuery = auth.admin
      .from('loyverse_receipts')
      .select('loyverse_id, receipt_date, receipt_type, cancelled_at, store_id')
      .gte('receipt_date', desdeUTC)
      .lt('receipt_date', hastaUTC)
    if (store_id) recsQuery = recsQuery.eq('store_id', store_id)
    const { data: receipts, error: recsErr } = await recsQuery
    if (recsErr) throw new Error('receipts: ' + recsErr.message)

    // Mapa receipt_id -> { signo, fecha_gt }.
    const recMeta = {}
    const receiptIds = []
    for (const r of receipts || []) {
      if (r.cancelled_at) continue
      const fechaGT = utcToGTDate(r.receipt_date)
      recMeta[r.loyverse_id] = {
        signo: r.receipt_type === 'REFUND' ? -1 : 1,
        fecha_gt: fechaGT,
      }
      receiptIds.push(r.loyverse_id)
    }

    // 4) Line items por chunks.
    // ventasPorDiaVariant[fecha][variant_id] = { cantidad, monto }
    const ventasPorDiaVariant = {}
    if (receiptIds.length > 0) {
      for (let i = 0; i < receiptIds.length; i += 500) {
        const chunk = receiptIds.slice(i, i + 500)
        const { data: lines, error: linesErr } = await auth.admin
          .from('loyverse_receipt_line_items')
          .select('receipt_id, variant_id, quantity, total_money')
          .in('receipt_id', chunk)
        if (linesErr) throw new Error('line_items: ' + linesErr.message)
        for (const ln of lines || []) {
          const meta = recMeta[ln.receipt_id]
          if (!meta) continue
          const variantId = ln.variant_id
          if (!variantId) continue
          const dia = ventasPorDiaVariant[meta.fecha_gt] || (ventasPorDiaVariant[meta.fecha_gt] = {})
          const acc = dia[variantId] || { cantidad: 0, monto: 0 }
          acc.cantidad += meta.signo * Number(ln.quantity || 0)
          acc.monto    += meta.signo * Number(ln.total_money || 0)
          dia[variantId] = acc
        }
      }
    }

    // 5) Items (nombre + variant_name + sku).
    const { data: items, error: itemsErr } = await auth.admin
      .from('loyverse_items')
      .select('loyverse_id, item_name, variants, deleted_at')
    if (itemsErr) throw new Error('items: ' + itemsErr.message)

    const variantInfo = {}
    for (const it of items || []) {
      if (it.deleted_at) continue
      const vs = Array.isArray(it.variants) ? it.variants : []
      for (const v of vs) {
        if (v.variant_id) variantInfo[v.variant_id] = {
          item_name: it.item_name,
          variant_name: v.option1_value || v.option_value || null,
          sku: v.sku || null,
        }
      }
    }

    // 6) Calcular variacion por (fecha, variante) y agregar por variante.
    // agg[variant_id] = { merma_unidades, ventas_unidades, ventas_monto, dias_con_merma, dias_con_conteo, serie: [{fecha, merma}] }
    const agg = {}

    // Generar lista de todas las fechas del rango (para sparkline alineada).
    const fechas = enumerarDias(desde, hasta)

    for (const c of conteos) {
      const ventas = (ventasPorDiaVariant[c.fecha] || {})[c.variant_id] || { cantidad: 0, monto: 0 }
      const teorico = Number(c.inventario_inicial) - ventas.cantidad
      const variacion = Number(c.inventario_final) - teorico  // negativa = merma

      const a = agg[c.variant_id] || {
        merma_unidades: 0,
        dias_con_merma: 0,
        dias_con_conteo: 0,
        serieMap: {},   // fecha -> merma del dia (acumulada si hay multiples stores)
      }
      a.dias_con_conteo++
      if (variacion < 0) {
        a.merma_unidades += variacion
        a.dias_con_merma++
        a.serieMap[c.fecha] = (a.serieMap[c.fecha] || 0) + variacion
      }
      agg[c.variant_id] = a
    }

    // 7) Sumar ventas totales del periodo por variante (para precio promedio).
    const ventasPeriodoPorVariant = {}
    for (const dia of Object.values(ventasPorDiaVariant)) {
      for (const [vid, v] of Object.entries(dia)) {
        const acc = ventasPeriodoPorVariant[vid] || { cantidad: 0, monto: 0 }
        acc.cantidad += v.cantidad
        acc.monto    += v.monto
        ventasPeriodoPorVariant[vid] = acc
      }
    }

    // 8) Armar ranking.
    const ranking = []
    for (const [vid, a] of Object.entries(agg)) {
      if (a.merma_unidades >= 0) continue   // sin merma neta, no entra
      const info = variantInfo[vid] || {}
      const ventasPer = ventasPeriodoPorVariant[vid] || { cantidad: 0, monto: 0 }
      const precioProm = ventasPer.cantidad > 0 ? ventasPer.monto / ventasPer.cantidad : null
      const montoMerma = precioProm != null ? Math.abs(a.merma_unidades) * precioProm : null

      ranking.push({
        variant_id: vid,
        item_name:    info.item_name || '—',
        variant_name: info.variant_name,
        sku:          info.sku,
        merma_unidades: round3(a.merma_unidades),
        precio_promedio: precioProm != null ? round2(precioProm) : null,
        monto_merma_estimado: montoMerma != null ? round2(montoMerma) : null,
        ventas_unidades: round3(ventasPer.cantidad),
        ventas_monto:    round2(ventasPer.monto),
        dias_con_merma:  a.dias_con_merma,
        dias_con_conteo: a.dias_con_conteo,
        serie: fechas.map(f => ({ fecha: f, merma: round3(a.serieMap[f] || 0) })),
      })
    }

    // Ordenar por monto descendente (los nulls al final).
    ranking.sort((a, b) => {
      const am = a.monto_merma_estimado ?? -Infinity
      const bm = b.monto_merma_estimado ?? -Infinity
      if (bm !== am) return bm - am
      // tiebreaker: mayor merma en unidades
      return Math.abs(b.merma_unidades) - Math.abs(a.merma_unidades)
    })

    const topRanking = ranking.slice(0, topN)

    // 9) Resumen.
    const productosAfectados = ranking.length
    const mermaUnidadesTotal = ranking.reduce((s, r) => s + r.merma_unidades, 0)
    const mermaMontoTotal = ranking.reduce((s, r) => s + (r.monto_merma_estimado || 0), 0)
    const diasConConteoUnicos = new Set(conteos.map(c => c.fecha)).size

    return res.status(200).json({
      ok: true,
      desde, hasta,
      resumen: {
        productos_afectados: productosAfectados,
        merma_unidades_total: round3(mermaUnidadesTotal),
        merma_monto_estimado: round2(mermaMontoTotal),
        dias_con_conteo: diasConConteoUnicos,
      },
      fechas,
      ranking: topRanking,
    })
  } catch (e) {
    console.error('[inventario.historico-mermas] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

// Convierte un timestamptz UTC a la fecha calendario en GT (YYYY-MM-DD).
function utcToGTDate(iso) {
  const t = new Date(iso).getTime() - 6 * 60 * 60 * 1000
  return new Date(t).toISOString().slice(0, 10)
}

// Devuelve un array de fechas YYYY-MM-DD inclusivo entre desde y hasta.
function enumerarDias(desde, hasta) {
  const out = []
  const [y1, m1, d1] = desde.split('-').map(Number)
  const [y2, m2, d2] = hasta.split('-').map(Number)
  let ms = Date.UTC(y1, m1 - 1, d1)
  const end = Date.UTC(y2, m2 - 1, d2)
  while (ms <= end) {
    out.push(new Date(ms).toISOString().slice(0, 10))
    ms += 86_400_000
  }
  return out
}

export const config = { maxDuration: 60 }
