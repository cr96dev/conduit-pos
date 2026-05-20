import { useRouter } from 'next/router'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const navItems = [
  { href: '/dashboard',   label: 'Inicio',      icon: 'M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 3h2v-2h-2v-2h-2v2h-2v2h2v2h2v-2z' },
  { href: '/ventas',      label: 'Ventas',       icon: 'M3 17l4-8 4 4 4-7 4 6' },
  { href: '/lubricantes', label: 'Lubricantes',  icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' },
  { href: '/tanques',     label: 'Tanques',      icon: 'M11 2a9 9 0 100 18A9 9 0 0011 2zm1 2.07V11h6.93A7 7 0 0112 4.07zM4 12a7 7 0 017-7v7l-4.95 4.95A6.97 6.97 0 014 12z' },
  { href: '/inventario',  label: 'Inventario',   icon: 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM4 5h16v2H4V5z' },
  { href: '/entregas',    label: 'Entregas',     icon: 'M1 3h15v13H1V3zm15 5h4l3 3v5h-7V8z' },
  { href: '/entregas-productos', label: 'Entregas prod.', icon: 'M3 7h18M3 12h18M3 17h18M5 7v10M9 7v10M15 7v10M19 7v10' },
  { href: '/facturacion', label: 'Facturas',     icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM6 20V4h7v5h5v11H6z' },
]

const adminItems = [
  { href: '/admin',        label: 'Panel general', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
  { href: '/inventario',   label: 'Inventario',    icon: 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM4 5h16v2H4V5z' },
  { href: '/entregas-productos', label: 'Entregas productos', icon: 'M3 7h18M3 12h18M3 17h18M5 7v10M9 7v10M15 7v10M19 7v10' },
  { href: '/wsm',          label: 'Wetstock',      icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z' },
  { href: '/reportes',     label: 'Reportes',      icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { href: '/facturas-fel', label: 'Facturas FEL',  icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { href: '/compras',     label: 'Compras FEL',   icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z' },
  { href: '/tienda',       label: 'Tienda',        icon: 'M3 3h18v4H3V3zm0 6h18v12H3V9zm4 2v8h2v-8H7zm4 0v8h2v-8h-2zm4 0v8h2v-8h-2z' },
  { href: '/planillas',    label: 'Planillas',     icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/igss',         label: 'IGSS',          icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { href: '/liquidaciones',label: 'Liquidaciones', icon: 'M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z' },
]

const contabilidadItems = [
  { href: '/contabilidad',        label: 'Centro contable', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { href: '/contabilidad/cuentas', label: 'Catálogo cuentas', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
  { href: '/contabilidad/compras-pendientes', label: 'Compras pendientes', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { href: '/contabilidad/bancos', label: 'Bancos', icon: 'M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3' },
  { href: '/contabilidad/liquidaciones-uno', label: 'Liquidaciones UNO', icon: 'M9 14l6-6m-5.5.5h.01m4.99 5h.01M9 19l3 3m0 0l3-3m-3 3V10m6-7l-3 3m0 0l-3-3m3 3v11' },
]

const OAKLAND_ID = '85da69a8-1e81-48a7-8b0d-82df9eeec15e'

function ModalCambioContrasena({ onClose }) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(false)

  async function handleGuardar(e) {
    e.preventDefault()
    setError('')

    if (nueva.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (nueva !== confirmar) {
      setError('Las contraseñas no coinciden.')
      return
    }

    setGuardando(true)

    const { data: { user } } = await supabase.auth.getUser()
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: actual,
    })

    if (signInError) {
      setError('La contraseña actual es incorrecta.')
      setGuardando(false)
      return
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: nueva })
    if (updateError) {
      setError('Error al cambiar la contraseña. Intenta de nuevo.')
    } else {
      setExito(true)
    }
    setGuardando(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Cambiar contraseña</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        {exito ? (
          <div className="px-6 py-8 text-center">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-sm font-medium text-gray-900 mb-1">Contraseña actualizada</div>
            <div className="text-xs text-gray-400 mb-4">Tu contraseña fue cambiada exitosamente.</div>
            <button onClick={onClose} className="text-sm px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleGuardar} className="px-6 py-5 space-y-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Contraseña actual</label>
              <input type="password" value={actual} onChange={e => setActual(e.target.value)} required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Nueva contraseña</label>
              <input type="password" value={nueva} onChange={e => setNueva(e.target.value)} required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Confirmar nueva contraseña</label>
              <input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            {error && (
              <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{error}</div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="text-sm px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600">
                Cancelar
              </button>
              <button type="submit" disabled={guardando}
                className="text-sm px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {guardando && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                {guardando ? 'Guardando...' : 'Cambiar contraseña'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

const CARGAS_RETRO_EMAILS = ['adoffice569@gmail.com', 'estacionesdeservicioguatemala@gmail.com']

export default function Layout({ children, perfil, estacion }) {
  const router = useRouter()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [modalContrasena, setModalContrasena] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const esAdmin = perfil?.rol === 'admin'
  const esOakland = perfil?.estacion_id === OAKLAND_ID
  const puedeVerCargasRetro = CARGAS_RETRO_EMAILS.includes(userEmail)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.email) setUserEmail(user.email)
    })
  }, [])

  const itemsVisibles = esAdmin ? [] : navItems.filter(item => {
    if (item.href === '/tienda') return esOakland
    return true
  })

  useEffect(() => {
    const saved = localStorage.getItem('darkMode') === 'true'
    setDarkMode(saved)
    if (saved) document.documentElement.classList.add('dark')
  }, [])

  function toggleDark() {
    const next = !darkMode
    setDarkMode(next)
    localStorage.setItem('darkMode', next)
    if (next) document.documentElement.classList.add('dark')
    else document.documentElement.classList.remove('dark')
  }

  async function logout() {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="flex min-h-screen bg-gray-50">

      {modalContrasena && <ModalCambioContrasena onClose={() => setModalContrasena(false)} />}

      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-100 flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-gray-100 flex flex-col items-center">
          <button onClick={() => router.push(esAdmin ? '/admin' : '/dashboard')} className="w-full">
            <img src="/logo.svg" alt="GasOps" className="w-full object-contain mb-1" style={{ height: '80px' }} />
          </button>
          <div className="text-xs text-gray-400 text-center truncate w-full mt-1">
            {esAdmin ? 'Administrador' : (estacion?.nombre || '...')}
          </div>
        </div>

        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {itemsVisibles.map(item => {
            const active = router.pathname === item.href
            return (
              <button key={item.href} onClick={() => router.push(item.href)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </button>
            )
          })}

          {esAdmin && (
            <>
              <div className="px-3 pt-2 pb-1 text-xs text-gray-400 uppercase tracking-wider">Admin</div>
              {adminItems.map(item => {
                const active = router.pathname === item.href
                return (
                  <button key={item.href} onClick={() => router.push(item.href)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                    }`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    {item.label}
                  </button>
                )
              })}
              {puedeVerCargasRetro && (
                <button onClick={() => router.push('/admin/ventas-retroactivas')}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    router.pathname === '/admin/ventas-retroactivas' ? 'bg-amber-50 text-amber-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Cargas retroactivas
                </button>
              )}
              {puedeVerCargasRetro && (
                <button onClick={() => router.push('/admin/neonet')}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    router.pathname === '/admin/neonet' ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 6h18M3 14h18M3 18h18" />
                  </svg>
                  Auditoría Neonet
                </button>
              )}
              {puedeVerCargasRetro && (
                <button onClick={() => router.push('/admin/bac')}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                    router.pathname === '/admin/bac' ? 'bg-red-50 text-red-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                  Auditoría BAC
                </button>
              )}

              {/* NUEVO: sección Contabilidad */}
              <div className="px-3 pt-3 pb-1 text-xs text-gray-400 uppercase tracking-wider flex items-center gap-2">
                Contabilidad
                <span className="text-[9px] bg-green-100 text-green-700 px-1 py-0 rounded">NUEVO</span>
              </div>
              {contabilidadItems.map(item => {
                const active = router.pathname === item.href
                return (
                  <button key={item.href} onClick={() => router.push(item.href)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                    }`}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    {item.label}
                  </button>
                )
              })}
            </>
          )}

          {!esAdmin && esOakland && (
            <>
              <div className="px-3 pt-3 pb-1 text-xs text-gray-400 uppercase tracking-wider">Tienda</div>
              <button onClick={() => router.push('/tienda')}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  router.pathname === '/tienda' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                }`}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h18v4H3V3zm0 6h18v12H3V9zm4 2v8h2v-8H7zm4 0v8h2v-8h-2zm4 0v8h2v-8h-2z" />
                </svg>
                Tienda
              </button>
            </>
          )}
        </nav>

        <div className="px-4 py-3 border-t border-gray-100">
          <button onClick={toggleDark}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 mb-2 transition-colors">
            <span className="text-xs text-gray-500">{darkMode ? 'Modo día' : 'Modo noche'}</span>
            <div className={`w-8 h-4 rounded-full transition-colors relative ${darkMode ? 'bg-blue-600' : 'bg-gray-200'}`}>
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform shadow-sm ${darkMode ? 'translate-x-4' : 'translate-x-0.5'}`}></div>
            </div>
          </button>
          <div className="text-xs text-gray-500 truncate mb-1">{perfil?.nombre_completo}</div>
          <div className="flex items-center justify-between">
            <button onClick={() => setModalContrasena(true)}
              className="text-xs text-gray-400 hover:text-blue-500 transition-colors">
              Cambiar contraseña
            </button>
            <button onClick={logout} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
              Cerrar sesión
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Topbar móvil */}
        <div className="md:hidden bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
          <button onClick={() => router.push(esAdmin ? '/admin' : '/dashboard')}>
            <img src="/logo.svg" alt="GasOps" style={{ height: '32px' }} />
          </button>
          <div className="flex items-center gap-2">
            <button onClick={toggleDark} className="p-2 rounded-lg hover:bg-gray-50">
              {darkMode ? (
                <svg className="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm0 15a5 5 0 100-10 5 5 0 000 10zm7-5a1 1 0 011-1h1a1 1 0 110 2h-1a1 1 0 01-1-1zM4 12a1 1 0 01-1 1H2a1 1 0 110-2h1a1 1 0 011 1zm14.95 5.536a1 1 0 010 1.414l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 0zm-12.9 0a1 1 0 011.414 0l.707.707a1 1 0 01-1.414 1.414l-.707-.707a1 1 0 010-1.414zm12.9-14.072a1 1 0 011.414 1.414l-.707.707a1 1 0 01-1.414-1.414l.707-.707zM6.05 5.05a1 1 0 010 1.414l-.707.707A1 1 0 013.93 5.757l.707-.707A1 1 0 016.05 5.05zM12 20a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1z"/>
                </svg>
              ) : (
                <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
                </svg>
              )}
            </button>
            <span className="text-xs text-gray-500 truncate max-w-24">
              {esAdmin ? 'Admin' : (estacion?.nombre || '')}
            </span>
            <button onClick={() => setMenuAbierto(!menuAbierto)} className="p-2 rounded-lg hover:bg-gray-50">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                {menuAbierto
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                }
              </svg>
            </button>
          </div>
        </div>

        {/* Menú desplegable móvil */}
        {menuAbierto && (
          <div className="md:hidden bg-white border-b border-gray-100 px-2 py-2 z-10">
            {itemsVisibles.map(item => {
              const active = router.pathname === item.href
              return (
                <button key={item.href}
                  onClick={() => { router.push(item.href); setMenuAbierto(false) }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                    active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {item.label}
                </button>
              )
            })}
            {esAdmin && (
              <>
                <div className="px-4 pt-2 pb-1 text-xs text-gray-400 uppercase tracking-wider">Admin</div>
                {adminItems.map(item => {
                  const active = router.pathname === item.href
                  return (
                    <button key={item.href}
                      onClick={() => { router.push(item.href); setMenuAbierto(false) }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                        active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                      }`}>
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                      {item.label}
                    </button>
                  )
                })}
                {puedeVerCargasRetro && (
                  <button onClick={() => { router.push('/admin/ventas-retroactivas'); setMenuAbierto(false) }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                      router.pathname === '/admin/ventas-retroactivas' ? 'bg-amber-50 text-amber-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                    }`}>
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Cargas retroactivas
                  </button>
                )}
                {puedeVerCargasRetro && (
                  <button onClick={() => { router.push('/admin/neonet'); setMenuAbierto(false) }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                      router.pathname === '/admin/neonet' ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                    }`}>
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 6h18M3 14h18M3 18h18" />
                    </svg>
                    Auditoría Neonet
                  </button>
                )}
                {puedeVerCargasRetro && (
                  <button onClick={() => { router.push('/admin/bac'); setMenuAbierto(false) }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                      router.pathname === '/admin/bac' ? 'bg-red-50 text-red-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                    }`}>
                    <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    Auditoría BAC
                  </button>
                )}

                {/* NUEVO: sección Contabilidad mobile */}
                <div className="px-4 pt-2 pb-1 text-xs text-gray-400 uppercase tracking-wider flex items-center gap-2">
                  Contabilidad
                  <span className="text-[9px] bg-green-100 text-green-700 px-1 py-0 rounded">NUEVO</span>
                </div>
                {contabilidadItems.map(item => {
                  const active = router.pathname === item.href
                  return (
                    <button key={item.href}
                      onClick={() => { router.push(item.href); setMenuAbierto(false) }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                        active ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-600 hover:bg-gray-50'
                      }`}>
                      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                      </svg>
                      {item.label}
                    </button>
                  )
                })}
              </>
            )}
            <div className="border-t border-gray-100 mt-2 pt-2 px-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-400 mb-1">{perfil?.nombre_completo}</div>
                <button onClick={() => { setModalContrasena(true); setMenuAbierto(false) }}
                  className="text-xs text-blue-500 hover:text-blue-700">
                  Cambiar contraseña
                </button>
              </div>
              <button onClick={logout} className="text-xs text-red-400 hover:text-red-600">Cerrar sesión</button>
            </div>
          </div>
        )}

        {/* Contenido */}
        <main className="flex-1 min-w-0 pb-20">
          {children}
        </main>

        {/* Barra inferior móvil */}
        {!esAdmin && (
          <nav className="md:hidden bg-white border-t border-gray-100 fixed bottom-0 left-0 right-0 z-10">
            <div className="grid grid-cols-6 px-1">
              {itemsVisibles.slice(0, 6).map(item => {
                const active = router.pathname === item.href
                return (
                  <button key={item.href}
                    onClick={() => { router.push(item.href); setMenuAbierto(false) }}
                    className={`flex flex-col items-center py-2 px-0.5 transition-colors ${
                      active ? 'text-blue-600' : 'text-gray-400'
                    }`}>
                    <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                    </svg>
                    <span className="text-xs leading-tight">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </nav>
        )}
      </div>
    </div>
  )
}
