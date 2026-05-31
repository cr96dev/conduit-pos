// pages/api/fel/facturas/[id]/reimprimir.js
//
// POST /api/fel/facturas/:id/reimprimir
//   body: { motivo: string (1..200 chars) }
//
// Reimprime una factura YA CERTIFICADA. No vuelve a llamar a Digifact —
// reusa el UUID/serie/numero SAT originales. El ticket impreso lleva la
// leyenda "REIMPRESION N°X" para distinguirlo del original (regulacion SAT).
//
// Auth: admin o cajero (requireAdminOCajero). Cualquier usuario authenticated
// con perfil activo y rol valido puede disparar la reimpresion.
//
// Side-effects:
//   - INSERT en facturas_fel_reimpresiones (audit: quien, cuando, motivo,
//     origen, ip). Si el insert falla, igual devolvemos el payload — preferimos
//     reimprimir aunque perdamos el audit, vs no reimprimir.
//
// Respuesta exitosa (200):
//   {
//     ok: true,
//     factura: { ...facturas_fel row },
//     items:   [ ...facturas_fel_items rows ],
//     emisor:  { ...config_fel row },          // para armar el header del ticket
//     esReimpresion: true,
//     reimpresionNum: int,                      // contador de reimpresiones de ESTA factura
//     motivo: string,
//   }
//
// El cliente arma el TicketPayload a partir de esta respuesta y llama
// window.JuliaPOS.printTicket(payload) en el wrapper Sunmi. Si el wrapper
// no esta presente (browser desktop), el frontend puede mostrar un PDF
// generado del lado cliente como fallback.

import { requireAdminOCajero } from '../../../../../lib/auth'

const MOTIVO_MAX_LEN = 200

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { id } = req.query
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'id requerido' })
  }

  const auth = await requireAdminOCajero(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { motivo } = req.body || {}
  if (!motivo || typeof motivo !== 'string') {
    return res.status(400).json({ error: 'motivo requerido' })
  }
  const motivoTrim = motivo.trim()
  if (!motivoTrim) {
    return res.status(400).json({ error: 'motivo no puede estar vacio' })
  }
  if (motivoTrim.length > MOTIVO_MAX_LEN) {
    return res.status(400).json({ error: `motivo demasiado largo (max ${MOTIVO_MAX_LEN} chars)` })
  }

  try {
    // 1) Cargar factura — debe existir y estar CERTIFICADA.
    const { data: factura, error: errF } = await auth.admin
      .from('facturas_fel').select('*').eq('id', id).single()
    if (errF || !factura) {
      return res.status(404).json({ error: 'Factura no encontrada' })
    }
    if (factura.estado !== 'certificada') {
      return res.status(400).json({
        error: `Solo se pueden reimprimir facturas certificadas (estado actual: ${factura.estado})`,
      })
    }

    // 2) Cargar items.
    const { data: items, error: errI } = await auth.admin
      .from('facturas_fel_items').select('*').eq('factura_id', id).order('orden')
    if (errI) {
      console.error('[fel/reimprimir] error cargando items:', errI.message)
      return res.status(500).json({ error: 'Error cargando items' })
    }

    // 3) Cargar emisor (singleton).
    const { data: emisor } = await auth.admin
      .from('config_fel').select('*').limit(1).maybeSingle()

    // 4) Registrar audit. Si falla, NO bloqueamos la reimpresion — solo
    //    logueamos. El ticket ya esta saliendo y eso es mas critico.
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || null
    const origen = auth.perfil?.rol === 'cajero' ? 'cajero' : 'admin'
    const { error: errLog } = await auth.admin
      .from('facturas_fel_reimpresiones')
      .insert({
        factura_id: id,
        impreso_by: auth.perfil?.id || null,
        motivo: motivoTrim,
        origen,
        ip,
      })
    if (errLog) {
      console.error('[fel/reimprimir] audit insert fallo:', errLog.message)
      // Seguimos adelante. La reimpresion debe ocurrir.
    }

    // 5) Contar cuantas reimpresiones existen ya para esta factura. Esto sirve
    //    para mostrar "REIMPRESION N°2", "N°3", etc. en el ticket.
    const { count: reimpresionNum } = await auth.admin
      .from('facturas_fel_reimpresiones')
      .select('*', { count: 'exact', head: true })
      .eq('factura_id', id)

    return res.status(200).json({
      ok: true,
      factura,
      items: items || [],
      emisor: emisor || {},
      esReimpresion: true,
      reimpresionNum: reimpresionNum || 1,
      motivo: motivoTrim,
    })
  } catch (e) {
    console.error('[fel/reimprimir] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
