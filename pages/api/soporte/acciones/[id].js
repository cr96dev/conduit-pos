// pages/api/soporte/acciones/[id].js
// POST /api/soporte/acciones/:id    body: { decision: 'confirmar' | 'rechazar' }
//
// Cuando Claude propone una accion de escritura (reimprimir, reintentar
// certificar, anular, etc.), queda en soporte_acciones_pendientes con
// estado='pendiente'. La UI del soporte muestra dos botones bajo el mensaje
// del agente. Este endpoint atiende esos botones.
//
// Flujo:
//   1. Validar que la accion existe, esta en 'pendiente', no expiro y
//      pertenece al usuario actual (o admin).
//   2. Si decision='rechazar' -> estado='rechazada', resolved_at=now, salir.
//   3. Si decision='confirmar' -> ejecutar la accion real (delegando al
//      endpoint que ya existe — reimprimir, anular, etc.). Marcar
//      'confirmada' si OK, 'error' si fallo. Persistir resultado.
//   4. Insertar mensaje 'assistant' en soporte_mensajes con el resumen del
//      resultado (la UI lo va a renderizar como un mensaje mas).
//   5. Devolver el mensaje nuevo + estado actualizado.
//
// Auth: requireAuth. La policy RLS asegura que solo el dueno (o admin) puede.

import { requireAuth } from '../../../../lib/auth'
import { obtenerTool } from '../../../../lib/soporte/tools'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id requerido' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { decision } = req.body || {}
  if (!['confirmar', 'rechazar'].includes(decision)) {
    return res.status(400).json({ error: 'decision debe ser "confirmar" o "rechazar"' })
  }

  // 1. Cargar la pending y validar
  const { data: pa, error: errLoad } = await auth.admin
    .from('soporte_acciones_pendientes').select('*').eq('id', id).maybeSingle()
  if (errLoad || !pa) return res.status(404).json({ error: 'Accion no encontrada' })

  // Solo el dueno o admin
  if (pa.usuario_id !== auth.user.id && auth.perfil.rol !== 'admin') {
    return res.status(403).json({ error: 'No autorizado para esta accion' })
  }
  if (pa.estado !== 'pendiente') {
    return res.status(409).json({ error: `La accion ya esta en estado "${pa.estado}", no se puede modificar.` })
  }
  if (new Date(pa.expires_at) < new Date()) {
    await auth.admin.from('soporte_acciones_pendientes').update({
      estado: 'expirada', resolved_at: new Date().toISOString(),
    }).eq('id', id)
    return res.status(410).json({ error: 'La accion expiro (5 min sin confirmar). Por favor reformule la consulta.' })
  }

  // 2. Si rechaza, marcar y devolver
  if (decision === 'rechazar') {
    await auth.admin.from('soporte_acciones_pendientes').update({
      estado: 'rechazada', resolved_at: new Date().toISOString(),
    }).eq('id', id)
    // Mensaje breve para que aparezca en el chat
    const { data: msg } = await auth.admin.from('soporte_mensajes').insert({
      conversacion_id: pa.conversacion_id,
      rol: 'assistant',
      contenido: 'Entendido, no realizare esa accion. ¿En que mas puedo asistirle?',
    }).select().single()
    return res.status(200).json({
      ok: true,
      estado: 'rechazada',
      mensaje: msg ? { rol: 'assistant', contenido: msg.contenido, created_at: msg.created_at } : null,
    })
  }

  // 3. Confirmar: ejecutar accion real segun tool_name
  const t0 = Date.now()
  let resultado
  try {
    resultado = await ejecutarAccion(pa, auth, req)
  } catch (e) {
    resultado = { ok: false, error: 'Excepcion: ' + (e.message || String(e)) }
  }
  const duracion = Date.now() - t0

  // 4. Persistir el resultado y nuevo estado
  await auth.admin.from('soporte_acciones_pendientes').update({
    estado: resultado.ok ? 'confirmada' : 'error',
    resultado: resultado || {},
    error_mensaje: resultado.ok ? null : (resultado.error || null),
    resolved_at: new Date().toISOString(),
  }).eq('id', id)

  // Audit en soporte_tool_calls (mismo que Fase 1 — uniformidad)
  try {
    await auth.admin.from('soporte_tool_calls').insert({
      conversacion_id: pa.conversacion_id,
      usuario_id: auth.user.id,
      tool_name: pa.tool_name + ':accion',  // sufijo para distinguir de la fase de propuesta
      tool_input: pa.tool_input || {},
      tool_output: resultado || {},
      ok: !!resultado.ok,
      error_mensaje: resultado.ok ? null : (resultado.error || null),
      duracion_ms: duracion,
      ip: (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || null,
    })
  } catch (e) { console.error('[soporte/acciones] audit fallo:', e.message) }

  // 5. Insertar mensaje assistant con el resumen del resultado
  const contenido = resultado.ok
    ? construirMensajeExito(pa.tool_name, pa.resumen, resultado)
    : `No pude completar la accion. ${resultado.error || 'Detalle no disponible.'} ¿Desea que intente otra cosa o lo escalo al administrador?`

  const { data: msg } = await auth.admin.from('soporte_mensajes').insert({
    conversacion_id: pa.conversacion_id,
    rol: 'assistant',
    contenido,
  }).select().single()

  return res.status(200).json({
    ok: resultado.ok,
    estado: resultado.ok ? 'confirmada' : 'error',
    resultado,
    mensaje: msg ? { rol: 'assistant', contenido: msg.contenido, created_at: msg.created_at } : null,
  })
}

// ---------- ejecutar accion real segun tool ----------

async function ejecutarAccion(pa, auth, req) {
  const { tool_name, tool_input } = pa

  switch (tool_name) {
    case 'reimprimir_factura':
      return await accionReimprimir(tool_input, auth)
    case 'reintentar_certificar':
      return await accionReintentarCert(tool_input, auth, req)
    case 'actualizar_correo_receptor':
      return await accionActualizarCorreo(tool_input, auth)
    case 'anular_factura':
      return await accionAnularFactura(tool_input, auth)
    default:
      return { ok: false, error: `Tool "${tool_name}" no tiene accion implementada` }
  }
}

async function accionReimprimir({ factura_id, motivo }, auth) {
  const { data: factura, error: errF } = await auth.admin
    .from('facturas_fel').select('*').eq('id', factura_id).single()
  if (errF || !factura) return { ok: false, error: 'Factura no encontrada' }
  if (factura.estado !== 'certificada') return { ok: false, error: `Estado ${factura.estado} — solo certificadas` }

  const { data: items } = await auth.admin
    .from('facturas_fel_items').select('*').eq('factura_id', factura_id).order('orden')

  // Cargar emisor para armar el ticket
  const { data: emisor } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()

  // Audit row
  await auth.admin.from('facturas_fel_reimpresiones').insert({
    factura_id,
    impreso_by: auth.perfil?.id || null,
    motivo,
    origen: 'soporte',  // marcamos que vino del bot
    ip: '127.0.0.1',
  })

  const { count: reimpresionNum } = await auth.admin
    .from('facturas_fel_reimpresiones').select('*', { count: 'exact', head: true }).eq('factura_id', factura_id)

  // Devolvemos el payload completo. La UI lo usa para llamar
  // window.JuliaPOS.printTicket() en el cliente y disparar el print fisico.
  return {
    ok: true,
    factura_id,
    reimpresion_num: reimpresionNum || 1,
    factura,
    items: items || [],
    emisor: emisor || {},
    esReimpresion: true,
    reimpresionNum: reimpresionNum || 1,
  }
}

async function accionReintentarCert({ factura_id }, auth, req) {
  // Re-fetch al endpoint que ya hace toda la logica de Infile firma + cert.
  // No podemos invocar requireAdmin internamente facil, asi que hacemos
  // fetch HTTP con el Authorization header del usuario actual.
  const tokenHeader = req.headers.authorization
  const base = process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers.host || 'julia-bakery.vercel.app'}`
  const r = await fetch(`${base}/api/fel/facturas/${factura_id}/certificar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tokenHeader ? { Authorization: tokenHeader } : {}) },
    body: JSON.stringify({}),
  })
  const json = await r.json()
  if (!r.ok || !json.ok) {
    return { ok: false, error: json.error || `HTTP ${r.status}` }
  }
  return {
    ok: true,
    factura_id,
    uuid_sat: json.factura?.uuid_sat,
    serie_sat: json.factura?.serie_sat,
    numero_sat: json.factura?.numero_sat,
  }
}

async function accionActualizarCorreo({ factura_id, nuevo_email }, auth) {
  const email = String(nuevo_email).trim()
  const { error } = await auth.admin.from('facturas_fel')
    .update({ receptor_email: email, updated_at: new Date().toISOString() }).eq('id', factura_id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, factura_id, receptor_email: email }
}

async function accionAnularFactura({ factura_id, motivo }, auth) {
  // Solo admin (la validacion ya pasa por permitida() pero defense in depth)
  if (auth.perfil?.rol !== 'admin') return { ok: false, error: 'Solo administradores pueden anular' }
  const tokenHeader = '' // accion HTTP con admin auth — el endpoint usa requireAdmin
  // Inline minimal: marcar como anulada localmente. El endpoint real
  // /api/fel/facturas/[id]/anular llama a Infile para la anulacion SAT.
  // Por seguridad delegamos al endpoint en lugar de marcar local — pero
  // requiere el Bearer del admin. Usamos fetch con el header de la request.
  return { ok: false, error: 'La anulacion debe ejecutarse desde /facturacion (boton Anular). El bot todavia no la ejecuta directo en Fase 2 — necesita propagacion completa de auth.' }
}

// ---------- helper: mensaje del assistant tras exito ----------

function construirMensajeExito(tool_name, resumen, resultado) {
  switch (tool_name) {
    case 'reimprimir_factura':
      return `Listo. Marque la factura como reimpresion N°${resultado.reimpresion_num} y el ticket se esta imprimiendo en la termica del Sunmi. Si no sale por algun motivo, abra la factura desde /facturacion (admin) y toque "Reimprimir" alli.`
    case 'reintentar_certificar':
      return `Listo. La factura se certifico correctamente. UUID SAT: ${resultado.uuid_sat}, serie ${resultado.serie_sat}, numero ${resultado.numero_sat}.`
    case 'actualizar_correo_receptor':
      return `Listo. Actualice el email del receptor a ${resultado.receptor_email}. Para reenviar la factura, hagalo desde /facturacion.`
    default:
      return `Accion completada: ${resumen}`
  }
}
