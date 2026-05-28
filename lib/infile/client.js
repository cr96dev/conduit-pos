// lib/infile/client.js
// Cliente HTTP para Infile/FEEL (certificador FEL en Guatemala).
//
// Contrato (reverse-engineered de XMLs reales certificados por INFILE, S.A.):
//
//   1) FIRMAR
//      POST {config.infile_url_firma}
//      Content-Type: application/json
//      body: { llave, archivo (xml base64), codigo, alias, es_anulacion ('N'|'Y') }
//      resp: { resultado: bool, archivo: string (xml firmado base64), descripcion?: string }
//
//   2) CERTIFICAR
//      POST {config.infile_url_cert}
//      headers: usuario, llave, identificador  (identificador = mismo `codigo` del paso 1)
//      body: { nit_emisor, correo_copia, xml_dte (string base64) }
//      resp ok: { resultado: true, uuid, serie, numero, xml_certificado }
//      resp err: { resultado: false, descripcion?: string, descripcion_errores?: [{ mensaje_error }] }
//
//   3) CONSULTAR NIT
//      POST {config.infile_url_consulta_nit}
//      body: { emisor_codigo, emisor_clave, nit_consulta }
//      resp: { nit, nombre, ... } | { mensaje: '...' }
//
// La firma corre en el servidor remoto de Infile; NO necesitamos certificado
// X.509 local. La clave privada SAT la custodia Infile.
//
// Las credenciales viven en la tabla config_fel y se pasan a crearCliente(config).
// Nunca hardcodear creds en este archivo.

// Arma la lista de frases SAT a partir de la config del emisor.
// Base: [{ escenario:1, tipo:1 }] (Frase IVA). Concatena las extras desde
// config.infile_frases_extras (jsonb) si existen (ej. agente de retencion).
// Dedupe por par (escenario, tipo).
export function frasesDesdeConfig(config) {
  const out = [{ escenario: 1, tipo: 1 }]
  const extras = Array.isArray(config?.infile_frases_extras) ? config.infile_frases_extras : []
  const seen = new Set([`1|1`])
  for (const f of extras) {
    const esc = Number(f?.escenario)
    const tipo = Number(f?.tipo)
    if (!Number.isFinite(esc) || !Number.isFinite(tipo)) continue
    const key = `${esc}|${tipo}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ escenario: esc, tipo })
  }
  return out
}

export class InfileError extends Error {
  constructor(message, { status, payload, etapa } = {}) {
    super(message)
    this.name = 'InfileError'
    this.status = status
    this.payload = payload
    this.etapa = etapa  // 'firma' | 'certificacion' | 'consulta_nit' | 'anulacion'
  }
}

function requerirConfig(config) {
  if (!config) throw new InfileError('config_fel no encontrada')
  const faltantes = []
  for (const k of ['infile_url_firma', 'infile_url_cert', 'infile_alias_firma', 'infile_llave_firma', 'infile_llave_cert', 'nit_emisor']) {
    if (!config[k]) faltantes.push(k)
  }
  if (faltantes.length > 0) {
    throw new InfileError(`Faltan campos en config_fel: ${faltantes.join(', ')}`)
  }
}

async function postJson(url, body, headers = {}, { etapa, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    throw new InfileError(`Error de red llamando a Infile (${etapa}): ${e.message}`, { etapa })
  } finally {
    clearTimeout(t)
  }
  const text = await resp.text()
  let payload = text
  try { payload = JSON.parse(text) } catch { /* respuesta no JSON */ }
  if (!resp.ok) {
    throw new InfileError(`Infile ${etapa} HTTP ${resp.status}: ${text.slice(0, 400)}`, { status: resp.status, payload, etapa })
  }
  return payload
}

function toBase64(s) {
  return Buffer.from(s, 'utf8').toString('base64')
}

export function crearCliente(config) {
  requerirConfig(config)

  const aliasFirma  = config.infile_alias_firma
  const llaveFirma  = config.infile_llave_firma
  const usuarioCert = config.infile_usuario_cert || config.infile_alias_firma  // suele coincidir
  const llaveCert   = config.infile_llave_cert
  const urlFirma    = config.infile_url_firma
  const urlCert     = config.infile_url_cert
  const urlNit      = config.infile_url_consulta_nit
  const nitEmisor   = String(config.nit_emisor || '').replace(/-/g, '').trim()

  // 1) Firma del XML por servicio remoto. Devuelve XML firmado en base64.
  async function firmar(xmlPlano, codigoInterno, { anulacion = false } = {}) {
    const xmlBase64 = toBase64(xmlPlano)
    const body = {
      llave: llaveFirma,
      archivo: xmlBase64,
      codigo: codigoInterno,
      alias: aliasFirma,
      es_anulacion: anulacion ? 'Y' : 'N',
    }
    const resp = await postJson(urlFirma, body, {}, { etapa: 'firma' })
    if (!resp || resp.resultado !== true) {
      const msg = resp?.descripcion || resp?.descripcion_errores?.[0]?.mensaje_error || 'Firma rechazada'
      throw new InfileError(`Firma rechazada: ${msg}`, { payload: resp, etapa: 'firma' })
    }
    if (!resp.archivo) {
      throw new InfileError('Firma sin campo `archivo` en la respuesta', { payload: resp, etapa: 'firma' })
    }
    return resp.archivo  // XML firmado en base64
  }

  // 2) Certificacion SAT via Infile. Recibe XML firmado en base64.
  // Devuelve { uuid, serie, numero, xml_certificado, raw }.
  async function certificar(xmlFirmadoBase64, codigoInterno, { correoCopia = '' } = {}) {
    const body = {
      nit_emisor: nitEmisor,
      correo_copia: correoCopia || '',
      xml_dte: xmlFirmadoBase64,
    }
    const headers = { usuario: usuarioCert, llave: llaveCert, identificador: codigoInterno }
    const resp = await postJson(urlCert, body, headers, { etapa: 'certificacion' })
    if (!resp || resp.resultado !== true) {
      const msg = resp?.descripcion
        || resp?.descripcion_errores?.[0]?.mensaje_error
        || 'Certificador rechazo el DTE'
      throw new InfileError(`Certificacion rechazada: ${msg}`, { payload: resp, etapa: 'certificacion' })
    }
    return {
      uuid: resp.uuid || null,
      serie: resp.serie || null,
      numero: resp.numero || null,
      xml_certificado: resp.xml_certificado || null,
      raw: resp,
    }
  }

  // Helper de alto nivel: firma y certifica en un solo paso.
  async function firmarYCertificar(xmlPlano, codigoInterno, { correoCopia = '' } = {}) {
    const xmlFirmado = await firmar(xmlPlano, codigoInterno)
    return certificar(xmlFirmado, codigoInterno, { correoCopia })
  }

  // 3) Anulacion. El XML de anulacion se firma con es_anulacion='Y' y luego
  //    se envia al certificador igual que un DTE normal. Si Infile expone un
  //    endpoint de anulacion distinto, se ajusta aca.
  async function anular(xmlAnulacionPlano, codigoInterno, { correoCopia = '' } = {}) {
    const xmlFirmado = await firmar(xmlAnulacionPlano, codigoInterno, { anulacion: true })
    return certificar(xmlFirmado, codigoInterno, { correoCopia })
  }

  // 4) Consulta de NIT receptor. Devuelve { nit, nombre } | null si no existe.
  async function consultarNit(nit) {
    if (!urlNit) throw new InfileError('infile_url_consulta_nit no configurada', { etapa: 'consulta_nit' })
    const nitLimpio = String(nit || '').replace(/-/g, '').trim()
    if (!nitLimpio) throw new InfileError('NIT vacio', { etapa: 'consulta_nit' })
    const body = {
      emisor_codigo: aliasFirma,
      emisor_clave: llaveCert,
      nit_consulta: nitLimpio,
    }
    const resp = await postJson(urlNit, body, {}, { etapa: 'consulta_nit' })
    const nombreRaw = (resp?.nombre || '').trim()
    const mensaje = (resp?.mensaje || '').trim()
    if (nombreRaw) {
      // "ROLDAN,HERNANDEZ,,CARLOS,JAVIER" -> "ROLDAN HERNANDEZ CARLOS JAVIER"
      const nombre = nombreRaw.split(',').map(s => s.trim()).filter(Boolean).join(' ')
      return { nit: resp.nit || nitLimpio, nombre, raw: resp }
    }
    if (mensaje) return { nit: nitLimpio, nombre: null, no_encontrado: true, mensaje, raw: resp }
    return { nit: nitLimpio, nombre: null, no_encontrado: true, raw: resp }
  }

  return {
    config,
    firmar,
    certificar,
    firmarYCertificar,
    anular,
    consultarNit,
  }
}
