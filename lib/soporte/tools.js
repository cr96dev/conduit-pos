// lib/soporte/tools.js
//
// Catalogo de tools que el agente de soporte (Claude) puede invocar.
// Fase 1: solo read-only. Mutations llegan en Fase 2 con confirmacion.
//
// Cada tool tiene:
//   - name: identifier que Claude usa
//   - description: que hace (Claude lee esto para decidir cuando invocarla)
//   - input_schema: JSON Schema de los args
//   - permitido_para: 'todos' | 'admin'
//   - handler(args, ctx): async function que ejecuta la tool
//       ctx = { admin: SupabaseClient, perfil: row de perfiles, ip, ... }
//       devuelve { ok, data?, error? }
//
// Convenciones:
//   - Las tools nunca lanzan excepciones a Claude. Si algo falla devuelven
//     { ok: false, error: 'descripcion humana' }.
//   - Truncan resultados largos (max 5KB de JSON al volver a Claude para
//     no quemar tokens).

function truncar(obj, maxBytes = 5000) {
  const s = JSON.stringify(obj)
  if (s.length <= maxBytes) return obj
  return {
    _truncated: true,
    _original_size: s.length,
    preview: s.slice(0, maxBytes - 100) + '...',
  }
}

// =============================================================================
// 1. buscar_factura
// =============================================================================
const buscar_factura = {
  name: 'buscar_factura',
  description:
    'Busca una factura FEL por numero correlativo SAT, UUID, serie, o por monto+fecha. ' +
    'Devuelve el estado de certificacion, datos del receptor, items y mensaje de error si aplica. ' +
    'Usar cuando el cajero menciona "factura X", "ticket X", "venta X" o reporta problemas con una venta especifica.',
  input_schema: {
    type: 'object',
    properties: {
      numero_sat: { type: 'string', description: 'Numero correlativo SAT (ej. "2774486727")' },
      uuid_sat:   { type: 'string', description: 'UUID SAT completo' },
      serie_sat:  { type: 'string', description: 'Serie SAT (ej. "38E8B612")' },
      id:         { type: 'string', description: 'ID interno (UUID de facturas_fel.id)' },
      receptor_nit: { type: 'string', description: 'NIT del receptor (busca facturas emitidas a ese NIT)' },
    },
  },
  permitido_para: 'todos',
  async handler(args, ctx) {
    const { admin } = ctx
    let q = admin.from('facturas_fel').select('*').limit(5).order('fecha_emision', { ascending: false })
    let alguno = false
    if (args.id) { q = q.eq('id', args.id); alguno = true }
    if (args.uuid_sat)   { q = q.eq('uuid_sat', args.uuid_sat); alguno = true }
    if (args.numero_sat) { q = q.eq('numero_sat', args.numero_sat); alguno = true }
    if (args.serie_sat)  { q = q.eq('serie_sat', args.serie_sat); alguno = true }
    if (args.receptor_nit) { q = q.eq('receptor_nit', args.receptor_nit); alguno = true }
    if (!alguno) return { ok: false, error: 'Debe especificar al menos un criterio de busqueda' }

    const { data, error } = await q
    if (error) return { ok: false, error: error.message }
    if (!data || data.length === 0) return { ok: true, data: { facturas: [], total: 0 } }

    const facturas = data.map(f => ({
      id: f.id,
      estado: f.estado,
      serie_sat: f.serie_sat,
      numero_sat: f.numero_sat,
      uuid_sat: f.uuid_sat,
      fecha_emision: f.fecha_emision,
      fecha_certificacion: f.fecha_certificacion,
      receptor_nit: f.receptor_nit,
      receptor_nombre: f.receptor_nombre,
      total: f.total,
      error_mensaje: f.error_mensaje,
      motivo_anulacion: f.motivo_anulacion,
    }))
    return { ok: true, data: truncar({ facturas, total: facturas.length }) }
  },
}

// =============================================================================
// 2. estado_turno_actual
// =============================================================================
const estado_turno_actual = {
  name: 'estado_turno_actual',
  description:
    'Devuelve el estado del turno del cajero actualmente logueado: si esta abierto, monto de apertura, ' +
    'cantidad de ventas, totales por metodo de pago. ' +
    'Usar cuando el cajero pregunta "como va mi caja", "cuanto vendi" o reporta problemas con el cierre.',
  input_schema: { type: 'object', properties: {} },
  permitido_para: 'todos',
  async handler(args, ctx) {
    const { admin, perfil } = ctx
    if (!perfil?.id) return { ok: false, error: 'No hay perfil del usuario en contexto' }
    const esCajero = perfil.rol === 'cajero'

    // Cajero: solo su turno abierto. Admin: tambien el suyo si tiene uno.
    const { data, error } = await admin
      .from('turnos_caja').select('*')
      .eq('cajero_id', perfil.id)
      .eq('estado', 'abierto')
      .order('fecha_apertura', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) return { ok: false, error: error.message }
    if (!data) return { ok: true, data: { abierto: false, mensaje: esCajero ? 'No tiene caja abierta' : 'El usuario actual no tiene caja abierta' } }

    return {
      ok: true,
      data: {
        abierto: true,
        turno_id: data.id,
        fecha_apertura: data.fecha_apertura,
        monto_apertura: data.monto_apertura,
        ventas_efectivo: data.ventas_efectivo,
        ventas_tarjeta: data.ventas_tarjeta,
        ventas_transferencia: data.ventas_transferencia,
        ventas_pedidos_ya: data.ventas_pedidos_ya,
        ventas_otro: data.ventas_otro,
        ventas_total: data.ventas_total,
        cantidad_facturas: data.cantidad_facturas,
      },
    }
  },
}

// =============================================================================
// 3. estado_fel_infile
// =============================================================================
const estado_fel_infile = {
  name: 'estado_fel_infile',
  description:
    'Verifica si Infile (el certificador FEL) esta respondiendo. ' +
    'Util cuando el cajero reporta que ninguna factura se esta certificando, o quiere saber si el sistema esta caido.',
  input_schema: { type: 'object', properties: {} },
  permitido_para: 'todos',
  async handler(args, ctx) {
    const { admin } = ctx
    // Mira las ultimas 10 facturas: cuantas certificaron OK y cuantas estan en error
    const { data, error } = await admin
      .from('facturas_fel').select('estado, fecha_emision')
      .order('fecha_emision', { ascending: false })
      .limit(20)
    if (error) return { ok: false, error: error.message }

    const stats = { total: data.length, certificadas: 0, error: 0, borrador: 0, anuladas: 0 }
    let ultima_ok_at = null
    let ultima_error_at = null
    for (const f of data) {
      if (f.estado === 'certificada') {
        stats.certificadas++
        if (!ultima_ok_at) ultima_ok_at = f.fecha_emision
      }
      else if (f.estado === 'error')  { stats.error++; if (!ultima_error_at) ultima_error_at = f.fecha_emision }
      else if (f.estado === 'borrador') stats.borrador++
      else if (f.estado === 'anulada')  stats.anuladas++
    }
    const salud = stats.error > stats.certificadas ? 'degradado' : 'normal'
    return {
      ok: true,
      data: {
        salud,
        ultimas_20: stats,
        ultima_certificacion_ok: ultima_ok_at,
        ultima_certificacion_error: ultima_error_at,
      },
    }
  },
}

// =============================================================================
// 4. ultimos_errores_recientes
// =============================================================================
const ultimos_errores_recientes = {
  name: 'ultimos_errores_recientes',
  description:
    'Lista las ultimas facturas con estado "error" (no se pudieron certificar). ' +
    'Devuelve el mensaje de error de cada una. ' +
    'Usar cuando el cajero reporta "tickets que no salen" sin un numero especifico.',
  input_schema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: 'Cuantos errores devolver (default 5, max 20)' },
    },
  },
  permitido_para: 'todos',
  async handler(args, ctx) {
    const { admin } = ctx
    const lim = Math.min(Math.max(Number(args.limit) || 5, 1), 20)
    const { data, error } = await admin
      .from('facturas_fel').select('id, numero_sat, fecha_emision, receptor_nit, receptor_nombre, total, error_mensaje, estado')
      .eq('estado', 'error')
      .order('fecha_emision', { ascending: false })
      .limit(lim)
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: { errores: data || [], cantidad: data?.length || 0 } }
  },
}

// =============================================================================
// 5. buscar_recibo_loyverse
// =============================================================================
const buscar_recibo_loyverse = {
  name: 'buscar_recibo_loyverse',
  description:
    'Busca un recibo de Loyverse por numero. Devuelve el monto, fecha, items. ' +
    'Util cuando el cajero menciona un ticket que paso por Loyverse pero no llego a nuestro POS o no se reflejo.',
  input_schema: {
    type: 'object',
    properties: {
      receipt_number: { type: 'string', description: 'Numero del recibo Loyverse (ej. "12-1719")' },
    },
    required: ['receipt_number'],
  },
  permitido_para: 'todos',
  async handler(args, ctx) {
    const { admin } = ctx
    const { data, error } = await admin
      .from('loyverse_receipts').select('*')
      .eq('receipt_number', args.receipt_number)
      .limit(1)
      .maybeSingle()
    if (error) return { ok: false, error: error.message }
    if (!data) return { ok: true, data: { encontrado: false, mensaje: 'No se encontro ese recibo en nuestra replica de Loyverse. Puede que aun no se haya sincronizado (cron cada 15 min) o no exista.' } }
    return {
      ok: true,
      data: {
        encontrado: true,
        receipt_number: data.receipt_number,
        created_at: data.created_at,
        total_money: data.total_money,
        payments: data.payments,
        line_items_count: Array.isArray(data.line_items) ? data.line_items.length : 0,
      },
    }
  },
}

// =============================================================================
// 6. consultar_nit_rtu (lookup oficial SAT)
// =============================================================================
const consultar_nit_rtu = {
  name: 'consultar_nit_rtu',
  description:
    'Consulta el NIT en el Registro Tributario Unificado (RTU) de SAT via Infile. ' +
    'Devuelve nombre del contribuyente si existe. ' +
    'Usar cuando el cajero pregunta "el NIT X esta bien" o no encuentra un cliente.',
  input_schema: {
    type: 'object',
    properties: {
      nit: { type: 'string', description: 'NIT a consultar (sin guiones, sin la K, ej. "120302411")' },
    },
    required: ['nit'],
  },
  permitido_para: 'todos',
  async handler(args, ctx) {
    const { admin } = ctx
    const nit = String(args.nit || '').trim().toUpperCase()
    if (!nit || nit === 'CF') return { ok: true, data: { nit: 'CF', nombre: 'CONSUMIDOR FINAL', tipo: 'CF' } }

    // Reusamos el endpoint que ya existe en lib/infile/client.js
    const { data: config } = await admin.from('config_fel').select('*').limit(1).maybeSingle()
    if (!config?.infile_alias_firma) return { ok: false, error: 'config_fel sin credenciales' }

    try {
      const { consultarNit } = await import('../../lib/infile/client.js')
      const cliente = (await import('../../lib/infile/client.js')).crearCliente(config)
      const res = await cliente.consultarNit(nit)
      return { ok: true, data: res }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },
}

// =============================================================================
// 7. estado_impresora (best effort sin tocar el wrapper)
// =============================================================================
const estado_impresora = {
  name: 'estado_impresora',
  description:
    'Verifica si la impresora termica del Sunmi esta respondiendo. ' +
    'No es 100% confiable desde el servidor (la impresora es local al device), ' +
    'asi que devuelve guidance sobre que verificar en la tablet.',
  input_schema: { type: 'object', properties: {} },
  permitido_para: 'todos',
  async handler() {
    return {
      ok: true,
      data: {
        diagnostico_remoto: 'no_disponible',
        guidance: [
          'No puedo verificar el estado de la impresora desde el servidor. Sin embargo, los problemas comunes son:',
          '1. Sin papel: abrir la cubierta y verificar que el rollo este insertado correctamente y no se haya terminado.',
          '2. Cubierta mal cerrada: empujar firmemente hasta sentir el click.',
          '3. App congelada: cerrar la aplicacion Julia Bakery POS y volver a abrirla.',
          '4. Si reciente: revisar si hubo algun corte de energia en la tablet.',
        ],
      },
    }
  },
}

// =============================================================================
// WRITE TOOLS — Fase 2.
// Estas no ejecutan la accion directo. Crean una fila en
// soporte_acciones_pendientes y devuelven { ok:true, pending_action_id, resumen }.
// Claude debe entonces explicar al usuario lo que va a pasar y esperar
// confirmacion via UI (boton Confirmar).
// El metodo `accion` aca abajo es lo que se ejecuta al confirmar.
// =============================================================================

/** Helper compartido: crea la fila de pending y devuelve respuesta uniforme. */
async function crearAccionPendiente(ctx, toolName, input, resumen) {
  const { admin, perfil, conversacion_id } = ctx
  const { data, error } = await admin.from('soporte_acciones_pendientes').insert({
    conversacion_id,
    usuario_id: perfil.id,
    tool_name: toolName,
    tool_input: input,
    resumen,
    estado: 'pendiente',
  }).select('id').single()
  if (error) return { ok: false, error: 'No pude crear la accion pendiente: ' + error.message }
  return {
    ok: true,
    requires_confirmation: true,
    pending_action_id: data.id,
    resumen,
  }
}

// -----------------------------------------------------------------------------
// reimprimir_factura
// -----------------------------------------------------------------------------
const reimprimir_factura = {
  name: 'reimprimir_factura',
  description:
    'Propone reimprimir una factura certificada (genera duplicado con leyenda REIMPRESION). ' +
    'NO ejecuta inmediatamente: crea una accion pendiente que el usuario debe confirmar con un boton. ' +
    'Usar cuando el cajero pide reimprimir, dice que el cliente perdio el ticket, o que el primer print no salio bien.',
  input_schema: {
    type: 'object',
    properties: {
      factura_id: { type: 'string', description: 'UUID interno de facturas_fel (NO el numero SAT). Si no lo tiene, primero use buscar_factura.' },
      motivo:     { type: 'string', description: 'Motivo de la reimpresion en lenguaje humano (ej. "Cliente perdio el ticket")' },
    },
    required: ['factura_id', 'motivo'],
  },
  permitido_para: 'todos',
  async handler(args, ctx) {
    // Validar que la factura existe + esta certificada antes de proponer
    const { data: f, error } = await ctx.admin.from('facturas_fel')
      .select('id, estado, serie_sat, numero_sat, receptor_nombre, total').eq('id', args.factura_id).maybeSingle()
    if (error || !f) return { ok: false, error: 'Factura no encontrada' }
    if (f.estado !== 'certificada') return { ok: false, error: `La factura esta en estado "${f.estado}" — solo se pueden reimprimir las certificadas.` }
    const ref = f.serie_sat && f.numero_sat ? `${f.serie_sat}-${f.numero_sat}` : f.id.slice(0, 8)
    const resumen = `Reimprimir factura ${ref} (${f.receptor_nombre}, Q${Number(f.total).toFixed(2)}). Motivo: ${args.motivo}`
    return crearAccionPendiente(ctx, 'reimprimir_factura', args, resumen)
  },
  /** Ejecuta la accion al confirmarse. Reusa /api/fel/facturas/[id]/reimprimir. */
  async accion(args, ctx) {
    const { admin, perfil, ip } = ctx
    // Llamamos al handler del endpoint directamente para no tener doble auth via Bearer.
    // El endpoint chequea requireAdminOCajero, pero aca ya validamos arriba.
    const url = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://julia-bakery.vercel.app'}/api/fel/facturas/${args.factura_id}/reimprimir`
    // Necesitamos un session token del usuario para llamar al endpoint. En Fase 2
    // hacemos UPSERT directo a soporte_acciones_pendientes desde el endpoint
    // confirmar, que ya tiene la sesion del usuario.
    return { ok: false, error: '[accion] debe ejecutarse desde /api/soporte/acciones/[id]/confirmar (que tiene la sesion)' }
  },
}

// -----------------------------------------------------------------------------
// reintentar_certificar
// -----------------------------------------------------------------------------
const reintentar_certificar = {
  name: 'reintentar_certificar',
  description:
    'Propone reintentar la certificacion de una factura en estado "error" o "borrador". ' +
    'Util cuando una factura quedo sin certificar por un error transitorio (red, validacion temporal, etc.). ' +
    'NO ejecuta inmediatamente: requiere confirmacion del usuario.',
  input_schema: {
    type: 'object',
    properties: {
      factura_id: { type: 'string', description: 'UUID interno de facturas_fel' },
    },
    required: ['factura_id'],
  },
  permitido_para: 'todos',
  async handler(args, ctx) {
    const { data: f, error } = await ctx.admin.from('facturas_fel')
      .select('id, estado, error_mensaje, receptor_nombre, total').eq('id', args.factura_id).maybeSingle()
    if (error || !f) return { ok: false, error: 'Factura no encontrada' }
    if (!['error', 'borrador'].includes(f.estado)) {
      return { ok: false, error: `La factura esta en estado "${f.estado}". Solo se pueden reintentar las que estan en "error" o "borrador".` }
    }
    const resumen = `Reintentar certificar factura interna ${f.id.slice(0,8)} (${f.receptor_nombre}, Q${Number(f.total).toFixed(2)}). Error previo: ${f.error_mensaje || '(sin detalle)'}`
    return crearAccionPendiente(ctx, 'reintentar_certificar', args, resumen)
  },
}

// -----------------------------------------------------------------------------
// actualizar_correo_receptor
// -----------------------------------------------------------------------------
const actualizar_correo_receptor = {
  name: 'actualizar_correo_receptor',
  description:
    'Propone actualizar el email del receptor de una factura ya emitida. ' +
    'Util cuando el cliente pide reenviar la factura a otro email o el cajero tipeo mal. ' +
    'NO modifica el XML certificado (eso es inmutable ante SAT), solo el campo local para usos futuros (reenvio).',
  input_schema: {
    type: 'object',
    properties: {
      factura_id:   { type: 'string', description: 'UUID interno de facturas_fel' },
      nuevo_email:  { type: 'string', description: 'Email nuevo del receptor' },
    },
    required: ['factura_id', 'nuevo_email'],
  },
  permitido_para: 'todos',
  async handler(args, ctx) {
    const email = String(args.nuevo_email || '').trim()
    if (!email || !email.includes('@')) return { ok: false, error: 'Email invalido' }
    const { data: f, error } = await ctx.admin.from('facturas_fel')
      .select('id, receptor_email, receptor_nombre').eq('id', args.factura_id).maybeSingle()
    if (error || !f) return { ok: false, error: 'Factura no encontrada' }
    const resumen = `Cambiar email del receptor de "${f.receptor_email || '(sin email)'}" a "${email}" en la factura de ${f.receptor_nombre}.`
    return crearAccionPendiente(ctx, 'actualizar_correo_receptor', args, resumen)
  },
}

// -----------------------------------------------------------------------------
// anular_factura (solo admin)
// -----------------------------------------------------------------------------
const anular_factura = {
  name: 'anular_factura',
  description:
    'Propone anular una factura certificada ante SAT. ACCION IRREVERSIBLE. ' +
    'Solo disponible para administradores. Requiere motivo. ' +
    'NO ejecuta inmediatamente: requiere confirmacion explicita.',
  input_schema: {
    type: 'object',
    properties: {
      factura_id: { type: 'string', description: 'UUID interno de facturas_fel' },
      motivo:     { type: 'string', description: 'Motivo de la anulacion (obligatorio, queda registrado)' },
    },
    required: ['factura_id', 'motivo'],
  },
  permitido_para: 'admin',
  async handler(args, ctx) {
    const { data: f, error } = await ctx.admin.from('facturas_fel')
      .select('id, estado, serie_sat, numero_sat, receptor_nombre, total').eq('id', args.factura_id).maybeSingle()
    if (error || !f) return { ok: false, error: 'Factura no encontrada' }
    if (f.estado !== 'certificada') return { ok: false, error: `Solo se pueden anular facturas certificadas. Esta esta en "${f.estado}".` }
    const ref = f.serie_sat && f.numero_sat ? `${f.serie_sat}-${f.numero_sat}` : f.id.slice(0, 8)
    const resumen = `ANULAR factura ${ref} (${f.receptor_nombre}, Q${Number(f.total).toFixed(2)}) ante SAT. Motivo: ${args.motivo}. Esta accion es IRREVERSIBLE.`
    return crearAccionPendiente(ctx, 'anular_factura', args, resumen)
  },
}

// =============================================================================
// Export catalog
// =============================================================================

export const TOOLS = [
  // Read tools (Fase 1)
  buscar_factura,
  estado_turno_actual,
  estado_fel_infile,
  ultimos_errores_recientes,
  buscar_recibo_loyverse,
  consultar_nit_rtu,
  estado_impresora,
  // Write tools (Fase 2) — todas crean pending y esperan confirmacion
  reimprimir_factura,
  reintentar_certificar,
  actualizar_correo_receptor,
  anular_factura,
]

/** Convierte el catalog a la forma que espera la API de Anthropic. */
export function toolsParaAnthropic() {
  return TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))
}

/** Busca una tool por nombre. Devuelve null si no existe. */
export function obtenerTool(name) {
  return TOOLS.find(t => t.name === name) || null
}

/** Chequea si una tool esta permitida para el rol del perfil. */
export function permitida(tool, perfil) {
  if (!tool) return false
  if (tool.permitido_para === 'todos') return true
  if (tool.permitido_para === 'admin') return perfil?.rol === 'admin'
  return false
}
