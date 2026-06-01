import { useRouter } from 'next/router'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Item 0 ('Inicio') queda fijo arriba (es la landing del usuario);
// el resto se ordena alfabeticamente con localeCompare('es') para que
// acentos y ñ ordenen como correspondan en español.
const _itemInicio = { href: '/dashboard', label: 'Inicio', icon: 'M3 12l9-9 9 9M5 10v10h14V10' }
const _restoItems = [
  { href: '/ventas',     label: 'Ventas',     icon: 'M3 17l4-8 4 4 4-7 4 6' },
  { href: '/caja',       label: 'Caja',       icon: 'M3 10h18M7 15h.01M11 15h2M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  { href: '/productos',  label: 'Productos',  icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4' },
  { href: '/recetas',    label: 'Recetas',    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M12 11h4M12 15h4M8 11h.01M8 15h.01' },
  { href: '/produccion', label: 'Producción', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
  { href: '/inventario', label: 'Inventario', icon: 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM4 5h16v2H4V5z' },
  { href: '/compras',    label: 'Compras',    icon: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z' },
  { href: '/empleados',  label: 'Empleados',  icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/planillas',     label: 'Planillas',     icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { href: '/liquidaciones', label: 'Liquidaciones', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { href: '/igss',          label: 'IGSS',          icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { href: '/contabilidad',  label: 'Contabilidad',  icon: 'M9 17v-2a4 4 0 014-4h4M5 7h14M5 7a2 2 0 012-2h10a2 2 0 012 2M5 7v12a2 2 0 002 2h10a2 2 0 002-2V7' },
  { href: '/reportes',      label: 'Reportes',      icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { href: '/facturacion',   label: 'Facturación',   icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { href: '/bancos',        label: 'Bancos',        icon: 'M4 10h16M5 6l7-3 7 3M4 10v10h16V10M9 14h6m-6 4h6' },
  { href: '/pos',           label: 'Punto de Venta', icon: 'M3 3h18v4H3zM3 11h18M3 7v14h18V7M8 11v10m8-10v10' },
  { href: '/cajeros',       label: 'Cajeros',       icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/admin/turnos',  label: 'Turnos',        icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
  { href: '/soporte',       label: 'Soporte',       icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
].sort((a, b) => a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }))

const navItems = [_itemInicio, ..._restoItems]

// Subset que aparece en la barra inferior movil (limite practico: 6).
// El resto sigue accesible desde el menu hamburguesa.
const bottomNavItems = navItems.slice(0, 6)

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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-modal w-full max-w-sm animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-gray-900">Cambiar contraseña</h2>
          <button onClick={onClose} className="text-ink-subtle hover:text-ink w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-50">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {exito ? (
          <div className="px-6 py-8 text-center">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--success-soft)' }}>
              <svg className="w-6 h-6" fill="none" stroke="var(--success)" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-sm font-bold text-gray-900 mb-1">Contraseña actualizada</div>
            <div className="text-xs text-ink-subtle mb-5">Tu contraseña fue cambiada exitosamente.</div>
            <button onClick={onClose} className="btn-primario w-full justify-center">
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleGuardar} className="px-6 py-5 space-y-4">
            <div>
              <label className="label-tech block mb-1.5">Contraseña actual</label>
              <input type="password" value={actual} onChange={e => setActual(e.target.value)} required className="input" />
            </div>
            <div>
              <label className="label-tech block mb-1.5">Nueva contraseña</label>
              <input type="password" value={nueva} onChange={e => setNueva(e.target.value)} required className="input" />
            </div>
            <div>
              <label className="label-tech block mb-1.5">Confirmar nueva contraseña</label>
              <input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} required className="input" />
            </div>
            {error && (
              <div className="rounded-lg px-3 py-2.5 text-xs font-medium" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                {error}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="btn-secundario">
                Cancelar
              </button>
              <button type="submit" disabled={guardando} className="btn-primario">
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

export default function Layout({ children, perfil }) {
  const router = useRouter()
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [modalContrasena, setModalContrasena] = useState(false)

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
    <div className="flex min-h-screen bg-surface-2">

      {modalContrasena && <ModalCambioContrasena onClose={() => setModalContrasena(false)} />}

      {/* Sidebar desktop — slim + tech */}
      <aside className="hidden md:flex w-60 bg-white border-r border-gray-100 flex-col flex-shrink-0">
        {/* Brand */}
        <div className="px-5 py-4 border-b border-gray-100">
          <button onClick={() => router.push('/dashboard')} className="w-full flex items-center gap-2.5 group">
            <img src="/logo.png" alt="" className="h-9 w-auto object-contain flex-shrink-0" />
            <div className="text-left flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-900 leading-tight truncate">Julia Bakery</div>
              <div className="text-2xs text-ink-subtle font-medium uppercase tracking-wider leading-tight">Operación</div>
            </div>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 space-y-0.5 px-2.5 overflow-y-auto">
          {navItems.map(item => {
            const active = router.pathname === item.href
            return (
              <button key={item.href} onClick={() => router.push(item.href)}
                className={`group relative w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  active
                    ? 'bg-julia-red/[0.07] text-julia-red'
                    : 'text-ink-muted hover:bg-gray-50 hover:text-gray-900'
                }`}>
                {/* Indicador active: barra vertical roja sutil */}
                {active && (
                  <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r-full bg-julia-red" />
                )}
                <svg className={`w-4 h-4 flex-shrink-0 transition-colors ${active ? 'text-julia-red' : 'text-ink-subtle group-hover:text-ink-muted'}`}
                  fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                <span className="truncate">{item.label}</span>
              </button>
            )
          })}
        </nav>

        {/* Footer: user + dark + acciones */}
        <div className="px-3 py-3 border-t border-gray-100 space-y-2">
          {/* Toggle modo noche — switch tech */}
          <button onClick={toggleDark}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg hover:bg-gray-50 transition-colors group">
            <span className="flex items-center gap-2 text-xs font-medium text-ink-subtle group-hover:text-ink-muted">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                {darkMode
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />}
              </svg>
              {darkMode ? 'Modo día' : 'Modo noche'}
            </span>
            <div className={`w-7 h-4 rounded-full transition-colors relative ${darkMode ? 'bg-julia-red' : 'bg-gray-200'}`}>
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform shadow-xs ${darkMode ? 'translate-x-3.5' : 'translate-x-0.5'}`}></div>
            </div>
          </button>

          {/* Perfil */}
          <div className="px-2.5 py-2 rounded-lg bg-gray-50">
            <div className="text-xs font-semibold text-gray-900 truncate">{perfil?.nombre_completo || 'Usuario'}</div>
            <div className="text-2xs text-ink-subtle truncate font-mono">{perfil?.email || ''}</div>
          </div>

          {/* Acciones */}
          <div className="flex items-center justify-between gap-2 px-1">
            <button onClick={() => setModalContrasena(true)}
              className="text-2xs text-ink-subtle hover:text-julia-red transition-colors font-medium uppercase tracking-wider">
              Contraseña
            </button>
            <button onClick={logout}
              className="text-2xs text-ink-subtle hover:text-red-500 transition-colors font-medium uppercase tracking-wider flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              Salir
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Topbar movil — slim tech */}
        <div className="md:hidden bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm bg-white/95">
          <button onClick={() => router.push('/dashboard')} className="flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-7 w-auto" />
            <span className="text-sm font-bold text-gray-900">Julia Bakery</span>
          </button>
          <div className="flex items-center gap-1">
            <button onClick={toggleDark} className="p-2 rounded-lg hover:bg-gray-50 text-ink-muted hover:text-ink"
              aria-label={darkMode ? 'Modo día' : 'Modo noche'}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                {darkMode
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />}
              </svg>
            </button>
            <button onClick={() => setMenuAbierto(!menuAbierto)} className="p-2 rounded-lg hover:bg-gray-50 text-ink-muted hover:text-ink"
              aria-label={menuAbierto ? 'Cerrar menú' : 'Abrir menú'}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                {menuAbierto
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                }
              </svg>
            </button>
          </div>
        </div>

        {/* Menu desplegable movil */}
        {menuAbierto && (
          <div className="md:hidden bg-white border-b border-gray-100 px-2 py-2 z-10 animate-slide-up">
            {navItems.map(item => {
              const active = router.pathname === item.href
              return (
                <button key={item.href}
                  onClick={() => { router.push(item.href); setMenuAbierto(false) }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? 'bg-julia-red/[0.07] text-julia-red'
                      : 'text-ink-muted hover:bg-gray-50 hover:text-gray-900'
                  }`}>
                  <svg className={`w-5 h-5 flex-shrink-0 ${active ? 'text-julia-red' : 'text-ink-subtle'}`}
                    fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {item.label}
                </button>
              )
            })}
            <div className="border-t border-gray-100 mt-2 pt-2 px-4 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-gray-900 truncate">{perfil?.nombre_completo || 'Usuario'}</div>
                <div className="text-2xs text-ink-subtle font-mono mt-0.5">{perfil?.email || ''}</div>
                <button onClick={() => { setModalContrasena(true); setMenuAbierto(false) }}
                  className="mt-1 text-2xs text-julia-red font-medium uppercase tracking-wider">
                  Cambiar contraseña
                </button>
              </div>
              <button onClick={logout}
                className="text-2xs text-ink-subtle hover:text-red-500 font-medium uppercase tracking-wider flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Salir
              </button>
            </div>
          </div>
        )}

        {/* Contenido */}
        <main className="flex-1 min-w-0 pb-20 md:pb-0">
          {children}
        </main>

        {/* Barra inferior movil — slim */}
        <nav className="md:hidden bg-white border-t border-gray-100 fixed bottom-0 left-0 right-0 z-10 backdrop-blur-sm bg-white/95">
          <div className="grid grid-cols-6 px-0.5">
            {bottomNavItems.map(item => {
              const active = router.pathname === item.href
              return (
                <button key={item.href}
                  onClick={() => { router.push(item.href); setMenuAbierto(false) }}
                  className={`flex flex-col items-center py-2 px-0.5 transition-colors relative ${
                    active ? 'text-julia-red' : 'text-ink-subtle'
                  }`}>
                  {active && (
                    <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-b-full bg-julia-red" />
                  )}
                  <svg className="w-5 h-5 mb-0.5" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  <span className="text-2xs font-medium leading-tight">{item.label}</span>
                </button>
              )
            })}
          </div>
        </nav>
      </div>
    </div>
  )
}
