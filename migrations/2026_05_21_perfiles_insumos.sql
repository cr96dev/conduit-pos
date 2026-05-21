-- Migration: perfiles + insumos + movimientos de inventario
-- Fecha: 2026-05-21
-- Proposito:
--   1. Tabla de perfiles con rol (admin / empleado) ligada a auth.users.
--      Loyverse trackea productos terminados, pero Julia tambien necesita
--      gestionar materia prima (harina, levadura, mantequilla, huevos, etc.)
--      con stock minimo, alertas y movimientos auditados.
--   2. Tabla insumos (catalogo de materia prima).
--   3. Tabla insumos_movimientos (entradas, salidas, mermas, ajustes).
--      Cada movimiento guarda un delta firmado (positivo = entra, negativo = sale).
--      Un trigger mantiene insumos.stock_actual sincronizado.
--   4. RLS: lectura para authenticated, escritura solo para perfiles.rol = 'admin'.
--
-- Convenciones:
--   - PKs uuid v4 con gen_random_uuid().
--   - Timestamps timestamptz con default now().
--   - Cantidades numeric (no float) para evitar errores de redondeo.

-- =============================================================================
-- perfiles
-- =============================================================================

CREATE TABLE IF NOT EXISTS perfiles (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             text NOT NULL,
  nombre_completo   text,
  rol               text NOT NULL DEFAULT 'empleado' CHECK (rol IN ('admin', 'empleado')),
  activo            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE perfiles IS 'Perfil de usuario ligado 1:1 a auth.users. Determina el rol (admin vs empleado) para autorizacion en RLS y APIs.';
COMMENT ON COLUMN perfiles.rol IS 'admin: acceso total + escrituras administrativas. empleado: solo lectura por defecto.';

CREATE INDEX IF NOT EXISTS perfiles_rol_idx ON perfiles(rol);

-- Helper: es_admin(uid) — usado en politicas RLS de otras tablas.
CREATE OR REPLACE FUNCTION es_admin(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM perfiles
    WHERE id = uid AND rol = 'admin' AND activo = true
  );
$$;

COMMENT ON FUNCTION es_admin(uuid) IS 'Devuelve true si el uid corresponde a un perfil admin activo. SECURITY DEFINER para evitar recursion en RLS.';

-- =============================================================================
-- insumos
-- =============================================================================

CREATE TABLE IF NOT EXISTS insumos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre            text NOT NULL,
  categoria         text,                          -- 'harinas' | 'lacteos' | 'azucares' | etc. (libre)
  unidad            text NOT NULL DEFAULT 'unidad',-- 'kg' | 'lb' | 'lt' | 'unidad' | 'docena'
  stock_actual      numeric NOT NULL DEFAULT 0,
  stock_minimo      numeric NOT NULL DEFAULT 0,
  costo_unitario    numeric,                       -- Q por unidad. Opcional al crear.
  proveedor         text,                          -- proveedor principal (texto libre por ahora; se normaliza en Capa A.2)
  notas             text,
  activo            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE insumos IS 'Catalogo de materia prima de la panaderia (harinas, lacteos, levaduras, etc.). stock_actual lo mantiene el trigger desde insumos_movimientos.';

CREATE INDEX IF NOT EXISTS insumos_categoria_idx ON insumos(categoria);
CREATE INDEX IF NOT EXISTS insumos_activo_idx    ON insumos(activo);
CREATE UNIQUE INDEX IF NOT EXISTS insumos_nombre_unique_idx ON insumos(lower(nombre)) WHERE activo = true;

-- =============================================================================
-- insumos_movimientos
-- =============================================================================

CREATE TABLE IF NOT EXISTS insumos_movimientos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insumo_id         uuid NOT NULL REFERENCES insumos(id) ON DELETE RESTRICT,
  tipo              text NOT NULL CHECK (tipo IN ('entrada', 'salida', 'merma', 'ajuste')),
  delta             numeric NOT NULL,              -- firmado: positivo entra, negativo sale.
  stock_antes       numeric NOT NULL,              -- snapshot para auditoria
  stock_despues     numeric NOT NULL,              -- snapshot para auditoria
  costo_unitario    numeric,                       -- aplicable a entradas (precio de compra)
  motivo            text,                          -- texto libre: 'pan quemado', 'inventario inicial', etc.
  referencia        jsonb DEFAULT '{}'::jsonb,     -- para enganchar a compra_id, receta_id, etc. futuro
  created_by        uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE insumos_movimientos IS 'Historial inmutable de movimientos de inventario de insumos. No se actualiza ni borra; correcciones se hacen con un nuevo movimiento de tipo "ajuste".';
COMMENT ON COLUMN insumos_movimientos.delta IS 'Cambio firmado aplicado al stock. La API que inserta calcula stock_despues = stock_antes + delta y dispara el trigger.';

CREATE INDEX IF NOT EXISTS insumos_mov_insumo_idx     ON insumos_movimientos(insumo_id);
CREATE INDEX IF NOT EXISTS insumos_mov_created_at_idx ON insumos_movimientos(created_at DESC);
CREATE INDEX IF NOT EXISTS insumos_mov_tipo_idx       ON insumos_movimientos(tipo);

-- Trigger: al insertar movimiento, sincronizar insumos.stock_actual.
-- La API ya escribe stock_antes/stock_despues correctos; aqui solo replicamos
-- a la tabla maestra para que las consultas no tengan que sumar el historial.
CREATE OR REPLACE FUNCTION sync_stock_insumo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE insumos
     SET stock_actual = NEW.stock_despues,
         updated_at   = now()
   WHERE id = NEW.insumo_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_stock_insumo ON insumos_movimientos;
CREATE TRIGGER trg_sync_stock_insumo
  AFTER INSERT ON insumos_movimientos
  FOR EACH ROW
  EXECUTE FUNCTION sync_stock_insumo();

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE perfiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos_movimientos ENABLE ROW LEVEL SECURITY;

-- perfiles: cada usuario ve su propio perfil; admins ven todos.
DROP POLICY IF EXISTS perfiles_select_self_or_admin ON perfiles;
CREATE POLICY perfiles_select_self_or_admin ON perfiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR es_admin(auth.uid()));

-- perfiles: solo admin escribe (alta/baja/cambio de rol). service_role bypassea.
DROP POLICY IF EXISTS perfiles_write_admin ON perfiles;
CREATE POLICY perfiles_write_admin ON perfiles
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));

-- insumos: lectura para todos los authenticated; escritura solo admin.
DROP POLICY IF EXISTS insumos_select_authenticated ON insumos;
CREATE POLICY insumos_select_authenticated ON insumos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS insumos_write_admin ON insumos;
CREATE POLICY insumos_write_admin ON insumos
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));

-- insumos_movimientos: lectura para todos; insercion solo admin; no se actualiza ni borra.
DROP POLICY IF EXISTS insumos_mov_select_authenticated ON insumos_movimientos;
CREATE POLICY insumos_mov_select_authenticated ON insumos_movimientos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS insumos_mov_insert_admin ON insumos_movimientos;
CREATE POLICY insumos_mov_insert_admin ON insumos_movimientos
  FOR INSERT TO authenticated
  WITH CHECK (es_admin(auth.uid()));

-- NO POLICY de UPDATE/DELETE para insumos_movimientos: tabla append-only.
-- Las correcciones se hacen con un nuevo movimiento de tipo 'ajuste'.
