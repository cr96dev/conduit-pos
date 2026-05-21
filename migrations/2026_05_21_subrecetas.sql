-- Permitir que un ingrediente de receta apunte a otra receta (sub-receta).
ALTER TABLE receta_ingredientes
  ADD COLUMN IF NOT EXISTS sub_receta_id uuid REFERENCES recetas(id) ON DELETE RESTRICT;

ALTER TABLE receta_ingredientes
  ALTER COLUMN insumo_id DROP NOT NULL;

ALTER TABLE receta_ingredientes
  DROP CONSTRAINT IF EXISTS insumo_o_subreceta;
ALTER TABLE receta_ingredientes
  ADD CONSTRAINT insumo_o_subreceta CHECK (
    (insumo_id IS NOT NULL AND sub_receta_id IS NULL) OR
    (insumo_id IS NULL AND sub_receta_id IS NOT NULL)
  );

ALTER TABLE receta_ingredientes
  DROP CONSTRAINT IF EXISTS no_autorreferencia;
ALTER TABLE receta_ingredientes
  ADD CONSTRAINT no_autorreferencia CHECK (sub_receta_id IS NULL OR sub_receta_id != receta_id);

CREATE INDEX IF NOT EXISTS receta_ing_subreceta_idx ON receta_ingredientes(sub_receta_id);

COMMENT ON COLUMN receta_ingredientes.sub_receta_id IS 'Si esta seteado (en vez de insumo_id), este ingrediente es otra receta. cantidad se mide en la misma unidad que rinde la sub-receta.';
