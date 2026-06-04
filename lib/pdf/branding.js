// lib/pdf/branding.js
//
// Helpers de branding para los PDFs de Julia Bakery — cabecera con logo
// del angelito + tipografía + paleta de marca. Se usa desde:
//   - lib/pdf/recetas.js
//   - lib/pdf/cotizaciones.js
//
// El logo se carga del PNG público en /public/julia-pdf-logo.png (lo bajamos
// del PNG transparente del angelito que ya tenemos). El base64 lo cachea
// el navegador en window.__juliaLogoB64 para no re-fetchearlo en cada PDF.

export const COLORS = {
  juliaRed:   [164, 0, 22],       // #A40016
  gold:       [212, 165, 116],    // #D4A574
  ink:        [28, 28, 24],       // #1c1c18
  inkSoft:    [91, 64, 62],       // #5b403e
  divider:    [228, 190, 186],    // #e4beba
  bgCream:    [253, 249, 242],    // #fdf9f2
}

// Cache local para no fetchear el logo en cada PDF
let _logoCache = null

export async function cargarLogoBase64() {
  if (_logoCache) return _logoCache
  try {
    const resp = await fetch('/pickup/logo.png')
    const blob = await resp.blob()
    const b64 = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload  = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    _logoCache = b64
    return b64
  } catch (e) {
    console.warn('[branding] no se pudo cargar logo:', e?.message || e)
    return null
  }
}

// Dibuja el header común a todos los PDFs Julia: logo (izq), título (centro),
// fecha + ref (derecha). Devuelve el Y de la siguiente línea libre.
export function dibujarHeader(doc, { logoB64, titulo, subtitulo, referencia, fecha }) {
  const w = doc.internal.pageSize.getWidth()
  const margin = 15

  // Banda superior crema
  doc.setFillColor(...COLORS.bgCream)
  doc.rect(0, 0, w, 40, 'F')

  // Logo (izq)
  if (logoB64) {
    try { doc.addImage(logoB64, 'PNG', margin, 8, 24, 24) } catch (_) {}
  }

  // Título centrado
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...COLORS.juliaRed)
  doc.text('JULIA BAKERY', w / 2, 16, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...COLORS.inkSoft)
  doc.text('Boutique Bakery · Zona 10, Guatemala City', w / 2, 22, { align: 'center' })

  // Fecha + ref (der)
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.inkSoft)
  if (fecha) {
    doc.text(fecha, w - margin, 12, { align: 'right' })
  }
  if (referencia) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...COLORS.ink)
    doc.text(referencia, w - margin, 18, { align: 'right' })
  }

  // Línea divisora
  doc.setDrawColor(...COLORS.divider)
  doc.setLineWidth(0.5)
  doc.line(margin, 40, w - margin, 40)

  // Título del documento
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...COLORS.ink)
  doc.text(titulo, margin, 52)
  if (subtitulo) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...COLORS.inkSoft)
    doc.text(subtitulo, margin, 58)
  }

  return subtitulo ? 65 : 60
}

export function dibujarFooter(doc) {
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  const margin = 15

  doc.setDrawColor(...COLORS.divider)
  doc.setLineWidth(0.3)
  doc.line(margin, h - 18, w - margin, h - 18)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...COLORS.inkSoft)
  doc.text('Julia Bakery · 2 Avenida 11-08, Zona 10, Guatemala City', w / 2, h - 12, { align: 'center' })
  doc.text('juliabakery.com.gt · WhatsApp +502 0000-0000', w / 2, h - 7, { align: 'center' })

  // Número de página
  const total = doc.internal.getNumberOfPages?.() || 1
  const num = doc.internal.getCurrentPageInfo?.().pageNumber || 1
  doc.text(`Página ${num} de ${total}`, w - margin, h - 7, { align: 'right' })
}
