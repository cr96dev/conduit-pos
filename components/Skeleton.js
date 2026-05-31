// components/Skeleton.js
// Placeholders de carga con shimmer animado (en lugar de animate-pulse).
// Usa la utility .shimmer definida en globals.css que aplica un gradient
// animado con los tokens del sistema — se ve sobrio y tecnico.

export function SkeletonBar({ className = '' }) {
  return <div className={`shimmer rounded ${className}`} />
}

export function SkeletonCard() {
  return (
    <div className="card-julia p-4 space-y-3">
      <SkeletonBar className="h-2.5 w-1/3" />
      <SkeletonBar className="h-6 w-1/2" />
      <SkeletonBar className="h-2.5 w-2/3" />
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-100">
      <SkeletonBar className="h-2.5 w-24" />
      <SkeletonBar className="h-2.5 w-32" />
      <SkeletonBar className="h-2.5 w-20 ml-auto" />
    </div>
  )
}

export function SkeletonCircle() {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="shimmer w-32 h-32 rounded-full" />
      <SkeletonBar className="h-2.5 w-16" />
      <SkeletonBar className="h-2.5 w-12" />
    </div>
  )
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="card-julia overflow-hidden">
      <div className="px-5 py-3.5 border-b border-gray-100">
        <SkeletonBar className="h-2.5 w-48" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}

export function SkeletonDashboard() {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <SkeletonBar className="h-5 w-40" />
        <SkeletonBar className="h-2.5 w-32" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <div className="card-julia p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 justify-items-center">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCircle key={i} />)}
        </div>
      </div>
      <SkeletonTable rows={4} />
    </div>
  )
}
