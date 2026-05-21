-- Migration: liquidaciones laborales (Guatemala)
-- Fecha: 2026-05-21
-- Proposito:
--   Calcular y registrar la liquidacion de prestaciones de ley al dar de baja
--   a un empleado. Cubre los 3 escenarios del Codigo de Trabajo:
--     - despido_injustificado (Art. 82) -> indemnizacion + preaviso
--     - despido_justificado   (Art. 77) -> sin indemnizacion
--     - renuncia_voluntaria   (Art. 83) -> sin indemnizacion
--   Siempre incluye: vacaciones proporcionales, aguinaldo proporcional,
--   bono 14 proporcional, salario pendiente, deducciones.
--
--   Al guardar una liquidacion, la API marca al empleado como activo=false.
--
-- RLS: lectura authenticated, escritura admin.

CREATE TABLE IF NOT EXISTS liquidaciones (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id                 uuid REFERENCES empleados(id) ON DELETE SET NULL,

  -- Snapshot del empleado al momento de liquidar:
  nombre                      text NOT NULL,
  puesto                      text,
  area                        text,
  salario_mensual             numeric(12,2) NOT NULL,
  fecha_ingreso               date,
  fecha_baja                  date NOT NULL,

  tipo_baja                   text NOT NULL CHECK (tipo_baja IN (
                                'despido_injustificado','despido_justificado','renuncia_voluntaria')),
  motivo                      text,

  -- Cantidades calculadas:
  anios_trabajados            numeric(10,4) NOT NULL DEFAULT 0,
  meses_trabajados            int           NOT NULL DEFAULT 0,
  dias_trabajados             int           NOT NULL DEFAULT 0,
  salario_promedio_6m         numeric(12,2),

  indemnizacion               numeric(12,2) NOT NULL DEFAULT 0,
  preaviso                    numeric(12,2) NOT NULL DEFAULT 0,
  vacaciones_pendientes       numeric(12,2) NOT NULL DEFAULT 0,
  dias_vacaciones             numeric(6,2)  NOT NULL DEFAULT 0,
  aguinaldo_proporcional      numeric(12,2) NOT NULL DEFAULT 0,
  dias_aguinaldo              int           NOT NULL DEFAULT 0,
  bono14_proporcional         numeric(12,2) NOT NULL DEFAULT 0,
  dias_bono14                 int           NOT NULL DEFAULT 0,
  salario_pendiente           numeric(12,2) NOT NULL DEFAULT 0,
  dias_salario_pendiente      int           NOT NULL DEFAULT 0,

  total_bruto                 numeric(12,2) NOT NULL DEFAULT 0,
  deducciones                 numeric(12,2) NOT NULL DEFAULT 0,
  total_neto                  numeric(12,2) NOT NULL DEFAULT 0,

  notas                       text,
  creado_por                  uuid REFERENCES auth.users(id),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE liquidaciones IS 'Snapshot inmutable de la liquidacion laboral al momento de dar de baja a un empleado. Conservar todos los campos calculados para auditoria; no recalcular despues.';

CREATE INDEX IF NOT EXISTS liquidaciones_empleado_idx ON liquidaciones(empleado_id);
CREATE INDEX IF NOT EXISTS liquidaciones_fecha_idx    ON liquidaciones(fecha_baja DESC);
CREATE INDEX IF NOT EXISTS liquidaciones_tipo_idx     ON liquidaciones(tipo_baja);

ALTER TABLE liquidaciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS liquidaciones_select       ON liquidaciones;
DROP POLICY IF EXISTS liquidaciones_insert_admin ON liquidaciones;
DROP POLICY IF EXISTS liquidaciones_delete_admin ON liquidaciones;

CREATE POLICY liquidaciones_select ON liquidaciones FOR SELECT TO authenticated USING (true);
CREATE POLICY liquidaciones_insert_admin ON liquidaciones FOR INSERT TO authenticated
  WITH CHECK (es_admin(auth.uid()));
CREATE POLICY liquidaciones_delete_admin ON liquidaciones FOR DELETE TO authenticated
  USING (es_admin(auth.uid()));
-- No UPDATE: las liquidaciones son inmutables. Si se equivoco, borrarla y rehacerla.
