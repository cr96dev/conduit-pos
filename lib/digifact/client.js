// lib/digifact/client.js
// Cliente HTTP para la API REST de Digifact (FEL Guatemala).
//
// Estado: SCAFFOLDED. Los endpoints exactos y el esquema XML DTE se reciben
// de Digifact al solicitar credenciales (soporte@digifact.com.gt).
// Cuando se tengan, completar:
//   - URL exacta del endpoint de certificacion (probablemente POST /api/GTUberInvoicing)
//   - Headers exactos (Authorization: Bearer + posibles headers adicionales)
//   - Esquema XML SAT (FACT, FPEQ, etc.) — Digifact entrega plantillas
//   - Parser de respuesta para extraer uuid SAT, serie y numero certificados
//
// Endpoints documentados publicamente:
//   GET  /api/RTU?NIT={NIT}     -> consulta receptor por NIT
//   POST /api/GTUberInvoicing   -> certificar DTE
//   ...
//
// El cliente lee la config desde tabla config_fel.

export class DigifactError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message)
    this.name = 'DigifactError'
    this.status = status
    this.payload = payload
  }
}

export function crearCliente(config) {
  if (!config) throw new DigifactError('config_fel no encontrada')
  if (!config.digifact_token) throw new DigifactError('Token Digifact no configurado')
  const base = (config.digifact_url_base || 'https://fel.digifact.com.gt/api/').replace(/\/$/, '') + '/'

  async function request(path, { method = 'GET', body, headers = {} } = {}) {
    const url = base + path.replace(/^\//, '')
    const finalHeaders = {
      'Authorization': `Bearer ${config.digifact_token}`,
      'Accept': 'application/json',
      ...(body && typeof body === 'string' && body.trim().startsWith('<')
        ? { 'Content-Type': 'application/xml' }
        : body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    }
    const init = { method, headers: finalHeaders }
    if (body) init.body = typeof body === 'string' ? body : JSON.stringify(body)

    let resp
    try {
      resp = await fetch(url, init)
    } catch (e) {
      throw new DigifactError(`Error de red llamando a Digifact: ${e.message}`)
    }
    const text = await resp.text()
    let payload = text
    try { payload = JSON.parse(text) } catch { /* respuesta no es JSON */ }
    if (!resp.ok) {
      throw new DigifactError(`Digifact ${resp.status}: ${text.slice(0, 300)}`, { status: resp.status, payload })
    }
    return payload
  }

  return {
    config,
    async consultarReceptor(nit) {
      if (!nit) throw new DigifactError('NIT requerido')
      return request(`RTU?NIT=${encodeURIComponent(nit)}`)
    },
    async certificarDTE(xmlDte) {
      // El endpoint exacto y el formato del XML lo entrega Digifact con las
      // credenciales. Este es el shape esperado segun la doc publica.
      return request('GTUberInvoicing', { method: 'POST', body: xmlDte })
    },
    async anularDTE(uuidSat, motivo) {
      // Idem: el formato exacto se confirma con Digifact.
      return request('GTUberInvoicing/Anular', {
        method: 'POST', body: { uuid: uuidSat, motivo },
      })
    },
  }
}

// Construye el XML del DTE en formato SAT. Esto es un PLACEHOLDER que arma una
// estructura razonable; Digifact / SAT requieren el esquema exacto. Cuando se
// reciba la plantilla oficial, reemplazar esta funcion respetando los campos
// reales (firma incluida).
export function construirXMLDte({ config, factura, items }) {
  const escXml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;')

  const lineasXml = items.map((it, i) => `
    <dte:Item NumeroLinea="${i + 1}" BienOServicio="${it.bien_o_servicio || 'B'}">
      <dte:Cantidad>${Number(it.cantidad)}</dte:Cantidad>
      <dte:UnidadMedida>${escXml(it.unidad_medida || 'UND')}</dte:UnidadMedida>
      <dte:Descripcion>${escXml(it.descripcion)}</dte:Descripcion>
      <dte:PrecioUnitario>${Number(it.precio_unitario)}</dte:PrecioUnitario>
      <dte:Precio>${Number(it.cantidad) * Number(it.precio_unitario)}</dte:Precio>
      <dte:Descuento>${Number(it.descuento) || 0}</dte:Descuento>
      <dte:Total>${Number(it.subtotal)}</dte:Total>
      ${it.afecta_iva ? `<dte:Impuestos>
        <dte:Impuesto>
          <dte:NombreCorto>IVA</dte:NombreCorto>
          <dte:CodigoUnidadGravable>1</dte:CodigoUnidadGravable>
          <dte:MontoGravable>${(Number(it.subtotal) / 1.12).toFixed(2)}</dte:MontoGravable>
          <dte:MontoImpuesto>${(Number(it.subtotal) - Number(it.subtotal) / 1.12).toFixed(2)}</dte:MontoImpuesto>
        </dte:Impuesto>
      </dte:Impuestos>` : ''}
    </dte:Item>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTDocumento xmlns:dte="http://www.sat.gob.gt/dte/fel/0.2.0" Version="0.1">
  <dte:SAT ClaseDocumento="dte">
    <dte:DTE ID="DatosCertificados">
      <dte:DatosEmision ID="DatosEmision">
        <dte:DatosGenerales CodigoMoneda="${factura.moneda || 'GTQ'}" FechaHoraEmision="${factura.fecha_emision}" Tipo="${factura.tipo_documento || 'FACT'}"/>
        <dte:Emisor AfiliacionIVA="${config.afiliacion_iva || 'GEN'}" CodigoEstablecimiento="${config.codigo_establecimiento || 1}" CorreoEmisor="${escXml(config.email_emisor || '')}" NITEmisor="${escXml(config.nit_emisor)}" NombreComercial="${escXml(config.nombre_comercial)}" NombreEmisor="${escXml(config.razon_social || config.nombre_comercial)}">
          <dte:DireccionEmisor>
            <dte:Direccion>${escXml(config.direccion || '')}</dte:Direccion>
            <dte:CodigoPostal>${escXml(config.codigo_postal || '01010')}</dte:CodigoPostal>
            <dte:Municipio>${escXml(config.municipio || 'GUATEMALA')}</dte:Municipio>
            <dte:Departamento>${escXml(config.departamento || 'GUATEMALA')}</dte:Departamento>
            <dte:Pais>${escXml(config.pais || 'GT')}</dte:Pais>
          </dte:DireccionEmisor>
        </dte:Emisor>
        <dte:Receptor CorreoReceptor="${escXml(factura.receptor_email || '')}" IDReceptor="${escXml(factura.receptor_nit || 'CF')}" NombreReceptor="${escXml(factura.receptor_nombre)}">
          <dte:DireccionReceptor>
            <dte:Direccion>${escXml(factura.receptor_direccion || 'CIUDAD')}</dte:Direccion>
            <dte:CodigoPostal>01010</dte:CodigoPostal>
            <dte:Municipio>GUATEMALA</dte:Municipio>
            <dte:Departamento>GUATEMALA</dte:Departamento>
            <dte:Pais>GT</dte:Pais>
          </dte:DireccionReceptor>
        </dte:Receptor>
        <dte:Frases>
          <dte:Frase CodigoEscenario="${factura.escenario_iva || 1}" TipoFrase="${factura.frase_iva || 1}"/>
        </dte:Frases>
        <dte:Items>${lineasXml}
        </dte:Items>
        <dte:Totales>
          <dte:TotalImpuestos>
            <dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${Number(factura.iva).toFixed(2)}"/>
          </dte:TotalImpuestos>
          <dte:GranTotal>${Number(factura.total).toFixed(2)}</dte:GranTotal>
        </dte:Totales>
      </dte:DatosEmision>
    </dte:DTE>
  </dte:SAT>
</dte:GTDocumento>`
}
