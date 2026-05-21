// components/ImportarCSV.js
// Modal generico para importar registros desde CSV.
//
// Props:
//   titulo:     'Importar insumos desde CSV' (string)
//   schema:     { campo: ['alias1','alias2'] }  // ver lib/csv.js
//   requeridos: ['nombre']                       // campos obligatorios
//   endpoint:   '/api/insumos/bulk'              // POST con { items: [...] }
//   ejemplo:    'nombre,categoria,unidad,stock_inicial,stock_minimo,costo_unitario'
//   transform:  (row) => ({...}) // opcional, mapea row del CSV al shape que espera la API
//   onClose, onImportado

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseCSVconAliases } from '../lib/csv'

async function apiFetch(path, opts = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
  return fetch(path, { ...opts, headers })
}

export default function ImportarCSV({
  titulo, schema, requeridos = [], endpoint, ejemplo, transform,
  onClose, onImportado,
}) {
  const [parsed, setParsed] = useState(null)
  const [err, setErr] = useState(null)
  const [importando, setImportando] = useState(false)
  const [resultado, setResultado] = useState(null)

  function handleFile(file) {
    setErr(null); setResultado(null); setParsed(null)
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target.result
        const result = parseCSVconAliases(text, schema, { camposRequeridos: requeridos })
        setParsed(result)
      } catch (e) {
        setErr(e.message)
      }
    }
    reader.readAsText(file)
  }

  async function importar() {
    if (!parsed?.rows?.length) return
    setImportando(true); setErr(null)
    const items = parsed.rows.map(r => transform ? transform(r) : r)
    const res = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify({ items }) })
    const json = await res.json()
    setImportando(false)
    if (!res.ok) { setErr(json.error || 'Error'); return }
    setResultado(json)
  }

  const campos = Object.keys(schema)

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-8" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">{titulo}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs text-gray-600 space-y-1">
            <div>El CSV debe tener encabezado en la primera fila. Reconocemos:</div>
            <ul className="ml-2 space-y-0.5 max-h-32 overflow-y-auto">
              {campos.map(c => (
                <li key={c}>
                  <span className="font-medium text-gray-700">{c}</span>
                  {requeridos.includes(c) && <span className="text-julia-red ml-0.5">*</span>}
                  <span className="text-gray-400"> — alias aceptados: {schema[c].join(', ')}</span>
                </li>
              ))}
            </ul>
            {ejemplo && (
              <details className="mt-2">
                <summary className="cursor-pointer text-julia-red hover:underline">Ver ejemplo</summary>
                <pre className="mt-1 bg-white p-2 rounded text-[10px] overflow-x-auto">{ejemplo}</pre>
              </details>
            )}
          </div>

          <input type="file" accept=".csv,text/csv" onChange={e => handleFile(e.target.files[0])} className="text-xs" />

          {err && <div className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-xs text-red-700">{err}</div>}

          {parsed && (
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs text-gray-600">
                {parsed.rows.length} filas · columnas detectadas: {Object.entries(parsed.detectado).filter(([_,v])=>v!==null).map(([k,v])=>`${k}→col ${v+1}`).join(', ')}
              </div>
              <div className="max-h-64 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      {campos.map(c => (
                        <th key={c} className="px-2 py-1 text-left text-gray-400 font-normal">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.rows.slice(0, 20).map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {campos.map(c => (
                          <td key={c} className="px-2 py-1 text-gray-700">{r[c] || <span className="text-gray-300">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                    {parsed.rows.length > 20 && (
                      <tr><td colSpan={campos.length} className="text-center text-gray-400 py-2 text-xs">… y {parsed.rows.length - 20} más</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {resultado && (
            <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-xs text-green-800 space-y-1">
              <div>✓ <b>{resultado.insertados}</b> registros insertados</div>
              {resultado.omitidos > 0 && <div className="text-amber-700">⚠ {resultado.omitidos} omitidos (duplicados)</div>}
              {resultado.errores > 0 && <div className="text-red-700">✕ {resultado.errores} con error</div>}
              {(resultado.detalle?.errores?.length > 0 || resultado.detalle?.omitidos?.length > 0) && (
                <details className="mt-1">
                  <summary className="cursor-pointer">Ver detalle</summary>
                  <ul className="mt-1 max-h-32 overflow-y-auto text-[10px] space-y-0.5">
                    {resultado.detalle.omitidos?.map((o, i) => (
                      <li key={'o'+i} className="text-amber-700">fila {o.fila} {o.nombre}: {o.motivo}</li>
                    ))}
                    {resultado.detalle.errores?.map((e, i) => (
                      <li key={'e'+i} className="text-red-700">fila {e.fila} {e.nombre}: {e.error}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => resultado ? onImportado() : onClose()} className="btn-secundario">
              {resultado ? 'Cerrar' : 'Cancelar'}
            </button>
            {parsed && parsed.rows.length > 0 && !resultado && (
              <button onClick={importar} disabled={importando} className="btn-primario">
                {importando ? 'Importando…' : `Importar ${parsed.rows.length}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
