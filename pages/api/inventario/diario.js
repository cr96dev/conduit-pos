// pages/api/inventario/diario.js
// GET  /api/inventario/diario?fecha=YYYY-MM-DD&store_id=...&solo_track_stock=1
//   -> Devuelve por cada variante de Loyverse: nombre, sku, ventas del dia,
//      inicial cargado (si hay), final cargado (si hay), teorico y variacion.
// POST /api/inventario/diario  body: { fecha, variant_id, store_id?, inventario_inicial?, inventario_final?, notas? }
//   -> Upsert del conteo (1 fila por dia/variante/tienda). Solo admin.
//
// Auth: Bearer <supabase access_token>.

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { rangoUTCDeDiaGT } from '../../../lib/fecha-gt'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return upsert(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000

// ---------------------------------------------------------------------------
// GET: panorama completo del dia
// ---------------------------------------------------------------------------

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { fecha, store_id = '', solo_track_stock } = req.query
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha (YYYY-MM-DD) requerida' })
  }

  try {
    const { desdeUTC, hastaUTC } = rangoUTCDeDiaGT(fecha)

    // 1) Items + variantes (catalogo).
    const { data: items, error: itemsErr } = await auth.admin
      .from('loyverse_items')
      .select('loyverse_id, item_name, track_stock, variants, deleted_at')
    if (itemsErr) throw new Error('items: ' + itemsErr.message)

    // Diccionario por variant_id.
    const variantes = {}
    for (const it of items || []) {
      if (it.deleted_at) continue
      if (solo_track_stock === '1' && !it.track_stock) continue
      const vs = Array.isArray(it.variants) ? it.variants : []
      for (const v of vs) {
        if (!v.variant_id) continue
        variantes[v.variant_id] = {
          variant_id:   v.variant_id,
          item_id:      it.loyverse_id,
          item_name:    it.item_name,
          variant_name: v.option1_value || v.option_value || null,
          sku:          v.sku || null,
          track_stock:  !!it.track_stock,
          stock_actual_pos: null, // se llena luego
        }
      }
    }

    // 2) Stock actual segun Loyverse (snapshot del ultimo sync) — informativo.
    const { data: invLevels, error: invErr } = await auth.admin
      .from('loyverse_inventory_levels')
      .select('variant_id, store_id, in_stock')
    if (invErr) throw new Error('inventory_levels: ' + invErr.message)
    for (const lvl of invLevels || []) {
      if (store_id && lvl.store_id !== store_id) continue
      const v = variantes[lvl.variant_id]
      if (!v) continue
      v.stock_actual_pos = (v.stock_actual_pos || 0) + Number(lvl.in_stock || 0)
    }

    // 3) Ventas del dia: leer line_items de recibos cuya receipt_date este en el dia GT.
    //    Hacer 2 queries: una para SALE y otra para REFUND, para sumar con signo.
    const { data: receipts, error: recErr } = await auth.admin
      .from('loyverse_receipts')
      .select('loyverse_id, receipt_type, cancelled_at, store_id')
      .gte('receipt_date', desdeUTC)
      .lt('receipt_date', hastaUTC)
    if (recErr) throw new Error('receipts: ' + recErr.message)

    const receiptSign = {} // receipt_id -> +1 / -1 / 0
    const receiptIds  = []
    for (const r of receipts || []) {
      if (r.cancelled_at) continue
      if (store_id && r.store_id !== store_id) continue
      receiptSign[r.loyverse_id] = r.receipt_type === 'REFUND' ? -1 : 1
      receiptIds.push(r.loyverse_id)
    }

    // ventasPorVariant[variant_id] = { cantidad: number, monto: number }
    const ventasPorVariant = {}

    if (receiptIds.length > 0) {
      // Postgres tiene un limite practico de IN(...) — partimos en chunks de 500.
      for (let i = 0; i < receiptIds.length; i += 500) {
        const chunk = receiptIds.slice(i, i + 500)
        const { data: lines, error: linesErr } = await auth.admin
          .from('loyverse_receipt_line_items')
          .select('receipt_id, variant_id, item_id, quantity, total_money')
          .in('receipt_id', chunk)
        if (linesErr) throw new Error('line_items: ' + linesErr.message)
        for (const ln of lines || []) {
          const signo = receiptSign[ln.receipt_id] || 0
          if (!signo) continue
          const key = ln.variant_id
          if (!key) continue
          const acc = ventasPorVariant[key] || { cantidad: 0, monto: 0 }
          acc.cantidad += signo * Number(ln.quantity || 0)
          acc.monto    += signo * Number(ln.total_money || 0)
          ventasPorVariant[key] = acc
        }
      }
    }

    // 4) Conteos guardados para esa fecha.
    let conteosQuery = auth.admin
      .from('conteos_diarios_producto')
      .select('id, variant_id, store_id, inventario_inicial, inventario_final, vendido_pos, notas, updated_at, updated_by')
      .eq('fecha', fecha)
    if (store_id) conteosQuery = conteosQuery.eq('store_id', store_id)
    const { data: conteos, error: conteosErr } = await conteosQuery
    if (conteosErr) throw new Error('conteos: ' + conteosErr.message)

    const conteoPorVariant = {}
    for (const c of conteos || []) {
      conteoPorVariant[c.variant_id] = c
    }

    // 4b) Final del dia anterior por variante — para sugerir como inicial de hoy.
    const fechaAyer = (() => {
      const [y, m, d] = fecha.split('-').map(Number)
      const ms = Date.UTC(y, m - 1, d) - 86_400_000
      return new Date(ms).toISOString().slice(0, 10)
    })()

    let ayerQuery = auth.admin
      .from('conteos_diarios_producto')
      .select('variant_id, store_id, inventario_final')
      .eq('fecha', fechaAyer)
      .not('inventario_final', 'is', null)
    if (store_id) ayerQuery = ayerQuery.eq('store_id', store_id)
    const { data: ayerData, error: ayerErr } = await ayerQuery
    if (ayerErr) throw new Error('conteos ayer: ' + ayerErr.message)

    const finalAyerPorVariant = {}
    for (const r of ayerData || []) {
      finalAyerPorVariant[r.variant_id] = Number(r.inventario_final)
    }

    // 5) Armar filas finales.
    let totalVentasMonto = 0
    let totalVentasCantidad = 0
    let variantesConteoFinal = 0
    let mermaTotal = 0          // suma de variaciones negativas (perdidas) en unidades
    let variacionTotal = 0      // suma de TODAS las variaciones (final - teorico)

    const filas = Object.values(variantes).map(v => {
      const ventas = ventasPorVariant[v.variant_id] || { cantidad: 0, monto: 0 }
      const conteo = conteoPorVariant[v.variant_id] || null

      const inicial = conteo?.inventario_inicial != null ? Number(conteo.inventario_inicial) : null
      const final   = conteo?.inventario_final   != null ? Number(conteo.inventario_final)   : null
      const vendidoPos = Number(conteo?.vendido_pos || 0)

      // Final teorico (automatico) = inicial - ventas_loyverse - vendido_pos.
      // vendido_pos lo acumula la RPC pos_descontar_inventario al confirmar
      // una venta POS propia (origen_tipo=pos_propio). Requiere inicial
      // cargado: si no hay, no hay teorico ni variacion.
      const teorico = inicial != null ? round3(inicial - ventas.cantidad - vendidoPos) : null
      const variacion = (teorico != null && final != null) ? round3(final - teorico) : null

      totalVentasMonto    += ventas.monto
      totalVentasCantidad += ventas.cantidad
      if (final != null) variantesConteoFinal++
      if (variacion != null) {
        variacionTotal += variacion
        if (variacion < 0) mermaTotal += variacion
      }

      const sugeridoAyer = finalAyerPorVariant[v.variant_id]
      return {
        variant_id:        v.variant_id,
        item_id:           v.item_id,
        item_name:         v.item_name,
        variant_name:      v.variant_name,
        sku:               v.sku,
        track_stock:       v.track_stock,
        stock_actual_pos:  v.stock_actual_pos,
        ventas_cantidad:   round3(ventas.cantidad),
        ventas_monto:      Math.round(ventas.monto * 100) / 100,
        vendido_pos:       round3(vendidoPos),
        inventario_inicial: inicial,
        inventario_final:   final,
        inventario_teorico: teorico,
        variacion,
        inicial_sugerido_ayer: sugeridoAyer != null ? round3(sugeridoAyer) : null,
        conteo_id:         conteo?.id || null,
        notas:             conteo?.notas || null,
        updated_at:        conteo?.updated_at || null,
      }
    })

    // Orden estable: por nombre de item.
    filas.sort((a, b) => {
      const an = (a.item_name || '').toLowerCase()
      const bn = (b.item_name || '').toLowerCase()
      if (an !== bn) return an.localeCompare(bn)
      return (a.variant_name || '').localeCompare(b.variant_name || '')
    })

    return res.status(200).json({
      ok: true,
      fecha,
      store_id: store_id || null,
      resumen: {
        variantes_totales:    filas.length,
        variantes_con_ventas: filas.filter(f => f.ventas_cantidad !== 0).length,
        variantes_conteo_final: variantesConteoFinal,
        ventas_monto_total:   Math.round(totalVentasMonto * 100) / 100,
        ventas_cantidad_total: round3(totalVentasCantidad),
        merma_unidades:       round3(mermaTotal),
        variacion_neta_unidades: round3(variacionTotal),
      },
      filas,
    })
  } catch (e) {
    console.error('[inventario.diario.list] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

// ---------------------------------------------------------------------------
// POST: upsert un conteo (puede traer solo inicial, solo final, o ambos)
// ---------------------------------------------------------------------------

async function upsert(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const {
    fecha,
    variant_id,
    store_id = '',
    inventario_inicial,
    inventario_final,
    notas,
  } = req.body || {}

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha (YYYY-MM-DD) requerida' })
  }
  if (!variant_id || typeof variant_id !== 'string') {
    return res.status(400).json({ error: 'variant_id requerido' })
  }

  // Normalizacion: '' o null => null. Numero invalido => 400.
  function parseOpt(v, label) {
    if (v === '' || v === null || v === undefined) return null
    const n = Number(v)
    if (!Number.isFinite(n)) {
      throw new Error(`${label} debe ser numerico`)
    }
    return n
  }

  let inicialNum, finalNum
  try {
    inicialNum = parseOpt(inventario_inicial, 'inventario_inicial')
    finalNum   = parseOpt(inventario_final,   'inventario_final')
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }

  // Si todo viene vacio, no tiene sentido guardar — pero la fila tal vez existe
  // (el usuario podria estar "limpiando"). Permitimos guardar con todo null
  // siempre que haya notas, sino borramos la fila existente si todo queda vacio.
  const todoVacio = inicialNum == null && finalNum == null && !notas

  try {
    if (todoVacio) {
      // Borrar la fila si existia (es el "no tengo nada que guardar para esta variante hoy").
      const { error: delErr } = await auth.admin
        .from('conteos_diarios_producto')
        .delete()
        .eq('fecha', fecha)
        .eq('variant_id', variant_id)
        .eq('store_id', store_id)
      if (delErr) throw new Error('delete: ' + delErr.message)
      return res.status(200).json({ ok: true, conteo: null, eliminado: true })
    }

    // Upsert real (UNIQUE en fecha+variant_id+store_id).
    // Buscamos primero para preservar created_by / created_at.
    const { data: existente } = await auth.admin
      .from('conteos_diarios_producto')
      .select('id, created_by')
      .eq('fecha', fecha)
      .eq('variant_id', variant_id)
      .eq('store_id', store_id)
      .maybeSingle()

    const payload = {
      fecha,
      variant_id,
      store_id,
      inventario_inicial: inicialNum,
      inventario_final:   finalNum,
      notas: notas?.trim() || null,
      updated_by: auth.user.id,
    }
    if (!existente) payload.created_by = auth.user.id

    const { data, error } = await auth.admin
      .from('conteos_diarios_producto')
      .upsert(payload, { onConflict: 'fecha,variant_id,store_id' })
      .select()
      .single()

    if (error) {
      console.error('[inventario.diario.upsert] ERROR:', error.message)
      return res.status(500).json({ ok: false, error: error.message })
    }

    return res.status(200).json({ ok: true, conteo: data })
  } catch (e) {
    console.error('[inventario.diario.upsert] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

export const config = { maxDuration: 30 }
