-- Migration: facturacion electronica (FEL) con Digifact
-- Fecha: 2026-05-21
-- Proposito:
--   Modelo de datos para facturas electronicas (DTE) SAT Guatemala.
--   Disenado agnostico al certificador: hoy Digifact, mañana podria ser otro.
--
--   La integracion concreta con Digifact requiere credenciales (token Bearer
--   valido 360 dias) y esquema XML SAT especifico que el proveedor entrega.
--   Mientras tanto, el modulo permite registrar facturas manualmente y
--   marcarlas como "certificadas" cuando llegue el numero de autorizacion SAT.
--
--   Cuando Julia obtenga las credenciales, completar `config_fel` y la
--   integracion en lib/digifact/client.js se activa.
--
-- Tablas:
--   - config_fel              : datos del emisor + credenciales del certificador (singleton)
--   - facturas_fel            : cabecera de factura (DTE)
--   - facturas_fel_items      : lineas de la factura
--
-- RLS: lectura authenticated, escritura admin.

-- =============================================================================
-- config_fel
-- =============================================================================

CREATE TABLE IF NOT EXISTS config_fel (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Datos del emisor (lo que sale en la factura):
  nit_emisor              text NOT NULL,
  nombre_comercial        text NOT NULL,
  razon_social            text,
  direccion               text,
  codigo_postal           text DEFAULT '01010',
  municipio               text DEFAULT 'GUATEMALA',
  departamento            text DEFAULT 'GUATEMALA',
  pais                    text DEFAULT 'GT',
  afiliacion_iva          text DEFAULT 'GEN',           -- 'GEN' | 'PEQ' | 'EXE'
  codigo_establecimiento  int  NOT NULL DEFAULT 1,
  email_emisor            text,
  telefono_emisor         text,

  -- Credenciales Digifact (cuando se obtengan):
  digifact_url_base       text DEFAULT 'https://fel.digifact.com.gt/api/',
  digifact_token          text,                          -- Bearer, valido 360 dias
  digifact_token_vence    date,
  digifact_usuario        text,                          -- usuario API (si aplica)
  digifact_ambiente       text DEFAULT 'test' CHECK (digifact_ambiente IN ('test','produccion')),

  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE config_fel IS 'Datos del emisor + credenciales del certificador FEL. Una sola fila. El token Digifact se guarda en claro: rotar cada 360 dias y proteger via RLS (solo admin lee/escribe).';

-- =============================================================================
-- facturas_fel
-- =============================================================================

CREATE TABLE IF NOT EXISTS facturas_fel (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Receptor (cliente):
  receptor_nit                text NOT NULL DEFAULT 'CF',    -- 'CF' = consumidor final
  receptor_nombre             text NOT NULL,
  receptor_direccion          text,
  receptor_email              text,

  -- DTE:
  tipo_documento              text NOT NULL DEFAULT 'FACT'
                                CHECK (tipo_documento IN ('FACT','FCAM','FPEQ','FCAP','FESP','NABN','RDON','RECI','NDEB','NCRE')),
  serie                       text,                          -- serie autorizada al certificarse
  numero                      int,                           -- correlativo del certificador
  fecha_emision               timestamptz NOT NULL DEFAULT now(),
  moneda                      text NOT NULL DEFAULT 'GTQ',
  frase_iva                   text DEFAULT '1',              -- '1' = afecta IVA, '4' = exento, etc.
  escenario_iva               int  DEFAULT 1,

  -- Montos calculados:
  total_gravado               numeric(14,2) NOT NULL DEFAULT 0,
  total_exento                numeric(14,2) NOT NULL DEFAULT 0,
  iva                         numeric(14,2) NOT NULL DEFAULT 0,
  total                       numeric(14,2) NOT NULL DEFAULT 0,

  -- Certificacion SAT:
  estado                      text NOT NULL DEFAULT 'borrador'
                                CHECK (estado IN ('borrador','certificada','anulada','error')),
  uuid_sat                    text,                          -- numero de autorizacion devuelto por SAT
  serie_sat                   text,                          -- serie devuelta
  numero_sat                  text,                          -- correlativo SAT
  fecha_certificacion         timestamptz,
  certificador                text DEFAULT 'digifact',
  xml_dte                     text,                          -- XML firmado/certificado (para reimprimir)
  pdf_url                     text,                          -- URL al PDF descargable
  error_mensaje               text,                          -- si estado=error, detalle del fallo

  -- Anulacion:
  fecha_anulacion             timestamptz,
  motivo_anulacion            text,
  anulada_por                 uuid REFERENCES auth.users(id),

  -- Origen / enganche a contabilidad:
  origen_tipo                 text,                          -- 'venta_loyverse' | 'manual' | etc.
  origen_id                   uuid,
  asiento_id                  uuid REFERENCES asientos(id) ON DELETE SET NULL,

  notas                       text,
  creado_por                  uuid REFERENCES auth.users(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE facturas_fel IS 'Facturas electronicas (DTE). Estados: borrador (no certificada), certificada (con UUID SAT), anulada, error.';
COMMENT ON COLUMN facturas_fel.tipo_documento IS 'Codigo SAT: FACT=Factura, FCAM=Factura cambiaria, FPEQ=Pequeño contribuyente, NDEB=Nota debito, NCRE=Nota credito, etc.';

CREATE INDEX IF NOT EXISTS facturas_fel_estado_idx  ON facturas_fel(estado);
CREATE INDEX IF NOT EXISTS facturas_fel_fecha_idx   ON facturas_fel(fecha_emision DESC);
CREATE INDEX IF NOT EXISTS facturas_fel_uuid_idx    ON facturas_fel(uuid_sat);
CREATE INDEX IF NOT EXISTS facturas_fel_origen_idx  ON facturas_fel(origen_tipo, origen_id);

-- =============================================================================
-- facturas_fel_items
-- =============================================================================

CREATE TABLE IF NOT EXISTS facturas_fel_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id      uuid NOT NULL REFERENCES facturas_fel(id) ON DELETE CASCADE,
  bien_o_servicio text NOT NULL DEFAULT 'B' CHECK (bien_o_servicio IN ('B','S')),  -- B=Bien, S=Servicio
  descripcion     text NOT NULL,
  unidad_medida   text DEFAULT 'UND',
  cantidad        numeric(14,3) NOT NULL,
  precio_unitario numeric(14,4) NOT NULL,
  descuento       numeric(14,2) NOT NULL DEFAULT 0,
  subtotal        numeric(14,2) NOT NULL,           -- cantidad*precio - descuento
  afecta_iva      boolean NOT NULL DEFAULT true,
  orden           int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS facturas_fel_items_factura_idx ON facturas_fel_items(factura_id);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE config_fel          ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas_fel        ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas_fel_items  ENABLE ROW LEVEL SECURITY;

-- config_fel: SOLO admin lee/escribe (contiene token sensible).
DROP POLICY IF EXISTS config_fel_admin ON config_fel;
CREATE POLICY config_fel_admin ON config_fel FOR ALL TO authenticated
  USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));

DROP POLICY IF EXISTS facturas_fel_select        ON facturas_fel;
DROP POLICY IF EXISTS facturas_fel_write_admin   ON facturas_fel;
DROP POLICY IF EXISTS facturas_items_select      ON facturas_fel_items;
DROP POLICY IF EXISTS facturas_items_write_admin ON facturas_fel_items;

CREATE POLICY facturas_fel_select      ON facturas_fel       FOR SELECT TO authenticated USING (true);
CREATE POLICY facturas_fel_write_admin ON facturas_fel       FOR ALL    TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
CREATE POLICY facturas_items_select    ON facturas_fel_items FOR SELECT TO authenticated USING (true);
CREATE POLICY facturas_items_write_admin ON facturas_fel_items FOR ALL TO authenticated USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
