#!/usr/bin/env node
// scripts/recalcular-costos-recetas.js
//
// Recalcula el costo_calculado de TODAS las recetas activas resolviendo
// sub-recetas en orden topologico (hojas primero). Refresca tambien los
// snapshots por linea: receta_ingredientes.costo_unitario_snapshot y
// subtotal_costo, asi como recetas.margen_pct.
//
// Util despues de:
//   - actualizar costos de insumos masivamente
//   - renombrar/cambiar costos de sub-recetas
//   - cualquier cambio que invalide los snapshots cacheados
//
// Reusa la logica oficial de lib/recetas.js — la misma que llama el endpoint
// POST /api/recetas/recalcular. No duplica formulas.
//
// Uso:
//   node scripts/recalcular-costos-recetas.js
//
// Salida: stats (cuantas cambiaron, rango de variacion %, top 5 cambios,
// recetas con insumos clave) + warning si alguna receta perdio su costo.

const fs = require('fs')
const path = require('path')

// Carga .env.local (soporta valores entre comillas).
const envPath = path.join(__dirname, '..', '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('Falta .env.local en la raiz del repo.')
  process.exit(1)
}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue
  const eq = line.indexOf('=')
  if (eq <= 0) continue
  let val = line.slice(eq + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  process.env[line.slice(0, eq).trim()] = val
}

const { createClient } = require('@supabase/supabase-js')

const fmtQ = (n) => Number(n || 0).toFixed(4)

async function main() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local')
    process.exit(1)
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  )

  // lib/recetas.js es ESM; el script es CJS — usamos dynamic import.
  const { recalcularTodas } = await import('../lib/recetas.js')

  // ----- BEFORE: snapshot de costos -----
  console.log('-> Snapshot ANTES…')
  const { data: antes, error: aErr } = await admin
    .from('recetas')
    .select('id, nombre, costo_calculado, costo_personalizado, activa')
  if (aErr) throw new Error('select antes: ' + aErr.message)
  const activas = antes.filter(r => r.activa)
  console.log(`   ${antes.length} recetas totales · ${activas.length} activas`)

  // Insumos para destacar (harina / canela / almendra / Chocolate Luker).
  const { data: insumosClave, error: iErr } = await admin
    .from('insumos')
    .select('id, nombre, costo_unitario, unidad')
    .or('nombre.ilike.%harina%,nombre.ilike.%canela%,nombre.ilike.%almendra%,id.eq.c9a530af-085a-42d0-983a-963499e96eb8')
  if (iErr) throw new Error('insumos clave: ' + iErr.message)

  console.log(`   Insumos destacados (${insumosClave.length}):`)
  for (const i of insumosClave) {
    console.log(`     · ${i.nombre.padEnd(35)} Q${fmtQ(i.costo_unitario)}/${i.unidad}`)
  }

  // Recetas que tocan esos insumos (directo, sin recursar sub-recetas).
  const insumosIds = insumosClave.map(i => i.id)
  const { data: links } = await admin
    .from('receta_ingredientes')
    .select('receta_id, insumo_id')
    .in('insumo_id', insumosIds)
  const destacadosSet = new Set((links || []).map(l => l.receta_id))

  // ----- RUN: recalcular todas -----
  console.log(`\n-> Recalculando ${activas.length} receta(s) en orden topologico…`)
  const t0 = Date.now()
  const result = await recalcularTodas(admin)
  const seg = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`   ✓ ${result.actualizadas} receta(s) actualizada(s) en ${seg}s`)

  // ----- AFTER -----
  const { data: despues, error: dErr } = await admin
    .from('recetas')
    .select('id, nombre, costo_calculado, costo_personalizado, activa')
  if (dErr) throw new Error('select despues: ' + dErr.message)
  const despuesById = new Map(despues.map(r => [r.id, r]))

  // Comparar.
  const cambios = []
  let perdieronValor = 0
  let conCostoNull = 0
  for (const a of antes) {
    const d = despuesById.get(a.id)
    if (!d) continue
    const c0 = a.costo_calculado != null ? Number(a.costo_calculado) : null
    const c1 = d.costo_calculado != null ? Number(d.costo_calculado) : null
    if (c1 == null) conCostoNull++
    if (c0 != null && c0 > 0 && (c1 == null || c1 === 0)) perdieronValor++
    if (c0 == null && c1 == null) continue
    const delta = (c1 || 0) - (c0 || 0)
    const deltaPct = (c0 != null && c0 > 0) ? (delta / c0) * 100 : null
    cambios.push({
      id: a.id, nombre: a.nombre, antes: c0, despues: c1,
      delta, deltaPct, destacada: destacadosSet.has(a.id), activa: a.activa,
    })
  }

  const cambiaron = cambios.filter(c => Math.abs(c.delta) > 0.0001)
  const subieron  = cambiaron.filter(c => c.delta > 0)
  const bajaron   = cambiaron.filter(c => c.delta < 0)

  console.log('\n=== RESUMEN ===')
  console.log(`Recetas activas:           ${activas.length}`)
  console.log(`Recalculadas:              ${result.actualizadas}`)
  console.log(`Con cambio (|Δ|>0.0001):   ${cambiaron.length}   (↑ ${subieron.length}  ·  ↓ ${bajaron.length})`)
  console.log(`Con costo_calculado null:  ${conCostoNull}`)

  if (cambiaron.length > 0) {
    const deltasPct = cambiaron.map(c => c.deltaPct).filter(p => Number.isFinite(p))
    if (deltasPct.length > 0) {
      const minPct = Math.min(...deltasPct)
      const maxPct = Math.max(...deltasPct)
      console.log(`Rango variación pct:       ${minPct.toFixed(2)}%  ..  ${maxPct.toFixed(2)}%`)
    }
    const deltasAbs = cambiaron.map(c => Math.abs(c.delta))
    console.log(`Mayor cambio absoluto:     Q${Math.max(...deltasAbs).toFixed(4)}`)
  }

  // Destacadas (con harina/canela/almendras/Chocolate Luker).
  const destacadas = cambios.filter(c => c.destacada)
  if (destacadas.length > 0) {
    destacadas.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    console.log(`\n=== RECETAS CON INSUMOS DESTACADOS (top ${Math.min(destacadas.length, 8)}) ===`)
    for (const c of destacadas.slice(0, 8)) {
      const arrow = c.delta > 0 ? '↑' : c.delta < 0 ? '↓' : '·'
      const pct = c.deltaPct != null ? ` (${c.deltaPct.toFixed(1)}%)` : ''
      console.log(`  ${arrow} ${c.nombre.padEnd(40)}  Q${fmtQ(c.antes)} → Q${fmtQ(c.despues)}   Δ ${fmtQ(c.delta)}${pct}`)
    }
  }

  // Top 5 mayores cambios absolutos.
  cambios.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
  console.log('\n=== TOP 5 MAYORES VARIACIONES (Q absoluto) ===')
  for (const c of cambios.slice(0, 5)) {
    const arrow = c.delta > 0 ? '↑' : c.delta < 0 ? '↓' : '·'
    const pct = c.deltaPct != null ? ` (${c.deltaPct.toFixed(1)}%)` : ''
    console.log(`  ${arrow} ${c.nombre.padEnd(40)}  Q${fmtQ(c.antes)} → Q${fmtQ(c.despues)}   Δ ${fmtQ(c.delta)}${pct}`)
  }

  // Sanity: ninguna receta debe perder costo si antes tenia.
  if (perdieronValor > 0) {
    console.log(`\n⚠ ${perdieronValor} receta(s) PERDIERON su costo (antes >0, ahora null/0):`)
    for (const c of cambios.filter(c => c.antes > 0 && (c.despues == null || c.despues === 0))) {
      console.log(`    - ${c.nombre} (id ${c.id})`)
    }
  } else {
    console.log('\n✓ Ninguna receta perdió valor de costo respecto del previo.')
  }
}

main().catch(e => {
  console.error('FATAL:', e.message)
  if (e.stack) console.error(e.stack)
  process.exit(1)
})
