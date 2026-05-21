// lib/igss.js
// Helpers server-side para la planilla IGSS DR-182-1 de Guatemala.
//
// Conceptos clave:
//   - Cuotas mensuales:
//       Patronal 10.67%, Laboral 4.83%, IRTRA 1%, INTECAP 1%
//   - Base imponible IGSS = salario devengado del mes
//     MENOS la bonificacion incentivo de ley (Q250/mes exenta — Decreto 37-2001).
//   - El archivo TXT v2.2.0 se sube al sistema del IGSS. Tiene secciones fijas:
//       cabecera, [Centros], [TiposPlanilla], [Liquidaciones], [Empleados], [FinPlanilla].

const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export const PATRONAL = 0.1067
export const LABORAL  = 0.0483
export const IRTRA    = 0.01
export const INTECAP  = 0.01
export const BONIF_INCENTIVO_EXENTA = 250

export function calcularCuotas(salarioImponible) {
  const s = Number(salarioImponible) || 0
  return {
    patronal: round(s * PATRONAL),
    laboral:  round(s * LABORAL),
    irtra:    round(s * IRTRA),
    intecap:  round(s * INTECAP),
    total:    round(s * (PATRONAL + LABORAL + IRTRA + INTECAP)),
  }
}

// Calcula la base imponible mensual por empleado para un (anio, mes).
// Lee planilla_lineas de las planillas del mes (idealmente las 2 quincenas)
// y suma devengado. Si no hay planillas, usa el catalogo de empleados como fallback.
//
// Devuelve [{ empleado_id, nombre, puesto, area, numero_igss, sal_mensual_igss, fuente }]
export async function calcularBaseImponibleMes(admin, anio, mes) {
  // Buscar planillas del mes.
  const { data: planillas } = await admin
    .from('planillas').select('id, quincena, estado')
    .eq('anio', anio).eq('mes', mes)
    .order('quincena')

  if (planillas && planillas.length > 0) {
    const ids = planillas.map(p => p.id)
    const { data: lineas } = await admin
      .from('planilla_lineas')
      .select('empleado_id, nombre, puesto, area, salario_quincenal, horas_extra, comisiones, otros_ingresos, empleados(numero_igss)')
      .in('planilla_id', ids)

    // Agrupar por empleado
    const mapa = {}
    for (const l of lineas || []) {
      const key = l.empleado_id || ('nombre:' + l.nombre)
      if (!mapa[key]) {
        mapa[key] = {
          empleado_id: l.empleado_id,
          nombre: l.nombre,
          puesto: l.puesto,
          area: l.area,
          numero_igss: l.empleados?.numero_igss || '',
          devengado: 0,
          fuente: 'planilla',
        }
      }
      mapa[key].devengado += (Number(l.salario_quincenal) || 0)
                          + (Number(l.horas_extra)        || 0)
                          + (Number(l.comisiones)         || 0)
                          + (Number(l.otros_ingresos)     || 0)
    }
    return Object.values(mapa).map(e => ({
      ...e,
      sal_mensual_igss: round(Math.max(0, e.devengado - BONIF_INCENTIVO_EXENTA)),
    }))
  }

  // Fallback: catalogo de empleados activos
  const { data: emps } = await admin.from('empleados').select('*').eq('activo', true).order('nombre')
  return (emps || []).map(e => ({
    empleado_id: e.id,
    nombre: e.nombre,
    puesto: e.puesto,
    area: e.area,
    numero_igss: e.numero_igss || '',
    sal_mensual_igss: round(
      (Number(e.salario_mensual) || 0)
      + (Number(e.bonificacion_quincenal) || 0) * 2
      + (Number(e.bonificacion_segunda_quincena) || 0)
      // Nota: no se resta Q250 aqui porque el catalogo no incluye bonificacion
      // incentivo en salario_mensual por defecto. Si se incluye, hay que restarla.
    ),
    fuente: 'catalogo',
  }))
}

// Genera el archivo TXT formato IGSS v2.2.0.
// Q1: 01-14, Q2: 15-28 (14 dias exactos, requerimiento IGSS).
// Nombres: el sistema espera Nombre1|Nombre2|Apellido1|Apellido2.
//   Si el nombre tiene coma ("APELLIDOS, NOMBRES") se usa eso.
//   Si no, se divide en 4 partes asumiendo "Apellido1 Apellido2 Nombre1 Nombre2".
export function generarTXTPlanillaIGSS({ anio, mes, config, empleados }) {
  const hoy = new Date()
  const dd = String(hoy.getDate()).padStart(2, '0')
  const mm = String(hoy.getMonth() + 1).padStart(2, '0')
  const yyyy = hoy.getFullYear()
  const fechaGen = `${dd}/${mm}/${yyyy}`
  const mes2 = String(mes).padStart(2, '0')
  const fechaIni1 = `01/${mes2}/${anio}`, fechaFin1 = `14/${mes2}/${anio}`
  const fechaIni2 = `15/${mes2}/${anio}`, fechaFin2 = `28/${mes2}/${anio}`

  const lines = []
  lines.push(`2.2.0|${fechaGen}|${config.numero_patronal}|${mes2}|${anio}|${config.nombre_patrono}|${config.nit_patrono}|${config.email_patrono || ''}|0`)
  lines.push('[Centros]')
  lines.push(`1|${config.nombre_patrono}|${config.direccion || ''}|10|${config.nit_patrono}|||${config.email_patrono || ''}|1|1|${config.codigo_actividad || '452001'}`)
  lines.push('[TiposPlanilla]')
  lines.push(`1|PLANILLA QUINCENAL|C|C|1|${config.codigo_actividad || '452001'}|${config.codigo_ocupacion || 5018}|TC`)
  lines.push('[Liquidaciones]')
  lines.push(`1|1|${fechaIni1}|${fechaFin1}|O|`)
  lines.push(`2|1|${fechaIni2}|${fechaFin2}|O|`)
  lines.push('[Empleados]')

  for (const e of empleados) {
    const salQ = round((Number(e.sal_mensual_igss) || 0) / 2)
    const cuotaLabQ = round(salQ * LABORAL)
    const igssNum = e.numero_igss || ''
    const { n1, n2, a1, a2 } = partirNombre(e.nombre || '')

    for (const [liq, fi] of [['1', fechaIni1], ['2', fechaIni2]]) {
      lines.push(`${liq}|${igssNum}|${n1}|${n2}|${a1}|${a2}||${salQ}|${fi}||1|${config.nit_patrono}|${config.codigo_ocupacion || 5018}|P|${cuotaLabQ}|1|0|TC|14`)
    }
  }

  lines.push('[FinPlanilla]')
  return lines.join('\n')
}

function partirNombre(raw) {
  const coma = raw.indexOf(',')
  let n1 = '', n2 = '', a1 = '', a2 = ''
  if (coma > -1) {
    const apellidos = raw.substring(0, coma).trim().split(/\s+/)
    const nombres   = raw.substring(coma + 1).trim().split(/\s+/)
    a1 = apellidos[0] || ''; a2 = apellidos[1] || ''
    n1 = nombres[0]   || ''; n2 = nombres[1]   || ''
  } else {
    const partes = raw.trim().split(/\s+/)
    // Asumir: "Nombre1 Nombre2 Apellido1 Apellido2"
    n1 = partes[0] || ''; n2 = partes[1] || ''
    a1 = partes[2] || ''; a2 = partes[3] || ''
  }
  return { n1, n2, a1, a2 }
}
