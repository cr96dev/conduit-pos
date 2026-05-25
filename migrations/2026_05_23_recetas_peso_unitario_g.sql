-- Migration: agregar peso_unitario_g a recetas
-- Fecha: 2026-05-23
-- Proposito:
--   Peso (gramos) de UNA unidad del producto terminado. Informativo: NO
--   participa del costeo ni del calculo de rinde/merma. Util para etiqueta,
--   ficha tecnica y reportes nutricionales.

ALTER TABLE recetas
  ADD COLUMN IF NOT EXISTS peso_unitario_g numeric(10,2);

COMMENT ON COLUMN recetas.peso_unitario_g IS 'Peso en gramos de una unidad del producto terminado. Informativo: no se usa en costeo.';
