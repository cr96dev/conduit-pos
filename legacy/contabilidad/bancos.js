import { useEffect, useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Layout from '../../components/Layout'
import { useToast, ToastContainer } from '../../components/Toast'

export default function Bancos({ session }) {
  const router = useRouter()
  const fileInputRef = useRef(null)
  const [perfil, setPerfil] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cuentas, setCuentas] = useState([])
  const [cuentaSel, setCuentaSel] = useState(null)
  const [movimientos, setMovimientos] = useState([])
  const [reglas, setReglas] = useState([])
  const [stats, setStats] = useState({ total: 0, conciliados: 0, pendientes: 0, ignorados: 0 })
  const [tab, setTab] = useState('movimientos')
  const [filtroEstado, setFiltroEstado] = useState('todos')
  const [filtroDesc, setFiltroDesc] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const { toasts, toast } = useToast()

  useEffect(() => {
    if (!session) { router.push('/'); return }
    loadInicial()
  }, [session])

  useEffect(() => {
    if (cuentaSel) loadMovimientos()
  }, [cuentaSel, filtroEstado, filtroDesc])

  async function loadInicial() {
    setLoading(true)
    const { data: p } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single()
    setPerfil(p)
    if (p?.rol !== 'admin') {
      toast('Solo administradores', 'error')
      router.push('/contabilidad')
      return
    }
    const { data: c } = await supabase.from('cuentas_contables')
      .select('id, codigo, nombre')
      .like('codigo', '1102%')
      .gt('codigo', '1102')
      .order('codigo')
    setCuentas(c || [])
    if (c && c.length > 0) setCuentaSel(c[0].id)

    const { data: r } = await supabase.from('reglas_conciliacion')
      .select('*, cuenta:cuenta_id(codigo,nombre), contrapartida:cuenta_contrapartida_id(codigo,nombre), estacion:estacion_id(nombre)')
      .order('prioridad')
    setReglas(r || [])

    setLoading(false)
  }

  async function loadMovimientos() {
    let q = supabase.from('movimientos_bancarios')
      .select('*, regla:regla_aplicada_id(nombre), asiento:asiento_id(referencia)')
      .eq('cuenta_id', cuentaSel)
      .order('fecha', { ascending: false })
      .limit(500)

    if (filtroEstado !== 'todos') q = q.eq('estado', filtroEstado)
    if (filtroDesc) q = q.ilike('descripcion', `%${filtroDesc}%`)

    const { data } = await q
    setMovimientos(data || [])

    const { data: s } = await supabase.from('movimientos_bancarios')
      .select('estado')
      .eq('cuenta_id', cuentaSel)
    const total = s?.length || 0
    const conciliados = s?.filter(x => x.estado === 'conciliado').length || 0
    const pendientes = s?.filter(x => x.estado === 'pendiente').length || 0
    const ignorados = s?.filter(x => x.estado === 'ignorado').length || 0
    setStats({ total, conciliados, pendientes, ignorados })
  }

  // ── Parser CSV BI ────────────────────────────────────────────
  async function leerArchivoBI(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => resolve(e.target.result)
      reader.onerror = reject
      reader.readAsText(file, 'windows-1252')
    })
  }

  function parseLineCsv(line) {
    const result = []
    let curr = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') inQuotes = !inQuotes
      else if (c === ',' && !inQuotes) { result.push(curr); curr = '' }
      else curr += c
    }
    result.push(curr)
    return result
  }

  function parsearCSVBI(content, filename) {
    const lines = content.split(/\r?\n/)

    let numeroCuenta = null
    for (const line of lines.slice(0, 10)) {
      const m = line.match(/Cuenta:\s*(\d+)/)
      if (m) { numeroCuenta = m[1]; break }
    }
    if (!numeroCuenta) {
      const m = filename.match(/_(\d{10})_/)
      if (m) numeroCuenta = m[1]
    }
    if (!numeroCuenta) throw new Error(`No se identificó cuenta en ${filename}`)

    const headerIdx = lines.findIndex(l => l.startsWith('Fecha,TT,'))
    if (headerIdx < 0) throw new Error(`Header "Fecha,TT,..." no encontrado en ${filename}`)

    let saldoInicial = null
    for (const line of lines.slice(0, headerIdx)) {
      const m = line.match(/Saldo inicial.*?:\s*([\d.,]+)/)
      if (m) saldoInicial = parseFloat(m[1].replace(/,/g, ''))
    }

    const movs = []
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue
      const parts = parseLineCsv(line)
      if (parts.length < 7) continue

      const [fecha, tt, desc, doc, debe, haber, saldo] = parts
      const m = fecha.match(/(\d{2})-(\d{2})-(\d{4})/)
      if (!m) continue
      const fechaIso = `${m[3]}-${m[2]}-${m[1]}`

      const debeV = debe ? parseFloat(debe.replace(/,/g, '')) : 0
      const haberV = haber ? parseFloat(haber.replace(/,/g, '')) : 0
      const saldoV = saldo ? parseFloat(saldo.replace(/,/g, '')) : null
      if (debeV === 0 && haberV === 0) continue

      movs.push({
        fecha: fechaIso,
        descripcion: `[${tt}] ${desc}`.substring(0, 200),
        debito: debeV,
        credito: haberV,
        saldo: saldoV,
        referencia: doc
      })
    }
    return { numeroCuenta, saldoInicial, movimientos: movs }
  }

  // ── Upload ──────────────────────────────────────────────────
  async function onFilesSelected(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setUploading(true)
    setUploadResult(null)

    const resumen = {
      archivos_procesados: 0,
      archivos_error: [],
      total_movimientos: 0,
      total_insertados: 0,
      total_duplicados: 0,
      total_conciliados: 0,
      por_archivo: []
    }

    for (const file of files) {
      try {
        const content = await leerArchivoBI(file)
        const parsed = parsearCSVBI(content, file.name)

        const { data: cta } = await supabase.from('cuentas_contables')
          .select('id, codigo, nombre')
          .like('nombre', `%${parsed.numeroCuenta}%`)
          .maybeSingle()

        if (!cta) {
          resumen.archivos_error.push({ archivo: file.name, error: `Cuenta ${parsed.numeroCuenta} no existe en catálogo` })
          continue
        }

        const { data: result, error } = await supabase.rpc('upload_movimientos_bancarios', {
          p_cuenta_id: cta.id,
          p_archivo_nombre: file.name,
          p_movimientos: parsed.movimientos,
          p_saldo_inicial: parsed.saldoInicial
        })

        if (error) {
          resumen.archivos_error.push({ archivo: file.name, error: error.message })
          continue
        }

        resumen.archivos_procesados++
        resumen.total_movimientos += result.total || 0
        resumen.total_insertados += result.insertados || 0
        resumen.total_duplicados += result.duplicados || 0
        resumen.total_conciliados += result.conciliados || 0
        resumen.por_archivo.push({ archivo: file.name, cuenta: `${cta.codigo} ${cta.nombre}`, ...result })

      } catch (err) {
        resumen.archivos_error.push({ archivo: file.name, error: err.message })
      }
    }

    setUploadResult(resumen)
    setUploading(false)

    if (resumen.archivos_procesados > 0) {
      toast(`✓ ${resumen.archivos_procesados} archivos · ${resumen.total_insertados} nuevos · ${resumen.total_conciliados} auto-conciliados`, 'success')
      await loadMovimientos()
    }
    if (resumen.archivos_error.length > 0) {
      toast(`⚠ ${resumen.archivos_error.length} archivos con error`, 'error')
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function conciliarPendientes() {
    if (!confirm('¿Conciliar todos los pendientes? Aplicará las reglas existentes.')) return
    const { data, error } = await supabase.rpc('conciliar_pendientes', { p_cuenta_id: cuentaSel })
    if (error) { toast(`Error: ${error.message}`, 'error'); return }
    toast(`✓ ${data.conciliados} conciliados de ${data.total}`, 'success')
    await loadMovimientos()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm text-gray-400">Cargando bancos...</span>
      </div>
    </div>
  )

  const saldoBanco = movimientos.length > 0 && movimientos[0].saldo !== null
    ? parseFloat(movimientos[0].saldo) : null

  return (
    <Layout perfil={perfil}>
      <ToastContainer toasts={toasts} />
      <div className="p-6 max-w-7xl mx-auto">
        <div className="text-sm text-gray-500 mb-2">
          <button onClick={() => router.push('/contabilidad')} className="hover:text-blue-600">Contabilidad</button>
          <span className="mx-2">›</span>
          <span>Bancos</span>
        </div>

        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bancos · Conciliación</h1>
            <p className="text-sm text-gray-500 mt-1">{cuentas.length} cuentas bancarias · subí los CSVs del BI directamente</p>
          </div>
          <div className="flex gap-2">
            <input ref={fileInputRef} type="file" multiple accept=".csv" onChange={onFilesSelected} className="hidden" disabled={uploading} />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
              className="bg-blue-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
              {uploading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
              {uploading ? 'Procesando...' : '📥 Subir CSVs BI'}
            </button>
          </div>
        </div>

        {uploadResult && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5">
            <div className="flex items-start justify-between mb-2">
              <div>
                <h3 className="text-sm font-semibold text-blue-900">Resultado del upload</h3>
                <p className="text-xs text-blue-700 mt-0.5">
                  {uploadResult.archivos_procesados} archivos · {uploadResult.total_insertados} nuevos · {uploadResult.total_duplicados} duplicados · {uploadResult.total_conciliados} auto-conciliados
                </p>
              </div>
              <button onClick={() => setUploadResult(null)} className="text-blue-600 hover:text-blue-800 text-xl leading-none">×</button>
            </div>
            {uploadResult.archivos_error.length > 0 && (
              <div className="mt-2 text-xs text-red-700">
                <div className="font-medium">Errores:</div>
                {uploadResult.archivos_error.map((e, i) => (
                  <div key={i}>· <code className="bg-red-100 px-1">{e.archivo}</code>: {e.error}</div>
                ))}
              </div>
            )}
            {uploadResult.por_archivo.length > 0 && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-blue-700 hover:text-blue-900">Ver detalle por archivo ({uploadResult.por_archivo.length})</summary>
                <table className="mt-2 w-full text-xs">
                  <thead className="text-blue-900">
                    <tr className="text-left">
                      <th className="py-1">Archivo</th>
                      <th>Cuenta</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Ins</th>
                      <th className="text-right">Dup</th>
                      <th className="text-right">Conc</th>
                    </tr>
                  </thead>
                  <tbody>
                    {uploadResult.por_archivo.map((a, i) => (
                      <tr key={i} className="border-t border-blue-200">
                        <td className="py-1 truncate max-w-xs">{a.archivo}</td>
                        <td className="text-gray-600">{a.cuenta}</td>
                        <td className="text-right">{a.total}</td>
                        <td className="text-right">{a.insertados}</td>
                        <td className="text-right text-gray-500">{a.duplicados}</td>
                        <td className="text-right text-green-700 font-medium">{a.conciliados || 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
          <label className="text-xs text-gray-500 block mb-1">Cuenta bancaria</label>
          <select value={cuentaSel || ''} onChange={e => setCuentaSel(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
            {cuentas.map(c => (
              <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-4 gap-3 mb-5">
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-500">Total movimientos</div>
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          </div>
          <div className="bg-white rounded-xl border border-green-200 p-4">
            <div className="text-xs text-green-600">Conciliados</div>
            <div className="text-2xl font-bold text-green-700">{stats.conciliados}</div>
            <div className="text-xs text-gray-500">{stats.total > 0 ? `${Math.round(100*stats.conciliados/stats.total)}%` : '0%'}</div>
          </div>
          <div className="bg-white rounded-xl border border-amber-200 p-4">
            <div className="text-xs text-amber-600">Pendientes</div>
            <div className="text-2xl font-bold text-amber-700">{stats.pendientes}</div>
            {stats.pendientes > 0 && (
              <button onClick={conciliarPendientes} className="text-xs text-blue-600 hover:underline mt-1">Re-conciliar →</button>
            )}
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <div className="text-xs text-gray-500">Saldo último mov</div>
            <div className="text-2xl font-bold text-blue-700">
              {saldoBanco !== null ? `Q ${saldoBanco.toLocaleString('es-GT', { maximumFractionDigits: 2 })}` : '—'}
            </div>
          </div>
        </div>

        <div className="border-b border-gray-200 mb-4">
          <nav className="flex gap-1">
            <button onClick={() => setTab('movimientos')}
              className={`px-4 py-2 text-sm border-b-2 ${tab === 'movimientos' ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              📋 Movimientos
            </button>
            <button onClick={() => setTab('reglas')}
              className={`px-4 py-2 text-sm border-b-2 ${tab === 'reglas' ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              ⚙ Reglas ({reglas.length})
            </button>
          </nav>
        </div>

        {tab === 'movimientos' && (
          <>
            <div className="bg-white rounded-xl border border-gray-100 p-3 mb-4 flex gap-3">
              <input type="text" value={filtroDesc} onChange={e => setFiltroDesc(e.target.value)}
                placeholder="Buscar descripción..."
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
              <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
                <option value="todos">Todos los estados</option>
                <option value="pendiente">Pendientes</option>
                <option value="conciliado">Conciliados</option>
                <option value="ignorado">Ignorados</option>
              </select>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-4 py-2">Fecha</th>
                      <th className="text-left px-4 py-2">Descripción</th>
                      <th className="text-right px-4 py-2">Débito</th>
                      <th className="text-right px-4 py-2">Crédito</th>
                      <th className="text-right px-4 py-2">Saldo</th>
                      <th className="text-left px-4 py-2">Estado</th>
                      <th className="text-left px-4 py-2">Regla</th>
                    </tr>
                  </thead>
                  <tbody>
                    {movimientos.length === 0 ? (
                      <tr><td colSpan="7" className="text-center py-8 text-gray-400">
                        Sin movimientos en esta cuenta. Subí un CSV BI para empezar.
                      </td></tr>
                    ) : movimientos.map(m => (
                      <tr key={m.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                        <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{m.fecha}</td>
                        <td className="px-4 py-2 text-xs text-gray-900 max-w-md truncate" title={m.descripcion}>{m.descripcion}</td>
                        <td className="px-4 py-2 text-right text-xs">
                          {m.debito > 0 ? <span className="text-red-600 font-medium">{parseFloat(m.debito).toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span> : ''}
                        </td>
                        <td className="px-4 py-2 text-right text-xs">
                          {m.credito > 0 ? <span className="text-green-600 font-medium">{parseFloat(m.credito).toLocaleString('es-GT', { maximumFractionDigits: 2 })}</span> : ''}
                        </td>
                        <td className="px-4 py-2 text-right text-xs text-gray-500">
                          {m.saldo !== null ? parseFloat(m.saldo).toLocaleString('es-GT', { maximumFractionDigits: 2 }) : ''}
                        </td>
                        <td className="px-4 py-2 text-xs">
                          {m.estado === 'conciliado' && <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded">✓ Conciliado</span>}
                          {m.estado === 'pendiente' && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded">⏳ Pendiente</span>}
                          {m.estado === 'ignorado' && <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded">— Ignorado</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate" title={m.regla?.nombre}>{m.regla?.nombre || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {movimientos.length >= 500 && (
                <div className="px-4 py-2 text-xs text-gray-500 text-center bg-gray-50">
                  Mostrando primeros 500. Usá filtros para refinar.
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'reglas' && (
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <div className="text-sm font-medium text-gray-700">Reglas de conciliación automática</div>
              <div className="text-xs text-gray-500">{reglas.filter(r => r.activa).length} activas de {reglas.length}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="text-left px-4 py-2">Pri</th>
                    <th className="text-left px-4 py-2">Nombre</th>
                    <th className="text-left px-4 py-2">Cuenta</th>
                    <th className="text-left px-4 py-2">Tipo</th>
                    <th className="text-left px-4 py-2">Patrón</th>
                    <th className="text-right px-4 py-2">Monto min</th>
                    <th className="text-right px-4 py-2">Usos</th>
                  </tr>
                </thead>
                <tbody>
                  {reglas.map(r => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-4 py-2 text-xs text-gray-600">{r.prioridad}</td>
                      <td className="px-4 py-2 text-xs font-medium text-gray-900">{r.nombre}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{r.cuenta?.codigo || 'Cualquier'}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{r.tipo_movimiento}</td>
                      <td className="px-4 py-2 text-xs text-gray-600 max-w-xs truncate">{r.patron_descripcion || '—'}</td>
                      <td className="px-4 py-2 text-xs text-right text-gray-600">{r.monto_minimo ? `Q ${parseFloat(r.monto_minimo).toLocaleString('es-GT')}` : '—'}</td>
                      <td className="px-4 py-2 text-xs text-right font-medium">{r.veces_usada}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
