// Reemplaza recetas existentes con el nuevo Excel Julia_Bakery_Costeo.xlsx
// - Borra las 31 recetas viejas (CASCADE elimina receta_ingredientes)
// - Inserta los insumos nuevos (skip los existentes para no perder ajustes manuales)
// - Inserta las 32 recetas con auto-match contra Loyverse

const fs = require('fs')
const XLSX = require('xlsx')

const env = fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
for (const line of env) {
  const eq = line.indexOf('=')
  if (eq > 0) process.env[line.slice(0, eq)] = line.slice(eq+1)
}
const { createClient } = require('@supabase/supabase-js')
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const PATH = '/Users/cjrh/Downloads/Julia_Bakery_Costeo.xlsx'

// Mapping manual receta -> loyverse item_name (mismo que la v1 + CHIQUEADOR)
const MATCH_OVERRIDE = {
  'PASTEL DE FRESAS CON CREMA': 'PASTEL FRESAS CON CREMA',
  'CREAM FRAICHE': null,
  'MATILDA CAKE': 'MATILDA CAKE',
  'SCONE PLAIN': 'SCONNE NORMAL',
  'SCONE DE FRESA': 'SCONE FRESA',
  'SCONE DE BERRIES': 'SCONE BERRIES',
  'PAVLOVAS': 'PAVLOVA',
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
  'CHIQUEADOR': null, // intermedio
}

const round4 = n => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

function parseExcel() {
  const wb = XLSX.readFile(PATH)
  const recetas = []
  const insumosMap = new Map()

  for (const hoja of wb.SheetNames) {
    if (hoja === 'RESUMEN') continue
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: '', header: 1 })
    if (rows.length < 5) continue

    const nombre = String(rows[0][0] || hoja).trim()

    // "Rendimiento: 12 unidades" en col 0 de fila 1
    const rindeText = String(rows[1][0] || '')
    const rindeM = rindeText.match(/Rendimiento:\s*([\d.]+)/i)
    const rinde = rindeM ? parseFloat(rindeM[1]) : 1

    // Notas: en col 4 de fila 1: "Notas: ..."
    const notasText = String(rows[1][4] || '')
    const notas = notasText.replace(/^Notas:\s*/i, '').trim() || null

    // Headers en fila 3: [#, INGREDIENTE, PROVEEDOR, CANTIDAD USO, UNIDAD, COSTO PAQUETE, COSTO EN RECETA]
    const ingredientes = []
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i]
      const nombreIng = String(r[1] || '').trim()
      const cantidad = parseFloat(r[3])
      const costoReceta = parseFloat(r[6])
      if (!nombreIng || isNaN(cantidad) || cantidad <= 0) continue
      // Saltar filas de totales (col 0 dice "COSTO TOTAL..." o vacía con costo)
      if (String(r[0]).toUpperCase().includes('COSTO')) continue

      const proveedor = String(r[2] || '').trim() || null
      const unidad = String(r[4] || 'g').trim() || 'g'
      const costoPaquete = parseFloat(r[5])
      const costoPorG = costoReceta / cantidad

      ingredientes.push({ nombre: nombreIng, proveedor, cantidad, unidad, costo_por_g: costoPorG, costo_en_receta: costoReceta })

      const key = nombreIng.toUpperCase()
      if (!insumosMap.has(key)) {
        insumosMap.set(key, {
          nombre: nombreIng,
          proveedor,
          unidad: 'g',
          costo_unitario: round4(costoPorG),
        })
      }
    }

    if (ingredientes.length === 0) continue
    recetas.push({ nombre, rinde_cantidad: rinde, notas, ingredientes })
  }

  return { recetas, insumos: Array.from(insumosMap.values()) }
}

async function main() {
  console.log('=== PARSER ===')
  const { recetas, insumos } = parseExcel()
  console.log(`Recetas: ${recetas.length} | Insumos únicos: ${insumos.length}`)

  // 1. Borrar recetas existentes (cascade borra ingredientes)
  console.log('\n=== BORRAR RECETAS EXISTENTES ===')
  const { data: existentes } = await supa.from('recetas').select('id, nombre')
  console.log(`Existen ${existentes?.length || 0} recetas a borrar`)
  if (existentes && existentes.length > 0) {
    const { error } = await supa.from('recetas').delete().in('id', existentes.map(r => r.id))
    if (error) throw new Error('Borrar recetas: ' + error.message)
    console.log(`✓ Borradas ${existentes.length} recetas (+ sus ingredientes)`)
  }

  // 2. Insumos: insertar los que NO existen ya (skip por nombre)
  console.log('\n=== INSUMOS ===')
  const { data: insumosExistentes } = await supa.from('insumos')
    .select('id, nombre, costo_unitario').eq('activo', true)
  const existeMap = new Map((insumosExistentes || []).map(i => [i.nombre.toUpperCase(), i]))

  const insumosNuevos = insumos.filter(i => !existeMap.has(i.nombre.toUpperCase()))
  console.log(`Ya existen: ${insumosExistentes?.length || 0} | Nuevos a crear: ${insumosNuevos.length}`)

  if (insumosNuevos.length > 0) {
    const rows = insumosNuevos.map(i => ({
      nombre: i.nombre,
      categoria: null,
      unidad: 'g',
      stock_actual: 0,
      stock_minimo: 0,
      costo_unitario: i.costo_unitario,
      proveedor: i.proveedor,
      notas: 'Importado del Excel v2',
    }))
    const { data, error } = await supa.from('insumos').insert(rows).select('id, nombre')
    if (error) throw new Error('Insertar insumos: ' + error.message)
    for (const ins of data) existeMap.set(ins.nombre.toUpperCase(), ins)
    console.log(`✓ ${data.length} insumos nuevos creados`)
  }

  // 3. Loyverse items para matching
  const { data: loyItems } = await supa.from('loyverse_items').select('loyverse_id, item_name')
  const loyMap = new Map((loyItems || []).map(it => [it.item_name, it.loyverse_id]))

  // 4. Recetas
  console.log('\n=== RECETAS ===')
  let creadas = 0, conLink = 0, errores = []
  for (const r of recetas) {
    const target = MATCH_OVERRIDE[r.nombre]
    const loyId = target ? (loyMap.get(target) || null) : null

    const ingsConCosto = r.ingredientes.map((ing, i) => {
      const ins = existeMap.get(ing.nombre.toUpperCase())
      if (!ins) {
        errores.push(`${r.nombre}: insumo no encontrado: ${ing.nombre}`)
        return null
      }
      const cuSnap = round4(ing.costo_por_g)
      return {
        insumo_id: ins.id,
        cantidad: round4(ing.cantidad),
        unidad: ing.unidad,
        costo_unitario_snapshot: cuSnap,
        subtotal_costo: round4(ing.cantidad * cuSnap),
        notas: null,
        orden: i,
      }
    }).filter(Boolean)

    const total = ingsConCosto.reduce((s, i) => s + Number(i.subtotal_costo), 0)
    const costoUnit = round4(total / Math.max(r.rinde_cantidad, 0.0001))

    const { data: rec, error: rErr } = await supa.from('recetas').insert({
      loyverse_item_id: loyId,
      nombre: r.nombre,
      rinde_cantidad: r.rinde_cantidad,
      rinde_unidad: 'unidad',
      merma_pct: 0,
      costo_calculado: costoUnit,
      notas: r.notas,
      activa: true,
    }).select().single()
    if (rErr) { errores.push(`${r.nombre}: ${rErr.message}`); continue }

    creadas++
    if (loyId) conLink++

    if (ingsConCosto.length > 0) {
      const rows = ingsConCosto.map(x => ({ ...x, receta_id: rec.id }))
      const { error: iErr } = await supa.from('receta_ingredientes').insert(rows)
      if (iErr) errores.push(`${r.nombre} (ings): ${iErr.message}`)
    }

    console.log(`  ✓ ${r.nombre.padEnd(35)} | rinde ${String(r.rinde_cantidad).padStart(5)} | costo/u Q${costoUnit.toFixed(2).padStart(7)} | loyverse: ${loyId ? 'SI' : '—'}`)
  }

  console.log()
  console.log(`✓ ${creadas}/${recetas.length} recetas creadas`)
  console.log(`✓ ${conLink} con link Loyverse`)
  if (errores.length > 0) {
    console.log(`\n⚠ ${errores.length} errores:`)
    errores.forEach(e => console.log(' -', e))
  }
}

main().then(() => process.exit(0)).catch(e => { console.error('ERROR:', e.message); process.exit(1) })
