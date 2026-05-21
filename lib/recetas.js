// lib/recetas.js
// Helpers de costeo de recetas.
//
// Convenciones:
//   - `costo_calculado` de una receta = costo POR UNIDAD del rinde (Q por unidad
//     del campo rinde_unidad). Ej: CREMA PASTELERA rinde 80 g, costo_calculado
//     = Q0.17/g (el costo TOTAL de hacer 80g seria 80 * 0.17 = Q13.60).
//   - `costo_unitario_snapshot` del ingrediente = costo POR UNIDAD del componente:
//       - insumo: copia de insumos.costo_unitario
//       - sub-receta: copia de recetas.costo_calculado (sin dividir)
//   - subtotal = cantidad * snapshot
//   - costo final de la receta = (sum(subtotales) / rinde) * (1 + merma)

const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

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

export function calcularMargen(costo, precio) {
  if (!precio || precio <= 0) return null
  return Math.round(((precio - costo) / precio) * 100 * 100) / 100
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

// Recalcula el costo de una receta.
export async function recalcularUnaReceta(admin, recetaId) {
  const { data: receta } = await admin
    .from('recetas').select('id, rinde_cantidad, merma_pct, precio_venta').eq('id', recetaId).single()
  if (!receta) return null

  const { data: ings } = await admin
    .from('receta_ingredientes')
    .select('id, cantidad, insumo_id, sub_receta_id, costo_unitario_snapshot, insumos(costo_unitario), recetas:sub_receta_id(rinde_cantidad, costo_calculado)')
    .eq('receta_id', recetaId)

  let totalReceta = 0
  for (const ing of ings || []) {
    const cant = Number(ing.cantidad) || 0
    let snapshot = 0
    if (ing.sub_receta_id) {
      // costo_calculado YA es por unidad del rinde — usar directo
      snapshot = Number(ing.recetas?.costo_calculado) || 0
    } else {
      snapshot = ing.insumos?.costo_unitario != null ? Number(ing.insumos.costo_unitario) : 0
    }
    const subtotal = round4(cant * snapshot)
    totalReceta += subtotal
    await admin.from('receta_ingredientes').update({
      costo_unitario_snapshot: round4(snapshot),
      subtotal_costo: subtotal,
    }).eq('id', ing.id)
  }
  const rinde = Math.max(Number(receta.rinde_cantidad) || 1, 0.0001)
  const merma = (Number(receta.merma_pct) || 0) / 100
  const costoCalc = round4((totalReceta / rinde) * (1 + merma))
  const margen = receta.precio_venta ? calcularMargen(costoCalc, Number(receta.precio_venta)) : null

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
