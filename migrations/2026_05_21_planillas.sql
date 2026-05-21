-- Migration: empleados + planillas quincenales
-- Fecha: 2026-05-21
-- Proposito:
--   Portar de GasOps el modelo de planillas quincenales con calculos
--   laborales segun normativa de Guatemala:
--     - IGSS empleado 4.83% sobre sueldo + extras + comisiones + otros ingresos
--       (bonificacion incentivo Q250 esta EXENTA - art. Decreto 37-2001)
--     - IGSS patrono 10.67%, IRTRA 1%, INTECAP 1%, indemnizacion 9.72%
--     - Bono 14, aguinaldo, vacaciones: provision mensual = salario/12
--       (quincenal = salario/24 cada uno)
--   Adaptaciones a Julia Bakery:
--     - Sin "estacion" (Julia es tienda unica). Se reemplaza por "area" libre
--       (panaderia, ventas, administracion, etc.).
--     - Catalogo de puestos editable, no hardcodeado.
--   Tablas:
--     - empleados            : ficha con datos personales y salariales
--     - planillas            : cabecera quincenal (periodo, fechas, estado, totales)
--     - planilla_lineas      : una linea por empleado por planilla
--     - planilla_auditoria   : log inmutable de cambios de estado
--   RLS: lectura authenticated, escritura admin.

-- =============================================================================
-- empleados
-- =============================================================================

CREATE TABLE IF NOT EXISTS empleados (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                          text NOT NULL,
  dpi                             text,
  nit                             text,
  numero_igss                     text,
  area                            text DEFAULT 'panaderia',  -- 'panaderia' | 'ventas' | 'administracion' | etc
  puesto                          text NOT NULL DEFAULT 'Panadero',
  tipo_pago                       text NOT NULL DEFAULT 'efectivo' CHECK (tipo_pago IN ('efectivo','transferencia','cheque')),
  banco                           text,
  numero_cuenta                   text,
  fecha_ingreso                   date,

  -- Salario y provisiones (precalculadas al guardar):
  salario_mensual                 numeric(12,2) NOT NULL DEFAULT 0,
  salario_quincenal               numeric(12,2) NOT NULL DEFAULT 0,
  bono14_quincenal                numeric(12,2) NOT NULL DEFAULT 0,
  aguinaldo_quincenal             numeric(12,2) NOT NULL DEFAULT 0,
  vacaciones_quincenal            numeric(12,2) NOT NULL DEFAULT 0,
  igss_empleado_quincenal         numeric(12,2) NOT NULL DEFAULT 0,
  igss_patronal_mensual           numeric(12,2) NOT NULL DEFAULT 0,
  irtra_mensual                   numeric(12,2) NOT NULL DEFAULT 0,
  intecap_mensual                 numeric(12,2) NOT NULL DEFAULT 0,
  indemnizacion_mensual           numeric(12,2) NOT NULL DEFAULT 0,
  costo_patronal_quincenal        numeric(12,2) NOT NULL DEFAULT 0,
  costo_total_mensual             numeric(12,2) NOT NULL DEFAULT 0,

  -- Bonificaciones fijas (se suman como "otros_ingresos" al generar linea):
  bonificacion_quincenal          numeric(12,2) NOT NULL DEFAULT 0,
  bonificacion_segunda_quincena   numeric(12,2) NOT NULL DEFAULT 0,

  notas                           text,
  activo                          boolean NOT NULL DEFAULT true,
  created_by                      uuid REFERENCES auth.users(id),
  created_at                      timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE empleados IS 'Ficha laboral del personal. Los campos *_quincenal y *_mensual son provisiones precalculadas; la API los recalcula al guardar salario_mensual.';
COMMENT ON COLUMN empleados.bonificacion_quincenal IS 'Bono fijo que se aplica todas las quincenas (ej. movilizacion).';
COMMENT ON COLUMN empleados.bonificacion_segunda_quincena IS 'Bono fijo solo en quincena #2 del mes (ej. complemento administrativo).';

CREATE INDEX IF NOT EXISTS empleados_activo_idx ON empleados(activo);
CREATE INDEX IF NOT EXISTS empleados_area_idx   ON empleados(area);

-- =============================================================================
-- planillas (cabecera quincenal)
-- =============================================================================

CREATE TABLE IF NOT EXISTS planillas (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  periodo                 text NOT NULL,         -- 'PRIMERA QUINCENA MAYO 2026'
  anio                    int  NOT NULL,
  mes                     int  NOT NULL CHECK (mes BETWEEN 1 AND 12),
  quincena                int  NOT NULL CHECK (quincena IN (1, 2)),
  fecha_inicio            date NOT NULL,
  fecha_fin               date NOT NULL,
  estado                  text NOT NULL DEFAULT 'borrador'
                            CHECK (estado IN ('borrador', 'revision', 'aprobada', 'pagada')),

  -- Totales calculados (la API actualiza estos al cambiar lineas):
  total_bruto             numeric(14,2) NOT NULL DEFAULT 0,
  total_adiciones         numeric(14,2) NOT NULL DEFAULT 0,
  total_igss_empleados    numeric(14,2) NOT NULL DEFAULT 0,
  total_descuentos        numeric(14,2) NOT NULL DEFAULT 0,
  total_liquido           numeric(14,2) NOT NULL DEFAULT 0,
  total_costo_patronal    numeric(14,2) NOT NULL DEFAULT 0,

  notas                   text,
  aprobado_por            uuid REFERENCES auth.users(id),
  aprobado_en             timestamptz,
  creado_por              uuid REFERENCES auth.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (anio, mes, quincena)
);

COMMENT ON TABLE planillas IS 'Cabecera de planilla quincenal. Una sola por (anio, mes, quincena).';

CREATE INDEX IF NOT EXISTS planillas_fecha_idx  ON planillas(fecha_inicio DESC);
CREATE INDEX IF NOT EXISTS planillas_estado_idx ON planillas(estado);

-- =============================================================================
-- planilla_lineas
-- =============================================================================

CREATE TABLE IF NOT EXISTS planilla_lineas (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planilla_id                 uuid NOT NULL REFERENCES planillas(id) ON DELETE CASCADE,
  empleado_id                 uuid REFERENCES empleados(id) ON DELETE SET NULL,

  -- Snapshot al momento de generar la linea (por si el empleado cambia despues):
  nombre                      text NOT NULL,
  area                        text,
  puesto                      text,
  tipo_pago                   text,
  banco                       text,
  numero_cuenta               text,
  numero_cheque               text,
  concepto                    text,

  -- Salario y provisiones (snapshot):
  salario_quincenal           numeric(12,2) NOT NULL DEFAULT 0,
  bono14_quincenal            numeric(12,2) NOT NULL DEFAULT 0,
  aguinaldo_quincenal         numeric(12,2) NOT NULL DEFAULT 0,
  vacaciones_quincenal        numeric(12,2) NOT NULL DEFAULT 0,

  -- Adiciones del periodo (editables):
  horas_extra                 numeric(12,2) NOT NULL DEFAULT 0,
  comisiones                  numeric(12,2) NOT NULL DEFAULT 0,
  otros_ingresos              numeric(12,2) NOT NULL DEFAULT 0,
  bonificacion_incentivo      numeric(12,2) NOT NULL DEFAULT 0,  -- Q250 def, exenta IGSS

  -- IGSS empleado calculado (4.83% sobre sueldo+extras+comisiones+otros, sin bonif incentivo):
  igss_empleado               numeric(12,2) NOT NULL DEFAULT 0,

  -- Descuentos del periodo (editables):
  faltante_inventario         numeric(12,2) NOT NULL DEFAULT 0,
  faltante_efectivo           numeric(12,2) NOT NULL DEFAULT 0,
  prestamo_anticipo           numeric(12,2) NOT NULL DEFAULT 0,
  embargo_deuda               numeric(12,2) NOT NULL DEFAULT 0,
  otros_descuentos            numeric(12,2) NOT NULL DEFAULT 0,
  descuentos_varios           numeric(12,2) NOT NULL DEFAULT 0,

  -- Costos patronales snapshot (para reporte costo total empresa):
  igss_patronal               numeric(12,2) NOT NULL DEFAULT 0,
  irtra                       numeric(12,2) NOT NULL DEFAULT 0,
  intecap                     numeric(12,2) NOT NULL DEFAULT 0,
  indemnizacion               numeric(12,2) NOT NULL DEFAULT 0,
  costo_patronal_total        numeric(12,2) NOT NULL DEFAULT 0,

  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE planilla_lineas IS 'Una linea por empleado por planilla. Los snapshot fields preservan la foto del momento de generar; los campos *_varios y adiciones son editables.';
COMMENT ON COLUMN planilla_lineas.bonificacion_incentivo IS 'Bonif. Decreto 37-2001. Exenta de IGSS, suma al liquido.';

CREATE INDEX IF NOT EXISTS planilla_lineas_planilla_idx ON planilla_lineas(planilla_id);
CREATE INDEX IF NOT EXISTS planilla_lineas_empleado_idx ON planilla_lineas(empleado_id);

-- =============================================================================
-- planilla_auditoria (log inmutable)
-- =============================================================================

CREATE TABLE IF NOT EXISTS planilla_auditoria (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planilla_id     uuid NOT NULL REFERENCES planillas(id) ON DELETE CASCADE,
  accion          text NOT NULL,                 -- 'creada' | 'revision' | 'aprobada' | 'pagada' | 'rechazada' | 'eliminada'
  usuario_id      uuid REFERENCES auth.users(id),
  usuario_email   text,
  notas           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planilla_auditoria_planilla_idx ON planilla_auditoria(planilla_id);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE empleados            ENABLE ROW LEVEL SECURITY;
ALTER TABLE planillas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE planilla_lineas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE planilla_auditoria   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS empleados_select          ON empleados;
DROP POLICY IF EXISTS empleados_write_admin     ON empleados;
DROP POLICY IF EXISTS planillas_select          ON planillas;
DROP POLICY IF EXISTS planillas_write_admin     ON planillas;
DROP POLICY IF EXISTS planilla_lineas_select    ON planilla_lineas;
DROP POLICY IF EXISTS planilla_lineas_write_admin ON planilla_lineas;
DROP POLICY IF EXISTS planilla_auditoria_select ON planilla_auditoria;
DROP POLICY IF EXISTS planilla_auditoria_insert_admin ON planilla_auditoria;

CREATE POLICY empleados_select ON empleados FOR SELECT TO authenticated USING (true);
CREATE POLICY empleados_write_admin ON empleados FOR ALL TO authenticated
  USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));

CREATE POLICY planillas_select ON planillas FOR SELECT TO authenticated USING (true);
CREATE POLICY planillas_write_admin ON planillas FOR ALL TO authenticated
  USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));

CREATE POLICY planilla_lineas_select ON planilla_lineas FOR SELECT TO authenticated USING (true);
CREATE POLICY planilla_lineas_write_admin ON planilla_lineas FOR ALL TO authenticated
  USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));

CREATE POLICY planilla_auditoria_select ON planilla_auditoria FOR SELECT TO authenticated USING (true);
CREATE POLICY planilla_auditoria_insert_admin ON planilla_auditoria FOR INSERT TO authenticated
  WITH CHECK (es_admin(auth.uid()));
-- planilla_auditoria es append-only: no UPDATE/DELETE policies.
