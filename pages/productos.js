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
  const [imagenCat, setImagenCat] = useState(null)  // { loyverse_id, name, image_url? } cuando modal abierto

  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, nombre_completo, rol').eq('id', session.user.id).single()
      .then(({ data }) => setPerfil(data || {}))
    cargar()
  }, [session])

  async function cargar() {
    setLoading(true)
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabase.from('loyverse_categories').select('loyverse_id, name, color, es_barra, image_url').order('name'),
      supabase.from('loyverse_items').select('loyverse_id, item_name, category_id, track_stock, variants, image_url, updated_at').order('item_name'),
    ])
    setCategorias(cats || [])
    setItems(its || [])
    setLoading(false)
  }

  function setImagenCategoria(cat) {
    setImagenCat(cat)
  }

  async function guardarImagenCategoria(loyverse_id, image_url) {
    // Optimista
    setCategorias(prev => prev.map(c =>
      c.loyverse_id === loyverse_id ? { ...c, image_url } : c
    ))
    const r = await apiFetch('/api/admin/categorias-barra', {
      method: 'PATCH',
      body: JSON.stringify({ loyverse_id, image_url }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      alert('Error: ' + (j.error || 'no se pudo actualizar'))
      cargar()
    }
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
          <h1 className="text-xl font-bold text-gray-900">Productos y categorías</h1>
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

            <div className="card-julia overflow-hidden">
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
              <strong>Imagen</strong>: se usa como fallback en el POS cuando un producto no tiene foto propia.
              {' '}<strong>Barra</strong>: items de esta categoría generan comanda automática para el iPad de la barra.
              {!esAdmin && <div className="mt-1 italic">Solo admin puede modificar.</div>}
            </div>

            <div className="card-julia overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left text-xs text-gray-400 font-normal px-4 py-2 w-20">Imagen</th>
                    <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Categoría</th>
                    <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Productos</th>
                    <th className="text-center text-xs text-gray-400 font-normal px-4 py-2 w-24">Barra</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <>{[1,2,3,4,5].map(i => <tr key={i}><td colSpan={4}><SkeletonRow /></td></tr>)}</>
                  ) : categorias.length === 0 ? (
                    <tr><td colSpan={4} className="text-center text-xs text-gray-400 py-8">Sin categorías sincronizadas.</td></tr>
                  ) : (
                    categorias.map(c => {
                      const numProductos = items.filter(i => i.category_id === c.loyverse_id).length
                      return (
                        <tr key={c.loyverse_id} className="border-t border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3">
                            <button
                              onClick={() => esAdmin && setImagenCategoria(c)}
                              disabled={!esAdmin}
                              className={`block w-14 h-14 rounded-xl overflow-hidden border-2 transition-all ${
                                esAdmin ? 'border-gray-200 hover:border-julia-red cursor-pointer' : 'border-gray-100 cursor-default'
                              } ${c.image_url ? '' : 'bg-gradient-to-br from-julia-cream/40 to-julia-cream/10'}`}>
                              {c.image_url ? (
                                <img src={c.image_url} alt={c.name}
                                  className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-xl font-bold text-julia-red/30">
                                  {(c.name || '?').slice(0, 2).toUpperCase()}
                                </div>
                              )}
                            </button>
                          </td>
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

      {imagenCat && (
        <ModalImagenCategoria
          categoria={imagenCat}
          onClose={() => setImagenCat(null)}
          onSave={(url) => {
            guardarImagenCategoria(imagenCat.loyverse_id, url)
            setImagenCat(null)
          }}
        />
      )}
    </Layout>
  )
}

function ModalImagenCategoria({ categoria, onClose, onSave }) {
  const [tab, setTab] = useState('upload')  // 'upload' | 'url'
  const [urlInput, setUrlInput] = useState(categoria.image_url || '')
  const [archivo, setArchivo] = useState(null)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState('')

  async function subirArchivo() {
    if (!archivo) return
    setError(''); setSubiendo(true)
    try {
      // Path en el bucket: <loyverse_id>/<timestamp>.<ext>
      const ext = (archivo.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${categoria.loyverse_id}/${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('categorias-imagenes')
        .upload(path, archivo, { contentType: archivo.type, upsert: false })
      if (upErr) throw upErr
      const { data: { publicUrl } } = supabase.storage
        .from('categorias-imagenes')
        .getPublicUrl(path)
      onSave(publicUrl)
    } catch (e) {
      setError(e?.message || 'Error subiendo imagen')
      setSubiendo(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Imagen de categoría</h2>
            <p className="text-xs text-gray-400">{categoria.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        {/* Preview actual */}
        <div className="px-6 pt-5 pb-3">
          <div className="text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-2">Imagen actual</div>
          <div className="w-32 h-32 rounded-xl overflow-hidden border border-gray-200 bg-gradient-to-br from-julia-cream/40 to-julia-cream/10 mx-auto">
            {categoria.image_url ? (
              <img src={categoria.image_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-julia-red/30">
                {(categoria.name || '?').slice(0, 2).toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="px-6 border-b border-gray-100">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            <button onClick={() => setTab('upload')}
              className={`flex-1 text-xs py-2 rounded font-medium ${
                tab === 'upload' ? 'bg-white shadow-sm text-julia-red' : 'text-gray-500'
              }`}>
              Subir archivo
            </button>
            <button onClick={() => setTab('url')}
              className={`flex-1 text-xs py-2 rounded font-medium ${
                tab === 'url' ? 'bg-white shadow-sm text-julia-red' : 'text-gray-500'
              }`}>
              Pegar URL
            </button>
          </div>
        </div>

        <div className="p-6">
          {tab === 'upload' && (
            <>
              <input type="file" accept="image/jpeg,image/png,image/webp"
                onChange={e => { setArchivo(e.target.files?.[0] || null); setError('') }}
                className="block w-full text-xs text-gray-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-julia-cream/40 file:text-julia-red hover:file:bg-julia-cream/60 cursor-pointer" />
              <p className="text-[10px] text-gray-400 mt-2">JPG / PNG / WebP — máx 5 MB</p>
              {error && (
                <div className="mt-3 bg-red-50 border border-red-100 rounded px-3 py-2 text-xs text-red-700">{error}</div>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={onClose}
                  className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                  Cancelar
                </button>
                <button onClick={subirArchivo} disabled={!archivo || subiendo}
                  className="text-sm px-5 py-2 bg-julia-red text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                  {subiendo ? 'Subiendo...' : 'Subir y guardar'}
                </button>
              </div>
            </>
          )}

          {tab === 'url' && (
            <>
              <label className="block text-xs text-gray-500 mb-1">URL de la imagen</label>
              <input type="url" value={urlInput} onChange={e => setUrlInput(e.target.value)}
                placeholder="https://images.unsplash.com/..."
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red" />
              <p className="text-[10px] text-gray-400 mt-1">Pegá una URL pública (Unsplash, Pexels, Imgur, etc).</p>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={onClose}
                  className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                  Cancelar
                </button>
                {categoria.image_url && (
                  <button onClick={() => onSave(null)}
                    className="text-sm px-4 py-2 border border-red-200 text-red-600 rounded-lg hover:bg-red-50">
                    Quitar imagen
                  </button>
                )}
                <button onClick={() => onSave(urlInput.trim() || null)}
                  className="text-sm px-5 py-2 bg-julia-red text-white rounded-lg hover:bg-red-700">
                  Guardar URL
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
