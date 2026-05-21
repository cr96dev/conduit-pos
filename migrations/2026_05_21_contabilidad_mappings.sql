-- Migration: configuracion contable centralizada (mappings)
-- Fecha: 2026-05-21
-- Proposito:
--   Mapear conceptos de negocio a cuentas del plan contable, sin agregar
--   columnas cada vez que aparezca uno nuevo. Modelo key/value singleton.
--
--   Las claves estandar las consume lib/contabilidad/generador.js para
--   armar asientos automaticos al ocurrir eventos:
--     - cierre_caja          -> ventas/caja
--     - compra recibida      -> inventario/proveedores
--     - planilla pagada      -> sueldos/cargas patronales/IGSS por pagar
--     - liquidacion          -> indemnizacion/banco
--
--   El seed inicial intenta inferir mappings desde el catalogo seed de
--   migrations/2026_05_21_contabilidad.sql. Si una cuenta no existe (por
--   ejemplo plan de cuentas customizado), el mapping queda NULL y el
--   admin lo configura desde la UI.

CREATE TABLE IF NOT EXISTS contabilidad_mappings (
  clave         text PRIMARY KEY,
  cuenta_id     uuid REFERENCES cuentas_contables(id) ON DELETE SET NULL,
  descripcion   text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE contabilidad_mappings IS 'Mapping clave -> cuenta contable. Usado por el generador automatico de asientos. Si una clave no esta o cuenta_id es NULL, el evento se loguea como pendiente y NO se crea el asiento (no se rompe el flujo de negocio).';

-- RLS
ALTER TABLE contabilidad_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mappings_select       ON contabilidad_mappings;
DROP POLICY IF EXISTS mappings_write_admin  ON contabilidad_mappings;
CREATE POLICY mappings_select      ON contabilidad_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY mappings_write_admin ON contabilidad_mappings FOR ALL    TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));

-- =============================================================================
-- Seed: insertar claves estandar con cuenta_id inferido del catalogo seed.
-- Si no existe la cuenta, queda NULL y se configura desde la UI.
-- =============================================================================

INSERT INTO contabilidad_mappings (clave, descripcion, cuenta_id) VALUES
  -- Caja / Bancos:
  ('caja_efectivo',           'Caja general (efectivo)',              (SELECT id FROM cuentas_contables WHERE codigo = '1-01-01-001')),
  ('caja_chica',              'Caja chica',                            (SELECT id FROM cuentas_contables WHERE codigo = '1-01-01-002')),
  ('banco_default',           'Banco principal (deposito tarjetas/transferencias)', (SELECT id FROM cuentas_contables WHERE codigo = '1-01-01-101')),
  -- IVA:
  ('iva_debito',              'IVA debito fiscal (cobrado en ventas)', (SELECT id FROM cuentas_contables WHERE codigo = '2-01-02-001')),
  ('iva_credito',             'IVA credito fiscal (pagado en compras)',(SELECT id FROM cuentas_contables WHERE codigo = '1-01-04-001')),
  -- Ventas:
  ('ventas_default',          'Ventas (cuenta por defecto)',           (SELECT id FROM cuentas_contables WHERE codigo = '4-01-01')),
  -- Compras / Inventario:
  ('proveedores',             'Cuentas por pagar a proveedores',       (SELECT id FROM cuentas_contables WHERE codigo = '2-01-01-001')),
  ('inventario_insumos',      'Inventario de insumos',                 (SELECT id FROM cuentas_contables WHERE codigo = '1-01-03-001')),
  ('mobiliario_equipo',       'Mobiliario y equipo (compras de activo fijo)', (SELECT id FROM cuentas_contables WHERE codigo = '1-02-01')),
  ('gastos_operativos_default', 'Gastos operativos (compras sin inventario)', (SELECT id FROM cuentas_contables WHERE codigo = '6-02-04')),
  -- Planilla — GASTOS:
  ('sueldos_gasto',           'Gasto: sueldos y salarios',             (SELECT id FROM cuentas_contables WHERE codigo = '6-01-01')),
  ('bonificaciones_gasto',    'Gasto: bonificaciones',                 (SELECT id FROM cuentas_contables WHERE codigo = '6-01-02')),
  ('horas_extra_gasto',       'Gasto: horas extra',                    (SELECT id FROM cuentas_contables WHERE codigo = '6-01-03')),
  ('igss_patronal_gasto',     'Gasto: IGSS patronal',                  (SELECT id FROM cuentas_contables WHERE codigo = '6-01-04')),
  ('irtra_gasto',             'Gasto: IRTRA',                          (SELECT id FROM cuentas_contables WHERE codigo = '6-01-05')),
  ('intecap_gasto',           'Gasto: INTECAP',                        (SELECT id FROM cuentas_contables WHERE codigo = '6-01-06')),
  ('indemnizacion_gasto',     'Gasto: provision indemnizacion',        (SELECT id FROM cuentas_contables WHERE codigo = '6-01-07')),
  ('bono14_gasto',            'Gasto: provision bono 14',              (SELECT id FROM cuentas_contables WHERE codigo = '6-01-08')),
  ('aguinaldo_gasto',         'Gasto: provision aguinaldo',            (SELECT id FROM cuentas_contables WHERE codigo = '6-01-09')),
  ('vacaciones_gasto',        'Gasto: provision vacaciones',           (SELECT id FROM cuentas_contables WHERE codigo = '6-01-10')),
  -- Planilla — PASIVOS POR PAGAR:
  ('sueldos_por_pagar',       'Pasivo: sueldos por pagar',             (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-001')),
  ('igss_laboral_por_pagar',  'Pasivo: IGSS empleado por pagar',       (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-002')),
  ('igss_patronal_por_pagar', 'Pasivo: IGSS patronal por pagar',       (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-003')),
  ('irtra_por_pagar',         'Pasivo: IRTRA por pagar',               (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-004')),
  ('intecap_por_pagar',       'Pasivo: INTECAP por pagar',             (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-005')),
  ('bono14_por_pagar',        'Pasivo: bono 14 por pagar',             (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-006')),
  ('aguinaldo_por_pagar',     'Pasivo: aguinaldo por pagar',           (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-007')),
  ('indemnizacion_por_pagar', 'Pasivo: indemnizaciones por pagar',     (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-008'))
ON CONFLICT (clave) DO NOTHING;
