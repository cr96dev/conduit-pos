// lib/produccion-inventario.js
// Integracion Produccion -> Inventario de producto terminado.
//
// Cuando se ejecuta (o se carga manualmente) un plan de produccion, las
// cantidades producidas se cargan como `inventario_inicial` del dia en
// `conteos_diarios_producto`. Asi el teorico = inicial − ventas Loyverse
// arranca con lo que efectivamente sale del horno.
//
// Mapping: planes_produccion_lineas.receta_id
//   -> recetas.loyverse_item_id (skip si NULL: es sub-receta/masa)
//   -> loyverse_items.variants[0].variant_id   (asume 1 variante por item)
//
// Precedencia: el inicial poblado desde produccion PISA cualquier valor
// previo (carry-forward de ayer u otro). El usuario configura el flujo
// para que produccion sea la fuente de verdad del inicial del dia.

// Devuelve { actualizadas: [{variant_id, item_name, cantidad}], saltadas: [{receta_id, nombre, motivo}] }
export async function poblarInventarioInicialDesdeProduccion(admin, planId, userId = null) {
  // 1. Cargar plan + lineas con receta y loyverse_item_id.
  const { data: plan, error: pErr } = await admin
    .from('planes_produccion')
    .select('id, fecha_produccion, estado')
    .eq('id', planId)
    .maybeSingle()
  if (pErr) throw new Error('plan: ' + pErr.message)
  if (!plan) throw new Error('Plan no encontrado: ' + planId)

  const { data: lineas, error: lErr } = await admin
    .from('planes_produccion_lineas')
    .select('id, receta_id, cantidad, recetas(nombre, loyverse_item_id)')
    .eq('plan_id', planId)
  if (lErr) throw new Error('lineas: ' + lErr.message)
  if (!lineas || lineas.length === 0) return { actualizadas: [], saltadas: [], plan }

  // 2. Separar lineas con loyverse_item_id (producto terminado vendible)
  //    de las que no (sub-recetas/masas).
  const conItem = [], saltadas = []
  for (const l of lineas) {
    const nombre = l.recetas?.nombre || l.receta_id
    const itemId = l.recetas?.loyverse_item_id || null
    if (!itemId) {
      saltadas.push({ receta_id: l.receta_id, nombre, motivo: 'sin loyverse_item_id (sub-receta o no vendible)' })
      continue
    }
    conItem.push({ receta_id: l.receta_id, nombre, loyverse_item_id: itemId, cantidad: Number(l.cantidad) || 0 })
  }
  if (conItem.length === 0) return { actualizadas: [], saltadas, plan }

  // 3. Resolver item_id -> variant_id (variants[0].variant_id; asume 1 variante).
  const itemIds = Array.from(new Set(conItem.map(c => c.loyverse_item_id)))
  const { data: items, error: iErr } = await admin
    .from('loyverse_items')
    .select('loyverse_id, item_name, variants')
    .in('loyverse_id', itemIds)
  if (iErr) throw new Error('loyverse_items: ' + iErr.message)

  const variantByItem = new Map()  // loyverse_id -> { variant_id, item_name }
  for (const it of items || []) {
    const variants = Array.isArray(it.variants) ? it.variants : []
    const v0 = variants[0]
    const variantId = v0?.variant_id || v0?.id || null
    if (variantId) variantByItem.set(it.loyverse_id, { variant_id: variantId, item_name: it.item_name || '?' })
  }

  // 4. Agregar cantidades por variant_id (varias lineas pueden mapear al mismo).
  const totales = new Map()  // variant_id -> { cantidad, item_name, recetas[] }
  for (const c of conItem) {
    const v = variantByItem.get(c.loyverse_item_id)
    if (!v) {
      saltadas.push({ receta_id: c.receta_id, nombre: c.nombre, motivo: `loyverse_item ${c.loyverse_item_id} sin variants[]` })
      continue
    }
    const acc = totales.get(v.variant_id) || { variant_id: v.variant_id, item_name: v.item_name, cantidad: 0, recetas: [] }
    acc.cantidad += c.cantidad
    acc.recetas.push(c.nombre)
    totales.set(v.variant_id, acc)
  }
  if (totales.size === 0) return { actualizadas: [], saltadas, plan }

  // 5. UPSERT en conteos_diarios_producto. store_id='' (default del schema).
  //    Pisa cualquier inventario_inicial previo (precedencia: produccion gana).
  //    Preserva inventario_final si ya estaba cargado (no lo tocamos).
  const fecha = plan.fecha_produccion
  const actualizadas = []
  for (const acc of totales.values()) {
    const { data: existente } = await admin
      .from('conteos_diarios_producto')
      .select('id, inventario_final, notas')
      .eq('fecha', fecha)
      .eq('variant_id', acc.variant_id)
      .eq('store_id', '')
      .maybeSingle()

    const cantidad = Math.round(acc.cantidad * 1000) / 1000
    const notaProd = `Inicial poblado por plan ${plan.id.slice(0, 8)} (${acc.recetas.join(', ')})`

    if (existente) {
      const { error: uErr } = await admin
        .from('conteos_diarios_producto')
        .update({
          inventario_inicial: cantidad,
          notas: existente.notas
            ? (existente.notas.includes(plan.id.slice(0, 8)) ? existente.notas : existente.notas + ' · ' + notaProd)
            : notaProd,
          updated_by: userId,
        })
        .eq('id', existente.id)
      if (uErr) throw new Error(`update conteo variant ${acc.variant_id}: ${uErr.message}`)
    } else {
      const { error: iErr2 } = await admin
        .from('conteos_diarios_producto')
        .insert({
          fecha,
          variant_id: acc.variant_id,
          store_id: '',
          inventario_inicial: cantidad,
          notas: notaProd,
          created_by: userId,
          updated_by: userId,
        })
      if (iErr2) throw new Error(`insert conteo variant ${acc.variant_id}: ${iErr2.message}`)
    }
    actualizadas.push({ variant_id: acc.variant_id, item_name: acc.item_name, cantidad, recetas: acc.recetas })
  }

  return { actualizadas, saltadas, plan }
}
