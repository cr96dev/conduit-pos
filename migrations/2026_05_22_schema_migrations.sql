-- Migration: tabla tracker de migraciones aplicadas
-- Fecha: 2026-05-22
-- Proposito:
--   Hasta hoy las migraciones de migrations/ se aplicaron a mano sin tracker.
--   Esta tabla registra que migracion corrio en este entorno. Acompanada del
--   script scripts/migrate.js, permite saber que falta aplicar al traer cambios.
--
--   IMPORTANTE: el INSERT al final hace backfill de los 19 archivos previos
--   que ya estaban aplicados en prod. Si aplicas este SQL en un entorno donde
--   esas migraciones NO corrieron, primero corre cada una y despues este.

CREATE TABLE IF NOT EXISTS _schema_migrations (
  filename    text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text                                 -- info libre (host/usuario/proceso) opcional
);

COMMENT ON TABLE _schema_migrations IS 'Una fila por archivo SQL de migrations/ aplicado. El script scripts/migrate.js consulta esta tabla para decidir que aplicar.';

ALTER TABLE _schema_migrations ENABLE ROW LEVEL SECURITY;

-- Nada de policies para authenticated: solo service_role lee/escribe (bypass RLS).
-- El front no necesita ver esto. El script de migracion corre con creds elevadas.

-- Backfill: marcar como aplicadas las 19 migraciones existentes (mas esta misma).
INSERT INTO _schema_migrations (filename, applied_by) VALUES
  ('2026_05_08_qbo_setup.sql',                  'backfill'),
  ('2026_05_19_planilla_bonif_descuentos.sql',  'backfill'),
  ('2026_05_20_loyverse_schema.sql',            'backfill'),
  ('2026_05_21_bancos.sql',                     'backfill'),
  ('2026_05_21_bancos_reglas.sql',              'backfill'),
  ('2026_05_21_cierre_desglose_pagos.sql',      'backfill'),
  ('2026_05_21_cierres_caja.sql',               'backfill'),
  ('2026_05_21_compras.sql',                    'backfill'),
  ('2026_05_21_contabilidad.sql',               'backfill'),
  ('2026_05_21_contabilidad_mappings.sql',      'backfill'),
  ('2026_05_21_fel.sql',                        'backfill'),
  ('2026_05_21_igss.sql',                       'backfill'),
  ('2026_05_21_liquidaciones.sql',              'backfill'),
  ('2026_05_21_perfiles_insumos.sql',           'backfill'),
  ('2026_05_21_planillas.sql',                  'backfill'),
  ('2026_05_21_recetas.sql',                    'backfill'),
  ('2026_05_21_recetas_costo_personalizado.sql','backfill'),
  ('2026_05_21_subrecetas.sql',                 'backfill'),
  ('2026_05_22_conteos_diarios_producto.sql',   'backfill'),
  ('2026_05_22_schema_migrations.sql',          'self')
ON CONFLICT (filename) DO NOTHING;
