-- Migration: agregar campo es_kiosko a perfiles
-- Fecha: 2026-06-01
-- Proposito: marcar cajeros que son terminales kiosko (K2 Mini autoservicio).
--            El POS detecta este flag y oculta metodo de pago "efectivo" +
--            bandeja de pedidos pendientes (no aplican en autoservicio).
--
-- Sin cambios de RLS: ya existen politicas sobre perfiles (gestionadas por
-- migraciones previas). El campo es metadata leida por el POS.

ALTER TABLE perfiles
  ADD COLUMN IF NOT EXISTS es_kiosko boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN perfiles.es_kiosko IS
  'true = este perfil/cajero representa un kiosko de autoservicio (K2 Mini). El POS oculta efectivo y bandeja Pedidos Ya cuando este flag esta encendido.';
