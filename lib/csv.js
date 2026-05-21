// lib/csv.js
// Parser CSV simple con deteccion automatica de columnas por aliases.
//
// Uso:
//   const { rows, detectado, errores } = parseCSVconAliases(texto, {
//     nombre:    ['nombre', 'name', 'producto'],
//     categoria: ['categoria', 'category'],
//     unidad:    ['unidad', 'unit', 'um'],
//   })
//
// - Detecta separador (`,` vs `;`).
// - Normaliza encabezados (lowercase, sin acentos).
// - rows[i][campo] = string crudo de la celda (puede ser '').
// - detectado[campo] = indice de columna usada (null si no encontrada).
// - errores: lista de problemas por fila.

function norm(s) {
  return String(s || '').toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function parseCSVconAliases(text, schema, opts = {}) {
  const { camposRequeridos = [] } = opts

  if (!text || !text.trim()) throw new Error('CSV vacio')

  // Detectar separador con la primera linea
  const linea1 = text.split(/\r?\n/)[0] || ''
  const sep = linea1.split(';').length > linea1.split(',').length ? ';' : ','

  const filasCrudas = text.split(/\r?\n/).filter(l => l.trim())
    .map(l => l.split(sep).map(c => c.trim().replace(/^"|"$/g, '')))
  if (filasCrudas.length < 2) throw new Error('CSV sin filas de datos (solo header o vacio)')

  const headers = filasCrudas[0].map(norm)
  const detectado = {}
  for (const [campo, aliases] of Object.entries(schema)) {
    detectado[campo] = null
    for (const a of aliases) {
      const idx = headers.indexOf(norm(a))
      if (idx >= 0) { detectado[campo] = idx; break }
    }
  }

  for (const c of camposRequeridos) {
    if (detectado[c] == null) {
      throw new Error(`Falta columna obligatoria "${c}" (acepta: ${schema[c].join(', ')})`)
    }
  }

  const rows = []
  const errores = []
  for (let i = 1; i < filasCrudas.length; i++) {
    const fila = filasCrudas[i]
    const row = {}
    for (const campo of Object.keys(schema)) {
      const idx = detectado[campo]
      row[campo] = idx != null ? (fila[idx] ?? '').trim() : ''
    }
    rows.push(row)
  }

  return { rows, detectado, headers, separador: sep, errores }
}

// Helpers de parseo numerico tolerante
export function parseNumber(s) {
  if (s == null || s === '') return null
  const n = parseFloat(String(s).replace(/[Q$,\s]/g, ''))
  return isNaN(n) ? null : n
}

// YYYY-MM-DD o DD/MM/YYYY -> YYYY-MM-DD
export function parseFechaISO(s) {
  if (!s) return null
  s = String(s).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (m) {
    const [, d, mo, y] = m
    const yyyy = y.length === 2 ? '20' + y : y
    return `${yyyy}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`
  }
  return null
}
