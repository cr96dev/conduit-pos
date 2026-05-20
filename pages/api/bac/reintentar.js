// pages/api/bac/reintentar.js
//
// Re-aplica un bac_consumos en estado 'sin_venta_destino' cuando la fila
// de ventas (o tienda_ventas) ya existe.
// Auth: requiere admin (verificado via cookie de sesión Supabase).
//
// Replica la lógica de aplicación de /api/bac/ingest sin volver a parsear PDF.

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const AUTHORIZED_EMAILS = ['adoffice569@gmail.com', 'estacionesdeservicioguatemala@gmail.com']

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method not allowed' })
  }

  // --- Auth: token bearer del usuario ---
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return res.status(401).json({ error: 'missing auth token' })
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'invalid auth token' })
  }
  const email = userData.user.email
  if (!AUTHORIZED_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const { consumo_id } = req.body || {}
  if (!consumo_id) {
    return res.status(400).json({ error: 'missing consumo_id' })
  }

  // --- Leer el consumo ---
  const { data: consumo, error: cErr } = await supabase
    .from('bac_consumos')
    .select('id, liquidacion_no, no_afiliado, fecha_remision, total_ventas, estacion_id, categoria, estado')
    .eq('id', consumo_id)
    .maybeSingle()

  if (cErr || !consumo) {
    return res.status(404).json({ error: 'consumo no encontrado' })
  }

  if (consumo.estado !== 'sin_venta_destino') {
    return res.status(400).json({
      error: `solo se pueden reintentar consumos en estado sin_venta_destino. Estado actual: ${consumo.estado}`
    })
  }

  const eid = consumo.estacion_id
  const fecha = consumo.fecha_remision
  let aplicadoATabla, aplicadoAId, valorAnterior, valorNuevo, nuevoEstado, errorMsg

  try {
    if (consumo.categoria === 'combustible') {
      const { data: ventaRow } = await supabase
        .from('ventas')
        .select('id, bac')
        .eq('estacion_id', eid)
        .eq('fecha', fecha)
        .maybeSingle()

      if (!ventaRow) {
        return res.status(200).json({
          ok: true,
          aplicado: false,
          estado: 'sin_venta_destino',
          mensaje: 'Aún no existe fila de ventas para esa estación+fecha. Pídele al gerente que cargue las ventas del día.'
        })
      }

      const { data: previos } = await supabase
        .from('bac_consumos')
        .select('total_ventas')
        .eq('estacion_id', eid)
        .eq('fecha_remision', fecha)
        .eq('categoria', 'combustible')
        .eq('estado', 'aplicado')

      const sumaPrevia = (previos || []).reduce((s, x) => s + parseFloat(x.total_ventas || 0), 0)
      valorAnterior = parseFloat(ventaRow.bac || 0)
      valorNuevo = sumaPrevia + parseFloat(consumo.total_ventas)

      const { error: upErr } = await supabase
        .from('ventas')
        .update({ bac: valorNuevo, qbo_processed: false })
        .eq('id', ventaRow.id)
      if (upErr) throw upErr

      aplicadoATabla = 'ventas'
      aplicadoAId = ventaRow.id
      nuevoEstado = 'aplicado'

    } else if (consumo.categoria === 'tienda') {
      const { data: tiendaRow } = await supabase
        .from('tienda_ventas')
        .select('id, tarjeta')
        .eq('estacion_id', eid)
        .eq('fecha', fecha)
        .maybeSingle()

      if (!tiendaRow) {
        return res.status(200).json({
          ok: true,
          aplicado: false,
          estado: 'sin_venta_destino',
          mensaje: 'Aún no existe fila de tienda_ventas para esa estación+fecha.'
        })
      }

      const { data: previos } = await supabase
        .from('bac_consumos')
        .select('total_ventas')
        .eq('estacion_id', eid)
        .eq('fecha_remision', fecha)
        .eq('categoria', 'tienda')
        .eq('estado', 'aplicado')

      const sumaPrevia = (previos || []).reduce((s, x) => s + parseFloat(x.total_ventas || 0), 0)
      valorAnterior = parseFloat(tiendaRow.tarjeta || 0)
      valorNuevo = sumaPrevia + parseFloat(consumo.total_ventas)

      const { error: upErr } = await supabase
        .from('tienda_ventas')
        .update({ tarjeta: valorNuevo })
        .eq('id', tiendaRow.id)
      if (upErr) throw upErr

      aplicadoATabla = 'tienda_ventas'
      aplicadoAId = tiendaRow.id
      nuevoEstado = 'aplicado'

    } else {
      return res.status(400).json({ error: `categoría no soportada: ${consumo.categoria}` })
    }
  } catch (e) {
    return res.status(500).json({ error: 'failed to apply', detail: e.message })
  }

  // --- Actualizar el consumo a aplicado ---
  const { error: updErr } = await supabase
    .from('bac_consumos')
    .update({
      estado: nuevoEstado,
      aplicado_a_tabla: aplicadoATabla,
      aplicado_a_id: aplicadoAId,
      valor_anterior: valorAnterior,
      valor_nuevo: valorNuevo,
      error_msg: null
    })
    .eq('id', consumo_id)

  if (updErr) {
    return res.status(500).json({ error: 'failed to update consumo', detail: updErr.message })
  }

  return res.status(200).json({
    ok: true,
    aplicado: true,
    estado: nuevoEstado,
    liquidacion_no: consumo.liquidacion_no,
    valor_anterior: valorAnterior,
    valor_nuevo: valorNuevo
  })
}
