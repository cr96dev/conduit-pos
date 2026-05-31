// lib/infile/construirDte.js
// Construye el XML del DTE (SAT GT 0.2.0) listo para mandar al firmador de Infile.
//
// Convenciones IVA GT (12%):
//   - factura_item.precio_unitario y precio_total INCLUYEN IVA (precio de panaderia).
//   - MontoGravable = total / 1.12
//   - MontoImpuesto = total - MontoGravable
//   - GranTotal     = suma de Total de items
//
// Receptor:
//   - CF (consumidor final): IDReceptor='CF', NombreReceptor='CONSUMIDOR FINAL',
//     direccion '.', municipio/depto vacios.
//   - Con NIT: IDReceptor = NIT sin guiones, NombreReceptor segun consulta NIT
//     o el que se haya capturado.
//
// La firma <ds:Signature> y la <dte:Certificacion> las agrega Infile en su
// servicio remoto — aca solo el cuerpo. NO incluimos namespaces de ds/xsi en
// el body (Infile los inyecta al firmar).

const fmt2 = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2)
const fmt3 = (n) => (Math.round(Number(n) * 1000) / 1000).toFixed(3)
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Fecha y hora con offset GT (-06:00). Si entra un timestamptz, se reformatea;
// si entra null, se usa now() en zona GT.
function fechaHoraGT(iso = null) {
  const d = iso ? new Date(iso) : new Date()
  // Convertir a GT (UTC-6): epoch − 6h, luego sacar componentes UTC.
  const gtMs = d.getTime() - 6 * 60 * 60 * 1000
  const g = new Date(gtMs)
  const pad = (n) => String(n).padStart(2, '0')
  const yyyy = g.getUTCFullYear()
  const MM = pad(g.getUTCMonth() + 1)
  const DD = pad(g.getUTCDate())
  const hh = pad(g.getUTCHours())
  const mm = pad(g.getUTCMinutes())
  const ss = pad(g.getUTCSeconds())
  return `${yyyy}-${MM}-${DD}T${hh}:${mm}:${ss}-06:00`
}

// Receptor: distinguir CF (consumidor final) de receptor con NIT.
// Devuelve { idReceptor, nombreReceptor, direccion, municipio, departamento }
function normalizarReceptor(factura) {
  const nitRaw = (factura.receptor_nit || '').trim()
  const esCF = !nitRaw || nitRaw.toUpperCase() === 'CF'
  if (esCF) {
    return {
      idReceptor: 'CF',
      nombreReceptor: factura.receptor_nombre?.trim() || 'CONSUMIDOR FINAL',
      direccion: '.',
      municipio: '',
      departamento: '',
    }
  }
  return {
    idReceptor: nitRaw.replace(/-/g, ''),
    nombreReceptor: (factura.receptor_nombre || '').trim() || 'CLIENTE',
    direccion: (factura.receptor_direccion || 'CIUDAD').trim(),
    municipio: 'GUATEMALA',
    departamento: 'GUATEMALA',
  }
}

// Construye el XML del DTE de una factura.
// `factura` es una fila de `facturas_fel`. `items` es array de `facturas_fel_items`.
// `config` es la fila de `config_fel`.
// `opciones.frases` (opcional) es array [{ escenario: int, tipo: int }, ...].
//   Si no viene, se usa una frase con (factura.escenario_iva, factura.frase_iva).
//   Si el emisor es Agente de Retención del IVA segun el RTU/SAT, hay que
//   incluir tambien Tipo=2 (catalogo Infile/SAT) o el cert rechaza con
//   error 2615 "FEL-GUI-30 No. 5".
export function construirDteFactura({ config, factura, items, opciones = {} }) {
  if (!config) throw new Error('config_fel requerida')
  if (!factura) throw new Error('factura requerida')
  if (!Array.isArray(items) || items.length === 0) throw new Error('La factura no tiene items')

  const fechaHora = fechaHoraGT(factura.fecha_emision)
  const r = normalizarReceptor(factura)

  // Items: validamos que cada item tenga total > 0 y armamos la representacion.
  // Asumimos que `subtotal` (en facturas_fel_items) YA incluye IVA — es lo que se cobra.
  let granTotal = 0
  let totalIvaCalculado = 0
  const itemsXml = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const cantidad = Number(it.cantidad) || 0
    const precioUnit = Number(it.precio_unitario) || 0
    const descuento = Number(it.descuento) || 0
    const totalLinea = Number(it.subtotal != null ? it.subtotal : (cantidad * precioUnit - descuento))
    if (!(totalLinea > 0)) throw new Error(`Item ${i + 1} con total no positivo`)

    const afectaIva = it.afecta_iva !== false
    let impuestosXml = ''
    if (afectaIva) {
      const gravable  = round2(totalLinea / 1.12)
      const impuesto  = round2(totalLinea - gravable)
      totalIvaCalculado += impuesto
      impuestosXml = `
            <dte:Impuestos>
              <dte:Impuesto>
                <dte:NombreCorto>IVA</dte:NombreCorto>
                <dte:CodigoUnidadGravable>1</dte:CodigoUnidadGravable>
                <dte:MontoGravable>${fmt2(gravable)}</dte:MontoGravable>
                <dte:MontoImpuesto>${fmt2(impuesto)}</dte:MontoImpuesto>
              </dte:Impuesto>
            </dte:Impuestos>`
    }

    granTotal += totalLinea
    const bs = it.bien_o_servicio === 'S' ? 'S' : 'B'
    const unidad = (it.unidad_medida || 'UND').trim() || 'UND'
    itemsXml.push(
      `          <dte:Item BienOServicio="${bs}" NumeroLinea="${i + 1}">
            <dte:Cantidad>${fmt3(cantidad)}</dte:Cantidad>
            <dte:UnidadMedida>${escapeXml(unidad)}</dte:UnidadMedida>
            <dte:Descripcion>${escapeXml(it.descripcion || '')}</dte:Descripcion>
            <dte:PrecioUnitario>${fmt2(precioUnit)}</dte:PrecioUnitario>
            <dte:Precio>${fmt2(cantidad * precioUnit)}</dte:Precio>
            <dte:Descuento>${fmt2(descuento)}</dte:Descuento>${impuestosXml}
            <dte:Total>${fmt2(totalLinea)}</dte:Total>
          </dte:Item>`
    )
  }

  granTotal = round2(granTotal)
  totalIvaCalculado = round2(totalIvaCalculado)

  // Frases: por defecto solo "Frase IVA" tipo 1 escenario 1. Si el emisor es
  // Agente de Retencion del IVA (RTU/SAT) o tiene otros regimenes especiales,
  // se pasan via opciones.frases = [{escenario, tipo}, ...].
  const frases = (Array.isArray(opciones.frases) && opciones.frases.length > 0)
    ? opciones.frases
    : [{ escenario: factura.escenario_iva || 1, tipo: factura.frase_iva || '1' }]
  // Para frases con afiliacion especial (ej. esc=3 "Retencion de ISR" o
  // esc=5 "Especiales"), SAT exige los atributos NumeroResolucion +
  // FechaResolucion. Si f.numeroResolucion + f.fechaResolucion vienen en
  // el objeto, los emitimos. FechaResolucion debe estar en YYYY-MM-DD.
  // Validacion SAT FEL-GUI-30 2.6.2 / 2.6.3.
  const frasesXml = frases.map(f => {
    const attrs = [
      `CodigoEscenario="${escapeXml(String(f.escenario))}"`,
      `TipoFrase="${escapeXml(String(f.tipo))}"`,
    ]
    if (f.numeroResolucion) attrs.push(`NumeroResolucion="${escapeXml(String(f.numeroResolucion))}"`)
    if (f.fechaResolucion)  attrs.push(`FechaResolucion="${escapeXml(String(f.fechaResolucion))}"`)
    return `          <dte:Frase ${attrs.join(' ')}/>`
  }).join('\n')

  // CodigoPostal puede venir null en CF -> usamos '0' (estandar SAT).
  const codigoPostal = config.codigo_postal || '01001'

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTDocumento xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:dte="http://www.sat.gob.gt/dte/fel/0.2.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="0.1" xsi:schemaLocation="http://www.sat.gob.gt/dte/fel/0.2.0">
  <dte:SAT ClaseDocumento="dte">
    <dte:DTE ID="DatosCertificados">
      <dte:DatosEmision ID="DatosEmision">
        <dte:DatosGenerales CodigoMoneda="${escapeXml(factura.moneda || 'GTQ')}" FechaHoraEmision="${fechaHora}" Tipo="${escapeXml(factura.tipo_documento || 'FACT')}"/>
        <dte:Emisor AfiliacionIVA="${escapeXml(config.afiliacion_iva || 'GEN')}" CodigoEstablecimiento="${escapeXml(String(config.codigo_establecimiento || 1))}" CorreoEmisor="${escapeXml(config.email_emisor || '')}" NITEmisor="${escapeXml(String(config.nit_emisor || '').replace(/-/g, ''))}" NombreComercial="${escapeXml(config.nombre_comercial || '')}" NombreEmisor="${escapeXml(config.razon_social || config.nombre_comercial || '')}">
          <dte:DireccionEmisor>
            <dte:Direccion>${escapeXml(config.direccion || 'CIUDAD DE GUATEMALA')}</dte:Direccion>
            <dte:CodigoPostal>${escapeXml(codigoPostal)}</dte:CodigoPostal>
            <dte:Municipio>${escapeXml(config.municipio || 'GUATEMALA')}</dte:Municipio>
            <dte:Departamento>${escapeXml(config.departamento || 'GUATEMALA')}</dte:Departamento>
            <dte:Pais>${escapeXml(config.pais || 'GT')}</dte:Pais>
          </dte:DireccionEmisor>
        </dte:Emisor>
        <dte:Receptor CorreoReceptor="${escapeXml(factura.receptor_email || '')}" IDReceptor="${escapeXml(r.idReceptor)}" NombreReceptor="${escapeXml(r.nombreReceptor)}">
          <dte:DireccionReceptor>
            <dte:Direccion>${escapeXml(r.direccion)}</dte:Direccion>
            <dte:CodigoPostal>0</dte:CodigoPostal>
            <dte:Municipio>${escapeXml(r.municipio)}</dte:Municipio>
            <dte:Departamento>${escapeXml(r.departamento)}</dte:Departamento>
            <dte:Pais>GT</dte:Pais>
          </dte:DireccionReceptor>
        </dte:Receptor>
        <dte:Frases>
${frasesXml}
        </dte:Frases>
        <dte:Items>
${itemsXml.join('\n')}
        </dte:Items>
        <dte:Totales>
          <dte:TotalImpuestos>
            <dte:TotalImpuesto NombreCorto="IVA" TotalMontoImpuesto="${fmt2(totalIvaCalculado)}"/>
          </dte:TotalImpuestos>
          <dte:GranTotal>${fmt2(granTotal)}</dte:GranTotal>
        </dte:Totales>
      </dte:DatosEmision>
    </dte:DTE>
  </dte:SAT>
</dte:GTDocumento>`

  return {
    xml,
    granTotal,
    totalIva: totalIvaCalculado,
  }
}

// Construye XML de anulacion. El doc se firma con es_anulacion='Y'.
// Necesita el uuid_sat, serie, numero y nit_emisor de la factura original.
export function construirDteAnulacion({ config, factura, motivo }) {
  if (!factura.uuid_sat) throw new Error('Factura sin uuid_sat — no se puede anular')
  const fechaHoraEmisionOriginal = fechaHoraGT(factura.fecha_emision)
  const fechaHoraAnulacion = fechaHoraGT()
  const motivoEsc = escapeXml((motivo || 'Anulacion').trim().slice(0, 250))
  const nitEmisor = String(config.nit_emisor || '').replace(/-/g, '')
  const nitReceptor = (factura.receptor_nit || 'CF').replace(/-/g, '')

  return `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTAnulacionDocumento xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:dte="http://www.sat.gob.gt/dte/fel/0.1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="0.1" xsi:schemaLocation="http://www.sat.gob.gt/dte/fel/0.1.0">
  <dte:SAT>
    <dte:AnulacionDTE ID="DatosCertificados">
      <dte:DatosGenerales NumeroDocumentoAAnular="${escapeXml(factura.uuid_sat)}" NITEmisor="${escapeXml(nitEmisor)}" IDReceptor="${escapeXml(nitReceptor)}" FechaEmisionDocumentoAnular="${fechaHoraEmisionOriginal}" FechaHoraAnulacion="${fechaHoraAnulacion}" MotivoAnulacion="${motivoEsc}"/>
    </dte:AnulacionDTE>
  </dte:SAT>
</dte:GTAnulacionDocumento>`
}
