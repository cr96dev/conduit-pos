// lib/recetas.js
// Helpers de costeo de recetas.
//
// costo_por_unidad_vendida = (sum(ingrediente.cantidad * costo_unitario) / rinde_cantidad)
//                            * (1 + merma_pct / 100)

const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

export function calcularCostoReceta({ ingredientes, rinde_cantidad, merma_pct }) {
  const rinde = Math.max(Number(rinde_cantidad) || 1, 0.0001)
  const merma = (Number(merma_pct) || 0) / 100
  let totalCosto = 0
  for (const i of ingredientes || []) {
    const c = (Number(i.cantidad) || 0) * (Number(i.costo_unitario_snapshot) || 0)
    totalCosto += c
  }
  const porUnidad = (totalCosto / rinde) * (1 + merma)
  return round4(porUnidad)
}

export function calcularMargen(costo, precio) {
  if (!precio || precio <= 0) return null
  return Math.round(((precio - costo) / precio) * 100 * 100) / 100
}
