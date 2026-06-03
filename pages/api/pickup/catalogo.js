// pages/api/pickup/catalogo.js
//
// GET /api/pickup/catalogo
//   Devuelve catálogo público (categorías + items) para la app /pickup.
//   Server-side con service role: las tablas loyverse_* tienen RLS que
//   solo permiten lectura a authenticated, y la app pickup es pública.
//
// Solo expone campos necesarios para el frontend. Cache 5 min — el catálogo
// no cambia segundo a segundo y se sincroniza desde Loyverse cada 15 min.

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const [{ data: cats }, { data: its }] = await Promise.all([
      supabaseAdmin.from('loyverse_categories').select('loyverse_id, name, color'),
      supabaseAdmin.from('loyverse_items')
        .select('loyverse_id, item_name, category_id, variants, image_url, reference_id')
        .is('deleted_at', null),
    ])

    // Cache 5 min en CDN, 1 min en browser. SWR para que renueve en background.
    res.setHeader('Cache-Control', 's-maxage=300, max-age=60, stale-while-revalidate=600')
    return res.status(200).json({
      ok: true,
      categorias: cats || [],
      items: its || [],
    })
  } catch (e) {
    console.error('[pickup/catalogo]', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}
