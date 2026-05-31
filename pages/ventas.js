// pages/ventas.js
// Listado de ventas en tiempo real desde facturas_fel.
// Cada factura emitida por el POS Julia Bakery aparece al instante (no espera
// polling de Loyverse — se actualiza con cada venta).

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
  const [facturas, setFacturas] = useState([])
  const [filtro, setFiltro] = useState('hoy') // hoy | semana | mes

  useEffect(() => {
    if (!session) { router.push('/'); return }
    cargar()
  }, [session, filtro])

  async function cargar() {
    setLoading(true)
    const diasAtras = filtro === 'hoy' ? 0 : filtro === 'semana' ? 7 : 30
    const fechaInicioGT = fechaGT(diasAtras)
    const { desdeUTC } = rangoUTCDeDiaGT(fechaInicioGT)

    // Leemos directo de facturas_fel — tiempo real, cada venta del POS se ve al instante.
    // Incluimos anuladas para mostrarlas como "devoluciones".
    const { data } = await supabase
      .from('facturas_fel')
      .select(`
        id, serie_sat, numero_sat, total, iva,
        fecha_emision, fecha_certificacion, fecha_anulacion,
        estado, metodo_pago,
        receptor_nit, receptor_nombre
      `)
      .gte('fecha_emision', desdeUTC)
      .in('estado', ['certificada', 'anulada'])
      .order('fecha_emision', { ascending: false })
      .limit(500)

    setFacturas(data || [])
    setLoading(false)
  }

  const certificadas = facturas.filter(f => f.estado === 'certificada')
  const anuladas     = facturas.filter(f => f.estado === 'anulada')
  const totalVentas  = certificadas.reduce((s, f) => s + Number(f.total || 0), 0)
  const totalRefunds = anuladas.reduce((s, f) => s + Number(f.total || 0), 0)
  const totalIva     = certificadas.reduce((s, f) => s + Number(f.iva || 0), 0)

  return (
    <Layout perfil={{ email: session?.user?.email }}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Ventas</h1>
            <p className="text-sm text-ink-subtle mt-0.5">Facturas emitidas — actualización en tiempo real</p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-5">
          {[['hoy','Hoy'],['semana','7 días'],['mes','30 días']].map(([k,l]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`text-sm px-4 py-2 rounded-lg font-semibold transition-colors ${
                filtro === k
                  ? 'bg-julia-red text-white shadow-xs'
                  : 'bg-white text-ink-muted border border-gray-200 hover:bg-gray-50'
              }`}>{l}</button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="card-julia p-4">
            <div className="label-tech mb-2">Ventas netas</div>
            <div className="text-2xl font-bold text-gray-900 font-mono tabular-nums leading-none">{fmtQ(totalVentas - totalRefunds)}</div>
          </div>
          <div className="card-julia p-4">
            <div className="label-tech mb-2">Facturas</div>
            <div className="text-2xl font-bold text-gray-900 font-mono tabular-nums leading-none">{certificadas.length}</div>
          </div>
          <div className="card-julia p-4">
            <div className="label-tech mb-2">IVA</div>
            <div className="text-2xl font-bold text-gray-900 font-mono tabular-nums leading-none">{fmtQ(totalIva)}</div>
          </div>
          <div className="card-julia p-4">
            <div className="label-tech mb-2">Anuladas</div>
            <div className="text-2xl font-bold font-mono tabular-nums leading-none" style={{ color: anuladas.length ? 'var(--danger)' : 'var(--ink)' }}>
              {fmtQ(totalRefunds)}
            </div>
            {anuladas.length > 0 && (
              <div className="text-2xs text-ink-subtle mt-1 font-mono">{anuladas.length} facturas</div>
            )}
          </div>
        </div>

        <div className="card-julia overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 border-b border-gray-100">
              <tr>
                <th className="text-left label-tech px-4 py-3">Factura</th>
                <th className="text-left label-tech px-4 py-3">Receptor</th>
                <th className="text-left label-tech px-4 py-3">Fecha</th>
                <th className="text-left label-tech px-4 py-3">Método</th>
                <th className="text-right label-tech px-4 py-3">IVA</th>
                <th className="text-right label-tech px-4 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1,2,3,4,5].map(i => <tr key={i}><td colSpan={6}><SkeletonRow /></td></tr>)}</>
              ) : facturas.length === 0 ? (
                <tr><td colSpan={6} className="text-center text-sm text-ink-subtle py-10">Sin facturas en este rango.</td></tr>
              ) : (
                facturas.map(f => {
                  const ref = f.serie_sat ? `${f.serie_sat}-${f.numero_sat || ''}` : (f.numero_sat || f.id.slice(0, 8))
                  const fecha = f.fecha_certificacion || f.fecha_emision
                  return (
                    <tr key={f.id} className="border-t border-gray-50 hover:bg-surface-2">
                      <td className="px-4 py-3 font-mono text-2xs text-gray-900">
                        <span className="truncate inline-block max-w-[160px] align-middle">{ref}</span>
                        {f.estado === 'anulada' && <span className="badge badge-danger ml-2">anulada</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900 font-medium truncate max-w-[200px]">{f.receptor_nombre}</div>
                        <div className="text-2xs text-ink-subtle font-mono">{f.receptor_nit}</div>
                      </td>
                      <td className="px-4 py-3 text-2xs font-mono text-ink-muted">
                        {new Date(fecha).toLocaleString('es-GT', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                      </td>
                      <td className="px-4 py-3">
                        <span className="badge badge-neutral capitalize">{(f.metodo_pago || '—').replace('_', ' ')}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-2xs text-ink-muted">{fmtQ(f.iva)}</td>
                      <td className={`px-4 py-3 text-right font-mono tabular-nums font-semibold ${f.estado === 'anulada' ? 'text-red-600 line-through' : 'text-gray-900'}`}>
                        {fmtQ(f.total)}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </Layout>
  )
}
