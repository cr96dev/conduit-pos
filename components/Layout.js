import { useRouter } from 'next/router'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const navItems = [
  { href: '/dashboard',  label: 'Inicio',     icon: 'M3 12l9-9 9 9M5 10v10h14V10' },
  { href: '/ventas',     label: 'Ventas',     icon: 'M3 17l4-8 4 4 4-7 4 6' },
  { href: '/productos',  label: 'Productos',  icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-14L4 7m8 4v10M4 7v10l8 4' },
  { href: '/inventario', label: 'Inventario', icon: 'M20 7H4a2 2 0 00-2 2v10a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2zM4 5h16v2H4V5z' },
  { href: '/empleados',  label: 'Empleados',  icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
]

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
            <button onClick={onClose} className="text-sm px-4 py-2 bg-amber-700 text-white rounded-lg hover:bg-amber-800">
              Cerrar
            </button>
          </div>
        ) : (
          <form onSubmit={handleGuardar} className="px-6 py-5 space-y-4">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Contraseña actual</label>
              <input type="password" value={actual} onChange={e => setActual(e.target.value)} required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Nueva contraseña</label>
              <input type="password" value={nueva} onChange={e => setNueva(e.target.value)} required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Confirmar nueva contraseña</label>
              <input type="password" value={confirmar} onChange={e => setConfirmar(e.target.value)} required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500" />
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
                className="text-sm px-5 py-2 bg-amber-700 text-white rounded-lg hover:bg-amber-800 disabled:opacity-50 flex items-center gap-2">
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

  const activeColor = 'bg-amber-50 text-amber-800'

  return (
    <div className="flex min-h-screen bg-gray-50">

      {modalContrasena && <ModalCambioContrasena onClose={() => setModalContrasena(false)} />}

      {/* Sidebar desktop */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-100 flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-gray-100 flex flex-col items-center">
          <button onClick={() => router.push('/dashboard')} className="w-full">
            <img src="/logo.svg" alt="Julia Bakery" className="w-full object-contain mb-1" style={{ height: '80px' }} />
          </button>
          <div className="text-xs text-gray-400 text-center truncate w-full mt-1">
            Panaderia
          </div>
        </div>

        <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
          {navItems.map(item => {
            const active = router.pathname === item.href
            return (
              <button key={item.href} onClick={() => router.push(item.href)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active ? `${activeColor} font-medium` : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="px-4 py-3 border-t border-gray-100">
          <button onClick={toggleDark}
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 mb-2 transition-colors">
            <span className="text-xs text-gray-500">{darkMode ? 'Modo dia' : 'Modo noche'}</span>
            <div className={`w-8 h-4 rounded-full transition-colors relative ${darkMode ? 'bg-amber-700' : 'bg-gray-200'}`}>
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform shadow-sm ${darkMode ? 'translate-x-4' : 'translate-x-0.5'}`}></div>
            </div>
          </button>
          <div className="text-xs text-gray-500 truncate mb-1">{perfil?.nombre_completo || perfil?.email || ''}</div>
          <div className="flex items-center justify-between">
            <button onClick={() => setModalContrasena(true)}
              className="text-xs text-gray-400 hover:text-amber-700 transition-colors">
              Cambiar contraseña
            </button>
            <button onClick={logout} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
              Cerrar sesion
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* Topbar movil */}
        <div className="md:hidden bg-white border-b border-gray-100 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
          <button onClick={() => router.push('/dashboard')}>
            <img src="/logo.svg" alt="Julia Bakery" style={{ height: '32px' }} />
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

        {/* Menu desplegable movil */}
        {menuAbierto && (
          <div className="md:hidden bg-white border-b border-gray-100 px-2 py-2 z-10">
            {navItems.map(item => {
              const active = router.pathname === item.href
              return (
                <button key={item.href}
                  onClick={() => { router.push(item.href); setMenuAbierto(false) }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                    active ? `${activeColor} font-medium` : 'text-gray-600 hover:bg-gray-50'
                  }`}>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  {item.label}
                </button>
              )
            })}
            <div className="border-t border-gray-100 mt-2 pt-2 px-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-400 mb-1">{perfil?.nombre_completo || perfil?.email || ''}</div>
                <button onClick={() => { setModalContrasena(true); setMenuAbierto(false) }}
                  className="text-xs text-amber-700 hover:text-amber-800">
                  Cambiar contraseña
                </button>
              </div>
              <button onClick={logout} className="text-xs text-red-400 hover:text-red-600">Cerrar sesion</button>
            </div>
          </div>
        )}

        {/* Contenido */}
        <main className="flex-1 min-w-0 pb-20">
          {children}
        </main>

        {/* Barra inferior movil */}
        <nav className="md:hidden bg-white border-t border-gray-100 fixed bottom-0 left-0 right-0 z-10">
          <div className="grid grid-cols-5 px-1">
            {navItems.map(item => {
              const active = router.pathname === item.href
              return (
                <button key={item.href}
                  onClick={() => { router.push(item.href); setMenuAbierto(false) }}
                  className={`flex flex-col items-center py-2 px-0.5 transition-colors ${
                    active ? 'text-amber-700' : 'text-gray-400'
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
      </div>
    </div>
  )
}
