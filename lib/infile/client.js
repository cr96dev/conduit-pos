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
//   4) CONSULTAR CUI (DPI personas naturales)
//      Requiere JWT primero (login):
//        POST https://certificador.feel.com.gt/api/v2/servicios/externos/login
//        form-data: { prefijo, llave }
//        resp: { token, fecha_de_vencimiento }  (token dura 2h)
//      Luego:
//        POST https://certificador.feel.com.gt/api/v2/servicios/externos/cui
//        Authorization: Bearer <token>
//        form-data: { cui }
//        resp: { resultado, cui: { cui, nombre, fallecido } }
//      Limite: 50 logins/dia por emisor — cacheamos el token en memoria.
//
// La firma corre en el servidor remoto de Infile; NO necesitamos certificado
// X.509 local. La clave privada SAT la custodia Infile.
//
// Las credenciales viven en la tabla config_fel y se pasan a crearCliente(config).
// Nunca hardcodear creds en este archivo.

// Arma la lista de frases SAT a partir de la config del emisor.
//
// Politica:
//   - Si config.infile_frases_extras tiene >= 1 entradas validas,
//     se usan EXCLUSIVAMENTE esas (override completo del default).
//   - Si no, default = [{ escenario:1, tipo:1 }] (Frase IVA / General).
//
// Esto permite que un emisor en regimen no-general (ej. WEIRD DOUGH bajo
// "Frases de Retencion de ISR" con esc=3 tipo=1) pueda definir su frase
// correcta SIN heredar la del general que SAT rechaza (FEL-GUI-30 2.6.1).
//
// El dedupe sigue activo si pasan duplicados en extras.
export function frasesDesdeConfig(config) {
  const raw = Array.isArray(config?.infile_frases_extras) ? config.infile_frases_extras : []
  const seen = new Set()
  const validas = []
  for (const f of raw) {
    const esc = Number(f?.escenario)
    const tipo = Number(f?.tipo)
    if (!Number.isFinite(esc) || !Number.isFinite(tipo)) continue
    const key = `${esc}|${tipo}`
    if (seen.has(key)) continue
    seen.add(key)
    // Preservar numeroResolucion / fechaResolucion si vienen — son
    // requeridos por SAT para escenarios especiales (esc=3, esc=5).
    const entry = { escenario: esc, tipo }
    if (f.numeroResolucion) entry.numeroResolucion = String(f.numeroResolucion)
    if (f.fechaResolucion)  entry.fechaResolucion  = String(f.fechaResolucion)
    validas.push(entry)
  }
  if (validas.length > 0) return validas
  // Fallback: regimen general standard.
  return [{ escenario: 1, tipo: 1 }]
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

// Post form-data (Infile CUI endpoint usa form-data, no JSON)
async function postForm(url, formFields, headers = {}, { etapa, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  const fd = new URLSearchParams()
  for (const [k, v] of Object.entries(formFields)) fd.append(k, String(v ?? ''))
  let resp
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
      body: fd.toString(),
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

// Cache global del token JWT para consultas CUI. Key = prefijo (cada emisor
// tiene su propio token). En serverless Vercel Fluid Compute las instancias
// se reusan entre invocaciones, por eso el cache sirve. Si la instancia se
// recicla, simplemente hacemos login otra vez — Infile permite hasta 50
// logins/dia por emisor, asi que con cache decente alcanza para >1000 consultas.
const _cuiTokenCache = new Map()  // prefijo -> { token, expiraEnMs }
const CUI_TOKEN_MARGEN_MS = 10 * 60 * 1000  // refrescar 10 min antes de expirar

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

  // 5) Consulta de CUI (DPI personas naturales). Devuelve
  //    { cui, nombre, fallecido: bool } | { no_encontrado: true, mensaje }.
  //
  //    Requiere login JWT primero (token cacheado 2h con margen de 10 min).
  //    Bloquea facturas a personas fallecidas con un error claro al cajero.
  async function consultarCui(cui) {
    const cuiLimpio = String(cui || '').replace(/\D/g, '')
    if (!cuiLimpio) throw new InfileError('CUI vacio', { etapa: 'consulta_cui' })
    if (cuiLimpio.length !== 13) {
      throw new InfileError(`CUI invalido: debe ser 13 digitos (recibido ${cuiLimpio.length})`, { etapa: 'consulta_cui' })
    }

    // URLs por defecto (override opcional via config_fel)
    const urlLogin   = config.infile_url_consulta_cui_login || 'https://certificador.feel.com.gt/api/v2/servicios/externos/login'
    const urlConsulta = config.infile_url_consulta_cui || 'https://certificador.feel.com.gt/api/v2/servicios/externos/cui'

    // Token cacheado
    const ahora = Date.now()
    const cacheKey = aliasFirma
    let cached = _cuiTokenCache.get(cacheKey)
    let token = (cached && cached.expiraEnMs > ahora + CUI_TOKEN_MARGEN_MS) ? cached.token : null

    if (!token) {
      // Login (form-data: prefijo, llave). El "prefijo" es el alias_firma,
      // la "llave" es la misma llave del certificador.
      const loginResp = await postForm(urlLogin, {
        prefijo: aliasFirma,
        llave: llaveCert,
      }, {}, { etapa: 'consulta_cui_login' })

      if (!loginResp?.resultado || !loginResp?.token) {
        throw new InfileError(
          `Login CUI rechazado: ${loginResp?.descripcion || 'sin detalle'}`,
          { payload: loginResp, etapa: 'consulta_cui_login' }
        )
      }
      token = loginResp.token
      // fecha_de_vencimiento viene como "2022-12-15T13:58:17-06:00" o similar
      const expira = loginResp.fecha_de_vencimiento
        ? new Date(loginResp.fecha_de_vencimiento).getTime()
        : ahora + 2 * 60 * 60 * 1000  // fallback 2h
      _cuiTokenCache.set(cacheKey, { token, expiraEnMs: expira })
    }

    // Consulta
    const resp = await postForm(urlConsulta, { cui: cuiLimpio }, {
      Authorization: `Bearer ${token}`,
    }, { etapa: 'consulta_cui' })

    if (!resp?.resultado || !resp?.cui) {
      return {
        cui: cuiLimpio,
        nombre: null,
        no_encontrado: true,
        mensaje: resp?.descripcion || 'No encontrado',
        raw: resp,
      }
    }

    const datos = resp.cui
    const nombreRaw = (datos.nombre || '').trim()
    // "ROLDAN,HERNANDEZ,,CARLOS,JAVIER" -> "ROLDAN HERNANDEZ CARLOS JAVIER"
    const nombre = nombreRaw.split(',').map(s => s.trim()).filter(Boolean).join(' ')
    const fallecido = String(datos.fallecido || '').toUpperCase() === 'SI'
    return {
      cui: datos.cui || cuiLimpio,
      nombre,
      fallecido,
      raw: resp,
    }
  }

  return {
    config,
    firmar,
    certificar,
    firmarYCertificar,
    anular,
    consultarNit,
    consultarCui,
  }
}
