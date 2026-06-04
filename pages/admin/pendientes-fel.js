// pages/admin/pendientes-fel.js
//
// Panel admin para ver facturas en cola de certificación FEL (Infile cayó).
// El cron /api/cron/reintentar-fel cada 5 min las procesa automáticamente.
// Aquí el admin puede:
//   - Ver la cola en vivo (con conteo, edad, último error)
//   - Disparar un reintento manual ("intentar ahora")
//   - Marcar como 'error' una factura que claramente no va a certificarse

import { useEffect, useState } from 'react'
import Head from 'next/head'
import Layout from '../../components/Layout'
import { supabase } from '../../lib/supabase'
import { SkeletonRow } from '../../components/Skeleton'

export default function PendientesFel({ session }) {
  const [perfil, setPerfil] = useState(null)
  const [pendientes, setPendientes] = useState([])
  const [cargando, setCargando] = useState(true)
  const [reintentando, setReintentando] = useState(false)
  const [mensaje, setMensaje] = useState('')

  // Carga perfil + valida admin
  useEffect(() => {
    if (!session) {
      window.location.href = '/'
      return
    }
    supabase.from('perfiles').select('*').eq('id', session.user.id).single()
      .then(({ data }) => setPerfil(data))
  }, [session])

  // Carga pendientes + auto-refresh cada 30s
  useEffect(() => {
    cargarPendientes()
    const t = setInterval(cargarPendientes, 30000)
    return () => clearInterval(t)
  }, [])

  async function cargarPendientes() {
    const { data, error } = await supabase
      .from('facturas_fel')
      .select('id, total, receptor_nit, receptor_nombre, metodo_pago, intentos_certificacion, pendiente_desde, error_ultimo_intento, ultimo_intento_at, created_at')
      .eq('estado', 'pendiente_certificacion')
      .order('pendiente_desde', { ascending: true })
    if (!error) setPendientes(data || [])
    setCargando(false)
  }

  async function disparrarReintento() {
    setReintentando(true)
    setMensaje('')
    try {
      const { data: { session: s } } = await supabase.auth.getSession()
      const r = await fetch('/api/cron/reintentar-fel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Admin logueado pasa por la lógica del header internal — el endpoint
          // acepta CRON_SECRET, INTERNAL_API_SECRET, o user-agent vercel-cron.
          // Por simplicidad acá llamamos con INTERNAL secret vía un proxy server.
          ...(s?.access_token ? { 'Authorization': `Bearer ${s.access_token}` } : {}),
        },
      })
      const j = await r.json()
      if (j.ok) {
        setMensaje(`✅ Procesadas ${j.procesadas}: ${j.certificadas} certificadas, ${j.aun_caido} aún caído, ${j.rechazadas} rechazadas`)
      } else {
        setMensaje(`❌ Error: ${j.error || 'desconocido'}`)
      }
      await cargarPendientes()
    } catch (e) {
      setMensaje(`❌ Error de red: ${e.message}`)
    } finally {
      setReintentando(false)
    }
  }

  if (!perfil) return null
  if (perfil.rol !== 'admin') {
    return (
      <Layout perfil={perfil}>
        <div className="p-8 text-center text-sm text-gray-500">
          Solo administradores.
        </div>
      </Layout>
    )
  }

  function edadHumana(iso) {
    if (!iso) return '-'
    const ms = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return 'recién'
    if (mins < 60) return `${mins} min`
    const horas = Math.floor(mins / 60)
    if (horas < 24) return `${horas} h ${mins % 60}m`
    return `${Math.floor(horas / 24)} d`
  }

  const totalQ = pendientes.reduce((s, f) => s + Number(f.total || 0), 0)
  const vencidos = pendientes.filter(f =>
    f.pendiente_desde && (Date.now() - new Date(f.pendiente_desde).getTime()) > 30 * 60 * 1000
  )

  return (
    <Layout perfil={perfil}>
      <Head><title>Pendientes FEL · Julia Bakery</title></Head>
      <div className="max-w-5xl mx-auto p-4 sm:p-6">

        <h1 className="text-2xl font-bold text-gray-900 mb-1">Cola de certificación FEL</h1>
        <p className="text-sm text-ink-subtle mb-6">
          Facturas que se quedaron esperando Infile. El cron las procesa cada 5 min.
        </p>

        {/* Resumen */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs uppercase tracking-wider text-ink-subtle mb-1">En cola</div>
            <div className="text-3xl font-bold text-gray-900 tabular-nums">{pendientes.length}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs uppercase tracking-wider text-ink-subtle mb-1">Total Q</div>
            <div className="text-3xl font-bold text-gray-900 tabular-nums">Q{totalQ.toFixed(2)}</div>
          </div>
          <div className={`border rounded-xl p-4 ${vencidos.length > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
            <div className="text-xs uppercase tracking-wider text-ink-subtle mb-1">Vencidas (&gt;30min)</div>
            <div className={`text-3xl font-bold tabular-nums ${vencidos.length > 0 ? 'text-amber-700' : 'text-gray-900'}`}>
              {vencidos.length}
            </div>
          </div>
        </div>

        {/* Acción manual */}
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <button
            onClick={disparrarReintento}
            disabled={reintentando || pendientes.length === 0}
            className="bg-julia-red text-white px-4 py-2 rounded-lg font-semibold hover:opacity-90 disabled:opacity-40">
            {reintentando ? 'Reintentando…' : '🔄 Reintentar ahora'}
          </button>
          <button
            onClick={cargarPendientes}
            className="text-sm text-ink-subtle hover:text-julia-red px-3 py-2 font-semibold">
            Recargar
          </button>
          {mensaje && <span className="text-sm text-gray-700">{mensaje}</span>}
        </div>

        {/* Tabla */}
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="text-left px-3 py-2">Receptor</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-left px-3 py-2">Método</th>
                <th className="text-right px-3 py-2">Intentos</th>
                <th className="text-left px-3 py-2">Edad</th>
                <th className="text-left px-3 py-2">Último error</th>
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <>
                  <SkeletonRow cols={6} />
                  <SkeletonRow cols={6} />
                </>
              )}
              {!cargando && pendientes.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-12 text-center text-ink-subtle">
                  ✅ Sin facturas pendientes — Infile está respondiendo bien
                </td></tr>
              )}
              {pendientes.map(f => (
                <tr key={f.id} className="border-t border-gray-100">
                  <td className="px-3 py-2">
                    <div className="font-semibold text-gray-900">{f.receptor_nombre || 'CONSUMIDOR FINAL'}</div>
                    <div className="text-xs text-ink-subtle">{f.receptor_nit || 'CF'}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">Q{Number(f.total).toFixed(2)}</td>
                  <td className="px-3 py-2 text-ink-subtle text-xs">{f.metodo_pago}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{f.intentos_certificacion || 0}</td>
                  <td className="px-3 py-2 text-xs">{edadHumana(f.pendiente_desde)}</td>
                  <td className="px-3 py-2 text-xs text-amber-700 max-w-md truncate" title={f.error_ultimo_intento || ''}>
                    {f.error_ultimo_intento || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-ink-subtle mt-6">
          Auto-refresh cada 30 segundos · Cron de reintentos corre cada 5 minutos
        </p>

      </div>
    </Layout>
  )
}
