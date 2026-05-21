-- Migration: recetas (BOM) para productos terminados de Loyverse
-- Fecha: 2026-05-21
CREATE TABLE IF NOT EXISTS recetas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loyverse_item_id    text REFERENCES loyverse_items(loyverse_id) ON DELETE SET NULL,
  nombre              text NOT NULL,
  rinde_cantidad      numeric(12,3) NOT NULL DEFAULT 1,
  rinde_unidad        text DEFAULT 'unidad',
  merma_pct           numeric(6,2) NOT NULL DEFAULT 0,
  costo_calculado     numeric(12,4),
  precio_venta        numeric(12,2),
  margen_pct          numeric(6,2),
  notas               text,
  activa              boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES auth.users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recetas_loyverse_item_idx ON recetas(loyverse_item_id);
CREATE UNIQUE INDEX IF NOT EXISTS recetas_loyverse_unique
  ON recetas(loyverse_item_id) WHERE activa = true AND loyverse_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS receta_ingredientes (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receta_id                   uuid NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  insumo_id                   uuid NOT NULL REFERENCES insumos(id) ON DELETE RESTRICT,
  cantidad                    numeric(12,4) NOT NULL,
  unidad                      text,
  costo_unitario_snapshot     numeric(12,4),
  subtotal_costo              numeric(12,4),
  notas                       text,
  orden                       int NOT NULL DEFAULT 0,
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receta_ing_receta_idx ON receta_ingredientes(receta_id);
CREATE INDEX IF NOT EXISTS receta_ing_insumo_idx ON receta_ingredientes(insumo_id);

ALTER TABLE recetas             ENABLE ROW LEVEL SECURITY;
ALTER TABLE receta_ingredientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recetas_select       ON recetas;
DROP POLICY IF EXISTS recetas_write_admin  ON recetas;
DROP POLICY IF EXISTS receta_ing_select    ON receta_ingredientes;
DROP POLICY IF EXISTS receta_ing_write_admin ON receta_ingredientes;

CREATE POLICY recetas_select      ON recetas FOR SELECT TO authenticated USING (true);
CREATE POLICY recetas_write_admin ON recetas FOR ALL    TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
CREATE POLICY receta_ing_select   ON receta_ingredientes FOR SELECT TO authenticated USING (true);
CREATE POLICY receta_ing_write_admin ON receta_ingredientes FOR ALL TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
