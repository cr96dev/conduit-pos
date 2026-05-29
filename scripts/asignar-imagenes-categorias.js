#!/usr/bin/env node
// scripts/asignar-imagenes-categorias.js
//
// Asigna una imagen Unsplash genérica a cada categoría Loyverse para que el
// POS las muestre como fallback de imagen cuando el producto no tiene una.
// Idempotente: si la categoría ya tiene image_url, no lo pisa salvo --force.

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

const force = process.argv.includes('--force')

// Mapeo categoría (case-insensitive, sin acentos) -> Unsplash photo id.
// Todas las URLs verificadas como 200 OK + image/jpeg al momento de commit.
const MAPEO = {
  ACTUAL:   'photo-1568254183919-78a4f43a2877',  // interior panadería
  BEBIDAS:  'photo-1556679343-c7306c1976bc',     // bebidas frias surtidas
  CAFE:     'photo-1495474472287-4d71bcdd2085',  // latte art en taza
  EXTRAS:   'photo-1509440159596-0249088772ff',  // surtido panaderia
  PASTELES: 'photo-1565958011703-44f9829ba187',  // pastel/torta
  PASTRIES: 'photo-1509365465985-25d11c17e812',  // croissants y pastries
  TE:       'photo-1564890369478-c89ca6d9cde9',  // taza de te
}

function normalizar(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // sin acentos
    .toUpperCase().trim()
}

function urlPara(photoId) {
  return `https://images.unsplash.com/${photoId}?w=400&h=400&fit=crop&auto=format&q=80`
}

async function main() {
  const admin = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } })

  const { data: cats, error } = await admin
    .from('loyverse_categories')
    .select('loyverse_id, name, image_url')
    .order('name')
  if (error) { console.error('Error leyendo categorias:', error.message); process.exit(2) }

  let actualizadas = 0, saltadas = 0, sinMapeo = 0

  for (const cat of cats || []) {
    const key = normalizar(cat.name)
    const photoId = MAPEO[key]
    if (!photoId) {
      console.log(`  ?  ${cat.name.padEnd(15)}  (sin mapeo definido)`)
      sinMapeo++
      continue
    }
    if (cat.image_url && !force) {
      console.log(`  =  ${cat.name.padEnd(15)}  (ya tiene imagen — saltando, usá --force para sobreescribir)`)
      saltadas++
      continue
    }
    const url = urlPara(photoId)
    const { error: upErr } = await admin
      .from('loyverse_categories')
      .update({ image_url: url })
      .eq('loyverse_id', cat.loyverse_id)
    if (upErr) {
      console.error(`  X  ${cat.name.padEnd(15)}  ERROR: ${upErr.message}`)
      continue
    }
    console.log(`  ✓  ${cat.name.padEnd(15)}  ${photoId}`)
    actualizadas++
  }

  console.log('')
  console.log(`Total: ${actualizadas} actualizadas, ${saltadas} saltadas, ${sinMapeo} sin mapeo`)
}

main().catch(e => { console.error('Error fatal:', e?.message || e); process.exit(99) })
