-- Migration: configuracion + historico de declaraciones IGSS
-- Fecha: 2026-05-21
-- Proposito:
--   El IGSS de Guatemala requiere presentar mensualmente la planilla DR-182-1
--   con cuotas patronal (10.67%), laboral (4.83%), IRTRA (1%) e INTECAP (1%)
--   sobre el salario imponible (sin bonificacion incentivo Q250 de ley exenta).
--
--   El sistema del IGSS recibe un archivo TXT formato v2.2.0 con cabecera del
--   patrono + lineas por empleado por quincena. Necesitamos:
--     1. `config_igss`: datos del patrono editables (1 sola fila).
--     2. `igss_declaraciones`: historico de declaraciones presentadas con
--        snapshot de los totales y referencia al archivo generado.
--
-- RLS: lectura authenticated, escritura admin.

-- =============================================================================
-- config_igss (singleton)
-- =============================================================================

CREATE TABLE IF NOT EXISTS config_igss (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_patronal     text NOT NULL,
  nit_patrono         text NOT NULL,
  nombre_patrono      text NOT NULL,
  direccion           text,
  email_patrono       text,
  codigo_ocupacion    int NOT NULL DEFAULT 5018,   -- 5018 ≈ Panadero (escala IGSS)
  codigo_actividad    text DEFAULT '452001',       -- codigo CIIU
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid REFERENCES auth.users(id)
);

COMMENT ON TABLE config_igss IS 'Datos del patrono para la planilla DR-182-1 del IGSS. Una sola fila. Los IDs/numeros del IGSS van aqui en vez de hardcoded.';

-- =============================================================================
-- igss_declaraciones (historico)
-- =============================================================================

CREATE TABLE IF NOT EXISTS igss_declaraciones (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anio                        int  NOT NULL,
  mes                         int  NOT NULL CHECK (mes BETWEEN 1 AND 12),
  trabajadores                int  NOT NULL DEFAULT 0,
  total_salarios              numeric(14,2) NOT NULL DEFAULT 0,
  cuota_patronal              numeric(14,2) NOT NULL DEFAULT 0,
  cuota_laboral               numeric(14,2) NOT NULL DEFAULT 0,
  irtra                       numeric(14,2) NOT NULL DEFAULT 0,
  intecap                     numeric(14,2) NOT NULL DEFAULT 0,
  total_pagar                 numeric(14,2) NOT NULL DEFAULT 0,

  archivo_txt                 text,                                   -- TXT v2.2.0 generado, para reimprimir
  presentada_at               timestamptz NOT NULL DEFAULT now(),
  presentada_by               uuid REFERENCES auth.users(id),
  pagada_at                   date,
  comprobante_pago_numero     text,
  notas                       text,

  UNIQUE (anio, mes)
);

COMMENT ON TABLE igss_declaraciones IS 'Snapshot de declaraciones IGSS presentadas mes a mes. Guarda el TXT generado para reimprimir o reauditar despues.';

CREATE INDEX IF NOT EXISTS igss_declaraciones_periodo_idx ON igss_declaraciones(anio DESC, mes DESC);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE config_igss          ENABLE ROW LEVEL SECURITY;
ALTER TABLE igss_declaraciones   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_igss_select        ON config_igss;
DROP POLICY IF EXISTS config_igss_write_admin   ON config_igss;
DROP POLICY IF EXISTS igss_decl_select          ON igss_declaraciones;
DROP POLICY IF EXISTS igss_decl_write_admin     ON igss_declaraciones;

CREATE POLICY config_igss_select ON config_igss FOR SELECT TO authenticated USING (true);
CREATE POLICY config_igss_write_admin ON config_igss FOR ALL TO authenticated
  USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));

CREATE POLICY igss_decl_select ON igss_declaraciones FOR SELECT TO authenticated USING (true);
CREATE POLICY igss_decl_write_admin ON igss_declaraciones FOR ALL TO authenticated
  USING (es_admin(auth.uid())) WITH CHECK (es_admin(auth.uid()));
