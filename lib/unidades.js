// lib/unidades.js
// Tabla de conversion entre unidades de medida y helpers para convertir
// cantidades y costos. Se usa en la API de insumos (derivar costo_unitario
// desde la presentacion de compra) y en la API de compras (recibir una
// linea para meter el delta correcto al inventario).
//
// Filosofia: si la unidad de origen y la de destino son CONOCIDAS y pertenecen
// a la misma categoria (peso/volumen/conteo), se convierte automaticamente.
// Si no se reconocen, devolvemos null y el llamador hace el fallback legacy
// (interpretar la cantidad como si ya estuviera en la unidad de destino).
//
// Convenciones:
// - Todo se normaliza a su unidad canonica de categoria: gramo, mililitro, unidad.
// - El "factor" guardado es: cuantas unidades canonicas hay en UNA unidad de esta etiqueta.
// - Para que el match sea robusto, parseUnidad normaliza: minusculas, sin
//   acentos, sin espacios, sin plurales obvios ("libras" -> "libra").

const PESO = 'peso'
const VOL  = 'volumen'
const CONTEO = 'conteo'

// Cada entry mapea un alias normalizado a { categoria, factor }.
// factor = cuantas unidades canonicas hay en UNA de esta unidad.
// canonicas: peso=g, volumen=ml, conteo=unidad.
const UNIDADES = {
  // ── Peso ────────────────────────────────────────────────────────────────
  g:    { categoria: PESO, factor: 1 },
  gr:   { categoria: PESO, factor: 1 },
  gramo: { categoria: PESO, factor: 1 },
  kg:   { categoria: PESO, factor: 1000 },
  kilo: { categoria: PESO, factor: 1000 },
  kilogramo: { categoria: PESO, factor: 1000 },
  mg:   { categoria: PESO, factor: 0.001 },
  miligramo: { categoria: PESO, factor: 0.001 },
  lb:   { categoria: PESO, factor: 453.59237 },
  libra: { categoria: PESO, factor: 453.59237 },
  oz:   { categoria: PESO, factor: 28.349523125 },
  onza: { categoria: PESO, factor: 28.349523125 },
  // Quintal "corto" guatemalteco = 100 libras (uso comun en granos, harinas).
  quintal: { categoria: PESO, factor: 100 * 453.59237 }, // 45359.237 g
  qq:      { categoria: PESO, factor: 100 * 453.59237 },
  arroba:  { categoria: PESO, factor: 25 * 453.59237 }, // 25 lb en GT
  ton:     { categoria: PESO, factor: 1_000_000 },
  tonelada: { categoria: PESO, factor: 1_000_000 },

  // ── Volumen ─────────────────────────────────────────────────────────────
  ml:   { categoria: VOL, factor: 1 },
  mililitro: { categoria: VOL, factor: 1 },
  cc:   { categoria: VOL, factor: 1 },
  lt:   { categoria: VOL, factor: 1000 },
  l:    { categoria: VOL, factor: 1000 },
  litro: { categoria: VOL, factor: 1000 },
  gal:  { categoria: VOL, factor: 3785.411784 },
  galon: { categoria: VOL, factor: 3785.411784 },
  // "Onza fluida" US.
  flOz: { categoria: VOL, factor: 29.5735295625 },
  taza: { categoria: VOL, factor: 240 },        // taza de cocina (ml)
  cucharada: { categoria: VOL, factor: 15 },    // cda
  cda:  { categoria: VOL, factor: 15 },
  cucharadita: { categoria: VOL, factor: 5 },
  cdta: { categoria: VOL, factor: 5 },

  // ── Conteo ──────────────────────────────────────────────────────────────
  unidad: { categoria: CONTEO, factor: 1 },
  und:    { categoria: CONTEO, factor: 1 },
  u:      { categoria: CONTEO, factor: 1 },
  pieza:  { categoria: CONTEO, factor: 1 },
  pz:     { categoria: CONTEO, factor: 1 },
  docena: { categoria: CONTEO, factor: 12 },
  doc:    { categoria: CONTEO, factor: 12 },
  ciento: { categoria: CONTEO, factor: 100 },
  cien:   { categoria: CONTEO, factor: 100 },
  millar: { categoria: CONTEO, factor: 1000 },
  par:    { categoria: CONTEO, factor: 2 },
}

// Lista de presets sugeridos para los dropdowns en la UI, agrupados.
export const PRESETS_UI = {
  peso: [
    { value: 'g',  label: 'gramos (g)' },
    { value: 'kg', label: 'kilogramos (kg)' },
    { value: 'lb', label: 'libras (lb)' },
    { value: 'oz', label: 'onzas (oz)' },
    { value: 'quintal', label: 'quintal (100 lb)' },
    { value: 'arroba', label: 'arroba (25 lb)' },
  ],
  volumen: [
    { value: 'ml',    label: 'mililitros (ml)' },
    { value: 'lt',    label: 'litros (lt)' },
    { value: 'galon', label: 'galón' },
    { value: 'taza',  label: 'taza (240 ml)' },
  ],
  conteo: [
    { value: 'unidad', label: 'unidad' },
    { value: 'docena', label: 'docena (12)' },
    { value: 'ciento', label: 'ciento (100)' },
    { value: 'par',    label: 'par (2)' },
  ],
}

// Normaliza un texto a una clave conocida de UNIDADES, o null.
// "Libras" -> "libra" -> { categoria: PESO, factor: 453.59 }
export function parseUnidad(texto) {
  if (texto == null) return null
  let s = String(texto).trim().toLowerCase()
  if (!s) return null
  // Quitar acentos (combining diacritical marks U+0300-U+036F).
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  // Quitar espacios internos y signos.
  s = s.replace(/\s+/g, '').replace(/\./g, '')
  // Plurales obvios: la s final no agrega significado para nuestras unidades.
  // Cuidamos no romper "ml" o "g": no terminan en 's'.
  if (s.endsWith('s') && s.length > 2) s = s.slice(0, -1)
  // Aliases puntuales que sobreviven al strip.
  const alias = {
    'libra':       'libra',
    'libar':       'libra',
    'kilogramos':  'kilo',
    'kilogramo':   'kilo',
    'gramos':      'g',
    'gramo':       'g',
    'mililitros':  'ml',
    'mililitro':   'ml',
    'litros':      'lt',
    'litro':       'lt',
    'onzas':       'oz',
    'onza':        'oz',
    'galon':       'galon',
    'galone':      'galon', // 'galones' -> 'galone' tras quitar la 's'
    'quintale':    'quintal',
    'docena':      'docena',
    'pieza':       'pieza',
    'piesa':       'pieza',
    'unidade':     'unidad',
    'tonelada':    'tonelada',
    'arroba':      'arroba',
    'cciento':     'ciento',
  }
  if (alias[s]) s = alias[s]
  return UNIDADES[s] ? { clave: s, ...UNIDADES[s] } : null
}

// Factor para convertir UNA unidad de tipo "de" a unidades de tipo "a".
// Devuelve un numero, o null si no se puede (unidades desconocidas o de
// categorias distintas). Si "de" y "a" son la MISMA clave, devuelve 1.
export function factorEntre(de, a) {
  const ud = parseUnidad(de)
  const ua = parseUnidad(a)
  if (!ud || !ua) return null
  if (ud.categoria !== ua.categoria) return null
  return ud.factor / ua.factor
}

// True si dos etiquetas de unidad representan la MISMA unidad real
// (mismo factor canonico). Tolera sinonimos: 'lb' === 'libra' === 'libras',
// 'kg' === 'kilo' === 'kilogramos'. Si una es desconocida, cae a comparacion
// case-insensitive sobre el texto crudo.
export function mismaUnidad(a, b) {
  if (a == null || b == null) return false
  const ua = parseUnidad(a)
  const ub = parseUnidad(b)
  if (ua && ub) return ua.categoria === ub.categoria && ua.factor === ub.factor
  if (!ua && !ub) return String(a).trim().toLowerCase() === String(b).trim().toLowerCase()
  return false
}

// Convierte una cantidad de la unidad "de" a la unidad "a".
// Si no se puede convertir, devuelve null.
export function convertir(cantidad, de, a) {
  const f = factorEntre(de, a)
  if (f == null) return null
  return Number(cantidad) * f
}

// Helper publico: dado un insumo con presentacion de compra, devuelve cuantas
// unidades base hay en UNA unidad de compra.
//
//   { unidad: 'g', unidad_compra: 'lb', cantidad_por_unidad_compra: 25 }
//   -> 25 lb * 453.592 g/lb = 11339.81 g
//
//   { unidad: 'g', unidad_compra: 'saco', cantidad_por_unidad_compra: 11340 }
//   -> 'saco' no se reconoce; asumimos que cantidad_por_unidad_compra YA esta
//      en unidad base -> 11340
//
// Si falta cualquiera de los 3, devuelve null.
export function unidadesBasePorCompra({ unidad, unidad_compra, cantidad_por_unidad_compra }) {
  if (cantidad_por_unidad_compra == null || cantidad_por_unidad_compra === '') return null
  const cant = Number(cantidad_por_unidad_compra)
  if (!Number.isFinite(cant) || cant <= 0) return null
  // Sin unidad_compra: legacy. La cantidad ya esta en unidad base.
  if (!unidad_compra) return cant
  const f = factorEntre(unidad_compra, unidad)
  if (f == null) return cant // unidad_compra no estandar (saco, caja, etc.)
  return cant * f
}

// Deriva el costo por UNIDAD BASE a partir de la presentacion de compra.
// Aplica conversion si las unidades se reconocen.
export function derivarCostoUnitario({
  unidad,
  unidad_compra,
  cantidad_por_unidad_compra,
  costo_compra,
  costo_unitario_crudo,
}) {
  const cc = costo_compra
  if (cc == null || cc === '') return castNum(costo_unitario_crudo)
  const unBase = unidadesBasePorCompra({ unidad, unidad_compra, cantidad_por_unidad_compra })
  if (unBase != null && unBase > 0) {
    return round4(Number(cc) / unBase)
  }
  return castNum(costo_unitario_crudo)
}

function castNum(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function round4(n) {
  return Math.round(n * 10000) / 10000
}
