// lib/mcp/tools.js
// Definiciones y handlers de las tools expuestas vía MCP.
//
// Cada tool tiene:
//   - definicion: nombre, descripcion, JSON Schema de input (lo que ve Claude)
//   - handler:    funcion async que ejecuta la logica contra Supabase
//
// Convenciones de respuesta: { ok: true, ...data } o { ok: false, error: '...' }

import { createClient } from '@supabase/supabase-js'
import { WRITE_TOOLS, ejecutarWriteTool } from './writeTools'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// ────────────────────────────────────────────────────────────────────────────
// Helpers de fechas (Guatemala = UTC-6 sin DST)
// ────────────────────────────────────────────────────────────────────────────

function nowGT() {
  return new Date(Date.now() - 6 * 60 * 60 * 1000)
}

function gtDateString(d) {
  return d.toISOString().slice(0, 10)
}

function rangoGTaUTC(desdeGT, hastaGT) {
  // desdeGT y hastaGT son 'YYYY-MM-DD' en zona Guatemala.
  // Convertir a timestamps UTC (00:00 GT del desde hasta 23:59:59 GT del hasta).
  const desdeUTC = new Date(desdeGT + 'T06:00:00.000Z')
  const hastaUTC = new Date(hastaGT + 'T05:59:59.999Z')
  hastaUTC.setUTCDate(hastaUTC.getUTCDate() + 1)
  return { desdeUTC, hastaUTC }
}

function resolverRangoSemantico(rango) {
  // Convierte "hoy", "ayer", "esta_semana", "mes_actual", etc. a YYYY-MM-DD.
  const hoyGT = nowGT()
  const hoy = gtDateString(hoyGT)

  if (rango === 'hoy') return { desde: hoy, hasta: hoy }
  if (rango === 'ayer') {
    const ayer = new Date(hoyGT)
    ayer.setUTCDate(ayer.getUTCDate() - 1)
    const a = gtDateString(ayer)
    return { desde: a, hasta: a }
  }
  if (rango === 'misma_fecha_semana_pasada') {
    const ayer = new Date(hoyGT)
    ayer.setUTCDate(ayer.getUTCDate() - 8) // ayer - 7 dias
    const a = gtDateString(ayer)
    return { desde: a, hasta: a }
  }
  if (rango === 'esta_semana') {
    // Lunes de esta semana en GT.
    const dow = hoyGT.getUTCDay() // 0=dom, 1=lun, ...
    const offset = dow === 0 ? 6 : dow - 1
    const lun = new Date(hoyGT)
    lun.setUTCDate(lun.getUTCDate() - offset)
    return { desde: gtDateString(lun), hasta: hoy }
  }
  if (rango === 'mes_actual') {
    const primero = new Date(hoyGT)
    primero.setUTCDate(1)
    return { desde: gtDateString(primero), hasta: hoy }
  }
  // Patron "mes_YYYY-MM"
  const mMatch = rango?.match(/^mes_(\d{4})-(\d{2})$/)
  if (mMatch) {
    const [, y, m] = mMatch
    const primero = `${y}-${m}-01`
    const ultimo = new Date(Date.UTC(parseInt(y), parseInt(m), 0))
    return { desde: primero, hasta: gtDateString(ultimo) }
  }
  // Default: hoy
  return { desde: hoy, hasta: hoy }
}

// ────────────────────────────────────────────────────────────────────────────
// Definiciones de tools (JSON Schema visible para Claude)
// ────────────────────────────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: 'julia_dashboard_resumen',
    description: 'Resumen operacional de Julia Bakery para un rango de fechas: ventas totales, número de tickets, ticket promedio, top productos, margen estimado, comparativo con período previo.',
    inputSchema: {
      type: 'object',
      properties: {
        rango: {
          type: 'string',
          description: 'Rango semántico: "hoy", "ayer", "esta_semana", "mes_actual", "mes_YYYY-MM", o "misma_fecha_semana_pasada".',
          default: 'hoy',
        },
      },
    },
  },
  {
    name: 'julia_ventas_rango',
    description: 'Ventas detalladas de Julia Bakery por rango de fechas con agrupación opcional.',
    inputSchema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Fecha desde, YYYY-MM-DD en zona Guatemala.' },
        hasta: { type: 'string', description: 'Fecha hasta, YYYY-MM-DD en zona Guatemala.' },
        agrupacion: {
          type: 'string',
          enum: ['dia', 'categoria', 'metodo_pago', 'producto'],
          description: 'Cómo agrupar las ventas. Default "dia".',
        },
      },
      required: ['desde', 'hasta'],
    },
  },
  {
    name: 'julia_insumos_criticos',
    description: 'Lista los insumos de Julia Bakery que están bajo umbral de stock con sugerencia de reorden.',
    inputSchema: {
      type: 'object',
      properties: {
        umbral_pct: {
          type: 'number',
          description: 'Umbral en porcentaje del stock mínimo. Default 30.',
          default: 30,
        },
      },
    },
  },
  {
    name: 'julia_buscar_factura',
    description: 'Busca facturas FEL de Julia Bakery por serie, número, NIT del receptor, o fecha de emisión.',
    inputSchema: {
      type: 'object',
      properties: {
        serie: { type: 'string' },
        numero: { type: 'string' },
        nit: { type: 'string' },
        fecha: { type: 'string', description: 'YYYY-MM-DD' },
        limite: { type: 'number', default: 20 },
      },
    },
  },
  {
    name: 'julia_turnos_abiertos',
    description: 'Lista los turnos de caja de Julia Bakery que están abiertos (sin cierre registrado).',
    inputSchema: { type: 'object', properties: {} },
  },
  // ── v0.2: Contabilidad y bancos (solo lectura) ──────────────────────────────
  {
    name: 'julia_bancos_cuentas',
    description: 'Lista las cuentas bancarias activas de Julia Bakery (BI, BAC, BAM, etc.) con su saldo actual calculado desde movimientos.',
    inputSchema: {
      type: 'object',
      properties: {
        incluir_inactivos: { type: 'boolean', default: false },
      },
    },
  },
  {
    name: 'julia_bancos_movimientos',
    description: 'Movimientos bancarios (líneas de extracto) de Julia Bakery en un rango, opcionalmente filtrados por cuenta y estado de conciliación.',
    inputSchema: {
      type: 'object',
      properties: {
        cuenta_id: { type: 'string', description: 'UUID de la cuenta. Si se omite, devuelve de todas las cuentas activas.' },
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
        conciliados: {
          type: 'string',
          enum: ['si', 'no', 'todos'],
          description: 'Filtrar por estado de conciliación. Default "todos".',
        },
        limite: { type: 'number', default: 100 },
      },
      required: ['desde', 'hasta'],
    },
  },
  {
    name: 'julia_bancos_pendientes_conciliar',
    description: 'Lista los movimientos bancarios SIN conciliar (sin asiento contable asignado) de una o todas las cuentas. Esencial para detectar trabajo pendiente.',
    inputSchema: {
      type: 'object',
      properties: {
        cuenta_id: { type: 'string', description: 'UUID. Omitir para ver todas las cuentas.' },
        limite: { type: 'number', default: 50 },
      },
    },
  },
  {
    name: 'julia_asientos',
    description: 'Asientos contables de Julia Bakery en un rango, con sus partidas (debe/haber por cuenta).',
    inputSchema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
        estado: {
          type: 'string',
          enum: ['borrador', 'posteado', 'anulado', 'todos'],
          default: 'posteado',
        },
        origen_tipo: {
          type: 'string',
          description: 'Filtrar por origen: cierre_caja, compra, planilla, liquidacion, manual.',
        },
        limite: { type: 'number', default: 50 },
      },
      required: ['desde', 'hasta'],
    },
  },
  {
    name: 'julia_balance_general',
    description: 'Balance general de Julia Bakery a una fecha de corte: totales por tipo (activo/pasivo/patrimonio/ingreso/costo/gasto) y detalle por cuenta.',
    inputSchema: {
      type: 'object',
      properties: {
        fecha: { type: 'string', description: 'Fecha de corte YYYY-MM-DD. Default hoy GT.' },
        nivel: {
          type: 'number',
          description: 'Nivel de detalle: 1 (solo totales por tipo), 2 (grupos), 3 (cuentas detalladas). Default 2.',
          default: 2,
        },
      },
    },
  },
  {
    name: 'julia_libro_mayor',
    description: 'Libro mayor de una cuenta contable específica en un rango — todas las partidas con saldo corriente.',
    inputSchema: {
      type: 'object',
      properties: {
        codigo_cuenta: {
          type: 'string',
          description: 'Código de la cuenta contable (ej. "1-01-01" para caja general).',
        },
        cuenta_id: { type: 'string', description: 'Alternativa: UUID de la cuenta.' },
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
      },
      required: ['desde', 'hasta'],
    },
  },
  {
    name: 'julia_cuentas_contables',
    description: 'Plan de cuentas de Julia Bakery (catalogo). Útil para conocer la estructura antes de crear asientos.',
    inputSchema: {
      type: 'object',
      properties: {
        tipo: {
          type: 'string',
          enum: ['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto'],
          description: 'Filtrar por tipo. Omitir para todas.',
        },
        solo_movimiento: {
          type: 'boolean',
          description: 'Solo cuentas que aceptan asientos (es_movimiento=true). Default true.',
          default: true,
        },
      },
    },
  },
  {
    name: 'julia_cierres_caja',
    description: 'Cierres diarios de caja de Julia Bakery con ventas, conteo de efectivo y diferencia. Útil para validar contra extractos bancarios.',
    inputSchema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'YYYY-MM-DD' },
        hasta: { type: 'string', description: 'YYYY-MM-DD' },
        solo_con_diferencia: {
          type: 'boolean',
          description: 'Solo días donde conteo != esperado. Default false.',
          default: false,
        },
      },
      required: ['desde', 'hasta'],
    },
  },
  // v0.3: write tools (con dry_run + confirmar + audit log)
  ...WRITE_TOOLS,
]

// ────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────────────────────

export async function ejecutarTool(nombre, args) {
  // Primero intentar write tools (v0.3)
  const writeResult = await ejecutarWriteTool(nombre, args)
  if (writeResult !== null) return writeResult

  switch (nombre) {
    case 'julia_dashboard_resumen':
      return await dashboardResumen(args)
    case 'julia_ventas_rango':
      return await ventasRango(args)
    case 'julia_insumos_criticos':
      return await insumosCriticos(args)
    case 'julia_buscar_factura':
      return await buscarFactura(args)
    case 'julia_turnos_abiertos':
      return await turnosAbiertos(args)
    // v0.2 - bancos y contabilidad (solo lectura)
    case 'julia_bancos_cuentas':
      return await bancosCuentas(args)
    case 'julia_bancos_movimientos':
      return await bancosMovimientos(args)
    case 'julia_bancos_pendientes_conciliar':
      return await bancosPendientesConciliar(args)
    case 'julia_asientos':
      return await asientos(args)
    case 'julia_balance_general':
      return await balanceGeneral(args)
    case 'julia_libro_mayor':
      return await libroMayor(args)
    case 'julia_cuentas_contables':
      return await cuentasContables(args)
    case 'julia_cierres_caja':
      return await cierresCaja(args)
    default:
      return { ok: false, error: `Tool desconocida: ${nombre}` }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Implementaciones
// ────────────────────────────────────────────────────────────────────────────

async function dashboardResumen({ rango = 'hoy' } = {}) {
  const { desde, hasta } = resolverRangoSemantico(rango)
  const { desdeUTC, hastaUTC } = rangoGTaUTC(desde, hasta)

  const { data: facturas, error } = await supabase
    .from('facturas_fel')
    .select('total, iva, metodo_pago, fecha_emision, estado')
    .gte('fecha_emision', desdeUTC.toISOString())
    .lt('fecha_emision', hastaUTC.toISOString())
    .in('estado', ['certificada', 'anulada'])

  if (error) return { ok: false, error: error.message }

  const certificadas = facturas.filter(f => f.estado === 'certificada')
  const anuladas = facturas.filter(f => f.estado === 'anulada')
  const total = certificadas.reduce((s, f) => s + Number(f.total || 0), 0)
  const iva = certificadas.reduce((s, f) => s + Number(f.iva || 0), 0)
  const tickets = certificadas.length
  const ticketPromedio = tickets > 0 ? total / tickets : 0

  // Desglose por metodo de pago
  const porMetodo = {}
  for (const f of certificadas) {
    const m = f.metodo_pago || 'sin_clasificar'
    porMetodo[m] = (porMetodo[m] || 0) + Number(f.total || 0)
  }

  return {
    ok: true,
    rango: { desde, hasta },
    total_certificado: Number(total.toFixed(2)),
    total_anulado: Number(anuladas.reduce((s, f) => s + Number(f.total || 0), 0).toFixed(2)),
    iva_generado: Number(iva.toFixed(2)),
    tickets_certificados: tickets,
    tickets_anulados: anuladas.length,
    ticket_promedio: Number(ticketPromedio.toFixed(2)),
    por_metodo_pago: porMetodo,
  }
}

async function ventasRango({ desde, hasta, agrupacion = 'dia' } = {}) {
  if (!desde || !hasta) return { ok: false, error: 'desde y hasta son requeridos' }
  const { desdeUTC, hastaUTC } = rangoGTaUTC(desde, hasta)

  if (agrupacion === 'producto') {
    // Necesitamos joinar facturas_fel_items
    const { data, error } = await supabase
      .from('facturas_fel')
      .select('id, total, fecha_emision, facturas_fel_items (descripcion, cantidad, subtotal)')
      .gte('fecha_emision', desdeUTC.toISOString())
      .lt('fecha_emision', hastaUTC.toISOString())
      .eq('estado', 'certificada')
    if (error) return { ok: false, error: error.message }

    const porProducto = {}
    for (const f of data) {
      for (const it of f.facturas_fel_items || []) {
        const k = it.descripcion || 'sin_descripcion'
        if (!porProducto[k]) porProducto[k] = { unidades: 0, total: 0 }
        porProducto[k].unidades += Number(it.cantidad || 0)
        porProducto[k].total += Number(it.subtotal || 0)
      }
    }
    const ranking = Object.entries(porProducto)
      .map(([producto, v]) => ({ producto, ...v }))
      .sort((a, b) => b.total - a.total)
    return { ok: true, rango: { desde, hasta }, agrupacion, ranking }
  }

  // Agrupaciones que solo requieren facturas_fel
  const { data: facturas, error } = await supabase
    .from('facturas_fel')
    .select('total, iva, metodo_pago, fecha_emision')
    .gte('fecha_emision', desdeUTC.toISOString())
    .lt('fecha_emision', hastaUTC.toISOString())
    .eq('estado', 'certificada')
  if (error) return { ok: false, error: error.message }

  if (agrupacion === 'metodo_pago') {
    const grupos = {}
    for (const f of facturas) {
      const k = f.metodo_pago || 'sin_clasificar'
      grupos[k] = (grupos[k] || 0) + Number(f.total || 0)
    }
    return { ok: true, rango: { desde, hasta }, agrupacion, grupos }
  }

  // Agrupar por día (default)
  const porDia = {}
  for (const f of facturas) {
    // Convertir fecha_emision UTC a fecha GT
    const fechaGT = new Date(new Date(f.fecha_emision).getTime() - 6 * 60 * 60 * 1000)
    const k = fechaGT.toISOString().slice(0, 10)
    if (!porDia[k]) porDia[k] = { dia: k, total: 0, tickets: 0 }
    porDia[k].total += Number(f.total || 0)
    porDia[k].tickets += 1
  }
  const series = Object.values(porDia).sort((a, b) => a.dia.localeCompare(b.dia))
  return { ok: true, rango: { desde, hasta }, agrupacion, series }
}

async function insumosCriticos({ umbral_pct = 30 } = {}) {
  // Asume que existe una tabla `insumos` con columnas: id, nombre, stock_actual,
  // stock_minimo, unidad, sugerencia_reorden. Si tu schema usa otros nombres,
  // ajustar aca.
  const { data, error } = await supabase
    .from('insumos')
    .select('id, nombre, stock_actual, stock_minimo, unidad')
    .order('nombre', { ascending: true })

  if (error) return { ok: false, error: error.message }

  const criticos = (data || [])
    .filter(i => Number(i.stock_minimo || 0) > 0)
    .map(i => {
      const pct = (Number(i.stock_actual || 0) / Number(i.stock_minimo)) * 100
      return {
        insumo: i.nombre,
        stock_actual: Number(i.stock_actual),
        stock_minimo: Number(i.stock_minimo),
        unidad: i.unidad,
        pct_de_minimo: Number(pct.toFixed(1)),
        reorden_sugerido: Math.max(0, Number(i.stock_minimo) * 2 - Number(i.stock_actual)),
      }
    })
    .filter(i => i.pct_de_minimo <= umbral_pct)
    .sort((a, b) => a.pct_de_minimo - b.pct_de_minimo)

  return { ok: true, umbral_pct, criticos, total: criticos.length }
}

async function buscarFactura({ serie, numero, nit, fecha, limite = 20 } = {}) {
  let q = supabase
    .from('facturas_fel')
    .select('id, serie_sat, numero_sat, total, iva, estado, metodo_pago, fecha_emision, receptor_nit, receptor_nombre')
    .order('fecha_emision', { ascending: false })
    .limit(Math.min(Number(limite) || 20, 100))

  if (serie) q = q.eq('serie_sat', serie)
  if (numero) q = q.eq('numero_sat', String(numero))
  if (nit) q = q.eq('receptor_nit', String(nit).replace(/\D/g, ''))
  if (fecha) {
    const { desdeUTC, hastaUTC } = rangoGTaUTC(fecha, fecha)
    q = q.gte('fecha_emision', desdeUTC.toISOString()).lt('fecha_emision', hastaUTC.toISOString())
  }

  const { data, error } = await q
  if (error) return { ok: false, error: error.message }
  return { ok: true, total: data.length, facturas: data }
}

async function turnosAbiertos() {
  // Schema real: turnos_caja con estado IN ('abierto','cerrado'),
  // fecha_apertura, fecha_cierre, cajero_id, monto_apertura.
  const { data, error } = await supabase
    .from('turnos_caja')
    .select('id, cajero_id, fecha_apertura, monto_apertura, perfiles ( nombre_completo )')
    .eq('estado', 'abierto')
    .order('fecha_apertura', { ascending: true })

  if (error) return { ok: false, error: error.message }

  return {
    ok: true,
    total: (data || []).length,
    turnos: (data || []).map(t => ({
      turno_id: t.id,
      cajero: t.perfiles?.nombre_completo || t.cajero_id,
      fecha_apertura: t.fecha_apertura,
      monto_apertura: Number(t.monto_apertura || 0),
    })),
  }
}

// ════════════════════════════════════════════════════════════════════════════
// v0.2 — Implementaciones de tools bancarios y contables (solo lectura)
// ════════════════════════════════════════════════════════════════════════════

async function bancosCuentas({ incluir_inactivos = false } = {}) {
  let q = supabase
    .from('bancos_cuentas')
    .select('id, banco, alias, numero_cuenta, tipo, moneda, saldo_inicial, fecha_saldo_inicial, activo, cuenta_contable_id')
    .order('alias', { ascending: true })
  if (!incluir_inactivos) q = q.eq('activo', true)

  const { data: cuentas, error } = await q
  if (error) return { ok: false, error: error.message }

  // Calcular saldo actual por cuenta a partir de saldo_inicial + movimientos
  const resultado = []
  for (const c of (cuentas || [])) {
    const { data: movs } = await supabase
      .from('bancos_movimientos')
      .select('debito, credito')
      .eq('cuenta_id', c.id)
    const totalCredito = (movs || []).reduce((s, m) => s + Number(m.credito || 0), 0)
    const totalDebito = (movs || []).reduce((s, m) => s + Number(m.debito || 0), 0)
    const saldoActual = Number(c.saldo_inicial || 0) + totalCredito - totalDebito
    resultado.push({
      id: c.id,
      banco: c.banco,
      alias: c.alias,
      numero_cuenta: c.numero_cuenta,
      tipo: c.tipo,
      moneda: c.moneda,
      saldo_inicial: Number(c.saldo_inicial),
      fecha_saldo_inicial: c.fecha_saldo_inicial,
      saldo_actual: Number(saldoActual.toFixed(2)),
      activo: c.activo,
      cuenta_contable_id: c.cuenta_contable_id,
    })
  }

  return { ok: true, total: resultado.length, cuentas: resultado }
}

async function bancosMovimientos({ cuenta_id, desde, hasta, conciliados = 'todos', limite = 100 } = {}) {
  if (!desde || !hasta) return { ok: false, error: 'desde y hasta son requeridos' }

  let q = supabase
    .from('bancos_movimientos')
    .select('id, cuenta_id, fecha, descripcion, referencia, debito, credito, saldo, asiento_id, conciliado_at, bancos_cuentas ( alias, banco )')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .limit(Math.min(Number(limite) || 100, 500))

  if (cuenta_id) q = q.eq('cuenta_id', cuenta_id)
  if (conciliados === 'si') q = q.not('asiento_id', 'is', null)
  if (conciliados === 'no') q = q.is('asiento_id', null)

  const { data, error } = await q
  if (error) return { ok: false, error: error.message }

  return {
    ok: true,
    total: data.length,
    movimientos: data.map(m => ({
      id: m.id,
      cuenta: m.bancos_cuentas?.alias || m.cuenta_id,
      banco: m.bancos_cuentas?.banco,
      fecha: m.fecha,
      descripcion: m.descripcion,
      referencia: m.referencia,
      debito: Number(m.debito),
      credito: Number(m.credito),
      saldo: m.saldo != null ? Number(m.saldo) : null,
      conciliado: !!m.asiento_id,
      asiento_id: m.asiento_id,
      conciliado_at: m.conciliado_at,
    })),
  }
}

async function bancosPendientesConciliar({ cuenta_id, limite = 50 } = {}) {
  let q = supabase
    .from('bancos_movimientos')
    .select('id, cuenta_id, fecha, descripcion, referencia, debito, credito, bancos_cuentas ( alias, banco )')
    .is('asiento_id', null)
    .order('fecha', { ascending: false })
    .limit(Math.min(Number(limite) || 50, 200))

  if (cuenta_id) q = q.eq('cuenta_id', cuenta_id)

  const { data, error } = await q
  if (error) return { ok: false, error: error.message }

  const totalDebito = data.reduce((s, m) => s + Number(m.debito || 0), 0)
  const totalCredito = data.reduce((s, m) => s + Number(m.credito || 0), 0)

  return {
    ok: true,
    total: data.length,
    total_debito_pendiente: Number(totalDebito.toFixed(2)),
    total_credito_pendiente: Number(totalCredito.toFixed(2)),
    movimientos: data.map(m => ({
      id: m.id,
      cuenta: m.bancos_cuentas?.alias,
      banco: m.bancos_cuentas?.banco,
      fecha: m.fecha,
      descripcion: m.descripcion,
      referencia: m.referencia,
      debito: Number(m.debito),
      credito: Number(m.credito),
    })),
  }
}

async function asientos({ desde, hasta, estado = 'posteado', origen_tipo, limite = 50 } = {}) {
  if (!desde || !hasta) return { ok: false, error: 'desde y hasta son requeridos' }

  let q = supabase
    .from('asientos')
    .select(`
      id, numero, fecha, descripcion, total_debe, total_haber, estado, origen_tipo, origen_id, notas,
      asientos_partidas ( cuenta_id, concepto, debe, haber, orden, cuentas_contables ( codigo, nombre ) )
    `)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })
    .order('numero', { ascending: false })
    .limit(Math.min(Number(limite) || 50, 200))

  if (estado !== 'todos') q = q.eq('estado', estado)
  if (origen_tipo) q = q.eq('origen_tipo', origen_tipo)

  const { data, error } = await q
  if (error) return { ok: false, error: error.message }

  return {
    ok: true,
    total: data.length,
    asientos: data.map(a => ({
      id: a.id,
      numero: a.numero,
      fecha: a.fecha,
      descripcion: a.descripcion,
      estado: a.estado,
      origen_tipo: a.origen_tipo,
      origen_id: a.origen_id,
      total_debe: Number(a.total_debe),
      total_haber: Number(a.total_haber),
      cuadrado: Number(a.total_debe) === Number(a.total_haber),
      partidas: (a.asientos_partidas || [])
        .sort((p1, p2) => (p1.orden || 0) - (p2.orden || 0))
        .map(p => ({
          codigo: p.cuentas_contables?.codigo,
          cuenta: p.cuentas_contables?.nombre,
          concepto: p.concepto,
          debe: Number(p.debe),
          haber: Number(p.haber),
        })),
    })),
  }
}

async function balanceGeneral({ fecha, nivel = 2 } = {}) {
  const fechaCorte = fecha || gtDateString(nowGT())

  // Obtener todas las partidas hasta la fecha de corte (solo asientos posteados)
  const { data: partidas, error } = await supabase
    .from('asientos_partidas')
    .select(`
      debe, haber, cuenta_id,
      cuentas_contables ( id, codigo, nombre, tipo, naturaleza, cuenta_padre_id, nivel ),
      asientos!inner ( fecha, estado )
    `)
    .lte('asientos.fecha', fechaCorte)
    .eq('asientos.estado', 'posteado')

  if (error) return { ok: false, error: error.message }

  // Agrupar por cuenta
  const porCuenta = {}
  for (const p of (partidas || [])) {
    const cc = p.cuentas_contables
    if (!cc) continue
    const k = cc.id
    if (!porCuenta[k]) {
      porCuenta[k] = {
        codigo: cc.codigo,
        nombre: cc.nombre,
        tipo: cc.tipo,
        naturaleza: cc.naturaleza,
        nivel: cc.nivel,
        debe: 0,
        haber: 0,
      }
    }
    porCuenta[k].debe += Number(p.debe || 0)
    porCuenta[k].haber += Number(p.haber || 0)
  }

  // Saldo = debe - haber para deudoras, haber - debe para acreedoras
  const cuentas = Object.values(porCuenta).map(c => ({
    ...c,
    saldo: Number((c.naturaleza === 'deudora' ? c.debe - c.haber : c.haber - c.debe).toFixed(2)),
  }))

  // Totales por tipo
  const totales = {}
  for (const t of ['activo', 'pasivo', 'patrimonio', 'ingreso', 'costo', 'gasto']) {
    totales[t] = Number(cuentas.filter(c => c.tipo === t).reduce((s, c) => s + c.saldo, 0).toFixed(2))
  }

  const resultado = {
    ok: true,
    fecha_corte: fechaCorte,
    totales,
    ecuacion_contable: {
      activo: totales.activo,
      pasivo_mas_patrimonio: Number((totales.pasivo + totales.patrimonio).toFixed(2)),
      cuadra: Math.abs(totales.activo - (totales.pasivo + totales.patrimonio)) < 0.01,
    },
    resultado_periodo: Number((totales.ingreso - totales.costo - totales.gasto).toFixed(2)),
  }

  if (nivel >= 2) {
    // Agregar cuentas filtradas por nivel
    resultado.cuentas = cuentas
      .filter(c => nivel === 3 || c.nivel <= 2)
      .sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''))
  }

  return resultado
}

async function libroMayor({ codigo_cuenta, cuenta_id, desde, hasta } = {}) {
  if (!desde || !hasta) return { ok: false, error: 'desde y hasta son requeridos' }
  if (!codigo_cuenta && !cuenta_id) return { ok: false, error: 'codigo_cuenta o cuenta_id requerido' }

  // Resolver cuenta_id si vino código
  let ccId = cuenta_id
  let ccInfo = null
  if (codigo_cuenta) {
    const { data: cc } = await supabase
      .from('cuentas_contables')
      .select('id, codigo, nombre, naturaleza, tipo')
      .eq('codigo', codigo_cuenta)
      .maybeSingle()
    if (!cc) return { ok: false, error: `Cuenta ${codigo_cuenta} no existe` }
    ccId = cc.id
    ccInfo = cc
  } else {
    const { data: cc } = await supabase
      .from('cuentas_contables')
      .select('id, codigo, nombre, naturaleza, tipo')
      .eq('id', ccId)
      .maybeSingle()
    ccInfo = cc
  }

  // Saldo inicial: partidas anteriores a `desde`
  const { data: prevPart } = await supabase
    .from('asientos_partidas')
    .select('debe, haber, asientos!inner ( fecha, estado )')
    .eq('cuenta_id', ccId)
    .lt('asientos.fecha', desde)
    .eq('asientos.estado', 'posteado')

  const debePrevio = (prevPart || []).reduce((s, p) => s + Number(p.debe || 0), 0)
  const haberPrevio = (prevPart || []).reduce((s, p) => s + Number(p.haber || 0), 0)
  const saldoInicial = ccInfo.naturaleza === 'deudora' ? debePrevio - haberPrevio : haberPrevio - debePrevio

  // Partidas del periodo
  const { data: partidas, error } = await supabase
    .from('asientos_partidas')
    .select('debe, haber, concepto, asientos!inner ( numero, fecha, descripcion, estado )')
    .eq('cuenta_id', ccId)
    .gte('asientos.fecha', desde)
    .lte('asientos.fecha', hasta)
    .eq('asientos.estado', 'posteado')
    .order('fecha', { foreignTable: 'asientos', ascending: true })

  if (error) return { ok: false, error: error.message }

  let saldo = saldoInicial
  const movimientos = (partidas || []).map(p => {
    const debe = Number(p.debe || 0)
    const haber = Number(p.haber || 0)
    saldo += ccInfo.naturaleza === 'deudora' ? (debe - haber) : (haber - debe)
    return {
      numero_asiento: p.asientos.numero,
      fecha: p.asientos.fecha,
      descripcion: p.asientos.descripcion,
      concepto: p.concepto,
      debe,
      haber,
      saldo: Number(saldo.toFixed(2)),
    }
  })

  return {
    ok: true,
    cuenta: { codigo: ccInfo.codigo, nombre: ccInfo.nombre, naturaleza: ccInfo.naturaleza, tipo: ccInfo.tipo },
    rango: { desde, hasta },
    saldo_inicial: Number(saldoInicial.toFixed(2)),
    saldo_final: Number(saldo.toFixed(2)),
    total_movimientos: movimientos.length,
    movimientos,
  }
}

async function cuentasContables({ tipo, solo_movimiento = true } = {}) {
  let q = supabase
    .from('cuentas_contables')
    .select('id, codigo, nombre, tipo, naturaleza, nivel, es_movimiento, activo')
    .eq('activo', true)
    .order('codigo', { ascending: true })

  if (tipo) q = q.eq('tipo', tipo)
  if (solo_movimiento) q = q.eq('es_movimiento', true)

  const { data, error } = await q
  if (error) return { ok: false, error: error.message }

  return {
    ok: true,
    total: data.length,
    cuentas: data.map(c => ({
      id: c.id,
      codigo: c.codigo,
      nombre: c.nombre,
      tipo: c.tipo,
      naturaleza: c.naturaleza,
      nivel: c.nivel,
      es_movimiento: c.es_movimiento,
    })),
  }
}

async function cierresCaja({ desde, hasta, solo_con_diferencia = false } = {}) {
  if (!desde || !hasta) return { ok: false, error: 'desde y hasta son requeridos' }

  let q = supabase
    .from('cierres_caja')
    .select('id, fecha, saldo_inicial, conteo_efectivo, ventas_efectivo, ventas_tarjeta, ventas_otros, ventas_total, cantidad_recibos, egresos_total, saldo_esperado, diferencia, estado, notas')
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: false })

  const { data, error } = await q
  if (error) return { ok: false, error: error.message }

  let cierres = data || []
  if (solo_con_diferencia) {
    cierres = cierres.filter(c => Math.abs(Number(c.diferencia || 0)) > 0.01)
  }

  return {
    ok: true,
    total: cierres.length,
    cierres: cierres.map(c => ({
      id: c.id,
      fecha: c.fecha,
      saldo_inicial: Number(c.saldo_inicial || 0),
      ventas_efectivo: Number(c.ventas_efectivo || 0),
      ventas_tarjeta: Number(c.ventas_tarjeta || 0),
      ventas_otros: Number(c.ventas_otros || 0),
      ventas_total: Number(c.ventas_total || 0),
      cantidad_recibos: c.cantidad_recibos,
      egresos_total: Number(c.egresos_total || 0),
      saldo_esperado: Number(c.saldo_esperado || 0),
      conteo_efectivo: c.conteo_efectivo != null ? Number(c.conteo_efectivo) : null,
      diferencia: c.diferencia != null ? Number(c.diferencia) : null,
      estado: c.estado,
      notas: c.notas,
    })),
  }
}
