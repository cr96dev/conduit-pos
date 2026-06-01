-- Migration: mcp_audit_log
-- Fecha: 2026-06-01
-- Proposito: Audit trail inmutable de todas las acciones del MCP (Claude
-- Cowork). Toda llamada a write tools del plugin v0.3+ registra acá su
-- preview (dry_run) y/o ejecucion. Permite a Carlos auditar despues qué
-- hizo Claude, cuándo y con qué argumentos. Sin posibilidad de borrar
-- registros (insert-only por RLS).

CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts                timestamptz NOT NULL DEFAULT now(),

  tool_name         text NOT NULL,        -- ej: 'julia_bancos_importar_extracto'
  arguments         jsonb NOT NULL DEFAULT '{}'::jsonb,
  dry_run           boolean NOT NULL DEFAULT true,

  estado            text NOT NULL CHECK (estado IN ('preview', 'ejecutado', 'fallido', 'rechazado')),
  result            jsonb,                 -- output de la tool (preview o efecto real)
  error             text,                  -- mensaje si fallido

  -- Trazabilidad de impactos:
  filas_afectadas   int,                   -- cuantas filas insert/update/delete
  id_creado         uuid,                  -- id principal creado (factura, asiento, etc.)
  tabla_afectada    text,                  -- 'bancos_movimientos', 'asientos', etc.

  notas             text,
  ip_origen         inet,
  user_agent        text
);

CREATE INDEX IF NOT EXISTS mcp_audit_log_ts_idx    ON mcp_audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS mcp_audit_log_tool_idx  ON mcp_audit_log(tool_name);
CREATE INDEX IF NOT EXISTS mcp_audit_log_estado_idx ON mcp_audit_log(estado);

COMMENT ON TABLE mcp_audit_log IS 'Audit trail inmutable de Claude Cowork MCP. Insert-only via RLS.';
COMMENT ON COLUMN mcp_audit_log.dry_run IS 'true = preview sin ejecutar. false = ejecucion real.';
COMMENT ON COLUMN mcp_audit_log.estado IS 'preview: dry-run sin efecto. ejecutado: aplicado. fallido: error en ejecucion. rechazado: validacion rechazo.';

-- RLS: nadie puede borrar ni modificar. Solo service_role inserta. Authenticated lee.
ALTER TABLE mcp_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mcp_audit_log_insert_service"
  ON mcp_audit_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "mcp_audit_log_select_admin"
  ON mcp_audit_log FOR SELECT
  TO authenticated
  USING (es_admin(auth.uid()));

-- Explicitamente NO hay policies de UPDATE o DELETE.
-- Eso hace el log inmutable incluso para admins.
