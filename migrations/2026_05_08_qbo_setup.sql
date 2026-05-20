-- =====================================
-- QBO Integrator - Schema inicial Supabase
-- Hidrocom S.A. / GasOps
-- =====================================
-- Ejecutar en: Supabase Dashboard -> SQL Editor

CREATE TABLE IF NOT EXISTS qbo_tokens (
  id BIGSERIAL PRIMARY KEY,
  realm_id VARCHAR(50) UNIQUE NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qbo_sync_audit (
  id BIGSERIAL PRIMARY KEY,
  fecha_proceso DATE NOT NULL,
  bucket_key VARCHAR(200) UNIQUE NOT NULL,
  estacion VARCHAR(50) NOT NULL,
  categoria VARCHAR(50) NOT NULL,
  customer_type VARCHAR(20) NOT NULL,
  customer_nit VARCHAR(20),
  fel_count INT NOT NULL DEFAULT 0,
  fel_ids JSONB,
  monto_subtotal DECIMAL(15,2) NOT NULL DEFAULT 0,
  monto_iva DECIMAL(15,2) NOT NULL DEFAULT 0,
  monto_total DECIMAL(15,2) NOT NULL DEFAULT 0,
  qbo_sales_receipt_id VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  error_message TEXT,
  attempts INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_status ON qbo_sync_audit(status);
CREATE INDEX IF NOT EXISTS idx_audit_fecha ON qbo_sync_audit(fecha_proceso);
CREATE INDEX IF NOT EXISTS idx_audit_estacion ON qbo_sync_audit(estacion);

CREATE TABLE IF NOT EXISTS qbo_mapping_estaciones (
  estacion_codigo VARCHAR(50) PRIMARY KEY,
  estacion_nombre VARCHAR(100) NOT NULL,
  qbo_class_id VARCHAR(50) NOT NULL,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS qbo_mapping_skus (
  sku VARCHAR(50) PRIMARY KEY,
  descripcion TEXT,
  categoria VARCHAR(50) NOT NULL,
  qbo_item_id VARCHAR(50) NOT NULL,
  qbo_item_name VARCHAR(200),
  iva_rate DECIMAL(5,2) DEFAULT 12.00,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skus_categoria ON qbo_mapping_skus(categoria);

CREATE TABLE IF NOT EXISTS qbo_mapping_customers (
  nit VARCHAR(20) PRIMARY KEY,
  nombre VARCHAR(200) NOT NULL,
  qbo_customer_id VARCHAR(50) NOT NULL,
  qbo_customer_type VARCHAR(20) DEFAULT 'CORPORATE',
  estacion_codigo VARCHAR(50),
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO qbo_mapping_estaciones (estacion_codigo, estacion_nombre, qbo_class_id) VALUES
  ('DIAG6',     'Diagonal 6',      'TBD'),
  ('BRISAS',    'Brisas',          'TBD'),
  ('MIRADOR',   'Mirador',         'TBD'),
  ('QUETZAL',   'Ciudad Quetzal',  'TBD'),
  ('KM7',       'Km 7',            'TBD'),
  ('MATEOFL',   'Mateo Flores',    'TBD'),
  ('PETAPA',    'Petapa',          'TBD'),
  ('SANPED',    'San Pedrito',     'TBD'),
  ('RIVERA',    'Rivera del Rio',  'TBD'),
  ('HINCAPIE',  'Hincapie',        'TBD'),
  ('KM13',      'Km 13',           'TBD'),
  ('SANCRIST',  'San Cristobal',   'TBD'),
  ('CARWASH',   'Carwash GO4',     'TBD')
ON CONFLICT (estacion_codigo) DO NOTHING;

INSERT INTO qbo_mapping_customers (nit, nombre, qbo_customer_id, qbo_customer_type) VALUES
  ('321052', 'UNO Guatemala, S.A.', 'TBD', 'CORPORATE')
ON CONFLICT (nit) DO NOTHING;

INSERT INTO qbo_mapping_customers (nit, nombre, qbo_customer_id, qbo_customer_type, estacion_codigo) VALUES
  ('CF-DIAG6',    'Consumidor Final - Diagonal 6',     'TBD', 'CF_BY_STATION', 'DIAG6'),
  ('CF-BRISAS',   'Consumidor Final - Brisas',         'TBD', 'CF_BY_STATION', 'BRISAS'),
  ('CF-MIRADOR',  'Consumidor Final - Mirador',        'TBD', 'CF_BY_STATION', 'MIRADOR'),
  ('CF-QUETZAL',  'Consumidor Final - Ciudad Quetzal', 'TBD', 'CF_BY_STATION', 'QUETZAL'),
  ('CF-KM7',      'Consumidor Final - Km 7',           'TBD', 'CF_BY_STATION', 'KM7'),
  ('CF-MATEOFL',  'Consumidor Final - Mateo Flores',   'TBD', 'CF_BY_STATION', 'MATEOFL'),
  ('CF-PETAPA',   'Consumidor Final - Petapa',         'TBD', 'CF_BY_STATION', 'PETAPA'),
  ('CF-SANPED',   'Consumidor Final - San Pedrito',    'TBD', 'CF_BY_STATION', 'SANPED'),
  ('CF-RIVERA',   'Consumidor Final - Rivera del Rio', 'TBD', 'CF_BY_STATION', 'RIVERA'),
  ('CF-HINCAPIE', 'Consumidor Final - Hincapie',       'TBD', 'CF_BY_STATION', 'HINCAPIE'),
  ('CF-KM13',     'Consumidor Final - Km 13',          'TBD', 'CF_BY_STATION', 'KM13'),
  ('CF-SANCRIST', 'Consumidor Final - San Cristobal',  'TBD', 'CF_BY_STATION', 'SANCRIST')
ON CONFLICT (nit) DO NOTHING;
