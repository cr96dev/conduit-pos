-- Migration: audit de reimpresiones de facturas FEL
-- Fecha: 2026-05-29
-- Proposito:
--   Cuando una factura ya certificada se reimprime fisicamente (porque al
--   cliente se le perdio el ticket, no salio bien el primer print, etc.),
--   registramos quien, cuando, por que motivo, desde donde.
--
--   El reimpresion NO recertifica con SAT — reusa el XML certificado original
--   y le agrega la leyenda "REIMPRESION N°X" al ticket impreso. Eso cumple
--   con la regulacion SAT que pide que la copia fisica de una factura ya
--   emitida vaya marcada como duplicado.
--
-- RLS:
--   - SELECT: admin + cajero (pueden ver su propio historial)
--   - INSERT/UPDATE/DELETE: solo service_role via API server-side
--     (el endpoint /api/fel/facturas/[id]/reimprimir lo inserta)

CREATE TABLE IF NOT EXISTS facturas_fel_reimpresiones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id  uuid NOT NULL REFERENCES facturas_fel(id) ON DELETE CASCADE,
  impreso_at  timestamptz NOT NULL DEFAULT now(),
  impreso_by  uuid REFERENCES perfiles(id) ON DELETE SET NULL,
  motivo      text NOT NULL,                       -- texto libre o codigo: 'cliente_perdio'|'no_salio'|'duplicado'|...
  origen      text NOT NULL DEFAULT 'admin'        -- 'admin' | 'cajero' | 'soporte'
                CHECK (origen IN ('admin','cajero','soporte')),
  ip          text                                 -- IP cliente, mejor esfuerzo (X-Forwarded-For)
);

COMMENT ON TABLE facturas_fel_reimpresiones IS 'Audit trail de reimpresiones de facturas FEL ya certificadas. Cada fila = un evento de print fisico de una copia.';
COMMENT ON COLUMN facturas_fel_reimpresiones.motivo IS 'Motivo del reimpresion. Texto libre (max 200 chars en API).';
COMMENT ON COLUMN facturas_fel_reimpresiones.origen IS 'Desde que rol/contexto se disparo: admin (pagina /facturacion), cajero (POS), soporte (chat de soporte).';

CREATE INDEX IF NOT EXISTS facturas_fel_reimpresiones_factura_idx
  ON facturas_fel_reimpresiones(factura_id, impreso_at DESC);
CREATE INDEX IF NOT EXISTS facturas_fel_reimpresiones_user_idx
  ON facturas_fel_reimpresiones(impreso_by, impreso_at DESC);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE facturas_fel_reimpresiones ENABLE ROW LEVEL SECURITY;

-- SELECT: admin ve todos. Cajero ve los que el reimprimió.
DROP POLICY IF EXISTS reimpresiones_select_admin  ON facturas_fel_reimpresiones;
DROP POLICY IF EXISTS reimpresiones_select_cajero ON facturas_fel_reimpresiones;

CREATE POLICY reimpresiones_select_admin ON facturas_fel_reimpresiones
  FOR SELECT TO authenticated USING (es_admin(auth.uid()));

CREATE POLICY reimpresiones_select_cajero ON facturas_fel_reimpresiones
  FOR SELECT TO authenticated USING (impreso_by = auth.uid());

-- No hay policy para INSERT/UPDATE/DELETE -> solo accesible via service_role
-- (que es lo que usa el endpoint server-side). Cualquier intento desde cliente
-- queda rechazado por RLS.
