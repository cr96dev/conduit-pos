// lib/turnos/helpers.js
// Helpers compartidos para turnos de caja.

// Devuelve el turno abierto del cajero (o null).
export async function turnoAbiertoDeCajero(admin, cajeroId) {
  const { data } = await admin
    .from('turnos_caja')
    .select('*')
    .eq('cajero_id', cajeroId)
    .eq('estado', 'abierto')
    .maybeSingle()
  return data || null
}

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// Calcula desglose de ventas certificadas asociadas al turno.
//
// Reglas:
//   - Solo facturas con estado='certificada' (las anuladas no cuentan).
//   - Si una factura tiene filas en facturas_fel_pagos (split payment),
//     se suma POR METODO de cada fila individual. metodo_pago de la factura
//     deberia ser 'mixto' en ese caso pero no lo usamos para el computo.
//   - Si una factura NO tiene filas en facturas_fel_pagos (legacy o single
//     payment), se suma el total completo al bucket de facturas_fel.metodo_pago.
//   - cantidad_facturas es siempre el numero de facturas distintas (no de pagos).
export async function calcularDesgloseVentasTurno(admin, turnoId) {
  const { data: facturas, error } = await admin
    .from('facturas_fel')
    .select('id, total, metodo_pago, estado')
    .eq('turno_id', turnoId)
    .eq('estado', 'certificada')

  if (error) return { error: error.message }

  const facturaIds = (facturas || []).map(f => f.id)

  // Cargar todos los pagos divididos en un solo query (si hay facturas).
  let pagosPorFactura = new Map()
  if (facturaIds.length > 0) {
    const { data: pagos } = await admin
      .from('facturas_fel_pagos')
      .select('factura_id, metodo, monto')
      .in('factura_id', facturaIds)
    for (const p of pagos || []) {
      if (!pagosPorFactura.has(p.factura_id)) pagosPorFactura.set(p.factura_id, [])
      pagosPorFactura.get(p.factura_id).push(p)
    }
  }

  let efectivo = 0, tarjeta = 0, transferencia = 0, pedidos_ya = 0, otro = 0, total = 0
  const sumarBucket = (m, monto) => {
    const v = Number(monto) || 0
    switch (m) {
      case 'efectivo':      efectivo += v; break
      case 'tarjeta':       tarjeta += v; break
      case 'transferencia': transferencia += v; break
      case 'pedidos_ya':    pedidos_ya += v; break
      default:              otro += v; break
    }
  }

  for (const f of facturas || []) {
    const monto = Number(f.total) || 0
    total += monto

    const pagos = pagosPorFactura.get(f.id)
    if (pagos && pagos.length > 0) {
      // Split payment — sumar cada metodo individualmente
      for (const p of pagos) sumarBucket(p.metodo, p.monto)
    } else {
      // Legacy / single payment — sumar el total al bucket de metodo_pago.
      // Si metodo_pago='mixto' sin pagos detallados, cae a 'otro' (raro pero seguro).
      sumarBucket(f.metodo_pago === 'mixto' ? 'otro' : f.metodo_pago, monto)
    }
  }

  return {
    ventas_efectivo: r2(efectivo),
    ventas_tarjeta: r2(tarjeta),
    ventas_transferencia: r2(transferencia),
    ventas_pedidos_ya: r2(pedidos_ya),
    ventas_otro: r2(otro),
    ventas_total: r2(total),
    cantidad_facturas: (facturas || []).length,
  }
}
