// lib/contabilidad/generador.js
// Genera asientos contables automaticos a partir de eventos de negocio.
//
// Diseno:
//   - Cada funcion construye partidas y llama a crearAsientoPosteado.
//   - Si falla por mapping faltante, devuelve { ok: false, error } SIN
//     romper el flujo de negocio (la API que llama decide si abortar o no).
//   - Idempotencia: antes de crear, busca si ya existe un asiento con
//     mismo (origen_tipo, origen_id) y, si si, devuelve { ok: true, ya_existe: true }.

import { cargarMappings, requireCuenta, MappingFaltante } from './mappings'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// Helper interno: postea un asiento en una sola transaccion (best effort sin tx real).
async function crearAsientoPosteado(admin, { fecha, descripcion, partidas, origen_tipo, origen_id, user_id }) {
  // Validar balance
  let totalDebe = 0, totalHaber = 0
  for (const p of partidas) { totalDebe += Number(p.debe) || 0; totalHaber += Number(p.haber) || 0 }
  totalDebe = round2(totalDebe); totalHaber = round2(totalHaber)
  if (totalDebe !== totalHaber) {
    return { ok: false, error: `Asiento generado desbalanceado: debe=${totalDebe} haber=${totalHaber}` }
  }

  // Idempotencia
  if (origen_tipo && origen_id) {
    const { data: existente } = await admin
      .from('asientos').select('id, numero')
      .eq('origen_tipo', origen_tipo).eq('origen_id', origen_id)
      .neq('estado', 'anulado').limit(1).maybeSingle()
    if (existente) return { ok: true, ya_existe: true, asiento_id: existente.id, numero: existente.numero }
  }

  // Crear cabecera (estado=posteado directamente; el evento ya ocurrió en el negocio)
  const { data: asiento, error: aErr } = await admin.from('asientos').insert({
    fecha, descripcion,
    total_debe: totalDebe, total_haber: totalHaber,
    estado: 'posteado',
    posteado_at: new Date().toISOString(),
    posteado_por: user_id || null,
    origen_tipo: origen_tipo || 'auto',
    origen_id: origen_id || null,
    creado_por: user_id || null,
  }).select().single()
  if (aErr) return { ok: false, error: aErr.message }

  // Partidas
  const rows = partidas.map((p, i) => ({
    asiento_id: asiento.id, cuenta_id: p.cuenta_id,
    debe: round2(p.debe || 0), haber: round2(p.haber || 0),
    concepto: p.concepto || null, orden: i,
  }))
  const { error: pErr } = await admin.from('asientos_partidas').insert(rows)
  if (pErr) {
    await admin.from('asientos').delete().eq('id', asiento.id)
    return { ok: false, error: pErr.message }
  }
  return { ok: true, asiento_id: asiento.id, numero: asiento.numero }
}

// ============================================================================
// 1. CIERRE DE CAJA -> asiento de ventas diarias
// ============================================================================
//   DEBE  caja_efectivo   = cierre.ventas_efectivo
//   DEBE  banco_default   = cierre.ventas_tarjeta + cierre.ventas_otros
//   HABER ventas_default  = ventas_total (incluye IVA si se factura con IVA, simplificacion)
//   Por cada egreso:
//     DEBE gastos_operativos_default = egreso.monto
//     HABER caja_efectivo            = egreso.monto

export async function generarAsientoCierreCaja(admin, cierreId, userId) {
  try {
    const m = await cargarMappings(admin)
    const { data: cierre, error } = await admin.from('cierres_caja').select('*').eq('id', cierreId).single()
    if (error || !cierre) return { ok: false, error: 'Cierre no encontrado' }
    const { data: egresos } = await admin.from('cierres_egresos').select('*').eq('cierre_id', cierreId)

    const partidas = []
    const vEf  = Number(cierre.ventas_efectivo) || 0
    const vTar = Number(cierre.ventas_tarjeta) || 0
    const vOt  = Number(cierre.ventas_otros) || 0
    const vTot = round2(vEf + vTar + vOt)
    if (vTot <= 0 && (!egresos || egresos.length === 0)) {
      return { ok: false, error: 'Cierre sin movimiento contable (sin ventas ni egresos)' }
    }

    if (vEf > 0)        partidas.push({ cuenta_id: requireCuenta(m, 'caja_efectivo'), debe: vEf, concepto: 'Ventas en efectivo' })
    if (vTar + vOt > 0) partidas.push({ cuenta_id: requireCuenta(m, 'banco_default'), debe: round2(vTar + vOt), concepto: 'Ventas con tarjeta / otros' })
    if (vTot > 0)       partidas.push({ cuenta_id: requireCuenta(m, 'ventas_default'), haber: vTot, concepto: `Ventas día ${cierre.fecha}` })

    for (const e of egresos || []) {
      partidas.push({ cuenta_id: requireCuenta(m, 'gastos_operativos_default'), debe: Number(e.monto), concepto: e.concepto })
      partidas.push({ cuenta_id: requireCuenta(m, 'caja_efectivo'),             haber: Number(e.monto), concepto: e.concepto })
    }

    return crearAsientoPosteado(admin, {
      fecha: cierre.fecha,
      descripcion: `Cierre de caja ${cierre.fecha}`,
      partidas,
      origen_tipo: 'cierre_caja', origen_id: cierreId,
      user_id: userId,
    })
  } catch (e) {
    if (e instanceof MappingFaltante) return { ok: false, error: e.message, mapping_faltante: e.clave }
    return { ok: false, error: e.message }
  }
}

// ============================================================================
// 2. COMPRA RECIBIDA -> asiento de compra
// ============================================================================
//   Por cada linea con insumo_id: DEBE inventario_insumos = linea.subtotal
//   Lineas sin insumo:            DEBE gastos_operativos_default = linea.subtotal
//   Si hay IVA:                   DEBE iva_credito = compra.iva
//   Contrapartida segun metodo:
//     'credito' -> HABER proveedores = compra.total
//     otro      -> HABER caja_efectivo o banco_default = compra.total

export async function generarAsientoCompraRecibida(admin, compraId, userId) {
  try {
    const m = await cargarMappings(admin)
    const { data: compra, error } = await admin
      .from('compras').select('*, proveedores(nombre)').eq('id', compraId).single()
    if (error || !compra) return { ok: false, error: 'Compra no encontrada' }
    const { data: lineas } = await admin.from('compras_lineas').select('*').eq('compra_id', compraId)

    const partidas = []
    let sumGasto = 0, sumInventario = 0
    for (const l of lineas || []) {
      if (l.insumo_id) sumInventario += Number(l.subtotal) || 0
      else             sumGasto      += Number(l.subtotal) || 0
    }
    sumInventario = round2(sumInventario); sumGasto = round2(sumGasto)

    if (sumInventario > 0) partidas.push({ cuenta_id: requireCuenta(m, 'inventario_insumos'), debe: sumInventario, concepto: 'Compra de insumos' })
    if (sumGasto > 0)      partidas.push({ cuenta_id: requireCuenta(m, 'gastos_operativos_default'), debe: sumGasto, concepto: 'Compra (gasto)' })
    if (Number(compra.iva) > 0) {
      partidas.push({ cuenta_id: requireCuenta(m, 'iva_credito'), debe: Number(compra.iva), concepto: 'IVA crédito fiscal' })
    }

    // Contrapartida
    const cuentaContra = compra.metodo_pago === 'credito'      ? requireCuenta(m, 'proveedores')
                       : compra.metodo_pago === 'transferencia' || compra.metodo_pago === 'cheque' ? requireCuenta(m, 'banco_default')
                       :                                          requireCuenta(m, 'caja_efectivo')
    partidas.push({ cuenta_id: cuentaContra, haber: Number(compra.total), concepto: `Pago a ${compra.proveedores?.nombre || 'proveedor'}` })

    return crearAsientoPosteado(admin, {
      fecha: compra.fecha,
      descripcion: `Compra ${compra.numero_factura ? '#' + compra.numero_factura + ' ' : ''}${compra.proveedores?.nombre || ''}`.trim(),
      partidas,
      origen_tipo: 'compra', origen_id: compraId,
      user_id: userId,
    })
  } catch (e) {
    if (e instanceof MappingFaltante) return { ok: false, error: e.message, mapping_faltante: e.clave }
    return { ok: false, error: e.message }
  }
}

// ============================================================================
// 3. PLANILLA PAGADA -> asiento de planilla
// ============================================================================
//   DEBE  sueldos_gasto         = total_bruto + horas_extra_total + comisiones_total
//   DEBE  bonificaciones_gasto  = bonificaciones (otros_ingresos sum + bonif_incentivo sum)
//   DEBE  igss_patronal_gasto   = igss_patronal_total
//   DEBE  irtra_gasto           = irtra_total
//   DEBE  intecap_gasto         = intecap_total
//   DEBE  indemnizacion_gasto   = (salario/24 * 3 acumulado)
//   ... etc. (provisiones bono14/aguinaldo/vacaciones se contabilizan tambien)
//
//   HABER igss_laboral_por_pagar = total_igss_empleados
//   HABER igss_patronal_por_pagar = igss_patronal_total
//   HABER irtra_por_pagar / intecap_por_pagar
//   HABER caja_efectivo o banco_default = liquido_a_pagar (sumando todos los lineas)
//   HABER indemnizacion/bono14/aguinaldo por pagar = provisiones

export async function generarAsientoPlanillaPagada(admin, planillaId, userId) {
  try {
    const m = await cargarMappings(admin)
    const { data: planilla } = await admin.from('planillas').select('*').eq('id', planillaId).single()
    if (!planilla) return { ok: false, error: 'Planilla no encontrada' }
    const { data: lineas } = await admin.from('planilla_lineas').select('*').eq('planilla_id', planillaId)

    // Agregados
    let sueldos = 0, horasExtra = 0, comisiones = 0, otrosIng = 0, bonifIncentivo = 0
    let igssLab = 0, igssPat = 0, irtra = 0, intecap = 0, indem = 0
    let bono14 = 0, aguinaldo = 0, vacaciones = 0
    let descuentosPropios = 0  // prestamo, embargo, otros, faltantes — netean al liquido del empleado
    for (const l of lineas || []) {
      sueldos        += Number(l.salario_quincenal)        || 0
      horasExtra     += Number(l.horas_extra)              || 0
      comisiones     += Number(l.comisiones)               || 0
      otrosIng       += Number(l.otros_ingresos)           || 0
      bonifIncentivo += Number(l.bonificacion_incentivo)   || 0
      igssLab        += Number(l.igss_empleado)            || 0
      igssPat        += Number(l.igss_patronal)            || 0
      irtra          += Number(l.irtra)                    || 0
      intecap        += Number(l.intecap)                  || 0
      indem          += Number(l.indemnizacion)            || 0
      bono14         += Number(l.bono14_quincenal)         || 0
      aguinaldo      += Number(l.aguinaldo_quincenal)      || 0
      vacaciones     += Number(l.vacaciones_quincenal)     || 0
      descuentosPropios += (Number(l.prestamo_anticipo) || 0) + (Number(l.embargo_deuda) || 0)
                         + (Number(l.otros_descuentos) || 0) + (Number(l.faltante_inventario) || 0)
                         + (Number(l.faltante_efectivo) || 0) + (Number(l.descuentos_varios) || 0)
    }
    sueldos = round2(sueldos); horasExtra = round2(horasExtra); comisiones = round2(comisiones)
    otrosIng = round2(otrosIng); bonifIncentivo = round2(bonifIncentivo)
    igssLab = round2(igssLab); igssPat = round2(igssPat); irtra = round2(irtra); intecap = round2(intecap); indem = round2(indem)
    bono14 = round2(bono14); aguinaldo = round2(aguinaldo); vacaciones = round2(vacaciones)
    descuentosPropios = round2(descuentosPropios)
    const liquido = round2(Number(planilla.total_liquido) || 0)

    const partidas = []
    // DEBE — Gastos
    if (sueldos + horasExtra + comisiones > 0) {
      const totSueldo = round2(sueldos + horasExtra + comisiones)
      partidas.push({ cuenta_id: requireCuenta(m, 'sueldos_gasto'), debe: totSueldo, concepto: 'Sueldos y horas extra' })
    }
    if (otrosIng + bonifIncentivo > 0)
      partidas.push({ cuenta_id: requireCuenta(m, 'bonificaciones_gasto'), debe: round2(otrosIng + bonifIncentivo), concepto: 'Bonificaciones' })
    if (igssPat > 0)   partidas.push({ cuenta_id: requireCuenta(m, 'igss_patronal_gasto'), debe: igssPat, concepto: 'IGSS patronal' })
    if (irtra > 0)     partidas.push({ cuenta_id: requireCuenta(m, 'irtra_gasto'),         debe: irtra,   concepto: 'IRTRA' })
    if (intecap > 0)   partidas.push({ cuenta_id: requireCuenta(m, 'intecap_gasto'),       debe: intecap, concepto: 'INTECAP' })
    if (indem > 0)     partidas.push({ cuenta_id: requireCuenta(m, 'indemnizacion_gasto'), debe: indem,   concepto: 'Provisión indemnización' })
    if (bono14 > 0)    partidas.push({ cuenta_id: requireCuenta(m, 'bono14_gasto'),        debe: bono14,  concepto: 'Provisión bono 14' })
    if (aguinaldo > 0) partidas.push({ cuenta_id: requireCuenta(m, 'aguinaldo_gasto'),     debe: aguinaldo,concepto: 'Provisión aguinaldo' })
    if (vacaciones > 0)partidas.push({ cuenta_id: requireCuenta(m, 'vacaciones_gasto'),    debe: vacaciones,concepto: 'Provisión vacaciones' })

    // HABER — Pasivos y banco
    if (igssLab > 0)   partidas.push({ cuenta_id: requireCuenta(m, 'igss_laboral_por_pagar'),  haber: igssLab,  concepto: 'IGSS laboral retenido' })
    if (igssPat > 0)   partidas.push({ cuenta_id: requireCuenta(m, 'igss_patronal_por_pagar'), haber: igssPat,  concepto: 'IGSS patronal por pagar' })
    if (irtra > 0)     partidas.push({ cuenta_id: requireCuenta(m, 'irtra_por_pagar'),         haber: irtra,    concepto: 'IRTRA por pagar' })
    if (intecap > 0)   partidas.push({ cuenta_id: requireCuenta(m, 'intecap_por_pagar'),       haber: intecap,  concepto: 'INTECAP por pagar' })
    if (indem > 0)     partidas.push({ cuenta_id: requireCuenta(m, 'indemnizacion_por_pagar'), haber: indem,    concepto: 'Indemnización por pagar (provisión)' })
    if (bono14 > 0)    partidas.push({ cuenta_id: requireCuenta(m, 'bono14_por_pagar'),        haber: bono14,   concepto: 'Bono 14 por pagar (provisión)' })
    if (aguinaldo > 0) partidas.push({ cuenta_id: requireCuenta(m, 'aguinaldo_por_pagar'),     haber: aguinaldo,concepto: 'Aguinaldo por pagar (provisión)' })
    // Pago a empleados: liquido en banco/caja. Si tiene tipo_pago transferencia mayoritario, banco.
    const tipoMayor = ((lineas || []).reduce((acc, l) => { acc[l.tipo_pago || 'efectivo'] = (acc[l.tipo_pago || 'efectivo']||0) + 1; return acc }, {}))
    const principalTipo = Object.entries(tipoMayor).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'efectivo'
    const cuentaPago = principalTipo === 'efectivo' ? requireCuenta(m, 'caja_efectivo') : requireCuenta(m, 'banco_default')
    if (liquido > 0) partidas.push({ cuenta_id: cuentaPago, haber: liquido, concepto: 'Líquido pagado a empleados' })

    return crearAsientoPosteado(admin, {
      fecha: planilla.fecha_fin,
      descripcion: `Planilla ${planilla.periodo}`,
      partidas,
      origen_tipo: 'planilla', origen_id: planillaId,
      user_id: userId,
    })
  } catch (e) {
    if (e instanceof MappingFaltante) return { ok: false, error: e.message, mapping_faltante: e.clave }
    return { ok: false, error: e.message }
  }
}

// ============================================================================
// 4. LIQUIDACION -> asiento de finiquito
// ============================================================================
//   DEBE  indemnizacion_gasto   = indemnizacion + preaviso
//   DEBE  vacaciones_gasto      = vacaciones_pendientes
//   DEBE  aguinaldo_gasto       = aguinaldo_proporcional
//   DEBE  bono14_gasto          = bono14_proporcional
//   DEBE  sueldos_gasto         = salario_pendiente
//   HABER caja_efectivo/banco   = total_neto (lo que se paga)
//   HABER (varias) por deducciones (prestamo etc.) — simplificacion: caja por liquido

export async function generarAsientoLiquidacion(admin, liquidacionId, userId) {
  try {
    const m = await cargarMappings(admin)
    const { data: liq } = await admin.from('liquidaciones').select('*').eq('id', liquidacionId).single()
    if (!liq) return { ok: false, error: 'Liquidacion no encontrada' }

    const partidas = []
    const indemTotal = round2(Number(liq.indemnizacion) + Number(liq.preaviso))
    if (indemTotal > 0) partidas.push({ cuenta_id: requireCuenta(m, 'indemnizacion_gasto'), debe: indemTotal, concepto: 'Indemnización + preaviso' })
    if (Number(liq.vacaciones_pendientes)   > 0) partidas.push({ cuenta_id: requireCuenta(m, 'vacaciones_gasto'), debe: Number(liq.vacaciones_pendientes), concepto: 'Vacaciones proporcionales' })
    if (Number(liq.aguinaldo_proporcional)  > 0) partidas.push({ cuenta_id: requireCuenta(m, 'aguinaldo_gasto'),  debe: Number(liq.aguinaldo_proporcional), concepto: 'Aguinaldo proporcional' })
    if (Number(liq.bono14_proporcional)     > 0) partidas.push({ cuenta_id: requireCuenta(m, 'bono14_gasto'),     debe: Number(liq.bono14_proporcional),   concepto: 'Bono 14 proporcional' })
    if (Number(liq.salario_pendiente)       > 0) partidas.push({ cuenta_id: requireCuenta(m, 'sueldos_gasto'),    debe: Number(liq.salario_pendiente),     concepto: 'Salario pendiente' })

    // Contrapartida: pago neto (banco si > Q5000, caja si menor — heuristica)
    const cuentaPago = Number(liq.total_neto) >= 5000 ? requireCuenta(m, 'banco_default') : requireCuenta(m, 'caja_efectivo')
    partidas.push({ cuenta_id: cuentaPago, haber: Number(liq.total_neto), concepto: `Pago liquidación ${liq.nombre}` })

    return crearAsientoPosteado(admin, {
      fecha: liq.fecha_baja,
      descripcion: `Liquidación ${liq.nombre}`,
      partidas,
      origen_tipo: 'liquidacion', origen_id: liquidacionId,
      user_id: userId,
    })
  } catch (e) {
    if (e instanceof MappingFaltante) return { ok: false, error: e.message, mapping_faltante: e.clave }
    return { ok: false, error: e.message }
  }
}
