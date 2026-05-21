// pages/api/proveedores/index.js
// GET  /api/proveedores                -> lista activos
// POST /api/proveedores                -> crear (admin)
// Auth: Bearer

import { requireAuth, requireAdmin } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method === 'GET')  return list(req, res)
  if (req.method === 'POST') return create(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function list(req, res) {
  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { incluir_inactivos } = req.query
  let q = auth.admin.from('proveedores').select('*').order('nombre')
  if (incluir_inactivos !== '1') q = q.eq('activo', true)

  const { data, error } = await q
  if (error) {
    console.error('[proveedores.list] ERROR:', error.message)
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(200).json({ ok: true, proveedores: data })
}

async function create(req, res) {
  const auth = await requireAdmin(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { nombre, nit, telefono, email, direccion, contacto, notas } = req.body || {}
  if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
    return res.status(400).json({ error: 'nombre requerido' })
  }

  const { data, error } = await auth.admin
    .from('proveedores')
    .insert({
      nombre: nombre.trim(),
      nit: nit?.trim() || null,
      telefono: telefono?.trim() || null,
      email: email?.trim() || null,
      direccion: direccion?.trim() || null,
      contacto: contacto?.trim() || null,
      notas: notas?.trim() || null,
    })
    .select()
    .single()

  if (error) {
    console.error('[proveedores.create] ERROR:', error.message)
    if (error.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe un proveedor activo con ese nombre' })
    return res.status(500).json({ ok: false, error: error.message })
  }
  return res.status(201).json({ ok: true, proveedor: data })
}
