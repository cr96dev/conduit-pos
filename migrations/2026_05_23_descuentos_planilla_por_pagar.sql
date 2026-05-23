-- Migration: cuenta + mapping descuentos_planilla_por_pagar
-- Fecha: 2026-05-23
-- Proposito:
--   Los asientos de planilla pagada y liquidacion calculaban descuentos al
--   empleado (prestamo_anticipo, embargo_deuda, faltantes, otros) y los
--   restaban del liquido pagado, pero no emitian contrapartida en HABER.
--   El asiento quedaba desbalanceado por el monto total de descuentos.
--
--   Esta cuenta acumula esos descuentos como pasivo (el empleado los debe
--   o, en caso de embargo/faltante, los debe la empresa a un tercero).
--   Cuando se cobra/aplica el descuento el saldo se reduce.

INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, nivel, es_movimiento) VALUES
  ('2-01-03-010', 'Descuentos a planilla por pagar', 'pasivo', 'acreedora', 4, true)
ON CONFLICT (codigo) DO NOTHING;

INSERT INTO contabilidad_mappings (clave, descripcion, cuenta_id) VALUES
  ('descuentos_planilla_por_pagar',
   'Pasivo: descuentos aplicados al liquido del empleado (anticipos, embargos, faltantes)',
   (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-010'))
ON CONFLICT (clave) DO NOTHING;
