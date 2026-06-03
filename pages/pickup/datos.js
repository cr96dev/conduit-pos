// pages/pickup/datos.js
// Datos del receptor + autocompletar NIT vía Infile (igual al POS).

import { useState } from 'react'
import { useRouter } from 'next/router'
import PickupShell from '../../components/pickup/PickupShell'
import { PickupTopBar, PickupBottomNav } from '../../components/pickup/Nav'
import { useCart } from '../../lib/pickup/cart'

const STORAGE_RECEPTOR = 'julia_pickup_receptor_v1'

function loadInitial() {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(window.localStorage.getItem(STORAGE_RECEPTOR) || '{}') } catch { return {} }
}

export default function PickupDatos() {
  const router = useRouter()
  const { count } = useCart()
  const init = loadInitial()
  const [nombre,   setNombre]   = useState(init.nombre   || '')
  const [telefono, setTelefono] = useState(init.telefono || '')
  const [email,    setEmail]    = useState(init.email    || '')
  const [nit,      setNit]      = useState(init.nit      || '')
  const [nitNombre,setNitNombre]= useState(init.nitNombre|| '')
  const [consNit,  setConsNit]  = useState(false)
  const [nitMsg,   setNitMsg]   = useState('')

  async function consultarNit() {
    const limpio = (nit || '').replace(/\D/g, '')
    if (!limpio) { setNitMsg(''); setNitNombre(''); return }
    setConsNit(true)
    setNitMsg('')
    try {
      const r = await fetch(`/api/pickup/consultar-nit?nit=${encodeURIComponent(limpio)}`)
      const j = await r.json()
      if (j?.receptor?.nombre) {
        setNitNombre(j.receptor.nombre)
        setNitMsg('')
      } else {
        setNitNombre('')
        setNitMsg(j.mensaje || 'NIT no encontrado')
      }
    } catch (_) {
      setNitMsg('No pudimos consultar el NIT. Probá más tarde o continuá sin factura.')
    } finally {
      setConsNit(false)
    }
  }

  function continuar(e) {
    e?.preventDefault()
    const data = { nombre, telefono, email, nit, nitNombre }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_RECEPTOR, JSON.stringify(data))
    }
    router.push('/pickup/pago')
  }

  const valido = nombre.trim() && telefono.trim() && /\S+@\S+/.test(email)

  return (
    <PickupShell title="Tus datos · Julia Bakery">
      <PickupTopBar cartCount={count} />

      <main className="px-container-margin-mobile pt-stack-md pb-32">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-2">¿Para quién es?</h1>
        <p className="font-body-md text-on-surface-variant mb-stack-md">
          Usamos tu teléfono para avisarte cuando esté listo.
        </p>

        <form onSubmit={continuar} className="flex flex-col gap-4">
          <Field label="Nombre" value={nombre} onChange={setNombre} placeholder="Carlos R." required />
          <Field label="Teléfono" value={telefono} onChange={setTelefono} placeholder="5555-5555" type="tel" required />
          <Field label="Email" value={email} onChange={setEmail} placeholder="carlos@email.com" type="email" required />

          {/* NIT */}
          <div>
            <label className="block font-caption-caps text-caption-caps text-on-surface-variant mb-1.5">
              NIT (opcional)
            </label>
            <div className="flex gap-2">
              <input
                value={nit}
                onChange={(e) => { setNit(e.target.value); setNitNombre(''); setNitMsg('') }}
                onBlur={consultarNit}
                placeholder="CF si no querés factura con NIT"
                className="flex-1 h-13 bg-white border border-outline-variant rounded-xl px-4 py-3 font-body-md focus:border-primary focus:outline-none transition-colors"
              />
              {nit && (
                <button
                  type="button"
                  onClick={consultarNit}
                  disabled={consNit}
                  className="h-13 px-4 bg-surface border border-outline-variant rounded-xl text-on-surface-variant active:scale-95"
                >
                  {consNit ? '...' : 'Consultar'}
                </button>
              )}
            </div>
            {nitNombre && (
              <div className="mt-2 text-[13px] text-secondary font-medium">✓ {nitNombre}</div>
            )}
            {nitMsg && (
              <div className="mt-2 text-[13px] text-error">{nitMsg}</div>
            )}
          </div>
        </form>
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface border-t border-outline-variant px-container-margin-mobile py-4 pb-safe">
        <button
          disabled={!valido}
          onClick={continuar}
          className="w-full h-14 bg-primary text-on-primary rounded-lg font-body-lg flex items-center justify-center active:scale-[0.98] transition-all shadow-lg disabled:opacity-40"
        >
          Continuar al pago
        </button>
      </div>

      <PickupBottomNav active="menu" />
    </PickupShell>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text', required }) {
  return (
    <div>
      <label className="block font-caption-caps text-caption-caps text-on-surface-variant mb-1.5">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full h-13 bg-white border border-outline-variant rounded-xl px-4 py-3 font-body-md focus:border-primary focus:outline-none transition-colors"
      />
    </div>
  )
}
