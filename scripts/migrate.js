#!/usr/bin/env node
// scripts/migrate.js
//
// Aplica las migraciones de migrations/ que aun no esten en _schema_migrations.
//
// Uso:
//   POSTGRES_URL='postgresql://...' node scripts/migrate.js
//   POSTGRES_URL='...' node scripts/migrate.js --dry-run    # solo lista pendientes
//   POSTGRES_URL='...' node scripts/migrate.js --list       # lista todas con estado
//
// La connection string sale de Supabase Dashboard > Project Settings > Database.
// Recomendado: el modo "non-pooling" (puerto 5432) para DDL.
//
// Cada migracion se aplica en su propia transaccion. Si falla, no se marca
// como aplicada. El proceso se aborta al primer error.
//
// NO uses esta utilidad para los 19 archivos que ya corrieron en prod a mano:
// el archivo 2026_05_22_schema_migrations.sql contiene el backfill que los
// marca como aplicados. Aplica ese archivo primero.

const fs = require('fs')
const path = require('path')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const TRACKER_TABLE  = '_schema_migrations'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const list   = args.includes('--list')

async function main() {
  let pg
  try {
    pg = require('pg')
  } catch (e) {
    console.error('Falta la dependencia `pg`. Corre: npm install pg --save-dev')
    process.exit(1)
  }

  const url = process.env.POSTGRES_URL || process.env.DATABASE_URL
  if (!url) {
    console.error('Falta POSTGRES_URL (o DATABASE_URL). Sacala del Supabase Dashboard > Settings > Database.')
    process.exit(1)
  }

  const allFiles = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()  // orden lexicografico = orden cronologico por nuestra convencion YYYY_MM_DD_

  if (allFiles.length === 0) {
    console.log('No hay migraciones en migrations/.')
    return
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
  await client.connect()

  try {
    // Verificar que el tracker existe.
    const trackerExists = await client.query(
      `SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=$1) AS ok`,
      [TRACKER_TABLE]
    )
    if (!trackerExists.rows[0].ok) {
      console.error(`La tabla ${TRACKER_TABLE} no existe.`)
      console.error('Aplica primero migrations/2026_05_22_schema_migrations.sql (a mano o via MCP).')
      process.exit(1)
    }

    const { rows: applied } = await client.query(
      `SELECT filename FROM ${TRACKER_TABLE}`
    )
    const appliedSet = new Set(applied.map(r => r.filename))
    const pending = allFiles.filter(f => !appliedSet.has(f))

    if (list) {
      console.log('Migraciones (orden cronologico):\n')
      for (const f of allFiles) {
        const mark = appliedSet.has(f) ? '✓' : '·'
        console.log(`  ${mark} ${f}`)
      }
      console.log(`\nTotal: ${allFiles.length} · aplicadas: ${appliedSet.size} · pendientes: ${pending.length}`)
      return
    }

    if (pending.length === 0) {
      console.log(`Todo al dia. ${appliedSet.size} migraciones ya aplicadas.`)
      return
    }

    console.log(`Pendientes (${pending.length}):`)
    for (const f of pending) console.log(`  · ${f}`)

    if (dryRun) {
      console.log('\n--dry-run: nada se aplico.')
      return
    }

    const host = `${process.env.USER || 'unknown'}@${require('os').hostname()}`
    for (const file of pending) {
      const sqlPath = path.join(MIGRATIONS_DIR, file)
      const sql = fs.readFileSync(sqlPath, 'utf8')
      console.log(`\n→ Aplicando ${file}…`)
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(
          `INSERT INTO ${TRACKER_TABLE} (filename, applied_by) VALUES ($1, $2)`,
          [file, host]
        )
        await client.query('COMMIT')
        console.log(`  ✓ aplicada y registrada`)
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        console.error(`  ✗ ERROR aplicando ${file}: ${e.message}`)
        console.error('  Se abortan migraciones siguientes.')
        process.exit(1)
      }
    }

    console.log(`\nListo. ${pending.length} migracion(es) aplicadas.`)
  } finally {
    await client.end()
  }
}

main().catch(err => {
  console.error('Error inesperado:', err.message)
  process.exit(1)
})
