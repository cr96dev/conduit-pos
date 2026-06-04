-- Migration: ampliar pedidos_pendientes.estado para flujo pickup
-- Fecha: 2026-06-03
-- Proposito: el flujo pickup requiere estados nuevos: 'pendiente_pago'
--            (esperando confirmación Recurrente), 'lista' (preparado y listo
--            para que el cliente pase a recoger), 'facturada' (sinónimo más
--            corto de entregado_facturado), 'cancelada' (sinónimo).
--
-- Se mantienen los valores viejos (entregado_facturado, cancelado) para no
-- romper datos existentes.

ALTER TABLE pedidos_pendientes
  DROP CONSTRAINT IF EXISTS pedidos_pendientes_estado_check;

ALTER TABLE pedidos_pendientes
  ADD CONSTRAINT pedidos_pendientes_estado_check
  CHECK (estado = ANY (ARRAY[
    'pendiente_pago'::text,
    'pendiente_entrega'::text,
    'lista'::text,
    'entregado_facturado'::text,
    'facturada'::text,
    'cancelado'::text,
    'cancelada'::text
  ]));

COMMENT ON CONSTRAINT pedidos_pendientes_estado_check ON pedidos_pendientes IS
  'Estados ampliados para flujo pickup. pendiente_pago → pendiente_entrega (pago confirmado) → lista (listo para recoger, dispara notif) → facturada / cancelada.';
