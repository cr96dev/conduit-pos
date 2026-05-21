// pages/api/bancos/cuentas/:id/saldo
// GET: calcula el saldo actual de la cuenta segun los movimientos importados.
//   saldo = saldo_inicial + sum(creditos) - sum(debitos)
//   Tambien devuelve totales conciliados vs pendientes.

import { requireAuth } from '../../../../../lib/auth'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { id } = req.query
  if (!id) return res.status(400).json({ error: 'id requerido' })

  const { data: cuenta } = await auth.admin
    .from('bancos_cuentas').select('saldo_inicial').eq('id', id).single()
  if (!cuenta) return res.status(404).json({ error: 'Cuenta no encontrada' })

  const { data: movs } = await auth.admin
    .from('bancos_movimientos').select('debito, credito, asiento_id').eq('cuenta_id', id)

  let saldoBanco = Number(cuenta.saldo_inicial) || 0
  let totalDebitos = 0, totalCreditos = 0
  let pendientesDebitos = 0, pendientesCreditos = 0
  let conciliados = 0, pendientes = 0
  for (const m of movs || []) {
    saldoBanco += (Number(m.credito) || 0) - (Number(m.debito) || 0)
    totalDebitos  += Number(m.debito) || 0
    totalCreditos += Number(m.credito) || 0
    if (m.asiento_id) conciliados++
    else {
      pendientes++
      pendientesDebitos  += Number(m.debito) || 0
      pendientesCreditos += Number(m.credito) || 0
    }
  }

  return res.status(200).json({
    ok: true,
    saldo_banco: round2(saldoBanco),
    total_movimientos: (movs || []).length,
    total_debitos: round2(totalDebitos),
    total_creditos: round2(totalCreditos),
    conciliados, pendientes,
    pendientes_debitos: round2(pendientesDebitos),
    pendientes_creditos: round2(pendientesCreditos),
  })
}
