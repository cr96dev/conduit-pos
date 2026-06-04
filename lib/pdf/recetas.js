// lib/pdf/recetas.js
//
// Genera PDF de una receta con encabezado Julia Bakery + tabla de
// ingredientes + costos + notas. Usa jsPDF (cliente-side, no requiere
// backend ni headless browser).

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { cargarLogoBase64, dibujarHeader, dibujarFooter, COLORS } from './branding'

const fmtQ = (n) => `Q ${Number(n || 0).toFixed(2)}`
const fmtNum = (n) => Number(n || 0).toLocaleString('es-GT', { maximumFractionDigits: 3 })

export async function generarPDFReceta(receta) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const margin = 15
  const w = doc.internal.pageSize.getWidth()

  const logoB64 = await cargarLogoBase64()
  const fecha = new Date().toLocaleDateString('es-GT', { year: 'numeric', month: 'long', day: 'numeric' })

  let y = dibujarHeader(doc, {
    logoB64,
    titulo: receta.nombre || 'Receta',
    subtitulo: receta.tipo === 'sub' ? 'Sub-receta · uso interno' : 'Receta de producción',
    referencia: `REC-${String(receta.id || '').slice(0, 8).toUpperCase()}`,
    fecha,
  })

  // ============ KPIs (rinde, costo, margen) ============
  y += 5
  const kpis = [
    {
      label: 'Rinde',
      value: `${fmtNum(receta.rinde_cantidad)} ${receta.rinde_unidad || ''}`,
    },
    {
      label: 'Costo total',
      value: fmtQ(receta.costo_personalizado ?? receta.costo_calculado),
    },
    {
      label: 'Precio venta',
      value: receta.precio_venta != null ? fmtQ(receta.precio_venta) : '—',
    },
    {
      label: 'Margen',
      value: receta.margen_pct != null ? `${Number(receta.margen_pct).toFixed(1)}%` : '—',
    },
  ]
  const kpiW = (w - 2 * margin - 6) / 4
  kpis.forEach((k, i) => {
    const x = margin + i * (kpiW + 2)
    doc.setFillColor(247, 243, 236)
    doc.setDrawColor(...COLORS.divider)
    doc.roundedRect(x, y, kpiW, 18, 2, 2, 'FD')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...COLORS.inkSoft)
    doc.text(k.label.toUpperCase(), x + 3, y + 5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...COLORS.ink)
    doc.text(k.value, x + 3, y + 13)
  })
  y += 25

  // ============ INGREDIENTES ============
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...COLORS.juliaRed)
  doc.text('INGREDIENTES', margin, y)
  y += 4

  const ings = receta.ingredientes || []
  const filas = ings.map((ing) => {
    const esSubReceta = !!ing.sub_receta_id
    const nombre = esSubReceta
      ? (ing.recetas?.nombre || '?') + '  (sub-receta)'
      : (ing.insumos?.nombre || '?')
    const unidad = esSubReceta
      ? (ing.recetas?.rinde_unidad || '')
      : (ing.insumos?.unidad || '')
    const costoUnit = esSubReceta
      ? (Number(ing.recetas?.costo_calculado || 0) / Math.max(1, Number(ing.recetas?.rinde_cantidad || 1)))
      : Number(ing.insumos?.costo_unitario || 0)
    const subtotal = Number(ing.cantidad || 0) * costoUnit

    return [
      nombre,
      `${fmtNum(ing.cantidad)} ${unidad}`.trim(),
      fmtQ(costoUnit),
      fmtQ(subtotal),
    ]
  })

  autoTable(doc, {
    startY: y,
    head: [['Ingrediente', 'Cantidad', 'Costo / unidad', 'Subtotal']],
    body: filas.length > 0 ? filas : [['(sin ingredientes registrados)', '', '', '']],
    theme: 'grid',
    headStyles: {
      fillColor: COLORS.juliaRed,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: 3,
    },
    bodyStyles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: COLORS.ink,
    },
    alternateRowStyles: { fillColor: [253, 249, 242] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 35, halign: 'right' },
      2: { cellWidth: 35, halign: 'right' },
      3: { cellWidth: 30, halign: 'right' },
    },
    margin: { left: margin, right: margin },
  })

  y = doc.lastAutoTable.finalY + 8

  // ============ TOTAL ============
  doc.setFillColor(...COLORS.juliaRed)
  doc.rect(w - margin - 70, y, 70, 12, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text('COSTO TOTAL', w - margin - 67, y + 7)
  doc.setFontSize(12)
  doc.text(fmtQ(receta.costo_personalizado ?? receta.costo_calculado), w - margin - 3, y + 8, { align: 'right' })
  y += 18

  // ============ NOTAS / PROCEDIMIENTO ============
  if (receta.notas && receta.notas.trim()) {
    if (y > 240) { doc.addPage(); y = 25 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...COLORS.juliaRed)
    doc.text('PROCEDIMIENTO', margin, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...COLORS.ink)
    const lineas = doc.splitTextToSize(receta.notas, w - 2 * margin)
    doc.text(lineas, margin, y + 3, { lineHeightFactor: 1.4 })
  }

  // ============ FOOTER (todas las páginas) ============
  const totalPages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    dibujarFooter(doc)
  }

  // Descargar
  const safeName = String(receta.nombre || 'receta').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
  doc.save(`receta-${safeName}.pdf`)
}
