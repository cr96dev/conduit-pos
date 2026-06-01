// pages/api/pos/pedidos/kiosko.js
//
// POST /api/pos/pedidos/kiosko
//   Crea un pedido pendiente desde el KIOSKO SELF-SERVICE.
//
// Sin autenticación (es público — cualquier cliente puede usarlo desde
// el K2 Mini). Validaciones para protección:
//   - Items deben existir en loyverse_items (no se inventan productos)
//   - Precio se recalcula server-side (cliente no puede manipular)
//   - origen forzado a 'kiosko' (no se puede mentir)
//   - referencia autogenerada (KIOSKO-NNN)
//   - Sin turno_id (los kiosko son anónimos, el cajero los asocia a su
//     turno al facturar desde la bandeja)
//
// Respuesta:
//   { ok: true, pedido: { id, referencia, total, ... } }
//
// Body esperado:
//   {
//     items: [{ variant_id, cantidad }],   // mínimo, el resto se infiere
//     receptor?: { nit, nombre, email }    // opcional, default CF
//   }

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Origin check sencillo — solo aceptamos requests desde nuestro dominio
  // o desde el K2 (que viene sin Origin header por ser app de kiosko).
  const origin = req.headers.origin || ''
  if (origin && !origin.includes('julia-bakery.vercel.app')) {
    return res.status(403).json({ error: 'Origin no autorizado' })
  }

  const body = req.body || {}
  const { items: itemsBody, receptor: receptorBody } = body

  if (!Array.isArray(itemsBody) || itemsBody.length === 0) {
    return res.status(400).json({ error: 'items[] requerido' })
  }
  if (itemsBody.length > 50) {
    return res.status(400).json({ error: 'Máximo 50 items por pedido' })
  }

  // Validar items contra catálogo real y recalcular precios server-side
  const variantIds = itemsBody.map(i => i.variant_id).filter(Boolean)
  if (variantIds.length !== itemsBody.length) {
    return res.status(400).json({ error: 'Todos los items necesitan variant_id' })
  }

  const { data: itemsCatalogo, error: errCat } = await supabaseAdmin
    .from('loyverse_items')
    .select('loyverse_id, item_name, variants, image_url')
    .is('deleted_at', null)
  if (errCat) return res.status(500).json({ error: errCat.message })

  // Index por variant_id
  const porVariant = {}
  for (const it of itemsCatalogo || []) {
    for (const v of (it.variants || [])) {
      if (v?.variant_id) {
        porVariant[v.variant_id] = {
          item_id: it.loyverse_id,
          item_name: it.item_name,
          variant_name: v.option1_value || v.option2_value || '',
          precio: v.stores?.[0]?.price ?? v.default_price ?? null,
        }
      }
    }
  }

  // Armar items finales con precios reales
  const items = []
  let total = 0
  for (const i of itemsBody) {
    const cat = porVariant[i.variant_id]
    if (!cat) {
      return res.status(400).json({ error: `Variante no existe: ${i.variant_id}` })
    }
    if (cat.precio == null) {
      return res.status(400).json({ error: `Producto sin precio: ${cat.item_name}` })
    }
    const cantidad = Math.max(1, Math.min(99, Number(i.cantidad) || 1))
    const precio_unitario = Number(cat.precio)
    const subtotal = round2(cantidad * precio_unitario)
    items.push({
      variant_id: i.variant_id,
      descripcion: cat.variant_name ? `${cat.item_name} (${cat.variant_name})` : cat.item_name,
      cantidad,
      precio_unitario,
      subtotal,
    })
    total += subtotal
  }
  total = round2(total)

  // Receptor: por default CF, pero el cliente puede dar NIT en el kiosko si
  // quiere factura con su nombre
  const receptor = {
    nit: (receptorBody?.nit || 'CF').toString().slice(0, 13),
    nombre: (receptorBody?.nombre || 'CONSUMIDOR FINAL').toString().slice(0, 100),
    email: receptorBody?.email?.toString().slice(0, 100) || null,
  }

  // Generar referencia: KIOSKO-XXX con # incremental del día
  const hoy = new Date()
  const yyyyMmDd = hoy.toISOString().slice(0, 10)
  const { count } = await supabaseAdmin
    .from('pedidos_pendientes')
    .select('id', { count: 'exact', head: true })
    .eq('origen', 'kiosko')
    .gte('created_at', yyyyMmDd + 'T00:00:00.000Z')

  const numeroDia = (count || 0) + 1
  const referencia = `KIOSKO #${String(numeroDia).padStart(3, '0')}`

  // Crear pedido pendiente
  const { data: pedido, error: errCrear } = await supabaseAdmin
    .from('pedidos_pendientes')
    .insert({
      referencia,
      origen: 'kiosko',
      items,
      total_estimado: total,
      receptor_nit: receptor.nit,
      receptor_nombre: receptor.nombre,
      receptor_email: receptor.email,
      estado: 'pendiente_entrega',
      // turno_id queda null — el cajero lo asocia a su turno cuando facture
      // desde la bandeja en /pos
    })
    .select('id, referencia, total_estimado, items, receptor_nit, receptor_nombre')
    .single()

  if (errCrear) {
    return res.status(500).json({ ok: false, error: errCrear.message })
  }

  return res.status(200).json({
    ok: true,
    pedido: {
      id: pedido.id,
      referencia: pedido.referencia,
      total: Number(pedido.total_estimado),
      items: pedido.items,
      receptor_nit: pedido.receptor_nit,
      receptor_nombre: pedido.receptor_nombre,
    },
    mensaje: `Orden ${referencia} creada. Pasa a caja a pagar Q${total.toFixed(2)}`,
  })
}
