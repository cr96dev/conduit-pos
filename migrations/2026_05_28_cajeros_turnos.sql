-- Migration: Login PIN cajeros + turnos de caja
-- Fecha: 2026-05-28
-- Proposito:
--   1. Extender perfiles.rol con 'cajero' + columnas para PIN (hash, salt) y
--      anti-brute-force (intentos, bloqueo).
--   2. cajeros_login_intentos: tracking por IP para bloqueo temporal
--      (5 fallos seguidos -> 1 min). Solo escribe/lee service_role.
--   3. turnos_caja: apertura/cierre por cajero. Convive con cierres_caja
--      (este es diario agregado; turnos_caja es por sesion de cajero).
--   4. facturas_fel.turno_id (FK opcional al turno del cajero que emitio).
--
-- RLS:
--   - perfiles: ya existia (self_or_admin). Sin cambios.
--   - turnos_caja: cajero ve/modifica los suyos; admin lo todo.
--   - cajeros_login_intentos: sin policies -> solo service_role.
--   - facturas_fel: sin cambios (el API server-side usa service_role).

-- =============================================================================
-- 1. perfiles: extender rol con 'cajero' + columnas PIN
-- =============================================================================

-- Drop el CHECK actual (nombre auto-generado) y reemplazar con uno nombrado.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'perfiles'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%rol%IN%'
  LOOP
    EXECUTE format('ALTER TABLE perfiles DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE perfiles
  ADD CONSTRAINT perfiles_rol_check
  CHECK (rol IN ('admin', 'empleado', 'cajero'));

ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS pin_hash               text,
  ADD COLUMN IF NOT EXISTS pin_salt               text,
  ADD COLUMN IF NOT EXISTS pin_intentos_fallidos  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_bloqueado_hasta    timestamptz,
  ADD COLUMN IF NOT EXISTS pin_updated_at         timestamptz;

COMMENT ON COLUMN perfiles.pin_hash IS 'PBKDF2-SHA256 del PIN (hex). NULL para usuarios sin PIN.';
COMMENT ON COLUMN perfiles.pin_salt IS 'Salt aleatorio (hex, 16 bytes). Se rota al setear PIN.';
COMMENT ON COLUMN perfiles.pin_intentos_fallidos IS 'Contador per-cajero (uso informativo). El lockout real es por IP en cajeros_login_intentos.';
COMMENT ON COLUMN perfiles.pin_bloqueado_hasta IS 'Reserva para futuro bloqueo per-cajero. Hoy se usa lockout por IP.';

-- Helper: es_cajero(uid) — para policies que distinguen rol cajero.
CREATE OR REPLACE FUNCTION es_cajero(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM perfiles
    WHERE id = uid AND rol = 'cajero' AND activo = true
  );
$$;

COMMENT ON FUNCTION es_cajero(uuid) IS 'true si uid es un cajero activo. SECURITY DEFINER evita recursion en RLS.';

-- =============================================================================
-- 2. cajeros_login_intentos — anti-brute-force por IP
-- =============================================================================

CREATE TABLE IF NOT EXISTS cajeros_login_intentos (
  ip                    text PRIMARY KEY,
  intentos_fallidos     int  NOT NULL DEFAULT 0,
  bloqueado_hasta       timestamptz,
  ultimo_intento_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cajeros_login_intentos IS
  'Tracking de intentos fallidos de login PIN por IP. 5 fallos seguidos -> bloqueo 1 minuto. Solo service_role (no policies).';

ALTER TABLE cajeros_login_intentos ENABLE ROW LEVEL SECURITY;
-- Sin policies: solo service_role accede (no auth en el momento del login).

-- =============================================================================
-- 3. turnos_caja
-- =============================================================================

CREATE TABLE IF NOT EXISTS turnos_caja (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cajero_id                   uuid NOT NULL REFERENCES perfiles(id) ON DELETE RESTRICT,

  -- Apertura:
  fecha_apertura              timestamptz NOT NULL DEFAULT now(),
  monto_apertura              numeric(14,2) NOT NULL DEFAULT 0,
  observacion_apertura        text,

  -- Cierre (NULL hasta cerrar):
  fecha_cierre                timestamptz,
  monto_cierre_esperado       numeric(14,2),
  conteo_efectivo_cierre      numeric(14,2),
  diferencia                  numeric(14,2),
  observacion_cierre          text,

  -- Snapshot agregado de ventas al cierre (cache, recalculable):
  ventas_efectivo             numeric(14,2) NOT NULL DEFAULT 0,
  ventas_tarjeta              numeric(14,2) NOT NULL DEFAULT 0,
  ventas_transferencia        numeric(14,2) NOT NULL DEFAULT 0,
  ventas_pedidos_ya           numeric(14,2) NOT NULL DEFAULT 0,
  ventas_otro                 numeric(14,2) NOT NULL DEFAULT 0,
  ventas_total                numeric(14,2) NOT NULL DEFAULT 0,
  cantidad_facturas           int NOT NULL DEFAULT 0,

  estado                      text NOT NULL DEFAULT 'abierto'
                                CHECK (estado IN ('abierto', 'cerrado')),

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE turnos_caja IS
  'Turno de caja por cajero. Convive con cierres_caja (diario agregado). Un cajero a lo sumo UN turno abierto a la vez (uniq index parcial).';
COMMENT ON COLUMN turnos_caja.monto_apertura IS 'Efectivo declarado al abrir el turno.';
COMMENT ON COLUMN turnos_caja.monto_cierre_esperado IS 'monto_apertura + ventas_efectivo. Lo calcula la API al cerrar.';
COMMENT ON COLUMN turnos_caja.diferencia IS 'conteo_efectivo_cierre - monto_cierre_esperado. Neg = faltante, Pos = sobrante.';

CREATE INDEX IF NOT EXISTS turnos_caja_cajero_idx           ON turnos_caja(cajero_id);
CREATE INDEX IF NOT EXISTS turnos_caja_fecha_apertura_idx   ON turnos_caja(fecha_apertura DESC);
CREATE INDEX IF NOT EXISTS turnos_caja_estado_idx           ON turnos_caja(estado);

-- Solo UN turno abierto por cajero.
CREATE UNIQUE INDEX IF NOT EXISTS turnos_caja_cajero_abierto_uniq
  ON turnos_caja(cajero_id) WHERE estado = 'abierto';

-- RLS
ALTER TABLE turnos_caja ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS turnos_caja_select ON turnos_caja;
CREATE POLICY turnos_caja_select ON turnos_caja
  FOR SELECT TO authenticated
  USING (cajero_id = auth.uid() OR es_admin(auth.uid()));

DROP POLICY IF EXISTS turnos_caja_insert ON turnos_caja;
CREATE POLICY turnos_caja_insert ON turnos_caja
  FOR INSERT TO authenticated
  WITH CHECK (cajero_id = auth.uid() OR es_admin(auth.uid()));

DROP POLICY IF EXISTS turnos_caja_update ON turnos_caja;
CREATE POLICY turnos_caja_update ON turnos_caja
  FOR UPDATE TO authenticated
  USING (cajero_id = auth.uid() OR es_admin(auth.uid()))
  WITH CHECK (cajero_id = auth.uid() OR es_admin(auth.uid()));

-- No DELETE policy: los turnos no se borran (audit trail).

-- =============================================================================
-- 4. facturas_fel.turno_id — vincular ventas POS al turno del cajero
-- =============================================================================

ALTER TABLE facturas_fel
  ADD COLUMN IF NOT EXISTS turno_id uuid REFERENCES turnos_caja(id) ON DELETE SET NULL;

COMMENT ON COLUMN facturas_fel.turno_id IS
  'Turno de caja activo cuando se emitio la venta POS. NULL para facturas previas a la feature o emitidas por admin sin turno.';

CREATE INDEX IF NOT EXISTS facturas_fel_turno_idx ON facturas_fel(turno_id);
