#!/usr/bin/env node
// scripts/limpiar-ventas-prueba.js
//
// Borra las ventas POS de prueba creadas durante el testing del flujo
// cajero+turno+ticket. Tambien limpia datos derivados:
//   - facturas_fel_items (cascade)
//   - comandas asociadas a esas facturas (cascade SET NULL deja huerfanas, las borramos)
//   - asientos contables generados (por factura.origen_tipo='pos_propio')
//   - asientos_lineas (cascade)
//   - insumos_movimientos generados por ventas POS
//   - turnos_caja del periodo del testing
//   - neonet_transacciones (si las hay)
//
// Criterio: TODO lo creado con origen_tipo='pos_propio' desde 2026-05-28 (hoy).
// Loyverse y otras fuentes NO se tocan.
//
// Uso:
//   node scripts/limpiar-ventas-prueba.js              # dry-run (default: muestra que borraria)
//   node scripts/limpiar-ventas-prueba.js --execute    # ejecuta

const fs = require('fs')
const path = require('path')

function cargarEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  const txt = fs.readFileSync(envPath, 'utf8')
  for (const linea of txt.split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/)
    if (m) {
      const v = m[2].replace(/^"|"$/g, '').replace(/^'|'$/g, '')
      if (!process.env[m[1]]) process.env[m[1]] = v
    }
  }
}
cargarEnv()

const { createClient } = require('@supabase/supabase-js')
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) { console.error('Faltan envs Supabase'); process.exit(1) }

const execute = process.argv.includes('--execute')
const desde = '2026-05-28T00:00:00.000Z' // todo lo de hoy

async function main() {
  const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  console.log(`\n=== ${execute ? 'EJECUTANDO' : 'DRY-RUN (no borra)'} ===`)
  console.log(`Criterio: facturas_fel.origen_tipo='pos_propio' AND created_at >= ${desde}\n`)

  // 1. Listar las facturas que se van a borrar
  const { data: facturas, error: fErr } = await admin
    .from('facturas_fel')
    .select('id, uuid_sat, total, metodo_pago, fecha_certificacion, receptor_nombre, creado_por')
    .eq('origen_tipo', 'pos_propio')
    .gte('created_at', desde)
    .order('fecha_certificacion', { ascending: false })
  if (fErr) { console.error('Error listando facturas:', fErr.message); process.exit(2) }

  console.log(`📄 ${facturas.length} facturas POS encontradas:`)
  for (const f of facturas) {
    console.log(`   ${f.fecha_certificacion?.slice(0, 19) || '—'}  Q${Number(f.total).toFixed(2).padStart(7)}  ${f.metodo_pago?.padEnd(10)} ${f.receptor_nombre.slice(0, 30)}  uuid:${f.uuid_sat?.slice(0,8) || '—'}`)
  }
  const facturaIds = facturas.map(f => f.id)

  // 2. Comandas asociadas
  const { data: comandas } = facturaIds.length === 0 ? { data: [] } :
    await admin.from('comandas').select('id, estado').in('factura_id', facturaIds)
  console.log(`\n📋 ${comandas?.length || 0} comandas asociadas`)

  // 3. Asientos contables asociados (via facturas_fel.asiento_id)
  const asientoIds = facturas.map(f => f.asiento_id).filter(Boolean)
  console.log(`💰 ${asientoIds.length} asientos contables linkeados`)

  // 4. Insumos movimientos (referencia jsonb con factura_id)
  let movimientos = []
  if (facturaIds.length > 0) {
    const promises = facturaIds.map(id =>
      admin.from('insumos_movimientos').select('id, insumo_id, delta')
        .contains('referencia', { factura_id: id })
    )
    const results = await Promise.all(promises)
    movimientos = results.flatMap(r => r.data || [])
  }
  console.log(`📦 ${movimientos.length} movimientos de insumos linkeados`)

  // 5. Neonet transacciones
  const { data: neonet } = facturaIds.length === 0 ? { data: [] } :
    await admin.from('neonet_transacciones').select('id, idsale').in('factura_id', facturaIds)
  console.log(`💳 ${neonet?.length || 0} transacciones Neonet linkeadas`)

  // 6. Turnos de caja del periodo (tanto abiertos como cerrados)
  const { data: turnos } = await admin
    .from('turnos_caja')
    .select('id, cajero_id, estado, fecha_apertura, fecha_cierre')
    .gte('fecha_apertura', desde)
  console.log(`🕐 ${turnos?.length || 0} turnos de caja del periodo`)
  for (const t of turnos || []) {
    console.log(`   ${t.estado.padEnd(8)} apertura: ${t.fecha_apertura?.slice(0, 19)}  cierre: ${t.fecha_cierre?.slice(0, 19) || '—'}`)
  }

  if (!execute) {
    console.log('\n📋 DRY-RUN: NO se borro nada. Para borrar, correr con --execute\n')
    return
  }

  console.log('\n🗑️  Borrando...\n')

  // Orden de borrado (respetando FK):
  // a) insumos_movimientos
  if (movimientos.length > 0) {
    const ids = movimientos.map(m => m.id)
    const { error } = await admin.from('insumos_movimientos').delete().in('id', ids)
    if (error) { console.error('  ⚠️ movimientos:', error.message) }
    else { console.log(`  ✓ ${ids.length} movimientos de insumos borrados`) }
    // Importante: insumos.stock_actual quedo descontado por el trigger original.
    // Hay que revertir manualmente cada uno. Lo hacemos sumando el delta inverso:
    // recompute stock por insumo afectado
    const insumoIds = [...new Set(movimientos.map(m => m.insumo_id))]
    for (const insumoId of insumoIds) {
      // Recalcular stock_actual desde el ultimo movimiento sobreviviente
      const { data: ultimoMov } = await admin
        .from('insumos_movimientos')
        .select('stock_despues')
        .eq('insumo_id', insumoId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nuevoStock = ultimoMov?.stock_despues ?? 0
      await admin.from('insumos').update({ stock_actual: nuevoStock }).eq('id', insumoId)
      console.log(`    ↺ insumo ${insumoId.slice(0,8)}.. stock_actual=${nuevoStock}`)
    }
  }

  // b) comandas (cascade SET NULL de factura_id; los borramos a mano)
  if (comandas && comandas.length > 0) {
    const { error } = await admin.from('comandas').delete().in('id', comandas.map(c => c.id))
    if (error) { console.error('  ⚠️ comandas:', error.message) }
    else { console.log(`  ✓ ${comandas.length} comandas borradas`) }
  }

  // c) neonet_transacciones
  if (neonet && neonet.length > 0) {
    const { error } = await admin.from('neonet_transacciones').delete().in('id', neonet.map(n => n.id))
    if (error) { console.error('  ⚠️ neonet:', error.message) }
    else { console.log(`  ✓ ${neonet.length} transacciones Neonet borradas`) }
  }

  // d) facturas_fel (items se borran por cascade)
  if (facturas.length > 0) {
    const { error } = await admin.from('facturas_fel').delete().in('id', facturaIds)
    if (error) { console.error('  ⚠️ facturas:', error.message) }
    else { console.log(`  ✓ ${facturas.length} facturas borradas (items cascade)`) }
  }

  // e) asientos contables (lineas cascade)
  if (asientoIds.length > 0) {
    const { error } = await admin.from('asientos').delete().in('id', asientoIds)
    if (error) { console.error('  ⚠️ asientos:', error.message) }
    else { console.log(`  ✓ ${asientoIds.length} asientos contables borrados`) }
  }

  // f) turnos_caja del periodo
  if (turnos && turnos.length > 0) {
    const { error } = await admin.from('turnos_caja').delete().in('id', turnos.map(t => t.id))
    if (error) { console.error('  ⚠️ turnos:', error.message) }
    else { console.log(`  ✓ ${turnos.length} turnos de caja borrados`) }
  }

  // g) reset de cajeros_login_intentos (tracker de lockout, suciedad de testing)
  await admin.from('cajeros_login_intentos').delete().neq('ip', '')
  console.log(`  ✓ tabla cajeros_login_intentos vaciada`)

  console.log('\n✅ Limpieza completada\n')
}

main().catch(e => { console.error('Error fatal:', e?.message || e, e?.stack); process.exit(99) })
