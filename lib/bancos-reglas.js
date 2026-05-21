// lib/bancos-reglas.js
// Aplica las reglas activas de clasificacion a un movimiento bancario.
// Devuelve la primera regla que matchee (por prioridad asc) o null.

function matchea(patron, tipo, descripcion) {
  if (!patron || !descripcion) return false
  const desc = descripcion.toLowerCase()
  const p = patron.toLowerCase()
  if (tipo === 'starts_with') return desc.startsWith(p)
  if (tipo === 'regex') {
    try { return new RegExp(patron, 'i').test(descripcion) } catch { return false }
  }
  return desc.includes(p)
}

export function aplicarReglas(reglas, mov) {
  if (!reglas || !reglas.length) return null
  const esDebito = Number(mov.debito) > 0
  for (const r of reglas) {
    if (!r.activa) continue
    if (r.aplica_a === 'debito'  && !esDebito) continue
    if (r.aplica_a === 'credito' && esDebito)  continue
    if (matchea(r.patron, r.tipo_match, mov.descripcion)) {
      return r
    }
  }
  return null
}
