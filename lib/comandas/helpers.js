// lib/comandas/helpers.js
// Helpers para la generacion automatica de comandas de barra desde el POS.
//
// Logica de barra:
//   1. loyverse_categories.es_barra = true -> categoria barra.
//   2. loyverse_items.category_id apunta a una categoria barra -> item barra.
//   3. Cada variant_id (la unidad real de venta) hereda de su item.
//   4. Cuando /pos cobra una venta certificada, si tiene items de barra ->
//      crea una sola comanda con esos items.
//
// La comanda guarda items[] como snapshot (jsonb) para que cambios futuros
// en el catalogo no alteren lo que se pidio.

// Identifica subset de items de la venta que pertenecen a categorias barra.
// itemsConVariantId: [{ variant_id, descripcion, cantidad, ... }, ...]
export async function detectarItemsDeBarra(admin, itemsConVariantId) {
  // 1. Cargar IDs de categorias barra (vacio -> nada va a barra)
  const { data: catsBarra, error: catsErr } = await admin
    .from('loyverse_categories')
    .select('loyverse_id, name')
    .eq('es_barra', true)
  if (catsErr) {
    return { error: catsErr.message, items: [] }
  }
  if (!catsBarra?.length) {
    return { items: [] }
  }

  const catSet = new Set(catsBarra.map(c => c.loyverse_id))
  const catNombres = new Map(catsBarra.map(c => [c.loyverse_id, c.name]))

  // 2. Items de la venta con variant_id (filtramos los sin id -> probablemente
  //    ventas manuales sin catalogo, no van a barra automaticamente)
  const variantIds = [...new Set(
    itemsConVariantId.map(i => i.variant_id).filter(Boolean)
  )]
  if (variantIds.length === 0) {
    return { items: [] }
  }

  // 3. Traer solo los loyverse_items de categorias barra (subset chico).
  //    Recorremos sus variants[] y armamos mapa variant_id -> categoria.
  const { data: itemsBarra, error: itemsErr } = await admin
    .from('loyverse_items')
    .select('loyverse_id, item_name, category_id, variants')
    .in('category_id', [...catSet])
    .is('deleted_at', null)
  if (itemsErr) {
    return { error: itemsErr.message, items: [] }
  }

  const variantesBarra = new Map() // variant_id -> { item_name, category_id, categoria }
  for (const item of itemsBarra || []) {
    for (const v of (item.variants || [])) {
      if (v?.variant_id) {
        variantesBarra.set(v.variant_id, {
          loyverse_item_id: item.loyverse_id,
          item_name: item.item_name,
          category_id: item.category_id,
          categoria: catNombres.get(item.category_id) || '',
          variant_name: v.option1_value || v.option2_value || '',
        })
      }
    }
  }

  // 4. Filtrar items de la venta que matchean.
  const seleccionados = []
  for (const item of itemsConVariantId) {
    const barra = variantesBarra.get(item.variant_id)
    if (barra) {
      seleccionados.push({
        ...item,
        loyverse_item_id: barra.loyverse_item_id,
        categoria: barra.categoria,
        category_id: barra.category_id,
      })
    }
  }
  return { items: seleccionados }
}

// Crea la comanda si la venta tiene items de barra. Idempotente por factura_id:
// si ya existe una comanda para esa factura, no la duplica.
export async function crearComandaParaFactura(admin, factura, itemsVenta, opciones = {}) {
  const { items: itemsBarra, error } = await detectarItemsDeBarra(admin, itemsVenta)
  if (error) return { error }
  if (!itemsBarra.length) return { ok: true, comanda: null, motivo: 'sin_items_barra' }

  // Chequeo idempotencia: una comanda por factura.
  const { data: existente } = await admin
    .from('comandas')
    .select('id')
    .eq('factura_id', factura.id)
    .maybeSingle()
  if (existente) {
    return { ok: true, comanda: existente, motivo: 'ya_existia' }
  }

  // Items snapshot: solo los datos relevantes para la barra.
  const itemsSnapshot = itemsBarra.map(it => ({
    descripcion: it.descripcion,
    cantidad: Number(it.cantidad),
    variant_id: it.variant_id || null,
    categoria: it.categoria || null,
    notas: it.notas || null,
  }))

  const { data: nueva, error: insErr } = await admin
    .from('comandas')
    .insert({
      factura_id: factura.id,
      turno_id: factura.turno_id || null,
      cajero_id: factura.creado_por || null,
      items: itemsSnapshot,
      notas_generales: opciones.notas_generales || null,
      estado: 'pendiente',
    })
    .select()
    .single()

  if (insErr) return { error: insErr.message }
  return { ok: true, comanda: nueva }
}
