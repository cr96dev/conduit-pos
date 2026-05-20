import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabase'
import Layout from '../../components/Layout'
import { useToast, ToastContainer } from '../../components/Toast'

export default function LiquidacionesUNO({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saldos, setSaldos] = useState([])
  const [historial, setHistorial] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({
    estacion_id: '',
    fecha: new Date().toISOString().slice(0, 10),
    monto: '',
    descripcion: ''
  })
  const [guardando, setGuardando] = useState(false)
  const { toasts, toast } = useToast()

  useEffect(() => {
    if (!session) { router.push('/'); return }
    loadData()
  }, [session])

  async function loadData() {
    setLoading(true)
    const { data: p } = await supabase.from('perfiles').select('*').eq('id', session.user.id).single()
    setPerfil(p)
    if (p?.rol !== 'admin') {
      toast('Solo administradores', 'error')
      router.push('/contabilidad')
      return
    }

    // Saldos por estación
    const { data: s } = await supabase.rpc('saldo_cxp_uno_por_estacion')
    setSaldos(s || [])

    // Historial de liquidaciones registradas
    const { data: h } = await supabase
      .from('asientos_contables')
      .select('id, fecha, descripcion, total_debito, referencia, estacion_id, origen, estado, estaciones:estacion_id(nombre), asientos_lineas(cuenta_id, debito, credito, cuentas_contables:cuenta_id(codigo, nombre))')
      .or('tipo.eq.pago_proveedor,tipo.eq.transferencia')
      .ilike('descripcion', '%uno%')
      .neq('estado', 'anulado')
      .order('fecha', { ascending: false })
      .limit(50)
    setHistorial(h || [])

    setLoading(false)
  }

  function openModal(estacion_id = '') {
    setForm({
      estacion_id,
      fecha: new Date().toISOString().slice(0, 10),
      monto: '',
      descripcion: ''
    })
    setModalOpen(true)
  }

  async function registrarLiquidacion() {
    if (!form.estacion_id) { toast('Selecciona estación', 'error'); return }
    const monto = parseFloat(form.monto)
    if (!monto || monto <= 0) { toast('Monto inválido', 'error'); return }
    if (!form.fecha) { toast('Fecha requerida', 'error'); return }

    setGuardando(true)
    const { data, error } = await supabase.rpc('generar_asiento_liquidacion_uno', {
      p_fecha: form.fecha,
      p_estacion_id: form.estacion_id,
      p_monto: monto,
      p_descripcion: form.descripcion || null
    })
    setGuardando(false)

    if (error) {
      toast(`Error: ${error.message}`, 'error')
      return
    }

    toast(`✓ Liquidación registrada Q ${monto.toLocaleString('es-GT', { maximumFractionDigits: 2 })}`, 'success')
    setModalOpen(false)
    await loadData()
  }

  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        <span className="text-sm text-gray-400">Cargando...</span>
      </div>
    </div>
  )

  const totalSaldo = saldos.reduce((s, x) => s + parseFloat(x.saldo || 0), 0)
  const estacionSel = saldos.find(s => s.estacion_id === form.estacion_id)

  return (
    <Layout perfil={perfil}>
      <ToastContainer toasts={toasts} />
      <div className="p-6 max-w-7xl mx-auto">
        <div className="text-sm text-gray-500 mb-2">
          <button onClick={() => router.push('/contabilidad')} className="hover:text-blue-600">Contabilidad</button>
          <span className="mx-2">›</span>
          <span>Liquidaciones UNO</span>
        </div>

        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Liquidaciones UNO Combustible</h1>
            <p className="text-sm text-gray-500 mt-1">
              CxP UNO Total: <span className={`font-medium ${totalSaldo > 0 ? 'text-amber-700' : 'text-gray-700'}`}>
                Q {totalSaldo.toLocaleString('es-GT', { maximumFractionDigits: 2 })}
              </span> en {saldos.length} estaciones
            </p>
          </div>
          <button onClick={() => openModal()}
            className="bg-blue-600 text-white text-sm px-5 py-2.5 rounded-lg hover:bg-blue-700 flex items-center gap-2">
            ＋ Registrar liquidación manual
          </button>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-5">
          <div className="flex items-start gap-3">
            <div className="text-amber-600 text-xl">ℹ</div>
            <div className="text-xs text-amber-900">
              <div className="font-medium mb-1">Conciliación automática</div>
              UNO debita cada 3 días del Banco Industrial. Cuando subís el estado de cuenta BI en <button onClick={() => router.push('/contabilidad/bancos')} className="underline">Bancos</button>, las notas de débito (ND) grandes se reconocen automáticamente y generan el asiento de liquidación. Usá el botón "Registrar manual" solo si necesitás corregir un débito o cargar uno que no se detectó.
            </div>
          </div>
        </div>

        {/* Saldo por estación */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden mb-6">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Saldo CxP UNO por estación</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Estación</th>
                  <th className="text-left px-4 py-2">Cuenta BI</th>
                  <th className="text-right px-4 py-2">Total créditos (ventas)</th>
                  <th className="text-right px-4 py-2">Total débitos (pagado UNO)</th>
                  <th className="text-right px-4 py-2">Saldo pendiente</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {saldos.length === 0 ? (
                  <tr><td colSpan="6" className="text-center py-8 text-gray-400">Sin saldos. Verifica que las ventas de combustible se hayan contabilizado.</td></tr>
                ) : saldos.map(s => {
                  const saldo = parseFloat(s.saldo || 0)
                  return (
                    <tr key={s.estacion_id} className="border-t border-gray-100 hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-medium text-gray-900">{s.estacion_nombre}</td>
                      <td className="px-4 py-2 text-xs text-gray-600">{s.numero_cuenta_bi || '—'}</td>
                      <td className="px-4 py-2 text-right text-xs text-green-700">
                        Q {parseFloat(s.total_haber || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2 text-right text-xs text-red-600">
                        Q {parseFloat(s.total_debe || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })}
                      </td>
                      <td className={`px-4 py-2 text-right font-semibold ${saldo > 0 ? 'text-amber-700' : saldo < 0 ? 'text-blue-700' : 'text-gray-500'}`}>
                        Q {saldo.toLocaleString('es-GT', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button onClick={() => openModal(s.estacion_id)}
                          className="text-xs text-blue-600 hover:underline">
                          Liquidar →
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {saldos.length > 0 && (
                  <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                    <td className="px-4 py-3" colSpan="4">TOTAL</td>
                    <td className={`px-4 py-3 text-right ${totalSaldo > 0 ? 'text-amber-800' : 'text-gray-700'}`}>
                      Q {totalSaldo.toLocaleString('es-GT', { maximumFractionDigits: 2 })}
                    </td>
                    <td></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Historial */}
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h2 className="text-sm font-semibold text-gray-700">Últimas liquidaciones registradas</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Fecha</th>
                  <th className="text-left px-4 py-2">Estación</th>
                  <th className="text-left px-4 py-2">Descripción</th>
                  <th className="text-left px-4 py-2">Referencia</th>
                  <th className="text-right px-4 py-2">Monto</th>
                  <th className="text-left px-4 py-2">Origen</th>
                </tr>
              </thead>
              <tbody>
                {historial.length === 0 ? (
                  <tr><td colSpan="6" className="text-center py-8 text-gray-400">
                    Aún no hay liquidaciones registradas.
                  </td></tr>
                ) : historial.map(a => (
                  <tr key={a.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">{a.fecha}</td>
                    <td className="px-4 py-2 text-xs text-gray-900">{a.estaciones?.nombre || '—'}</td>
                    <td className="px-4 py-2 text-xs text-gray-600 max-w-md truncate" title={a.descripcion}>{a.descripcion}</td>
                    <td className="px-4 py-2 text-xs text-gray-500 font-mono">{a.referencia || '—'}</td>
                    <td className="px-4 py-2 text-right text-xs font-medium text-gray-900">
                      Q {parseFloat(a.total_debito || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {a.origen === 'conciliacion_bancaria' ? (
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded">🔗 Auto BI</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded">✋ Manual</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modal */}
        {modalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setModalOpen(false)}>
            <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">Registrar liquidación UNO</h3>
                  <p className="text-xs text-gray-500 mt-0.5">Solo para registrar manualmente. Las del BI se concilian solas.</p>
                </div>
                <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Estación</label>
                  <select value={form.estacion_id} onChange={e => setForm({...form, estacion_id: e.target.value})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400">
                    <option value="">Selecciona estación...</option>
                    {saldos.map(s => (
                      <option key={s.estacion_id} value={s.estacion_id}>
                        {s.estacion_nombre} (saldo Q {parseFloat(s.saldo || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })})
                      </option>
                    ))}
                  </select>
                  {estacionSel && (
                    <p className="text-xs text-gray-500 mt-1">
                      Cuenta BI: <span className="font-mono">{estacionSel.numero_cuenta_bi}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Fecha del débito</label>
                  <input type="date" value={form.fecha} onChange={e => setForm({...form, fecha: e.target.value})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Monto (Q)</label>
                  <input type="number" step="0.01" value={form.monto} onChange={e => setForm({...form, monto: e.target.value})}
                    placeholder="0.00"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Descripción (opcional)</label>
                  <input type="text" value={form.descripcion} onChange={e => setForm({...form, descripcion: e.target.value})}
                    placeholder="Ej: Débito UNO ND-12345"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
                </div>
              </div>

              <div className="flex gap-2 mt-5">
                <button onClick={() => setModalOpen(false)}
                  className="flex-1 border border-gray-200 text-gray-700 text-sm px-4 py-2 rounded-lg hover:bg-gray-50">
                  Cancelar
                </button>
                <button onClick={registrarLiquidacion} disabled={guardando}
                  className="flex-1 bg-blue-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {guardando && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                  {guardando ? 'Guardando...' : 'Registrar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  )
}
