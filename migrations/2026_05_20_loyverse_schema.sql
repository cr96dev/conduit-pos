-- Migration: schema raw 1:1 para Loyverse POS
-- Fecha: 2026-05-20
-- Proposito:
--   Espejo crudo de los recursos de Loyverse API v1 que necesita Julia Bakery.
--   El cron /api/cron/loyverse-sync hace polling cada 15 min y upsertea aqui.
--   La logica de dominio (ventas por categoria, mermas, dashboards) se construira
--   despues encima de estas tablas con vistas o RPCs.
--
-- Convenciones:
--   - PK = loyverse_id (el id que devuelve la API) excepto inventory (compuesto)
--     y la tabla de cursor (que tiene su propia PK textual).
--   - raw jsonb guarda el payload completo tal como llego, para futureproofing.
--   - synced_at = momento del ultimo upsert local.
--   - Las columnas "tipadas" son las que ya sabemos que vamos a consultar
--     desde el dashboard; el resto vive en `raw`.
--
-- Seguridad: RLS habilitado en TODAS las tablas. Solo service_role lee/escribe.
--   Cuando definamos perfiles, agregaremos politicas de SELECT para authenticated.

-- =============================================================================
-- Estado de sincronizacion (cursor por endpoint)
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_sync_state (
  resource         text PRIMARY KEY,         -- 'receipts' | 'items' | 'stores' | ...
  cursor           text,                     -- ultimo cursor devuelto por Loyverse
  last_synced_at   timestamptz,              -- ultimo tick que termino OK
  last_status      text,                     -- 'ok' | 'rate_limited' | 'error'
  last_error       text,
  last_run_meta    jsonb DEFAULT '{}'::jsonb -- { fetched, upserted, duration_ms }
);

COMMENT ON TABLE loyverse_sync_state IS 'Cursor persistente por endpoint Loyverse. Lo lee/escribe el cron cada 15 min.';

-- =============================================================================
-- Merchant (single row)
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_merchant (
  loyverse_id      text PRIMARY KEY,
  business_name    text,
  email            text,
  country          text,
  currency         text,
  created_at       timestamptz,
  raw              jsonb NOT NULL,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE loyverse_merchant IS 'Espejo de GET /merchant. Una sola fila esperada.';

-- =============================================================================
-- Stores
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_stores (
  loyverse_id      text PRIMARY KEY,
  name             text,
  address          text,
  city             text,
  region           text,
  postal_code      text,
  country_code     text,
  phone_number     text,
  email            text,
  created_at       timestamptz,
  updated_at       timestamptz,
  deleted_at       timestamptz,
  raw              jsonb NOT NULL,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE loyverse_stores IS 'Espejo de GET /stores.';

-- =============================================================================
-- Employees
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_employees (
  loyverse_id      text PRIMARY KEY,
  name             text,
  email            text,
  phone_number     text,
  is_owner         boolean DEFAULT false,
  stores           jsonb DEFAULT '[]'::jsonb, -- array de store_ids
  created_at       timestamptz,
  updated_at       timestamptz,
  deleted_at       timestamptz,
  raw              jsonb NOT NULL,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE loyverse_employees IS 'Espejo de GET /employees.';

-- =============================================================================
-- Categories (depende de items)
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_categories (
  loyverse_id      text PRIMARY KEY,
  name             text,
  color            text,
  created_at       timestamptz,
  deleted_at       timestamptz,
  raw              jsonb NOT NULL,
  synced_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE loyverse_categories IS 'Espejo de GET /categories.';

-- =============================================================================
-- Items
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_items (
  loyverse_id        text PRIMARY KEY,
  handle             text,
  item_name          text,
  description        text,
  reference_id       text,
  category_id        text,
  track_stock        boolean,
  sold_by_weight     boolean,
  is_composite       boolean,
  use_production     boolean,
  primary_supplier_id text,
  tax_ids            jsonb DEFAULT '[]'::jsonb,
  modifier_ids       jsonb DEFAULT '[]'::jsonb,
  form               text,
  color              text,
  image_url          text,
  variants           jsonb DEFAULT '[]'::jsonb, -- variants completas (raw)
  created_at         timestamptz,
  updated_at         timestamptz,
  deleted_at         timestamptz,
  raw                jsonb NOT NULL,
  synced_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE loyverse_items IS 'Espejo de GET /items. variants[] guarda toda la sub-info de variantes (sku, precio, default_pricing_type, etc.).';

CREATE INDEX IF NOT EXISTS loyverse_items_category_idx ON loyverse_items(category_id);

-- =============================================================================
-- Inventory levels (PK compuesta: variant_id + store_id)
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_inventory_levels (
  variant_id       text NOT NULL,
  store_id         text NOT NULL,
  in_stock         numeric,
  updated_at       timestamptz,
  raw              jsonb NOT NULL,
  synced_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (variant_id, store_id)
);

COMMENT ON TABLE loyverse_inventory_levels IS 'Espejo de GET /inventory. Una fila por (variant, store).';

CREATE INDEX IF NOT EXISTS loyverse_inventory_store_idx ON loyverse_inventory_levels(store_id);

-- =============================================================================
-- Receipts (cabecera)
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_receipts (
  loyverse_id          text PRIMARY KEY,         -- receipt_number en realidad funciona como id en /receipts
  receipt_number       text,
  note                 text,
  receipt_type         text,                     -- SALE | REFUND
  refund_for           text,                     -- receipt_number del original si es REFUND
  order_id             text,
  receipt_date         timestamptz,
  created_at           timestamptz,
  updated_at           timestamptz,
  cancelled_at         timestamptz,
  source               text,
  store_id             text,
  pos_device_id        text,
  employee_id          text,
  customer_id          text,
  dining_option        text,
  total_money          numeric,
  total_tax            numeric,
  total_discount       numeric,
  tip                  numeric,
  surcharge            numeric,
  points_earned        numeric,
  points_deducted      numeric,
  points_balance       numeric,
  raw                  jsonb NOT NULL,
  synced_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE loyverse_receipts IS 'Espejo de GET /receipts (cabecera). line_items y payments se desnormalizan en tablas hijas.';

CREATE INDEX IF NOT EXISTS loyverse_receipts_date_idx    ON loyverse_receipts(receipt_date DESC);
CREATE INDEX IF NOT EXISTS loyverse_receipts_store_idx   ON loyverse_receipts(store_id);
CREATE INDEX IF NOT EXISTS loyverse_receipts_emp_idx     ON loyverse_receipts(employee_id);
CREATE INDEX IF NOT EXISTS loyverse_receipts_type_idx    ON loyverse_receipts(receipt_type);
CREATE INDEX IF NOT EXISTS loyverse_receipts_updated_idx ON loyverse_receipts(updated_at DESC);

-- =============================================================================
-- Receipt line items
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_receipt_line_items (
  loyverse_id           text PRIMARY KEY,        -- line.id
  receipt_id            text NOT NULL REFERENCES loyverse_receipts(loyverse_id) ON DELETE CASCADE,
  item_id               text,
  variant_id            text,
  item_name             text,
  variant_name          text,
  sku                   text,
  quantity              numeric,
  price                 numeric,
  gross_total_money     numeric,
  total_money           numeric,
  total_discount        numeric,
  cost                  numeric,
  cost_total            numeric,
  line_note             text,
  line_taxes            jsonb DEFAULT '[]'::jsonb,
  line_modifiers        jsonb DEFAULT '[]'::jsonb,
  line_discounts        jsonb DEFAULT '[]'::jsonb,
  raw                   jsonb NOT NULL,
  synced_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE loyverse_receipt_line_items IS 'Lineas de cada receipt. Borrado en cascada si el receipt se elimina.';

CREATE INDEX IF NOT EXISTS loyverse_line_items_receipt_idx ON loyverse_receipt_line_items(receipt_id);
CREATE INDEX IF NOT EXISTS loyverse_line_items_item_idx    ON loyverse_receipt_line_items(item_id);
CREATE INDEX IF NOT EXISTS loyverse_line_items_variant_idx ON loyverse_receipt_line_items(variant_id);

-- =============================================================================
-- Receipt payments
-- =============================================================================

CREATE TABLE IF NOT EXISTS loyverse_receipt_payments (
  id                serial PRIMARY KEY,
  receipt_id        text NOT NULL REFERENCES loyverse_receipts(loyverse_id) ON DELETE CASCADE,
  payment_type_id   text,
  name              text,
  type              text,                       -- CASH | CARD | OTHER
  money_amount      numeric,
  paid_at           timestamptz,
  payment_details   jsonb,
  raw               jsonb NOT NULL,
  synced_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE loyverse_receipt_payments IS 'Pagos por receipt. Loyverse no expone un id estable de pago. La idempotencia se garantiza con DELETE+INSERT por receipt_id en el sync (Loyverse puede devolver pagos duplicados legitimamente, ej. split tender).';

CREATE INDEX IF NOT EXISTS loyverse_payments_receipt_idx ON loyverse_receipt_payments(receipt_id);

-- =============================================================================
-- RLS: habilitar y bloquear por defecto.
-- service_role siempre puede (bypass RLS automaticamente).
-- =============================================================================

ALTER TABLE loyverse_sync_state          ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyverse_merchant            ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyverse_stores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyverse_employees           ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyverse_categories          ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyverse_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyverse_inventory_levels    ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyverse_receipts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyverse_receipt_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyverse_receipt_payments    ENABLE ROW LEVEL SECURITY;

-- Politica de SOLO LECTURA para usuarios autenticados (front del dashboard).
-- Los upserts del sync los hace service_role desde el cron y se saltan RLS.
-- Si en el futuro queremos restringir por store/empleado, se actualiza aqui.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'loyverse_sync_state',
      'loyverse_merchant',
      'loyverse_stores',
      'loyverse_employees',
      'loyverse_categories',
      'loyverse_items',
      'loyverse_inventory_levels',
      'loyverse_receipts',
      'loyverse_receipt_line_items',
      'loyverse_receipt_payments'
    ])
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      t || '_select_authenticated', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (true)',
      t || '_select_authenticated', t
    );
  END LOOP;
END$$;

-- Nota: NO se definen politicas INSERT/UPDATE/DELETE para authenticated.
-- Cualquier escritura desde el front esta bloqueada por defecto.
-- Solo service_role escribe.
