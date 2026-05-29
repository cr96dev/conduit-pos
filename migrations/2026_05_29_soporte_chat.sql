-- Migration: soporte tecnico in-app (chat con Claude)
-- Fecha: 2026-05-29
-- Proposito:
--   Burbuja de chat en /pos donde el cajero puede preguntar dudas o
--   reportar fallas. Las respuestas las da Claude (haiku-4-5) con
--   contexto operativo (turno, carrito, errores recientes).
--   Persiste cada conversacion y mensaje para auditoria y para que el
--   admin pueda detectar bugs recurrentes.

-- =============================================================================
-- soporte_conversaciones
-- =============================================================================

CREATE TABLE IF NOT EXISTS soporte_conversaciones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cajero_id       uuid REFERENCES perfiles(id),
  turno_id        uuid REFERENCES turnos_caja(id) ON DELETE SET NULL,
  asunto          text,                            -- detectado del primer mensaje
  estado          text NOT NULL DEFAULT 'abierta'
                    CHECK (estado IN ('abierta','resuelta','escalada','archivada')),
  contexto_inicial jsonb DEFAULT '{}'::jsonb,      -- snapshot del estado al abrir
  resuelta_at     timestamptz,
  resuelta_por    uuid REFERENCES perfiles(id),
  notas_admin     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS soporte_conv_cajero_idx ON soporte_conversaciones(cajero_id);
CREATE INDEX IF NOT EXISTS soporte_conv_estado_idx ON soporte_conversaciones(estado) WHERE estado = 'abierta';
CREATE INDEX IF NOT EXISTS soporte_conv_fecha_idx  ON soporte_conversaciones(created_at DESC);

-- =============================================================================
-- soporte_mensajes
-- =============================================================================

CREATE TABLE IF NOT EXISTS soporte_mensajes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id uuid NOT NULL REFERENCES soporte_conversaciones(id) ON DELETE CASCADE,
  rol             text NOT NULL CHECK (rol IN ('user','assistant','system')),
  contenido       text NOT NULL,
  contexto        jsonb DEFAULT '{}'::jsonb,
  tokens_input    int,
  tokens_output   int,
  modelo          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS soporte_msg_conv_idx ON soporte_mensajes(conversacion_id, created_at);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE soporte_conversaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE soporte_mensajes       ENABLE ROW LEVEL SECURITY;

-- Cajero ve solo las suyas; admin ve todas
DROP POLICY IF EXISTS soporte_conv_select ON soporte_conversaciones;
CREATE POLICY soporte_conv_select ON soporte_conversaciones
  FOR SELECT TO authenticated
  USING (es_admin(auth.uid()) OR cajero_id = auth.uid());

DROP POLICY IF EXISTS soporte_conv_insert ON soporte_conversaciones;
CREATE POLICY soporte_conv_insert ON soporte_conversaciones
  FOR INSERT TO authenticated
  WITH CHECK (cajero_id = auth.uid() OR es_admin(auth.uid()));

DROP POLICY IF EXISTS soporte_conv_update ON soporte_conversaciones;
CREATE POLICY soporte_conv_update ON soporte_conversaciones
  FOR UPDATE TO authenticated
  USING (es_admin(auth.uid()) OR cajero_id = auth.uid())
  WITH CHECK (es_admin(auth.uid()) OR cajero_id = auth.uid());

DROP POLICY IF EXISTS soporte_msg_select ON soporte_mensajes;
CREATE POLICY soporte_msg_select ON soporte_mensajes
  FOR SELECT TO authenticated
  USING (
    es_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM soporte_conversaciones c
      WHERE c.id = conversacion_id AND c.cajero_id = auth.uid()
    )
  );

-- INSERT solo via API (service_role); no exponemos a authenticated direct

-- Realtime para futuro admin que ve chats en vivo
ALTER PUBLICATION supabase_realtime ADD TABLE soporte_mensajes;
ALTER PUBLICATION supabase_realtime ADD TABLE soporte_conversaciones;
