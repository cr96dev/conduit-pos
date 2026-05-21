// lib/recetas.js
// Helpers de costeo de recetas.
//
// Un ingrediente puede ser:
//   - un insumo (costo = cantidad * costo_unitario_snapshot)
//   - una sub-receta (costo = cantidad / sub.rinde * sub.costo_calculado)
//
// La sub-receta usa el costo_calculado YA persistido — la recursividad
// se maneja en `recalcularRecetaPorId()` que va de hojas a raices.

const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

// Calcula costo por unidad vendida a partir de ingredientes ya resueltos.
// Cada ingrediente debe tener al menos:
//   { cantidad, costo_unitario_snapshot } para insumo
//   o { cantidad, sub_rinde, sub_costo } para sub-receta
export function calcularCostoReceta({ ingredientes, rinde_cantidad, merma_pct }) {
  const rinde = Math.max(Number(rinde_cantidad) || 1, 0.0001)
  const merma = (Number(merma_pct) || 0) / 100
  let total = 0
  for (const i of ingredientes || []) {
    const cant = Number(i.cantidad) || 0
    if (i.sub_receta_id) {
      const subRinde = Math.max(Number(i.sub_rinde) || 1, 0.0001)
      const subCosto = Number(i.sub_costo) || 0
      total += (cant / subRinde) * subCosto
    } else {
      total += cant * (Number(i.costo_unitario_snapshot) || 0)
    }
  }
  return round4((total / rinde) * (1 + merma))
}

export function calcularMargen(costo, precio) {
  if (!precio || precio <= 0) return null
  return Math.round(((precio - costo) / precio) * 100 * 100) / 100
}

// Detecta ciclos en el grafo de sub-recetas. lanza si hay.
export async function validarSinCiclos(admin, recetaId, candidatosSubreceta = []) {
  // candidatosSubreceta: ids que se ESTAN POR agregar como sub-receta a recetaId.
  // Hay ciclo si alguno de ellos (transitivamente) tiene a recetaId como sub.
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

// Recalcula el costo de una receta (y opcionalmente recursivo "padres" que la usan).
// Devuelve el costo nuevo.
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
    if (ing.sub_receta_id) {
      const subRinde = Math.max(Number(ing.recetas?.rinde_cantidad) || 1, 0.0001)
      const subCosto = Number(ing.recetas?.costo_calculado) || 0
      const subtotal = round4((cant / subRinde) * subCosto)
      totalReceta += subtotal
      // Actualizar snapshot del costo de la sub-porción
      await admin.from('receta_ingredientes').update({
        costo_unitario_snapshot: round4(subCosto / subRinde),
        subtotal_costo: subtotal,
      }).eq('id', ing.id)
    } else {
      const costoActual = ing.insumos?.costo_unitario != null ? Number(ing.insumos.costo_unitario) : 0
      const subtotal = round4(cant * costoActual)
      totalReceta += subtotal
      await admin.from('receta_ingredientes').update({
        costo_unitario_snapshot: costoActual,
        subtotal_costo: subtotal,
      }).eq('id', ing.id)
    }
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

// Recalcula TODAS las recetas activas en orden topologico:
// hojas (sin sub-recetas) primero, despues sus padres, etc.
// Maneja correctamente la cadena: cambiar un insumo afecta sub-recetas y sus padres.
export async function recalcularTodas(admin) {
  // Cargar grafo
  const { data: recetas } = await admin
    .from('recetas').select('id').eq('activa', true)
  const ids = (recetas || []).map(r => r.id)
  if (ids.length === 0) return { actualizadas: 0 }

  // Para cada receta, listar las sub-recetas que usa (sus "dependencias").
  const deps = new Map(ids.map(id => [id, []]))
  for (const id of ids) {
    const { data: ings } = await admin
      .from('receta_ingredientes').select('sub_receta_id').eq('receta_id', id)
    for (const ing of ings || []) {
      if (ing.sub_receta_id) deps.get(id).push(ing.sub_receta_id)
    }
  }

  // Orden topologico (Kahn)
  const inDeg = new Map(ids.map(id => [id, 0]))
  for (const [from, ds] of deps) {
    // from depende de ds: ds debe procesarse antes de from
    for (const d of ds) inDeg.set(from, inDeg.get(from) + 1)
    // void d  — no aumentamos inDeg de d
  }
  const queue = ids.filter(id => inDeg.get(id) === 0)
  const orden = []
  // procesar hojas primero. Cuando proceso una hoja, los que la usan ven -1 en su inDeg.
  // Necesito reverse adj: por cada receta, qué padres dependen de mi.
  const padres = new Map(ids.map(id => [id, []]))
  for (const [from, ds] of deps) for (const d of ds) padres.get(d).push(from)

  while (queue.length) {
    const id = queue.shift()
    orden.push(id)
    for (const p of padres.get(id) || []) {
      inDeg.set(p, inDeg.get(p) - 1)
      if (inDeg.get(p) === 0) queue.push(p)
    }
  }
  // Si hay ciclos quedaron recetas sin procesar; las metemos al final igual.
  for (const id of ids) if (!orden.includes(id)) orden.push(id)

  let n = 0
  for (const id of orden) {
    await recalcularUnaReceta(admin, id)
    n++
  }
  return { actualizadas: n }
}
