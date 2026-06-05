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
  const [productoEditando, setProductoEditando] = useState(null)  // { nuevo: true } | producto a editar

  useEffect(() => {
    if (!session) { router.push('/login'); return }
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
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <input
                type="text"
                placeholder="Buscar producto..."
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                className="w-full md:w-80 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-julia-red"
              />
              {esAdmin && (
                <button
                  onClick={() => setProductoEditando({ nuevo: true })}
                  className="bg-julia-red text-white text-sm px-4 py-2 rounded-lg font-semibold hover:opacity-90 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Nuevo producto
                </button>
              )}
            </div>

            <div className="card-julia overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Producto</th>
                    <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Categoría</th>
                    <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Precio</th>
                    <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Stock</th>
                    {esAdmin && <th className="text-right text-xs text-gray-400 font-normal px-4 py-2 w-32">Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <>{[1,2,3,4,5].map(i => <tr key={i}><td colSpan={5}><SkeletonRow /></td></tr>)}</>
                  ) : filtrados.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-xs text-gray-400 py-8">Sin productos.</td></tr>
                  ) : (
                    filtrados.map(i => {
                      const precio = i.variants?.[0]?.stores?.[0]?.price ?? i.variants?.[0]?.default_price
                      const esManual = String(i.loyverse_id || '').startsWith('manual-')
                      return (
                        <tr key={i.loyverse_id} className="border-t border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-700">
                            {i.item_name || '—'}
                            {esManual && <span className="ml-2 text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">manual</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-gray-500">{catMap[i.category_id] || '—'}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                            {precio != null ? 'Q ' + Number(precio).toFixed(2) : '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-gray-500">
                            {i.track_stock ? 'inventario' : '—'}
                          </td>
                          {esAdmin && (
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => setProductoEditando({ ...i, precio_actual: precio })}
                                className="text-xs text-julia-red hover:underline"
                              >
                                editar
                              </button>
                            </td>
                          )}
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

      {productoEditando && (
        <ModalProducto
          producto={productoEditando}
          categorias={categorias}
          onClose={() => setProductoEditando(null)}
          onSaved={() => { setProductoEditando(null); cargar() }}
        />
      )}
    </Layout>
  )
}

// ============================================================================
// Modal nuevo / editar producto
// ============================================================================

function ModalProducto({ producto, categorias, onClose, onSaved }) {
  const esNuevo = !!producto.nuevo
  const [nombre, setNombre]      = useState(esNuevo ? '' : (producto.item_name || ''))
  const [precio, setPrecio]      = useState(esNuevo ? '' : (producto.precio_actual ?? ''))
  const [categoria, setCategoria] = useState(esNuevo ? '' : (producto.category_id || ''))
  const [trackStock, setTrackStock] = useState(esNuevo ? false : !!producto.track_stock)
  const [imageUrl, setImageUrl]   = useState(esNuevo ? '' : (producto.image_url || ''))
  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando]   = useState(false)
  const [err, setErr] = useState('')

  async function guardar() {
    setErr('')
    if (!nombre.trim()) return setErr('Nombre requerido')
    const precioNum = Number(precio)
    if (!(precioNum >= 0)) return setErr('Precio inválido')
    setGuardando(true)
    try {
      const body = {
        item_name: nombre.trim(),
        category_id: categoria || null,
        precio: precioNum,
        track_stock: trackStock,
        image_url: imageUrl?.trim() || null,
      }
      const url = esNuevo
        ? '/api/productos'
        : `/api/productos/${encodeURIComponent(producto.loyverse_id)}`
      const method = esNuevo ? 'POST' : 'PATCH'
      const r = await apiFetch(url, { method, body: JSON.stringify(body) })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Falla al guardar')
      onSaved()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setGuardando(false)
    }
  }

  async function borrar() {
    if (!confirm(`¿Eliminar el producto "${nombre}"? Lo podés volver a crear después si fue por error.`)) return
    setBorrando(true)
    try {
      const r = await apiFetch(`/api/productos/${encodeURIComponent(producto.loyverse_id)}`, { method: 'DELETE' })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error || 'Falla al borrar')
      onSaved()
    } catch (e) {
      setErr(e?.message || String(e))
    } finally {
      setBorrando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>

        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {esNuevo ? 'Nuevo producto' : 'Editar producto'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-ink-subtle mb-1">Nombre *</label>
            <input
              value={nombre}
              onChange={e => setNombre(e.target.value)}
              placeholder="DANESA DE CARPACCIO"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm uppercase"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-ink-subtle mb-1">Precio (IVA incluido) *</label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Q</span>
              <input
                type="number" step="0.01" min={0}
                value={precio}
                onChange={e => setPrecio(e.target.value)}
                placeholder="30.00"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm tabular-nums"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-ink-subtle mb-1">Categoría</label>
            <select
              value={categoria}
              onChange={e => setCategoria(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">(sin categoría)</option>
              {categorias.map(c => (
                <option key={c.loyverse_id} value={c.loyverse_id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-ink-subtle mb-1">URL imagen (opcional)</label>
            <input
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={trackStock}
              onChange={e => setTrackStock(e.target.checked)}
              className="rounded"
            />
            Lleva inventario (descuenta stock al vender)
          </label>

          {err && <div className="bg-rose-50 text-rose-700 px-3 py-2 rounded-lg text-sm">{err}</div>}
        </div>

        <div className="px-6 py-4 border-t flex items-center justify-between gap-2">
          {!esNuevo ? (
            <button
              onClick={borrar}
              disabled={borrando}
              className="text-sm text-rose-600 hover:underline disabled:opacity-40"
            >
              {borrando ? 'Borrando…' : 'Eliminar'}
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2 font-semibold">Cancelar</button>
            <button
              onClick={guardar}
              disabled={guardando}
              className="bg-julia-red text-white px-5 py-2 rounded-lg font-semibold hover:opacity-90 disabled:opacity-40 text-sm"
            >
              {guardando ? 'Guardando…' : (esNuevo ? 'Crear producto' : 'Guardar cambios')}
            </button>
          </div>
        </div>

      </div>
    </div>
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
