// lib/mcp/tools.js
// Definiciones y handlers de las tools expuestas vía MCP.
//
// Cada tool tiene:
//   - definicion: nombre, descripcion, JSON Schema de input (lo que ve Claude)
//   - handler:    funcion async que ejecuta la logica contra Supabase
//
// Convenciones de respuesta: { ok: true, ...data } o { ok: false, error: '...' }

import { createClient } from '@supabase/supabase-js'

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
]

// ────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────────────────────

export async function ejecutarTool(nombre, args) {
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
