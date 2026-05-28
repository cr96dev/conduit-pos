-- Migration: tabla neonet_transacciones
-- Fecha: 2026-05-28
-- Aplicado: 2026-05-28 via MCP de Supabase por Charles.
-- Proposito:
--   Auditoria 1:1 con facturas_fel para autorizaciones de tarjeta procesadas
--   via Neonet (mock, sandbox QA_HIDROCOM, prod). Una fila por intento, sea
--   aprobado o rechazado, para tener trazabilidad completa y poder conciliar
--   con el settlement diario.
--
--   Relacion con facturas_fel:
--     - Si approved=true, factura_id se setea cuando se crea la factura FEL
--       (caso normal: cobro tarjeta OK -> certificacion FEL OK).
--     - Si approved=false, factura_id queda NULL (no hay factura).
--     - Si approved=true pero la certificacion FEL fallo despues, factura_id
--       queda NULL pero ya hubo cobro real -> es un caso que requiere
--       anular en Neonet manualmente o esperar reversal automatico.
--
--   PCI scope: NUNCA guardar PAN completo, CVV, PIN, ni track data. Solo:
--     - pan_masked: ultimos 4 (lo que Neonet devuelve enmascarado en panPci).
--     - card_holder_name: si Neonet lo devuelve (no es PCI sensitive).

CREATE TABLE IF NOT EXISTS neonet_transacciones (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificador unico del lado de Julia. Lo generamos antes de gatillar
  -- el Intent NeoPOS para hacer correlacion request/response y evitar
  -- duplicados por doble-click del cajero.
  idsale                  text NOT NULL UNIQUE,

  tipo                    text NOT NULL DEFAULT 'sale'
                            CHECK (tipo IN ('sale','annulment','reverse','config')),

  -- Identificacion del dispositivo (Neonet los devuelve en config y los
  -- guardamos en cada transaccion para auditoria, no en tabla aparte).
  terminal_id             text,
  card_acq_id             text,

  -- Monto autorizado, en centavos enteros (Neonet trabaja sin decimales).
  amount_cents            integer NOT NULL CHECK (amount_cents >= 0),

  -- Resultado de la autorizacion.
  approved                boolean NOT NULL,
  response_code           text,
  response_message        text,
  authorization_code      text,
  retrieval_no            text,
  voucher_code            text,
  suggested_nit           text,

  -- Datos de tarjeta NO PCI-sensitive.
  pan_masked              text,
  card_holder_name        text,
  pos_entry_mode          text,

  -- Origen: distingue test de real para reportes y limpieza.
  origen                  text NOT NULL DEFAULT 'mock'
                            CHECK (origen IN ('mock','sandbox','prod')),

  -- Vinculo a la factura FEL. NULL si approved=false o si la factura
  -- todavia no se persistio (caso intermedio entre auth y cert).
  factura_id              uuid REFERENCES facturas_fel(id) ON DELETE SET NULL,

  -- Settlement / conciliacion diaria. Se setea cuando el cron de cierre
  -- diario procesa el lote Neonet (privateUse60).
  settlement_batch        text,
  settlement_date         date,

  -- Crudo para auditoria.
  raw_request             jsonb DEFAULT '{}'::jsonb,
  raw_response            jsonb DEFAULT '{}'::jsonb,

  created_by              uuid REFERENCES auth.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE neonet_transacciones IS
  'Auditoria de autorizaciones de tarjeta procesadas via Neonet. Una fila por intento (aprobado o rechazado). PCI scope: NO PAN completo, NO CVV, NO PIN.';
COMMENT ON COLUMN neonet_transacciones.idsale IS
  'Generado por Julia antes del Intent NeoPOS. UNIQUE para evitar duplicados por doble-click.';
COMMENT ON COLUMN neonet_transacciones.amount_cents IS
  'Monto autorizado en centavos enteros (Neonet sale_amount sin decimales: 10000 = Q100.00).';
COMMENT ON COLUMN neonet_transacciones.origen IS
  'mock=desarrollo sin Sunmi, sandbox=QA_HIDROCOM, prod=produccion.';
COMMENT ON COLUMN neonet_transacciones.factura_id IS
  'FK a facturas_fel. NULL si no hubo factura (rechazada o intermedia).';

CREATE INDEX IF NOT EXISTS neonet_trans_factura_idx    ON neonet_transacciones(factura_id);
CREATE INDEX IF NOT EXISTS neonet_trans_settlement_idx ON neonet_transacciones(settlement_date, settlement_batch);
CREATE INDEX IF NOT EXISTS neonet_trans_created_idx    ON neonet_transacciones(created_at DESC);
CREATE INDEX IF NOT EXISTS neonet_trans_origen_idx     ON neonet_transacciones(origen) WHERE origen != 'prod';
CREATE INDEX IF NOT EXISTS neonet_trans_pendiente_idx  ON neonet_transacciones(created_at)
  WHERE approved = true AND factura_id IS NULL;

-- Touch trigger para updated_at.
CREATE OR REPLACE FUNCTION neonet_trans_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_neonet_trans_touch ON neonet_transacciones;
CREATE TRIGGER trg_neonet_trans_touch
  BEFORE UPDATE ON neonet_transacciones
  FOR EACH ROW EXECUTE FUNCTION neonet_trans_touch();

-- RLS
ALTER TABLE neonet_transacciones ENABLE ROW LEVEL SECURITY;

-- SELECT solo admin (datos financieros sensibles + ultimos 4 PAN).
DROP POLICY IF EXISTS neonet_trans_select_admin ON neonet_transacciones;
CREATE POLICY neonet_trans_select_admin ON neonet_transacciones
  FOR SELECT TO authenticated USING (es_admin(auth.uid()));

-- INSERT/UPDATE/DELETE: solo service_role (los endpoints /api/neonet/* y
-- /api/pos/ventas escriben con supabaseAdmin). NO policies para authenticated
-- significa que escribir desde el front esta bloqueado por defecto.

INSERT INTO _schema_migrations (filename, applied_by) VALUES
  ('2026_05_28_neonet_transacciones.sql', 'mcp')
ON CONFLICT (filename) DO NOTHING;
