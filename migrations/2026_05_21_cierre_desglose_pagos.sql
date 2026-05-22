-- Desglose de pagos por método real de Loyverse
ALTER TABLE cierres_caja
  ADD COLUMN IF NOT EXISTS desglose_pagos jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN cierres_caja.desglose_pagos IS 'Map {nombre_metodo_normalizado: monto}. Ej: {"TARJETA": 1234.50, "EFECTIVO": 567.00, "PEDIDOS YA": 200.00}.';
