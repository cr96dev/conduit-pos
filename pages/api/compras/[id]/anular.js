// pages/api/compras/[id]/anular.js
// POST /api/compras/:id/anular  -> anula compra (admin)
// Body: { motivo: string }
//
// Si la compra estaba 'recibida', revierte los movimientos generando ajustes
// negativos referenciados a la compra.

import { requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  const { motivo } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id requerido' })
  if (!motivo?.trim()) return res.status(400).json({ error: 'motivo requerido' })

  const { data: compra, error: gErr } = await auth.admin
    .from('compras').select('id, estado, numero_factura').eq('id', id).single()
  if (gErr || !compra) return res.status(404).json({ error: 'Compra no encontrada' })
  if (compra.estado === 'anulada') return res.status(400).json({ error: 'Ya esta anulada' })

  const estadoPrevio = compra.estado
  const erroresReversion = []

  // Si estaba recibida, generar ajustes negativos por cada movimiento de entrada.
  if (estadoPrevio === 'recibida') {
    const { data: movs } = await auth.admin
      .from('insumos_movimientos')
      .select('id, insumo_id, delta')
      .filter('referencia->>compra_id', 'eq', id)
      .eq('tipo', 'entrada')

    for (const m of movs || []) {
      const { data: insumo } = await auth.admin
        .from('insumos').select('stock_actual').eq('id', m.insumo_id).single()
      if (!insumo) continue

      const stockAntes = Number(insumo.stock_actual) || 0
      const reversa = -Number(m.delta)
      const stockDespues = stockAntes + reversa

      const { error: mErr } = await auth.admin
        .from('insumos_movimientos')
        .insert({
          insumo_id: m.insumo_id,
          tipo: 'ajuste',
          delta: reversa,
          stock_antes: stockAntes,
          stock_despues: stockDespues,
          motivo: `Anulacion compra ${compra.numero_factura || id.slice(0, 8)}: ${motivo.trim()}`,
          referencia: { compra_id: id, compra_anulada: true, mov_original_id: m.id },
          created_by: auth.user.id,
        })
      if (mErr) erroresReversion.push(mErr.message)
    }
  }

  const { error: uErr } = await auth.admin
    .from('compras')
    .update({
      estado: 'anulada',
      anulada_at: new Date().toISOString(),
      anulada_by: auth.user.id,
      anulada_motivo: motivo.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (uErr) {
    console.error('[compras.anular] ERROR:', uErr.message)
    return res.status(500).json({ ok: false, error: uErr.message })
  }

  return res.status(200).json({
    ok: true,
    estado_previo: estadoPrevio,
    errores_reversion: erroresReversion.length > 0 ? erroresReversion : undefined,
  })
}
