#!/usr/bin/env node
// scripts/video/generate.js
//
// Genera los 12 shots del video lanzamiento Conduit POS usando Veo
// de Google AI Studio.
//
// Uso:
//   GOOGLE_API_KEY=xxx node scripts/video/generate.js                 # genera todos los shots pendientes
//   GOOGLE_API_KEY=xxx node scripts/video/generate.js --shot=5        # solo el shot 5
//   GOOGLE_API_KEY=xxx node scripts/video/generate.js --dry-run       # estima costo sin generar
//   GOOGLE_API_KEY=xxx node scripts/video/generate.js --model=veo-2.0 # usa Veo 2 (más barato)
//
// Características:
//   - Resume: si ya tenés shots generados en video-output/, los saltea
//   - Cost estimate antes de cada generación con prompt de confirmación
//   - Polling: cada 15s hasta que la operación termine
//   - Retry: 3 intentos con backoff exponencial en errores transientes
//   - State file: guarda progreso en .video-state.json
//
// Output:
//   video-output/shots/shot-01-reloj.mp4
//   video-output/shots/shot-02-excel.mp4
//   ...
//   video-output/.video-state.json
//
// Requiere:
//   - Node.js 20+
//   - npm install @google/genai
//   - API key Google AI Studio con acceso a Veo (billing habilitado)

import { GoogleGenAI } from '@google/genai'
import { writeFile, readFile, mkdir, access } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shots, totalSeconds } from './shots.js'

// ─────────────────────────────────────────────────────────────────────
//   CONFIG
// ─────────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..', '..')
const OUTPUT_DIR = join(REPO_ROOT, 'video-output')
const SHOTS_DIR = join(OUTPUT_DIR, 'shots')
const STATE_FILE = join(OUTPUT_DIR, '.video-state.json')

// Precios oficiales Google AI Studio (junio 2026, actualizar si cambian)
// Veo 3 preview: $0.75 / segundo de video generado
// Veo 2:         $0.10 / segundo
// Fuente: ai.google.dev/pricing
const PRICING = {
  'veo-3.0-generate-preview': 0.75,
  'veo-3.0-generate-001':     0.75,
  'veo-2.0-generate-001':     0.10,
}

const POLL_INTERVAL_MS = 15_000        // 15 seg entre cada poll
const MAX_POLL_ATTEMPTS = 40           // 10 min máximo por shot
const MAX_RETRIES_PER_SHOT = 3
const RETRY_BACKOFF_MS = 30_000

// ─────────────────────────────────────────────────────────────────────
//   CLI args
// ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const opt = {
  dryRun: args.includes('--dry-run'),
  onlyShot: parseInt(args.find(a => a.startsWith('--shot='))?.split('=')[1] || '0'),
  model: args.find(a => a.startsWith('--model='))?.split('=')[1] || 'veo-3.0-generate-preview',
  yes: args.includes('--yes') || args.includes('-y'),
}

// ─────────────────────────────────────────────────────────────────────
//   Helpers
// ─────────────────────────────────────────────────────────────────────

function log(...args) {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}]`, ...args)
}

function err(...args) {
  const ts = new Date().toISOString().slice(11, 19)
  console.error(`[${ts}] \x1b[31mERROR:\x1b[0m`, ...args)
}

function fmtCost(seconds, model) {
  const rate = PRICING[model] ?? 0.5
  return (seconds * rate).toFixed(2)
}

function fmtTime(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadState() {
  if (!await fileExists(STATE_FILE)) return { generated: {}, attempts: {} }
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf-8'))
  } catch {
    return { generated: {}, attempts: {} }
  }
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2))
}

async function ask(question) {
  if (opt.yes) {
    log(`(auto-yes) ${question}`)
    return true
  }
  process.stdout.write(`${question} [s/N] `)
  return new Promise(resolve => {
    process.stdin.once('data', d => {
      const ans = d.toString().trim().toLowerCase()
      resolve(ans === 's' || ans === 'si' || ans === 'sí' || ans === 'y' || ans === 'yes')
    })
  })
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function shotFilename(shot) {
  const id = String(shot.id).padStart(2, '0')
  const slug = shot.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `shot-${id}-${slug}.mp4`
}

// ─────────────────────────────────────────────────────────────────────
//   Veo generation
// ─────────────────────────────────────────────────────────────────────

async function generateShot(ai, shot, attemptNumber = 1) {
  const outputPath = join(SHOTS_DIR, shotFilename(shot))

  log(`Shot ${shot.id} — "${shot.label}" (${shot.durationSeconds}s, ${shot.aspectRatio}) intento ${attemptNumber}/${MAX_RETRIES_PER_SHOT}`)
  log(`   → submitting prompt to ${opt.model}...`)

  let operation
  try {
    operation = await ai.models.generateVideos({
      model: opt.model,
      prompt: shot.prompt,
      config: {
        aspectRatio: shot.aspectRatio,
        durationSeconds: shot.durationSeconds,
        numberOfVideos: 1,
        personGeneration: 'dont_allow',  // no faces, anti-AI-tells
      },
    })
  } catch (e) {
    err(`Submit falló: ${e.message}`)
    if (attemptNumber < MAX_RETRIES_PER_SHOT) {
      log(`   ↳ reintentando en ${fmtTime(RETRY_BACKOFF_MS * attemptNumber)}...`)
      await sleep(RETRY_BACKOFF_MS * attemptNumber)
      return generateShot(ai, shot, attemptNumber + 1)
    }
    throw e
  }

  log(`   ✓ operación submitida, polling cada ${POLL_INTERVAL_MS / 1000}s...`)

  // Poll hasta done
  const startTime = Date.now()
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await sleep(POLL_INTERVAL_MS)
    try {
      operation = await ai.operations.getVideosOperation({ operation })
    } catch (e) {
      err(`Poll falló: ${e.message}`)
      continue
    }
    const elapsed = Date.now() - startTime
    if (operation.done) {
      log(`   ✓ generación completada en ${fmtTime(elapsed)}`)
      break
    }
    log(`   ⏳ aún procesando... (${fmtTime(elapsed)})`)
  }

  if (!operation.done) {
    err(`Shot ${shot.id} timeout después de ${MAX_POLL_ATTEMPTS} polls`)
    if (attemptNumber < MAX_RETRIES_PER_SHOT) {
      log(`   ↳ reintentando...`)
      return generateShot(ai, shot, attemptNumber + 1)
    }
    throw new Error(`Timeout en shot ${shot.id}`)
  }

  if (operation.error) {
    err(`Shot ${shot.id} error: ${JSON.stringify(operation.error)}`)
    if (attemptNumber < MAX_RETRIES_PER_SHOT) {
      log(`   ↳ reintentando en ${fmtTime(RETRY_BACKOFF_MS * attemptNumber)}...`)
      await sleep(RETRY_BACKOFF_MS * attemptNumber)
      return generateShot(ai, shot, attemptNumber + 1)
    }
    throw new Error(`Error generando shot ${shot.id}: ${operation.error.message || 'desconocido'}`)
  }

  // Descargar
  const generated = operation.response?.generatedVideos?.[0]
  if (!generated?.video) {
    throw new Error(`Shot ${shot.id} sin video en response`)
  }

  log(`   ↓ descargando MP4 a ${outputPath}...`)
  await ai.files.download({
    file: generated.video,
    downloadPath: outputPath,
  })

  const stats = await import('node:fs').then(fs => fs.promises.stat(outputPath))
  log(`   ✓ shot ${shot.id} listo (${(stats.size / 1024 / 1024).toFixed(1)} MB)`)

  return outputPath
}

// ─────────────────────────────────────────────────────────────────────
//   Main
// ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('  Conduit POS · Generador de Video Lanzamiento')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('')

  if (!process.env.GOOGLE_API_KEY) {
    err('GOOGLE_API_KEY no está configurada')
    console.log('')
    console.log('  Generá una key en: https://aistudio.google.com/apikey')
    console.log('  Después corré:')
    console.log('')
    console.log('    GOOGLE_API_KEY=tu_key_aqui node scripts/video/generate.js')
    console.log('')
    process.exit(1)
  }

  await mkdir(SHOTS_DIR, { recursive: true })
  const state = await loadState()

  // Filtrar shots a procesar
  let shotsToProcess = shots
  if (opt.onlyShot > 0) {
    shotsToProcess = shots.filter(s => s.id === opt.onlyShot)
    if (!shotsToProcess.length) {
      err(`Shot ${opt.onlyShot} no existe. Rango válido: 1-${shots.length}`)
      process.exit(1)
    }
  } else {
    // Solo los que no existen como MP4
    const pending = []
    for (const shot of shots) {
      const path = join(SHOTS_DIR, shotFilename(shot))
      if (!await fileExists(path)) pending.push(shot)
    }
    shotsToProcess = pending
  }

  if (!shotsToProcess.length) {
    log('Todos los shots ya están generados. Nada por hacer.')
    log(`Output: ${SHOTS_DIR}`)
    return
  }

  // Costo estimado
  const pendingSeconds = shotsToProcess.reduce((s, x) => s + x.durationSeconds, 0)
  const cost = fmtCost(pendingSeconds, opt.model)
  const estTime = (shotsToProcess.length * 2.5).toFixed(0)  // ~2.5 min promedio por shot

  console.log(`Modelo:              ${opt.model}`)
  console.log(`Shots a generar:     ${shotsToProcess.length} / ${shots.length}`)
  console.log(`Segundos totales:    ${pendingSeconds}s (de ${totalSeconds}s del video completo)`)
  console.log(`Costo estimado:      \x1b[33mUSD $${cost}\x1b[0m`)
  console.log(`Tiempo estimado:     ~${estTime} min`)
  console.log('')
  console.log('Shots:')
  for (const shot of shotsToProcess) {
    console.log(`   ${String(shot.id).padStart(2, '0')}. ${shot.label.padEnd(22)} ${shot.durationSeconds}s   $${fmtCost(shot.durationSeconds, opt.model)}`)
  }
  console.log('')

  if (opt.dryRun) {
    log('--dry-run activo. No se genera nada.')
    return
  }

  const confirmed = await ask(`¿Generar estos ${shotsToProcess.length} shots por \x1b[33m$${cost}\x1b[0m?`)
  if (!confirmed) {
    log('Cancelado.')
    return
  }

  // Iniciar cliente y generar
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY })

  let success = 0
  let failed = []
  const startTime = Date.now()

  for (const shot of shotsToProcess) {
    try {
      const path = await generateShot(ai, shot)
      state.generated[shot.id] = { path, generatedAt: new Date().toISOString(), model: opt.model }
      await saveState(state)
      success++
    } catch (e) {
      err(`Shot ${shot.id} falló definitivamente: ${e.message}`)
      failed.push({ id: shot.id, label: shot.label, error: e.message })
      state.attempts[shot.id] = (state.attempts[shot.id] || 0) + 1
      await saveState(state)
    }
    console.log('')
  }

  // Resumen
  const totalElapsed = Date.now() - startTime
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  Generación completada en ${fmtTime(totalElapsed)}`)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log(`  ✓ Exitosos: ${success} / ${shotsToProcess.length}`)
  if (failed.length) {
    console.log(`  ✗ Fallidos: ${failed.length}`)
    for (const f of failed) {
      console.log(`     - Shot ${f.id} (${f.label}): ${f.error}`)
    }
    console.log('')
    console.log(`  Reintentar fallidos: node scripts/video/generate.js --shot=<id>`)
  }
  console.log('')
  console.log(`  Output: ${SHOTS_DIR}`)
  console.log('')
  console.log('  Próximo paso: editá los clips en CapCut / Final Cut con')
  console.log('  el storyboard de brand/VIDEO_PROMPT_LAUNCH.md')
  console.log('')
}

main().catch(e => {
  err(`Fatal: ${e.message}`)
  console.error(e.stack)
  process.exit(1)
})
