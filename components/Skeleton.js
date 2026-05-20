export function SkeletonCard() {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-1/3 mb-3"></div>
      <div className="h-7 bg-gray-200 rounded w-1/2 mb-2"></div>
      <div className="h-3 bg-gray-200 rounded w-2/3"></div>
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 px-5 py-3 border-b border-gray-50 animate-pulse">
      <div className="h-3 bg-gray-200 rounded w-24"></div>
      <div className="h-3 bg-gray-200 rounded w-32"></div>
      <div className="h-3 bg-gray-200 rounded w-20 ml-auto"></div>
    </div>
  )
}

export function SkeletonCircle() {
  return (
    <div className="flex flex-col items-center gap-3 animate-pulse">
      <div className="w-36 h-36 rounded-full bg-gray-200"></div>
      <div className="h-3 bg-gray-200 rounded w-16"></div>
      <div className="h-3 bg-gray-200 rounded w-12"></div>
    </div>
  )
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 animate-pulse">
        <div className="h-3 bg-gray-200 rounded w-48"></div>
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
      <div className="animate-pulse">
        <div className="h-5 bg-gray-200 rounded w-40 mb-2"></div>
        <div className="h-3 bg-gray-200 rounded w-32"></div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 justify-items-center animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCircle key={i} />)}
        </div>
      </div>
      <SkeletonTable rows={4} />
    </div>
  )
}
