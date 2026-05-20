import { useEffect, useState } from 'react'

export function useToast() {
  const [toasts, setToasts] = useState([])

  function toast(message, type = 'success') {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }

  return { toasts, toast }
}

export function ToastContainer({ toasts }) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <Toast key={t.id} {...t} />
      ))}
    </div>
  )
}

function Toast({ message, type }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setTimeout(() => setVisible(true), 10)
  }, [])

  const styles = {
    success: { bg: 'bg-green-50 border-green-200', icon: 'text-green-500', text: 'text-green-800' },
    error:   { bg: 'bg-red-50 border-red-200',     icon: 'text-red-500',   text: 'text-red-800' },
    warning: { bg: 'bg-amber-50 border-amber-200', icon: 'text-amber-500', text: 'text-amber-800' },
    info:    { bg: 'bg-blue-50 border-blue-100',   icon: 'text-blue-500',  text: 'text-blue-800' },
  }

  const icons = {
    success: <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
    error:   <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />,
    warning: <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />,
    info:    <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />,
  }

  const s = styles[type] || styles.success

  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg max-w-sm transition-all duration-300 ${s.bg} ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
      <svg className={`w-5 h-5 flex-shrink-0 ${s.icon}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        {icons[type] || icons.success}
      </svg>
      <span className={`text-sm font-medium ${s.text}`}>{message}</span>
    </div>
  )
}
