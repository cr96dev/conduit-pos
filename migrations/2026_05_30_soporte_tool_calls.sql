-- Migration: audit de tool calls del agente de soporte
-- Fecha: 2026-05-30
-- Proposito:
--   Cada vez que el agente de soporte (Claude) invoca una tool (buscar
--   factura, consultar nit, reintentar certificacion, etc.), queda registrado
--   en esta tabla. Permite:
--     - Auditar que tools se ejecutan, por que conversacion y por que usuario
--     - Rate limit (max 10 por conversacion, max 30 por hora por usuario)
--     - Debug cuando algo sale mal
--     - Analytics de uso ("la tool X se llama N veces por dia")
--
--   En Fase 1 todas las tools son read-only — no mutan estado. Igual
--   logueamos por uniformidad y para tener historial cuando entremos a
--   Fase 2 (write tools con confirmacion).
--
-- RLS:
--   - SELECT: admin (ve todo). Cajero ve solo sus propias llamadas.
--   - INSERT/UPDATE/DELETE: solo service_role via API server-side.

CREATE TABLE IF NOT EXISTS soporte_tool_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id uuid NOT NULL REFERENCES soporte_conversaciones(id) ON DELETE CASCADE,
  usuario_id      uuid REFERENCES perfiles(id) ON DELETE SET NULL,
  tool_name       text NOT NULL,             -- 'buscar_factura', 'estado_turno_actual', etc.
  tool_input      jsonb NOT NULL,            -- argumentos que Claude paso
  tool_output     jsonb,                     -- resultado devuelto (puede ser error)
  ok              boolean NOT NULL,          -- true si la tool ejecuto sin error
  error_mensaje   text,                      -- si ok=false, detalle
  duracion_ms     int,                       -- cuanto tardo la ejecucion
  ip              text,                      -- IP del cliente, best-effort
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE soporte_tool_calls IS 'Audit de invocaciones de tools por el agente de soporte AI.';
COMMENT ON COLUMN soporte_tool_calls.tool_name IS 'Nombre interno de la tool (ej. buscar_factura). Debe matchear lib/soporte/tools.js.';
COMMENT ON COLUMN soporte_tool_calls.tool_input IS 'JSON con los args que Claude paso. Util para reproducir bugs.';
COMMENT ON COLUMN soporte_tool_calls.tool_output IS 'JSON con lo que la tool devolvio. Si ok=false, contiene info del error.';

CREATE INDEX IF NOT EXISTS soporte_tool_calls_conv_idx
  ON soporte_tool_calls(conversacion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS soporte_tool_calls_user_idx
  ON soporte_tool_calls(usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS soporte_tool_calls_tool_idx
  ON soporte_tool_calls(tool_name, created_at DESC);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE soporte_tool_calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS soporte_tool_calls_select_admin  ON soporte_tool_calls;
DROP POLICY IF EXISTS soporte_tool_calls_select_propio ON soporte_tool_calls;

CREATE POLICY soporte_tool_calls_select_admin ON soporte_tool_calls
  FOR SELECT TO authenticated USING (es_admin(auth.uid()));

CREATE POLICY soporte_tool_calls_select_propio ON soporte_tool_calls
  FOR SELECT TO authenticated USING (usuario_id = auth.uid());

-- INSERT/UPDATE/DELETE: solo service_role (sin policy).
