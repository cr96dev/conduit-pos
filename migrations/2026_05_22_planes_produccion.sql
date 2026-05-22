-- Migration: planes de produccion (BOM explosion + descuento auditado)
-- Fecha: 2026-05-22
-- Proposito:
--   Permitir planificar produccion por fecha: cuantas unidades de cada receta
--   se van a producir. Al "ejecutar" el plan, se descuentan los insumos
--   resolviendo recursivamente sub-recetas, usando el sistema de movimientos
--   auditados existente (insumos_movimientos) con referencia { plan_id, ... }.
--
--   No hay UNIQUE en fecha_produccion: se pueden tener multiples planes por
--   dia (turnos, replans). La UI default muestra "el mas reciente" por fecha.
--
--   Estados: borrador -> ejecutado (descontado stock, terminal)
--                     -> cancelado (no descontado, terminal)
--   Solo borrador es editable.
--
--   La explosion del BOM y el calculo de faltantes se hacen al vuelo en la
--   API (no se persisten) para que reflejen siempre el stock actual.

CREATE TABLE IF NOT EXISTS planes_produccion (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha_produccion  date NOT NULL,
  estado            text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador', 'ejecutado', 'cancelado')),
  notas             text,
  ejecutado_at      timestamptz,
  ejecutado_by      uuid REFERENCES auth.users(id),
  created_by        uuid REFERENCES auth.users(id),
  updated_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE planes_produccion IS 'Plan de produccion por fecha. Una vez ejecutado descuenta insumos via insumos_movimientos.';
COMMENT ON COLUMN planes_produccion.estado IS 'borrador (editable) / ejecutado (descontado stock) / cancelado (no descontado).';

CREATE INDEX IF NOT EXISTS planes_prod_fecha_idx   ON planes_produccion(fecha_produccion DESC);
CREATE INDEX IF NOT EXISTS planes_prod_estado_idx  ON planes_produccion(estado);

-- =============================================================================
-- Lineas: una por receta a producir
-- =============================================================================

CREATE TABLE IF NOT EXISTS planes_produccion_lineas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     uuid NOT NULL REFERENCES planes_produccion(id) ON DELETE CASCADE,
  receta_id   uuid NOT NULL REFERENCES recetas(id) ON DELETE RESTRICT,
  cantidad    numeric(14,3) NOT NULL CHECK (cantidad > 0),
  notas       text,
  orden       integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, receta_id)
);

COMMENT ON TABLE planes_produccion_lineas IS 'Cada linea = una receta a producir con su cantidad de unidades (en rinde_unidad de la receta).';

CREATE INDEX IF NOT EXISTS planes_prod_lineas_plan_idx   ON planes_produccion_lineas(plan_id);
CREATE INDEX IF NOT EXISTS planes_prod_lineas_receta_idx ON planes_produccion_lineas(receta_id);

-- =============================================================================
-- Touch trigger para updated_at de planes_produccion
-- =============================================================================

CREATE OR REPLACE FUNCTION planes_produccion_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_planes_produccion_touch ON planes_produccion;
CREATE TRIGGER trg_planes_produccion_touch
  BEFORE UPDATE ON planes_produccion
  FOR EACH ROW EXECUTE FUNCTION planes_produccion_touch();

-- =============================================================================
-- RLS: lectura para authenticated, escritura solo para admin.
-- =============================================================================

ALTER TABLE planes_produccion         ENABLE ROW LEVEL SECURITY;
ALTER TABLE planes_produccion_lineas  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS planes_prod_select         ON planes_produccion;
DROP POLICY IF EXISTS planes_prod_write_admin    ON planes_produccion;
DROP POLICY IF EXISTS planes_prod_lineas_select  ON planes_produccion_lineas;
DROP POLICY IF EXISTS planes_prod_lineas_write_admin ON planes_produccion_lineas;

CREATE POLICY planes_prod_select ON planes_produccion
  FOR SELECT TO authenticated USING (true);

CREATE POLICY planes_prod_write_admin ON planes_produccion
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));

CREATE POLICY planes_prod_lineas_select ON planes_produccion_lineas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY planes_prod_lineas_write_admin ON planes_produccion_lineas
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));

-- =============================================================================
-- Marcar en _schema_migrations
-- =============================================================================

INSERT INTO _schema_migrations (filename, applied_by) VALUES
  ('2026_05_22_planes_produccion.sql', 'mcp')
ON CONFLICT (filename) DO NOTHING;
