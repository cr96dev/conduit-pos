import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'
import {
  IGSS_EMPLEADO,
  calcularIgssLinea, calcularLiquidoLinea, calcularTotalesPlanilla,
} from '../lib/planillas'

// ============================================================================
// Helpers
// ============================================================================

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

function formatMoney(n) {
  return Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function formatMoneyQ(n) { return 'Q ' + formatMoney(n) }
function formatFecha(s) {
  if (!s) return '—'
  return new Date(s + 'T12:00:00').toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' })
}

const ESTADOS = {
  borrador: { label: 'Borrador',    cls: 'bg-gray-100 text-gray-700' },
  revision: { label: 'En revisión', cls: 'bg-amber-50 text-amber-700' },
  aprobada: { label: 'Aprobada',    cls: 'bg-blue-50 text-blue-700' },
  pagada:   { label: 'Pagada',      cls: 'bg-green-50 text-green-700' },
}

// ============================================================================
// Pagina
// ============================================================================

export default function Planillas({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [vista, setVista] = useState('lista') // 'lista' | 'detalle'
  const [planillaSel, setPlanillaSel] = useState(null)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    (async () => {
      const { data } = await supabase.from('perfiles')
        .select('id, email, nombre_completo, rol, activo')
        .eq('id', session.user.id).single()
      setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' })
    })()
  }, [session])

  const esAdmin = perfil?.rol === 'admin'

  return (
    <Layout perfil={perfil}>
      <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
        {vista === 'lista' ? (
          <VistaLista esAdmin={esAdmin} onAbrir={(p) => { setPlanillaSel(p); setVista('detalle') }} />
        ) : (
          <VistaDetalle planillaId={planillaSel.id} esAdmin={esAdmin}
            onVolver={() => { setPlanillaSel(null); setVista('lista') }} />
        )}
      </div>
    </Layout>
  )
}

// ============================================================================
// Vista lista
// ============================================================================

function VistaLista({ esAdmin, onAbrir }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [modalNueva, setModalNueva] = useState(false)

  useEffect(() => { cargar() }, [])

  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch('/api/planillas?limit=30')
    const json = await res.json()
    if (!res.ok) { setErr(json.error || 'Error'); setItems([]) }
    else setItems(json.planillas || [])
    setLoading(false)
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
        <h1 className="text-xl font-bold text-gray-900">Planillas</h1>
        {esAdmin && (
          <button onClick={() => setModalNueva(true)} className="btn-primario">+ Nueva quincena</button>
        )}
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      <div className="card-julia overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Período</th>
              <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Fechas</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Bruto</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Líquido</th>
              <th className="text-right text-xs text-gray-400 font-normal px-4 py-2">Costo patronal</th>
              <th className="text-center text-xs text-gray-400 font-normal px-4 py-2">Estado</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <>{[1,2,3].map(i => <tr key={i}><td colSpan={7}><SkeletonRow /></td></tr>)}</>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-xs text-gray-400 py-8">
                Sin planillas aún.
                {esAdmin && <button onClick={() => setModalNueva(true)} className="text-julia-red hover:underline ml-1">Crear la primera →</button>}
              </td></tr>
            ) : items.map(p => {
              const est = ESTADOS[p.estado] || ESTADOS.borrador
              return (
                <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-gray-800">{p.periodo}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{formatFecha(p.fecha_inicio)} – {formatFecha(p.fecha_fin)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 tabular-nums">{formatMoneyQ(p.total_bruto)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-800 font-medium tabular-nums">{formatMoneyQ(p.total_liquido)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">{formatMoneyQ(p.total_costo_patronal)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${est.cls}`}>{est.label}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button onClick={() => onAbrir(p)} className="text-xs text-julia-red hover:underline">Abrir</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modalNueva && <ModalNuevaQuincena onClose={() => setModalNueva(false)} onCreada={() => { setModalNueva(false); cargar() }} />}
    </div>
  )
}

// ============================================================================
// Modal: Nueva quincena
// ============================================================================

function ModalNuevaQuincena({ onClose, onCreada }) {
  // Default a la quincena del mes actual
  const hoy = new Date()
  const yy = hoy.getFullYear()
  const mm = String(hoy.getMonth() + 1).padStart(2, '0')
  const dd = hoy.getDate()
  const inicioDefault = dd <= 15 ? `${yy}-${mm}-01` : `${yy}-${mm}-16`
  const finDefault    = dd <= 15 ? `${yy}-${mm}-15` : `${yy}-${mm}-${new Date(yy, hoy.getMonth() + 1, 0).getDate()}`

  const [fechaInicio, setFechaInicio] = useState(inicioDefault)
  const [fechaFin, setFechaFin] = useState(finDefault)
  const [periodo, setPeriodo] = useState('')
  const [err, setErr] = useState(null)
  const [guardando, setGuardando] = useState(false)

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setGuardando(true)
    const res = await apiFetch('/api/planillas', {
      method: 'POST',
      body: JSON.stringify({ fecha_inicio: fechaInicio, fecha_fin: fechaFin, periodo: periodo || undefined }),
    })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onCreada(json.planilla)
  }

  return (
    <ModalShell titulo="Nueva quincena" onClose={onClose}>
      <form onSubmit={guardar} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Fecha inicio" required>
            <input type="date" required value={fechaInicio} onChange={e => setFechaInicio(e.target.value)} className="input" />
          </Campo>
          <Campo label="Fecha fin" required>
            <input type="date" required value={fechaFin} onChange={e => setFechaFin(e.target.value)} className="input" />
          </Campo>
        </div>
        <Campo label="Período (opcional)">
          <input type="text" value={periodo} onChange={e => setPeriodo(e.target.value)}
            placeholder="Auto: PRIMERA/SEGUNDA QUINCENA MES AÑO" className="input" />
        </Campo>
        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secundario">Cancelar</button>
          <button type="submit" disabled={guardando} className="btn-primario">
            {guardando ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

// ============================================================================
// Vista detalle
// ============================================================================

function VistaDetalle({ planillaId, esAdmin, onVolver }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [editando, setEditando] = useState(null) // linea id
  const [draft, setDraft] = useState(null)
  const [accionando, setAccionando] = useState(false)
  const [filtroArea, setFiltroArea] = useState('')

  useEffect(() => { cargar() }, [planillaId])

  async function cargar() {
    const res = await apiFetch(`/api/planillas/${planillaId}`)
    const json = await res.json()
    if (!res.ok) setErr(json.error || 'Error')
    else setData(json.planilla)
  }

  async function generarLineas(regenerar = false) {
    if (regenerar && !confirm('¿Regenerar líneas? Se perderán los cambios manuales.')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/planillas/${planillaId}/lineas`, {
      method: 'POST', body: JSON.stringify({ regenerar }),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    await cargar()
  }

  async function guardarLinea() {
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/planillas/${planillaId}/lineas/${editando}`, {
      method: 'PATCH', body: JSON.stringify(draft),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    setEditando(null); setDraft(null)
    await cargar()
  }

  async function cambiarEstado(nuevoEstado) {
    if (!confirm(`¿Cambiar estado a "${ESTADOS[nuevoEstado]?.label || nuevoEstado}"?`)) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/planillas/${planillaId}/estado`, {
      method: 'POST', body: JSON.stringify({ nuevo_estado: nuevoEstado }),
    })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    await cargar()
  }

  async function eliminar() {
    if (!confirm('¿Eliminar esta planilla? No se puede deshacer.')) return
    setAccionando(true); setErr(null)
    const res = await apiFetch(`/api/planillas/${planillaId}`, { method: 'DELETE' })
    const json = await res.json()
    setAccionando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    onVolver()
  }

  async function exportarExcel() {
    const XLSX = (await import('xlsx')).default || (await import('xlsx'))
    const lineas = data.lineas || []
    const wb = XLSX.utils.book_new()

    const buildSheet = (titulo, rows) => {
      const sheetData = [
        ['Empleado', 'Área', 'Pago', 'Cuenta/Cheque', 'Sal. Quinc.', 'Extras', 'Comisiones', 'Otros ingresos', 'Bonif. incentivo', 'IGSS empleado', 'Otros desc.', 'Préstamo', 'Desc. varios', 'LÍQUIDO', 'Concepto'],
        ...rows.map(l => [
          l.nombre, l.area || '', l.tipo_pago,
          l.tipo_pago === 'transferencia' ? (l.numero_cuenta || '') : (l.numero_cheque || ''),
          Number(l.salario_quincenal) || 0,
          Number(l.horas_extra) || 0,
          Number(l.comisiones) || 0,
          Number(l.otros_ingresos) || 0,
          Number(l.bonificacion_incentivo) || 0,
          calcularIgssLinea(l),
          Number(l.otros_descuentos) || 0,
          Number(l.prestamo_anticipo) || 0,
          Number(l.descuentos_varios) || 0,
          calcularLiquidoLinea(l),
          l.concepto || data.periodo,
        ]),
      ]
      const ws = XLSX.utils.aoa_to_sheet(sheetData)
      ws['!cols'] = [38, 16, 14, 18, 12, 10, 10, 12, 14, 12, 12, 12, 12, 14, 28].map(w => ({ wch: w }))
      XLSX.utils.book_append_sheet(wb, ws, titulo)
    }

    buildSheet('Todos', lineas)
    const trans = lineas.filter(l => l.tipo_pago === 'transferencia')
    const cheqs = lineas.filter(l => l.tipo_pago === 'cheque')
    const efe   = lineas.filter(l => l.tipo_pago === 'efectivo')
    if (trans.length) buildSheet('Transferencias', trans)
    if (cheqs.length) buildSheet('Cheques', cheqs)
    if (efe.length)   buildSheet('Efectivo', efe)

    XLSX.writeFile(wb, `${data.periodo.replace(/\s/g, '_')}.xlsx`)
  }

  if (!data) {
    return <div className="text-sm text-gray-400 p-4">Cargando…</div>
  }

  const est = ESTADOS[data.estado]
  const areas = Array.from(new Set((data.lineas || []).map(l => l.area).filter(Boolean))).sort()
  const lineasFiltradas = filtroArea
    ? data.lineas.filter(l => l.area === filtroArea)
    : data.lineas
  const totalesVivo = calcularTotalesPlanilla(data.lineas || [])
  const editable = data.estado === 'borrador' || data.estado === 'revision'

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onVolver} className="text-sm text-gray-500 hover:text-julia-red">← Volver</button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{data.periodo}</h1>
          <div className="text-xs text-gray-500">{formatFecha(data.fecha_inicio)} – {formatFecha(data.fecha_fin)}</div>
        </div>
        <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded ${est.cls}`}>{est.label}</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-4">
        <KpiBox label="Empleados" value={data.lineas?.length || 0} />
        <KpiBox label="Bruto" value={formatMoneyQ(totalesVivo.total_bruto)} />
        <KpiBox label="Adiciones" value={formatMoneyQ(totalesVivo.total_adiciones)} />
        <KpiBox label="IGSS empleados" value={formatMoneyQ(totalesVivo.total_igss_empleados)} />
        <KpiBox label="Líquido" value={formatMoneyQ(totalesVivo.total_liquido)} bold />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-5">
        <KpiBox label="Total descuentos" value={formatMoneyQ(totalesVivo.total_descuentos)} />
        <KpiBox label="Costo patronal" value={formatMoneyQ(totalesVivo.total_costo_patronal)} />
      </div>

      {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700 mb-3">{err}</div>}

      {/* Acciones */}
      <div className="flex flex-wrap gap-2 mb-3">
        {areas.length > 0 && (
          <select value={filtroArea} onChange={e => setFiltroArea(e.target.value)} className="input max-w-xs">
            <option value="">Todas las áreas</option>
            {areas.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {(data.lineas?.length || 0) > 0 && (
          <button onClick={exportarExcel} className="btn-secundario">Exportar Excel</button>
        )}
        {esAdmin && data.estado === 'borrador' && (
          (data.lineas?.length || 0) === 0 ? (
            <button onClick={() => generarLineas(false)} disabled={accionando} className="btn-primario">
              {accionando ? '…' : 'Generar líneas desde empleados'}
            </button>
          ) : (
            <button onClick={() => generarLineas(true)} disabled={accionando} className="btn-secundario">
              Regenerar líneas
            </button>
          )
        )}
      </div>

      {/* Tabla */}
      <div className="card-julia overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left text-[10px] uppercase tracking-wide text-gray-400 font-normal px-2 py-2">Empleado</th>
              <th className="text-left text-[10px] uppercase tracking-wide text-gray-400 font-normal px-2 py-2">Pago</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-gray-400 font-normal px-2 py-2">Salario</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-gray-400 font-normal px-2 py-2">Extras</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-gray-400 font-normal px-2 py-2">Comis.</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-gray-400 font-normal px-2 py-2">Otros +</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-emerald-600 font-normal px-2 py-2">Bonif. inc.</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-purple-500 font-normal px-2 py-2">IGSS</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-gray-400 font-normal px-2 py-2">Otros −</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-gray-400 font-normal px-2 py-2">Préstamo</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-rose-500 font-normal px-2 py-2">Desc. var.</th>
              <th className="text-right text-[10px] uppercase tracking-wide text-gray-800 font-medium px-2 py-2">LÍQUIDO</th>
              {esAdmin && editable && <th className="px-2 py-2"></th>}
            </tr>
          </thead>
          <tbody>
            {(lineasFiltradas || []).length === 0 ? (
              <tr><td colSpan={13} className="text-center text-xs text-gray-400 py-8">
                {data.lineas?.length === 0 ? 'Sin líneas. Generá desde empleados activos.' : 'Sin resultados con ese filtro.'}
              </td></tr>
            ) : lineasFiltradas.map(l => {
              const estaEdit = editando === l.id
              const cur = estaEdit ? { ...l, ...draft } : l
              const igss = calcularIgssLinea(cur)
              const liquido = calcularLiquidoLinea(cur)
              return (
                <tr key={l.id} className={`border-t border-gray-100 ${estaEdit ? 'bg-julia-cream/20' : 'hover:bg-gray-50'}`}>
                  <td className="px-2 py-1.5">
                    <div className="text-gray-800 font-medium">{l.nombre}</div>
                    <div className="text-[10px] text-gray-400">{l.area} · {l.puesto}</div>
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 text-[10px] uppercase">{l.tipo_pago}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{formatMoney(l.salario_quincenal)}</td>

                  <CeldaEdit valor={cur.horas_extra} edit={estaEdit}
                    onChange={v => setDraft(d => ({ ...d, horas_extra: v }))} />
                  <CeldaEdit valor={cur.comisiones} edit={estaEdit}
                    onChange={v => setDraft(d => ({ ...d, comisiones: v }))} />
                  <CeldaEdit valor={cur.otros_ingresos} edit={estaEdit}
                    onChange={v => setDraft(d => ({ ...d, otros_ingresos: v }))} />
                  <CeldaEdit valor={cur.bonificacion_incentivo} edit={estaEdit} tone="emerald"
                    onChange={v => setDraft(d => ({ ...d, bonificacion_incentivo: v }))} />

                  <td className="px-2 py-1.5 text-right tabular-nums text-purple-600">{formatMoney(igss)}</td>

                  <CeldaEdit valor={cur.otros_descuentos} edit={estaEdit}
                    onChange={v => setDraft(d => ({ ...d, otros_descuentos: v }))} />
                  <CeldaEdit valor={cur.prestamo_anticipo} edit={estaEdit}
                    onChange={v => setDraft(d => ({ ...d, prestamo_anticipo: v }))} />
                  <CeldaEdit valor={cur.descuentos_varios} edit={estaEdit} tone="rose"
                    onChange={v => setDraft(d => ({ ...d, descuentos_varios: v }))} />

                  <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-gray-900">{formatMoney(liquido)}</td>

                  {esAdmin && editable && (
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      {estaEdit ? (
                        <>
                          <button onClick={guardarLinea} disabled={accionando} className="text-xs text-julia-red hover:underline mr-2">Guardar</button>
                          <button onClick={() => { setEditando(null); setDraft(null) }} className="text-xs text-gray-400">✕</button>
                        </>
                      ) : (
                        <button onClick={() => { setEditando(l.id); setDraft({}) }} className="text-xs text-gray-400 hover:text-julia-red">editar</button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
          {(data.lineas?.length || 0) > 0 && (
            <tfoot className="bg-gray-50">
              <tr className="font-medium text-gray-800">
                <td className="px-2 py-2" colSpan={2}>Totales</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(totalesVivo.total_bruto)}</td>
                <td className="px-2 py-2 text-right tabular-nums" colSpan={4}>{formatMoney(totalesVivo.total_adiciones)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-purple-600">{formatMoney(totalesVivo.total_igss_empleados)}</td>
                <td className="px-2 py-2 text-right tabular-nums" colSpan={3}>{formatMoney(totalesVivo.total_descuentos)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatMoney(totalesVivo.total_liquido)}</td>
                {esAdmin && editable && <td></td>}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Workflow estados */}
      {esAdmin && (
        <div className="flex flex-wrap gap-2 justify-end mt-5 pt-4 border-t border-gray-100">
          {data.estado === 'borrador' && (
            <>
              <button onClick={eliminar} disabled={accionando} className="text-xs px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg">Eliminar planilla</button>
              <button onClick={() => cambiarEstado('revision')} disabled={accionando || (data.lineas?.length || 0) === 0} className="btn-primario">Enviar a revisión →</button>
            </>
          )}
          {data.estado === 'revision' && (
            <>
              <button onClick={() => cambiarEstado('borrador')} disabled={accionando} className="text-xs px-3 py-2 text-amber-700 hover:bg-amber-50 rounded-lg">Devolver a borrador</button>
              <button onClick={() => cambiarEstado('aprobada')} disabled={accionando} className="btn-primario">Aprobar →</button>
            </>
          )}
          {data.estado === 'aprobada' && (
            <>
              <button onClick={() => cambiarEstado('borrador')} disabled={accionando} className="text-xs px-3 py-2 text-amber-700 hover:bg-amber-50 rounded-lg">Revertir a borrador</button>
              <button onClick={() => cambiarEstado('pagada')} disabled={accionando} className="btn-primario">Marcar como pagada →</button>
            </>
          )}
          {data.estado === 'pagada' && (
            <span className="text-xs text-gray-400 italic px-2 py-2">Planilla pagada — sin más cambios.</span>
          )}
        </div>
      )}

      {/* Auditoria */}
      {(data.auditoria || []).length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-gray-500 cursor-pointer hover:text-julia-red">Auditoría ({data.auditoria.length} eventos)</summary>
          <ul className="mt-2 text-xs space-y-1">
            {data.auditoria.map(a => (
              <li key={a.id} className="text-gray-500">
                <span className="text-gray-400">{new Date(a.created_at).toLocaleString('es-GT', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}</span>
                {' · '}
                <span className="font-medium text-gray-700">{a.accion}</span>
                {' · '}
                <span>{a.usuario_email}</span>
                {a.notas && <span className="text-gray-400"> — {a.notas}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

// ============================================================================
// Primitives
// ============================================================================

function CeldaEdit({ valor, edit, onChange, tone }) {
  if (!edit) {
    const cls = tone === 'emerald' ? 'text-emerald-600'
              : tone === 'rose' ? 'text-rose-600'
              : 'text-gray-600'
    return <td className={`px-2 py-1.5 text-right tabular-nums ${cls}`}>{formatMoney(valor)}</td>
  }
  const inputCls = tone === 'emerald' ? 'border-emerald-200 bg-emerald-50/40'
                : tone === 'rose' ? 'border-rose-200 bg-rose-50/40'
                : 'border-gray-200'
  return (
    <td className="px-1 py-1">
      <input type="number" step="0.01" value={valor || ''} onChange={e => onChange(e.target.value)}
        className={`w-20 border rounded px-1 py-1 text-xs text-right ${inputCls}`} />
    </td>
  )
}

function KpiBox({ label, value, bold }) {
  return (
    <div className="card-julia p-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`mt-1 tabular-nums ${bold ? 'text-base font-semibold text-gray-900' : 'text-sm text-gray-700'}`}>{value}</div>
    </div>
  )
}

function ModalShell({ titulo, onClose, children, maxWidth = 'max-w-md' }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${maxWidth} my-8`} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  )
}

function Campo({ label, required, children }) {
  return (
    <div className="flex-1">
      <label className="text-xs text-gray-500 block mb-1">
        {label}{required && <span className="text-julia-red ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
