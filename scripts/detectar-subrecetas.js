// Detector heuristico de sub-recetas embebidas en recetas finales.
//
// Para cada sub-receta candidata S (las que NO tienen loyverse_item_id),
// busca recetas finales F que contengan TODOS los insumos de S.
// Calcula el factor implicito por cada insumo (F[ins].cant / S[ins].cant).
// Si los factores son CONSISTENTES (CV bajo), reporta sugerencia:
//   "F está usando (factor * S.rinde) unidades de S"
//
// El user puede ejecutar este script para ver el reporte; despues editar
// las recetas en la UI o ejecutar `--aplicar` para reemplazarlas automatico.

const fs = require('fs')
const env = fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
for (const line of env) {
  const eq = line.indexOf('=')
  if (eq > 0) process.env[line.slice(0, eq)] = line.slice(eq+1)
}
const { createClient } = require('@supabase/supabase-js')
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const APLICAR = process.argv.includes('--aplicar')

// Coeficiente de variacion maximo aceptable para considerar factores "consistentes"
const CV_TOLERANCIA = 0.20  // 20%
// Cantidad minima de insumos compartidos para considerar una sub-receta como match
const MIN_INSUMOS_MATCH = 3
// Fraccion minima de insumos de la sub-receta que deben estar en la final
const FRAC_MIN_COBERTURA = 0.6  // al menos 60%

async function main() {
  const { data: recetas } = await supa
    .from('recetas')
    .select('id, nombre, loyverse_item_id, rinde_cantidad, rinde_unidad, activa, costo_calculado')
    .eq('activa', true)
    .order('nombre')

  const { data: ings } = await supa
    .from('receta_ingredientes')
    .select('receta_id, insumo_id, sub_receta_id, cantidad, unidad')
  const ingsPorReceta = new Map()
  for (const ing of ings || []) {
    if (!ingsPorReceta.has(ing.receta_id)) ingsPorReceta.set(ing.receta_id, [])
    ingsPorReceta.get(ing.receta_id).push(ing)
  }

  // Sub-recetas candidatas: las que NO tienen loyverse_item_id (intermedios)
  const candidatas = recetas.filter(r => !r.loyverse_item_id)
  // Finales: las que SI tienen link a Loyverse (lo que se vende)
  const finales = recetas.filter(r => r.loyverse_item_id)

  console.log(`Sub-recetas candidatas: ${candidatas.length}`)
  console.log(`Recetas finales: ${finales.length}`)
  console.log()

  const sugerencias = []

  for (const sub of candidatas) {
    const subIngs = (ingsPorReceta.get(sub.id) || []).filter(i => i.insumo_id) // solo insumos directos
    if (subIngs.length < MIN_INSUMOS_MATCH) continue

    for (const fin of finales) {
      const finIngs = (ingsPorReceta.get(fin.id) || []).filter(i => i.insumo_id)
      const finPorInsumo = new Map(finIngs.map(i => [i.insumo_id, i]))

      // Cuantos insumos de S estan en F
      const enFinal = subIngs.map(si => ({
        insumo_id: si.insumo_id,
        cantSub: Number(si.cantidad),
        enFin: finPorInsumo.get(si.insumo_id),
      }))
      const compartidos = enFinal.filter(x => x.enFin)
      if (compartidos.length < MIN_INSUMOS_MATCH) continue
      const cobertura = compartidos.length / subIngs.length
      if (cobertura < FRAC_MIN_COBERTURA) continue

      // Calcular factor por cada insumo compartido
      const factores = compartidos.map(x => Number(x.enFin.cantidad) / x.cantSub)
      const promedio = factores.reduce((a, b) => a + b, 0) / factores.length
      const desv = Math.sqrt(factores.reduce((s, f) => s + (f - promedio) ** 2, 0) / factores.length)
      const cv = promedio > 0 ? desv / promedio : Infinity

      if (cv <= CV_TOLERANCIA && promedio > 0) {
        sugerencias.push({
          sub_id: sub.id, sub_nombre: sub.nombre, sub_rinde: Number(sub.rinde_cantidad), sub_unidad: sub.rinde_unidad,
          sub_total_insumos: subIngs.length,
          fin_id: fin.id, fin_nombre: fin.nombre,
          factor: promedio, cv, cobertura,
          insumos_compartidos: compartidos.map(x => ({
            insumo_id: x.insumo_id, cant_sub: x.cantSub, cant_fin: Number(x.enFin.cantidad), factor: x.enFin.cantidad / x.cantSub,
          })),
          insumos_faltantes: enFinal.filter(x => !x.enFin).map(x => x.insumo_id),
          unidades_sub: promedio * Number(sub.rinde_cantidad),
        })
      }
    }
  }

  if (sugerencias.length === 0) {
    console.log('✗ Sin sugerencias detectadas. (Probablemente las recetas no comparten exactamente la composición de las sub-recetas)')
    return
  }

  // Cargar nombres de insumos para presentar mejor
  const insIds = new Set()
  for (const s of sugerencias) {
    s.insumos_compartidos.forEach(x => insIds.add(x.insumo_id))
    s.insumos_faltantes.forEach(id => insIds.add(id))
  }
  const { data: insumosData } = await supa.from('insumos').select('id, nombre').in('id', Array.from(insIds))
  const insName = new Map((insumosData || []).map(i => [i.id, i.nombre]))

  console.log(`=== ${sugerencias.length} SUGERENCIAS DETECTADAS ===\n`)
  // Ordenar por cobertura desc (mas confiable primero)
  sugerencias.sort((a, b) => b.cobertura - a.cobertura || a.cv - b.cv)
  for (const s of sugerencias) {
    console.log(`▶ "${s.fin_nombre}"  ←  "${s.sub_nombre}"`)
    console.log(`  ${s.unidades_sub.toFixed(1)} ${s.sub_unidad} (factor ${s.factor.toFixed(2)}, CV ${(s.cv*100).toFixed(0)}%, cobertura ${(s.cobertura*100).toFixed(0)}% de ${s.sub_total_insumos} ing)`)
    console.log(`  Compartidos: ${s.insumos_compartidos.map(x => `${insName.get(x.insumo_id)} (×${x.factor.toFixed(2)})`).join(', ')}`)
    if (s.insumos_faltantes.length > 0) {
      console.log(`  ⚠ Faltan en final: ${s.insumos_faltantes.map(id => insName.get(id)).join(', ')}`)
    }
    console.log()
  }

  if (!APLICAR) {
    console.log('Para aplicar los reemplazos automaticamente, correr con --aplicar')
    return
  }

  console.log('\n=== APLICANDO REEMPLAZOS ===\n')
  let aplicados = 0
  for (const s of sugerencias) {
    // Cargar todos los ingredientes actuales de la receta final
    const { data: ingsActuales } = await supa
      .from('receta_ingredientes')
      .select('*')
      .eq('receta_id', s.fin_id)

    const insumosAEliminar = new Set(s.insumos_compartidos.map(x => x.insumo_id))
    const ingsAMantener = ingsActuales.filter(i => !i.insumo_id || !insumosAEliminar.has(i.insumo_id))

    // Eliminar y reinsertar
    await supa.from('receta_ingredientes').delete().eq('receta_id', s.fin_id)

    const filas = ingsAMantener.map((i, idx) => ({
      receta_id: s.fin_id,
      insumo_id: i.insumo_id,
      sub_receta_id: i.sub_receta_id,
      cantidad: i.cantidad,
      unidad: i.unidad,
      costo_unitario_snapshot: i.costo_unitario_snapshot,
      subtotal_costo: i.subtotal_costo,
      notas: i.notas,
      orden: idx,
    }))
    // Agregar la sub-receta como ingrediente nuevo
    filas.push({
      receta_id: s.fin_id,
      insumo_id: null,
      sub_receta_id: s.sub_id,
      cantidad: Number(s.unidades_sub.toFixed(2)),
      unidad: s.sub_unidad,
      notas: 'Detectada automáticamente del set de ingredientes',
      orden: filas.length,
    })

    const { error } = await supa.from('receta_ingredientes').insert(filas)
    if (error) {
      console.log(`✗ ${s.fin_nombre}: ${error.message}`)
      continue
    }
    console.log(`✓ ${s.fin_nombre}: +${s.unidades_sub.toFixed(1)} ${s.sub_unidad} de ${s.sub_nombre} (reemplaza ${s.insumos_compartidos.length} insumos)`)
    aplicados++
  }

  console.log(`\n✓ ${aplicados} recetas actualizadas.`)
  console.log('Ejecutar "Recalcular costos" desde la UI para refrescar costos.')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
