-- Migration: conteo fisico diario de productos terminados
-- Fecha: 2026-05-22
-- Proposito:
--   Permitir cargar un conteo fisico (inventario final) por variante de Loyverse
--   al cierre del dia, opcionalmente acompanado de un inventario inicial.
--
--   Inventario teorico de un dia = (inicial_cargado o 0) - ventas_del_dia.
--   Variacion = final_fisico - teorico.
--     -> Si hay inicial: variacion = merma/sobrante real.
--     -> Si no hay inicial: variacion = produccion estimada del dia,
--        porque final + ventas = lo que se produjo.
--
--   El POS Loyverse ya guarda un stock global por (variant, store) en
--   loyverse_inventory_levels, pero ese es un snapshot al ultimo sync,
--   no un historial. Esta tabla es el LOG diario de conteos manuales.
--
-- Convenciones:
--   - PK uuid v4 con gen_random_uuid().
--   - UNIQUE(fecha, variant_id, store_id): 1 fila por dia/variante/tienda.
--   - inicial y final son nullable: cualquiera de los dos puede no cargarse.
--   - store_id text porque viene de Loyverse (no FK estricta: la fila puede
--     existir aunque la tienda todavia no se haya sincronizado).

CREATE TABLE IF NOT EXISTS conteos_diarios_producto (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha              date NOT NULL,
  variant_id         text NOT NULL,
  store_id           text NOT NULL DEFAULT '',
  inventario_inicial numeric(14,3),
  inventario_final   numeric(14,3),
  notas              text,
  created_by         uuid REFERENCES auth.users(id),
  updated_by         uuid REFERENCES auth.users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fecha, variant_id, store_id)
);

COMMENT ON TABLE conteos_diarios_producto IS 'Conteo fisico diario de productos terminados (variantes de Loyverse). Una fila por (fecha, variant, store). inicial y final son opcionales.';
COMMENT ON COLUMN conteos_diarios_producto.inventario_inicial IS 'Conteo de stock al iniciar el dia. Opcional: si no se carga, el teorico parte de 0.';
COMMENT ON COLUMN conteos_diarios_producto.inventario_final IS 'Conteo fisico al cierre del dia. Opcional.';

CREATE INDEX IF NOT EXISTS conteos_diarios_fecha_idx   ON conteos_diarios_producto(fecha DESC);
CREATE INDEX IF NOT EXISTS conteos_diarios_variant_idx ON conteos_diarios_producto(variant_id);

-- Mantener updated_at sincronizado en updates.
CREATE OR REPLACE FUNCTION conteos_diarios_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conteos_diarios_touch ON conteos_diarios_producto;
CREATE TRIGGER trg_conteos_diarios_touch
  BEFORE UPDATE ON conteos_diarios_producto
  FOR EACH ROW
  EXECUTE FUNCTION conteos_diarios_touch();

-- =============================================================================
-- RLS: lectura para authenticated, escritura solo para admin.
-- =============================================================================

ALTER TABLE conteos_diarios_producto ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conteos_diarios_select        ON conteos_diarios_producto;
DROP POLICY IF EXISTS conteos_diarios_write_admin   ON conteos_diarios_producto;

CREATE POLICY conteos_diarios_select ON conteos_diarios_producto
  FOR SELECT TO authenticated USING (true);

CREATE POLICY conteos_diarios_write_admin ON conteos_diarios_producto
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));
