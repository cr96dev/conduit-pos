import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'

export default function Inventario({ session }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [filas, setFilas] = useState([])

  useEffect(() => {
    if (!session) { router.push('/'); return }
    cargar()
  }, [session])

  async function cargar() {
    setLoading(true)
    // Inventario + nombre del item via lookup en memoria (los items son ~244).
    const [{ data: inv }, { data: items }] = await Promise.all([
      supabase.from('loyverse_inventory_levels').select('variant_id, store_id, in_stock, updated_at'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, variants'),
    ])

    // Mapear variant_id -> { item_name, variant_name }
    const mapVar = {}
    for (const it of items || []) {
      const variantes = Array.isArray(it.variants) ? it.variants : []
      for (const v of variantes) {
        if (v.variant_id) mapVar[v.variant_id] = {
          item_name: it.item_name,
          variant_name: v.option1_value || v.option_value || null,
          sku: v.sku || null,
        }
      }
    }

    const rows = (inv || []).map(r => ({
      ...r,
      ...(mapVar[r.variant_id] || { item_name: '—', variant_name: null, sku: null }),
    })).sort((a,b) => (a.item_name || '').localeCompare(b.item_name || ''))

    setFilas(rows)
    setLoading(false)
  }

  return (
    <Layout perfil={{ email: session?.user?.email }}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-900">Inventario</h1>
          <span className="text-xs text-gray-400">{filas.length} variantes con stock</span>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Producto</th>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">SKU</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">En stock</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1,2,3,4,5].map(i => <tr key={i}><td colSpan={4}><SkeletonRow /></td></tr>)}</>
              ) : filas.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-xs text-gray-400 py-8">Sin datos de inventario.</td></tr>
              ) : (
                filas.map(r => {
                  const stockBajo = Number(r.in_stock || 0) <= 5
                  return (
                    <tr key={`${r.variant_id}-${r.store_id}`} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-700">
                        {r.item_name}
                        {r.variant_name && <span className="text-xs text-gray-400 ml-1">/ {r.variant_name}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{r.sku || '—'}</td>
                      <td className={`px-4 py-2.5 text-right ${stockBajo ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                        {Number(r.in_stock || 0).toLocaleString('es-GT')}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-400">
                        {r.updated_at ? new Date(r.updated_at).toLocaleString('es-GT', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) : '—'}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
