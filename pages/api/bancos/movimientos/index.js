// pages/api/bancos/movimientos/index.js
// GET  /api/bancos/movimientos?cuenta_id=X&desde=...&hasta=...&estado=conciliados|pendientes
// POST /api/bancos/movimientos    -> importar bulk
//   Body: { cuenta_id, movimientos: [{fecha, descripcion, referencia?, debito?, credito?, saldo?}] }
//   Calcula hash y deduplica.

import { createHash } from 'crypto'
import { requireAuth, requireAdmin } from '../../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return importar(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { cuenta_id, desde, hasta, estado, limit = 200 } = req.query
  if (!cuenta_id) return res.status(400).json({ error: 'cuenta_id requerido' })

  let q = auth.admin
    .from('bancos_movimientos')
    .select('*, asientos(id, numero, descripcion, total_debe, estado)')
    .eq('cuenta_id', cuenta_id)
    .order('fecha', { ascending: false })
    .order('importado_at', { ascending: false })
    .limit(Math.min(Number(limit) || 200, 1000))

  if (desde)               q = q.gte('fecha', desde)
  if (hasta)               q = q.lte('fecha', hasta)
  if (estado === 'conciliados') q = q.not('asiento_id', 'is', null)
  if (estado === 'pendientes')  q = q.is('asiento_id', null)

  const { data, error } = await q
  if (error) return res.status(500).json({ ok: false, error: error.message })
  return res.status(200).json({ ok: true, movimientos: data })
}

async function importar(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { cuenta_id, movimientos } = req.body || {}
  if (!cuenta_id) return res.status(400).json({ error: 'cuenta_id requerido' })
  if (!Array.isArray(movimientos) || movimientos.length === 0) {
    return res.status(400).json({ error: 'movimientos[] requerido' })
  }

  const rows = []
  const erroresFila = []
  for (const [i, m] of movimientos.entries()) {
    if (!m.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(m.fecha)) {
      erroresFila.push(`fila ${i + 1}: fecha invalida`)
      continue
    }
    if (!m.descripcion?.trim()) {
      erroresFila.push(`fila ${i + 1}: descripcion requerida`)
      continue
    }
    const debito  = round2(Number(m.debito)  || 0)
    const credito = round2(Number(m.credito) || 0)
    if (debito === 0 && credito === 0) {
      erroresFila.push(`fila ${i + 1}: debito o credito > 0`)
      continue
    }
    if (debito > 0 && credito > 0) {
      erroresFila.push(`fila ${i + 1}: solo debito o credito`)
      continue
    }
    const ref = m.referencia?.trim() || ''
    const hash = createHash('sha256')
      .update(`${cuenta_id}|${m.fecha}|${m.descripcion.trim()}|${debito}|${credito}|${ref}`)
      .digest('hex').slice(0, 32)
    rows.push({
      cuenta_id, fecha: m.fecha, descripcion: m.descripcion.trim(),
      referencia: ref || null,
      debito, credito,
      saldo: m.saldo != null ? round2(Number(m.saldo)) : null,
      hash_import: hash,
      raw: { source: m.raw_source || 'csv', original: m },
    })
  }

  if (rows.length === 0) {
    return res.status(400).json({ ok: false, errores: erroresFila })
  }

  // upsert con onConflict en (cuenta_id, hash_import) — ignora duplicados.
  const { data, error } = await auth.admin
    .from('bancos_movimientos')
    .upsert(rows, { onConflict: 'cuenta_id,hash_import', ignoreDuplicates: true })
    .select()

  if (error) return res.status(500).json({ ok: false, error: error.message })

  return res.status(201).json({
    ok: true,
    insertados: data?.length || 0,
    procesados: rows.length,
    duplicados_o_existentes: rows.length - (data?.length || 0),
    errores_fila: erroresFila,
  })
}
