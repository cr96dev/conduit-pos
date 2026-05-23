-- Migration: agregar mapping vacaciones_por_pagar
-- Fecha: 2026-05-23
-- Proposito:
--   El asiento de planilla pagada (generarAsientoPlanillaPagada en
--   lib/contabilidad/generador.js) acreditaba bono14_por_pagar,
--   aguinaldo_por_pagar e indemnizacion_por_pagar al cierre de la quincena,
--   pero NO acreditaba vacaciones_por_pagar — el asiento quedaba
--   desbalanceado por exactamente el monto de la provision de vacaciones.
--
--   La cuenta `2-01-03-009 Vacaciones por pagar` ya existe en
--   cuentas_contables (creada durante la carga de provisiones de abril).
--   Esta migracion solo agrega el mapping; si no existe la cuenta el
--   INSERT queda con cuenta_id=NULL y el admin lo configura desde UI.

INSERT INTO contabilidad_mappings (clave, descripcion, cuenta_id) VALUES
  ('vacaciones_por_pagar', 'Pasivo: vacaciones por pagar',
   (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-009'))
ON CONFLICT (clave) DO NOTHING;
