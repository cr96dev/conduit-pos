// lib/pdf/cotizaciones.js
//
// PDF "Apple-level pro" para cotizaciones. Cabecera con logo del angelito,
// datos del cliente, tabla de items, totales, validez, notas y firma.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cargarLogoBase64, dibujarHeader, dibujarFooter, COLORS } from './branding'

const fmtQ = (n) => `Q ${Number(n || 0).toFixed(2)}`
const fmtNum = (n) => Number(n || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })

export async function generarPDFCotizacion(cot) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const margin = 15
  const w = doc.internal.pageSize.getWidth()

  const logoB64 = await cargarLogoBase64()
  const fechaCot = new Date(cot.fecha + 'T00:00:00').toLocaleDateString('es-GT', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const fechaVence = new Date(new Date(cot.fecha + 'T00:00:00').getTime() + (cot.validez_dias || 15) * 86400000)
    .toLocaleDateString('es-GT', { year: 'numeric', month: 'long', day: 'numeric' })

  let y = dibujarHeader(doc, {
    logoB64,
    titulo: 'Cotización',
    subtitulo: 'Propuesta comercial',
    referencia: cot.numero || `COT-${String(cot.id || '').slice(0, 8).toUpperCase()}`,
    fecha: fechaCot,
  })

  // ============ DATOS DEL CLIENTE ============
  y += 5
  doc.setFillColor(247, 243, 236)
  doc.roundedRect(margin, y, w - 2 * margin, 32, 2, 2, 'F')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...COLORS.inkSoft)
  doc.text('COTIZADO PARA', margin + 4, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...COLORS.ink)
  doc.text(cot.cliente_nombre || '—', margin + 4, y + 11)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...COLORS.inkSoft)
  let yLinea = y + 16
  if (cot.cliente_empresa) {
    doc.text(cot.cliente_empresa, margin + 4, yLinea); yLinea += 4
  }
  if (cot.cliente_nit) {
    doc.text(`NIT: ${cot.cliente_nit}`, margin + 4, yLinea); yLinea += 4
  }
  const contacto = [cot.cliente_email, cot.cliente_telefono].filter(Boolean).join(' · ')
  if (contacto) {
    doc.text(contacto, margin + 4, yLinea)
  }

  // Validez (lado derecho del bloque)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...COLORS.inkSoft)
  doc.text('VÁLIDA HASTA', w - margin - 4, y + 5, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...COLORS.juliaRed)
  doc.text(fechaVence, w - margin - 4, y + 13, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.inkSoft)
  doc.text(`${cot.validez_dias || 15} días desde emisión`, w - margin - 4, y + 19, { align: 'right' })

  y += 38

  // ============ ITEMS ============
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...COLORS.juliaRed)
  doc.text('DETALLE', margin, y)
  y += 4

  const filas = (cot.items || []).map((it) => [
    it.descripcion || '',
    fmtNum(it.cantidad),
    fmtQ(it.precio_unitario),
    fmtQ(it.subtotal),
  ])

  autoTable(doc, {
    startY: y,
    head: [['Descripción', 'Cant.', 'Precio unit.', 'Subtotal']],
    body: filas.length ? filas : [['(sin items)', '', '', '']],
    theme: 'grid',
    headStyles: {
      fillColor: COLORS.juliaRed,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9.5,
      cellPadding: 3.5,
    },
    bodyStyles: {
      fontSize: 9.5,
      cellPadding: 3.5,
      textColor: COLORS.ink,
    },
    alternateRowStyles: { fillColor: [253, 249, 242] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 22, halign: 'right' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  })
  y = doc.lastAutoTable.finalY + 6

  // ============ TOTALES ============
  if (y > 230) { doc.addPage(); y = 25 }
  const baseImp = Number(cot.total || 0) / 1.12
  const iva = Number(cot.iva || 0)
  const total = Number(cot.total || 0)

  const xBox = w - margin - 80
  doc.setDrawColor(...COLORS.divider)
  doc.setLineWidth(0.3)
  doc.line(xBox, y, w - margin, y)

  y += 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...COLORS.inkSoft)
  doc.text('Base imponible', xBox, y)
  doc.text(fmtQ(baseImp), w - margin, y, { align: 'right' })
  y += 5
  doc.text('IVA 12%', xBox, y)
  doc.text(fmtQ(iva), w - margin, y, { align: 'right' })

  y += 3
  doc.setFillColor(...COLORS.juliaRed)
  doc.rect(xBox - 2, y, (w - margin) - (xBox - 2) + 2, 12, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(255, 255, 255)
  doc.text('TOTAL', xBox + 2, y + 7.5)
  doc.setFontSize(13)
  doc.text(fmtQ(total), w - margin - 2, y + 7.5, { align: 'right' })
  y += 18

  // ============ NOTAS ============
  if (cot.notas?.trim()) {
    if (y > 240) { doc.addPage(); y = 25 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.juliaRed)
    doc.text('NOTAS', margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...COLORS.ink)
    const lineas = doc.splitTextToSize(cot.notas, w - 2 * margin)
    doc.text(lineas, margin, y + 3, { lineHeightFactor: 1.4 })
    y += lineas.length * 5 + 8
  }

  // ============ CONDICIONES (footer del documento, no de página) ============
  const h = doc.internal.pageSize.getHeight()
  if (y < h - 60) y = h - 55

  doc.setDrawColor(...COLORS.divider)
  doc.setLineWidth(0.3)
  doc.line(margin, y, w - margin, y)
  y += 5

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.inkSoft)
  doc.text('CONDICIONES', margin, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  y += 4
  const condiciones = [
    `· Precios en quetzales (GTQ), IVA 12% incluido.`,
    `· Esta cotización tiene vigencia de ${cot.validez_dias || 15} días desde la fecha de emisión.`,
    '· Se requiere 50% de anticipo para confirmar el pedido. Saldo contra entrega.',
    '· Para confirmar: responder este correo o WhatsApp con el OK.',
  ]
  condiciones.forEach((c) => { doc.text(c, margin, y); y += 3.5 })

  // ============ FOOTER PÁGINAS ============
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    dibujarFooter(doc)
  }

  const safe = (cot.numero || cot.id || 'cotizacion').replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 50)
  doc.save(`${safe}.pdf`)
}
