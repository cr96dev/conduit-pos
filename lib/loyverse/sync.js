// lib/loyverse/sync.js
// Capa de sincronizacion Loyverse -> Supabase (tablas loyverse_*).
//
// Cada funcion sync<Recurso>() drena las paginas pendientes desde el cursor
// guardado en loyverse_sync_state, hace upsert idempotente por loyverse_id
// (o PK compuesto) y persiste el nuevo cursor.
//
// Si Loyverse devuelve 429, se captura, se marca el estado y la funcion
// termina sin lanzar (el siguiente tick del cron retomara desde el cursor
// que ya quedo guardado).

import { LoyverseClient, LoyverseRateLimitError } from './client.js'
import { supabaseAdmin } from '../qbo/supabaseAdmin.js'

// ============================================================================
// Estado de sync (cursor por recurso)
// ============================================================================

async function getState(resource) {
  const { data, error } = await supabaseAdmin
    .from('loyverse_sync_state')
    .select('cursor, high_water_mark')
    .eq('resource', resource)
    .maybeSingle()
  if (error) throw new Error(`getState(${resource}): ${error.message}`)
  return {
    cursor: data?.cursor || null,
    highWaterMark: data?.high_water_mark || null,
  }
}

// Buffer de seguridad para evitar perder eventos por clock skew o eventos que
// llegan tarde al endpoint. 5 minutos es razonable para Loyverse.
const HWM_BUFFER_MS = 5 * 60 * 1000

function applyHwmBuffer(hwm) {
  if (!hwm) return null
  const ts = new Date(hwm).getTime() - HWM_BUFFER_MS
  return new Date(ts).toISOString()
}

async function setSyncState(resource, { cursor, status, error, meta, highWaterMark }) {
  const row = {
    resource,
    cursor: cursor ?? null,
    last_status: status,
    last_error: error || null,
    last_synced_at: status === 'ok' ? new Date().toISOString() : null,
    last_run_meta: meta || {},
  }
  if (highWaterMark !== undefined) row.high_water_mark = highWaterMark
  // upsert por resource
  const { error: upErr } = await supabaseAdmin
    .from('loyverse_sync_state')
    .upsert(row, { onConflict: 'resource' })
  if (upErr) throw new Error(`setSyncState(${resource}): ${upErr.message}`)
}

// ============================================================================
// Helper de drenado generico
// ============================================================================
//
// Itera todas las paginas (desde el cursor previo), pasa cada lote a `onPage`
// y, si onPage no lanza, persiste el nuevo cursor. Si onPage falla, deja el
// cursor anterior intacto para reintentar en el siguiente tick.
//
async function drain({
  client,
  resource,
  path,
  resourceKey,
  query = {},
  onPage,
  resumable = true, // si false, no usa cursor persistido (catalogos chicos)
  deadlineAt = null, // timestamp ms absoluto. Si lo pasamos, cortamos limpio al alcanzarlo
                     // (el cursor ya persistido permite continuar en el siguiente tick).
  incremental = null, // { paramName: 'updated_at_min', extractTs: fn(item) => string }
                      // Si lo pasamos, leemos high_water_mark previo y lo agregamos a la
                      // query (con buffer), y actualizamos el HWM con max(extractTs) tras
                      // cada pagina. Combinable con resumable: cursor avanza dentro del
                      // drain, HWM se persiste al final.
}) {
  const startTime = Date.now()
  const state = resumable ? await getState(resource) : { cursor: null, highWaterMark: null }
  const startCursor = state.cursor
  const previousHwm = state.highWaterMark
  let cursor = startCursor
  let fetched = 0
  let upserted = 0
  let deadlineReached = false
  let newHwm = previousHwm // tracking del max updated_at visto en este drain

  // Aplicar HWM como filtro de la query (con buffer).
  // Solo se aplica al ARRANCAR un drain nuevo (cursor=null). Si estamos retomando
  // un drain previo (cursor!=null), Loyverse ignora updated_at_min y sigue el cursor.
  const effectiveQuery = { ...query }
  if (incremental && !startCursor) {
    const sinceTs = applyHwmBuffer(previousHwm)
    if (sinceTs) effectiveQuery[incremental.paramName] = sinceTs
  }

  try {
    for await (const page of client.paginate(path, {
      resourceKey,
      query: effectiveQuery,
      startCursor,
    })) {
      fetched += page.items.length
      const n = await onPage(page.items)
      upserted += n || 0
      cursor = page.cursor

      // Actualizar HWM en memoria con el max de esta pagina.
      if (incremental?.extractTs) {
        for (const item of page.items) {
          const ts = incremental.extractTs(item)
          if (ts && (!newHwm || ts > newHwm)) newHwm = ts
        }
      }

      // persistimos cursor despues de cada pagina exitosa
      if (resumable) {
        await setSyncState(resource, {
          cursor,
          status: cursor ? 'in_progress' : 'ok',
          meta: { fetched, upserted, duration_ms: Date.now() - startTime },
        })
      }

      if (deadlineAt && Date.now() >= deadlineAt && cursor) {
        deadlineReached = true
        break
      }
    }

    if (deadlineReached) {
      // cursor ya quedo guardado en la ultima iteracion exitosa.
      // status queda como in_progress; el siguiente tick retoma.
      // NO actualizamos HWM hasta que el drain termine completo, sino podriamos
      // saltarnos eventos que estan entre el cursor y el HWM nuevo.
      return {
        resource, fetched, upserted, ok: true, deadlineReached: true,
        durationMs: Date.now() - startTime,
      }
    }

    // Drain terminado (cursor=null). Persistir estado final + nuevo HWM.
    await setSyncState(resource, {
      cursor: null,
      status: 'ok',
      meta: { fetched, upserted, duration_ms: Date.now() - startTime },
      highWaterMark: incremental ? (newHwm ?? null) : undefined,
    })

    return { resource, fetched, upserted, ok: true, durationMs: Date.now() - startTime }
  } catch (e) {
    if (e instanceof LoyverseRateLimitError) {
      await setSyncState(resource, {
        cursor,
        status: 'rate_limited',
        error: e.message,
        meta: { fetched, upserted, duration_ms: Date.now() - startTime },
      })
      return { resource, fetched, upserted, ok: false, rateLimited: true, durationMs: Date.now() - startTime }
    }
    await setSyncState(resource, {
      cursor,
      status: 'error',
      error: e.message,
      meta: { fetched, upserted, duration_ms: Date.now() - startTime },
    })
    return { resource, fetched, upserted, ok: false, error: e.message, durationMs: Date.now() - startTime }
  }
}

// ============================================================================
// Mappers (API -> row de Supabase)
// ============================================================================

function mapMerchant(m) {
  return {
    loyverse_id: m.id,
    business_name: m.business_name ?? null,
    email: m.email ?? null,
    country: m.country ?? null,
    currency: m.currency ?? null,
    created_at: m.created_at ?? null,
    raw: m,
    synced_at: new Date().toISOString(),
  }
}

function mapStore(s) {
  return {
    loyverse_id: s.id,
    name: s.name ?? null,
    address: s.address ?? null,
    city: s.city ?? null,
    region: s.region ?? null,
    postal_code: s.postal_code ?? null,
    country_code: s.country_code ?? null,
    phone_number: s.phone_number ?? null,
    email: s.email ?? null,
    created_at: s.created_at ?? null,
    updated_at: s.updated_at ?? null,
    deleted_at: s.deleted_at ?? null,
    raw: s,
    synced_at: new Date().toISOString(),
  }
}

function mapEmployee(e) {
  return {
    loyverse_id: e.id,
    name: e.name ?? null,
    email: e.email ?? null,
    phone_number: e.phone_number ?? null,
    is_owner: e.is_owner ?? false,
    stores: e.stores ?? [],
    created_at: e.created_at ?? null,
    updated_at: e.updated_at ?? null,
    deleted_at: e.deleted_at ?? null,
    raw: e,
    synced_at: new Date().toISOString(),
  }
}

function mapCategory(c) {
  return {
    loyverse_id: c.id,
    name: c.name ?? null,
    color: c.color ?? null,
    created_at: c.created_at ?? null,
    deleted_at: c.deleted_at ?? null,
    raw: c,
    synced_at: new Date().toISOString(),
  }
}

function mapItem(i) {
  return {
    loyverse_id: i.id,
    handle: i.handle ?? null,
    item_name: i.item_name ?? null,
    description: i.description ?? null,
    reference_id: i.reference_id ?? null,
    category_id: i.category_id ?? null,
    track_stock: i.track_stock ?? null,
    sold_by_weight: i.sold_by_weight ?? null,
    is_composite: i.is_composite ?? null,
    use_production: i.use_production ?? null,
    primary_supplier_id: i.primary_supplier_id ?? null,
    tax_ids: i.tax_ids ?? [],
    modifier_ids: i.modifier_ids ?? [],
    form: i.form ?? null,
    color: i.color ?? null,
    image_url: i.image_url ?? null,
    variants: i.variants ?? [],
    created_at: i.created_at ?? null,
    updated_at: i.updated_at ?? null,
    deleted_at: i.deleted_at ?? null,
    raw: i,
    synced_at: new Date().toISOString(),
  }
}

function mapInventoryLevel(l) {
  return {
    variant_id: l.variant_id,
    store_id: l.store_id,
    in_stock: l.in_stock ?? null,
    updated_at: l.updated_at ?? null,
    raw: l,
    synced_at: new Date().toISOString(),
  }
}

function mapReceipt(r) {
  // Loyverse usa receipt_number como id principal en /receipts.
  // No siempre viene un campo `id` separado; usamos receipt_number como PK.
  const id = r.receipt_number || r.id
  return {
    loyverse_id: id,
    receipt_number: r.receipt_number ?? null,
    note: r.note ?? null,
    receipt_type: r.receipt_type ?? null,
    refund_for: r.refund_for ?? null,
    order_id: r.order ?? null,
    receipt_date: r.receipt_date ?? null,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    cancelled_at: r.cancelled_at ?? null,
    source: r.source ?? null,
    store_id: r.store_id ?? null,
    pos_device_id: r.pos_device_id ?? null,
    employee_id: r.employee_id ?? null,
    customer_id: r.customer_id ?? null,
    dining_option: r.dining_option ?? null,
    total_money: r.total_money ?? null,
    total_tax: r.total_tax ?? null,
    total_discount: r.total_discount ?? null,
    tip: r.tip ?? null,
    surcharge: r.surcharge ?? null,
    points_earned: r.points_earned ?? null,
    points_deducted: r.points_deducted ?? null,
    points_balance: r.points_balance ?? null,
    raw: r,
    synced_at: new Date().toISOString(),
  }
}

function mapReceiptLineItems(receiptId, lines = []) {
  const now = new Date().toISOString()
  return lines.map(l => ({
    loyverse_id: l.id,
    receipt_id: receiptId,
    item_id: l.item_id ?? null,
    variant_id: l.variant_id ?? null,
    item_name: l.item_name ?? null,
    variant_name: l.variant_name ?? null,
    sku: l.sku ?? null,
    quantity: l.quantity ?? null,
    price: l.price ?? null,
    gross_total_money: l.gross_total_money ?? null,
    total_money: l.total_money ?? null,
    total_discount: l.total_discount ?? null,
    cost: l.cost ?? null,
    cost_total: l.cost_total ?? null,
    line_note: l.line_note ?? null,
    line_taxes: l.line_taxes ?? [],
    line_modifiers: l.line_modifiers ?? [],
    line_discounts: l.line_discounts ?? [],
    raw: l,
    synced_at: now,
  }))
}

function mapReceiptPayments(receiptId, payments = []) {
  const now = new Date().toISOString()
  return payments.map(p => ({
    receipt_id: receiptId,
    payment_type_id: p.payment_type_id ?? null,
    name: p.name ?? null,
    type: p.type ?? null,
    money_amount: p.money_amount ?? null,
    paid_at: p.paid_at ?? null,
    payment_details: p.payment_details ?? null,
    raw: p,
    synced_at: now,
  }))
}

// ============================================================================
// Funciones publicas: una por recurso
// ============================================================================

export async function syncMerchant(client = new LoyverseClient(), { deadlineAt = null } = {}) {
  // merchant es una sola fila: ignoramos deadline (la llamada es atomica).
  void deadlineAt
  const startTime = Date.now()
  const resource = 'merchant'
  try {
    // /merchant devuelve un objeto plano, NO un listado paginado.
    const json = await client.get('/merchant')
    const m = json.merchant || json
    if (!m?.id) throw new Error('Respuesta /merchant sin id')

    const { error } = await supabaseAdmin
      .from('loyverse_merchant')
      .upsert(mapMerchant(m), { onConflict: 'loyverse_id' })
    if (error) throw new Error(`upsert merchant: ${error.message}`)

    await setSyncState(resource, {
      cursor: null, status: 'ok',
      meta: { fetched: 1, upserted: 1, duration_ms: Date.now() - startTime },
    })
    return { resource, fetched: 1, upserted: 1, ok: true, durationMs: Date.now() - startTime }
  } catch (e) {
    if (e instanceof LoyverseRateLimitError) {
      await setSyncState(resource, { cursor: null, status: 'rate_limited', error: e.message, meta: {} })
      return { resource, ok: false, rateLimited: true }
    }
    await setSyncState(resource, { cursor: null, status: 'error', error: e.message, meta: {} })
    return { resource, ok: false, error: e.message }
  }
}

export async function syncStores(client = new LoyverseClient(), { deadlineAt = null } = {}) {
  return drain({
    client,
    resource: 'stores',
    path: '/stores',
    resourceKey: 'stores',
    resumable: false, // catalogo chico, drenar entero cada vez
    deadlineAt,
    onPage: async (items) => {
      if (items.length === 0) return 0
      const rows = items.map(mapStore)
      const { error } = await supabaseAdmin
        .from('loyverse_stores')
        .upsert(rows, { onConflict: 'loyverse_id' })
      if (error) throw new Error(`upsert stores: ${error.message}`)
      return rows.length
    },
  })
}

export async function syncEmployees(client = new LoyverseClient(), { deadlineAt = null } = {}) {
  return drain({
    client,
    resource: 'employees',
    path: '/employees',
    resourceKey: 'employees',
    resumable: false,
    deadlineAt,
    onPage: async (items) => {
      if (items.length === 0) return 0
      const rows = items.map(mapEmployee)
      const { error } = await supabaseAdmin
        .from('loyverse_employees')
        .upsert(rows, { onConflict: 'loyverse_id' })
      if (error) throw new Error(`upsert employees: ${error.message}`)
      return rows.length
    },
  })
}

export async function syncCategories(client = new LoyverseClient(), { deadlineAt = null } = {}) {
  return drain({
    client,
    resource: 'categories',
    path: '/categories',
    resourceKey: 'categories',
    resumable: false,
    deadlineAt,
    onPage: async (items) => {
      if (items.length === 0) return 0
      const rows = items.map(mapCategory)
      const { error } = await supabaseAdmin
        .from('loyverse_categories')
        .upsert(rows, { onConflict: 'loyverse_id' })
      if (error) throw new Error(`upsert categories: ${error.message}`)
      return rows.length
    },
  })
}

export async function syncItems(client = new LoyverseClient(), { deadlineAt = null } = {}) {
  return drain({
    client,
    resource: 'items',
    path: '/items',
    resourceKey: 'items',
    resumable: true,  // items grande, vale la pena cursorear si interrumpe
    deadlineAt,
    incremental: { paramName: 'updated_at_min', extractTs: i => i.updated_at },
    onPage: async (items) => {
      if (items.length === 0) return 0
      const rows = items.map(mapItem)
      const { error } = await supabaseAdmin
        .from('loyverse_items')
        .upsert(rows, { onConflict: 'loyverse_id' })
      if (error) throw new Error(`upsert items: ${error.message}`)
      return rows.length
    },
  })
}

export async function syncInventory(client = new LoyverseClient(), { deadlineAt = null } = {}) {
  return drain({
    client,
    resource: 'inventory',
    path: '/inventory',
    resourceKey: 'inventory_levels',
    resumable: true,
    deadlineAt,
    incremental: { paramName: 'updated_at_min', extractTs: i => i.updated_at },
    onPage: async (items) => {
      if (items.length === 0) return 0
      const rows = items.map(mapInventoryLevel)
      const { error } = await supabaseAdmin
        .from('loyverse_inventory_levels')
        .upsert(rows, { onConflict: 'variant_id,store_id' })
      if (error) throw new Error(`upsert inventory: ${error.message}`)
      return rows.length
    },
  })
}

export async function syncReceipts(client = new LoyverseClient(), { deadlineAt = null } = {}) {
  return drain({
    client,
    resource: 'receipts',
    path: '/receipts',
    resourceKey: 'receipts',
    resumable: true,
    deadlineAt,
    incremental: { paramName: 'updated_at_min', extractTs: r => r.updated_at || r.created_at },
    onPage: async (items) => {
      if (items.length === 0) return 0

      const receiptRows = items.map(mapReceipt)
      const { error: rErr } = await supabaseAdmin
        .from('loyverse_receipts')
        .upsert(receiptRows, { onConflict: 'loyverse_id' })
      if (rErr) throw new Error(`upsert receipts: ${rErr.message}`)

      // Lineas: upsert por id de linea
      const lineRows = items.flatMap(r =>
        mapReceiptLineItems(r.receipt_number || r.id, r.line_items)
      )
      if (lineRows.length > 0) {
        const { error: lErr } = await supabaseAdmin
          .from('loyverse_receipt_line_items')
          .upsert(lineRows, { onConflict: 'loyverse_id' })
        if (lErr) throw new Error(`upsert line_items: ${lErr.message}`)
      }

      // Pagos: borramos los previos del receipt y reinsertamos
      // (Loyverse no expone id de pago, asi que es la unica forma idempotente segura).
      const receiptIds = items.map(r => r.receipt_number || r.id)
      const { error: delErr } = await supabaseAdmin
        .from('loyverse_receipt_payments')
        .delete()
        .in('receipt_id', receiptIds)
      if (delErr) throw new Error(`delete payments: ${delErr.message}`)

      const payRows = items.flatMap(r =>
        mapReceiptPayments(r.receipt_number || r.id, r.payments)
      )
      if (payRows.length > 0) {
        const { error: pErr } = await supabaseAdmin
          .from('loyverse_receipt_payments')
          .insert(payRows)
        if (pErr) throw new Error(`insert payments: ${pErr.message}`)
      }

      return receiptRows.length
    },
  })
}

// ============================================================================
// Orquestador (lo llama el cron)
// ============================================================================

// Orden importante: catalogo primero (FKs logicas), receipts/inventory despues.
// Si uno falla por rate-limit, los siguientes igual corren — cada uno persiste
// su propio cursor y se retoma en el siguiente tick.
//
// deadlineMs: tope de tiempo total para el tick (default 50s, deja 10s de margen
// frente al maxDuration de 60s en Vercel). Si se alcanza mid-receipts, el cursor
// queda persistido y el siguiente tick (15 min despues) sigue donde quedo.
export async function syncAll({ deadlineMs = 50_000 } = {}) {
  const client = new LoyverseClient()
  const deadlineAt = deadlineMs ? Date.now() + deadlineMs : null
  const results = []

  // Cada llamada chequea su propio deadline. Si una pasada ya consumio el
  // presupuesto, las siguientes igual se llaman pero salen rapido porque
  // arrancan con Date.now() >= deadlineAt y cortan en la primera pagina
  // (igual upsertan lo que ya trajeron antes de cortar).
  results.push(await syncMerchant(client,  { deadlineAt }))
  results.push(await syncStores(client,    { deadlineAt }))
  results.push(await syncEmployees(client, { deadlineAt }))
  results.push(await syncCategories(client,{ deadlineAt }))
  results.push(await syncItems(client,     { deadlineAt }))
  results.push(await syncInventory(client, { deadlineAt }))
  results.push(await syncReceipts(client,  { deadlineAt }))
  return results
}
