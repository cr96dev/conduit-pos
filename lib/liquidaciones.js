// lib/liquidaciones.js
// Calculo de prestaciones laborales segun Codigo de Trabajo de Guatemala.
//
// - Indemnizacion (Art. 82): solo despido injustificado.
//     Base = salario promedio ultimos 6 meses × años trabajados.
//     Por Art. 82 literal: "si los servicios no alcanzan a un año, en forma
//     proporcional al plazo trabajado". Aplica prorrateo desde dia 1, sin
//     umbral minimo.
// - Preaviso (Art. 80): solo despido injustificado. Tabla por antiguedad:
//     < 6 meses:    1 semana  (sal × 7/30)
//     6m a 1 año:   10 dias   (sal × 10/30)
//     1 año a 5:    15 dias   (sal × 15/30 = sal/2)
//     >= 5 años:    30 dias   (sal completo)
// - Vacaciones proporcionales: dias_pendientes_anio × salario/30.
//     15 dias por año cumplido. Solo del año en curso (la fraccion).
// - Aguinaldo proporcional: dias del periodo (1 dic - 30 nov) ponderados.
//     IMPORTANTE: el conteo arranca en max(fecha_ingreso, inicio_periodo).
//     Empleados que ingresaron despues del 1 dic SOLO acumulan desde su
//     fecha de ingreso, no desde el inicio del periodo legal.
// - Bono 14 proporcional: dias del periodo (1 jul - 30 jun) ponderados.
//     Misma logica que aguinaldo: cap inferior en fecha_ingreso.
//
// El ponderado de aguinaldo/bono14 considera el salario minimo CE1 no agricola
// para cada año (Acuerdos Gubernativos), salvo que el empleado gane "salario
// especial" >= Q4,500 (admins, ejecutivos), donde se usa el salario real.

const round = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// Salarios minimos CE1 no agricola (Acuerdos Gubernativos GT)
const SALARIO_MIN_HISTORICO = {
  2023: 3209.20,
  2024: 3384.59,
  2025: 3473.05,
  2026: 3752.28,
}

function salarioMinimoVigente(anio) {
  return SALARIO_MIN_HISTORICO[anio] || SALARIO_MIN_HISTORICO[2026]
}

const UMBRAL_SALARIO_ESPECIAL = 4500

// Promedio de salarios de los ultimos 6 meses considerando el historico de minimos.
// Empleados con salario_actual >= UMBRAL se asume sin cambios historicos (admin).
function calcularPromedio6Meses(fechaIngresoISO, fechaBajaISO, salarioActual) {
  const esEspecial = Number(salarioActual) >= UMBRAL_SALARIO_ESPECIAL
  if (esEspecial) return round(salarioActual)
  const baja = new Date(fechaBajaISO)
  const ingreso = fechaIngresoISO ? new Date(fechaIngresoISO) : new Date(0)
  const salarios = []
  for (let i = 1; i <= 6; i++) {
    let m = baja.getMonth() - i
    let a = baja.getFullYear()
    while (m < 0) { m += 12; a-- }
    const inicioMes = new Date(a, m, 1)
    if (inicioMes >= ingreso) salarios.push(salarioMinimoVigente(a))
  }
  if (salarios.length === 0) return round(salarioActual)
  return round(salarios.reduce((s, v) => s + v, 0) / salarios.length)
}

// Calcula prestaciones para un empleado.
// Parametros: empleado tiene salario_mensual y fecha_ingreso.
// Devuelve un objeto con todos los componentes + totales.
export function calcularLiquidacion({
  empleado,
  fechaBaja,                    // YYYY-MM-DD
  tipoBaja,                     // 'despido_injustificado' | 'despido_justificado' | 'renuncia_voluntaria'
  diasSalarioPendiente = 0,
  deducciones = 0,
}) {
  const sal = Number(empleado.salario_mensual) || 0
  const salDia = round(sal / 30)
  const esEspecial = sal >= UMBRAL_SALARIO_ESPECIAL

  const ingreso = new Date(empleado.fecha_ingreso)
  const baja    = new Date(fechaBaja)
  const msTotal = baja - ingreso
  const diasTotal = Math.floor(msTotal / 86_400_000)
  const aniosTrabajados = diasTotal / 365.25
  const mesesTrabajados = Math.floor(diasTotal / 30.44)
  const salProm6m = calcularPromedio6Meses(empleado.fecha_ingreso, fechaBaja, sal)

  // Indemnizacion (Art. 82): proporcional al plazo trabajado, desde dia 1.
  // "Si los servicios no alcanzan a un año, en forma proporcional al plazo trabajado".
  let indemnizacion = 0
  if (tipoBaja === 'despido_injustificado' && diasTotal > 0) {
    indemnizacion = round(salProm6m * aniosTrabajados)
  }

  // Preaviso (Art. 80): tabla por antiguedad.
  let preaviso = 0
  if (tipoBaja === 'despido_injustificado' && diasTotal > 0) {
    if (aniosTrabajados >= 5)      preaviso = sal                       // 30 dias = 1 mes
    else if (aniosTrabajados >= 1) preaviso = round(sal * (15 / 30))    // 15 dias
    else if (mesesTrabajados >= 6) preaviso = round(sal * (10 / 30))    // 10 dias
    else                            preaviso = round(sal * (7 / 30))    // 1 semana
  }

  // Vacaciones proporcionales: dias por la fraccion de año del año actual
  const diasVacProporcionales = round((aniosTrabajados % 1) * 15)
  const vacaciones = round(diasVacProporcionales * salDia)

  // Aguinaldo proporcional (1 dic - 30 nov).
  // El conteo arranca en max(fecha_ingreso, inicio_periodo).
  const inicioPeriodoAguinaldo = baja.getMonth() >= 11
    ? new Date(baja.getFullYear(), 11, 1)
    : new Date(baja.getFullYear() - 1, 11, 1)
  const inicioAguinaldo = ingreso > inicioPeriodoAguinaldo ? ingreso : inicioPeriodoAguinaldo
  const diasAguinaldo = Math.max(0, Math.floor((baja - inicioAguinaldo) / 86_400_000) + 1)
  let aguinaldo = 0
  for (let a = inicioAguinaldo.getFullYear(); a <= baja.getFullYear(); a++) {
    const iniA = new Date(Math.max(inicioAguinaldo, new Date(a, 0, 1)))
    const finA = new Date(Math.min(baja,            new Date(a, 11, 31)))
    const dias = Math.max(0, Math.floor((finA - iniA) / 86_400_000) + 1)
    aguinaldo += (dias / 365) * (esEspecial ? sal : salarioMinimoVigente(a))
  }
  aguinaldo = round(aguinaldo)

  // Bono 14 proporcional (1 jul - 30 jun). Misma logica: cap en fecha_ingreso.
  const inicioPeriodoBono14 = baja.getMonth() >= 6
    ? new Date(baja.getFullYear(), 6, 1)
    : new Date(baja.getFullYear() - 1, 6, 1)
  const inicioBono14 = ingreso > inicioPeriodoBono14 ? ingreso : inicioPeriodoBono14
  const diasBono14 = Math.max(0, Math.floor((baja - inicioBono14) / 86_400_000) + 1)
  let bono14 = 0
  for (let a = inicioBono14.getFullYear(); a <= baja.getFullYear(); a++) {
    const iniA = new Date(Math.max(inicioBono14, new Date(a, 0, 1)))
    const finA = new Date(Math.min(baja,         new Date(a, 11, 31)))
    const dias = Math.max(0, Math.floor((finA - iniA) / 86_400_000) + 1)
    bono14 += (dias / 365) * (esEspecial ? sal : salarioMinimoVigente(a))
  }
  bono14 = round(bono14)

  // Salario pendiente
  const salarioPendiente = round((Number(diasSalarioPendiente) || 0) * salDia)
  const dedNum = Number(deducciones) || 0

  const totalBruto = round(indemnizacion + preaviso + vacaciones + aguinaldo + bono14 + salarioPendiente)
  const totalNeto  = round(totalBruto - dedNum)

  return {
    aniosTrabajados: round(aniosTrabajados),
    mesesTrabajados, diasTrabajados: diasTotal,
    salProm6m,
    indemnizacion, preaviso,
    vacaciones, diasVacProporcionales,
    aguinaldo, diasAguinaldo,
    bono14, diasBono14,
    salarioPendiente, diasSalarioPendiente: Number(diasSalarioPendiente) || 0,
    totalBruto,
    deducciones: dedNum,
    totalNeto,
  }
}

export { SALARIO_MIN_HISTORICO, salarioMinimoVigente }
