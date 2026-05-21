// pages/api/bancos/movimientos/:id/generar-asiento
// POST: crea un asiento contable nuevo a partir de un movimiento bancario
//       y lo concilia automaticamente con el movimiento.
//
// Body: { cuenta_contrapartida_id: uuid, concepto?: string }
//
// Direccion:
//   - mov.debito  > 0 (banco cobra)  -> HABER banco / DEBE contrapartida
//   - mov.credito > 0 (banco abona)  -> DEBE banco / HABER contrapartida

import { requireAdmin } from '../../../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  const { cuenta_contrapartida_id, concepto } = req.body || {}
  if (!id) return res.status(400).json({ error: 'id requerido' })
  if (!cuenta_contrapartida_id) return res.status(400).json({ error: 'cuenta_contrapartida_id requerida' })

  // 1. Movimiento bancario + cuenta bancaria mapeada
  const { data: mov } = await auth.admin
    .from('bancos_movimientos')
    .select('id, fecha, descripcion, referencia, debito, credito, asiento_id, cuenta_id, bancos_cuentas(alias, cuenta_contable_id)')
    .eq('id', id).single()
  if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' })
  if (mov.asiento_id) return res.status(400).json({ error: 'El movimiento ya esta conciliado' })

  const cuentaBancoId = mov.bancos_cuentas?.cuenta_contable_id
  if (!cuentaBancoId) {
    return res.status(400).json({ error: 'La cuenta bancaria no tiene mapeada una cuenta contable. Editar en /bancos.' })
  }

  // 2. Validar que la cuenta contrapartida sea de movimiento
  const { data: cc } = await auth.admin
    .from('cuentas_contables').select('id, codigo, nombre, es_movimiento, activo').eq('id', cuenta_contrapartida_id).single()
  if (!cc) return res.status(400).json({ error: 'Cuenta contrapartida no encontrada' })
  if (!cc.activo)        return res.status(400).json({ error: `Cuenta ${cc.codigo} inactiva` })
  if (!cc.es_movimiento) return res.status(400).json({ error: `Cuenta ${cc.codigo} no acepta movimientos` })

  // 3. Construir partidas
  const debito  = round2(Number(mov.debito)  || 0)
  const credito = round2(Number(mov.credito) || 0)
  const monto   = debito > 0 ? debito : credito
  if (monto <= 0) return res.status(400).json({ error: 'Movimiento sin monto' })

  const conceptoFinal = (concepto?.trim() || mov.descripcion || '').slice(0, 200)
  const partidas = []
  if (debito > 0) {
    // Banco cobra: salida del banco
    partidas.push({ cuenta_id: cc.id,        debe: debito, haber: 0,    concepto: conceptoFinal, orden: 0 })
    partidas.push({ cuenta_id: cuentaBancoId, debe: 0,     haber: debito, concepto: mov.descripcion, orden: 1 })
  } else {
    // Banco abona: entrada al banco
    partidas.push({ cuenta_id: cuentaBancoId, debe: credito, haber: 0,      concepto: mov.descripcion, orden: 0 })
    partidas.push({ cuenta_id: cc.id,         debe: 0,       haber: credito, concepto: conceptoFinal,  orden: 1 })
  }

  // 4. Crear asiento posteado
  const descripcion = mov.referencia
    ? `${mov.descripcion} (ref ${mov.referencia})`
    : mov.descripcion
  const { data: asiento, error: aErr } = await auth.admin.from('asientos').insert({
    fecha: mov.fecha,
    descripcion: descripcion.slice(0, 250),
    total_debe: monto, total_haber: monto,
    estado: 'posteado',
    posteado_at: new Date().toISOString(),
    posteado_por: auth.user.id,
    origen_tipo: 'banco_conciliacion', origen_id: mov.id,
    creado_por: auth.user.id,
  }).select().single()
  if (aErr) return res.status(500).json({ ok: false, error: aErr.message })

  const rows = partidas.map(p => ({ ...p, asiento_id: asiento.id }))
  const { error: pErr } = await auth.admin.from('asientos_partidas').insert(rows)
  if (pErr) {
    await auth.admin.from('asientos').delete().eq('id', asiento.id)
    return res.status(500).json({ ok: false, error: pErr.message })
  }

  // 5. Conciliar mov con el asiento recien creado
  const { error: cErr } = await auth.admin
    .from('bancos_movimientos').update({
      asiento_id: asiento.id,
      conciliado_at: new Date().toISOString(),
      conciliado_by: auth.user.id,
    }).eq('id', id)
  if (cErr) return res.status(500).json({ ok: false, error: cErr.message, asiento_creado: asiento.numero })

  return res.status(201).json({ ok: true, asiento, movimiento_conciliado: true })
}
