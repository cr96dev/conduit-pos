// POST /api/bancos/movimientos/clasificar-bulk  (admin)
// Body: { movimiento_ids: [uuid], cuenta_contrapartida_id: uuid, concepto?: string }
//
// Por cada movimiento: crea asiento posteado (DEBE/HABER segun signo del mov)
// y lo concilia. Si algun mov ya esta conciliado, lo salta.

import { requireAdmin } from '../../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { movimiento_ids, cuenta_contrapartida_id, concepto } = req.body || {}
  if (!Array.isArray(movimiento_ids) || movimiento_ids.length === 0) {
    return res.status(400).json({ error: 'movimiento_ids[] requerido' })
  }
  if (!cuenta_contrapartida_id) {
    return res.status(400).json({ error: 'cuenta_contrapartida_id requerida' })
  }

  // Validar cuenta contrapartida
  const { data: cc } = await auth.admin
    .from('cuentas_contables').select('id, codigo, nombre, es_movimiento, activo')
    .eq('id', cuenta_contrapartida_id).single()
  if (!cc || !cc.activo || !cc.es_movimiento) {
    return res.status(400).json({ error: 'Cuenta contrapartida invalida' })
  }

  // Cargar movimientos + cuentas bancarias
  const { data: movs } = await auth.admin
    .from('bancos_movimientos')
    .select('id, fecha, descripcion, referencia, debito, credito, asiento_id, cuenta_id, bancos_cuentas(alias, cuenta_contable_id)')
    .in('id', movimiento_ids)

  const resultados = []
  const errores = []
  let creados = 0

  for (const mov of movs || []) {
    if (mov.asiento_id) {
      resultados.push({ id: mov.id, omitido: true, motivo: 'ya conciliado' })
      continue
    }
    const cuentaBancoId = mov.bancos_cuentas?.cuenta_contable_id
    if (!cuentaBancoId) {
      errores.push({ id: mov.id, error: 'cuenta bancaria sin mapeo contable' })
      continue
    }
    const debito  = round2(Number(mov.debito)  || 0)
    const credito = round2(Number(mov.credito) || 0)
    const monto = debito > 0 ? debito : credito
    if (monto <= 0) { errores.push({ id: mov.id, error: 'sin monto' }); continue }

    const conceptoFinal = (concepto?.trim() || mov.descripcion || '').slice(0, 200)
    const partidas = debito > 0
      ? [
          { cuenta_id: cc.id,         debe: debito, haber: 0,      concepto: conceptoFinal,  orden: 0 },
          { cuenta_id: cuentaBancoId, debe: 0,      haber: debito, concepto: mov.descripcion, orden: 1 },
        ]
      : [
          { cuenta_id: cuentaBancoId, debe: credito, haber: 0,      concepto: mov.descripcion, orden: 0 },
          { cuenta_id: cc.id,         debe: 0,       haber: credito, concepto: conceptoFinal,  orden: 1 },
        ]

    const descripcion = (mov.referencia ? `${mov.descripcion} (ref ${mov.referencia})` : mov.descripcion).slice(0, 250)
    const { data: asiento, error: aErr } = await auth.admin.from('asientos').insert({
      fecha: mov.fecha, descripcion,
      total_debe: monto, total_haber: monto,
      estado: 'posteado',
      posteado_at: new Date().toISOString(),
      posteado_por: auth.user.id,
      origen_tipo: 'banco_conciliacion', origen_id: mov.id,
      creado_por: auth.user.id,
    }).select().single()
    if (aErr) { errores.push({ id: mov.id, error: aErr.message }); continue }

    const rows = partidas.map(p => ({ ...p, asiento_id: asiento.id }))
    const { error: pErr } = await auth.admin.from('asientos_partidas').insert(rows)
    if (pErr) {
      await auth.admin.from('asientos').delete().eq('id', asiento.id)
      errores.push({ id: mov.id, error: pErr.message }); continue
    }

    await auth.admin.from('bancos_movimientos').update({
      asiento_id: asiento.id,
      conciliado_at: new Date().toISOString(),
      conciliado_by: auth.user.id,
    }).eq('id', mov.id)

    resultados.push({ id: mov.id, asiento_id: asiento.id, numero: asiento.numero })
    creados++
  }

  return res.status(200).json({
    ok: true,
    creados,
    omitidos: resultados.filter(r => r.omitido).length,
    errores: errores.length,
    detalle: { resultados, errores },
  })
}
