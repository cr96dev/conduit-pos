// lib/contabilidad/mappings.js
// Helpers para leer la tabla contabilidad_mappings.
// Cachea durante la vida del request (no entre requests).

export async function cargarMappings(admin) {
  const { data, error } = await admin
    .from('contabilidad_mappings').select('clave, cuenta_id')
  if (error) throw new Error('Error leyendo mappings: ' + error.message)
  const out = {}
  for (const m of data || []) out[m.clave] = m.cuenta_id
  return out
}

// Devuelve la cuenta_id del mapping, o lanza error claro si falta.
// Usar en el generador para abortar generacion (sin romper el flujo de negocio)
// si una cuenta clave no esta configurada.
export class MappingFaltante extends Error {
  constructor(clave) {
    super(`Mapping contable faltante: "${clave}". Configurar en /contabilidad > Configuración.`)
    this.clave = clave
    this.name = 'MappingFaltante'
  }
}

export function requireCuenta(mappings, clave) {
  const id = mappings[clave]
  if (!id) throw new MappingFaltante(clave)
  return id
}
