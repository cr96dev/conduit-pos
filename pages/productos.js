import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'

export default function Productos({ session }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [categorias, setCategorias] = useState({})
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    if (!session) { router.push('/'); return }
    cargar()
  }, [session])

  async function cargar() {
    setLoading(true)
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabase.from('loyverse_categories').select('loyverse_id, name'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, category_id, track_stock, variants, image_url, updated_at').order('item_name'),
    ])
    const mapCat = {}
    for (const c of cats || []) mapCat[c.loyverse_id] = c.name
    setCategorias(mapCat)
    setItems(its || [])
    setLoading(false)
  }

  const filtrados = items.filter(i =>
    !busqueda || (i.item_name || '').toLowerCase().includes(busqueda.toLowerCase())
  )

  return (
    <Layout perfil={{ email: session?.user?.email }}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-900">Productos</h1>
          <span className="text-xs text-gray-400">{items.length} productos</span>
        </div>

        <input
          type="text"
          placeholder="Buscar producto..."
          value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          className="w-full md:w-80 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red mb-4"
        />

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Producto</th>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Categoria</th>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Variantes</th>
                <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Stock</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1,2,3,4,5].map(i => <tr key={i}><td colSpan={4}><SkeletonRow /></td></tr>)}</>
              ) : filtrados.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-xs text-gray-400 py-8">Sin productos.</td></tr>
              ) : (
                filtrados.map(i => {
                  const numVariants = Array.isArray(i.variants) ? i.variants.length : 0
                  return (
                    <tr key={i.loyverse_id} className="border-t border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-700">{i.item_name || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{categorias[i.category_id] || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{numVariants}</td>
                      <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                        {i.track_stock ? 'inventario' : '—'}
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
