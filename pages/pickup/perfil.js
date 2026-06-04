// pages/pickup/perfil.js
// Página de perfil del cliente PWA pickup. Muestra los datos guardados
// localmente (NIT, nombre, email, teléfono) y permite editarlos o
// borrarlos. NO requiere auth — los datos viven en localStorage del
// dispositivo, no en BD.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import PickupShell from '../../components/pickup/PickupShell'
import { PickupTopBar, PickupBottomNav } from '../../components/pickup/Nav'

const STORAGE_RECEPTOR = 'julia_pickup_receptor_v1'

export default function PickupPerfil() {
  const router = useRouter()
  const [datos, setDatos] = useState(null)
  const [cargado, setCargado] = useState(false)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_RECEPTOR)
      setDatos(raw ? JSON.parse(raw) : null)
    } catch {
      setDatos(null)
    }
    setCargado(true)
  }, [])

  function borrarDatos() {
    if (!window.confirm('¿Borrar tus datos guardados? Vas a tener que volver a tipear NIT, email y teléfono la próxima vez.')) return
    try {
      window.localStorage.removeItem(STORAGE_RECEPTOR)
      window.localStorage.removeItem('julia_pickup_slot_v1')
    } catch (_) {}
    setDatos(null)
  }

  const tieneDatos = cargado && datos && (datos.nombre || datos.email || datos.nit)
  const inicial = (datos?.nombre || datos?.nitNombre || datos?.email || 'J').trim().charAt(0).toUpperCase()

  return (
    <PickupShell title="Mi perfil · Julia Bakery">
      <PickupTopBar />

      <main className="px-container-margin-mobile pt-6 pb-32">
        <h1 className="font-headline-lg text-headline-lg text-on-surface mb-6">Mi perfil</h1>

        {!cargado && (
          <div className="text-on-surface-variant font-body-md py-12 text-center">
            Cargando...
          </div>
        )}

        {cargado && !tieneDatos && (
          <div className="bg-surface border border-outline-variant rounded-2xl p-6 text-center">
            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-surface-container-low flex items-center justify-center">
              <span className="material-symbols-outlined text-[36px] text-on-surface-variant">person</span>
            </div>
            <h2 className="font-headline-md text-headline-md text-on-surface mb-2">
              Todavía no hiciste pedidos
            </h2>
            <p className="font-body-md text-on-surface-variant mb-6">
              Cuando hagas tu primer pedido, vas a poder ver tus datos guardados acá.
            </p>
            <Link
              href="/pickup/menu"
              className="inline-flex items-center justify-center h-13 px-8 bg-primary text-on-primary rounded-lg font-body-lg active:scale-[0.98] transition-all shadow-lg"
            >
              Ver menú
            </Link>
          </div>
        )}

        {cargado && tieneDatos && (
          <>
            {/* Avatar + nombre */}
            <div className="flex items-center gap-4 mb-stack-lg">
              <div className="w-16 h-16 rounded-full bg-primary text-on-primary flex items-center justify-center font-headline-lg text-headline-lg flex-shrink-0">
                {inicial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-body-lg text-on-surface font-semibold truncate">
                  {datos.nombre || datos.nitNombre || 'Cliente'}
                </div>
                {datos.email && (
                  <div className="text-[13px] text-tertiary truncate">{datos.email}</div>
                )}
              </div>
            </div>

            {/* Datos guardados */}
            <div className="bg-surface border border-outline-variant rounded-2xl p-4 mb-4">
              <div className="font-caption-caps text-caption-caps text-on-surface-variant mb-3">
                Datos para facturación
              </div>

              <div className="flex flex-col gap-3">
                {datos.nit && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">NIT</div>
                    <div className="font-body-md text-on-surface tabular-nums">{datos.nit}</div>
                    {datos.nitNombre && datos.nitNombre !== datos.nombre && (
                      <div className="text-[12px] text-tertiary">{datos.nitNombre}</div>
                    )}
                  </div>
                )}
                {datos.nombre && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">Nombre</div>
                    <div className="font-body-md text-on-surface">{datos.nombre}</div>
                  </div>
                )}
                {datos.email && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">Email</div>
                    <div className="font-body-md text-on-surface break-all">{datos.email}</div>
                  </div>
                )}
                {datos.telefono && (
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-on-surface-variant">Teléfono</div>
                    <div className="font-body-md text-on-surface tabular-nums">{datos.telefono}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Acciones */}
            <div className="flex flex-col gap-2 mb-stack-md">
              <Link
                href="/pickup/datos"
                className="h-13 bg-surface border border-outline-variant text-on-surface rounded-lg font-body-md flex items-center justify-between px-4 active:bg-surface-container-low"
              >
                <span className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant">edit</span>
                  Editar mis datos
                </span>
                <span className="material-symbols-outlined text-[20px] text-on-surface-variant">chevron_right</span>
              </Link>

              <Link
                href="/pickup/mis-pedidos"
                className="h-13 bg-surface border border-outline-variant text-on-surface rounded-lg font-body-md flex items-center justify-between px-4 active:bg-surface-container-low"
              >
                <span className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[20px] text-on-surface-variant">receipt_long</span>
                  Mis pedidos
                </span>
                <span className="material-symbols-outlined text-[20px] text-on-surface-variant">chevron_right</span>
              </Link>
            </div>

            {/* Cerrar sesión */}
            <button
              onClick={borrarDatos}
              className="w-full h-12 text-tertiary font-body-md flex items-center justify-center gap-2 active:opacity-60"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
              Cerrar sesión y borrar mis datos
            </button>
          </>
        )}

        {/* Sobre Julia Bakery */}
        <div className="mt-stack-lg pt-stack-md border-t border-outline-variant/30 text-center">
          <img src="/pickup/logo.png" alt="Julia Bakery" className="h-12 mx-auto mb-2" />
          <div className="text-[12px] text-on-surface-variant">
            Julia Bakery · Guatemala City<br />
            2 Avenida 11-08, Zona 10
          </div>
        </div>

      </main>

      <PickupBottomNav active="perfil" />
    </PickupShell>
  )
}
