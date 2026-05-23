-- Migration: restringir SELECT de tablas sensibles a es_admin
-- Fecha: 2026-05-23
-- Proposito:
--   Las policies SELECT existentes son USING (true) para `authenticated`.
--   Eso permite a cualquier usuario logueado leer salarios, asientos y
--   movimientos bancarios. Los API routes server-side usan auth.admin
--   (service_role) y bypassan RLS, asi que el front sigue funcionando.
--   Cero referencias directas desde paginas/componentes (verificado).

-- empleados, planillas, planilla_lineas, liquidaciones: tabla planilla
DROP POLICY IF EXISTS empleados_select          ON empleados;
CREATE POLICY empleados_select          ON empleados          FOR SELECT TO authenticated USING (es_admin(auth.uid()));

DROP POLICY IF EXISTS planillas_select          ON planillas;
CREATE POLICY planillas_select          ON planillas          FOR SELECT TO authenticated USING (es_admin(auth.uid()));

DROP POLICY IF EXISTS planilla_lineas_select    ON planilla_lineas;
CREATE POLICY planilla_lineas_select    ON planilla_lineas    FOR SELECT TO authenticated USING (es_admin(auth.uid()));

DROP POLICY IF EXISTS liquidaciones_select      ON liquidaciones;
CREATE POLICY liquidaciones_select      ON liquidaciones      FOR SELECT TO authenticated USING (es_admin(auth.uid()));

-- Contabilidad
DROP POLICY IF EXISTS asientos_select           ON asientos;
CREATE POLICY asientos_select           ON asientos           FOR SELECT TO authenticated USING (es_admin(auth.uid()));

DROP POLICY IF EXISTS asientos_partidas_select  ON asientos_partidas;
CREATE POLICY asientos_partidas_select  ON asientos_partidas  FOR SELECT TO authenticated USING (es_admin(auth.uid()));

-- Bancos
DROP POLICY IF EXISTS bancos_mov_select         ON bancos_movimientos;
CREATE POLICY bancos_mov_select         ON bancos_movimientos FOR SELECT TO authenticated USING (es_admin(auth.uid()));
