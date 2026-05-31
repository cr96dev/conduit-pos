// pages/api/pos/pedidos/[id]/facturar.js
// POST /api/pos/pedidos/:id/facturar
//
// Marca el pedido como entregado y emite la factura FEL. Reusa la logica
// completa de /api/pos/ventas (validacion, certificacion Infile, descuento
// PT/insumos, asiento, comanda) mediante fetch interno — asi no duplicamos
// 250 lineas de orquestacion.
//
// Body opcional:
//   {
//     metodo_pago?: string,      // default 'pedidos_ya'
//     items?: [...],             // si el cajero ajusta items entregados (driver no llevo algo)
//     receptor?: { nit, nombre, email },  // override del receptor guardado
//     notas?: string,
//   }
//
// Flujo:
//   1. Cargar pedido. Validar estado='pendiente_entrega'.
//   2. Tomar items finales (del body si se mandaron, sino del pedido guardado).
//   3. Llamar /api/pos/ventas server-to-server con el bearer del usuario.
//   4. Si certifica OK: UPDATE pedido estado='entregado_facturado', factura_id, facturado_at.
//   5. Devolver la respuesta del endpoint de ventas + el pedido actualizado.

import { requireAdminOCajero } from '../../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdminOCajero(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id requerido' })

  // 1. Cargar pedido y validar
  const { data: pedido, error: errLoad } = await auth.admin
    .from('pedidos_pendientes').select('*').eq('id', id).maybeSingle()
  if (errLoad || !pedido) return res.status(404).json({ error: 'Pedido no encontrado' })

  if (pedido.estado === 'entregado_facturado') {
    return res.status(409).json({
      error: 'Este pedido ya fue facturado',
      factura_id: pedido.factura_id,
    })
  }
  if (pedido.estado === 'cancelado') {
    return res.status(409).json({ error: 'Este pedido esta cancelado' })
  }

  // 2. Items finales
  const itemsOverride = Array.isArray(req.body?.items) && req.body.items.length > 0
    ? req.body.items
    : null
  const itemsFinales = itemsOverride || pedido.items
  if (!Array.isArray(itemsFinales) || itemsFinales.length === 0) {
    return res.status(400).json({ error: 'El pedido no tiene items para facturar' })
  }

  // Receptor: el caller puede overridear, sino tomamos lo guardado en el pedido
  const receptorFinal = {
    nit:    req.body?.receptor?.nit    ?? pedido.receptor_nit    ?? 'CF',
    nombre: req.body?.receptor?.nombre ?? pedido.receptor_nombre ?? 'CONSUMIDOR FINAL',
    email:  req.body?.receptor?.email  ?? pedido.receptor_email  ?? null,
  }

  // Metodo de pago: default 'pedidos_ya' (el caso comun) pero el caller puede
  // mandar 'efectivo' si el cliente paga al recoger en mostrador.
  const metodoPago = req.body?.metodo_pago || 'pedidos_ya'

  const notas = req.body?.notas || pedido.notas || null

  // 3. Llamar /api/pos/ventas server-to-server reusando el bearer del usuario
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString().split(',')[0]
  const host  = req.headers.host
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`
  const tokenHeader = req.headers.authorization

  const body = {
    items: itemsFinales,
    receptor: receptorFinal,
    metodo_pago: metodoPago,
    notas,
  }

  let ventaResp, ventaJson
  try {
    ventaResp = await fetch(`${baseUrl}/api/pos/ventas`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tokenHeader ? { Authorization: tokenHeader } : {}),
      },
      body: JSON.stringify(body),
    })
    ventaJson = await ventaResp.json()
  } catch (e) {
    return res.status(502).json({ ok: false, etapa: 'fetch_ventas', error: e.message })
  }

  // Si la facturacion fallo, NO marcamos el pedido como facturado — sigue pendiente.
  // El cajero puede reintentar (mismo pedido) o cancelar.
  if (!ventaResp.ok || !ventaJson.ok) {
    return res.status(ventaResp.status || 500).json({
      ok: false,
      etapa: 'venta',
      error: ventaJson.error || 'Fallo al crear factura',
      detalle: ventaJson,
      pedido_id: id,
    })
  }

  // 4. Marcar pedido como entregado_facturado
  const facturaId = ventaJson.factura?.id || null
  const { data: pedidoActualizado, error: errUpd } = await auth.admin
    .from('pedidos_pendientes')
    .update({
      estado: 'entregado_facturado',
      factura_id: facturaId,
      cajero_que_facturo: auth.user.id,
      facturado_at: new Date().toISOString(),
      // Si se overridearon items, guardarlos para auditoria (los items finales)
      ...(itemsOverride ? { items: itemsOverride } : {}),
    })
    .eq('id', id)
    .select()
    .single()

  if (errUpd) {
    // La factura YA esta certificada y el descuento PT/asiento corrieron. No
    // podemos "revertir". Devolvemos exito parcial para que el front lo maneje.
    return res.status(207).json({
      ok: true,
      warning: 'Factura certificada OK pero fallo UPDATE del pedido: ' + errUpd.message,
      factura: ventaJson.factura,
      pedido_id: id,
    })
  }

  // 5. Respuesta exitosa con todo el contexto que el front necesita para imprimir.
  return res.status(200).json({
    ok: true,
    pedido: pedidoActualizado,
    factura: ventaJson.factura,
    descuento: ventaJson.descuento,
    asiento: ventaJson.asiento,
    comanda: ventaJson.comanda,
    neonet: ventaJson.neonet,
  })
}

export const config = { maxDuration: 60 }
