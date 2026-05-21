-- Migration: compras a proveedores
-- Fecha: 2026-05-21
-- Proposito:
--   1. Catalogo de proveedores (manual, no integrado a ninguna API externa).
--   2. Compras (cabecera) con flujo borrador -> recibida -> anulada.
--      Mientras esta en 'borrador' se puede editar libremente.
--      Al pasar a 'recibida' se generan los movimientos de entrada en
--      insumos_movimientos (atomicamente, via API).
--      Anular una recibida revierte con ajustes negativos.
--   3. Lineas de compra. insumo_id es OPCIONAL: a veces se compran
--      cosas que no son insumos (suministros, equipo) y solo se quieren
--      registrar para contabilidad.
--
-- Convenciones:
--   - Montos numeric(14,2). IVA opcional, default 0.
--   - RLS: lectura authenticated, escritura admin (consistente con [[roadmap-paridad]]).

-- =============================================================================
-- proveedores
-- =============================================================================

CREATE TABLE IF NOT EXISTS proveedores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text NOT NULL,
  nit             text,                          -- NIT GT (puede ser 'CF' o nulo)
  telefono        text,
  email           text,
  direccion       text,
  contacto        text,                          -- nombre del vendedor/contacto
  notas           text,
  activo          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE proveedores IS 'Catalogo de proveedores. NIT puede ser CF o nulo para proveedores informales/mercado.';

CREATE INDEX IF NOT EXISTS proveedores_activo_idx ON proveedores(activo);
CREATE UNIQUE INDEX IF NOT EXISTS proveedores_nombre_unique_idx ON proveedores(lower(nombre)) WHERE activo = true;

-- =============================================================================
-- compras (cabecera)
-- =============================================================================

CREATE TABLE IF NOT EXISTS compras (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id    uuid REFERENCES proveedores(id) ON DELETE RESTRICT,
  numero_factura  text,                          -- numero de la factura del proveedor
  serie_factura   text,                          -- serie (cuando aplique FEL)
  fecha           date NOT NULL DEFAULT CURRENT_DATE,
  estado          text NOT NULL DEFAULT 'borrador'
                    CHECK (estado IN ('borrador', 'recibida', 'anulada')),
  subtotal        numeric(14,2) NOT NULL DEFAULT 0,
  iva             numeric(14,2) NOT NULL DEFAULT 0,
  total           numeric(14,2) NOT NULL DEFAULT 0,
  metodo_pago     text,                          -- 'efectivo' | 'transferencia' | 'cheque' | 'credito' | ...
  notas           text,
  recibida_at     timestamptz,                   -- timestamp de cuando se confirmo recepcion
  recibida_by     uuid REFERENCES auth.users(id),
  anulada_at      timestamptz,
  anulada_by      uuid REFERENCES auth.users(id),
  anulada_motivo  text,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE compras IS 'Cabecera de compras a proveedores. El flujo borrador->recibida->anulada se controla en la API; pasar a recibida dispara entradas a insumos_movimientos.';

CREATE INDEX IF NOT EXISTS compras_proveedor_idx ON compras(proveedor_id);
CREATE INDEX IF NOT EXISTS compras_fecha_idx     ON compras(fecha DESC);
CREATE INDEX IF NOT EXISTS compras_estado_idx    ON compras(estado);

-- =============================================================================
-- compras_lineas
-- =============================================================================

CREATE TABLE IF NOT EXISTS compras_lineas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  compra_id       uuid NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  insumo_id       uuid REFERENCES insumos(id) ON DELETE RESTRICT,
  descripcion     text NOT NULL,                 -- siempre poblada: para items sin insumo, es el detalle libre
  cantidad        numeric(14,3) NOT NULL,
  costo_unitario  numeric(14,4) NOT NULL,
  subtotal        numeric(14,2) NOT NULL,        -- cantidad * costo_unitario (calculado por la API)
  unidad          text,                          -- 'kg', 'unidad', etc. (snapshot del momento)
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE compras_lineas IS 'Lineas de compra. insumo_id opcional: si esta, al recibir la compra se genera movimiento de entrada y se actualiza el costo del insumo.';

CREATE INDEX IF NOT EXISTS compras_lineas_compra_idx ON compras_lineas(compra_id);
CREATE INDEX IF NOT EXISTS compras_lineas_insumo_idx ON compras_lineas(insumo_id);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE proveedores      ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras          ENABLE ROW LEVEL SECURITY;
ALTER TABLE compras_lineas   ENABLE ROW LEVEL SECURITY;

-- proveedores: lectura authenticated, escritura admin
DROP POLICY IF EXISTS proveedores_select ON proveedores;
CREATE POLICY proveedores_select ON proveedores
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS proveedores_write_admin ON proveedores;
CREATE POLICY proveedores_write_admin ON proveedores
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));

-- compras: lectura authenticated, escritura admin
DROP POLICY IF EXISTS compras_select ON compras;
CREATE POLICY compras_select ON compras
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS compras_write_admin ON compras;
CREATE POLICY compras_write_admin ON compras
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));

-- compras_lineas: igual
DROP POLICY IF EXISTS compras_lineas_select ON compras_lineas;
CREATE POLICY compras_lineas_select ON compras_lineas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS compras_lineas_write_admin ON compras_lineas;
CREATE POLICY compras_lineas_write_admin ON compras_lineas
  FOR ALL TO authenticated
  USING (es_admin(auth.uid()))
  WITH CHECK (es_admin(auth.uid()));
