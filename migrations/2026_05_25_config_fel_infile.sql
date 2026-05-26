-- Migration: agregar columnas Infile/FEEL a config_fel
-- Fecha: 2026-05-25
-- Proposito:
--   Cambiamos de Digifact a Infile/FEEL como certificador. Infile firma en
--   su propio servicio remoto (signer-emisores.feel.com.gt) — no hace falta
--   manejar certificado X.509 localmente. El flujo es:
--     1. POST a URL_FIRMA con { llave, archivo (xml b64), codigo, alias, es_anulacion }
--     2. POST a URL_CERT con headers usuario/llave/identificador + body { nit_emisor, correo_copia, xml_dte }
--     3. Para consultar receptor: POST a URL_CONSULTA_NIT con { emisor_codigo, emisor_clave, nit_consulta }
--
--   En HidrocomPOS las URLs demo y prod son las mismas — el ambiente se
--   distingue por credencial. Igual guardamos un campo `infile_ambiente`
--   para auditoria, y URLs por columna por si Infile cambia en algun
--   momento.
--
--   Los campos digifact_* se mantienen por compat (no se borran ahora; se
--   limpiaran en una migracion posterior cuando no queden referencias).

ALTER TABLE config_fel
  ADD COLUMN IF NOT EXISTS infile_url_firma         text DEFAULT 'https://signer-emisores.feel.com.gt/sign_solicitud_firmas/firma_xml',
  ADD COLUMN IF NOT EXISTS infile_url_cert          text DEFAULT 'https://certificador.feel.com.gt/fel/certificacion/v2/dte/',
  ADD COLUMN IF NOT EXISTS infile_url_consulta_nit  text DEFAULT 'https://consultareceptores.feel.com.gt/rest/action',
  ADD COLUMN IF NOT EXISTS infile_alias_firma       text,
  ADD COLUMN IF NOT EXISTS infile_llave_firma       text,
  ADD COLUMN IF NOT EXISTS infile_usuario_cert      text,
  ADD COLUMN IF NOT EXISTS infile_llave_cert        text,
  ADD COLUMN IF NOT EXISTS infile_ambiente          text DEFAULT 'demo'
                          CHECK (infile_ambiente IN ('demo','prod'));

COMMENT ON COLUMN config_fel.infile_url_firma        IS 'URL del servicio que firma el XML del DTE (servidor remoto de Infile/FEEL).';
COMMENT ON COLUMN config_fel.infile_url_cert         IS 'URL del certificador SAT de Infile/FEEL.';
COMMENT ON COLUMN config_fel.infile_url_consulta_nit IS 'URL del lookup de NIT receptor (consultareceptores.feel.com.gt).';
COMMENT ON COLUMN config_fel.infile_alias_firma      IS 'Alias/codigo del emisor en el firmador (campo "alias" del request). Tambien sirve como "usuario" en el certificador y como "emisor_codigo" en consulta NIT.';
COMMENT ON COLUMN config_fel.infile_llave_firma      IS 'Llave del servicio de firma. Va en el JSON al firmador.';
COMMENT ON COLUMN config_fel.infile_usuario_cert     IS 'Header "usuario" del certificador. Suele coincidir con infile_alias_firma; configurable por si Infile da distintos.';
COMMENT ON COLUMN config_fel.infile_llave_cert       IS 'Header "llave" del certificador. Tambien sirve como "emisor_clave" en consulta NIT.';
COMMENT ON COLUMN config_fel.infile_ambiente         IS 'Ambiente activo: demo o prod. Solo etiqueta de auditoria — las URLs estan en columnas separadas porque Infile puede cambiarlas.';

-- Backfill: marcar esta migracion como aplicada (DDL se aplica via MCP).
INSERT INTO _schema_migrations (filename, applied_by) VALUES
  ('2026_05_25_config_fel_infile.sql', 'mcp')
ON CONFLICT (filename) DO NOTHING;
