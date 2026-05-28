// pages/api/compras/[id]/recibir.js
// POST /api/compras/:id/recibir  -> marca compra como recibida (admin)
//
// Efectos:
//   1. UPDATE compras SET estado='recibida' (con guard de estado actual = 'borrador')
//   2. Por cada linea con insumo_id:
//      - Inserta insumos_movimientos (tipo='entrada', referencia.compra_id)
//      - Actualiza insumos.costo_unitario al ultimo costo de compra
//
// No es transaccional fuerte (Supabase JS no expone transacciones).
// Si una insercion de movimiento falla, intentamos revertir el estado a 'borrador'
// para que el operador pueda reintentar.

import { requireAdmin } from '../../../../lib/auth'
import { generarAsientoCompraRecibida } from '../../../../lib/contabilidad/generador'
import { factorEntre, mismaUnidad } from '../../../../lib/unidades'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  // 1. Update optimistic: solo pasa si estado actual = 'borrador'.
  const { data: actualizada, error: uErr } = await auth.admin
    .from('compras')
    .update({
      estado: 'recibida',
      recibida_at: new Date().toISOString(),
      recibida_by: auth.user.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).eq('estado', 'borrador')
    .select().single()

  if (uErr || !actualizada) {
    return res.status(400).json({ error: 'No se pudo recibir: la compra no esta en borrador o no existe.' })
  }

  // 2. Cargar lineas con insumo.
  const { data: lineas, error: lErr } = await auth.admin
    .from('compras_lineas')
    .select('id, insumo_id, descripcion, cantidad, costo_unitario, unidad')
    .eq('compra_id', id)

  if (lErr) {
    console.error('[compras.recibir] cargar lineas ERROR:', lErr.message)
    // Revertir.
    await auth.admin.from('compras').update({ estado: 'borrador', recibida_at: null, recibida_by: null }).eq('id', id)
    return res.status(500).json({ ok: false, error: lErr.message })
  }

  // 3. Para cada linea con insumo_id: leer stock actual, insertar movimiento, actualizar costo del insumo.
  const errores = []
  let creados = 0

  for (const l of lineas) {
    if (!l.insumo_id) continue  // linea de gasto no inventariable

    const { data: insumo, error: gErr } = await auth.admin
      .from('insumos')
      .select('stock_actual, unidad, unidad_compra, cantidad_por_unidad_compra')
      .eq('id', l.insumo_id).single()
    if (gErr || !insumo) {
      errores.push(`linea "${l.descripcion}": insumo no encontrado`)
      continue
    }

    // Determinar el factor de conversion entre la unidad de la linea y la
    // unidad base del insumo. Prioridad:
    //   1. Si ambas son unidades estandar (lb, kg, g, lt, ml, etc.) y de la
    //      misma categoria -> usar factor canonico (lb->g = 453.59).
    //   2. Si no, pero la unidad de la linea matchea (vía parseUnidad, tolera
    //      plurales/case) con la unidad_compra del insumo -> usar el factor
    //      personalizado cantidad_por_unidad_compra (cuantas unid. base trae
    //      la presentacion, ej. "saco" = 11340 g).
    //   3. Si nada de eso -> factor = 1 (asumir que ya viene en unidad base).
    const unidadLinea = (l.unidad || '').trim()
    const cpc = Number(insumo.cantidad_por_unidad_compra) || 0
    let factor = 1
    let convDesc = ''
    const fCanonico = factorEntre(unidadLinea, insumo.unidad)
    if (fCanonico != null) {
      factor = fCanonico
      convDesc = `${l.cantidad} ${unidadLinea} = ${(Number(l.cantidad) * factor).toFixed(2)} ${insumo.unidad}`
    } else if (insumo.unidad_compra && cpc > 0 && mismaUnidad(unidadLinea, insumo.unidad_compra)) {
      factor = cpc
      convDesc = `${l.cantidad} ${unidadLinea} × ${cpc} = ${(Number(l.cantidad) * factor).toFixed(2)} ${insumo.unidad}`
    }
    const fracciona = factor !== 1

    const stockAntes = Number(insumo.stock_actual) || 0
    const delta = Number(l.cantidad) * factor
    const stockDespues = Math.round((stockAntes + delta) * 10000) / 10000
    const costoUnitarioBase = Math.round((Number(l.costo_unitario) / factor) * 10000) / 10000

    const { error: mErr } = await auth.admin
      .from('insumos_movimientos')
      .insert({
        insumo_id: l.insumo_id,
        tipo: 'entrada',
        delta,
        stock_antes: stockAntes,
        stock_despues: stockDespues,
        costo_unitario: costoUnitarioBase,
        motivo: `Recepcion compra ${actualizada.numero_factura || actualizada.id.slice(0, 8)}`
              + (convDesc ? ` · ${convDesc}` : ''),
        referencia: { compra_id: id, compra_linea_id: l.id, fracciona, factor },
        created_by: auth.user.id,
      })

    if (mErr) {
      errores.push(`linea "${l.descripcion}": ${mErr.message}`)
      continue
    }
    creados++

    // Actualizar costo del insumo al ultimo costo de compra (en unidad base).
    // Si la linea fracciono, tambien sincronizar costo_compra al ultimo precio
    // de compra (asi el form lo muestra actualizado).
    const updPayload = { costo_unitario: costoUnitarioBase, updated_at: new Date().toISOString() }
    if (fracciona) updPayload.costo_compra = Number(l.costo_unitario)
    await auth.admin.from('insumos').update(updPayload).eq('id', l.insumo_id)
  }

  // Asiento contable automatico (best effort).
  const asiento = await generarAsientoCompraRecibida(auth.admin, id, auth.user.id)
  if (!asiento.ok) console.warn('[compras.recibir] no se genero asiento:', asiento.error)

  if (errores.length > 0) {
    console.error('[compras.recibir] errores parciales:', errores)
    return res.status(207).json({
      ok: false,
      partial: true,
      movimientos_creados: creados,
      errores, asiento,
      mensaje: 'La compra se marco como recibida pero algunas lineas fallaron. Revisar el inventario manualmente.',
    })
  }

  return res.status(200).json({ ok: true, compra: actualizada, movimientos_creados: creados, asiento })
}
