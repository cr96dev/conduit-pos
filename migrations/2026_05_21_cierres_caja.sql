-- Migration: cierres de caja diarios
-- Fecha: 2026-05-21
-- Proposito:
--   Cuadre diario entre lo que reporta Loyverse (ventas por metodo de pago)
--   y el efectivo fisico contado en caja, mas el control de egresos chicos
--   pagados del cajon durante el dia (pan empleados, propinas, suministros).
--
--   Un cierre por fecha. Los campos ventas_* los calcula la API leyendo
--   loyverse_receipts + loyverse_receipt_payments del rango GT del dia.
--
-- Flujo:
--   1. POST /api/cierres -> crea registro estado='abierto' con calculos.
--   2. PATCH /api/cierres/:id -> editar conteo/egresos/saldo (solo abierto).
--   3. POST /api/cierres/:id/cerrar -> bloquea el registro (estado='cerrado').
--   4. POST /api/cierres/:id/reabrir -> solo admin, vuelve a 'abierto'.
--
-- RLS: lectura authenticated, escritura admin.

-- =============================================================================
-- cierres_caja
-- =============================================================================

CREATE TABLE IF NOT EXISTS cierres_caja (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                 date NOT NULL UNIQUE,           -- un cierre por dia
  saldo_inicial         numeric(14,2) NOT NULL DEFAULT 0,
  conteo_efectivo       numeric(14,2),                  -- conteo fisico (manual)

  -- Calculado por la API desde Loyverse al crear/recalcular:
  ventas_efectivo       numeric(14,2) NOT NULL DEFAULT 0,
  ventas_tarjeta        numeric(14,2) NOT NULL DEFAULT 0,
  ventas_otros          numeric(14,2) NOT NULL DEFAULT 0,
  ventas_total          numeric(14,2) NOT NULL DEFAULT 0,
  cantidad_recibos      integer NOT NULL DEFAULT 0,

  -- Computado a partir de egresos:
  egresos_total         numeric(14,2) NOT NULL DEFAULT 0,

  -- Derivado:
  -- saldo_esperado = saldo_inicial + ventas_efectivo - egresos_total
  -- diferencia     = conteo_efectivo - saldo_esperado
  saldo_esperado        numeric(14,2) NOT NULL DEFAULT 0,
  diferencia            numeric(14,2),

  estado                text NOT NULL DEFAULT 'abierto'
                          CHECK (estado IN ('abierto', 'cerrado')),
  notas                 text,

  cerrado_at            timestamptz,
  cerrado_by            uuid REFERENCES auth.users(id),
  created_by            uuid REFERENCES auth.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cierres_caja IS 'Cierre diario de caja. Un registro por fecha. Los totales de ventas se recalculan desde loyverse_receipts cuando esta abierto.';

CREATE INDEX IF NOT EXISTS cierres_caja_fecha_idx ON cierres_caja(fecha DESC);
CREATE INDEX IF NOT EXISTS cierres_caja_estado_idx ON cierres_caja(estado);

-- =============================================================================
-- cierres_egresos
-- =============================================================================

CREATE TABLE IF NOT EXISTS cierres_egresos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cierre_id       uuid NOT NULL REFERENCES cierres_caja(id) ON DELETE CASCADE,
  concepto        text NOT NULL,
  monto           numeric(14,2) NOT NULL CHECK (monto > 0),
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cierres_egresos IS 'Gastos en efectivo desde la caja durante el dia (pan empleados, propinas, materiales urgentes, etc.). La suma alimenta cierres_caja.egresos_total.';

CREATE INDEX IF NOT EXISTS cierres_egresos_cierre_idx ON cierres_egresos(cierre_id);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE cierres_caja     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cierres_egresos  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cierres_caja_select ON cierres_caja;
CREATE POLICY cierres_caja_select ON cierres_caja
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cierres_caja_write_admin ON cierres_caja;
CREATE POLICY cierres_caja_write_admin ON cierres_caja
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));

DROP POLICY IF EXISTS cierres_egresos_select ON cierres_egresos;
CREATE POLICY cierres_egresos_select ON cierres_egresos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS cierres_egresos_write_admin ON cierres_egresos;
CREATE POLICY cierres_egresos_write_admin ON cierres_egresos
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));
