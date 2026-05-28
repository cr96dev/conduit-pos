// lib/recetas.js
// Helpers de costeo de recetas.
//
// Convenciones:
//   - `costo_calculado` = costo POR UNIDAD derivado de los ingredientes.
//   - `costo_personalizado` = override manual opcional (NULL si no se usa).
//   - `costo_efectivo` = costo_personalizado ?? costo_calculado (helper).
//     Es el que se usa para margen y como snapshot al usar como sub-receta.
//   - Los precios de venta (precio_venta) vienen de Loyverse y YA incluyen IVA
//     (regimen normal Guatemala: consumidor final, precio mostrado al cliente
//     incluye el 12%). El margen "real" se calcula sobre el precio SIN IVA.
//
// Conversion de unidades en ingredientes:
//   Cada ingrediente declara una `cantidad` y una `unidad`. La `unidad` del
//   ingrediente puede ser distinta de la `unidad` base del insumo o de la
//   `rinde_unidad` de la sub-receta. Si ambas son convertibles segun
//   lib/unidades.js (misma categoria peso/volumen/conteo), se aplica el
//   factor automaticamente. Si NO son convertibles (categorias distintas,
//   o unidades no estandar como "saco"/"caja"), se conserva el comportamiento
//   legacy: cantidad * costo_unitario, asumiendo que el usuario tipeo la
//   cantidad en unidad base.

import { factorEntre } from './unidades.js'

// Tasa de IVA Guatemala. Cambiar aqui si la ley se actualiza.
export const IVA_GT = 0.12

const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

// Factor para convertir UNA unidad declarada en el ingrediente a la unidad
// base del insumo / rinde_unidad de la sub-receta. Devuelve 1 si las unidades
// matchean, si alguna falta, o si son de categorias distintas (legacy).
// Para los callers que quieran detectar inconsistencias, ver `factorIngrediente`.
export function factorIngrediente(unidadIngrediente, unidadBase) {
  if (!unidadIngrediente || !unidadBase) return { factor: 1, convertido: false }
  // Texto identico: nada que convertir.
  if (String(unidadIngrediente).trim().toLowerCase() === String(unidadBase).trim().toLowerCase()) {
    return { factor: 1, convertido: false }
  }
  const f = factorEntre(unidadIngrediente, unidadBase)
  if (f == null) return { factor: 1, convertido: false, dudoso: true }
  return { factor: f, convertido: true }
}

// Convierte un precio con IVA incluido a precio sin IVA.
export function precioSinIVA(precioConIVA) {
  const p = Number(precioConIVA)
  if (!Number.isFinite(p) || p <= 0) return null
  return p / (1 + IVA_GT)
}

// Devuelve el costo efectivo de una receta (personalizado si existe, sino calculado)
export function costoEfectivo(receta) {
  if (!receta) return 0
  const cp = receta.costo_personalizado
  if (cp != null && cp !== '') return Number(cp)
  return Number(receta.costo_calculado) || 0
}

export function calcularCostoReceta({ ingredientes, rinde_cantidad, merma_pct }) {
  const rinde = Math.max(Number(rinde_cantidad) || 1, 0.0001)
  const merma = (Number(merma_pct) || 0) / 100
  let total = 0
  for (const i of ingredientes || []) {
    const cant = Number(i.cantidad) || 0
    total += cant * (Number(i.costo_unitario_snapshot) || 0)
  }
  return round4((total / rinde) * (1 + merma))
}

// Margen REAL: (precio_sin_iva - costo) / precio_sin_iva.
// Recibe el precio TAL COMO SE VENDE (con IVA incluido); descuenta IVA aqui.
// Asi todos los callers pueden seguir pasando el precio_venta directo.
export function calcularMargen(costo, precioConIVA) {
  const neto = precioSinIVA(precioConIVA)
  if (neto == null) return null
  return Math.round(((neto - Number(costo || 0)) / neto) * 100 * 100) / 100
}

// Detecta ciclos en el grafo de sub-recetas. lanza si hay.
export async function validarSinCiclos(admin, recetaId, candidatosSubreceta = []) {
  const stack = [...candidatosSubreceta]
  const visitados = new Set()
  while (stack.length) {
    const id = stack.pop()
    if (id === recetaId) throw new Error('Las sub-recetas formarian un ciclo')
    if (visitados.has(id)) continue
    visitados.add(id)
    const { data: ings } = await admin
      .from('receta_ingredientes').select('sub_receta_id').eq('receta_id', id)
    for (const ing of ings || []) {
      if (ing.sub_receta_id) stack.push(ing.sub_receta_id)
    }
  }
}

// Recalcula el costo de una receta. NO toca `costo_personalizado` (es manual).
// El margen se calcula sobre el costo efectivo (personalizado ?? calculado).
//
// Conversion de unidades: si `ing.unidad` y la unidad base del componente
// (insumo.unidad o sub.rinde_unidad) son convertibles, se multiplica la
// cantidad por el factor. Sino, factor=1 (legacy).
export async function recalcularUnaReceta(admin, recetaId) {
  const { data: receta } = await admin
    .from('recetas').select('id, rinde_cantidad, merma_pct, precio_venta, costo_personalizado').eq('id', recetaId).single()
  if (!receta) return null

  const { data: ings } = await admin
    .from('receta_ingredientes')
    .select('id, cantidad, unidad, insumo_id, sub_receta_id, costo_unitario_snapshot, insumos(costo_unitario, unidad), recetas:sub_receta_id(rinde_cantidad, rinde_unidad, costo_calculado, costo_personalizado)')
    .eq('receta_id', recetaId)

  let totalReceta = 0
  for (const ing of ings || []) {
    const cant = Number(ing.cantidad) || 0
    let snapshot = 0
    let unidadBase = null
    if (ing.sub_receta_id) {
      // Si la sub-receta tiene override personalizado, usar ese; sino el calculado
      snapshot = costoEfectivo(ing.recetas)
      unidadBase = ing.recetas?.rinde_unidad || null
    } else {
      snapshot = ing.insumos?.costo_unitario != null ? Number(ing.insumos.costo_unitario) : 0
      unidadBase = ing.insumos?.unidad || null
    }
    const { factor } = factorIngrediente(ing.unidad, unidadBase)
    const subtotal = round4(cant * factor * snapshot)
    totalReceta += subtotal
    await admin.from('receta_ingredientes').update({
      costo_unitario_snapshot: round4(snapshot),
      subtotal_costo: subtotal,
    }).eq('id', ing.id)
  }
  const rinde = Math.max(Number(receta.rinde_cantidad) || 1, 0.0001)
  const merma = (Number(receta.merma_pct) || 0) / 100
  const costoCalc = round4((totalReceta / rinde) * (1 + merma))
  // Margen sobre el efectivo (personalizado si lo hay, sino calculado)
  const efectivo = costoEfectivo({ costo_calculado: costoCalc, costo_personalizado: receta.costo_personalizado })
  const margen = receta.precio_venta ? calcularMargen(efectivo, Number(receta.precio_venta)) : null

  await admin.from('recetas')
    .update({ costo_calculado: costoCalc, margen_pct: margen, updated_at: new Date().toISOString() })
    .eq('id', recetaId)

  return costoCalc
}

// Recalcula TODAS las recetas activas en orden topologico (hojas primero).
export async function recalcularTodas(admin) {
  const { data: recetas } = await admin
    .from('recetas').select('id').eq('activa', true)
  const ids = (recetas || []).map(r => r.id)
  if (ids.length === 0) return { actualizadas: 0 }

  const deps = new Map(ids.map(id => [id, []]))
  for (const id of ids) {
    const { data: ings } = await admin
      .from('receta_ingredientes').select('sub_receta_id').eq('receta_id', id)
    for (const ing of ings || []) {
      if (ing.sub_receta_id) deps.get(id).push(ing.sub_receta_id)
    }
  }

  const inDeg = new Map(ids.map(id => [id, 0]))
  for (const [from, ds] of deps) {
    for (const _d of ds) inDeg.set(from, inDeg.get(from) + 1)
  }
  const padres = new Map(ids.map(id => [id, []]))
  for (const [from, ds] of deps) for (const d of ds) padres.get(d).push(from)

  const queue = ids.filter(id => inDeg.get(id) === 0)
  const orden = []
  while (queue.length) {
    const id = queue.shift()
    orden.push(id)
    for (const p of padres.get(id) || []) {
      inDeg.set(p, inDeg.get(p) - 1)
      if (inDeg.get(p) === 0) queue.push(p)
    }
  }
  for (const id of ids) if (!orden.includes(id)) orden.push(id)

  let n = 0
  for (const id of orden) {
    await recalcularUnaReceta(admin, id)
    n++
  }
  return { actualizadas: n }
}
