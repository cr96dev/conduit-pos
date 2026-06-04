-- Migration: fallback Infile (vender y certificar después)
-- Fecha: 4 jun 2026
-- Proposito: cuando Infile FEL no responde (timeout/5xx), guardar la venta
--            en estado pendiente_certificacion con el XML listo. Cron cada 5
--            min reintenta. Cliente sigue cobrando, operación no se para.
--
-- Aplicada en producción vía Supabase MCP el 4 jun. Este archivo es la copia
-- versionada en git para referencia.

-- Expandir el CHECK del estado para aceptar 'pendiente_certificacion'
ALTER TABLE facturas_fel DROP CONSTRAINT facturas_fel_estado_check;
ALTER TABLE facturas_fel ADD CONSTRAINT facturas_fel_estado_check
  CHECK (estado IN ('borrador', 'certificada', 'anulada', 'error', 'pendiente_certificacion'));

-- Campos para el reintento
ALTER TABLE facturas_fel
  ADD COLUMN IF NOT EXISTS xml_pendiente TEXT,
  ADD COLUMN IF NOT EXISTS intentos_certificacion INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_intento_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_ultimo_intento TEXT,
  ADD COLUMN IF NOT EXISTS pendiente_desde TIMESTAMPTZ;

-- Índice parcial para que el cron de reintentos sea eficiente
CREATE INDEX IF NOT EXISTS facturas_fel_pendiente_cert_idx
  ON facturas_fel (pendiente_desde)
  WHERE estado = 'pendiente_certificacion';

COMMENT ON COLUMN facturas_fel.xml_pendiente IS
  'XML DTE listo para reintentar certificación con Infile cuando esté disponible';
COMMENT ON COLUMN facturas_fel.intentos_certificacion IS
  'Contador de intentos del cron de reintentos. Reset al certificar.';
COMMENT ON COLUMN facturas_fel.pendiente_desde IS
  'Cuando entró al estado pendiente_certificacion. Para alertas si >30min.';

-- RLS: la tabla ya tiene políticas activas. Las nuevas columnas heredan.
-- El cron usa service_role así que pasa por encima de RLS — verificado en
-- el handler.
