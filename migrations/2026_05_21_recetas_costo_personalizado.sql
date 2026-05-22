-- Override manual del costo por unidad de una receta.
ALTER TABLE recetas
  ADD COLUMN IF NOT EXISTS costo_personalizado numeric(12,4);

COMMENT ON COLUMN recetas.costo_personalizado IS 'Override manual del costo por unidad. Si no es NULL, se usa en lugar de costo_calculado.';
