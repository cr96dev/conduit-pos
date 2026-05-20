-- Migration: agregar columnas bonificacion_incentivo y descuentos_varios a planilla_lineas
-- Fecha: 2026-05-19
-- Proposito:
--   1. bonificacion_incentivo: Bonificacion Decreto 37-2001 editable por linea (quincenal).
--      NO afecta IGSS (es exenta por ley). Suma al liquido a recibir.
--   2. descuentos_varios: Descuentos miscelaneos editables (faltantes pequenos, ajustes,
--      cobros internos, etc). Resta del liquido a recibir.

ALTER TABLE planilla_lineas
  ADD COLUMN IF NOT EXISTS bonificacion_incentivo numeric(12,2) DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS descuentos_varios      numeric(12,2) DEFAULT 0 NOT NULL;

COMMENT ON COLUMN planilla_lineas.bonificacion_incentivo IS
  'Bonificacion Incentivo Decreto 37-2001 quincenal. Exenta de IGSS. Suma al liquido.';
COMMENT ON COLUMN planilla_lineas.descuentos_varios IS
  'Descuentos miscelaneos quincenales editables. Resta del liquido.';
