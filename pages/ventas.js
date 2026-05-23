import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import { rangoUTCDeDiaGT, fechaGT } from '../lib/fecha-gt'

function fmtQ(n) {
  if (n == null) return 'Q 0.00'
  return 'Q ' + Number(n).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function Ventas({ session }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [receipts, setReceipts] = useState([])
  const [filtro, setFiltro] = useState('hoy') // hoy | semana | mes

  useEffect(() => {
    if (!session) { router.push('/'); return }
    cargar()
  }, [session, filtro])

  async function cargar() {
    setLoading(true)
    // Calcular el inicio del rango en GT (UTC-6) independientemente de la
    // zona horaria del navegador: 'hoy' = 00:00 GT del dia actual GT;
    // semana/mes = 7 o 30 dias atras desde hoy GT.
    const diasAtras = filtro === 'hoy' ? 0 : filtro === 'semana' ? 7 : 30
    const fechaInicioGT = fechaGT(diasAtras)
    const { desdeUTC } = rangoUTCDeDiaGT(fechaInicioGT)

    const { data } = await supabase
      .from('loyverse_receipts')
      .select('loyverse_id, receipt_number, receipt_type, total_money, total_tax, receipt_date, employee_id, customer_id')
      .gte('receipt_date', desdeUTC)
      .order('receipt_date', { ascending: false })
      .limit(500)

    setReceipts(data || [])
    setLoading(false)
  }

  const totalVentas = receipts.filter(r => r.receipt_type === 'SALE').reduce((s,r) => s + Number(r.total_money || 0), 0)
  const totalRefunds = receipts.filter(r => r.receipt_type === 'REFUND').reduce((s,r) => s + Number(r.total_money || 0), 0)

  return (
    <Layout perfil={{ email: session?.user?.email }}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <h1 className="text-xl font-semibold text-gray-900 mb-4">Ventas</h1>

        <div className="flex items-center gap-2 mb-4">
          {[['hoy','Hoy'],['semana','7 dias'],['mes','30 dias']].map(([k,l]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                filtro === k ? 'bg-julia-red text-white border-julia-red' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}>{l}</button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-400 mb-1">Ventas (neto)</div>
            <div className="text-xl font-semibold text-gray-900">{fmtQ(totalVentas - totalRefunds)}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-400 mb-1">Recibos</div>
            <div className="text-xl font-semibold text-gray-900">{receipts.filter(r => r.receipt_type === 'SALE').length}</div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-400 mb-1">Devoluciones</div>
            <div className="text-xl font-semibold text-red-600">{fmtQ(totalRefunds)}</div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Recibo</th>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Fecha</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">IVA</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1,2,3,4,5].map(i => <tr key={i}><td colSpan={4}><SkeletonRow /></td></tr>)}</>
              ) : receipts.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-xs text-gray-400 py-8">Sin recibos en este rango.</td></tr>
              ) : (
                receipts.map(r => (
                  <tr key={r.loyverse_id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700">
                      {r.receipt_number}
                      {r.receipt_type === 'REFUND' && <span className="ml-2 text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">devol</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {new Date(r.receipt_date).toLocaleString('es-GT', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-gray-500">{fmtQ(r.total_tax)}</td>
                    <td className={`px-4 py-2.5 text-right ${r.receipt_type === 'REFUND' ? 'text-red-600' : 'text-gray-700'}`}>
                      {fmtQ(r.total_money)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
