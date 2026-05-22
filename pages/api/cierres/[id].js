// pages/api/cierres/[id].js
// GET    /api/cierres/:id   -> detalle con egresos
// PATCH  /api/cierres/:id   -> editar (solo si abierto, admin)
// DELETE /api/cierres/:id   -> borrar (admin)
//
// PATCH body acepta { saldo_inicial?, conteo_efectivo?, notas?, egresos? }
// Si llega `egresos`, se reemplazan todos los del cierre.
// Tambien recalcula ventas desde Loyverse (por si el sync trajo nuevos recibos).

import { requireAuth, requireAdmin } from '../../../lib/auth'
import { calcularVentasDelDia } from '../../../lib/cierres'

export default async function handler(req, res) {
  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  if (req.method === 'GET')    return detalle(req, res, id)
  if (req.method === 'PATCH')  return editar(req, res, id)
  if (req.method === 'DELETE') return borrar(req, res, id)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function detalle(req, res, id) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: cierre, error: cErr } = await auth.admin
    .from('cierres_caja').select('*').eq('id', id).single()
  if (cErr) return res.status(404).json({ error: 'Cierre no encontrado' })

  const { data: egresos } = await auth.admin
    .from('cierres_egresos').select('*').eq('cierre_id', id).order('created_at')

  return res.status(200).json({ ok: true, cierre: { ...cierre, egresos: egresos || [] } })
}

async function editar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { data: actual, error: gErr } = await auth.admin
    .from('cierres_caja').select('*').eq('id', id).single()
  if (gErr || !actual) return res.status(404).json({ error: 'Cierre no encontrado' })
  if (actual.estado !== 'abierto') {
    return res.status(400).json({ error: 'Solo se puede editar un cierre abierto. Reabrirlo primero.' })
  }

  // Recalcular ventas (Loyverse pudo traer nuevos recibos mientras el cierre estaba abierto).
  let ventas
  try {
    ventas = await calcularVentasDelDia(auth.admin, actual.fecha)
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message })
  }

  // Reemplazar egresos si llegan en el body.
  if (Array.isArray(req.body?.egresos)) {
    for (const [i, e] of req.body.egresos.entries()) {
      if (!e.concepto?.trim() || !(Number(e.monto) > 0)) {
        return res.status(400).json({ error: `egreso ${i + 1}: concepto y monto > 0 requeridos` })
      }
    }
    await auth.admin.from('cierres_egresos').delete().eq('cierre_id', id)
    if (req.body.egresos.length > 0) {
      const rows = req.body.egresos.map(e => ({
        cierre_id: id,
        concepto: e.concepto.trim(),
        monto: Number(e.monto),
        created_by: auth.user.id,
      }))
      const { error: eErr } = await auth.admin.from('cierres_egresos').insert(rows)
      if (eErr) {
        console.error('[cierres.editar] egresos ERROR:', eErr.message)
        return res.status(500).json({ ok: false, error: eErr.message })
      }
    }
  }

  // Sumar egresos (los recien insertados o los existentes).
  const { data: egActuales } = await auth.admin
    .from('cierres_egresos').select('monto').eq('cierre_id', id)
  const egresos_total = round2((egActuales || []).reduce((s, e) => s + Number(e.monto || 0), 0))

  const si = req.body?.saldo_inicial != null ? Number(req.body.saldo_inicial) : Number(actual.saldo_inicial)
  const ceRaw = req.body && 'conteo_efectivo' in req.body ? req.body.conteo_efectivo : actual.conteo_efectivo
  const ce = ceRaw != null && ceRaw !== '' ? Number(ceRaw) : null
  const saldo_esperado = round2(si + ventas.ventas_efectivo - egresos_total)
  const diferencia = ce != null ? round2(ce - saldo_esperado) : null

  const patch = {
    saldo_inicial: si,
    conteo_efectivo: ce,
    ventas_efectivo: ventas.ventas_efectivo,
    ventas_tarjeta: ventas.ventas_tarjeta,
    ventas_otros: ventas.ventas_otros,
    ventas_total: ventas.ventas_total,
    cantidad_recibos: ventas.cantidad_recibos,
    desglose_pagos: ventas.desglose_pagos || {},
    egresos_total,
    saldo_esperado,
    diferencia,
    updated_at: new Date().toISOString(),
  }
  if (req.body && 'notas' in req.body) patch.notas = req.body.notas?.trim() || null

  const { data, error } = await auth.admin
    .from('cierres_caja').update(patch).eq('id', id).select().single()
  if (error) {
    console.error('[cierres.editar] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, cierre: data })
}

async function borrar(req, res, id) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { error } = await auth.admin.from('cierres_caja').delete().eq('id', id)
  if (error) {
    console.error('[cierres.borrar] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true })
}

function round2(n) { return Math.round(n * 100) / 100 }
