// components/pickup/Ubicacion.js
//
// Componente clickeable de ubicación de Julia Bakery.
// Al tocar abre Google Maps (Android: app nativa, iPhone: Safari con
// opción de Apple Maps o Google Maps).
//
// Datos centralizados: si Julia se muda o cambia algo, se actualiza acá
// y todas las páginas + emails toman el cambio.

const JULIA_DIRECCION_CORTA = '2 Avenida 11-08, Zona 10'
const JULIA_DIRECCION_LARGA = '2 Avenida 11-08, Apto. C, Zona 10, Guatemala'
const JULIA_MAPS_URL = 'https://www.google.com/maps/place/julia+bakery/data=!4m2!3m1!1s0x8589a32272f6004d:0x88fdc9b818be06f6'

export const JULIA_LOCATION = {
  nombre: 'Julia Bakery',
  direccionCorta: JULIA_DIRECCION_CORTA,
  direccionLarga: JULIA_DIRECCION_LARGA,
  mapsUrl: JULIA_MAPS_URL,
}

/**
 * Ubicación clickeable. Variant:
 *  - 'inline': compacto, una línea con ícono y dirección corta
 *  - 'card':   bloque destacado con ícono grande + cta
 */
export default function Ubicacion({ variant = 'inline', className = '' }) {
  if (variant === 'card') {
    return (
      <a
        href={JULIA_MAPS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={`block bg-surface-container-low border border-outline-variant rounded-xl px-5 py-4 active:scale-[0.98] transition-transform hover:bg-surface-container ${className}`}
      >
        <div className="flex items-start gap-3">
          <span className="material-symbols-outlined text-primary text-[24px] flex-shrink-0 mt-0.5">place</span>
          <div className="flex-grow min-w-0">
            <div className="font-body-lg text-on-surface leading-tight">{JULIA_LOCATION.nombre}</div>
            <div className="text-[13px] text-on-surface-variant mt-0.5">{JULIA_DIRECCION_LARGA}</div>
          </div>
          <div className="flex flex-col items-end flex-shrink-0">
            <span className="material-symbols-outlined text-primary text-[20px]">directions</span>
            <span className="text-[10px] text-primary font-bold uppercase tracking-wider mt-0.5">Ir</span>
          </div>
        </div>
      </a>
    )
  }

  // 'inline'
  return (
    <a
      href={JULIA_MAPS_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-on-surface-variant hover:text-primary active:scale-95 transition-colors ${className}`}
    >
      <span className="material-symbols-outlined text-[18px]">place</span>
      <span className="font-caption-caps text-caption-caps underline underline-offset-2">
        {JULIA_DIRECCION_CORTA}
      </span>
    </a>
  )
}
