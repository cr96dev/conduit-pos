// pages/api/admin/turnos/[id].js
// GET /api/admin/turnos/:id
//
// Devuelve el detalle completo de un turno + facturas vinculadas
// + agregados de ventas calculados desde facturas_fel (no del snapshot).
//
// Auth: admin.

import { requireAdmin } from '../../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  // 1. Turno + cajero
  const { data: turno, error: tErr } = await auth.admin
    .from('turnos_caja')
    .select('*, cajero:perfiles(id, nombre_completo, email)')
    .eq('id', id)
    .maybeSingle()
  if (tErr) return res.status(500).json({ error: tErr.message })
  if (!turno) return res.status(404).json({ error: 'Turno no encontrado' })

  // 2. Facturas del turno (tanto certificadas como anuladas)
  const { data: facturas, error: fErr } = await auth.admin
    .from('facturas_fel')
    .select('id, serie_sat, numero_sat, uuid_sat, fecha_emision, fecha_anulacion, total, iva, estado, metodo_pago, receptor_nit, receptor_nombre, motivo_anulacion')
    .eq('turno_id', id)
    .order('fecha_emision', { ascending: true })
  if (fErr) return res.status(500).json({ error: fErr.message })

  // 3. Agregados live desde facturas (NO del snapshot del turno —
  //    así reflejamos cambios posteriores como anulaciones manuales
  //    o reclasificaciones de método de pago).
  const certificadas = (facturas || []).filter(f => f.estado === 'certificada')
  const anuladas = (facturas || []).filter(f => f.estado === 'anulada')

  const porMetodo = {}
  for (const f of certificadas) {
    const m = f.metodo_pago || 'sin_clasificar'
    porMetodo[m] = (porMetodo[m] || 0) + Number(f.total || 0)
  }
  const totalCertificado = certificadas.reduce((s, f) => s + Number(f.total || 0), 0)
  const totalAnulado = anuladas.reduce((s, f) => s + Number(f.total || 0), 0)
  const ivaCertificado = certificadas.reduce((s, f) => s + Number(f.iva || 0), 0)

  return res.status(200).json({
    ok: true,
    turno,
    facturas: facturas || [],
    agregados_live: {
      total_certificado: Number(totalCertificado.toFixed(2)),
      total_anulado: Number(totalAnulado.toFixed(2)),
      iva_generado: Number(ivaCertificado.toFixed(2)),
      cantidad_certificadas: certificadas.length,
      cantidad_anuladas: anuladas.length,
      por_metodo_pago: porMetodo,
    },
  })
}
