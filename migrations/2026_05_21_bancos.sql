-- Migration: conciliacion bancaria
-- Fecha: 2026-05-21
-- Proposito:
--   Importar extractos de cuentas bancarias y conciliar contra asientos
--   contables ya posteados. Cada cuenta bancaria propia se mapea a una
--   cuenta del plan contable (ej. "1-01-01-101 Banco Industrial").
--
-- Flujo:
--   1. Definir cuenta bancaria (banco, numero, cuenta_contable_id).
--   2. Importar CSV de extracto -> filas en bancos_movimientos.
--   3. La UI sugiere asientos contables cuyo monto/fecha cuadran con
--      cada movimiento bancario.
--   4. Conciliar: setear bancos_movimientos.asiento_id (1:1 simple).
--
--   Nota: 1:1 cubre el caso del 95%. Para split (1 mov bancario contra
--   varios asientos) se puede extender despues con tabla intermedia.
--
-- RLS: lectura authenticated, escritura admin.

-- =============================================================================
-- bancos_cuentas
-- =============================================================================

CREATE TABLE IF NOT EXISTS bancos_cuentas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  banco               text NOT NULL,                       -- 'BI' | 'BAM' | 'BAC' | etc.
  alias               text NOT NULL,                       -- 'BI cta corriente principal'
  numero_cuenta       text,
  tipo                text DEFAULT 'monetaria' CHECK (tipo IN ('monetaria','ahorro','tarjeta_credito','otro')),
  moneda              text DEFAULT 'GTQ',
  cuenta_contable_id  uuid REFERENCES cuentas_contables(id),
  saldo_inicial       numeric(14,2) NOT NULL DEFAULT 0,    -- saldo al abrir el modulo
  fecha_saldo_inicial date,                                -- a que fecha aplica el saldo inicial
  activo              boolean NOT NULL DEFAULT true,
  notas               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE bancos_cuentas IS 'Cuentas bancarias propias de la panaderia. cuenta_contable_id apunta al plan de cuentas para que la conciliacion conecte los dos mundos.';

CREATE INDEX IF NOT EXISTS bancos_cuentas_activo_idx ON bancos_cuentas(activo);

-- =============================================================================
-- bancos_movimientos
-- =============================================================================

CREATE TABLE IF NOT EXISTS bancos_movimientos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cuenta_id         uuid NOT NULL REFERENCES bancos_cuentas(id) ON DELETE CASCADE,
  fecha             date NOT NULL,
  descripcion       text NOT NULL,                          -- texto del extracto del banco
  referencia        text,                                   -- numero de operacion, cheque, etc.
  debito            numeric(14,2) NOT NULL DEFAULT 0,       -- salida (banco lo carga)
  credito           numeric(14,2) NOT NULL DEFAULT 0,       -- entrada (banco lo abona)
  saldo             numeric(14,2),                          -- saldo segun banco (si viene en CSV)

  -- Conciliacion:
  asiento_id        uuid REFERENCES asientos(id) ON DELETE SET NULL,
  conciliado_at     timestamptz,
  conciliado_by     uuid REFERENCES auth.users(id),
  conciliado_notas  text,

  -- Idempotencia para evitar duplicados al re-importar:
  hash_import       text,                                   -- hash de (cuenta, fecha, desc, debito, credito, ref)
  raw               jsonb DEFAULT '{}'::jsonb,
  importado_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT debito_o_credito CHECK (NOT (debito > 0 AND credito > 0)),
  CONSTRAINT debito_credito_nonneg CHECK (debito >= 0 AND credito >= 0)
);

COMMENT ON TABLE bancos_movimientos IS 'Movimientos de extractos bancarios. hash_import evita duplicados al re-importar. asiento_id != null -> conciliado.';

CREATE INDEX IF NOT EXISTS bancos_mov_cuenta_idx       ON bancos_movimientos(cuenta_id);
CREATE INDEX IF NOT EXISTS bancos_mov_fecha_idx        ON bancos_movimientos(fecha DESC);
CREATE INDEX IF NOT EXISTS bancos_mov_conciliado_idx   ON bancos_movimientos(cuenta_id, asiento_id);
CREATE UNIQUE INDEX IF NOT EXISTS bancos_mov_hash_unique ON bancos_movimientos(cuenta_id, hash_import) WHERE hash_import IS NOT NULL;

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE bancos_cuentas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE bancos_movimientos  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bancos_cuentas_select       ON bancos_cuentas;
DROP POLICY IF EXISTS bancos_cuentas_write_admin  ON bancos_cuentas;
DROP POLICY IF EXISTS bancos_mov_select           ON bancos_movimientos;
DROP POLICY IF EXISTS bancos_mov_write_admin      ON bancos_movimientos;

CREATE POLICY bancos_cuentas_select      ON bancos_cuentas     FOR SELECT TO authenticated USING (true);
CREATE POLICY bancos_cuentas_write_admin ON bancos_cuentas     FOR ALL    TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
CREATE POLICY bancos_mov_select          ON bancos_movimientos FOR SELECT TO authenticated USING (true);
CREATE POLICY bancos_mov_write_admin     ON bancos_movimientos FOR ALL    TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
