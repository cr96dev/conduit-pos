// lib/mcp/writeTools.js
//
// Tools de ESCRITURA del plugin Claude Cowork v0.3.
//
// Convenciones de seguridad:
//   - Todo tool recibe `dry_run` (default true) y `confirmar` (default false).
//   - Si dry_run=true → devuelve preview de qué haría sin tocar la DB.
//   - Si dry_run=false → require confirmar=true. Si confirmar=false → rechaza.
//   - Todas las llamadas (preview, ejecutado, rechazado, fallido) se registran
//     en mcp_audit_log de forma inmutable.
//   - Anulacion de factura adicional: require admin_code que matchea
//     MCP_ADMIN_CONFIRM_CODE en env.
//   - Compras > Q5,000: bandera flag_alto_monto + require confirmar_alto_monto.

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const UMBRAL_COMPRA_ALTA = 5000  // GTQ

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

async function auditLog(toolName, args, estado, result, extras = {}) {
  // Inmutable. Nunca tira si falla — solo loguea a console.
  try {
    await supabase.from('mcp_audit_log').insert({
      tool_name: toolName,
      arguments: args,
      dry_run: args?.dry_run ?? true,
      estado,
      result,
      error: result?.error || extras.error || null,
      filas_afectadas: extras.filas_afectadas ?? null,
      id_creado: extras.id_creado ?? null,
      tabla_afectada: extras.tabla_afectada ?? null,
      notas: extras.notas ?? null,
    })
  } catch (e) {
    console.error('[mcp_audit_log] failed to insert audit row:', e.message)
  }
}

function rechazoSinConfirmar(toolName, args) {
  const out = {
    ok: false,
    rechazado: true,
    error: 'Para ejecutar realmente, llamá con dry_run=false Y confirmar=true. Por defecto las write tools devuelven preview.',
    sugerencia: `Reintentá: ${toolName}({...mismos argumentos, dry_run: false, confirmar: true})`,
  }
  auditLog(toolName, args, 'rechazado', out)
  return out
}

function round2(n) { return Math.round(Number(n || 0) * 100) / 100 }

function hashMovimiento(cuentaId, fecha, descripcion, debito, credito, referencia) {
  const raw = `${cuentaId}|${fecha}|${descripcion}|${round2(debito)}|${round2(credito)}|${referencia || ''}`
  return createHash('sha256').update(raw).digest('hex')
}

// ════════════════════════════════════════════════════════════════════════════
// Definiciones de tools (JSON Schema)
// ════════════════════════════════════════════════════════════════════════════

export const WRITE_TOOLS = [
  {
    name: 'julia_bancos_importar_extracto',
    description: 'Importa un lote de movimientos bancarios al extracto de Julia Bakery. Por defecto modo dry-run (solo preview, no escribe). Para escribir realmente: dry_run=false + confirmar=true. Idempotente — re-importar el mismo movimiento no lo duplica.',
    inputSchema: {
      type: 'object',
      properties: {
        cuenta_id: { type: 'string', description: 'UUID de bancos_cuentas' },
        movimientos: {
          type: 'array',
          description: 'Lista de movimientos parseados del extracto',
          items: {
            type: 'object',
            properties: {
              fecha: { type: 'string', description: 'YYYY-MM-DD' },
              descripcion: { type: 'string' },
              debito: { type: 'number', description: 'Salida (banco carga). 0 si es crédito.' },
              credito: { type: 'number', description: 'Entrada (banco abona). 0 si es débito.' },
              referencia: { type: 'string', description: 'Opcional: numero operacion, cheque, etc.' },
              saldo: { type: 'number', description: 'Opcional: saldo segun banco' },
            },
            required: ['fecha', 'descripcion'],
          },
        },
        dry_run: { type: 'boolean', default: true, description: 'true = preview, false = ejecutar' },
        confirmar: { type: 'boolean', default: false, description: 'Debe ser true para ejecutar cuando dry_run=false' },
      },
      required: ['cuenta_id', 'movimientos'],
    },
  },
  {
    name: 'julia_bancos_conciliar',
    description: 'Vincula un movimiento bancario con un asiento contable (lo concilia). Si el asiento todavía no existe, crearlo primero con julia_asiento_crear. dry_run=true por default.',
    inputSchema: {
      type: 'object',
      properties: {
        movimiento_id: { type: 'string', description: 'UUID de bancos_movimientos' },
        asiento_id: { type: 'string', description: 'UUID de asientos' },
        notas: { type: 'string', description: 'Razón de la conciliacion (auditable)' },
        dry_run: { type: 'boolean', default: true },
        confirmar: { type: 'boolean', default: false },
      },
      required: ['movimiento_id', 'asiento_id'],
    },
  },
  {
    name: 'julia_asiento_crear',
    description: 'Crea un asiento contable con sus partidas. Valida que debe=haber. dry_run=true por default. Por seguridad lo crea en estado borrador — vos lo posteás manualmente desde /asientos cuando lo revises.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'YYYY-MM-DD' },
        descripcion: { type: 'string' },
        partidas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              cuenta_codigo: { type: 'string', description: 'Codigo del plan de cuentas (ej "1-01-01")' },
              cuenta_id: { type: 'string', description: 'Alternativa: UUID' },
              concepto: { type: 'string' },
              debe: { type: 'number', default: 0 },
              haber: { type: 'number', default: 0 },
            },
          },
          minItems: 2,
        },
        origen_tipo: {
          type: 'string',
          enum: ['manual', 'compra', 'cierre_caja', 'conciliacion_banco', 'ajuste'],
          default: 'manual',
        },
        origen_id: { type: 'string', description: 'UUID del registro origen si aplica' },
        notas: { type: 'string' },
        dry_run: { type: 'boolean', default: true },
        confirmar: { type: 'boolean', default: false },
      },
      required: ['fecha', 'descripcion', 'partidas'],
    },
  },
  {
    name: 'julia_bancos_regla_crear',
    description: 'Crea una regla de auto-conciliacion: cuando un movimiento bancario contiene cierto patrón en la descripción, sugerir cierta cuenta contable. Claude aprende de tus correcciones manuales.',
    inputSchema: {
      type: 'object',
      properties: {
        patron: { type: 'string', description: 'Texto que matchea (case-insensitive)' },
        cuenta_contable_id: { type: 'string', description: 'UUID de cuentas_contables' },
        cuenta_codigo: { type: 'string', description: 'Alternativa: codigo de cuenta' },
        descripcion: { type: 'string', description: 'Que hace esta regla' },
        prioridad: { type: 'number', default: 50 },
        dry_run: { type: 'boolean', default: true },
        confirmar: { type: 'boolean', default: false },
      },
      required: ['patron'],
    },
  },
  {
    name: 'julia_compra_registrar',
    description: 'Registra una compra de insumos a proveedor: crea movimientos de inventario y opcionalmente un asiento contable. Compras > Q5,000 requieren confirmar_alto_monto=true adicional.',
    inputSchema: {
      type: 'object',
      properties: {
        proveedor: { type: 'string' },
        nit_proveedor: { type: 'string' },
        fecha: { type: 'string', description: 'YYYY-MM-DD' },
        factura_proveedor: { type: 'string', description: 'Numero de factura del proveedor' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              insumo_id: { type: 'string', description: 'UUID del insumo existente' },
              insumo_nombre: { type: 'string', description: 'Alternativa: nombre para busqueda fuzzy' },
              cantidad: { type: 'number' },
              costo_unitario: { type: 'number' },
              subtotal: { type: 'number' },
            },
            required: ['cantidad'],
          },
          minItems: 1,
        },
        total: { type: 'number' },
        iva_incluido: { type: 'boolean', default: true },
        metodo_pago: { type: 'string', enum: ['efectivo', 'transferencia', 'cheque', 'tarjeta', 'credito'], default: 'transferencia' },
        notas: { type: 'string' },
        dry_run: { type: 'boolean', default: true },
        confirmar: { type: 'boolean', default: false },
        confirmar_alto_monto: { type: 'boolean', default: false, description: 'Required if total > Q5,000' },
      },
      required: ['proveedor', 'fecha', 'items', 'total'],
    },
  },
  {
    name: 'julia_factura_anular',
    description: 'Anula una factura FEL ya certificada. ATENCIÓN: esto NO desemite el DTE en Infile/SAT — solo la marca como anulada en Julia Bakery. Requiere admin_code que matchea MCP_ADMIN_CONFIRM_CODE.',
    inputSchema: {
      type: 'object',
      properties: {
        factura_id: { type: 'string', description: 'UUID de facturas_fel' },
        motivo: { type: 'string', description: 'Razón obligatoria de la anulación' },
        admin_code: { type: 'string', description: 'Código secreto del admin (MCP_ADMIN_CONFIRM_CODE)' },
        dry_run: { type: 'boolean', default: true },
        confirmar: { type: 'boolean', default: false },
      },
      required: ['factura_id', 'motivo', 'admin_code'],
    },
  },
]

// ════════════════════════════════════════════════════════════════════════════
// Dispatcher
// ════════════════════════════════════════════════════════════════════════════

export async function ejecutarWriteTool(nombre, args) {
  switch (nombre) {
    case 'julia_bancos_importar_extracto':
      return await importarExtracto(args)
    case 'julia_bancos_conciliar':
      return await conciliarMovimiento(args)
    case 'julia_asiento_crear':
      return await asientoCrear(args)
    case 'julia_bancos_regla_crear':
      return await reglaCrear(args)
    case 'julia_compra_registrar':
      return await compraRegistrar(args)
    case 'julia_factura_anular':
      return await facturaAnular(args)
    default:
      return null  // signal que no es write tool
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Implementaciones
// ════════════════════════════════════════════════════════════════════════════

async function importarExtracto(args) {
  const { cuenta_id, movimientos, dry_run = true, confirmar = false } = args
  if (!cuenta_id) return { ok: false, error: 'cuenta_id requerido' }
  if (!Array.isArray(movimientos) || movimientos.length === 0) {
    return { ok: false, error: 'movimientos[] requerido' }
  }

  // Verificar cuenta
  const { data: cuenta, error: ecCta } = await supabase
    .from('bancos_cuentas')
    .select('id, banco, alias, activo')
    .eq('id', cuenta_id)
    .maybeSingle()
  if (ecCta) return { ok: false, error: ecCta.message }
  if (!cuenta) return { ok: false, error: `Cuenta ${cuenta_id} no existe` }
  if (!cuenta.activo) return { ok: false, error: 'Cuenta inactiva' }

  // Preparar filas + detectar duplicados via hash
  const filasPreview = []
  const erroresValidacion = []
  for (const [i, m] of movimientos.entries()) {
    if (!m.fecha || !/^\d{4}-\d{2}-\d{2}$/.test(m.fecha)) {
      erroresValidacion.push(`fila ${i + 1}: fecha invalida`)
      continue
    }
    if (!m.descripcion?.trim()) {
      erroresValidacion.push(`fila ${i + 1}: descripcion requerida`)
      continue
    }
    const debito = round2(m.debito)
    const credito = round2(m.credito)
    if (debito === 0 && credito === 0) {
      erroresValidacion.push(`fila ${i + 1}: debito o credito > 0`)
      continue
    }
    if (debito > 0 && credito > 0) {
      erroresValidacion.push(`fila ${i + 1}: solo debito o credito, no ambos`)
      continue
    }
    filasPreview.push({
      cuenta_id,
      fecha: m.fecha,
      descripcion: m.descripcion.trim(),
      referencia: m.referencia || null,
      debito,
      credito,
      saldo: m.saldo != null ? round2(m.saldo) : null,
      hash_import: hashMovimiento(cuenta_id, m.fecha, m.descripcion.trim(), debito, credito, m.referencia),
      raw: m,
    })
  }

  if (erroresValidacion.length) {
    const out = { ok: false, error: 'Errores de validación', detalles: erroresValidacion }
    auditLog('julia_bancos_importar_extracto', args, 'rechazado', out)
    return out
  }

  // Detectar duplicados via hash_import contra DB existente
  const hashes = filasPreview.map(f => f.hash_import)
  const { data: existentes } = await supabase
    .from('bancos_movimientos')
    .select('hash_import')
    .in('hash_import', hashes)
  const existSet = new Set((existentes || []).map(e => e.hash_import))
  const filasNuevas = filasPreview.filter(f => !existSet.has(f.hash_import))
  const duplicados = filasPreview.length - filasNuevas.length

  const preview = {
    ok: true,
    cuenta: { id: cuenta.id, banco: cuenta.banco, alias: cuenta.alias },
    total_recibido: filasPreview.length,
    nuevos: filasNuevas.length,
    duplicados_ignorados: duplicados,
    total_debito: round2(filasNuevas.reduce((s, f) => s + f.debito, 0)),
    total_credito: round2(filasNuevas.reduce((s, f) => s + f.credito, 0)),
    rango_fechas: filasNuevas.length ? {
      desde: filasNuevas.map(f => f.fecha).sort()[0],
      hasta: filasNuevas.map(f => f.fecha).sort().slice(-1)[0],
    } : null,
    muestra_primeras_3: filasNuevas.slice(0, 3).map(f => ({
      fecha: f.fecha, descripcion: f.descripcion,
      debito: f.debito, credito: f.credito,
    })),
  }

  if (dry_run) {
    auditLog('julia_bancos_importar_extracto', args, 'preview', preview, {
      filas_afectadas: filasNuevas.length,
    })
    return { ...preview, dry_run: true, mensaje: 'Preview — para ejecutar: dry_run=false + confirmar=true' }
  }

  if (!confirmar) {
    return rechazoSinConfirmar('julia_bancos_importar_extracto', args)
  }

  // Ejecutar insert
  if (filasNuevas.length === 0) {
    const out = { ...preview, dry_run: false, mensaje: 'Nada nuevo para importar (todos duplicados).' }
    auditLog('julia_bancos_importar_extracto', args, 'ejecutado', out, { filas_afectadas: 0 })
    return out
  }

  const { data: inserted, error: insErr } = await supabase
    .from('bancos_movimientos')
    .insert(filasNuevas.map(f => ({
      cuenta_id: f.cuenta_id,
      fecha: f.fecha,
      descripcion: f.descripcion,
      referencia: f.referencia,
      debito: f.debito,
      credito: f.credito,
      saldo: f.saldo,
      hash_import: f.hash_import,
      raw: f.raw,
    })))
    .select('id')

  if (insErr) {
    const out = { ok: false, error: insErr.message }
    auditLog('julia_bancos_importar_extracto', args, 'fallido', out, { error: insErr.message })
    return out
  }

  const out = {
    ...preview,
    dry_run: false,
    importados: inserted?.length || 0,
    ids_creados: inserted?.map(i => i.id) || [],
    mensaje: `✓ Importados ${inserted?.length} movimientos. ${duplicados} duplicados ignorados.`,
  }
  auditLog('julia_bancos_importar_extracto', args, 'ejecutado', { ok: true, importados: inserted?.length }, {
    filas_afectadas: inserted?.length,
    tabla_afectada: 'bancos_movimientos',
  })
  return out
}

async function conciliarMovimiento(args) {
  const { movimiento_id, asiento_id, notas, dry_run = true, confirmar = false } = args
  if (!movimiento_id) return { ok: false, error: 'movimiento_id requerido' }
  if (!asiento_id) return { ok: false, error: 'asiento_id requerido' }

  const { data: mov, error: emErr } = await supabase
    .from('bancos_movimientos')
    .select('id, fecha, descripcion, debito, credito, asiento_id, bancos_cuentas ( alias )')
    .eq('id', movimiento_id)
    .maybeSingle()
  if (emErr) return { ok: false, error: emErr.message }
  if (!mov) return { ok: false, error: 'movimiento no existe' }
  if (mov.asiento_id) {
    return { ok: false, error: `movimiento ya conciliado con asiento ${mov.asiento_id}` }
  }

  const { data: as, error: easErr } = await supabase
    .from('asientos')
    .select('id, numero, fecha, descripcion, total_debe, total_haber, estado')
    .eq('id', asiento_id)
    .maybeSingle()
  if (easErr) return { ok: false, error: easErr.message }
  if (!as) return { ok: false, error: 'asiento no existe' }

  const montoMov = Number(mov.credito) - Number(mov.debito)
  const montoAsiento = Number(as.total_debe)
  const diferencia = Math.abs(Math.abs(montoMov) - montoAsiento)
  const advertencias = []
  if (diferencia > 0.01) {
    advertencias.push(`monto movimiento (${Math.abs(montoMov)}) ≠ monto asiento (${montoAsiento}). Diferencia: ${diferencia.toFixed(2)}`)
  }
  if (as.estado !== 'posteado') {
    advertencias.push(`asiento está en estado '${as.estado}' (no posteado)`)
  }

  const preview = {
    ok: true,
    movimiento: {
      id: mov.id, fecha: mov.fecha, descripcion: mov.descripcion,
      cuenta: mov.bancos_cuentas?.alias,
      debito: Number(mov.debito), credito: Number(mov.credito),
    },
    asiento: {
      id: as.id, numero: as.numero, fecha: as.fecha,
      descripcion: as.descripcion, total: montoAsiento, estado: as.estado,
    },
    advertencias,
  }

  if (dry_run) {
    auditLog('julia_bancos_conciliar', args, 'preview', preview)
    return { ...preview, dry_run: true, mensaje: 'Preview — para ejecutar: dry_run=false + confirmar=true' }
  }
  if (!confirmar) return rechazoSinConfirmar('julia_bancos_conciliar', args)

  const { error: upErr } = await supabase
    .from('bancos_movimientos')
    .update({
      asiento_id,
      conciliado_at: new Date().toISOString(),
      conciliado_notas: notas || null,
    })
    .eq('id', movimiento_id)

  if (upErr) {
    auditLog('julia_bancos_conciliar', args, 'fallido', { error: upErr.message })
    return { ok: false, error: upErr.message }
  }

  const out = { ok: true, dry_run: false, mensaje: '✓ Movimiento conciliado', ...preview }
  auditLog('julia_bancos_conciliar', args, 'ejecutado', out, {
    filas_afectadas: 1, tabla_afectada: 'bancos_movimientos',
  })
  return out
}

async function asientoCrear(args) {
  const { fecha, descripcion, partidas, origen_tipo = 'manual', origen_id, notas,
          dry_run = true, confirmar = false } = args

  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: 'fecha YYYY-MM-DD requerida' }
  if (!descripcion?.trim()) return { ok: false, error: 'descripcion requerida' }
  if (!Array.isArray(partidas) || partidas.length < 2) return { ok: false, error: 'minimo 2 partidas' }

  // Resolver cuentas (codigo → id)
  const partidasResueltas = []
  for (const [i, p] of partidas.entries()) {
    let cuentaId = p.cuenta_id
    let cuentaInfo = null
    if (!cuentaId && p.cuenta_codigo) {
      const { data: cc } = await supabase
        .from('cuentas_contables')
        .select('id, codigo, nombre, es_movimiento, activo')
        .eq('codigo', p.cuenta_codigo)
        .maybeSingle()
      if (!cc) return { ok: false, error: `partida ${i + 1}: cuenta ${p.cuenta_codigo} no existe` }
      if (!cc.es_movimiento) return { ok: false, error: `partida ${i + 1}: ${cc.codigo} no acepta movimientos` }
      if (!cc.activo) return { ok: false, error: `partida ${i + 1}: cuenta inactiva` }
      cuentaId = cc.id
      cuentaInfo = cc
    } else if (cuentaId) {
      const { data: cc } = await supabase
        .from('cuentas_contables').select('id, codigo, nombre, es_movimiento, activo')
        .eq('id', cuentaId).maybeSingle()
      if (!cc) return { ok: false, error: `partida ${i + 1}: cuenta_id no existe` }
      cuentaInfo = cc
    } else {
      return { ok: false, error: `partida ${i + 1}: especificar cuenta_codigo o cuenta_id` }
    }

    const debe = round2(p.debe)
    const haber = round2(p.haber)
    if (debe < 0 || haber < 0) return { ok: false, error: `partida ${i + 1}: debe/haber no negativos` }
    if (debe > 0 && haber > 0) return { ok: false, error: `partida ${i + 1}: solo debe o haber, no ambos` }
    if (debe === 0 && haber === 0) return { ok: false, error: `partida ${i + 1}: monto requerido` }

    partidasResueltas.push({
      cuenta_id: cuentaId,
      cuenta_codigo: cuentaInfo.codigo,
      cuenta_nombre: cuentaInfo.nombre,
      concepto: p.concepto || null,
      debe, haber,
      orden: i,
    })
  }

  const totalDebe = round2(partidasResueltas.reduce((s, p) => s + p.debe, 0))
  const totalHaber = round2(partidasResueltas.reduce((s, p) => s + p.haber, 0))
  if (Math.abs(totalDebe - totalHaber) > 0.01) {
    return { ok: false, error: `Asiento desbalanceado: debe ${totalDebe} ≠ haber ${totalHaber}` }
  }

  const preview = {
    ok: true,
    fecha, descripcion, origen_tipo,
    total_debe: totalDebe, total_haber: totalHaber, cuadrado: true,
    partidas: partidasResueltas,
    estado_al_crear: 'borrador',
    nota_seguridad: 'Se crea en BORRADOR. Posteár manualmente desde /asientos.',
  }

  if (dry_run) {
    auditLog('julia_asiento_crear', args, 'preview', preview)
    return { ...preview, dry_run: true, mensaje: 'Preview — para ejecutar: dry_run=false + confirmar=true' }
  }
  if (!confirmar) return rechazoSinConfirmar('julia_asiento_crear', args)

  // Insert asiento + partidas en transaccion (simulada via rollback manual)
  const { data: asientoInsertado, error: aErr } = await supabase
    .from('asientos')
    .insert({
      fecha, descripcion,
      total_debe: totalDebe, total_haber: totalHaber,
      estado: 'borrador', origen_tipo, origen_id: origen_id || null, notas,
    })
    .select('id, numero')
    .single()

  if (aErr) {
    auditLog('julia_asiento_crear', args, 'fallido', { error: aErr.message })
    return { ok: false, error: aErr.message }
  }

  const { error: pErr } = await supabase
    .from('asientos_partidas')
    .insert(partidasResueltas.map(p => ({
      asiento_id: asientoInsertado.id,
      cuenta_id: p.cuenta_id,
      concepto: p.concepto,
      debe: p.debe, haber: p.haber, orden: p.orden,
    })))

  if (pErr) {
    await supabase.from('asientos').delete().eq('id', asientoInsertado.id)
    auditLog('julia_asiento_crear', args, 'fallido', { error: pErr.message })
    return { ok: false, error: `Insert partidas fallo: ${pErr.message}` }
  }

  const out = { ...preview, dry_run: false, asiento_id: asientoInsertado.id, numero: asientoInsertado.numero,
                mensaje: `✓ Asiento ${asientoInsertado.numero} creado en borrador` }
  auditLog('julia_asiento_crear', args, 'ejecutado', { ok: true, asiento_id: asientoInsertado.id }, {
    filas_afectadas: 1 + partidasResueltas.length,
    id_creado: asientoInsertado.id, tabla_afectada: 'asientos',
  })
  return out
}

async function reglaCrear(args) {
  const { patron, cuenta_contable_id, cuenta_codigo, descripcion, prioridad = 50,
          dry_run = true, confirmar = false } = args
  if (!patron?.trim()) return { ok: false, error: 'patron requerido' }

  let cuentaId = cuenta_contable_id
  if (!cuentaId && cuenta_codigo) {
    const { data: cc } = await supabase
      .from('cuentas_contables').select('id, codigo, nombre')
      .eq('codigo', cuenta_codigo).maybeSingle()
    if (!cc) return { ok: false, error: `cuenta ${cuenta_codigo} no existe` }
    cuentaId = cc.id
  }

  const preview = { ok: true, patron, cuenta_contable_id: cuentaId, prioridad,
                    descripcion: descripcion || `Auto-categoriza si descripcion contiene "${patron}"` }

  if (dry_run) {
    auditLog('julia_bancos_regla_crear', args, 'preview', preview)
    return { ...preview, dry_run: true, mensaje: 'Preview — para ejecutar: dry_run=false + confirmar=true' }
  }
  if (!confirmar) return rechazoSinConfirmar('julia_bancos_regla_crear', args)

  const { data, error } = await supabase
    .from('bancos_reglas')
    .insert({ patron, cuenta_contable_id: cuentaId, prioridad, descripcion, activo: true })
    .select('id').single()
  if (error) {
    auditLog('julia_bancos_regla_crear', args, 'fallido', { error: error.message })
    return { ok: false, error: error.message }
  }

  const out = { ...preview, dry_run: false, regla_id: data.id, mensaje: '✓ Regla creada' }
  auditLog('julia_bancos_regla_crear', args, 'ejecutado', out, {
    filas_afectadas: 1, id_creado: data.id, tabla_afectada: 'bancos_reglas',
  })
  return out
}

async function compraRegistrar(args) {
  const { proveedor, nit_proveedor, fecha, factura_proveedor, items, total,
          iva_incluido = true, metodo_pago = 'transferencia', notas,
          dry_run = true, confirmar = false, confirmar_alto_monto = false } = args

  if (!proveedor?.trim()) return { ok: false, error: 'proveedor requerido' }
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { ok: false, error: 'fecha YYYY-MM-DD' }
  if (!Array.isArray(items) || items.length === 0) return { ok: false, error: 'items[] requerido' }
  if (!total || total <= 0) return { ok: false, error: 'total > 0 requerido' }

  // Flag alto monto
  const esAltoMonto = total >= UMBRAL_COMPRA_ALTA
  if (esAltoMonto && !dry_run && !confirmar_alto_monto) {
    const out = { ok: false, error: `Compra de Q${total} supera umbral Q${UMBRAL_COMPRA_ALTA}. Requiere confirmar_alto_monto=true adicional.` }
    auditLog('julia_compra_registrar', args, 'rechazado', out)
    return out
  }

  // Resolver insumos
  const itemsResueltos = []
  for (const [i, it] of items.entries()) {
    let insumoId = it.insumo_id
    let insumoInfo = null
    if (!insumoId && it.insumo_nombre) {
      const { data: ins } = await supabase
        .from('insumos')
        .select('id, nombre, stock_actual, costo_unitario, unidad')
        .ilike('nombre', `%${it.insumo_nombre}%`)
        .eq('activo', true)
        .limit(1).maybeSingle()
      if (!ins) return { ok: false, error: `item ${i + 1}: no se encontro insumo "${it.insumo_nombre}"` }
      insumoId = ins.id
      insumoInfo = ins
    } else if (insumoId) {
      const { data: ins } = await supabase
        .from('insumos').select('id, nombre, stock_actual, costo_unitario, unidad')
        .eq('id', insumoId).maybeSingle()
      if (!ins) return { ok: false, error: `item ${i + 1}: insumo_id no existe` }
      insumoInfo = ins
    } else {
      return { ok: false, error: `item ${i + 1}: insumo_id o insumo_nombre requerido` }
    }
    const cantidad = round2(it.cantidad)
    const costo = round2(it.costo_unitario || (it.subtotal && cantidad ? it.subtotal / cantidad : insumoInfo.costo_unitario))
    const subtotal = round2(it.subtotal || cantidad * costo)
    itemsResueltos.push({
      insumo_id: insumoId, insumo_nombre: insumoInfo.nombre,
      cantidad, costo_unitario: costo, subtotal,
      unidad: insumoInfo.unidad, stock_antes: Number(insumoInfo.stock_actual || 0),
      stock_despues: Number(insumoInfo.stock_actual || 0) + cantidad,
    })
  }

  const preview = {
    ok: true,
    proveedor, nit_proveedor, fecha, factura_proveedor, metodo_pago, iva_incluido,
    total: round2(total),
    flag_alto_monto: esAltoMonto,
    items: itemsResueltos,
    subtotal_items: round2(itemsResueltos.reduce((s, i) => s + i.subtotal, 0)),
    notas_seguridad: esAltoMonto
      ? `⚠️ Compra de Q${total} supera umbral. Requiere confirmar_alto_monto=true.`
      : null,
  }

  if (dry_run) {
    auditLog('julia_compra_registrar', args, 'preview', preview)
    return { ...preview, dry_run: true, mensaje: 'Preview — para ejecutar: dry_run=false + confirmar=true' + (esAltoMonto ? ' + confirmar_alto_monto=true' : '') }
  }
  if (!confirmar) return rechazoSinConfirmar('julia_compra_registrar', args)

  // Insertar insumos_movimientos por cada item (tipo entrada)
  const movs = itemsResueltos.map(it => ({
    insumo_id: it.insumo_id,
    tipo: 'entrada',
    cantidad: it.cantidad,
    costo_unitario: it.costo_unitario,
    valor_total: it.subtotal,
    fecha,
    referencia: factura_proveedor || `${proveedor} ${fecha}`,
    notas: notas || null,
  }))
  const { data: insertedMovs, error: movErr } = await supabase
    .from('insumos_movimientos').insert(movs).select('id')
  if (movErr) {
    auditLog('julia_compra_registrar', args, 'fallido', { error: movErr.message })
    return { ok: false, error: movErr.message }
  }

  const out = {
    ...preview, dry_run: false,
    movimientos_creados: insertedMovs?.length || 0,
    ids_creados: insertedMovs?.map(m => m.id) || [],
    mensaje: `✓ Compra registrada: ${insertedMovs?.length} movimientos de inventario. Asiento contable: pendiente, crearlo con julia_asiento_crear.`,
  }
  auditLog('julia_compra_registrar', args, 'ejecutado', out, {
    filas_afectadas: insertedMovs?.length, tabla_afectada: 'insumos_movimientos',
  })
  return out
}

async function facturaAnular(args) {
  const { factura_id, motivo, admin_code, dry_run = true, confirmar = false } = args
  if (!factura_id) return { ok: false, error: 'factura_id requerido' }
  if (!motivo?.trim()) return { ok: false, error: 'motivo requerido' }

  const codigoEsperado = process.env.MCP_ADMIN_CONFIRM_CODE
  if (!codigoEsperado) {
    return { ok: false, error: 'MCP_ADMIN_CONFIRM_CODE no configurado en server — anulación deshabilitada' }
  }
  if (admin_code !== codigoEsperado) {
    const out = { ok: false, error: 'admin_code incorrecto' }
    auditLog('julia_factura_anular', { ...args, admin_code: '[REDACTED]' }, 'rechazado', out)
    return out
  }

  const { data: fact, error: fErr } = await supabase
    .from('facturas_fel')
    .select('id, serie_sat, numero_sat, total, estado, receptor_nit, receptor_nombre, fecha_emision')
    .eq('id', factura_id).maybeSingle()
  if (fErr) return { ok: false, error: fErr.message }
  if (!fact) return { ok: false, error: 'factura no existe' }
  if (fact.estado === 'anulada') return { ok: false, error: 'factura ya está anulada' }
  if (fact.estado !== 'certificada') return { ok: false, error: `solo se pueden anular facturas certificadas (estado actual: ${fact.estado})` }

  const preview = {
    ok: true,
    factura: { id: fact.id, serie: fact.serie_sat, numero: fact.numero_sat,
               total: Number(fact.total), receptor: fact.receptor_nombre,
               fecha: fact.fecha_emision },
    motivo,
    advertencia: '⚠️ Esto NO desemite el DTE en Infile/SAT. Solo marca local como anulada. Para anular en SAT, hacerlo desde Digifact/Infile portal.',
  }

  if (dry_run) {
    auditLog('julia_factura_anular', { ...args, admin_code: '[REDACTED]' }, 'preview', preview)
    return { ...preview, dry_run: true, mensaje: 'Preview — para ejecutar: dry_run=false + confirmar=true' }
  }
  if (!confirmar) return rechazoSinConfirmar('julia_factura_anular', args)

  const { error: upErr } = await supabase
    .from('facturas_fel')
    .update({ estado: 'anulada', motivo_anulacion: motivo, anulada_at: new Date().toISOString() })
    .eq('id', factura_id)
  if (upErr) {
    auditLog('julia_factura_anular', { ...args, admin_code: '[REDACTED]' }, 'fallido', { error: upErr.message })
    return { ok: false, error: upErr.message }
  }

  const out = { ...preview, dry_run: false, mensaje: `✓ Factura ${fact.serie_sat}-${fact.numero_sat} marcada como anulada localmente.` }
  auditLog('julia_factura_anular', { ...args, admin_code: '[REDACTED]' }, 'ejecutado', out, {
    filas_afectadas: 1, id_creado: fact.id, tabla_afectada: 'facturas_fel',
  })
  return out
}
