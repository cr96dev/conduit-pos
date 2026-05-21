// Script ad-hoc para parsear el Excel de costeo de Julia Bakery.
// Lee /Users/cjrh/Downloads/Julia_Bakery_Costeo_Recetas.xlsx
// Imprime JSON con { insumos: [...], recetas: [...] }
//
// Estructura del Excel:
//   Hoja "ÍNDICE": tabla resumen (ignorada para extraccion; usamos las hojas individuales)
//   Una hoja por receta. Estructura:
//     [0] titulo "🍰  NOMBRE"
//     [1] "Rinde: N  |  notas"
//     [2] "INGREDIENTES Y COSTEO"
//     [3] headers: INGREDIENTE | PROVEEDOR | CANTIDAD | UNIDAD | PRECIO PAQUETE | PESO PAQUETE | COSTO/g | COSTO LINEA
//     [4..] filas de ingredientes; las que tienen INGREDIENTE vacío y la celda 6 = "COSTO TOTAL"/"COSTO / UNIDAD" se ignoran

const XLSX = require('xlsx')
const path = process.argv[2] || '/Users/cjrh/Downloads/Julia_Bakery_Costeo_Recetas.xlsx'

const wb = XLSX.readFile(path)

const insumosMap = new Map() // key = nombre normalizado, value = { nombre, proveedor, costo_unitario_g }
const recetas = []

function normNombre(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toUpperCase()
}

for (const hojaName of wb.SheetNames) {
  if (hojaName === 'ÍNDICE') continue

  const rows = XLSX.utils.sheet_to_json(wb.Sheets[hojaName], { defval: '', header: 1 })
  if (rows.length < 5) continue

  // Extraer rinde + notas de la fila 1
  const rindeText = String(rows[1]?.[0] || '')
  const rindeMatch = rindeText.match(/Rinde:\s*([\d.]+)\s*\|\s*(.*)/)
  const rinde = rindeMatch ? parseFloat(rindeMatch[1]) : 1
  const notas = rindeMatch ? rindeMatch[2].trim() : ''

  // Nombre receta (limpiar emoji de la fila 0)
  const titulo = String(rows[0]?.[0] || '').replace(/[🍰🥖🥐🎂]/g, '').trim() || hojaName

  const ingredientes = []
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i]
    const nombre = String(r[0] || '').trim()
    const cantidad = parseFloat(r[2])
    const unidad = String(r[3] || '').trim()
    const costoG = parseFloat(r[6])

    // Filtrar filas vacias o totales
    if (!nombre || isNaN(cantidad) || cantidad <= 0) continue
    if (String(r[6]).toUpperCase().includes('COSTO')) continue

    const proveedor = String(r[1] || '').trim()
    ingredientes.push({ nombre, proveedor, cantidad, unidad, costo_por_g: costoG })

    // Acumular insumo unico
    const key = normNombre(nombre)
    if (!insumosMap.has(key)) {
      insumosMap.set(key, {
        nombre,
        proveedor: proveedor || null,
        unidad: 'g',
        costo_unitario: costoG, // Q por gramo
      })
    } else if (!insumosMap.get(key).costo_unitario && !isNaN(costoG)) {
      insumosMap.get(key).costo_unitario = costoG
    }
  }

  recetas.push({
    nombre: titulo,
    rinde_cantidad: rinde,
    rinde_unidad: 'unidad',
    notas,
    ingredientes,
  })
}

const insumos = Array.from(insumosMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre))

console.log(JSON.stringify({ insumos, recetas }, null, 2))
