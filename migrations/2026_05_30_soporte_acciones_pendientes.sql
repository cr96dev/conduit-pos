-- Migration: acciones pendientes de confirmacion del agente de soporte
-- Fecha: 2026-05-30 (Fase 2)
-- Proposito:
--   Cuando Claude invoca una WRITE tool (reimprimir, reintentar cert, anular,
--   etc.), no la ejecutamos inmediatamente. Creamos una fila aqui con estado
--   'pendiente', Claude le explica al usuario en lenguaje natural que va a
--   hacer, y la UI muestra botones [Confirmar] / [Cancelar].
--
--   El usuario tap Confirmar -> el endpoint /api/soporte/acciones/:id/confirmar
--   ejecuta la accion real (delegando al endpoint que ya existe — ej.
--   /api/fel/facturas/:id/reimprimir) y luego inserta un nuevo mensaje
--   assistant con el resultado.
--
--   TTL: 5 minutos. Si pasa eso sin confirmar, queda 'expirada' y la UI
--   deshabilita los botones.
--
-- RLS:
--   - SELECT/UPDATE: usuario que la genero (debe matchear usuario_id) o admin.
--   - INSERT/DELETE: solo service_role.

CREATE TABLE IF NOT EXISTS soporte_acciones_pendientes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id uuid NOT NULL REFERENCES soporte_conversaciones(id) ON DELETE CASCADE,
  usuario_id      uuid NOT NULL REFERENCES perfiles(id) ON DELETE CASCADE,
  tool_name       text NOT NULL,             -- 'reimprimir_factura', 'reintentar_certificar', etc.
  tool_input      jsonb NOT NULL,            -- args originales que Claude paso
  resumen         text NOT NULL,             -- "Reimprimir factura 38E8B612-2774486727 (cliente perdio el ticket)"

  estado          text NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','confirmada','rechazada','expirada','error')),
  resultado       jsonb,                     -- lo que devolvio la accion real (si se ejecuto)
  error_mensaje   text,                      -- si estado=error, detalle

  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  resolved_at     timestamptz                -- cuando paso a confirmada/rechazada/expirada/error
);

COMMENT ON TABLE  soporte_acciones_pendientes IS 'Acciones de escritura que Claude propuso y esperan confirmacion del usuario.';
COMMENT ON COLUMN soporte_acciones_pendientes.tool_name IS 'Tool registrada en lib/soporte/tools.js. Determina que endpoint se invoca al confirmar.';
COMMENT ON COLUMN soporte_acciones_pendientes.resumen   IS 'Texto que la UI muestra (no es el JSON crudo, es lo que el cajero va a leer).';
COMMENT ON COLUMN soporte_acciones_pendientes.estado    IS 'pendiente=esperando confirmar; confirmada=usuario tap Confirmar y la accion corrio OK; rechazada=usuario tap Cancelar; expirada=paso el TTL; error=intento ejecutar pero fallo.';

CREATE INDEX IF NOT EXISTS soporte_acciones_pend_conv_idx
  ON soporte_acciones_pendientes(conversacion_id, created_at DESC);
CREATE INDEX IF NOT EXISTS soporte_acciones_pend_user_idx
  ON soporte_acciones_pendientes(usuario_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS soporte_acciones_pend_estado_idx
  ON soporte_acciones_pendientes(estado, expires_at);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE soporte_acciones_pendientes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS soporte_acc_select_propio ON soporte_acciones_pendientes;
DROP POLICY IF EXISTS soporte_acc_select_admin  ON soporte_acciones_pendientes;
DROP POLICY IF EXISTS soporte_acc_update_propio ON soporte_acciones_pendientes;

CREATE POLICY soporte_acc_select_propio ON soporte_acciones_pendientes
  FOR SELECT TO authenticated USING (usuario_id = auth.uid());
CREATE POLICY soporte_acc_select_admin ON soporte_acciones_pendientes
  FOR SELECT TO authenticated USING (es_admin(auth.uid()));
CREATE POLICY soporte_acc_update_propio ON soporte_acciones_pendientes
  FOR UPDATE TO authenticated USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

-- INSERT/DELETE solo via service_role.
