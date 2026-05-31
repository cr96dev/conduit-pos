// components/Toast.js
// Sistema de toasts no intrusivo. Slide desde el costado, backdrop blur,
// auto-dismiss 3.5s. Stack vertical de hasta N notificaciones.

import { useEffect, useState } from 'react'

export function useToast() {
  const [toasts, setToasts] = useState([])

  function toast(message, type = 'success') {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }

  return { toasts, toast }
}

export function ToastContainer({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <Toast key={t.id} {...t} />
      ))}
    </div>
  )
}

const TYPE_STYLES = {
  success: {
    accent: '#16a34a',
    bg: 'rgba(240, 253, 244, 0.96)',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
  error: {
    accent: '#dc2626',
    bg: 'rgba(254, 242, 242, 0.96)',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
  warning: {
    accent: '#d97706',
    bg: 'rgba(255, 251, 235, 0.96)',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />,
  },
  info: {
    accent: '#2563eb',
    bg: 'rgba(239, 246, 255, 0.96)',
    icon: <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
}

function Toast({ message, type }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  const s = TYPE_STYLES[type] || TYPE_STYLES.success

  return (
    <div
      className={`pointer-events-auto flex items-center gap-3 pl-3 pr-4 py-3 rounded-xl shadow-pop max-w-sm transition-all duration-300 ease-out-soft ${
        visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-6'
      }`}
      style={{
        background: s.bg,
        backdropFilter: 'saturate(180%) blur(8px)',
        WebkitBackdropFilter: 'saturate(180%) blur(8px)',
        borderLeft: `3px solid ${s.accent}`,
        boxShadow: '0 8px 24px -8px rgba(15,15,20,0.18), 0 2px 6px rgba(15,15,20,0.08)',
      }}
    >
      <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke={s.accent} strokeWidth={2.2} viewBox="0 0 24 24">
        {s.icon}
      </svg>
      <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{message}</span>
    </div>
  )
}
