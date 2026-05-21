// lib/planillas.js
// Helpers de calculo laboral para Guatemala (compartidos client + server).
//
// Constantes (Decreto 295, Decreto 37-2001, etc.):
//   IGSS empleado:   4.83% sobre base imponible (sin bonif. incentivo)
//   IGSS patronal:  10.67% mensual sobre salario
//   IRTRA:           1.00% mensual
//   INTECAP:         1.00% mensual
//   Indemnizacion:   9.72% mensual (provision)
//   Bono 14:        salario / 12 mensual = salario / 24 quincenal
//   Aguinaldo:      idem bono 14
//   Vacaciones:     idem (15 dias / 360 ≈ salario / 24 quincenal)

export const IGSS_EMPLEADO = 0.0483
export const IGSS_PATRONAL = 0.1067
export const IRTRA         = 0.01
export const INTECAP       = 0.01
export const INDEMNIZACION = 0.0972
export const BONIF_INCENTIVO_DEFAULT = 250  // Q250 mensuales / Q125 quincenales

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// Recibe salario mensual y devuelve todas las provisiones derivadas
// listas para guardar en `empleados`.
export function calcularProvisiones(salarioMensual) {
  const sal = Number(salarioMensual) || 0
  return {
    salario_quincenal:         round2(sal / 2),
    bono14_quincenal:          round2(sal / 24),
    aguinaldo_quincenal:       round2(sal / 24),
    vacaciones_quincenal:      round2(sal / 24),
    igss_empleado_quincenal:   round2((sal * IGSS_EMPLEADO) / 2),
    igss_patronal_mensual:     round2(sal * IGSS_PATRONAL),
    irtra_mensual:             round2(sal * IRTRA),
    intecap_mensual:           round2(sal * INTECAP),
    indemnizacion_mensual:     round2(sal * INDEMNIZACION),
    costo_patronal_quincenal:  round2(
      sal / 2 + (sal / 24) * 3 + sal * IGSS_PATRONAL + sal * IRTRA + sal * INTECAP + sal * INDEMNIZACION
    ),
    costo_total_mensual: round2(
      sal + (sal / 12) * 3 + sal * IGSS_PATRONAL + sal * IRTRA + sal * INTECAP + sal * INDEMNIZACION
    ),
  }
}

// IGSS empleado sobre la base imponible REAL de la quincena (no incluye bonif. incentivo).
export function calcularIgssLinea(l) {
  const base = (Number(l.salario_quincenal) || 0)
             + (Number(l.horas_extra)        || 0)
             + (Number(l.comisiones)         || 0)
             + (Number(l.otros_ingresos)     || 0)
  return round2(base * IGSS_EMPLEADO)
}

// Liquido a recibir por linea.
export function calcularLiquidoLinea(l) {
  const igss = calcularIgssLinea(l)
  const adiciones = (Number(l.salario_quincenal)        || 0)
                  + (Number(l.horas_extra)              || 0)
                  + (Number(l.comisiones)               || 0)
                  + (Number(l.otros_ingresos)           || 0)
                  + (Number(l.bonificacion_incentivo)   || 0)
  const descuentos = igss
                  + (Number(l.otros_descuentos)     || 0)
                  + (Number(l.prestamo_anticipo)    || 0)
                  + (Number(l.embargo_deuda)        || 0)
                  + (Number(l.faltante_inventario)  || 0)
                  + (Number(l.faltante_efectivo)    || 0)
                  + (Number(l.descuentos_varios)    || 0)
  return round2(adiciones - descuentos)
}

// Totales agregados de una planilla a partir de sus lineas.
export function calcularTotalesPlanilla(lineas) {
  let total_bruto = 0, total_adiciones = 0, total_igss_empleados = 0
  let total_descuentos = 0, total_liquido = 0, total_costo_patronal = 0
  for (const l of lineas) {
    const igss = calcularIgssLinea(l)
    total_bruto         += Number(l.salario_quincenal) || 0
    total_adiciones     += (Number(l.horas_extra)||0) + (Number(l.comisiones)||0)
                         + (Number(l.otros_ingresos)||0) + (Number(l.bonificacion_incentivo)||0)
    total_igss_empleados += igss
    total_descuentos    += (Number(l.otros_descuentos)||0) + (Number(l.prestamo_anticipo)||0)
                         + (Number(l.embargo_deuda)||0) + (Number(l.faltante_inventario)||0)
                         + (Number(l.faltante_efectivo)||0) + (Number(l.descuentos_varios)||0)
    total_liquido       += calcularLiquidoLinea(l)
    total_costo_patronal += Number(l.costo_patronal_total) || 0
  }
  return {
    total_bruto:          round2(total_bruto),
    total_adiciones:      round2(total_adiciones),
    total_igss_empleados: round2(total_igss_empleados),
    total_descuentos:     round2(total_descuentos),
    total_liquido:        round2(total_liquido),
    total_costo_patronal: round2(total_costo_patronal),
  }
}

// A partir de una fecha de inicio (YYYY-MM-DD) deducir periodo, anio, mes, quincena.
export function deducirPeriodo(fechaInicio) {
  const [y, m, d] = fechaInicio.split('-').map(Number)
  const quincena = d <= 15 ? 1 : 2
  const meses = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE']
  const label = (quincena === 1 ? 'PRIMERA' : 'SEGUNDA') + ' QUINCENA ' + meses[m - 1] + ' ' + y
  return { anio: y, mes: m, quincena, periodo: label }
}
