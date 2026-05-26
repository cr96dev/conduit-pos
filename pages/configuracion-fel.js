// pages/configuracion-fel.js
// Página de configuración FEL: datos del emisor + credenciales Infile/FEEL.
// Las llaves nunca se hardcodean; se guardan en la tabla config_fel.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

const VACIO = {
  // Emisor
  nit_emisor: '',
  nombre_comercial: '',
  razon_social: '',
  direccion: 'CIUDAD DE GUATEMALA',
  codigo_postal: '01001',
  municipio: 'GUATEMALA',
  departamento: 'GUATEMALA',
  pais: 'GT',
  afiliacion_iva: 'GEN',
  codigo_establecimiento: 1,
  email_emisor: '',
  telefono_emisor: '',
  // Infile
  infile_url_firma: 'https://signer-emisores.feel.com.gt/sign_solicitud_firmas/firma_xml',
  infile_url_cert: 'https://certificador.feel.com.gt/fel/certificacion/v2/dte/',
  infile_url_consulta_nit: 'https://consultareceptores.feel.com.gt/rest/action',
  infile_alias_firma: '',
  infile_llave_firma: '',
  infile_usuario_cert: '',
  infile_llave_cert: '',
  infile_ambiente: 'demo',
}

export default function ConfiguracionFEL({ session }) {
  const router = useRouter()
  const [perfil, setPerfil] = useState(null)
  const [form, setForm] = useState(VACIO)
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState(null)
  const [okMsg, setOkMsg] = useState(null)
  const [health, setHealth] = useState(null)
  const [probando, setProbando] = useState(false)

  useEffect(() => {
    if (!session) { router.push('/'); return }
    supabase.from('perfiles').select('id, email, nombre_completo, rol, activo').eq('id', session.user.id).single()
      .then(({ data }) => setPerfil(data || { id: session.user.id, email: session.user.email, rol: 'empleado' }))
    cargar()
  }, [session])

  async function cargar() {
    setLoading(true); setErr(null)
    const res = await apiFetch('/api/fel/config')
    const json = await res.json()
    setLoading(false)
    if (!res.ok) { setErr(json.error || 'Error cargando config'); return }
    if (json.config) {
      // Mezclar la fila guardada sobre los defaults (sin pisar con null/undefined).
      const next = { ...VACIO }
      for (const k of Object.keys(VACIO)) {
        if (json.config[k] != null && json.config[k] !== '') next[k] = json.config[k]
      }
      setForm(next)
    }
  }

  const esAdmin = perfil?.rol === 'admin'

  function set(k, v) {
    setForm(f => ({ ...f, [k]: v }))
    setOkMsg(null)
  }

  async function guardar(e) {
    e.preventDefault()
    setErr(null); setOkMsg(null); setGuardando(true)
    if (!form.nit_emisor.trim() || !form.nombre_comercial.trim()) {
      setErr('NIT emisor y Nombre comercial son obligatorios.')
      setGuardando(false)
      return
    }
    const payload = { ...form }
    payload.codigo_establecimiento = Number(form.codigo_establecimiento) || 1
    const res = await apiFetch('/api/fel/config', { method: 'PUT', body: JSON.stringify(payload) })
    const json = await res.json()
    setGuardando(false)
    if (!res.ok) { setErr(json.error || 'Error guardando'); return }
    setOkMsg('Configuración guardada.')
  }

  async function probar() {
    setProbando(true); setHealth(null); setErr(null)
    const res = await apiFetch('/api/fel/health-check')
    const json = await res.json()
    setProbando(false)
    setHealth(json)
  }

  const hayCredsInfile = !!(form.infile_alias_firma && form.infile_llave_firma && form.infile_llave_cert)

  if (loading) {
    return <Layout perfil={perfil}><div className="p-6 text-sm text-gray-400">Cargando…</div></Layout>
  }

  return (
    <Layout perfil={perfil}>
      <Head><title>Configuración FEL · Julia Bakery</title></Head>
      <div className="px-4 md:px-10 py-7 max-w-4xl mx-auto">
        <div className="mb-5">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Configuración FEL</h1>
          <p className="text-sm text-gray-500 mt-1">
            Datos del emisor y credenciales del certificador <strong>Infile / FEEL</strong>.
            Las llaves se guardan cifradas en la base; no aparecen en el código fuente.
          </p>
        </div>

        {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-700 mb-4">{err}</div>}
        {okMsg && <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-sm text-emerald-700 mb-4">{okMsg}</div>}

        <form onSubmit={guardar} className="space-y-6">
          {/* DATOS DEL EMISOR */}
          <Seccion titulo="Datos del emisor (van en el XML del DTE)">
            <Grid2>
              <Campo label="NIT emisor (sin guiones)" required>
                <input type="text" value={form.nit_emisor} onChange={e => set('nit_emisor', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Código establecimiento">
                <input type="number" min="1" value={form.codigo_establecimiento} onChange={e => set('codigo_establecimiento', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Nombre comercial" required>
                <input type="text" value={form.nombre_comercial} onChange={e => set('nombre_comercial', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Razón social">
                <input type="text" value={form.razon_social} onChange={e => set('razon_social', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Email emisor">
                <input type="email" value={form.email_emisor} onChange={e => set('email_emisor', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Teléfono emisor">
                <input type="text" value={form.telefono_emisor} onChange={e => set('telefono_emisor', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Dirección">
                <input type="text" value={form.direccion} onChange={e => set('direccion', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Código postal">
                <input type="text" value={form.codigo_postal} onChange={e => set('codigo_postal', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Municipio">
                <input type="text" value={form.municipio} onChange={e => set('municipio', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Departamento">
                <input type="text" value={form.departamento} onChange={e => set('departamento', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="País">
                <input type="text" value={form.pais} onChange={e => set('pais', e.target.value)} className="input" disabled={!esAdmin} />
              </Campo>
              <Campo label="Afiliación IVA">
                <select value={form.afiliacion_iva} onChange={e => set('afiliacion_iva', e.target.value)} className="input" disabled={!esAdmin}>
                  <option value="GEN">GEN (Régimen general)</option>
                  <option value="PEQ">PEQ (Pequeño contribuyente)</option>
                  <option value="EXE">EXE (Exento)</option>
                </select>
              </Campo>
            </Grid2>
          </Seccion>

          {/* CREDENCIALES INFILE */}
          <Seccion titulo="Credenciales Infile / FEEL"
            subtitulo="Estas llaves las da Infile. Usar las del ambiente DEMO mientras se prueba; cambiar a las de PROD cuando todo cuadre.">
            <Grid2>
              <Campo label="Ambiente">
                <select value={form.infile_ambiente} onChange={e => set('infile_ambiente', e.target.value)} className="input" disabled={!esAdmin}>
                  <option value="demo">demo (pruebas)</option>
                  <option value="prod">prod (real)</option>
                </select>
              </Campo>
              <div /> {/* spacer */}
              <Campo label="Alias firma (alias en el firmador / usuario certificador / emisor_codigo NIT)" required>
                <input type="text" value={form.infile_alias_firma} onChange={e => set('infile_alias_firma', e.target.value)} className="input" disabled={!esAdmin} placeholder="ej. CARLOSR_DEMO" />
              </Campo>
              <Campo label="Llave firma" required>
                <input type="password" value={form.infile_llave_firma} onChange={e => set('infile_llave_firma', e.target.value)} className="input font-mono" disabled={!esAdmin} placeholder="••••••••" autoComplete="off" />
              </Campo>
              <Campo label="Usuario certificador (default = alias firma)">
                <input type="text" value={form.infile_usuario_cert} onChange={e => set('infile_usuario_cert', e.target.value)} className="input" disabled={!esAdmin} placeholder="dejar vacío para usar el alias" />
              </Campo>
              <Campo label="Llave certificador (también consulta NIT)" required>
                <input type="password" value={form.infile_llave_cert} onChange={e => set('infile_llave_cert', e.target.value)} className="input font-mono" disabled={!esAdmin} placeholder="••••••••" autoComplete="off" />
              </Campo>
            </Grid2>
            <details className="mt-3 text-xs text-gray-500">
              <summary className="cursor-pointer hover:text-gray-700">URLs avanzadas (dejar default normalmente)</summary>
              <div className="mt-3 space-y-3">
                <Campo label="URL firma">
                  <input type="text" value={form.infile_url_firma} onChange={e => set('infile_url_firma', e.target.value)} className="input text-xs" disabled={!esAdmin} />
                </Campo>
                <Campo label="URL certificador">
                  <input type="text" value={form.infile_url_cert} onChange={e => set('infile_url_cert', e.target.value)} className="input text-xs" disabled={!esAdmin} />
                </Campo>
                <Campo label="URL consulta NIT">
                  <input type="text" value={form.infile_url_consulta_nit} onChange={e => set('infile_url_consulta_nit', e.target.value)} className="input text-xs" disabled={!esAdmin} />
                </Campo>
              </div>
            </details>
          </Seccion>

          {esAdmin && (
            <div className="flex items-center justify-between">
              <div className="text-xs text-gray-400">
                {hayCredsInfile
                  ? <span className="text-emerald-600">✓ Credenciales Infile completas</span>
                  : <span className="text-amber-600">⚠ Faltan credenciales Infile</span>}
              </div>
              <button type="submit" disabled={guardando} className="btn-primario">
                {guardando ? 'Guardando…' : 'Guardar configuración'}
              </button>
            </div>
          )}
        </form>

        {/* PRUEBA / HEALTH CHECK */}
        {esAdmin && hayCredsInfile && (
          <div className="mt-8 bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
            <h2 className="text-base font-medium text-gray-900 mb-2">Prueba de conexión Infile</h2>
            <p className="text-xs text-gray-500 mb-3">
              Llama a <code>/api/fel/health-check</code> que valida config + intenta emitir una factura de prueba
              CF Q 1.00 contra el ambiente <strong>{form.infile_ambiente}</strong> de Infile. La factura se marca como
              certificada en la DB y queda visible en Facturación.
            </p>
            <button onClick={probar} disabled={probando} className="text-xs px-3 py-1.5 border border-gray-200 text-gray-700 rounded-md hover:border-julia-red hover:text-julia-red bg-white">
              {probando ? 'Probando…' : '▷ Ejecutar prueba demo'}
            </button>
            {health && (
              <pre className="mt-4 p-3 bg-gray-50 border border-gray-100 rounded-lg text-[11px] overflow-auto max-h-96">
{JSON.stringify(health, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </Layout>
  )
}

function Seccion({ titulo, subtitulo, children }) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5">
      <div className="mb-4">
        <h2 className="text-base font-medium text-gray-900">{titulo}</h2>
        {subtitulo && <p className="text-xs text-gray-500 mt-1">{subtitulo}</p>}
      </div>
      {children}
    </div>
  )
}

function Grid2({ children }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{children}</div>
}

function Campo({ label, required, children }) {
  return (
    <label className="block">
      <span className="text-xs text-gray-500 mb-1 block">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  )
}
