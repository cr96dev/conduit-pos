-- Migration: reglas de auto-clasificacion bancaria
-- Fecha: 2026-05-21
CREATE TABLE IF NOT EXISTS bancos_reglas_clasificacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patron          text NOT NULL,
  tipo_match      text NOT NULL DEFAULT 'contains' CHECK (tipo_match IN ('contains','starts_with','regex')),
  aplica_a        text NOT NULL DEFAULT 'ambos' CHECK (aplica_a IN ('debito','credito','ambos')),
  cuenta_id       uuid NOT NULL REFERENCES cuentas_contables(id),
  descripcion     text,
  concepto        text,
  prioridad       int NOT NULL DEFAULT 100,
  activa          boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reglas_activa_idx ON bancos_reglas_clasificacion(activa, prioridad);
ALTER TABLE bancos_reglas_clasificacion ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reglas_select       ON bancos_reglas_clasificacion;
DROP POLICY IF EXISTS reglas_write_admin  ON bancos_reglas_clasificacion;
CREATE POLICY reglas_select      ON bancos_reglas_clasificacion FOR SELECT TO authenticated USING (true);
CREATE POLICY reglas_write_admin ON bancos_reglas_clasificacion FOR ALL    TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
