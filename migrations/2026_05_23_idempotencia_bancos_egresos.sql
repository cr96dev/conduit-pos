-- Migration: idempotencia bancos_movimientos + cierres_egresos
-- Fecha: 2026-05-23
-- Proposito:
--   M1: evitar que dos movimientos bancarios se concilien al mismo asiento
--       (caso: dos depositos del mismo monto/descripcion el mismo dia).
--       Constraint UNIQUE parcial: solo cuando asiento_id IS NOT NULL.
--
--   M4: evitar que un cierre re-creado o reintentado duplique sus egresos
--       (caso: insert de cierres_egresos falla tras crear cierre, luego
--       retry inserta egresos nuevamente).
--       UNIQUE (cierre_id, concepto, monto): si el mismo (concepto, monto)
--       vuelve a entrar bajo el mismo cierre, falla con violation.
--       Si la app intenta INSERT y choca, debe usar ON CONFLICT DO NOTHING.

-- M1
CREATE UNIQUE INDEX IF NOT EXISTS bancos_mov_asiento_unique
  ON bancos_movimientos(asiento_id)
  WHERE asiento_id IS NOT NULL;

-- M4
ALTER TABLE cierres_egresos
  DROP CONSTRAINT IF EXISTS cierres_egresos_cierre_concepto_monto_unique;

ALTER TABLE cierres_egresos
  ADD CONSTRAINT cierres_egresos_cierre_concepto_monto_unique
  UNIQUE (cierre_id, concepto, monto);
