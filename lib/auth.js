// lib/auth.js
// Helper para validar sesion + rol desde API routes server-side.
//
// Uso desde una API route:
//   import { requireAdmin, requireAuth } from '../../../lib/auth'
//   const { user, perfil, error, status } = await requireAdmin(req)
//   if (error) return res.status(status).json({ error })
//
// El front llama a la API con header:
//   Authorization: Bearer <access_token de supabase.auth.getSession()>

import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// Valida el bearer token y devuelve user + perfil. No exige rol.
export async function requireAuth(req) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { error: 'Falta header Authorization', status: 401 }

  const admin = getAdminClient()

  const { data: { user }, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !user) return { error: 'Token invalido', status: 401 }

  const { data: perfil, error: perfilErr } = await admin
    .from('perfiles')
    .select('id, email, nombre_completo, rol, activo')
    .eq('id', user.id)
    .single()

  if (perfilErr || !perfil) return { error: 'Perfil no encontrado', status: 403 }
  if (!perfil.activo) return { error: 'Perfil desactivado', status: 403 }

  return { user, perfil, admin }
}

// Igual que requireAuth pero exige rol = 'admin'.
export async function requireAdmin(req) {
  const result = await requireAuth(req)
  if (result.error) return result
  if (result.perfil.rol !== 'admin') {
    return { error: 'Requiere rol admin', status: 403 }
  }
  return result
}
