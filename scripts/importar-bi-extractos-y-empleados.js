// Carga masiva:
//  - Cuenta bancaria BI Weird Dough (si no existe, la crea mapeada a 1-01-01-101)
//  - Movimientos de los extractos abril+mayo 2026 (deduplicado por hash automatico via API)
//  - Empleados con salario minimo CE1 + bonif incentivo

const fs = require('fs')
const crypto = require('crypto')
const XLSX = require('xlsx')

// Cargar .env.local
const env = fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
for (const line of env) {
  const eq = line.indexOf('=')
  if (eq > 0) process.env[line.slice(0, eq)] = line.slice(eq+1)
}
const { createClient } = require('@supabase/supabase-js')
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ============================================================================
// CUENTA BANCARIA
// ============================================================================

async function setupCuenta() {
  // Buscar cuenta contable Banco Industrial
  const { data: cc } = await supa.from('cuentas_contables')
    .select('id').eq('codigo', '1-01-01-101').single()
  if (!cc) throw new Error('Cuenta contable 1-01-01-101 no encontrada')

  // Verificar si ya existe la cuenta bancaria
  const { data: existente } = await supa.from('bancos_cuentas')
    .select('id, alias').eq('numero_cuenta', '905665881').maybeSingle()
  if (existente) {
    console.log(`✓ Cuenta bancaria ya existe: ${existente.alias}`)
    return existente.id
  }

  const { data, error } = await supa.from('bancos_cuentas').insert({
    banco: 'BI',
    alias: 'BI Weird Dough 905665881',
    numero_cuenta: '905665881',
    tipo: 'monetaria',
    moneda: 'GTQ',
    cuenta_contable_id: cc.id,
    saldo_inicial: 251639.24, // saldo al 01/04/2026 segun extracto
    fecha_saldo_inicial: '2026-04-01',
    notas: 'WEIRD DOUGH, S.A. — cuenta principal',
  }).select().single()
  if (error) throw error
  console.log(`✓ Cuenta bancaria creada: ${data.alias}`)
  return data.id
}

// ============================================================================
// PARSER DE EXTRACTO BI
// ============================================================================

function parseFechaDMY(s) {
  if (!s) return null
  const m = String(s).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`
}

function parseExtractoBI(path) {
  const wb = XLSX.readFile(path)
  const sh = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sh, { defval: '', header: 1 })

  // Buscar fila de headers (donde col 0 = "Fecha" y col 4 = "Descripción")
  let headerRow = -1
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === 'Fecha' && String(rows[i][4]).trim().toLowerCase().includes('descripci')) {
      headerRow = i; break
    }
  }
  if (headerRow < 0) throw new Error(`No se encontro fila de headers en ${path}`)

  const movs = []
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]
    const fecha = parseFechaDMY(r[0])
    if (!fecha) continue
    const referencia = String(r[1] || '').trim() || null
    const codigo = String(r[3] || '').trim()
    const descripcion = String(r[4] || '').trim()
    if (!descripcion) continue
    const debito  = Number(r[7]) || 0
    const credito = Number(r[8]) || 0
    const saldo   = Number(r[9]) || null
    if (debito === 0 && credito === 0) continue
    movs.push({
      fecha,
      descripcion: codigo ? `${codigo} ${descripcion}` : descripcion,
      referencia, debito, credito, saldo,
    })
  }
  return movs
}

async function importMovs(cuentaId, movs, source) {
  if (movs.length === 0) return { insertados: 0, dup: 0 }

  // Calcular hash igual que la API y hacer upsert con ignoreDuplicates
  const rows = movs.map(m => {
    const hash = crypto.createHash('sha256')
      .update(`${cuentaId}|${m.fecha}|${m.descripcion}|${m.debito}|${m.credito}|${m.referencia || ''}`)
      .digest('hex').slice(0, 32)
    return {
      cuenta_id: cuentaId,
      fecha: m.fecha,
      descripcion: m.descripcion,
      referencia: m.referencia,
      debito: m.debito,
      credito: m.credito,
      saldo: m.saldo,
      hash_import: hash,
      raw: { source },
    }
  })

  const { data, error } = await supa.from('bancos_movimientos')
    .upsert(rows, { onConflict: 'cuenta_id,hash_import', ignoreDuplicates: true })
    .select('id')
  if (error) throw error
  return {
    insertados: data?.length || 0,
    dup: rows.length - (data?.length || 0),
  }
}

// ============================================================================
// EMPLEADOS
// ============================================================================

function parseFechaEmpleado(v) {
  if (v == null || v === '') return null
  // Si es numero, es Excel serial date
  if (typeof v === 'number') {
    // Excel: epoch 1900-01-01 = 1, con bug del año bisiesto
    const ms = (v - 25569) * 86400 * 1000
    const d = new Date(ms)
    return d.toISOString().slice(0, 10)
  }
  return parseFechaDMY(v)
}

function mapPuestoToArea(puesto) {
  const p = puesto.toUpperCase()
  if (p.includes('BARISTA') || p.includes('CAJ')) return 'ventas'
  if (p.includes('COCIN') || p.includes('CHEF') || p.includes('CODINERO')) return 'panaderia'
  if (p.includes('CONTAD') || p.includes('ADMIN')) return 'administracion'
  if (p.includes('JEFE')) return 'panaderia'
  return 'panaderia'
}

// Recalcular provisiones (espejo de lib/planillas.calcularProvisiones)
function calcularProvisiones(sal) {
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
  return {
    salario_quincenal:         round2(sal / 2),
    bono14_quincenal:          round2(sal / 24),
    aguinaldo_quincenal:       round2(sal / 24),
    vacaciones_quincenal:      round2(sal / 24),
    igss_empleado_quincenal:   round2((sal * 0.0483) / 2),
    igss_patronal_mensual:     round2(sal * 0.1067),
    irtra_mensual:             round2(sal * 0.01),
    intecap_mensual:           round2(sal * 0.01),
    indemnizacion_mensual:     round2(sal * 0.0972),
    costo_patronal_quincenal:  round2(sal / 2 + (sal / 24) * 3 + sal * 0.1067 + sal * 0.01 + sal * 0.01 + sal * 0.0972),
    costo_total_mensual:       round2(sal + (sal / 12) * 3 + sal * 0.1067 + sal * 0.01 + sal * 0.01 + sal * 0.0972),
  }
}

async function importEmpleados(path) {
  const wb = XLSX.readFile(path)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', header: 1 })

  // Headers en fila 2
  // [NO., EMPLEADO, IGSS, DPI, NIT, INICIO, NACIMIENTO, CARGO]
  const emps = []
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i]
    const nombre = String(r[1] || '').trim()
    if (!nombre) continue
    emps.push({
      nombre,
      numero_igss: String(r[2] || '').trim() || null,
      dpi: String(r[3] || '').trim() || null,
      nit: String(r[4] || '').trim() || null,
      fecha_ingreso: parseFechaEmpleado(r[5]),
      puesto: String(r[7] || 'Panadero').trim(),
    })
  }

  // Salario default: minimo CE1 2026 no agricola
  const SALARIO_MIN = 3752.28
  const BONIF_INCENTIVO_QUINC = 125 // 250/mes

  // Dedupe por DPI o nombre contra los ya existentes
  const { data: existentes } = await supa.from('empleados').select('nombre, dpi')
  const dpiSet = new Set((existentes || []).filter(e => e.dpi).map(e => e.dpi))
  const nomSet = new Set((existentes || []).map(e => e.nombre.toLowerCase().trim()))

  let creados = 0, omitidos = 0
  const errores = []

  for (const e of emps) {
    if (e.dpi && dpiSet.has(e.dpi)) { omitidos++; continue }
    if (!e.dpi && nomSet.has(e.nombre.toLowerCase())) { omitidos++; continue }

    const provisiones = calcularProvisiones(SALARIO_MIN)
    const payload = {
      nombre: e.nombre,
      dpi: e.dpi,
      nit: e.nit,
      numero_igss: e.numero_igss,
      area: mapPuestoToArea(e.puesto),
      puesto: e.puesto,
      tipo_pago: 'transferencia',
      banco: 'BI',
      fecha_ingreso: e.fecha_ingreso,
      salario_mensual: SALARIO_MIN,
      bonificacion_quincenal: BONIF_INCENTIVO_QUINC,
      bonificacion_segunda_quincena: 0,
      notas: 'Importado del Excel EMPLEADOS JULIA BAKERY',
      ...provisiones,
    }
    const { error } = await supa.from('empleados').insert(payload)
    if (error) errores.push(`${e.nombre}: ${error.message}`)
    else { creados++; if (e.dpi) dpiSet.add(e.dpi); nomSet.add(e.nombre.toLowerCase()) }
  }

  return { creados, omitidos, errores, total: emps.length }
}

// ============================================================================
// MAIN
// ============================================================================

(async () => {
  try {
    console.log('=== CUENTA BANCARIA ===')
    const cuentaId = await setupCuenta()

    console.log('\n=== MOVIMIENTOS ABRIL 2026 ===')
    const movsAbr = parseExtractoBI('/Users/cjrh/Downloads/Transacciones del mes abril 2026 JB.xls')
    console.log(`Parseados: ${movsAbr.length} movimientos`)
    const resAbr = await importMovs(cuentaId, movsAbr, 'BI abril 2026')
    console.log(`Insertados: ${resAbr.insertados}, duplicados (skip): ${resAbr.dup}`)

    console.log('\n=== MOVIMIENTOS MAYO 2026 ===')
    const movsMay = parseExtractoBI('/Users/cjrh/Downloads/Transacciones del mes mayo 2026 JB.xls')
    console.log(`Parseados: ${movsMay.length} movimientos`)
    const resMay = await importMovs(cuentaId, movsMay, 'BI mayo 2026')
    console.log(`Insertados: ${resMay.insertados}, duplicados (skip): ${resMay.dup}`)

    console.log('\n=== EMPLEADOS ===')
    const emp = await importEmpleados('/Users/cjrh/Downloads/EMPLEADOS JULIA BAKERY.xlsx')
    console.log(`Procesados: ${emp.total} | Creados: ${emp.creados} | Omitidos: ${emp.omitidos}`)
    if (emp.errores.length > 0) {
      console.log('Errores:')
      emp.errores.forEach(e => console.log(' -', e))
    }
    console.log('\n✓ Todo importado.')
    process.exit(0)
  } catch (e) {
    console.error('ERROR:', e.message)
    process.exit(1)
  }
})()
