-- Migration: plan de cuentas + asientos contables (partida doble)
-- Fecha: 2026-05-21
-- Proposito:
--   Modulo contable basico con partida doble (debe = haber por asiento).
--   Tablas:
--     - cuentas_contables: catalogo jerarquico (1.1.01.001).
--         es_movimiento=true acepta partidas; false son cuentas de agrupacion.
--         naturaleza ('deudora'|'acreedora') indica como aumenta la cuenta.
--     - asientos: cabecera con numero correlativo, fecha, estado.
--     - asientos_partidas: lineas debe/haber referenciando cuenta.
--   Constraint:
--     - El total_debe debe ser igual al total_haber por asiento (postear lo valida).
--     - Solo cuentas con es_movimiento=true pueden recibir partidas.
--   Origen:
--     - origen_tipo + origen_id permiten enganchar el asiento a una compra,
--       cierre_caja, planilla, etc.
--   RLS: lectura authenticated, escritura admin.
--
--   Seed: catalogo base panaderia GT (codigos formato 1-XX-XX-XX).

-- =============================================================================
-- cuentas_contables
-- =============================================================================

CREATE TABLE IF NOT EXISTS cuentas_contables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo          text NOT NULL UNIQUE,    -- '1', '1-01', '1-01-01', '1-01-01-001'
  nombre          text NOT NULL,
  tipo            text NOT NULL CHECK (tipo IN ('activo','pasivo','patrimonio','ingreso','costo','gasto')),
  naturaleza      text NOT NULL CHECK (naturaleza IN ('deudora','acreedora')),
  cuenta_padre_id uuid REFERENCES cuentas_contables(id) ON DELETE RESTRICT,
  nivel           int  NOT NULL DEFAULT 1,
  es_movimiento   boolean NOT NULL DEFAULT false,
  activo          boolean NOT NULL DEFAULT true,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cuentas_contables IS 'Plan de cuentas jerarquico. es_movimiento=true acepta asientos; false son cuentas agrupadoras (totalizadoras).';

CREATE INDEX IF NOT EXISTS cuentas_codigo_idx ON cuentas_contables(codigo);
CREATE INDEX IF NOT EXISTS cuentas_padre_idx  ON cuentas_contables(cuenta_padre_id);
CREATE INDEX IF NOT EXISTS cuentas_tipo_idx   ON cuentas_contables(tipo);

-- =============================================================================
-- asientos
-- =============================================================================

CREATE TABLE IF NOT EXISTS asientos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero          bigserial UNIQUE,            -- correlativo auto
  fecha           date NOT NULL,
  descripcion     text NOT NULL,
  total_debe      numeric(14,2) NOT NULL DEFAULT 0,
  total_haber     numeric(14,2) NOT NULL DEFAULT 0,
  estado          text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador','posteado','anulado')),

  -- Enganchar el asiento a un evento de negocio:
  origen_tipo     text,                        -- 'cierre_caja'|'compra'|'planilla'|'liquidacion'|'manual'
  origen_id       uuid,

  notas           text,
  creado_por      uuid REFERENCES auth.users(id),
  posteado_por    uuid REFERENCES auth.users(id),
  posteado_at     timestamptz,
  anulado_por     uuid REFERENCES auth.users(id),
  anulado_at      timestamptz,
  anulado_motivo  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE asientos IS 'Asiento contable de partida doble. La igualdad debe=haber se valida al postear.';

CREATE INDEX IF NOT EXISTS asientos_fecha_idx       ON asientos(fecha DESC);
CREATE INDEX IF NOT EXISTS asientos_estado_idx      ON asientos(estado);
CREATE INDEX IF NOT EXISTS asientos_origen_idx      ON asientos(origen_tipo, origen_id);

-- =============================================================================
-- asientos_partidas
-- =============================================================================

CREATE TABLE IF NOT EXISTS asientos_partidas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asiento_id  uuid NOT NULL REFERENCES asientos(id) ON DELETE CASCADE,
  cuenta_id   uuid NOT NULL REFERENCES cuentas_contables(id) ON DELETE RESTRICT,
  concepto    text,
  debe        numeric(14,2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
  haber       numeric(14,2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
  orden       int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT debe_o_haber_no_ambos CHECK (NOT (debe > 0 AND haber > 0))
);

CREATE INDEX IF NOT EXISTS partidas_asiento_idx ON asientos_partidas(asiento_id);
CREATE INDEX IF NOT EXISTS partidas_cuenta_idx  ON asientos_partidas(cuenta_id);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE cuentas_contables    ENABLE ROW LEVEL SECURITY;
ALTER TABLE asientos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE asientos_partidas    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cuentas_select        ON cuentas_contables;
DROP POLICY IF EXISTS cuentas_write_admin   ON cuentas_contables;
DROP POLICY IF EXISTS asientos_select       ON asientos;
DROP POLICY IF EXISTS asientos_write_admin  ON asientos;
DROP POLICY IF EXISTS partidas_select       ON asientos_partidas;
DROP POLICY IF EXISTS partidas_write_admin  ON asientos_partidas;

CREATE POLICY cuentas_select       ON cuentas_contables FOR SELECT TO authenticated USING (true);
CREATE POLICY cuentas_write_admin  ON cuentas_contables FOR ALL    TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
CREATE POLICY asientos_select      ON asientos          FOR SELECT TO authenticated USING (true);
CREATE POLICY asientos_write_admin ON asientos          FOR ALL    TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
CREATE POLICY partidas_select      ON asientos_partidas FOR SELECT TO authenticated USING (true);
CREATE POLICY partidas_write_admin ON asientos_partidas FOR ALL    TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));

-- =============================================================================
-- Seed: plan de cuentas base panaderia GT
-- =============================================================================

INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, nivel, es_movimiento) VALUES
  -- Activo
  ('1',           'ACTIVO',                                  'activo',     'deudora',   1, false),
  ('1-01',        'Activo corriente',                        'activo',     'deudora',   2, false),
  ('1-01-01',     'Caja y bancos',                           'activo',     'deudora',   3, false),
  ('1-01-01-001', 'Caja general',                            'activo',     'deudora',   4, true),
  ('1-01-01-002', 'Caja chica',                              'activo',     'deudora',   4, true),
  ('1-01-01-101', 'Banco Industrial — cuenta corriente',     'activo',     'deudora',   4, true),
  ('1-01-02',     'Cuentas por cobrar',                      'activo',     'deudora',   3, false),
  ('1-01-02-001', 'Clientes',                                'activo',     'deudora',   4, true),
  ('1-01-03',     'Inventarios',                             'activo',     'deudora',   3, false),
  ('1-01-03-001', 'Insumos panaderia',                       'activo',     'deudora',   4, true),
  ('1-01-03-002', 'Productos terminados',                    'activo',     'deudora',   4, true),
  ('1-01-04',     'Impuestos por cobrar',                    'activo',     'deudora',   3, false),
  ('1-01-04-001', 'IVA credito fiscal',                      'activo',     'deudora',   4, true),
  ('1-02',        'Activo no corriente',                     'activo',     'deudora',   2, false),
  ('1-02-01',     'Mobiliario y equipo',                     'activo',     'deudora',   3, true),
  ('1-02-02',     '(-) Depreciacion acumulada',              'activo',     'acreedora', 3, true),
  -- Pasivo
  ('2',           'PASIVO',                                  'pasivo',     'acreedora', 1, false),
  ('2-01',        'Pasivo corriente',                        'pasivo',     'acreedora', 2, false),
  ('2-01-01',     'Cuentas por pagar',                       'pasivo',     'acreedora', 3, false),
  ('2-01-01-001', 'Proveedores',                             'pasivo',     'acreedora', 4, true),
  ('2-01-02',     'Impuestos por pagar',                     'pasivo',     'acreedora', 3, false),
  ('2-01-02-001', 'IVA debito fiscal',                       'pasivo',     'acreedora', 4, true),
  ('2-01-02-002', 'ISR por pagar',                           'pasivo',     'acreedora', 4, true),
  ('2-01-03',     'Beneficios laborales por pagar',          'pasivo',     'acreedora', 3, false),
  ('2-01-03-001', 'Sueldos por pagar',                       'pasivo',     'acreedora', 4, true),
  ('2-01-03-002', 'IGSS laboral por pagar',                  'pasivo',     'acreedora', 4, true),
  ('2-01-03-003', 'IGSS patronal por pagar',                 'pasivo',     'acreedora', 4, true),
  ('2-01-03-004', 'IRTRA por pagar',                         'pasivo',     'acreedora', 4, true),
  ('2-01-03-005', 'INTECAP por pagar',                       'pasivo',     'acreedora', 4, true),
  ('2-01-03-006', 'Bono 14 por pagar',                       'pasivo',     'acreedora', 4, true),
  ('2-01-03-007', 'Aguinaldo por pagar',                     'pasivo',     'acreedora', 4, true),
  ('2-01-03-008', 'Indemnizaciones por pagar',               'pasivo',     'acreedora', 4, true),
  -- Patrimonio
  ('3',           'PATRIMONIO',                              'patrimonio', 'acreedora', 1, false),
  ('3-01',        'Capital',                                 'patrimonio', 'acreedora', 2, true),
  ('3-02',        'Resultados acumulados',                   'patrimonio', 'acreedora', 2, true),
  ('3-03',        'Resultado del ejercicio',                 'patrimonio', 'acreedora', 2, true),
  -- Ingresos
  ('4',           'INGRESOS',                                'ingreso',    'acreedora', 1, false),
  ('4-01',        'Ventas',                                  'ingreso',    'acreedora', 2, false),
  ('4-01-01',     'Ventas de pan',                           'ingreso',    'acreedora', 3, true),
  ('4-01-02',     'Ventas de pasteleria',                    'ingreso',    'acreedora', 3, true),
  ('4-01-03',     'Otras ventas',                            'ingreso',    'acreedora', 3, true),
  ('4-02',        'Otros ingresos',                          'ingreso',    'acreedora', 2, true),
  -- Costos
  ('5',           'COSTOS',                                  'costo',      'deudora',   1, false),
  ('5-01',        'Costo de ventas',                         'costo',      'deudora',   2, false),
  ('5-01-01',     'Costo de insumos',                        'costo',      'deudora',   3, true),
  ('5-01-02',     'Mermas y desperdicios',                   'costo',      'deudora',   3, true),
  -- Gastos
  ('6',           'GASTOS',                                  'gasto',      'deudora',   1, false),
  ('6-01',        'Gastos de personal',                      'gasto',      'deudora',   2, false),
  ('6-01-01',     'Sueldos y salarios',                      'gasto',      'deudora',   3, true),
  ('6-01-02',     'Bonificaciones',                          'gasto',      'deudora',   3, true),
  ('6-01-03',     'Horas extra',                             'gasto',      'deudora',   3, true),
  ('6-01-04',     'IGSS patronal (gasto)',                   'gasto',      'deudora',   3, true),
  ('6-01-05',     'IRTRA (gasto)',                           'gasto',      'deudora',   3, true),
  ('6-01-06',     'INTECAP (gasto)',                         'gasto',      'deudora',   3, true),
  ('6-01-07',     'Provision indemnizacion',                 'gasto',      'deudora',   3, true),
  ('6-01-08',     'Provision bono 14',                       'gasto',      'deudora',   3, true),
  ('6-01-09',     'Provision aguinaldo',                     'gasto',      'deudora',   3, true),
  ('6-01-10',     'Provision vacaciones',                    'gasto',      'deudora',   3, true),
  ('6-02',        'Gastos operativos',                       'gasto',      'deudora',   2, false),
  ('6-02-01',     'Alquiler',                                'gasto',      'deudora',   3, true),
  ('6-02-02',     'Servicios basicos (luz/agua/gas)',        'gasto',      'deudora',   3, true),
  ('6-02-03',     'Telefono e internet',                     'gasto',      'deudora',   3, true),
  ('6-02-04',     'Mantenimiento de equipo',                 'gasto',      'deudora',   3, true),
  ('6-02-05',     'Limpieza',                                'gasto',      'deudora',   3, true),
  ('6-02-06',     'Transporte y combustible',                'gasto',      'deudora',   3, true),
  ('6-02-07',     'Empaque y bolsas',                        'gasto',      'deudora',   3, true),
  ('6-03',        'Gastos administrativos',                  'gasto',      'deudora',   2, false),
  ('6-03-01',     'Honorarios profesionales',                'gasto',      'deudora',   3, true),
  ('6-03-02',     'Comisiones bancarias',                    'gasto',      'deudora',   3, true),
  ('6-03-03',     'Papeleria y utiles',                      'gasto',      'deudora',   3, true),
  ('6-03-04',     'Otros gastos administrativos',            'gasto',      'deudora',   3, true)
ON CONFLICT (codigo) DO NOTHING;

-- Resolver cuenta_padre_id por codigo prefix (despues del seed inicial).
UPDATE cuentas_contables c
SET cuenta_padre_id = padre.id
FROM cuentas_contables padre
WHERE c.cuenta_padre_id IS NULL
  AND padre.codigo = regexp_replace(c.codigo, '-[^-]+$', '')
  AND c.codigo LIKE '%-%';
