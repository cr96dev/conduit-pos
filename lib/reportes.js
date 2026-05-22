// lib/reportes.js
// Agregaciones reutilizables para los reportes financieros / comerciales.
//
// Todas las funciones reciben (admin, desde, hasta) en formato YYYY-MM-DD
// (zona GT, inclusive en ambos extremos) y devuelven estructuras serializables.
//
// Diseno conservador:
//   - Ingresos vienen de Loyverse (loyverse_receipts/line_items) que es la
//     fuente "ground truth" de ventas. Los asientos contables pueden estar
//     incompletos (FEL/cierres no siempre cerrados).
//   - COGS = teorico = sum(unidades_vendidas * receta.costo_efectivo).
//     Hasta que arranque la carga masiva de insumos el 30/05, esto es estandar.
//   - Gastos = union de (cierres_egresos del rango) + (asientos posteados
//     contra cuentas tipo='gasto' en el rango). Asi cubrimos tanto el flujo
//     de cierre de caja como las contabilizaciones manuales/planillas.

import { rangoUTCDeDiaGT } from './fecha-gt'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000
const IVA_GT = 0.12

// ---------------------------------------------------------------------------
// VENTAS: agregaciones desde Loyverse en un rango GT
// ---------------------------------------------------------------------------

export async function calcularVentasRango(admin, desde, hasta) {
  if (!desde || !hasta) throw new Error('desde/hasta requeridos')
  const { desdeUTC } = rangoUTCDeDiaGT(desde)
  const { hastaUTC } = rangoUTCDeDiaGT(hasta)

  // 1) Recibos (paginado para >1000).
  const recs = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await admin
      .from('loyverse_receipts')
      .select('loyverse_id, receipt_date, receipt_type, cancelled_at, total_money, loyverse_receipt_payments(name, type, money_amount)')
      .gte('receipt_date', desdeUTC)
      .lt('receipt_date', hastaUTC)
      .range(from, from + PAGE - 1)
    if (error) throw new Error('receipts: ' + error.message)
    if (!data || data.length === 0) break
    recs.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  // 2) Validos + signo + fecha GT.
  const recMeta = {}
  const validIds = []
  let totalQ = 0, totalRecibos = 0
  const porDia = {}              // fecha_gt -> { monto, recibos }
  const porPago = {}             // metodo -> monto
  for (const r of recs) {
    if (r.cancelled_at) continue
    const signo = r.receipt_type === 'REFUND' ? -1 : 1
    const fGT = utcToGTDate(r.receipt_date)
    recMeta[r.loyverse_id] = { signo, fecha_gt: fGT }
    validIds.push(r.loyverse_id)

    const monto = signo * Number(r.total_money || 0)
    totalQ += monto
    totalRecibos++
    const d = porDia[fGT] || (porDia[fGT] = { fecha: fGT, monto: 0, recibos: 0 })
    d.monto += monto
    d.recibos += 1

    for (const p of r.loyverse_receipt_payments || []) {
      const nombre = normalizarPago(p.name, p.type)
      porPago[nombre] = (porPago[nombre] || 0) + signo * Number(p.money_amount || 0)
    }
  }

  // 3) Line items por chunks.
  const porProducto = {}   // item_id -> { item_id, item_name, cantidad, monto, lineas }
  const porCategoria = {}  // category_id -> { category_id, nombre, monto, unidades }
  const lineItemIds = []
  for (let i = 0; i < validIds.length; i += 500) {
    const chunk = validIds.slice(i, i + 500)
    const { data: lines, error } = await admin
      .from('loyverse_receipt_line_items')
      .select('receipt_id, item_id, item_name, variant_id, quantity, total_money')
      .in('receipt_id', chunk)
    if (error) throw new Error('line_items: ' + error.message)
    for (const ln of lines || []) {
      const meta = recMeta[ln.receipt_id]
      if (!meta) continue
      const qty = meta.signo * Number(ln.quantity || 0)
      const mon = meta.signo * Number(ln.total_money || 0)
      if (ln.item_id) {
        const p = porProducto[ln.item_id] || { item_id: ln.item_id, item_name: ln.item_name || '?', cantidad: 0, monto: 0, lineas: 0 }
        p.cantidad += qty
        p.monto += mon
        p.lineas += 1
        porProducto[ln.item_id] = p
      }
      lineItemIds.push(ln.item_id)
    }
  }

  // 4) Categorias: traer items + categories.
  const itemIds = Object.keys(porProducto)
  if (itemIds.length > 0) {
    const { data: items } = await admin
      .from('loyverse_items')
      .select('loyverse_id, category_id')
      .in('loyverse_id', itemIds)
    const itemCat = {}
    const catIds = new Set()
    for (const it of items || []) {
      itemCat[it.loyverse_id] = it.category_id
      if (it.category_id) catIds.add(it.category_id)
    }
    const { data: cats } = await admin
      .from('loyverse_categories')
      .select('loyverse_id, name')
      .in('loyverse_id', Array.from(catIds))
    const catName = {}
    for (const c of cats || []) catName[c.loyverse_id] = c.name

    for (const p of Object.values(porProducto)) {
      const cid = itemCat[p.item_id] || null
      const key = cid || '__sin_categoria__'
      const acc = porCategoria[key] || { category_id: cid, nombre: catName[cid] || 'Sin categoría', monto: 0, unidades: 0, productos: 0 }
      acc.monto += p.monto
      acc.unidades += p.cantidad
      acc.productos += 1
      porCategoria[key] = acc
    }
  }

  // Round + ordenar
  const productos = Object.values(porProducto).map(p => ({
    ...p, monto: round2(p.monto), cantidad: round2(p.cantidad),
  })).sort((a, b) => b.monto - a.monto)

  const categorias = Object.values(porCategoria).map(c => ({
    ...c, monto: round2(c.monto), unidades: round2(c.unidades),
  })).sort((a, b) => b.monto - a.monto)

  const dias = Object.values(porDia).map(d => ({
    ...d, monto: round2(d.monto),
  })).sort((a, b) => a.fecha.localeCompare(b.fecha))

  const metodos_pago = Object.entries(porPago).map(([nombre, monto]) => ({
    nombre, monto: round2(monto),
  })).sort((a, b) => b.monto - a.monto)

  const ticketProm = totalRecibos > 0 ? totalQ / totalRecibos : 0

  return {
    desde, hasta,
    resumen: {
      total: round2(totalQ),
      total_sin_iva: round2(totalQ / (1 + IVA_GT)),
      iva: round2(totalQ - totalQ / (1 + IVA_GT)),
      recibos: totalRecibos,
      ticket_promedio: round2(ticketProm),
      unidades_totales: round2(productos.reduce((s, p) => s + p.cantidad, 0)),
      productos_unicos: productos.length,
    },
    dias,
    metodos_pago,
    categorias,
    productos,
  }
}

// ---------------------------------------------------------------------------
// RENTABILIDAD: cruza ventas con recetas
// ---------------------------------------------------------------------------

export async function calcularRentabilidadRango(admin, desde, hasta) {
  const ventas = await calcularVentasRango(admin, desde, hasta)

  // Recetas activas con item linkeado.
  const { data: recetas } = await admin
    .from('recetas')
    .select('id, nombre, loyverse_item_id, costo_calculado, costo_personalizado, precio_venta')
    .eq('activa', true)
    .not('loyverse_item_id', 'is', null)

  const recPorItem = {}
  for (const r of recetas || []) recPorItem[r.loyverse_item_id] = r

  const productos = []
  let ingresos_con_receta = 0
  let costo_total = 0
  for (const p of ventas.productos) {
    const r = recPorItem[p.item_id]
    if (r) {
      const costoUnit = r.costo_personalizado != null ? Number(r.costo_personalizado) : Number(r.costo_calculado || 0)
      const costoTotal = costoUnit * p.cantidad
      const ingresosSinIva = p.monto / (1 + IVA_GT)
      const margenQ = ingresosSinIva - costoTotal
      const margenPct = ingresosSinIva > 0 ? (margenQ / ingresosSinIva) * 100 : null
      productos.push({
        item_id: p.item_id,
        item_name: p.item_name,
        receta_id: r.id,
        receta_nombre: r.nombre,
        unidades: round2(p.cantidad),
        ingresos: round2(p.monto),
        ingresos_sin_iva: round2(ingresosSinIva),
        costo_unitario: round4(costoUnit),
        costo_total: round2(costoTotal),
        margen_q: round2(margenQ),
        margen_pct: margenPct != null ? Math.round(margenPct * 100) / 100 : null,
        con_receta: true,
      })
      ingresos_con_receta += p.monto
      costo_total += costoTotal
    } else {
      productos.push({
        item_id: p.item_id,
        item_name: p.item_name,
        receta_id: null,
        unidades: round2(p.cantidad),
        ingresos: round2(p.monto),
        ingresos_sin_iva: round2(p.monto / (1 + IVA_GT)),
        costo_unitario: null,
        costo_total: null,
        margen_q: null,
        margen_pct: null,
        con_receta: false,
      })
    }
  }

  // Ordenar: con margen real primero, los mejores arriba.
  productos.sort((a, b) => {
    if (a.con_receta !== b.con_receta) return a.con_receta ? -1 : 1
    return (b.margen_q ?? -Infinity) - (a.margen_q ?? -Infinity)
  })

  const cobertura_pct = ventas.resumen.total > 0
    ? round2((ingresos_con_receta / ventas.resumen.total) * 100)
    : 0

  return {
    desde, hasta,
    resumen: {
      ventas_total: ventas.resumen.total,
      ventas_total_sin_iva: round2(ventas.resumen.total / (1 + IVA_GT)),
      ingresos_con_receta: round2(ingresos_con_receta),
      ingresos_sin_receta: round2(ventas.resumen.total - ingresos_con_receta),
      cobertura_pct,
      costo_teorico_total: round2(costo_total),
      utilidad_bruta_teorica: round2(ingresos_con_receta / (1 + IVA_GT) - costo_total),
      food_cost_pct: ingresos_con_receta > 0
        ? round2((costo_total / (ingresos_con_receta / (1 + IVA_GT))) * 100)
        : null,
      margen_promedio_pct: (() => {
        const conMargen = productos.filter(p => p.margen_pct != null)
        if (conMargen.length === 0) return null
        // Ponderado por ingresos sin IVA.
        const ing = conMargen.reduce((s, p) => s + p.ingresos_sin_iva, 0)
        const m = conMargen.reduce((s, p) => s + (p.margen_q || 0), 0)
        return ing > 0 ? round2((m / ing) * 100) : null
      })(),
    },
    productos,
  }
}

// ---------------------------------------------------------------------------
// GASTOS: union de cierres_egresos + asientos posteados de tipo gasto
// ---------------------------------------------------------------------------

export async function calcularGastosRango(admin, desde, hasta) {
  // 1) Egresos chicos del cierre de caja.
  const { data: cierres } = await admin
    .from('cierres_caja')
    .select('id, fecha, cierres_egresos(id, concepto, monto)')
    .gte('fecha', desde)
    .lte('fecha', hasta)

  const egresosCierre = []
  for (const c of cierres || []) {
    for (const e of c.cierres_egresos || []) {
      egresosCierre.push({
        origen: 'cierre_caja',
        fecha: c.fecha,
        concepto: e.concepto,
        monto: Number(e.monto),
      })
    }
  }

  // 2) Asientos posteados con partidas DEBE en cuentas tipo='gasto' o 'costo'.
  const { data: partidas } = await admin
    .from('asientos_partidas')
    .select('debe, haber, concepto, cuentas_contables!inner(id, codigo, nombre, tipo), asientos!inner(fecha, estado, descripcion, origen_tipo)')
    .eq('asientos.estado', 'posteado')
    .in('cuentas_contables.tipo', ['gasto', 'costo'])
    .gte('asientos.fecha', desde)
    .lte('asientos.fecha', hasta)

  const partidasContables = []
  for (const p of partidas || []) {
    const monto = (Number(p.debe) || 0) - (Number(p.haber) || 0)
    if (monto === 0) continue
    partidasContables.push({
      origen: 'asiento_' + (p.asientos.origen_tipo || 'manual'),
      fecha: p.asientos.fecha,
      concepto: p.concepto || p.asientos.descripcion,
      cuenta_codigo: p.cuentas_contables.codigo,
      cuenta_nombre: p.cuentas_contables.nombre,
      cuenta_tipo: p.cuentas_contables.tipo,
      monto,
    })
  }

  // Agregar por (cuenta_tipo, cuenta_nombre) y por origen.
  const porCuenta = {}
  for (const p of partidasContables) {
    const k = `${p.cuenta_codigo}|${p.cuenta_nombre}`
    const acc = porCuenta[k] || { codigo: p.cuenta_codigo, nombre: p.cuenta_nombre, tipo: p.cuenta_tipo, monto: 0 }
    acc.monto += p.monto
    porCuenta[k] = acc
  }

  const total_egresos_caja = round2(egresosCierre.reduce((s, e) => s + e.monto, 0))
  const total_gastos_contables = round2(partidasContables.filter(p => p.cuenta_tipo === 'gasto').reduce((s, p) => s + p.monto, 0))
  const total_costos_contables = round2(partidasContables.filter(p => p.cuenta_tipo === 'costo').reduce((s, p) => s + p.monto, 0))

  return {
    desde, hasta,
    resumen: {
      total_egresos_caja,
      total_gastos_contables,
      total_costos_contables,
      total_general: round2(total_egresos_caja + total_gastos_contables + total_costos_contables),
    },
    egresos_caja: egresosCierre.sort((a, b) => b.monto - a.monto),
    partidas_contables: partidasContables.sort((a, b) => b.monto - a.monto),
    por_cuenta: Object.values(porCuenta).map(c => ({ ...c, monto: round2(c.monto) })).sort((a, b) => b.monto - a.monto),
  }
}

// ---------------------------------------------------------------------------
// P&L: estado de resultados (con COGS teorico)
// ---------------------------------------------------------------------------

export async function calcularPnL(admin, desde, hasta) {
  const rent = await calcularRentabilidadRango(admin, desde, hasta)
  const gastos = await calcularGastosRango(admin, desde, hasta)

  // Ingresos = ventas totales (sin IVA, base de negocio).
  const ingresos_brutos = rent.resumen.ventas_total
  const ingresos_netos = rent.resumen.ventas_total_sin_iva
  const iva_repercutido = round2(ingresos_brutos - ingresos_netos)

  // COGS teorico = costo_teorico_total. Cubre solo productos con receta.
  const cogs_teorico = rent.resumen.costo_teorico_total
  const ingresos_sin_receta_neto = round2(rent.resumen.ingresos_sin_receta / (1 + IVA_GT))
  const cogs_cobertura_pct = rent.resumen.cobertura_pct

  const utilidad_bruta = round2(ingresos_netos - cogs_teorico)
  const margen_bruto_pct = ingresos_netos > 0
    ? round2((utilidad_bruta / ingresos_netos) * 100)
    : null

  const gastos_op = gastos.resumen.total_gastos_contables + gastos.resumen.total_egresos_caja
  const utilidad_operativa = round2(utilidad_bruta - gastos_op)
  const margen_operativo_pct = ingresos_netos > 0
    ? round2((utilidad_operativa / ingresos_netos) * 100)
    : null

  return {
    desde, hasta,
    metadata: {
      cogs_es_teorico: true,
      cogs_cobertura_pct,
      nota: 'COGS calculado con costos teoricos de receta. La carga masiva de insumos reales habilita COGS real desde el inventario.',
    },
    ingresos: {
      brutos_con_iva: ingresos_brutos,
      netos_sin_iva: ingresos_netos,
      iva_repercutido,
    },
    cogs: {
      teorico: cogs_teorico,
      ingresos_con_receta_neto: round2(rent.resumen.ingresos_con_receta / (1 + IVA_GT)),
      ingresos_sin_receta_neto,
      cobertura_pct: cogs_cobertura_pct,
    },
    utilidad_bruta: {
      monto: utilidad_bruta,
      margen_pct: margen_bruto_pct,
    },
    gastos: {
      total: round2(gastos_op),
      egresos_caja: gastos.resumen.total_egresos_caja,
      contables: gastos.resumen.total_gastos_contables,
      detalle_por_cuenta: gastos.por_cuenta.filter(c => c.tipo === 'gasto'),
    },
    utilidad_operativa: {
      monto: utilidad_operativa,
      margen_pct: margen_operativo_pct,
    },
  }
}

// ---------------------------------------------------------------------------
// DASHBOARD: KPIs orquestados para vista resumen
// ---------------------------------------------------------------------------

export async function calcularDashboard(admin, desde, hasta) {
  const rent = await calcularRentabilidadRango(admin, desde, hasta)
  const ventas = await calcularVentasRango(admin, desde, hasta)

  const top5 = rent.productos.slice(0, 5)

  return {
    desde, hasta,
    kpis: {
      ingresos_total: ventas.resumen.total,
      ingresos_sin_iva: ventas.resumen.total_sin_iva,
      cogs_teorico: rent.resumen.costo_teorico_total,
      utilidad_bruta: rent.resumen.utilidad_bruta_teorica,
      food_cost_pct: rent.resumen.food_cost_pct,
      cobertura_recetas_pct: rent.resumen.cobertura_pct,
      margen_promedio_pct: rent.resumen.margen_promedio_pct,
      ticket_promedio: ventas.resumen.ticket_promedio,
      recibos: ventas.resumen.recibos,
      productos_unicos: ventas.resumen.productos_unicos,
    },
    serie_dias: ventas.dias,
    top5_productos: top5,
    top5_categorias: ventas.categorias.slice(0, 5),
    metodos_pago: ventas.metodos_pago,
  }
}

// ---------------------------------------------------------------------------
// helpers internos
// ---------------------------------------------------------------------------

function utcToGTDate(iso) {
  const t = new Date(iso).getTime() - 6 * 60 * 60 * 1000
  return new Date(t).toISOString().slice(0, 10)
}

function normalizarPago(name, type) {
  if (name && name.trim()) return name.trim().toUpperCase()
  if (type) return String(type).toUpperCase()
  return 'OTROS'
}
