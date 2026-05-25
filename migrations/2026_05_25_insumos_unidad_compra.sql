-- Migration: unidad de compra y costo fraccionado en insumos
-- Fecha: 2026-05-25
-- Proposito:
--   Capturar la unidad en la que se COMPRA cada insumo (ej. quintal, saco,
--   caja) junto al factor para convertir a la unidad base (la que consume
--   la receta). El costo por unidad base se deriva automaticamente como
--   `costo_compra / cantidad_por_unidad_compra` y se persiste en
--   `costo_unitario` (sigue siendo la fuente para el costeo de recetas).
--
--   Ejemplo: cafe en grano se compra por quintal (100 lb) a Q7,000 →
--     unidad='lb', unidad_compra='quintal', cantidad_por_unidad_compra=100,
--     costo_compra=7000  →  costo_unitario=70 (Q/lb, derivado).
--
--   El DDL en prod YA esta aplicado via Supabase MCP. Este archivo queda en
--   migrations/ para tracking. La fila en _schema_migrations se inserta al
--   final para mantener sincronizado el registro sin re-correr el ALTER.

ALTER TABLE insumos
  ADD COLUMN IF NOT EXISTS unidad_compra              text,
  ADD COLUMN IF NOT EXISTS cantidad_por_unidad_compra numeric(14,4),
  ADD COLUMN IF NOT EXISTS costo_compra               numeric(14,2);

COMMENT ON COLUMN insumos.unidad_compra IS 'Unidad en que se compra el insumo: quintal, saco, caja, bolsa, galon, etc. NULL si se compra en la misma unidad base.';
COMMENT ON COLUMN insumos.cantidad_por_unidad_compra IS 'Cantidad de unidades BASE que trae una unidad de compra (ej. 100 si quintal y la base es lb). Si NULL o 0, no se fracciona.';
COMMENT ON COLUMN insumos.costo_compra IS 'Costo (Q) de UNA unidad de compra (ej. Q7000 por quintal). costo_unitario se deriva = costo_compra / cantidad_por_unidad_compra.';

-- Backfill: marcar esta migracion como aplicada (DDL ya corrio via MCP).
INSERT INTO _schema_migrations (filename, applied_by) VALUES
  ('2026_05_25_insumos_unidad_compra.sql', 'mcp')
ON CONFLICT (filename) DO NOTHING;
