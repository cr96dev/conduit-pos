// pages/api/produccion/planes/[id]/ejecutar.js
// POST /api/produccion/planes/[id]/ejecutar
//   body: { forzar?: boolean }   // si true, permite ejecutar aunque haya stock insuficiente
// Accion explicita que descuenta insumos via insumos_movimientos.
//
// Flujo:
//   1. Plan debe estar en 'borrador'.
//   2. Explosion BOM contra stock actual.
//   3. Si hay faltante y NO forzar: 400 con detalle de insumos faltantes.
//   4. Para cada insumo requerido: insertar movimiento tipo='salida' con
//      referencia { plan_id, plan_fecha, motivo_corto }.
//   5. Marcar plan estado='ejecutado'.
//
// Limitaciones:
//   - No es transaccional: si falla un movimiento intermedio, los anteriores
//     quedan registrados (auditados como salidas con referencia al plan). El
//     usuario puede corregir manualmente. Para minimizar el riesgo, pre-validamos
//     stock antes de hacer cualquier movimiento.
//   - Si forzar=true y un movimiento resulta en stock negativo, el endpoint de
//     movimientos lo rechaza individualmente. Por eso forzar no es 100% atomico:
//     usar con cuidado.

import { requireAdmin } from '../../../../../lib/auth'
import { explotarPlan } from '../../../../../lib/produccion'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { forzar = false } = req.body || {}

  try {
    // 1) Cargar plan + lineas.
    const { data: plan } = await auth.admin
      .from('planes_produccion').select('*').eq('id', id).maybeSingle()
    if (!plan) return res.status(404).json({ error: 'Plan no encontrado' })
    if (plan.estado !== 'borrador') {
      return res.status(409).json({ error: `Plan en estado '${plan.estado}', no se puede ejecutar.` })
    }

    const { data: lineas, error: lErr } = await auth.admin
      .from('planes_produccion_lineas')
      .select('id, receta_id, cantidad, recetas(nombre)')
      .eq('plan_id', id)
    if (lErr) throw new Error('lineas: ' + lErr.message)
    if (!lineas || lineas.length === 0) {
      return res.status(400).json({ error: 'Plan sin lineas. Agrega productos a producir antes de ejecutar.' })
    }

    // 2) Explosion.
    const explosion = await explotarPlan(
      auth.admin,
      lineas.map(l => ({ receta_id: l.receta_id, cantidad: Number(l.cantidad) })),
    )

    if (explosion.requerimientos.length === 0) {
      return res.status(400).json({ error: 'La explosion del BOM no produjo insumos requeridos (recetas sin ingredientes?).' })
    }

    // 3) Validar stock.
    if (!forzar) {
      const conFaltante = explosion.requerimientos.filter(r => r.faltante > 0)
      if (conFaltante.length > 0) {
        return res.status(400).json({
          error: 'Stock insuficiente para ejecutar el plan. Reabastece o usa forzar=true.',
          faltantes: conFaltante.map(r => ({
            insumo_id: r.insumo_id,
            nombre: r.nombre,
            unidad: r.unidad,
            requerido: r.requerido,
            stock_actual: r.stock_actual,
            faltante: r.faltante,
            costo_compra: r.costo_compra,
          })),
        })
      }
    }

    // 4) Insertar movimientos.
    // Releemos stock_actual de cada insumo justo antes de insertar para minimizar
    // condiciones de carrera. (Para Julia la concurrencia es minima.)
    const insumoIds = explosion.requerimientos.map(r => r.insumo_id)
    const { data: insumosAhora, error: insErr } = await auth.admin
      .from('insumos').select('id, stock_actual, costo_unitario').in('id', insumoIds)
    if (insErr) throw new Error('insumos: ' + insErr.message)
    const stockMap = new Map((insumosAhora || []).map(i => [i.id, Number(i.stock_actual) || 0]))

    const movimientos = []
    const errores = []

    const fechaProd = plan.fecha_produccion
    const motivoBase = `Produccion plan ${plan.id.slice(0, 8)} · ${fechaProd}`

    for (const req of explosion.requerimientos) {
      const stockAntes = stockMap.get(req.insumo_id) ?? 0
      const cant = Number(req.requerido)
      if (!(cant > 0)) continue   // por las dudas

      const delta = -cant
      const stockDespues = Number((stockAntes + delta).toFixed(4))

      // Si forzar=true y queda negativo, el INSERT pasara solo si la tabla no
      // tiene CHECK contra negativo (no lo tiene). Lo permitimos explicitamente.
      const { data: mov, error: movErr } = await auth.admin
        .from('insumos_movimientos')
        .insert({
          insumo_id: req.insumo_id,
          tipo: 'salida',
          delta,
          stock_antes: stockAntes,
          stock_despues: stockDespues,
          costo_unitario: req.costo_unitario,
          motivo: motivoBase,
          referencia: {
            plan_id: plan.id,
            plan_fecha: fechaProd,
            origen: 'produccion',
          },
          created_by: auth.user.id,
        })
        .select()
        .single()
      if (movErr) {
        errores.push({ insumo_id: req.insumo_id, nombre: req.nombre, error: movErr.message })
        continue
      }
      movimientos.push(mov.id)
      stockMap.set(req.insumo_id, stockDespues)
    }

    // 5) Marcar plan ejecutado (aunque haya errores parciales — los movimientos
    //    exitosos quedan auditados con referencia al plan).
    const { data: planActualizado, error: upErr } = await auth.admin
      .from('planes_produccion')
      .update({
        estado: errores.length === 0 ? 'ejecutado' : 'ejecutado',  // siempre marcar ejecutado; el "parcial" se ve en errores[]
        ejecutado_at: new Date().toISOString(),
        ejecutado_by: auth.user.id,
        updated_by: auth.user.id,
      })
      .eq('id', id)
      .select()
      .single()
    if (upErr) throw new Error('update plan: ' + upErr.message)

    const respuesta = {
      ok: errores.length === 0,
      plan: planActualizado,
      movimientos_creados: movimientos.length,
      total_insumos: explosion.requerimientos.length,
    }
    if (errores.length > 0) respuesta.errores_parciales = errores

    return res.status(errores.length === 0 ? 200 : 207).json(respuesta)
  } catch (e) {
    console.error('[produccion.ejecutar] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

export const config = { maxDuration: 60 }
