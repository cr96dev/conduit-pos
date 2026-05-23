// lib/planillas.js
// Helpers de calculo laboral para Guatemala (compartidos client + server).
//
// Constantes (Decreto 295, Decreto 37-2001, Codigo de Trabajo Art. 130):
//   IGSS empleado:   4.83% sobre base imponible (sin bonif. incentivo)
//   IGSS patronal:  10.67% mensual sobre salario
//   IRTRA:           1.00% mensual
//   INTECAP:         1.00% mensual
//   Indemnizacion:   9.72% mensual (provision)
//   Bono 14:        salario / 12 mensual  = salario / 24 quincenal
//   Aguinaldo:      salario / 12 mensual  = salario / 24 quincenal
//   Vacaciones:     15 dias habiles / año = salario / 24 mensual = salario / 48 quincenal
//                   (15 dias × salario_diario, con salario_diario = salario_mensual/30)

export const IGSS_EMPLEADO = 0.0483
export const IGSS_PATRONAL = 0.1067
export const IRTRA         = 0.01
export const INTECAP       = 0.01
export const INDEMNIZACION = 0.0972
export const BONIF_INCENTIVO_DEFAULT = 250  // Q250 mensuales / Q125 quincenales

// Vacaciones legales en Guatemala: 15 dias habiles por año cumplido (Art. 130 CT).
// La provision mensual contable = (DIAS_VACACIONES_ANIO / 30) × salario / 12.
export const DIAS_VACACIONES_ANIO = 15

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// Recibe salario mensual y devuelve todas las provisiones derivadas
// listas para guardar en `empleados`.
export function calcularProvisiones(salarioMensual) {
  const sal = Number(salarioMensual) || 0

  // Provisiones laborales mensuales y su mitad quincenal.
  const bono14_m     = sal / 12
  const aguinaldo_m  = sal / 12
  const vacaciones_m = (DIAS_VACACIONES_ANIO / 30) * (sal / 12)  // = sal / 24

  const provisiones_m = bono14_m + aguinaldo_m + vacaciones_m
  const provisiones_q = provisiones_m / 2

  // Cargas patronales mensuales (IGSS, IRTRA, INTECAP, indemnizacion).
  // Por quincena se prorratea a la mitad: al sumar las 2 quincenas del mes
  // se vuelve a obtener el cargo mensual exacto, sin duplicar.
  const cargas_patronales_m = sal * (IGSS_PATRONAL + IRTRA + INTECAP + INDEMNIZACION)
  const cargas_patronales_q = cargas_patronales_m / 2

  return {
    salario_quincenal:         round2(sal / 2),
    bono14_quincenal:          round2(bono14_m / 2),
    aguinaldo_quincenal:       round2(aguinaldo_m / 2),
    vacaciones_quincenal:      round2(vacaciones_m / 2),
    igss_empleado_quincenal:   round2((sal * IGSS_EMPLEADO) / 2),
    igss_patronal_mensual:     round2(sal * IGSS_PATRONAL),
    irtra_mensual:             round2(sal * IRTRA),
    intecap_mensual:           round2(sal * INTECAP),
    indemnizacion_mensual:     round2(sal * INDEMNIZACION),
    costo_patronal_quincenal:  round2(sal / 2 + provisiones_q + cargas_patronales_q),
    costo_total_mensual:       round2(sal + provisiones_m + cargas_patronales_m),
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
