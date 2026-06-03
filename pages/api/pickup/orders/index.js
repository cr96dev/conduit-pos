// pages/api/pickup/orders/index.js
//
// POST /api/pickup/orders
//   Crea un pedido pickup público (sin auth). Valida items contra el catálogo
//   real, recalcula precios server-side, agenda el slot.
//
// GET  /api/pickup/orders?email=foo@bar.com
//   Devuelve los pedidos pickup asociados a ese email. Sin auth en MVP
//   (futuro: magic link auth para que solo el dueño del email vea sus pedidos).
//
// Origen forzado: 'app_pickup'. Pago en MVP queda con pago_simulado=true hasta
// que Neonet confirme credenciales y procesemos cobro real.

import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method === 'POST') return crear(req, res)
  if (req.method === 'GET')  return listar(req, res)
  return res.status(405).json({ error: 'Method not allowed' })
}

async function crear(req, res) {
  const body = req.body || {}
  const { items: itemsBody, receptor, slot_iso, slot_label, pago } = body
  // Origen del pedido:
  //   'app_pickup' — PWA pickup en celular del cliente
  //   'kiosko_k2'  — Sunmi K2 mini en modo armador (flujo /pickup completo)
  //   'pos_kiosko' — POS modo kiosko (PIN cajero K2): catálogo Loyverse,
  //                  el cliente elige "QR Recurrente" o "Pagar en caja"
  // Default app_pickup por compatibilidad con clientes existentes.
  const origen = ['kiosko_k2', 'app_pickup', 'pos_kiosko'].includes(body.origen) ? body.origen : 'app_pickup'

  // Receptor: el POS kiosko no le pide datos al cliente (es autoservicio rápido).
  // Default CF / CONSUMIDOR FINAL, email opcional. PWA y kiosko_k2 siguen
  // requiriendo email + nombre + teléfono como hoy.
  if (origen === 'pos_kiosko') {
    body.receptor = body.receptor || {}
    if (!body.receptor.nombre)   body.receptor.nombre = 'CONSUMIDOR FINAL'
    if (!body.receptor.nit)      body.receptor.nit = 'CF'
    if (!body.receptor.telefono) body.receptor.telefono = '-'
    if (!body.receptor.email)    body.receptor.email = ''
  }

  if (!Array.isArray(itemsBody) || itemsBody.length === 0) {
    return res.status(400).json({ error: 'items[] requerido' })
  }
  if (itemsBody.length > 50) {
    return res.status(400).json({ error: 'Máximo 50 items por pedido' })
  }
  // Para origen pos_kiosko ya seteamos defaults arriba (CF). Para PWA y K2
  // armador exigimos los datos al cliente.
  const receptorFinal = origen === 'pos_kiosko' ? body.receptor : receptor
  if (origen !== 'pos_kiosko' && (!receptorFinal?.email || !receptorFinal?.telefono || !receptorFinal?.nombre)) {
    return res.status(400).json({ error: 'receptor.nombre, telefono y email son requeridos' })
  }

  // Validar items contra catálogo y recalcular precios server-side
  const { data: itemsCatalogo, error: errCat } = await supabaseAdmin
    .from('loyverse_items')
    .select('loyverse_id, item_name, variants')
    .is('deleted_at', null)
  if (errCat) return res.status(500).json({ error: errCat.message })

  const porVariant = {}
  for (const it of itemsCatalogo || []) {
    for (const v of (it.variants || [])) {
      if (v?.variant_id) {
        porVariant[v.variant_id] = {
          item_name: it.item_name,
          variant_name: v.option1_value || v.option2_value || '',
          precio: v.stores?.[0]?.price ?? v.default_price ?? null,
        }
      }
    }
  }

  const items = []
  let total = 0
  for (const i of itemsBody) {
    let cat = porVariant[i.variant_id]
    // En MVP aceptamos items "mock-X" del frontend con su precio (validamos
    // que no esté muy fuera del rango razonable Q1-Q500).
    if (!cat && String(i.variant_id || '').startsWith('mock-')) {
      const precio = Number(i.precio_unitario || 0)
      if (precio < 1 || precio > 500) {
        return res.status(400).json({ error: `Precio mock fuera de rango: ${precio}` })
      }
      cat = { item_name: i.descripcion || 'Producto', variant_name: '', precio }
    }
    if (!cat) return res.status(400).json({ error: `Variante no existe: ${i.variant_id}` })
    if (cat.precio == null) return res.status(400).json({ error: `Producto sin precio: ${cat.item_name}` })
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

  // Referencia visible: JU-NNNN (PWA) o K-NNNN (kiosko K2). Contador por día y
  // por origen para que ambos canales tengan numeración independiente y se
  // identifiquen visualmente en la bandeja del POS.
  const yyyyMmDd = new Date().toISOString().slice(0, 10)
  const { count } = await supabaseAdmin
    .from('pedidos_pendientes')
    .select('id', { count: 'exact', head: true })
    .eq('origen', origen)
    .gte('created_at', yyyyMmDd + 'T00:00:00.000Z')
  // Prefijo por origen para identificar visualmente en bandeja:
  //   K-NNNN  → kiosko_k2 (armador completo, deprecated por ahora)
  //   P-NNNN  → pos_kiosko (K2 modo POS — la solución actual)
  //   JU-NNNN → app_pickup (PWA cliente)
  const prefijo = origen === 'kiosko_k2' ? 'K' : origen === 'pos_kiosko' ? 'P' : 'JU'
  const referencia = `${prefijo}-${String((count || 0) + 1).padStart(4, '0')}`

  // Estado inicial:
  //   - 'pendiente_pago'    si el pago va por gateway real (Recurrente) y aún
  //     no confirmamos: el webhook (o /confirmar-pago-sandbox) lo pasará a
  //     'pendiente_entrega'
  //   - 'pendiente_entrega' si pago_simulado=true, si no hay gateway, o si el
  //     método es 'cobrar_en_caja' (kiosko K2 — el cliente pagará al cajero)
  const usaGateway = pago?.metodo === 'recurrente' && pago?.simulado === false
  const estadoInicial = usaGateway ? 'pendiente_pago' : 'pendiente_entrega'

  const insertData = {
    referencia,
    origen,
    items,
    total_estimado: total,
    receptor_nit: (receptor.nit || 'CF').toString().slice(0, 13),
    receptor_nombre: (receptor.nitNombre || receptor.nombre || 'CONSUMIDOR FINAL').toString().slice(0, 100),
    receptor_email: receptor.email.toString().slice(0, 100),
    receptor_telefono: receptor.telefono.toString().slice(0, 20),
    estado: estadoInicial,
    slot_pickup_at: slot_iso || null,
    slot_label: slot_label || null,
    day_label: body.day_label || null,
    pago_metodo: pago?.metodo || 'tarjeta',
    pago_ultimos4: pago?.ultimos4 || null,
    pago_simulado: pago?.simulado !== false,
  }

  const { data: pedido, error: errCrear } = await supabaseAdmin
    .from('pedidos_pendientes')
    .insert(insertData)
    .select('id, referencia, total_estimado, items, receptor_nit, receptor_nombre, estado, slot_pickup_at, slot_label, day_label, created_at')
    .single()

  if (errCrear) return res.status(500).json({ ok: false, error: errCrear.message })

  return res.status(200).json({ ok: true, order: pedido })
}

async function listar(req, res) {
  const email = (req.query.email || '').toString().toLowerCase()
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'email query param requerido' })
  }

  const { data, error } = await supabaseAdmin
    .from('pedidos_pendientes')
    .select('id, referencia, items, total_estimado, estado, slot_pickup_at, slot_label, day_label, created_at, factura_id')
    .eq('origen', 'app_pickup')
    .ilike('receptor_email', email)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true, orders: data || [] })
}
