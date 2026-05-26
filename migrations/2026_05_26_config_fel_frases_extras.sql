-- Migration: config_fel.infile_frases_extras
-- Fecha: 2026-05-26
-- Proposito:
--   Algunos emisores tienen regímenes tributarios especiales que SAT exige
--   declarar como Frases adicionales en el DTE (ej. Agente de Retención del
--   IVA → Tipo=2 además del Tipo=1 base de IVA). Sin la frase, el
--   certificador rechaza con error 2615 "FEL-GUI-30 2.6.1 No.5".
--
--   Guardamos las frases extra por emisor en este campo. El cliente Infile
--   las concatena despues de la Frase Tipo 1 base al armar el XML.
--
--   Ejemplo: emisor agente de retencion del IVA →
--     [{"escenario": 1, "tipo": 2}]
--   Para un emisor regular (caso normal de Julia), queda en [] y solo se
--   emite la Frase Tipo 1.
--
--   DDL aplicado en prod via MCP — este archivo queda como tracking.

ALTER TABLE config_fel
  ADD COLUMN IF NOT EXISTS infile_frases_extras jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN config_fel.infile_frases_extras IS 'Frases SAT adicionales que el emisor tiene que declarar. Array de objetos {escenario:int, tipo:int}. Se agregan despues de la Frase Tipo 1 base de IVA. Vacio = solo Tipo 1 (caso normal).';

INSERT INTO _schema_migrations (filename, applied_by) VALUES
  ('2026_05_26_config_fel_frases_extras.sql', 'mcp')
ON CONFLICT (filename) DO NOTHING;
