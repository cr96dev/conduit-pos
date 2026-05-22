// lib/produccion.js
// Helpers server-side para planes de produccion.
//
// Idea central: dado [{ receta_id, cantidad }] (unidades a producir),
// resolver recursivamente sub-recetas hasta llegar a INSUMOS crudos y
// devolver el total requerido por insumo + un breakdown de uso por receta.
//
// La merma_pct de cada receta aplica al *factor de corridas*:
//   corridas = cantidad_unidades_a_producir * (1 + merma_pct/100) / rinde_cantidad
// Esto es consistente con como `costo_calculado` se infla en lib/recetas.js.
//
// Cuando un ingrediente es una sub-receta, las "X unidades" de sub-receta
// que la receta consume se tratan a su vez como una produccion: heredan la
// merma de la sub-receta al recursar.
//
// Precaucion: validamos profundidad para evitar bucles si por alguna razon
// el CHECK constraint anti-ciclos del schema falla.

const MAX_PROFUNDIDAD = 16

const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

// Trae todas las recetas + ingredientes en 2 queries y arma maps in-memory.
async function cargarGrafoRecetas(admin) {
  const { data: recetas, error: rErr } = await admin
    .from('recetas')
    .select('id, nombre, rinde_cantidad, rinde_unidad, merma_pct, costo_calculado, costo_personalizado, activa, loyverse_item_id')
  if (rErr) throw new Error('recetas: ' + rErr.message)

  const { data: ings, error: iErr } = await admin
    .from('receta_ingredientes')
    .select('receta_id, insumo_id, sub_receta_id, cantidad, unidad, costo_unitario_snapshot')
  if (iErr) throw new Error('receta_ingredientes: ' + iErr.message)

  const recetasById = {}
  for (const r of recetas || []) recetasById[r.id] = r

  const ingredientesPorReceta = {}
  for (const i of ings || []) {
    const arr = ingredientesPorReceta[i.receta_id] || (ingredientesPorReceta[i.receta_id] = [])
    arr.push(i)
  }

  return { recetasById, ingredientesPorReceta }
}

// Para una receta, calcula el factor de corridas requerido.
function factorCorridas(receta, cantidadUnidades) {
  const rinde = Math.max(Number(receta.rinde_cantidad) || 1, 0.0001)
  const merma = (Number(receta.merma_pct) || 0) / 100
  return (Number(cantidadUnidades) * (1 + merma)) / rinde
}

// Resuelve recursivamente. Devuelve mapa { insumo_id -> { cantidad, usos: [{receta_id, factor, ing_cantidad}] } }.
function explotarRecursivo({ recetasById, ingredientesPorReceta }, plan) {
  const requeridos = {}     // insumo_id -> { cantidad, usos }
  const usadasPath = new Set() // anti-ciclos defensivo

  function visitar(recetaId, factorAcc, raizRecetaId, profundidad) {
    if (profundidad > MAX_PROFUNDIDAD) {
      throw new Error(`Profundidad de sub-recetas excede ${MAX_PROFUNDIDAD} (posible ciclo en receta ${recetaId})`)
    }
    if (usadasPath.has(recetaId)) {
      throw new Error(`Ciclo detectado en sub-recetas (receta ${recetaId} se referencia a si misma)`)
    }
    usadasPath.add(recetaId)

    const ings = ingredientesPorReceta[recetaId] || []
    for (const ing of ings) {
      const cant = Number(ing.cantidad) || 0
      if (ing.insumo_id) {
        const totalUnidades = cant * factorAcc
        const acc = requeridos[ing.insumo_id] || { cantidad: 0, usos: [] }
        acc.cantidad = round4(acc.cantidad + totalUnidades)
        acc.usos.push({
          receta_id: raizRecetaId,
          via_receta_id: recetaId !== raizRecetaId ? recetaId : null,
          cantidad: round4(totalUnidades),
        })
        requeridos[ing.insumo_id] = acc
      } else if (ing.sub_receta_id) {
        const subReceta = recetasById[ing.sub_receta_id]
        if (!subReceta) {
          throw new Error(`Sub-receta ${ing.sub_receta_id} no encontrada (referenciada por ${recetaId})`)
        }
        const unidadesSubReceta = cant * factorAcc
        const factorSub = factorCorridas(subReceta, unidadesSubReceta)
        visitar(subReceta.id, factorSub, raizRecetaId, profundidad + 1)
      }
    }

    usadasPath.delete(recetaId)
  }

  for (const linea of plan) {
    const receta = recetasById[linea.receta_id]
    if (!receta) throw new Error(`Receta ${linea.receta_id} no encontrada`)
    const factor = factorCorridas(receta, linea.cantidad)
    visitar(receta.id, factor, receta.id, 0)
  }

  return requeridos
}

// Carga insumos involucrados con su info (nombre, stock, costo, unidad).
async function cargarInsumosInvolucrados(admin, insumoIds) {
  if (insumoIds.length === 0) return {}
  const { data, error } = await admin
    .from('insumos')
    .select('id, nombre, unidad, stock_actual, stock_minimo, costo_unitario, proveedor')
    .in('id', insumoIds)
  if (error) throw new Error('insumos: ' + error.message)
  const map = {}
  for (const i of data || []) map[i.id] = i
  return map
}

// Calcula la explosion completa con stock + costos + faltantes.
// Devuelve estructura lista para serializar al front.
export async function explotarPlan(admin, lineas) {
  if (!Array.isArray(lineas) || lineas.length === 0) {
    return { requerimientos: [], resumen: emptyResumen(), lineas_resueltas: [] }
  }

  const grafo = await cargarGrafoRecetas(admin)
  const { recetasById } = grafo

  // 1) Explotar
  const requeridos = explotarRecursivo(grafo, lineas)

  // 2) Cargar insumos involucrados
  const insumoIds = Object.keys(requeridos)
  const insumosMap = await cargarInsumosInvolucrados(admin, insumoIds)

  // 3) Armar requerimientos enriquecidos.
  const requerimientos = []
  let costoCompraTotal = 0
  let conFaltante = 0

  for (const [insumoId, info] of Object.entries(requeridos)) {
    const insumo = insumosMap[insumoId]
    const stockActual = Number(insumo?.stock_actual || 0)
    const requerido = round4(info.cantidad)
    const faltante = round4(Math.max(0, requerido - stockActual))
    const costoUnit = Number(insumo?.costo_unitario || 0)
    const costoCompra = round4(faltante * costoUnit)

    if (faltante > 0) {
      conFaltante++
      costoCompraTotal += costoCompra
    }

    requerimientos.push({
      insumo_id: insumoId,
      nombre: insumo?.nombre || '(insumo borrado)',
      unidad: insumo?.unidad || null,
      proveedor: insumo?.proveedor || null,
      costo_unitario: costoUnit || null,
      requerido,
      stock_actual: stockActual,
      stock_minimo: insumo?.stock_minimo != null ? Number(insumo.stock_minimo) : null,
      faltante,
      costo_compra: costoCompra,
      usos: info.usos,
    })
  }

  // Orden: con faltante primero, descendente por monto de compra, luego por nombre.
  requerimientos.sort((a, b) => {
    if ((a.faltante > 0) !== (b.faltante > 0)) return a.faltante > 0 ? -1 : 1
    if (a.faltante > 0 && b.faltante > 0) return b.costo_compra - a.costo_compra
    return (a.nombre || '').localeCompare(b.nombre || '')
  })

  // 4) Resolver info de las lineas (con costo total estimado de produccion).
  let costoProduccionTotal = 0
  const lineasResueltas = lineas.map(l => {
    const r = recetasById[l.receta_id]
    if (!r) return { receta_id: l.receta_id, cantidad: l.cantidad, encontrada: false }
    const costoUnit = r.costo_personalizado != null ? Number(r.costo_personalizado) : Number(r.costo_calculado || 0)
    const subtotal = round4(costoUnit * Number(l.cantidad))
    costoProduccionTotal += subtotal
    return {
      receta_id: r.id,
      nombre: r.nombre,
      cantidad: Number(l.cantidad),
      rinde_unidad: r.rinde_unidad,
      rinde_cantidad: r.rinde_cantidad,
      merma_pct: r.merma_pct,
      costo_unitario: costoUnit,
      costo_subtotal: subtotal,
      loyverse_item_id: r.loyverse_item_id,
      encontrada: true,
    }
  })

  return {
    requerimientos,
    lineas_resueltas: lineasResueltas,
    resumen: {
      total_insumos: requerimientos.length,
      con_faltante: conFaltante,
      costo_compra_estimado: round4(costoCompraTotal),
      costo_produccion_estimado: round4(costoProduccionTotal),
      productos_a_producir: lineas.length,
      unidades_totales: lineas.reduce((s, l) => s + Number(l.cantidad || 0), 0),
    },
  }
}

function emptyResumen() {
  return {
    total_insumos: 0, con_faltante: 0,
    costo_compra_estimado: 0, costo_produccion_estimado: 0,
    productos_a_producir: 0, unidades_totales: 0,
  }
}
