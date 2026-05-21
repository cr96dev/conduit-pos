// Script de import del Excel de costeo a la DB.
// Lee /tmp/recetas_parsed.json + /tmp/loyverse_items.json, inserta insumos,
// crea recetas con auto-match contra Loyverse usando un override manual.

const fs = require('fs')
const env = fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
for (const line of env) {
  const eq = line.indexOf('=')
  if (eq > 0) process.env[line.slice(0, eq)] = line.slice(eq+1)
}
const { createClient } = require('@supabase/supabase-js')
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const parsed = JSON.parse(fs.readFileSync('/tmp/recetas_parsed.json'))
const loyItems = JSON.parse(fs.readFileSync('/tmp/loyverse_items.json'))

// Override manual de matches (nombre receta Excel -> item_name Loyverse exacto).
// null = no asociar (es intermedio o componente).
const MATCH_OVERRIDE = {
  'PASTEL DE FRESAS CON CREMA': 'PASTEL FRESAS CON CREMA',
  'CREAM FRAICHE': null,
  'MATILDA CAKE': 'MATILDA CAKE',
  'SCONE PLAIN': 'SCONNE NORMAL',
  'SCONE DE FRESA': 'SCONE FRESA',
  'SCONE DE BERRIES': 'SCONE BERRIES',
  'PAVLOPVAS': 'PAVLOVA',
  'PESTO': null,
  'LOAF DE ZANAHORIA': 'PASTEL DE ZANAHORIA',
  'mantequilla de mani': null,
  'mantequilla de pistacho': null,
  'CREMA PASTELERA': null,
  'CREME BRULEE': null,
  'TIRAMISU': 'TIRAMISÚ',
  'PIE ALSACIANO DE FRUTA': 'PIE ALSACIANO',
  'PASTEL DE BANANO': 'PAN DE BANANO',
  'BABKA': null,
  'PERTZEL': 'PRETZEL',
  'QUESO CREMA DULCE': null,
  'FOCACCIA': 'FOCACCIA',
  'GLASEADO DE CANELA': null,
  'CROISSANT': 'CROISSANT PLAIN',
  'DANISH': 'DANESA DULCE',
  'MASA BRISE': null,
  'MASA QUICHE': null,
  'PECANAS CARAMELIZADAS': null,
  'CHEESECAKE': 'CHEESECAKE PLAIN',
  'CHEESECAKE NUTELLA': 'CHEESECAKE DE NUTELLA',
  'CHEESECAKE DE MARACUYA': 'CHEESECAKE DE MARACUYA',
  'LEMON DRIZZLE LOAF CAKE': 'LOAF CAKE PORCION',
  'CHOCOCHIP COOKIE': 'GALLETA CHOCOCHIPS',
}

function findLoyId(nombreReceta) {
  const target = MATCH_OVERRIDE[nombreReceta]
  if (target === null) return null
  if (target === undefined) return null
  // Tomar el primer item que matchee exacto por nombre (puede haber duplicados)
  const it = loyItems.find(i => i.item_name === target)
  return it?.loyverse_id || null
}

const round4 = n => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

async function importar() {
  // 1. INSUMOS — bulk insert
  console.log('=== INSUMOS ===')
  const insumoRows = parsed.insumos.map(i => ({
    nombre: i.nombre,
    categoria: null,
    unidad: 'g',
    stock_actual: 0,
    stock_minimo: 0,
    costo_unitario: round4(i.costo_unitario),
    proveedor: i.proveedor,
    notas: 'Importado del Excel de costeo',
  }))

  const { data: insumosCreados, error: insErr } = await supa
    .from('insumos').insert(insumoRows).select('id, nombre')
  if (insErr) {
    console.error('Error insertando insumos:', insErr.message)
    return
  }
  console.log(`✓ ${insumosCreados.length} insumos insertados`)

  const insumoIdByName = new Map(insumosCreados.map(i => [i.nombre.toUpperCase(), i.id]))

  // 2. RECETAS + INGREDIENTES
  console.log('\n=== RECETAS ===')
  let recetasOk = 0, recetasConMatch = 0, totalIngs = 0, errores = []

  for (const r of parsed.recetas) {
    const loyId = findLoyId(r.nombre)

    // Calcular costo
    const ingsConCosto = r.ingredientes.map((ing, i) => {
      const id = insumoIdByName.get(ing.nombre.toUpperCase())
      if (!id) {
        errores.push(`${r.nombre}: insumo no encontrado: ${ing.nombre}`)
        return null
      }
      return {
        insumo_id: id,
        cantidad: round4(ing.cantidad),
        unidad: ing.unidad || 'g',
        costo_unitario_snapshot: round4(ing.costo_por_g),
        subtotal_costo: round4(ing.cantidad * ing.costo_por_g),
        notas: null,
        orden: i,
      }
    }).filter(Boolean)

    const totalCosto = ingsConCosto.reduce((s, i) => s + Number(i.subtotal_costo), 0)
    const costoUnidad = round4(totalCosto / Math.max(r.rinde_cantidad, 0.0001))

    const { data: receta, error: rErr } = await supa
      .from('recetas').insert({
        loyverse_item_id: loyId,
        nombre: r.nombre,
        rinde_cantidad: r.rinde_cantidad,
        rinde_unidad: 'unidad',
        merma_pct: 0,
        costo_calculado: costoUnidad,
        notas: r.notas || null,
        activa: true,
      }).select().single()

    if (rErr) {
      errores.push(`${r.nombre}: ${rErr.message}`)
      continue
    }
    recetasOk++
    if (loyId) recetasConMatch++

    if (ingsConCosto.length > 0) {
      const rows = ingsConCosto.map(i => ({ ...i, receta_id: receta.id }))
      const { error: iErr } = await supa.from('receta_ingredientes').insert(rows)
      if (iErr) errores.push(`${r.nombre} (ings): ${iErr.message}`)
      else totalIngs += rows.length
    }

    console.log(`  ✓ ${r.nombre.padEnd(35)} | rinde ${r.rinde_cantidad} | costo/u: Q${costoUnidad.toFixed(2)} | loyverse: ${loyId ? 'SI' : '—'}`)
  }

  console.log()
  console.log(`✓ Recetas creadas: ${recetasOk}/${parsed.recetas.length}`)
  console.log(`✓ Con link Loyverse: ${recetasConMatch}`)
  console.log(`✓ Total ingredientes vinculados: ${totalIngs}`)
  if (errores.length > 0) {
    console.log(`\n⚠ Errores (${errores.length}):`)
    errores.forEach(e => console.log('   - ' + e))
  }
}

importar().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
