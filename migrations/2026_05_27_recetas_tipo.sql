-- Migration: recetas.tipo (comida vs bebida)
-- Fecha: 2026-05-27
-- Proposito:
--   Permitir clasificar cada receta como 'comida' o 'bebida'. La planificacion
--   de produccion diaria solo aplica a comida (las bebidas no se planifican).
--   Backfill heuristico desde Loyverse: si el item ligado pertenece a una
--   categoria cuyo nombre contiene "bebida", se marca como 'bebida'. Todo lo
--   demas queda en 'comida' (default seguro).
--
--   No cambia ninguna RLS porque las politicas de recetas ya cubren toda fila.

ALTER TABLE recetas
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'comida'
  CHECK (tipo IN ('comida', 'bebida'));

COMMENT ON COLUMN recetas.tipo IS 'Clasificacion del producto terminado: comida (default) o bebida. La planificacion de produccion solo trabaja con comida.';

CREATE INDEX IF NOT EXISTS recetas_tipo_idx ON recetas(tipo);

-- Backfill: marcar como 'bebida' las recetas linkeadas a items Loyverse cuya
-- categoria contenga la palabra "bebida" (case-insensitive). Idempotente:
-- si la columna ya existe con valor seteado, no la pisamos a menos que siga
-- siendo el default 'comida'.
UPDATE recetas r SET tipo = 'bebida'
  FROM loyverse_items li
  LEFT JOIN loyverse_categories lc ON lc.loyverse_id = li.category_id
 WHERE r.loyverse_item_id = li.loyverse_id
   AND r.tipo = 'comida'
   AND lc.name ILIKE '%bebida%';
