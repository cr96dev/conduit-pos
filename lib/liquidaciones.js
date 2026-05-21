// lib/liquidaciones.js
// Calculo de prestaciones laborales segun Codigo de Trabajo de Guatemala.
//
// - Indemnizacion (Art. 82): solo despido injustificado.
//     Base = salario promedio ultimos 6 meses × años trabajados
//     Requiere >= 1 año (o >= 6 meses se prorratea).
// - Preaviso (Art. 78): solo despido injustificado.
//     >= 2 años: 1 mes de salario. >= 6 meses < 2 años: proporcional.
// - Vacaciones proporcionales: dias_pendientes_anio × salario/30.
//     15 dias por año cumplido. Solo del año en curso (la fraccion).
// - Aguinaldo proporcional: dias del periodo (1 dic - 30 nov) ponderados.
// - Bono 14 proporcional: dias del periodo (1 jul - 30 jun) ponderados.
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

  // Indemnizacion
  let indemnizacion = 0
  if (tipoBaja === 'despido_injustificado') {
    if (aniosTrabajados >= 1) indemnizacion = round(salProm6m * aniosTrabajados)
    else if (mesesTrabajados >= 6) indemnizacion = round(salProm6m * (mesesTrabajados / 12))
  }

  // Preaviso
  let preaviso = 0
  if (tipoBaja === 'despido_injustificado') {
    if (aniosTrabajados >= 2) preaviso = sal
    else if (mesesTrabajados >= 6) preaviso = round(sal * (mesesTrabajados / 24))
  }

  // Vacaciones proporcionales: dias por la fraccion de año del año actual
  const diasVacProporcionales = round((aniosTrabajados % 1) * 15)
  const vacaciones = round(diasVacProporcionales * salDia)

  // Aguinaldo proporcional (1 dic - 30 nov)
  const inicioAguinaldo = baja.getMonth() >= 11
    ? new Date(baja.getFullYear(), 11, 1)
    : new Date(baja.getFullYear() - 1, 11, 1)
  const diasAguinaldo = Math.max(0, Math.floor((baja - inicioAguinaldo) / 86_400_000))
  let aguinaldo = 0
  for (let a = inicioAguinaldo.getFullYear(); a <= baja.getFullYear(); a++) {
    const iniA = new Date(Math.max(inicioAguinaldo, new Date(a, 0, 1)))
    const finA = new Date(Math.min(baja,            new Date(a, 11, 31)))
    const dias = Math.max(0, Math.floor((finA - iniA) / 86_400_000) + 1)
    aguinaldo += (dias / 365) * (esEspecial ? sal : salarioMinimoVigente(a))
  }
  aguinaldo = round(aguinaldo)

  // Bono 14 proporcional (1 jul - 30 jun)
  const inicioBono14 = baja.getMonth() >= 6
    ? new Date(baja.getFullYear(), 6, 1)
    : new Date(baja.getFullYear() - 1, 6, 1)
  const diasBono14 = Math.max(0, Math.floor((baja - inicioBono14) / 86_400_000))
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
