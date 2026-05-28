# Auditoría de delivery-readiness — Julia Bakery
**Fecha:** 27 may 2026 (noche · re-audit post-aclaración de Charles)
**Rama de fixes:** `claude/audit-fixes-20260527` (creada desde `main` @ `d734ccb`).
**Lente:** mañana se entrega la plataforma a Ximena como deliverable de consultoría (NO arranca el POS). Audit re-priorizado para evitar "vergüenza en demo en vivo".

---

## TL;DR

**El hallazgo P0 #1 es el más importante: hay una rama no mergeada (`claude/condescending-ramanujan-678f31`) con 7 commits de features que Charles describió como YA IMPLEMENTADAS** (PDF imprimible de producción y compras, dropdown de unidad en compras, costo sugerido por unidad, separación comida/bebidas, ModalInsumo responsive en mobile, soft/hard-delete inteligente). **Esos features NO están en main.** Si Ximena los ve mencionados o intenta usarlos en la demo, va a quedar mal. Charles tiene que decidir HOY si mergea esa rama a main antes del deploy.

Aparte de eso, hay un puñado de issues de polish y mobile que se ven feo en demo (formatos de moneda inconsistentes, modales que se cortan en mobile, ISR definido pero no aplicado, tablas que se salen del viewport en celular). Los más obvios y aislados ya están arreglados en los 6 commits de esta rama.

**Conteo total:** **P0: 11 · P1: 30 · P2: 19**
**Commits aplicados esta noche:** **10** (legal, login, modal inventario, dashboard format, ventas acentos, **preview costo patronal empleados**, **overflow-x-auto en 6 tablas mobile + fix off-by-one fecha IGSS**, audit report).

---

## 🚨 P0-1 · La rama `condescending-ramanujan` NO está mergeada a main

**Hallazgo principal del audit re-priorizado.** Es la primera cosa que Charles debe revisar mañana.

La rama `claude/condescending-ramanujan-678f31` (último commit `abc1154`, 27 may 2026 21:19 GT, hace ~5 horas al momento del audit) tiene **7 commits con features críticas que se describen como entregables**, todos sobre archivos del producto principal (NO sobre el POS/FEL que vive en `elastic-williams`):

```
abc1154  feat(compras+componentes): SelectUnidad compartido y dropdown en linea de compras
67f102a  fix(compras): costo sugerido en linea respeta la unidad y se recalcula al cambiarla
ae31029  fix(insumos+compras): conversion de unidades al derivar costo y recibir compra
e07506e  feat(produccion+compras): vista imprimible/PDF para plan de produccion y orden de compra
0500d68  fix(inventario): ModalInsumo responsive en movil — scroll + apilar campos
0cfcae3  fix(insumos): boton dar de baja con soft/hard-delete inteligente
205cc40  feat(recetas+produccion): clasificar comida/bebida y excluir bebidas del plan
```

**Diff vs main: 15 archivos · +1260 / -82 líneas**, incluyendo archivos NUEVOS:
- `components/SelectUnidad.js` (selector de unidad reutilizable)
- `lib/unidades.js` (utilities de conversión de unidades)
- `pages/compras-imprimir.js` (243 líneas — vista imprimible orden de compra)
- `pages/produccion-imprimir.js` (201 líneas — vista imprimible plan de producción)
- `migrations/2026_05_27_recetas_tipo.sql` (clasificación comida/bebida)

**Qué pasa en demo si NO se mergea:**
- "Ximena, ¿podemos imprimir esta orden de compra para llevársela al proveedor?" → no existe el botón.
- "¿Cómo elijo si la harina la compré por saco o por libra?" → no hay dropdown, solo input de texto libre.
- "¿Puedo planificar solo el pan, excluyendo bebidas?" → no, no hay clasificación comida/bebida.
- Modal de insumo en celular → los botones Guardar/Cancelar quedan fuera del viewport (este último YA lo apliqué en mi rama de fixes, commit `6cfc181`).

**Acción sugerida para Charles:**
1. Revisar los 7 commits de `condescending-ramanujan` y aprobar.
2. Hacer `git checkout main && git merge claude/condescending-ramanujan-678f31`.
3. Resolver conflictos (probables con mi rama de audit-fixes — son cambios pequeños).
4. Verificar la migration nueva `2026_05_27_recetas_tipo.sql` antes de aplicar.
5. Smoke-test en preview deploy (NO en prod) antes de la demo.

**Todo este audit fue contra `main` sin esos 7 commits.** Si los mergeás, hay que re-auditar la versión mergeada (probablemente mucho menos riesgosa que lo que reporto abajo).

---

## P0 (resto) — cosas que no se entregan así

### P0-2 · ISR de planilla: implementado en `lib/planillas.js` pero NUNCA se invoca

**Charles dijo "ISR ya implementado".** Realidad:

- `lib/planillas.js:46-62` define `calcularISRRetencionAnual / Mensual / Quincenal` como funciones puras. ✓
- **No hay ninguna referencia a esas funciones en ningún endpoint API ni en ningún componente UI.** Verificado: `grep -rn "calcularISR" pages/ lib/` solo devuelve las definiciones en `lib/planillas.js`.
- **No existe ninguna columna `isr_retenido` en `planilla_lineas`** (ver `migrations/2026_05_21_planillas.sql` + `migrations/2026_05_19_planilla_bonif_descuentos.sql`).
- El cálculo del líquido (`calcularLiquidoLinea`) NO descuenta ISR.
- El asiento contable de planilla pagada NO acredita "ISR por pagar" (ver `lib/contabilidad/generador.js:215-260`).
- El commit donde se agregó la función dice literalmente "no aplicada todavía" (`aaf1e37 feat(planillas): funcion pura ISR (Decreto 10-2012, no aplicada todavia)`).

**Qué verá Ximena:** abre planilla, no hay columna ISR, no se le descuenta del líquido. Si Charles dijo "ISR implementado", expectativa rota.

**Decisión pendiente:** ¿se aplica en esta entrega (requiere migration + cambios en generador de líneas + UI), o se documenta como "función disponible, integración pendiente"?

### P0-3 · Vacaciones "15 días hábiles" — la fórmula trata 15 como días calendario

**Charles dijo "vacaciones 15 días hábiles".** Realidad:

- `lib/planillas.js:26` `DIAS_VACACIONES_ANIO = 15` (comentado como "días hábiles").
- `lib/planillas.js:72` `vacaciones_m = (DIAS_VACACIONES_ANIO / 30) * (sal / 12) = sal / 24`. Divide por **30 días** (calendario), no por días hábiles.
- `lib/liquidaciones.js:101-102` `diasVacProporcionales = (años % 1) * 15` y `vacaciones = diasVac × salDia` donde `salDia = sal / 30` (calendario).

**El número 15 sí sale, pero está siendo tratado como 15 días calendario, no como 15 días hábiles.** Para el ojo contable guatemalteco esto puede ser una cosa o la otra dependiendo de la convención de la empresa — la fórmula `sal/24` por mes ES la convención contable común para provisión de vacaciones en GT (= 15 días pagados a salario diario calendario / 12 meses). El comentario "días hábiles" en el código puede generar confusión vs la fórmula real.

**Decisión pendiente:** confirmar con el contador de Julia Bakery cuál es la convención esperada. Si es "15 hábiles × salario_diario_calendario", la fórmula actual está bien y solo hay que corregir el comentario. Si la expectativa es "15 hábiles ≈ 21 calendario × salario_diario", la fórmula subestima ~40% el monto de vacaciones (lo cual sería P0 contable).

### P0-4 · Modal de Inventario sin scroll en mobile → **YA ARREGLADO** en esta rama (commit `6cfc181`)

El `ModalShell` de `pages/inventario.js` (que Ximena usa todos los días: "+ Nuevo insumo", "Editar", "Movimiento") no tenía `max-h-[90vh]` ni `overflow-y-auto`. En su iPhone (~380px ancho, ~700px alto con teclado abierto), los modales largos perdían los botones Guardar/Cancelar fuera del viewport. **Ya arreglado en commit `6cfc181`**, replicando el fix `0500d68` que vive en `condescending-ramanujan`.

### P0-5 · Dashboard mostraba "Q 1,543" sin decimales mientras Caja/Ventas mostraban "Q 1,543.27" → **YA ARREGLADO** en esta rama (commit `540d3e1`)

`pages/dashboard.js:fmtQ` usaba `minimumFractionDigits: 0`. Inconsistencia con el resto de la app. Para Ximena en demo, ve la "Ventas hoy: Q 1,543" en el dashboard y "Total Q 1,543.27" en la página de caja del mismo día. Parece bug. Ya estandarizado a 2 decimales.

### P0-6 · `privacy.js` y `terms.js` contenían contenido legal de Hidrocom S.A. → **YA ARREGLADO** (commit `d02f81a`)

### P0-9 · Preview "Costo patronal quincenal" en empleados/ModalEmpleado MAL — fórmula mensual sin /2 → **YA ARREGLADO** (commit `222a22f`)

Bug super visible: cuando Ximena entra un salario en el modal de empleado, ve un preview del "Costo patronal quincenal" que usaba la fórmula:

```js
sal / 2 + (sal / 24) * 3 + sal * 0.1067 + sal * 0.01 * 2 + sal * 0.0972
```

Problema: los componentes `sal * 0.1067` (IGSS patronal), `sal * 0.01 * 2` (IRTRA + INTECAP) y `sal * 0.0972` (indemnización) son MENSUALES, no quincenales — debieron dividirse por 2. Y `(sal/24)*3` mete vacaciones como `sal/24` quincenal cuando en realidad vacaciones quincenal = `sal/48` (vacaciones mensual es `sal/24`).

Para sal=Q5,000: el preview mostraba ~Q4,244 mientras `calcularProvisiones` (lo que la API persiste) devuelve ~Q3,581. Ximena vería los dos valores distintos en la misma sesión (preview en modal + KPI guardado), parecería bug.

Fix aplicado: el preview ahora importa `calcularProvisiones` de `lib/planillas.js` y muestra exactamente lo que se va a persistir. Sin tocar la API ni el cálculo real.

### P0-10 · Recetas: NO hay conversión de unidades entre ingrediente e insumo

`lib/recetas.js:33-42` y `pages/api/recetas/[id].js` calculan `subtotal = cantidad * costo_unitario_snapshot`. El campo `unidad` que se captura por ingrediente en el formulario de receta (línea `pages/recetas.js:486-493`) es **puramente cosmético** — no participa del cálculo de costo.

**Consecuencia:** si un insumo es "harina" con `unidad='kg'` y `costo_unitario=Q5/kg`, y la receta dice "harina: cantidad=500, unidad=g", el cálculo da `500 * 5 = Q2,500` cuando el valor real es `Q2.50`. **Error 1000×.** Lo mismo con lb↔kg, lt↔ml.

Charles mencionó "el cálculo de costos que tiene conversión de unidades" — la conversión que sí existe es la del receipt de compra (unidad_compra → unidad base, ej. saco → lb). Pero entre receta y insumo, no hay conversión.

**Acción para Charles (no aplico por riesgo + decisión de UX):**
- Opción A (UX safe): convertir el input "Unidad" del ingrediente a read-only mostrando `insumo.unidad`, forzando a Ximena a entrar cantidades siempre en unidad base.
- Opción B (real fix): agregar tabla de conversión (kg↔g, lt↔ml, lb↔kg) y validar/convertir al guardar.
- Si Ximena solo entra cantidades en unidad base hoy, ya está funcionando — pero es trampa para errores futuros y para demo es contraintuitivo que el campo "Unidad" no haga nada.

### P0-11 · Compras: el dropdown de unidad y el costo sugerido NO existen en main — autocompletar pisa la unidad de compra del insumo

Charles dijo "ahora con desplegable de unidad y cálculo de costo sugerido". En `main` no existe ese desplegable — los commits que lo agregan están en `condescending-ramanujan` (ver P0-1).

**Trampa concreta y bug peligroso del estado actual de `main`:**
- `pages/compras.js:311-324 elegirInsumo`: cuando se elige un insumo en una línea de compra, se autocompleta `unidad = insumo.unidad` (la BASE) y `costo_unitario = insumo.costo_unitario` (también BASE).
- `pages/api/compras/[id]/recibir.js:71-82`: al recibir la compra, el código fracciona el stock SOLO si la línea declara `unidad === insumo.unidad_compra` (NO la base). Si la unidad es la base, no fracciona.

**Caso real:** Ximena registra "1 saco de harina por Q300", el insumo "harina" tiene `unidad='lb'`, `unidad_compra='saco'`, `cantidad_por_unidad_compra=50`, `costo_compra=Q300`. La UI autocompletará `unidad='lb'` y `costo_unitario=Q6` (el costo por libra previo). Si Ximena pone "cantidad=1" pensando "un saco" y deja la unidad en `lb`, **se guarda como 1 libra a Q6, no 50 libras a Q300**. Diferencia 50×.

**Acción para Charles:** mergear `condescending-ramanujan` que arregla esto formalmente (commits `abc1154` SelectUnidad y `67f102a` costo sugerido por unidad). Como fix mínimo standalone, podría cambiar `elegirInsumo` para preferir `unidad_compra/costo_compra` cuando ambos existan, pero esto cambia comportamiento histórico y no debería aplicarlo unilateralmente esta noche.

### P0-7 · QBO tokens y mapeos sin RLS (heredado del fork GasOps)

Migración `2026_05_08_qbo_setup.sql` crea `qbo_tokens`, `qbo_sync_audit`, `qbo_mapping_*` **sin habilitar RLS**. Por defecto, esto las hace accesibles vía PostgREST con la `anon key` (que está embebida en el JS público). Si la integración QBO todavía no se usa para Julia Bakery, no es urgente — pero si por algún motivo la `anon_key` del proyecto Supabase es la misma que se usa en producción de Hidrocom Y los tokens QBO de Hidrocom siguen allí, podría haber leak. **Verificar en Supabase Dashboard antes de actuar** (ver DDL-1).

### P0-8 · Bypass de auth en los 3 crons vía header `User-Agent: vercel-cron`

`pages/api/cron/{loyverse-sync,resumen-ventas-diario,alerta-cierre-faltante}.js` aceptan ese user-agent como auth válida (trivialmente spoofable). No es bloqueante para demo (no afecta UI), pero sí es problema de seguridad y deja la puerta abierta a DoS / spam de emails desde internet. **Fix de 1 línea por archivo, pendiente de confirmar que `CRON_SECRET` está en Vercel.**

---

## P1 — UX rugoso, no bloqueante pero notable en demo

### Mobile y formularios

**P1-1 · Tabla principal de cierres de caja sin `overflow-x-auto`** → **YA ARREGLADO** (commit `dbad430`).

**P1-2 · Tabla principal de insumos sin `overflow-x-auto`** → **YA ARREGLADO** (commit `dbad430`).

**P1-3 · Tabla principal de ventas sin `overflow-x-auto`** → **YA ARREGLADO** (commit `dbad430`).

**P1-4a · Tabla principal de compras sin `overflow-x-auto`** → **YA ARREGLADO** (commit `dbad430`).

**P1-4b · Tabla principal de recetas sin `overflow-x-auto`** → **YA ARREGLADO** (commit `dbad430`).

**P1-4c · Tabla principal de empleados sin `overflow-x-auto`** → **YA ARREGLADO** (commit `dbad430`).

**P1-4d · Tabla del plan de producción sin `overflow-x-auto`** (`pages/produccion.js:432-457`). 5 columnas con `w-32`/`w-28`/`w-24` no se respetan. **NO arreglada** — la tabla del plan tiene inputs interactivos y wraparla en `overflow-x-auto` puede sentir raro al editar. Charles puede aplicar manualmente.

**P1-4e · Tablas DENTRO de modales (ModalCompra líneas, ModalReceta ingredientes, ModalDetalleCompra)** — necesitan vista mobile específica o switch a cards. **NO arreglada** — riesgo medio, modal del modal.

**P1-5 · Modales grandes (Nueva factura/Nuevo asiento/Calcular liquidación/Importar CSV/Conciliar mov) no aplican el patrón `max-h-[90vh] flex flex-col`**. Solo el ModalShell de `produccion.js` y el drill-down de `reportes.js` lo aplican. El resto (compras, recetas, contabilidad, planillas, liquidaciones, igss, bancos, facturación) usa el patrón "outer scrolls + my-8" que **funciona** pero deja modales muy largos visualmente raros (la sombra/borde queda fuera del viewport visible).

**P1-6 · Grids `grid-cols-2` y `grid-cols-3` sin breakpoint mobile en `pages/caja.js`** (líneas 90, 240, 288). Tarjetas con "Q 1,234,567.89" se aplastan en 380px.

**P1-7 · `pages/caja.js:244-246` — input `saldo_inicial` sin `min="0"`**. Acepta negativos.

**P1-8 · `pages/caja.js:277-279` — input monto egreso sin `min="0.01"`**. Acepta negativos.

**P1-9 · `pages/inventario.js:1316` — input cantidad en ModalMovimiento sin `max`**. Acepta 9999999.

**P1-10 · `pages/inventario.js:1255` — `nuevoStock` no se resetea al cambiar tipo de movimiento**. Confusión al cambiar entre "ajuste" y otros.

**P1-11 · `pages/inventario.js:1200` — `costoDerivado.toFixed(4)` muestra "Q 0.4500" con 4 decimales**. Para costos > 1 se ve raro; para costos < 0.01 sirve. Decisión: dejar 4 decimales (precisión) o usar 2 (consistencia). Por ahora no lo toqué para no romper insumos de bajo costo.

**P1-12 · `pages/inventario.js:285-290` — `<input type="date">` sin `max={hoy}`**. Permite seleccionar fechas futuras en conteo diario. Solo el botón "→" tiene `disabled={esHoy}`.

**P1-13 · `pages/produccion.js:209-216` — `<input type="date">` sin `min`/`max`**. Permite crear plan para 2050.

**P1-14 · `pages/produccion.js:438-444` — borrar el input de cantidad ELIMINA la línea del plan, sin warning**. Sorprendente para el usuario.

### Datos visibles y formatos

**P1-15 · `pages/igss.js:23 formatFechaCorta` off-by-one por timezone** → **YA ARREGLADO** (commit `dbad430`).

**P1-16 · `pages/dashboard.js:164` — perfil se construye como `{ email }` sin traer `nombre_completo` ni `rol` de Supabase**. Layout no puede saludar por nombre. Otras páginas SÍ traen el perfil completo.

**P1-17 · `pages/dashboard.js:121` — etiqueta del día de la semana puede dar `undefined`** si `getUTCDay()` falla. Defensivo.

**P1-18 · `pages/dashboard.js:144` — items sin nombre se agrupan como "—"** en "Top productos hoy". Si hay varios, dice "—" como el más vendido.

**P1-19 · `pages/dashboard.js:222-224` — total semana incluye día de hoy completo aunque sean recién las 9am**. Label "total" sin contexto engaña.

**P1-20 · `pages/ventas.js:38` — `.limit(500)` sin advertencia**. Para "30 días" en una panadería ocupada, fácil pasar 500 recibos → truncamiento silencioso, total no cuadra con realidad.

**P1-21 · `pages/ventas.js:99` — fecha sin año**. "5 ene" ambiguo entre años.

**P1-22 · Tabla de planillas: `colSpan` fijo desalineado** (`pages/planillas.js:405`) — usa `colSpan={13}` cuando la tabla tiene 12 o 13 columnas según `esAdmin && editable`.

**P1-23 · `pages/bancos.js` parser CSV** maneja mal acentos (regex `[̀-ͯ]` con caracteres unicode literales) y no soporta comillas (común en descripciones bancarias con comas). Para demo es probable que Ximena no use esto, pero si Charles muestra "subir extracto BAC" se rompe.

**P1-24 · `pages/igss.js` `descargarTXT` sin warning si hay empleados con `numero_igss` vacío**. Genera TXT con filas vacías que IGSS va a rechazar.

### Atomicidad y races (ya documentado en audit anterior pero sigue válido)

**P1-25 · Patrón "cabecera + líneas" no transaccional en ~10 endpoints** — `asientos/index.js`, `compras/[id].js`, `cierres/[id].js`, `recetas/[id].js`, `planillas/[id]/lineas/index.js`, etc. Si el insert de líneas falla, la cabecera queda huérfana.

**P1-26 · `pages/api/planillas/[id]/estado.js` — UPDATE sin CAS sobre estado**. Doble-click puede generar 2 asientos contables de planilla pagada.

**P1-27 · `pages/api/cierres/[id]/reabrir.js` — no anula asiento previo**. Re-cerrar con cambios deja datos viejos en contabilidad (idempotencia por origen_id sí evita doble asiento, pero el primero queda con datos antiguos).

---

## P2 — Polish

**P2-1 · Acentos en dashboard ("Ultimos 7 dias", "Mié", "Sáb", etc.)** — **YA ARREGLADO** (commit `540d3e1`).

**P2-2 · Acentos en ventas ("7 dias", "30 dias")** — **YA ARREGLADO** (commit `80a080e`).

**P2-3 · Acentos en otros lugares**: `pages/produccion.js:170` `"Borrar este plan? (solo borradores)"` (falta `¿`).

**P2-4 · Dashboard saluda "Hola" sin nombre** — necesita traer perfil completo.

**P2-5 · `pages/dashboard.js:271` — "[devol]" abreviado** — en demo más profesional sería "devolución".

**P2-6 · `pages/dashboard.js:273` — `toLocaleString('es-GT')` usa zona del navegador** no de GT explícita.

**P2-7 · Helpers de fecha duplicados en ~8 archivos** (`dashboard.js`, `caja.js`, `inventario.js`, `produccion.js`, `compras.js`, `reportes.js`, `liquidaciones.js`, `igss.js`, `contabilidad.js`). Ya existe `lib/fecha-gt.js`. Riesgo de divergencia silenciosa.

**P2-8 · `pages/inventario.js:814` — `categorias` no normaliza minúsculas/mayúsculas**. "Harinas" y "harinas" son dos categorías distintas.

**P2-9 · `pages/inventario.js:921` — `i.categoria || '—'`** sin estado vacío explicativo. Si Ximena no categoriza, todo dice "—".

**P2-10 · `confirm()` nativo** usado en muchas páginas (caja, compras, contabilidad, planillas, recetas, liquidaciones, inventario, bancos, producción). Estilo browser default, feo en mobile.

**P2-11 · Modales se cierran con click en overlay sin confirmación**. En modales con muchos campos, un tap accidental pierde datos.

**P2-12 · `pages/caja.js:481` — botón "Cerrar definitivamente"** habilitado solo con conteo, pero sin tooltip que explique por qué está deshabilitado.

**P2-13 · `pages/caja.js KPI "Diferencia acumulada"** suma positivas y negativas que se cancelan. Mejor `abs()` o split.

**P2-14 · `pages/produccion.js:351-376` — "Sugerir cantidades" reemplaza el draft sin avisar**. Pierde edits previos.

**P2-15 · `pages/produccion.js:794-797` — `copiar()` sin feedback de éxito** — click silencioso al portapapeles.

**P2-16 · Reportes — botón "↓ PDF" en `reportes.js:635 y :1069` sin `disabled` durante print**. Doble-click puede abrir 2 ventanas de impresión.

**P2-17 · `pages/planillas.js:369`, `pages/reportes.js:631` — botones "Exportar Excel" sin `disabled`** durante la generación. Doble-click baja dos archivos.

**P2-18 · `components/Layout.js` — bottom nav móvil sólo muestra 6 ítems alfabéticos**. Queda: Inicio, Bancos, Caja, Compras, Contabilidad, Empleados. **Faltan Ventas/Inventario/Producción** (los más usados día a día). Considerar curado en vez de alfabético.

**P2-19 · `pages/inventario.js:924` — columna "Costo Q" en header, valores sin "Q"** (solo `formatNum`). Decisión de diseño (Q en header, números limpios abajo) — funciona, pero inconsistente con otros lugares que muestran "Q" en cada celda.

---

## DDL propuesto (NO aplicado — requiere aprobación)

### DDL-1 · Habilitar RLS en tablas QBO

```sql
-- Migration: rls_qbo_tables.sql
-- Verificar primero en Supabase Dashboard si RLS ya está habilitada
-- manualmente. Si no, aplicar.

ALTER TABLE qbo_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_sync_audit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_mapping_estaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_mapping_skus       ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_mapping_customers  ENABLE ROW LEVEL SECURITY;
-- Sin policies → solo service_role accede.
```

### DDL-2 · Formalizar columna `high_water_mark` en `loyverse_sync_state`

`lib/loyverse/sync.js` lee/escribe esa columna pero no aparece en ninguna migration; Charles aplicó el DDL a mano vía MCP.

```sql
-- Migration: loyverse_high_water_mark.sql
ALTER TABLE loyverse_sync_state
  ADD COLUMN IF NOT EXISTS high_water_mark timestamptz;
COMMENT ON COLUMN loyverse_sync_state.high_water_mark IS
  'Max updated_at visto en el último drain completo. Para filtrado incremental con buffer de 5 min.';
INSERT INTO _schema_migrations (filename, applied_by) VALUES
  ('loyverse_high_water_mark.sql', 'manual') ON CONFLICT DO NOTHING;
```

### DDL-3 · Si Charles decide aplicar ISR en planilla (P0-2):

```sql
-- Migration: planilla_isr_retencion.sql
ALTER TABLE planilla_lineas
  ADD COLUMN IF NOT EXISTS isr_retenido numeric(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN planilla_lineas.isr_retenido IS
  'Retención ISR mensual (Decreto 10-2012) aplicada a esta línea quincenal. = calcularISRRetencionQuincenal(salario_mensual_ordinario).';

-- Y una cuenta contable + mapping:
INSERT INTO cuentas_contables (codigo, nombre, tipo, naturaleza, nivel, es_movimiento) VALUES
  ('2-01-03-011', 'ISR por pagar (retenciones empleados)', 'pasivo', 'acreedora', 4, true)
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO contabilidad_mappings (clave, descripcion, cuenta_id) VALUES
  ('isr_por_pagar', 'Pasivo: ISR retenido a empleados, pendiente de pagar a SAT',
   (SELECT id FROM cuentas_contables WHERE codigo = '2-01-03-011'))
ON CONFLICT (clave) DO NOTHING;
```

Más cambios de código en `pages/api/planillas/[id]/lineas/index.js`, `pages/api/planillas/[id]/lineas/[lineaId].js`, `lib/planillas.js` (recalcular en cada change), `lib/contabilidad/generador.js` (acreditar la cuenta), `pages/planillas.js` (mostrar columna).

---

## Fixes seguros aplicados en esta rama

10 commits sobre `claude/audit-fixes-20260527` (en orden cronológico inverso):

```
dbad430  fix(mobile): overflow-x-auto en 6 tablas principales + fix off-by-one fecha IGSS
222a22f  fix(empleados): preview de costo patronal quincenal usaba formula mensual sin /2
80a080e  fix(ventas): acentos en filtros '7 dias' y '30 dias' -> '7 días' / '30 días'
540d3e1  fix(dashboard): formato Q consistente con resto + acentos en titulares
6cfc181  fix(inventario): ModalShell responsive en movil (max-h + overflow-y-auto)
98e5de2  docs(audit): reporte priorizado de auditoria nocturna  (commit del primer audit)
ccade05  fix(login): placeholder de email — quitar 'gerente@estacion.com' heredado de GasOps
d02f81a  fix(legal): privacy.js y terms.js reescritos para Julia Bakery
```

Plus 1 commit por venir con esta versión actualizada del reporte.

**Tipo de cambios:**
- CSS / clases Tailwind (modal responsive, overflow-x-auto en 6 tablas).
- Copy / acentos (dashboard, ventas, login).
- Formato de número (`fmtQ` con 2 decimales en dashboard).
- Formato de fecha (interpretar `YYYY-MM-DD` como mediodia GT en IGSS).
- Contenido legal completo (privacy + terms reescritos).
- Reemplazo de fórmula inline por llamada a función pura ya existente (empleados → `calcularProvisiones`).

**Ninguno toca:** lógica de negocio en `pages/api/*`, schema/migraciones, crons, endpoints QBO/Loyverse/FEL, RLS, plan de cuentas.

---

## Decisiones pendientes para Charles antes de la demo

En orden de urgencia:

1. **Mergear o no la rama `condescending-ramanujan`** (P0-1). Si la mergeás, mucho de este audit ya queda resuelto: PDFs (compras + producción), dropdown unidad, costo sugerido, separación comida/bebida, sub-recetas, soft/hard-delete. Si no la mergeás, dejar claro a Ximena que esas features vienen en una próxima entrega.
2. **Separación comida/bebidas en recetas (P0 — feature inexistente en main)**: confirmar si Ximena espera verla. Si la rama `condescending-ramanujan` se mergea, queda resuelto.
3. **PDF imprimible de compras y producción (P0 — feature inexistente en main)**: idem.
4. **Bug compras 50×**: trampa en `elegirInsumo` que autocompleta unidad base en lugar de unidad de compra (P0-11). Mergear `condescending-ramanujan` o aplicar fix puntual en `main`.
5. **Recetas: cálculo sin conversión de unidades** (P0-10). Decidir si convertir el input "Unidad" en read-only o agregar tabla de conversión.
6. **ISR de planilla** (P0-2): ¿se aplica esta noche con DDL-3 + cambios de código, o se documenta como "función disponible, integración pendiente"?
7. **Vacaciones — convención hábil vs calendario** (P0-3): confirmar con contador.
8. **QBO RLS** (P0-7): verificar en Supabase Dashboard si ya está habilitada manualmente. Si no, DDL-1.
9. **Crons User-Agent bypass** (P0-8): confirmar `CRON_SECRET` en Vercel envs, luego aplicar fix de 1 línea.
10. **Bottom nav móvil** (P2-18): ¿qué 6 ítems quieren para Ximena? El orden alfabético actual deja Ventas/Inventario/Producción fuera del acceso rápido.
11. **Reportes/contabilidad** (P1 audit anterior): ¿accesibles a cualquier empleado o solo admin?
12. **Liquidación: gasto vs pasivo en bono14/aguinaldo/vacaciones** (P1 audit anterior): doble contabilización potencial.
13. **Limpieza legacy GasOps** (pages/api/qbo/test/*, admin/carga-retroactiva, bac/*, neonet/*, myposoft/*, wsm/*).

---

## Notas sobre metodología y agentes paralelos

- Audit corrido en 3 fases:
  1. Audit inicial (pre-aclaración de Charles): foco en operación general + seguridad. 4 agentes paralelos + revisión personal.
  2. Re-audit demo-readiness (post-aclaración): foco en "vergüenza en demo". 3 agentes paralelos + revisión personal de PDFs, ISR, vacaciones, 8 tabs de reportes, separación comida/bebidas. Hallazgo top: la rama `condescending-ramanujan` no mergeada.
  3. Verificación cruzada: cada P0 fue confirmado leyendo el código directamente. Algunas falsas alarmas de los agentes fueron descartadas (notadas abajo).

- **Falsos positivos descartados** (mantengo por transparencia):
  - `lib/recetas.js:34` y `lib/produccion.js:50` `Math.max(Number(x) || 1, 0.0001)`: `Number(0) || 1 = 1`, no `0.0001`.
  - `lib/cierres.js:31` "receipt_date podría ser DATE": confirmado `timestamptz` en migration.
  - `pages/api/qbo/auth/connect.js` "sin auth = P0": OAuth init es público por diseño; CSRF state protege el callback.
  - `pages/api/qbo/test/prod-salesreceipt.js`: tiene auth con `INTERNAL_API_SECRET`. Sigue siendo P1 limpiar, no P0.

- Sin tests automatizados — no pude verificar regresiones programáticamente. Conviene considerar Vitest para `lib/planillas.js`, `lib/liquidaciones.js`, `lib/recetas.js`, `lib/contabilidad/generador.js`, `lib/cierres.js` que tienen lógica pura.
