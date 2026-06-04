-- Migration: extender pedidos_pendientes para soportar pickup app
-- Fecha: 2026-06-03
-- Proposito: la app /pickup crea pedidos públicos con slot horario y datos
--            de tarjeta tokenizados. Reusamos la tabla pedidos_pendientes
--            existente para que el cajero los vea en la misma bandeja del
--            POS (origen='app_pickup'), pero agregamos campos específicos.
--
-- Sin cambios destructivos: solo ALTER TABLE ADD COLUMN IF NOT EXISTS.

ALTER TABLE pedidos_pendientes
  ADD COLUMN IF NOT EXISTS slot_pickup_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS slot_label text,
  ADD COLUMN IF NOT EXISTS day_label text,
  ADD COLUMN IF NOT EXISTS pago_metodo text,
  ADD COLUMN IF NOT EXISTS pago_ultimos4 text,
  ADD COLUMN IF NOT EXISTS pago_auth_code text,
  ADD COLUMN IF NOT EXISTS pago_simulado boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS receptor_telefono text;

CREATE INDEX IF NOT EXISTS idx_pedidos_pickup_email
  ON pedidos_pendientes (receptor_email)
  WHERE origen = 'app_pickup';

CREATE INDEX IF NOT EXISTS idx_pedidos_pickup_slot
  ON pedidos_pendientes (slot_pickup_at)
  WHERE origen = 'app_pickup' AND estado = 'pendiente_entrega';

COMMENT ON COLUMN pedidos_pendientes.slot_pickup_at IS
  'Hora exacta del slot de pickup elegida por el cliente (UTC). Solo aplica si origen=app_pickup.';
COMMENT ON COLUMN pedidos_pendientes.pago_simulado IS
  'true si el pago todavía no se procesó con Neonet real — modo mock del MVP. Cuando llegue Neonet en prod, todos los nuevos quedarán en false.';

-- RLS: pedidos pickup pueden ser leídos por el cliente que tenga el id
-- (matched por email guardado en localStorage en MVP). La policy existente
-- de pedidos_pendientes ya permite a admin/cajero ver todos, no la tocamos.
-- Para el cliente final usamos endpoints server-side con service role,
-- sin exponer la tabla directamente. Por eso no agregamos policy nueva acá.
