import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

export default function Productos({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState([])
  const [categorias, setCategorias] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [tab, setTab] = useState('productos')

  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => setPerfil(data || {}))
    cargar()
  }, [session])

  async function cargar() {
    setLoading(true)
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabase.from('loyverse_categories').select('loyverse_id, name, color, es_barra').order('name'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, category_id, track_stock, variants, image_url, updated_at').order('item_name'),
    ])
    setCategorias(cats || [])
    setItems(its || [])
    setLoading(false)
  }

  const catMap = Object.fromEntries(categorias.map(c => [c.loyverse_id, c.name]))

  const filtrados = items.filter(i =>
    !busqueda || (i.item_name || '').toLowerCase().includes(busqueda.toLowerCase())
  )

  async function toggleBarra(cat) {
    // Optimista
    setCategorias(prev => prev.map(c =>
      c.loyverse_id === cat.loyverse_id ? { ...c, es_barra: !c.es_barra } : c
    ))
    const r = await apiFetch('/api/admin/categorias-barra', {
      method: 'PATCH',
      body: JSON.stringify({ loyverse_id: cat.loyverse_id, es_barra: !cat.es_barra }),
    })
    if (!r.ok) {
      // Revertir
      setCategorias(prev => prev.map(c =>
        c.loyverse_id === cat.loyverse_id ? { ...c, es_barra: cat.es_barra } : c
      ))
      const j = await r.json().catch(() => ({}))
      alert('Error: ' + (j.error || 'no se pudo actualizar'))
    }
  }

  const esAdmin = perfil?.rol === 'admin'

  return (
    <Layout perfil={perfil || { email: session?.user?.email }}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-900">Productos y categorías</h1>
          <span className="text-xs text-gray-400">
            {tab === 'productos' ? `${items.length} productos` : `${categorias.length} categorías`}
          </span>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-100">
          <button onClick={() => setTab('productos')}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              tab === 'productos' ? 'border-julia-red text-julia-red font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            Productos
          </button>
          <button onClick={() => setTab('categorias')}
            className={`px-4 py-2 text-sm border-b-2 transition-colors ${
              tab === 'categorias' ? 'border-julia-red text-julia-red font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            Categorías {esAdmin && (
              <span className="ml-1 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                {categorias.filter(c => c.es_barra).length} barra
              </span>
            )}
          </button>
        </div>

        {tab === 'productos' && (
          <>
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
                    <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Categoría</th>
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
                          <td className="px-4 py-2.5 text-xs text-gray-500">{catMap[i.category_id] || '—'}</td>
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
          </>
        )}

        {tab === 'categorias' && (
          <>
            <div className="mb-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-800">
              <strong>Toggle "Barra"</strong>: marcá las categorías cuyos productos se preparan en la barra
              (Café, Frappés, Jugos, etc.). Cada venta /pos con un item de estas categorías abre comanda
              automática en el iPad de la barra.
              {!esAdmin && <div className="mt-1 italic">Solo admin puede modificar.</div>}
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Categoría</th>
                    <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Productos</th>
                    <th className="text-center text-xs text-gray-400 font-normal px-4 py-2 w-32">Va a barra</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <>{[1,2,3,4,5].map(i => <tr key={i}><td colSpan={3}><SkeletonRow /></td></tr>)}</>
                  ) : categorias.length === 0 ? (
                    <tr><td colSpan={3} className="text-center text-xs text-gray-400 py-8">Sin categorías sincronizadas.</td></tr>
                  ) : (
                    categorias.map(c => {
                      const numProductos = items.filter(i => i.category_id === c.loyverse_id).length
                      return (
                        <tr key={c.loyverse_id} className="border-t border-gray-50">
                          <td className="px-4 py-3 text-gray-700">
                            <div className="flex items-center gap-2">
                              {c.color && (
                                <span
                                  className="inline-block w-3 h-3 rounded-full border border-gray-200"
                                  style={{ background: c.color }} />
                              )}
                              {c.name}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-gray-500">{numProductos}</td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={() => esAdmin && toggleBarra(c)}
                              disabled={!esAdmin}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                c.es_barra ? 'bg-julia-red' : 'bg-gray-200'
                              }`}>
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                c.es_barra ? 'translate-x-6' : 'translate-x-1'
                              }`} />
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
}
