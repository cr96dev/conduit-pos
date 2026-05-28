// components/SelectUnidad.js
// Select de unidad con presets agrupados por categoria (Peso/Volumen/Conteo/
// Empaque) + opcion "otra (escribir)" que abre un input de texto libre.
//
// Usado tanto en el modal de Insumos (carga del catalogo) como en el modal
// de Compras (linea de compra). Comparte la fuente de verdad de las
// unidades reconocidas con lib/unidades.js.

import { useState } from 'react'
import { PRESETS_UI } from '../lib/unidades'

export default function SelectUnidad({
  value,
  onChange,
  permitirVacio = false,
  placeholder = '',
  title,
  className = 'input',
}) {
  const todasClaves = new Set([
    ...PRESETS_UI.peso.map(p => p.value),
    ...PRESETS_UI.volumen.map(p => p.value),
    ...PRESETS_UI.conteo.map(p => p.value),
    ...(PRESETS_UI.empaque || []).map(p => p.value),
  ])
  const esEstandar = !value || todasClaves.has(value)
  const [modoOtra, setModoOtra] = useState(!esEstandar)

  function setEstandar(v) {
    if (v === '__otra__') { setModoOtra(true); onChange(''); return }
    setModoOtra(false)
    onChange(v)
  }

  if (modoOtra) {
    return (
      <div className="flex gap-1 items-center">
        <input
          type="text" value={value || ''} onChange={e => onChange(e.target.value)}
          className={className} placeholder={placeholder || 'escribir…'} title={title} autoFocus
        />
        <button type="button" onClick={() => { setModoOtra(false); onChange('') }}
          className="text-xs text-gray-400 hover:text-gray-700 px-1.5" title="Volver a unidades estándar">↺</button>
      </div>
    )
  }

  return (
    <select value={value || ''} onChange={e => setEstandar(e.target.value)}
      className={className} title={title}>
      {permitirVacio && <option value="">— {placeholder || 'sin elegir'} —</option>}
      <optgroup label="Peso">
        {PRESETS_UI.peso.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </optgroup>
      <optgroup label="Volumen">
        {PRESETS_UI.volumen.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </optgroup>
      <optgroup label="Conteo">
        {PRESETS_UI.conteo.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </optgroup>
      {(PRESETS_UI.empaque || []).length > 0 && (
        <optgroup label="Empaque (sin conversión auto)">
          {PRESETS_UI.empaque.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </optgroup>
      )}
      <option value="__otra__">— otra (escribir) —</option>
    </select>
  )
}
