-- Migration: pedidos_pendientes
-- Fecha:     2026-05-30
-- Proposito: Bandeja de pedidos armados en POS pero pendientes de facturar.
--
-- Caso de uso principal:
--   Llega un pedido por la app de Pedidos Ya. El cajero lo arma en el POS
--   (toca productos, define cliente/referencia, agrega notas) y lo guarda
--   como 'pendiente_entrega'. Cuando el driver llega a recoger el pedido
--   fisicamente, cualquier cajero del turno abre el pedido, confirma items
--   (puede ajustar si el driver no lleva algo) y lo factura. Hasta ese
--   momento no existe factura FEL.
--
-- Por que asi (no facturar en cuanto llega el pedido):
--   - Fecha de la factura = fecha real de salida del producto, no del pedido.
--   - Si Pedidos Ya cancela antes de despachar, no quedan facturas fantasma
--     que haya que anular en SAT.
--   - El cajero puede ajustar items reales entregados (driver dice "no llevo
--     el postre porque ya no hay") antes de facturar.
--
-- Acceso (RLS): cualquier cajero o admin autenticado ve y maneja todos los
-- pedidos. Filtramos por turno_id desde la query del front (no en RLS) para
-- que admin pueda revisar historico de cualquier turno cuando quiera.

CREATE TABLE IF NOT EXISTS pedidos_pendientes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  turno_id            UUID REFERENCES turnos_caja(id) ON DELETE SET NULL,
  cajero_creador      UUID REFERENCES perfiles(id) ON DELETE SET NULL,
  cajero_que_facturo  UUID REFERENCES perfiles(id),

  -- Identificacion del pedido. Texto libre: "Pedidos Ya #4521", "Juan",
  -- "Para llevar #2". Lo elige el cajero al guardar.
  referencia          TEXT,

  -- Origen del pedido. Casi siempre 'pedidos_ya' pero dejamos abierto para
  -- futuros canales (Uber Eats, telefono, walk-in para reservas, etc).
  origen              TEXT DEFAULT 'pedidos_ya',

  -- Items snapshot — mismo shape que el body de POST /api/pos/ventas.
  --   [{ variant_id, descripcion, cantidad, precio_unitario,
  --      notas?, descuenta_insumos?, receta_id?, unidad_medida? }, ...]
  items               JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_estimado      NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Receptor sugerido (default CF, pero el cajero puede setear NIT al guardar
  -- el pedido si el cliente ya lo dio). Se respeta al facturar.
  receptor_nit        TEXT DEFAULT 'CF',
  receptor_nombre     TEXT DEFAULT 'CONSUMIDOR FINAL',
  receptor_email      TEXT,

  estado              TEXT NOT NULL DEFAULT 'pendiente_entrega'
                      CHECK (estado IN ('pendiente_entrega', 'entregado_facturado', 'cancelado')),

  -- Si se factura, queda vinculado. Si Pedidos Ya cancela antes, motivo_cancelacion explica.
  factura_id          UUID REFERENCES facturas_fel(id) ON DELETE SET NULL,
  motivo_cancelacion  TEXT,

  notas               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  facturado_at        TIMESTAMPTZ,
  cancelado_at        TIMESTAMPTZ
);

-- Index: bandeja del turno actual ordenada por antiguedad (primero los mas viejos)
CREATE INDEX IF NOT EXISTS pedidos_pendientes_turno_estado_idx
  ON pedidos_pendientes(turno_id, estado, created_at);

-- Index: historico por estado
CREATE INDEX IF NOT EXISTS pedidos_pendientes_estado_idx
  ON pedidos_pendientes(estado, created_at DESC);

-- Trigger updated_at automatico (mismo patron que otras tablas)
CREATE OR REPLACE FUNCTION pedidos_pendientes_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pedidos_pendientes_updated_at_trg ON pedidos_pendientes;
CREATE TRIGGER pedidos_pendientes_updated_at_trg
  BEFORE UPDATE ON pedidos_pendientes
  FOR EACH ROW EXECUTE FUNCTION pedidos_pendientes_touch_updated_at();

-- RLS
ALTER TABLE pedidos_pendientes ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier authenticated. El front filtra por turno o estado.
-- Esto permite que un admin vea historico completo y que cualquier cajero
-- del turno vea la bandeja sin gymnastics extra.
DROP POLICY IF EXISTS pedidos_pendientes_select ON pedidos_pendientes;
CREATE POLICY pedidos_pendientes_select
  ON pedidos_pendientes FOR SELECT TO authenticated
  USING (true);

-- INSERT: cajero o admin. cajero_creador debe ser auth.uid() (no se puede
-- crear "en nombre de otro").
DROP POLICY IF EXISTS pedidos_pendientes_insert ON pedidos_pendientes;
CREATE POLICY pedidos_pendientes_insert
  ON pedidos_pendientes FOR INSERT TO authenticated
  WITH CHECK (
    cajero_creador = auth.uid()
    AND EXISTS (
      SELECT 1 FROM perfiles
      WHERE id = auth.uid() AND rol IN ('admin','cajero','empleado')
    )
  );

-- UPDATE: cajero o admin. Permite facturar, cancelar, editar items.
-- (El endpoint de facturar valida ademas que estado='pendiente_entrega'.)
DROP POLICY IF EXISTS pedidos_pendientes_update ON pedidos_pendientes;
CREATE POLICY pedidos_pendientes_update
  ON pedidos_pendientes FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM perfiles
      WHERE id = auth.uid() AND rol IN ('admin','cajero','empleado')
    )
  )
  WITH CHECK (true);

-- NO DELETE policy: para auditoria, los cancelados quedan con estado='cancelado'
-- pero nunca se borran fisicamente.

COMMENT ON TABLE pedidos_pendientes IS
  'Bandeja de pedidos POS sin facturar (principalmente ordenes de Pedidos Ya). Se facturan cuando el driver recoge el producto.';
COMMENT ON COLUMN pedidos_pendientes.referencia IS
  'Texto libre del cajero: "Pedidos Ya #4521", nombre del cliente, etc.';
COMMENT ON COLUMN pedidos_pendientes.origen IS
  'Canal del pedido: pedidos_ya | uber | telefono | walkin';
COMMENT ON COLUMN pedidos_pendientes.items IS
  'Snapshot de items con mismo shape que body de /api/pos/ventas. Editable hasta facturar.';
COMMENT ON COLUMN pedidos_pendientes.estado IS
  'pendiente_entrega = esperando que el driver recoja. entregado_facturado = factura emitida (factura_id apunta). cancelado = Pedidos Ya cancelo o cajero descarto.';
