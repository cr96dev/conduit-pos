-- Migration: facturas_fel_pagos
-- Fecha:     2026-05-30
-- Proposito: Soportar split payments (pagos multiples por factura).
--
-- Modelo:
--   - facturas_fel sigue siendo UNA factura por venta, con total = monto total.
--     Esa factura se manda a SAT/Infile sin importar como se pago — SAT no
--     necesita conocer el desglose, solo el monto.
--   - facturas_fel.metodo_pago pasa a ser 'mixto' (literal) cuando hay >1 pago
--     registrado en facturas_fel_pagos. Si hay solo 1 pago (o ninguno) sigue
--     siendo el metodo unico legacy ('efectivo' | 'tarjeta' | ...).
--   - facturas_fel_pagos guarda el desglose interno: que parte fue efectivo,
--     que parte tarjeta, etc. Solo se usa para reportes internos (cierre de
--     turno, dashboard, conciliacion).
--
-- Convivencia con datos legacy:
--   - Facturas viejas no tienen filas en facturas_fel_pagos: el helper de
--     turnos lee facturas_fel.metodo_pago directo (comportamiento actual).
--   - Facturas nuevas con split payments: helper suma facturas_fel_pagos.
--     Si metodo_pago='mixto' pero no hay filas (no deberia pasar), cae a 'otro'.
--
-- Reglas:
--   - SUM(facturas_fel_pagos.monto) WHERE factura_id=X debe igualar
--     facturas_fel.total (validado por trigger).
--   - metodo puede ser cualquiera de los enum estandar.

CREATE TABLE IF NOT EXISTS facturas_fel_pagos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id      UUID NOT NULL REFERENCES facturas_fel(id) ON DELETE CASCADE,

  metodo          TEXT NOT NULL
                  CHECK (metodo IN ('efectivo', 'tarjeta', 'transferencia', 'pedidos_ya', 'otro')),
  monto           NUMERIC(12,2) NOT NULL CHECK (monto > 0),

  -- Referencia opcional (numero de voucher tarjeta, ref transferencia, etc).
  referencia      TEXT,
  notas           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES perfiles(id)
);

CREATE INDEX IF NOT EXISTS facturas_fel_pagos_factura_idx
  ON facturas_fel_pagos(factura_id);
CREATE INDEX IF NOT EXISTS facturas_fel_pagos_metodo_idx
  ON facturas_fel_pagos(metodo, created_at);

-- Permitir 'mixto' en facturas_fel.metodo_pago. La tabla original tiene un
-- CHECK constraint que solo acepta los 5 metodos legacy. Lo ampliamos.
-- Nota: si la constraint no existe (db nueva), este DO no falla.
DO $$
BEGIN
  -- Buscar y eliminar la constraint vieja por nombre dinamico
  EXECUTE (
    SELECT 'ALTER TABLE facturas_fel DROP CONSTRAINT ' || quote_ident(conname)
    FROM pg_constraint
    WHERE conrelid = 'facturas_fel'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%metodo_pago%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN
  -- no existia, ignorar
  NULL;
END $$;

-- Re-crear con 'mixto' incluido
ALTER TABLE facturas_fel
  ADD CONSTRAINT facturas_fel_metodo_pago_check
  CHECK (metodo_pago IN ('efectivo','tarjeta','transferencia','pedidos_ya','otro','mixto'));

-- RLS
ALTER TABLE facturas_fel_pagos ENABLE ROW LEVEL SECURITY;

-- SELECT: cualquier authenticated. La info no es sensible (solo monto + metodo
-- por factura) y los reportes de turno necesitan leerla.
DROP POLICY IF EXISTS facturas_fel_pagos_select ON facturas_fel_pagos;
CREATE POLICY facturas_fel_pagos_select
  ON facturas_fel_pagos FOR SELECT TO authenticated
  USING (true);

-- INSERT: cajero o admin. Tipicamente lo hace el endpoint /api/pos/ventas
-- con admin client (service role bypasea RLS), pero dejamos la policy por si
-- algun dia se llama desde el front.
DROP POLICY IF EXISTS facturas_fel_pagos_insert ON facturas_fel_pagos;
CREATE POLICY facturas_fel_pagos_insert
  ON facturas_fel_pagos FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM perfiles
      WHERE id = auth.uid() AND rol IN ('admin','cajero','empleado')
    )
  );

-- UPDATE/DELETE solo admin (auditoria: no se modifican pagos al voleo)
DROP POLICY IF EXISTS facturas_fel_pagos_admin_update ON facturas_fel_pagos;
CREATE POLICY facturas_fel_pagos_admin_update
  ON facturas_fel_pagos FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM perfiles WHERE id = auth.uid() AND rol = 'admin'))
  WITH CHECK (true);

DROP POLICY IF EXISTS facturas_fel_pagos_admin_delete ON facturas_fel_pagos;
CREATE POLICY facturas_fel_pagos_admin_delete
  ON facturas_fel_pagos FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM perfiles WHERE id = auth.uid() AND rol = 'admin'));

COMMENT ON TABLE facturas_fel_pagos IS
  'Desglose de pagos cuando una factura se cobra con multiples metodos. Solo para reportes internos — SAT recibe el total unico.';
COMMENT ON COLUMN facturas_fel_pagos.metodo IS
  'Uno de: efectivo | tarjeta | transferencia | pedidos_ya | otro';
COMMENT ON COLUMN facturas_fel_pagos.referencia IS
  'Numero de voucher tarjeta, referencia transferencia, etc. Opcional.';
