-- Migration: tabla cotizaciones
-- Fecha: 5 jun 2026
-- Proposito: módulo de cotizaciones formales (eventos, catering, mayoristas)
--            con PDF profesional con logo angelito. NO se confunde con
--            facturas FEL — esto es PRE-venta, no fiscal.
--
-- Aplicada en producción vía Supabase MCP el 5 jun. Archivo versionado
-- en git para referencia.

CREATE TABLE IF NOT EXISTS cotizaciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero TEXT,                                       -- COT-YYYY-NNNN, autogenerado
  cliente_nombre TEXT NOT NULL,
  cliente_empresa TEXT,
  cliente_nit TEXT,
  cliente_email TEXT,
  cliente_telefono TEXT,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  validez_dias INT NOT NULL DEFAULT 15,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,          -- [{descripcion,cantidad,precio_unitario,subtotal}]
  subtotal NUMERIC(10,2) NOT NULL DEFAULT 0,
  iva NUMERIC(10,2) NOT NULL DEFAULT 0,
  total NUMERIC(10,2) NOT NULL DEFAULT 0,
  notas TEXT,
  estado TEXT NOT NULL DEFAULT 'borrador'
    CHECK (estado IN ('borrador','enviada','aceptada','rechazada','vencida')),
  creado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cotizaciones_fecha_idx ON cotizaciones(fecha DESC);
CREATE INDEX IF NOT EXISTS cotizaciones_estado_idx ON cotizaciones(estado);

ALTER TABLE cotizaciones ENABLE ROW LEVEL SECURITY;

-- Acceso solo admins (todos los authenticated por simplicidad — en este
-- proyecto los authenticated son admins/cajeros, no clientes finales).
DROP POLICY IF EXISTS cotizaciones_admin_all ON cotizaciones;
CREATE POLICY cotizaciones_admin_all ON cotizaciones
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
