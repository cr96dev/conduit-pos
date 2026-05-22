// pages/api/produccion/sugerencias.js
// GET /api/produccion/sugerencias?fecha=YYYY-MM-DD&semanas=4
//
// Para cada receta activa con loyverse_item_id, sugiere una cantidad de
// produccion basada en las ventas promedio del MISMO dia de semana en
// las ultimas N semanas (default 4, max 8).
//
// Devuelve { sugerencias: [{ receta_id, sugerido, base }] }.
// Solo incluye recetas que tienen al menos 1 dia con ventas en el periodo.

import { requireAuth } from '../../../lib/auth'
import { rangoUTCDeDiaGT } from '../../../lib/fecha-gt'

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { fecha, semanas = '4' } = req.query
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha (YYYY-MM-DD) requerida' })
  }
  const nSemanas = Math.min(Math.max(parseInt(semanas, 10) || 4, 1), 8)

  try {
    // 1) Dia de la semana objetivo. Calculamos sobre UTC noon para evitar drift.
    const [y, m, d] = fecha.split('-').map(Number)
    const objetivoMs = Date.UTC(y, m - 1, d, 12, 0, 0)
    const dow = new Date(objetivoMs).getUTCDay()  // 0=domingo

    // 2) Las N fechas pasadas con el mismo dia de semana.
    const fechasMuestra = []
    for (let i = 1; i <= nSemanas; i++) {
      const ms = objetivoMs - i * 7 * 86_400_000
      fechasMuestra.push(new Date(ms).toISOString().slice(0, 10))
    }
    // Las queremos en orden cronologico para resultados estables.
    fechasMuestra.sort()

    // 3) Recetas activas con loyverse_item_id.
    const { data: recetas, error: rErr } = await auth.admin
      .from('recetas')
      .select('id, nombre, loyverse_item_id')
      .eq('activa', true)
      .not('loyverse_item_id', 'is', null)
    if (rErr) throw new Error('recetas: ' + rErr.message)

    if (!recetas || recetas.length === 0) {
      return res.status(200).json({
        ok: true, fecha, semanas: nSemanas, dia_semana: dow, fechas_muestra: fechasMuestra,
        sugerencias: [],
      })
    }

    const itemIds = Array.from(new Set(recetas.map(r => r.loyverse_item_id).filter(Boolean)))
    const recetaByItem = {}
    for (const r of recetas) recetaByItem[r.loyverse_item_id] = r

    // 4) Ventas por (item_id, fecha_gt) en los dias muestra.
    // Trabajamos en UTC range [min, max] y luego filtramos por dow al armar.
    const minDia = fechasMuestra[0]
    const maxDia = fechasMuestra[fechasMuestra.length - 1]
    const { desdeUTC } = rangoUTCDeDiaGT(minDia)
    const { hastaUTC } = rangoUTCDeDiaGT(maxDia)

    const { data: receipts, error: recErr } = await auth.admin
      .from('loyverse_receipts')
      .select('loyverse_id, receipt_date, receipt_type, cancelled_at')
      .gte('receipt_date', desdeUTC)
      .lt('receipt_date', hastaUTC)
    if (recErr) throw new Error('receipts: ' + recErr.message)

    const fechasSet = new Set(fechasMuestra)
    const recMeta = {}
    const receiptIds = []
    for (const r of receipts || []) {
      if (r.cancelled_at) continue
      const fGT = utcToGTDate(r.receipt_date)
      if (!fechasSet.has(fGT)) continue
      recMeta[r.loyverse_id] = {
        signo: r.receipt_type === 'REFUND' ? -1 : 1,
        fecha_gt: fGT,
      }
      receiptIds.push(r.loyverse_id)
    }

    // ventasPorItemFecha[item_id][fecha] = cantidad
    const ventas = {}
    for (let i = 0; i < receiptIds.length; i += 500) {
      const chunk = receiptIds.slice(i, i + 500)
      const { data: lines, error: lErr } = await auth.admin
        .from('loyverse_receipt_line_items')
        .select('receipt_id, item_id, quantity')
        .in('receipt_id', chunk)
        .in('item_id', itemIds)
      if (lErr) throw new Error('line_items: ' + lErr.message)
      for (const ln of lines || []) {
        const meta = recMeta[ln.receipt_id]
        if (!meta || !ln.item_id) continue
        const it = ventas[ln.item_id] || (ventas[ln.item_id] = {})
        it[meta.fecha_gt] = (it[meta.fecha_gt] || 0) + meta.signo * Number(ln.quantity || 0)
      }
    }

    // 5) Armar sugerencias = promedio por dia (sumar las cantidades de cada
    //    fecha de muestra y dividir por el numero de semanas con ventas).
    const sugerencias = []
    for (const r of recetas) {
      const porFecha = ventas[r.loyverse_item_id] || {}
      const valores = fechasMuestra.map(f => porFecha[f] || 0)
      const conVentas = valores.filter(v => v > 0)
      if (conVentas.length === 0) continue
      const suma = conVentas.reduce((s, v) => s + v, 0)
      const promedio = round3(suma / conVentas.length)
      const sugerido = Math.max(1, Math.round(promedio))   // redondeado a entero hacia arriba (min 1)
      sugerencias.push({
        receta_id: r.id,
        sugerido,
        promedio,
        muestras: conVentas.length,
        valores_por_fecha: fechasMuestra.map((f, i) => ({ fecha: f, vendido: round3(valores[i]) })),
      })
    }

    // Orden: por sugerido descendente.
    sugerencias.sort((a, b) => b.sugerido - a.sugerido)

    return res.status(200).json({
      ok: true,
      fecha,
      semanas: nSemanas,
      dia_semana: dow,
      fechas_muestra: fechasMuestra,
      sugerencias,
    })
  } catch (e) {
    console.error('[produccion.sugerencias] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

function utcToGTDate(iso) {
  const t = new Date(iso).getTime() - 6 * 60 * 60 * 1000
  return new Date(t).toISOString().slice(0, 10)
}

export const config = { maxDuration: 60 }
