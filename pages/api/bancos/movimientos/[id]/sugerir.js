// pages/api/bancos/movimientos/:id/sugerir
// GET: devuelve asientos posteados candidatos para conciliar este movimiento.
// Match heuristico:
//   - mismo monto (debe o haber total del asiento == debito o credito del mov)
//   - fecha del asiento dentro de +/- 7 dias
//   - no esta conciliado ya con otro movimiento
//   - si el movimiento toca una cuenta bancaria mapeada, el asiento debe
//     tener al menos una partida sobre esa cuenta contable.

import { requireAuth } from '../../../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  // 1. Cargar el movimiento + la cuenta bancaria (para conocer cuenta_contable_id)
  const { data: mov, error } = await auth.admin
    .from('bancos_movimientos')
    .select('id, fecha, debito, credito, descripcion, cuenta_id, bancos_cuentas(cuenta_contable_id)')
    .eq('id', id).single()
  if (error || !mov) return res.status(404).json({ error: 'Movimiento no encontrado' })

  const monto = round2(Number(mov.debito) || Number(mov.credito))
  if (monto <= 0) return res.status(200).json({ ok: true, sugerencias: [] })

  // Ventana de fechas
  const f = new Date(mov.fecha + 'T12:00:00')
  const desde = new Date(f.getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const hasta = new Date(f.getTime() + 7 * 86400000).toISOString().slice(0, 10)

  // 2. Asientos posteados en la ventana con monto coincidente.
  let q = auth.admin
    .from('asientos')
    .select('id, numero, fecha, descripcion, total_debe, origen_tipo, asientos_partidas!inner(cuenta_id, debe, haber)')
    .eq('estado', 'posteado')
    .gte('fecha', desde).lte('fecha', hasta)
    .gte('total_debe', monto - 0.01).lte('total_debe', monto + 0.01)
    .limit(50)

  const { data: asientos } = await q

  // 3. Filtrar: si la cuenta bancaria tiene cuenta_contable_id, el asiento
  // debe tener partida en esa cuenta.
  const cuentaContId = mov.bancos_cuentas?.cuenta_contable_id
  let candidatos = (asientos || [])
  if (cuentaContId) {
    candidatos = candidatos.filter(a =>
      (a.asientos_partidas || []).some(p => p.cuenta_id === cuentaContId))
  }

  // 4. Excluir asientos ya conciliados con cualquier movimiento.
  const ids = candidatos.map(a => a.id)
  let yaUsados = new Set()
  if (ids.length > 0) {
    const { data: usados } = await auth.admin
      .from('bancos_movimientos').select('asiento_id').in('asiento_id', ids).neq('id', id)
    yaUsados = new Set((usados || []).map(u => u.asiento_id))
  }
  candidatos = candidatos.filter(a => !yaUsados.has(a.id))

  // 5. Devolver sugerencias ordenadas por diferencia de fecha
  const sugerencias = candidatos
    .map(a => ({
      asiento_id: a.id,
      numero: a.numero, fecha: a.fecha,
      descripcion: a.descripcion,
      monto: a.total_debe,
      origen_tipo: a.origen_tipo,
      delta_dias: Math.abs(Math.floor((new Date(a.fecha) - f) / 86400000)),
    }))
    .sort((a, b) => a.delta_dias - b.delta_dias)
    .slice(0, 10)

  return res.status(200).json({ ok: true, movimiento: mov, sugerencias })
}
