import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'
import Layout from '../components/Layout'
import { SkeletonRow } from '../components/Skeleton'

export default function Empleados({ session }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [empleados, setEmpleados] = useState([])

  useEffect(() => {
    if (!session) { router.push('/'); return }
    cargar()
  }, [session])

  async function cargar() {
    setLoading(true)
    const { data } = await supabase
      .from('loyverse_employees')
      .select('loyverse_id, name, email, phone_number, is_owner, created_at')
      .order('name')
    setEmpleados(data || [])
    setLoading(false)
  }

  return (
    <Layout perfil={{ email: session?.user?.email }}>
      <div className="px-4 md:px-8 py-6 max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-4">
          <h1 className="text-xl font-semibold text-gray-900">Empleados</h1>
          <span className="text-xs text-gray-400">{empleados.length} empleados</span>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Nombre</th>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Email</th>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Telefono</th>
                <th className="text-left text-xs text-gray-400 font-normal px-4 py-2">Rol</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>{[1,2,3].map(i => <tr key={i}><td colSpan={4}><SkeletonRow /></td></tr>)}</>
              ) : empleados.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-xs text-gray-400 py-8">Sin empleados.</td></tr>
              ) : (
                empleados.map(e => (
                  <tr key={e.loyverse_id} className="border-t border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-700">{e.name || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{e.email || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{e.phone_number || '—'}</td>
                    <td className="px-4 py-2.5">
                      {e.is_owner
                        ? <span className="text-xs bg-julia-cream/40 text-julia-red px-2 py-0.5 rounded">Propietario</span>
                        : <span className="text-xs text-gray-500">Empleado</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  )
}
