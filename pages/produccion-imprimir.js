// Vista de impresion del plan de produccion del dia.
// Se abre con ?planId=<uuid>. Al cargar dispara window.print() para que la
// pantalla pase directo al dialogo de impresion. El usuario puede "Guardar
// como PDF" desde ahi.
//
// Pensada para llevar la hoja al equipo de produccion: solo lista de
// productos a producir + cantidades. Sin precios. Tipografia grande, en
// blanco y negro.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const fmtNum = n => Number(n || 0).toLocaleString('es-GT', { maximumFractionDigits: 2 })

function fechaLargaGT(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d, 12))
  return dt.toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

async function apiFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = {}
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { headers })
}

export default function ProduccionImprimir() {
  const router = useRouter()
  const { planId } = router.query
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!planId) return
    let cancelado = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setErr('Iniciá sesión primero, luego volvé a abrir el botón Imprimir.')
        return
      }
      const res = await apiFetch(`/api/produccion/planes/${planId}`)
      const json = await res.json()
      if (cancelado) return
      if (!res.ok) { setErr(json.error || 'Error cargando el plan'); return }
      setData(json)
      // Esperar un tick para que el browser layoutee, y disparar print.
      setTimeout(() => { try { window.print() } catch {} }, 350)
    })()
    return () => { cancelado = true }
  }, [planId])

  if (err) {
    return (
      <div className="p-8 max-w-xl mx-auto text-sm text-red-700">
        <h1 className="text-lg font-semibold mb-2">No pude preparar la impresión</h1>
        <p>{err}</p>
        <button onClick={() => window.close()} className="mt-4 px-3 py-2 border rounded">Cerrar</button>
      </div>
    )
  }

  if (!data) {
    return <div className="p-8 text-sm text-gray-500">Preparando la lista de producción…</div>
  }

  const { plan, lineas = [], resumen } = data

  // Ordenar alfabeticamente por nombre. Solo lineas con cantidad > 0.
  const filas = (lineas || [])
    .filter(l => Number(l.cantidad) > 0)
    .map(l => ({
      nombre: l.recetas?.nombre || '—',
      rinde_unidad: l.recetas?.rinde_unidad || '',
      cantidad: Number(l.cantidad),
      notas: l.notas || '',
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

  const totalUnidades = filas.reduce((s, f) => s + f.cantidad, 0)

  return (
    <div className="print-root">
      <div className="hoja">
        <header className="cab">
          <div>
            <h1>Plan de producción</h1>
            <div className="fecha">{fechaLargaGT(plan?.fecha_produccion)}</div>
          </div>
          <div className="meta">
            <div>Julia Bakery</div>
            <div className="estado">Estado: {plan?.estado || '—'}</div>
          </div>
        </header>

        <table className="tabla">
          <thead>
            <tr>
              <th className="col-num">#</th>
              <th className="col-prod">Producto</th>
              <th className="col-cant">Cantidad</th>
              <th className="col-check">Hecho</th>
              <th className="col-notas">Notas</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 ? (
              <tr><td colSpan={5} className="vacio">Sin productos en el plan.</td></tr>
            ) : filas.map((f, i) => (
              <tr key={i}>
                <td className="col-num">{i + 1}</td>
                <td className="col-prod">{f.nombre}</td>
                <td className="col-cant">
                  <strong>{fmtNum(f.cantidad)}</strong>
                  {f.rinde_unidad && <span className="unid"> {f.rinde_unidad}</span>}
                </td>
                <td className="col-check"><span className="box" /></td>
                <td className="col-notas">{f.notas}</td>
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={2} className="total-lbl">Total</td>
                <td className="col-cant"><strong>{fmtNum(totalUnidades)}</strong></td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>

        <footer className="pie">
          <div className="firmas">
            <div>
              <span>Preparado por:</span>
              <span className="linea" />
            </div>
            <div>
              <span>Recibido por:</span>
              <span className="linea" />
            </div>
          </div>
          <div className="generado">
            Generado el {new Date().toLocaleString('es-GT')} ·
            {' '}{resumen?.productos_a_producir ?? filas.length} producto(s)
          </div>
        </footer>

        <div className="acciones no-print">
          <button onClick={() => window.print()} className="btn">Imprimir / Guardar PDF</button>
          <button onClick={() => window.close()} className="btn-sec">Cerrar</button>
        </div>
      </div>

      <style jsx>{`
        .print-root { background: #fff; color: #000; font-family: Helvetica, Arial, sans-serif; }
        .hoja { max-width: 720px; margin: 0 auto; padding: 24px; }
        .cab { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 16px; }
        .cab h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px 0; }
        .cab .fecha { font-size: 13px; text-transform: capitalize; }
        .cab .meta { text-align: right; font-size: 11px; line-height: 1.4; }
        .cab .meta .estado { color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

        .tabla { width: 100%; border-collapse: collapse; font-size: 13px; }
        .tabla th, .tabla td { border: 1px solid #999; padding: 8px 10px; text-align: left; vertical-align: top; }
        .tabla th { background: #f0f0f0; font-weight: 600; }
        .col-num { width: 28px; text-align: center; }
        .col-prod { width: auto; }
        .col-cant { width: 92px; text-align: right; white-space: nowrap; }
        .col-check { width: 56px; text-align: center; }
        .col-notas { width: 32%; }
        .unid { font-size: 11px; color: #555; }
        .box { display: inline-block; width: 18px; height: 18px; border: 1.5px solid #000; }
        .vacio { text-align: center; color: #999; padding: 24px; }
        .tabla tfoot td { background: #fafafa; font-size: 13px; }
        .total-lbl { text-align: right; font-weight: 600; }

        .pie { margin-top: 24px; font-size: 11px; color: #555; }
        .firmas { display: flex; gap: 32px; margin-bottom: 16px; }
        .firmas > div { flex: 1; }
        .firmas .linea { display: inline-block; border-bottom: 1px solid #000; width: 70%; margin-left: 6px; }
        .generado { font-size: 10px; color: #777; }

        .acciones { display: flex; gap: 8px; justify-content: center; margin-top: 24px; }
        .btn { padding: 10px 20px; background: #991b1b; color: #fff; border: 0; border-radius: 6px; cursor: pointer; font-size: 13px; }
        .btn-sec { padding: 10px 20px; background: #eee; color: #333; border: 0; border-radius: 6px; cursor: pointer; font-size: 13px; }

        @media print {
          .no-print { display: none !important; }
          .print-root { background: #fff; }
          .hoja { padding: 0; }
          @page { margin: 1.5cm; }
        }
      `}</style>
    </div>
  )
}
