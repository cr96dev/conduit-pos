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

// Calcula desglose de ventas certificadas asociadas al turno (por turno_id).
// Tolera facturas anuladas (no se cuentan).
export async function calcularDesgloseVentasTurno(admin, turnoId) {
  const { data, error } = await admin
    .from('facturas_fel')
    .select('id, total, metodo_pago, estado')
    .eq('turno_id', turnoId)
    .eq('estado', 'certificada')

  if (error) {
    return { error: error.message }
  }

  let efectivo = 0, tarjeta = 0, transferencia = 0, pedidos_ya = 0, otro = 0, total = 0
  for (const f of data || []) {
    const m = Number(f.total) || 0
    total += m
    switch (f.metodo_pago) {
      case 'efectivo':      efectivo += m; break
      case 'tarjeta':       tarjeta += m; break
      case 'transferencia': transferencia += m; break
      case 'pedidos_ya':    pedidos_ya += m; break
      default:              otro += m; break
    }
  }

  const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
  return {
    ventas_efectivo: r2(efectivo),
    ventas_tarjeta: r2(tarjeta),
    ventas_transferencia: r2(transferencia),
    ventas_pedidos_ya: r2(pedidos_ya),
    ventas_otro: r2(otro),
    ventas_total: r2(total),
    cantidad_facturas: (data || []).length,
  }
}
