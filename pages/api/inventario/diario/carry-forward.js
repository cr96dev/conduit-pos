// pages/api/inventario/diario/carry-forward.js
// POST /api/inventario/diario/carry-forward
//   body: { fecha, store_id? }
// Para cada variante con inventario_final cargado en fecha-1, propaga ese valor
// como inventario_inicial en fecha — solo si la fila de hoy NO tiene inicial.
// No pisa finales ni notas existentes en la fila de hoy.
// Solo admin.

import { requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { fecha, store_id = '' } = req.body || {}
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return res.status(400).json({ error: 'fecha (YYYY-MM-DD) requerida' })
  }

  const [y, m, d] = fecha.split('-').map(Number)
  const ayer = new Date(Date.UTC(y, m - 1, d) - 86_400_000).toISOString().slice(0, 10)

  try {
    // 1) Finales de ayer.
    const { data: ayerData, error: ayerErr } = await auth.admin
      .from('conteos_diarios_producto')
      .select('variant_id, store_id, inventario_final')
      .eq('fecha', ayer)
      .eq('store_id', store_id)
      .not('inventario_final', 'is', null)
    if (ayerErr) throw new Error('ayer: ' + ayerErr.message)

    if (!ayerData || ayerData.length === 0) {
      return res.status(200).json({ ok: true, propagados: 0, mensaje: 'No hay conteos finales en el dia anterior.' })
    }

    // 2) Filas existentes en HOY (para no pisar inicial ya cargado ni perder final/notas).
    const { data: hoyData, error: hoyErr } = await auth.admin
      .from('conteos_diarios_producto')
      .select('id, variant_id, store_id, inventario_inicial, inventario_final, notas, created_by')
      .eq('fecha', fecha)
      .eq('store_id', store_id)
    if (hoyErr) throw new Error('hoy: ' + hoyErr.message)

    const hoyMap = {}
    for (const r of hoyData || []) hoyMap[r.variant_id] = r

    // 3) Construir upsert solo para variantes que no tienen inicial hoy.
    const upsertRows = []
    for (const r of ayerData) {
      const existente = hoyMap[r.variant_id]
      if (existente && existente.inventario_inicial != null) continue   // ya tiene inicial, no tocar

      upsertRows.push({
        fecha,
        variant_id: r.variant_id,
        store_id:   r.store_id,
        inventario_inicial: Number(r.inventario_final),
        inventario_final:   existente?.inventario_final ?? null,
        notas:              existente?.notas ?? null,
        created_by:         existente?.created_by ?? auth.user.id,
        updated_by:         auth.user.id,
      })
    }

    if (upsertRows.length === 0) {
      return res.status(200).json({ ok: true, propagados: 0, mensaje: 'Todos los productos ya tienen inicial hoy.' })
    }

    const { error: upErr } = await auth.admin
      .from('conteos_diarios_producto')
      .upsert(upsertRows, { onConflict: 'fecha,variant_id,store_id' })
    if (upErr) throw new Error('upsert: ' + upErr.message)

    return res.status(200).json({
      ok: true,
      propagados: upsertRows.length,
      fecha_origen: ayer,
    })
  } catch (e) {
    console.error('[inventario.carry-forward] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

export const config = { maxDuration: 30 }
