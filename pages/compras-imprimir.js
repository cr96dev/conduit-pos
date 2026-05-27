// Vista de impresion de una orden de compra a proveedor.
// Se abre con ?compraId=<uuid>. Al cargar dispara window.print() para que
// la pantalla pase directo al dialogo de impresion.
//
// Incluye TODO lo que la dueña necesita para mandarle al proveedor o
// archivar: cabecera (proveedor, fecha, factura), tabla con cantidades y
// precios, totales (subtotal/IVA/total) y un bloque de firmas.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const fmtMoney = n => 'Q ' + Number(n || 0).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNum   = n => Number(n || 0).toLocaleString('es-GT', { maximumFractionDigits: 3 })

function fmtFecha(s) {
  if (!s) return ''
  return new Date(s + (s.length === 10 ? 'T12:00:00' : ''))
    .toLocaleDateString('es-GT', { day: 'numeric', month: 'long', year: 'numeric' })
}

async function apiFetch(path) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = {}
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { headers })
}

export default function ComprasImprimir() {
  const router = useRouter()
  const { compraId } = router.query
  const [compra, setCompra] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!compraId) return
    let cancelado = false
    ;(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        setErr('Iniciá sesión primero, luego volvé a abrir el botón Imprimir.')
        return
      }
      const res = await apiFetch(`/api/compras/${compraId}`)
      const json = await res.json()
      if (cancelado) return
      if (!res.ok) { setErr(json.error || 'Error cargando la compra'); return }
      setCompra(json.compra)
      setTimeout(() => { try { window.print() } catch {} }, 350)
    })()
    return () => { cancelado = true }
  }, [compraId])

  if (err) {
    return (
      <div className="p-8 max-w-xl mx-auto text-sm text-red-700">
        <h1 className="text-lg font-semibold mb-2">No pude preparar la impresión</h1>
        <p>{err}</p>
        <button onClick={() => window.close()} className="mt-4 px-3 py-2 border rounded">Cerrar</button>
      </div>
    )
  }

  if (!compra) {
    return <div className="p-8 text-sm text-gray-500">Preparando la orden de compra…</div>
  }

  const prov = compra.proveedores || {}
  const lineas = compra.lineas || []
  const estadoLabel = ({
    borrador: 'BORRADOR',
    recibida: 'RECIBIDA',
    anulada:  'ANULADA',
  })[compra.estado] || compra.estado?.toUpperCase()

  return (
    <div className="print-root">
      <div className="hoja">
        <header className="cab">
          <div>
            <h1>Orden de compra</h1>
            {compra.numero_factura && <div className="folio">N° factura: {compra.numero_factura}</div>}
          </div>
          <div className="meta">
            <div className="empresa">Julia Bakery</div>
            <div className={`estado estado-${compra.estado}`}>{estadoLabel}</div>
          </div>
        </header>

        <section className="datos">
          <div className="bloque">
            <div className="bloque-label">Proveedor</div>
            <div className="bloque-valor">{prov.nombre || '—'}</div>
            {prov.nit       && <div className="sub">NIT: {prov.nit}</div>}
            {prov.telefono  && <div className="sub">Tel: {prov.telefono}</div>}
            {prov.contacto  && <div className="sub">Contacto: {prov.contacto}</div>}
            {prov.direccion && <div className="sub">{prov.direccion}</div>}
          </div>
          <div className="bloque">
            <div className="bloque-label">Fecha</div>
            <div className="bloque-valor">{fmtFecha(compra.fecha)}</div>
            {compra.metodo_pago && <div className="sub">Pago: {compra.metodo_pago}</div>}
            {compra.serie_factura && <div className="sub">Serie: {compra.serie_factura}</div>}
            {compra.recibida_at && (
              <div className="sub">
                Recibida el {new Date(compra.recibida_at).toLocaleString('es-GT')}
              </div>
            )}
          </div>
        </section>

        <table className="tabla">
          <thead>
            <tr>
              <th className="col-num">#</th>
              <th className="col-desc">Descripción</th>
              <th className="col-cant">Cantidad</th>
              <th className="col-pu">Precio unit.</th>
              <th className="col-sub">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {lineas.length === 0 ? (
              <tr><td colSpan={5} className="vacio">Sin líneas registradas.</td></tr>
            ) : lineas.map((l, i) => (
              <tr key={l.id || i}>
                <td className="col-num">{i + 1}</td>
                <td className="col-desc">
                  {l.descripcion}
                  {l.insumos?.nombre && l.insumos.nombre !== l.descripcion && (
                    <div className="sub-desc">{l.insumos.nombre}</div>
                  )}
                </td>
                <td className="col-cant">
                  {fmtNum(l.cantidad)}{l.unidad && <span className="unid"> {l.unidad}</span>}
                </td>
                <td className="col-pu">{fmtMoney(l.costo_unitario)}</td>
                <td className="col-sub">{fmtMoney(l.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="totales">
          <div className="filas">
            <div className="fila"><span>Subtotal</span><span>{fmtMoney(compra.subtotal)}</span></div>
            <div className="fila"><span>IVA</span><span>{fmtMoney(compra.iva)}</span></div>
            <div className="fila total"><span>Total</span><span>{fmtMoney(compra.total)}</span></div>
          </div>
        </section>

        {compra.notas && (
          <div className="notas">
            <div className="notas-label">Notas</div>
            <div>{compra.notas}</div>
          </div>
        )}

        {compra.estado === 'anulada' && compra.anulada_motivo && (
          <div className="anulacion">Anulada: {compra.anulada_motivo}</div>
        )}

        <footer className="pie">
          <div className="firmas">
            <div>
              <span>Recibido por:</span>
              <span className="linea" />
            </div>
            <div>
              <span>Firma proveedor:</span>
              <span className="linea" />
            </div>
          </div>
          <div className="generado">Generado el {new Date().toLocaleString('es-GT')}</div>
        </footer>

        <div className="acciones no-print">
          <button onClick={() => window.print()} className="btn">Imprimir / Guardar PDF</button>
          <button onClick={() => window.close()} className="btn-sec">Cerrar</button>
        </div>
      </div>

      <style jsx>{`
        .print-root { background: #fff; color: #000; font-family: Helvetica, Arial, sans-serif; }
        .hoja { max-width: 760px; margin: 0 auto; padding: 24px; }

        .cab { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 16px; }
        .cab h1 { font-size: 22px; font-weight: 700; margin: 0 0 4px 0; }
        .cab .folio { font-size: 12px; color: #555; }
        .cab .meta { text-align: right; font-size: 11px; }
        .cab .meta .empresa { font-weight: 600; font-size: 13px; }
        .cab .meta .estado { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; margin-top: 4px; }
        .cab .meta .estado-borrador { background: #eee; color: #555; border: 1px solid #ccc; }
        .cab .meta .estado-recibida { background: #d6f3df; color: #14532d; border: 1px solid #14532d; }
        .cab .meta .estado-anulada  { background: #fde2e2; color: #7f1d1d; border: 1px solid #7f1d1d; }

        .datos { display: flex; gap: 24px; margin-bottom: 18px; }
        .bloque { flex: 1; }
        .bloque-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #777; }
        .bloque-valor { font-size: 14px; font-weight: 600; margin-top: 1px; }
        .sub { font-size: 11px; color: #555; margin-top: 1px; }

        .tabla { width: 100%; border-collapse: collapse; font-size: 12px; }
        .tabla th, .tabla td { border: 1px solid #999; padding: 7px 8px; text-align: left; vertical-align: top; }
        .tabla th { background: #f0f0f0; font-weight: 600; font-size: 11px; }
        .col-num { width: 26px; text-align: center; }
        .col-desc { width: auto; }
        .sub-desc { font-size: 10px; color: #777; margin-top: 1px; }
        .col-cant { width: 90px; text-align: right; white-space: nowrap; }
        .col-pu   { width: 100px; text-align: right; white-space: nowrap; }
        .col-sub  { width: 110px; text-align: right; white-space: nowrap; font-weight: 600; }
        .unid { font-size: 10px; color: #555; }
        .vacio { text-align: center; color: #999; padding: 18px; }

        .totales { display: flex; justify-content: flex-end; margin-top: 8px; }
        .totales .filas { width: 260px; font-size: 12px; }
        .totales .fila { display: flex; justify-content: space-between; padding: 4px 0; }
        .totales .fila.total { border-top: 2px solid #000; font-weight: 700; font-size: 14px; padding-top: 6px; margin-top: 4px; }

        .notas { margin-top: 18px; font-size: 11px; }
        .notas-label { color: #777; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 2px; }
        .anulacion { margin-top: 14px; padding: 8px 10px; background: #fde2e2; color: #7f1d1d; border-left: 3px solid #7f1d1d; font-size: 11px; }

        .pie { margin-top: 28px; }
        .firmas { display: flex; gap: 32px; margin-bottom: 16px; font-size: 11px; color: #444; }
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
