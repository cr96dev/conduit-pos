// pages/api/neonet/reintentar.js
//
// Reintenta aplicar consumos Neonet que están en estado 'sin_venta_destino'.
// Útil cuando el gerente carga las ventas DESPUÉS de que llegó el PDF Neonet.
//
// Auth: Bearer token de sesión Supabase. Solo emails autorizados.

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const AUTHORIZED_EMAILS = [
  'adoffice569@gmail.com',
  'estacionesdeservicioguatemala@gmail.com'
]

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // ── 1. Auth ──────────────────────────────────────────────────
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return res.status(401).json({ error: 'missing bearer token' })
  }

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token)
  if (authErr || !user) {
    return res.status(401).json({ error: 'invalid token' })
  }
  if (!AUTHORIZED_EMAILS.includes(user.email)) {
    return res.status(403).json({ error: 'not authorized' })
  }

  // ── 2. Input: consumo_ids (array) o todos los sin_venta_destino ──
  const { consumo_ids } = req.body || {}

  let query = supabaseAdmin
    .from('neonet_consumos')
    .select('id, afiliacion_codigo, fecha_consumo, total_q, detalle_json, estacion_id, variante, email_message_id')
    .eq('estado', 'sin_venta_destino')

  if (Array.isArray(consumo_ids) && consumo_ids.length > 0) {
    query = query.in('id', consumo_ids)
  }

  const { data: consumos, error: errSel } = await query
  if (errSel) {
    return res.status(500).json({ error: 'failed to fetch consumos', detail: errSel.message })
  }

  if (!consumos || consumos.length === 0) {
    return res.status(200).json({ ok: true, reintentados: 0, message: 'No hay consumos para reintentar' })
  }

  // ── 3. Para cada consumo, intentar aplicar ──
  const resultados = []
  for (const c of consumos) {
    const r = await aplicarConsumo(c)
    resultados.push(r)
  }

  const exitosos = resultados.filter(r => r.aplicado).length
  const sinDestino = resultados.filter(r => !r.aplicado && r.motivo === 'sin_venta_destino').length
  const errores = resultados.filter(r => r.error).length

  return res.status(200).json({
    ok: true,
    total: consumos.length,
    aplicados: exitosos,
    sin_destino: sinDestino,
    errores,
    resultados
  })
}

async function aplicarConsumo(consumo) {
  const { id, fecha_consumo, total_q, detalle_json, estacion_id, variante } = consumo

  // Calcular montos por rubro desde detalle_json (igual que ingest.js)
  const ventas_q = parseFloat(detalle_json?.ventas_q || 0)
  const canje_q = parseFloat(detalle_json?.canje_q || 0)
  const prepago_q = parseFloat(detalle_json?.prepago_q || 0)

  const montoNeonet = variante === 'neolink' ? total_q : (ventas_q + canje_q)
  const montoPrepago = variante !== 'neolink' ? prepago_q : 0
  const columnaPrincipal = variante === 'neolink' ? 'neolink' : 'neonet'
  const aplicarPrepago = montoPrepago > 0

  // Buscar fila ventas
  const selectCols = aplicarPrepago
    ? `id, ${columnaPrincipal}, neonet_prepago`
    : `id, ${columnaPrincipal}`

  const { data: ventaRow } = await supabaseAdmin
    .from('ventas')
    .select(selectCols)
    .eq('fecha', fecha_consumo)
    .eq('estacion_id', estacion_id)
    .maybeSingle()

  if (!ventaRow) {
    return { id, aplicado: false, motivo: 'sin_venta_destino' }
  }

  const valorAnterior = parseFloat(ventaRow[columnaPrincipal] || 0)
  const valorNuevo = montoNeonet
  const diferencia = valorNuevo - valorAnterior

  const updatePayload = {
    [columnaPrincipal]: valorNuevo,
    qbo_processed: false,
    qbo_processed_prod: false
  }
  if (aplicarPrepago) {
    updatePayload.neonet_prepago = montoPrepago
  }

  const { error: errUpdate } = await supabaseAdmin
    .from('ventas')
    .update(updatePayload)
    .eq('id', ventaRow.id)

  if (errUpdate) {
    return { id, aplicado: false, error: errUpdate.message }
  }

  // Marcar consumo como aplicado
  await supabaseAdmin
    .from('neonet_consumos')
    .update({
      estado: 'aplicado',
      aplicado_a_tabla: 'ventas',
      aplicado_a_id: ventaRow.id,
      valor_anterior: valorAnterior,
      valor_nuevo: valorNuevo,
      diferencia,
      error_msg: 'Reintentado manualmente desde /admin/neonet'
    })
    .eq('id', id)

  return {
    id,
    aplicado: true,
    estacion_id,
    fecha_consumo,
    valor_anterior: valorAnterior,
    valor_nuevo: valorNuevo,
    prepago_aplicado: aplicarPrepago ? montoPrepago : null
  }
}
