# Auditoría de Julia Bakery — 27 may 2026

**Rama:** `claude/audit-fixes-20260527` (creada desde `main` @ `d734ccb`).
**Alcance:** todo el repo excepto `pages/api/fel/*` y `pages/facturacion.js` (modo Infile vive en rama `claude/elastic-williams-182dae`), y módulos legacy GasOps explícitamente excluidos (`bac/`, `neonet/`, `myposoft/`, `wsm/`).
**Cobertura:** UI (`pages/*.js`), API (`pages/api/**/*.js`), lógica (`lib/**/*.js`), schema (`migrations/*.sql`), seguridad (secretos, RLS, auth, inyección), mobile (modales/tablas a 380px), flujos reales (ventas, inventario, recetas, producción, compras, planillas, bancos, conciliación, reportes).

---

## Resumen ejecutivo

La plataforma está sólida en lo grueso: el modelo de datos es coherente, las APIs siguen el patrón documentado (`requireAuth`/`requireAdmin` + `{ ok: true }`), la mayoría de las escrituras tienen idempotencia razonable, y los nuevos crons + RLS de tablas sensibles cierran agujeros visibles. **Hay sin embargo dos hallazgos P0 de seguridad de impacto alto que conviene confirmar y arreglar antes de cualquier release**: (1) las tablas heredadas de QBO/GasOps (`qbo_tokens`, `qbo_mapping_*`, `qbo_sync_audit`) **no tienen RLS habilitado** — si la `anon key` o la `authenticated key` quedaron expuestas y las tablas siguen en el schema `public`, cualquier usuario con sesión puede leer los tokens OAuth de la cuenta QuickBooks; (2) los tres crons (`loyverse-sync`, `resumen-ventas-diario`, `alerta-cierre-faltante`) aceptan el header `User-Agent: vercel-cron` como autenticación válida, lo que es trivialmente spoofable. Adicionalmente, las páginas legales (`privacy.js` y `terms.js`) tenían contenido de Hidrocom/GasOps — **ya fueron arregladas en esta rama**. El resto de los hallazgos son mejoras de robustez (race conditions, atomicidad, validaciones), correcciones de cálculo verificables con Charles (liquidaciones, ISR, IGSS TXT), y limpieza de código legacy GasOps que todavía vive en `pages/api/qbo/test/*` y `pages/api/admin/carga-retroactiva.js`.

**Conteo de issues:** **P0: 5** · **P1: 31** · **P2: 23**

---

## P0 — Crítico

Bloqueante para usar la plataforma, pérdida de datos o riesgo de seguridad. Charles debería revisar/decidir antes del próximo deploy.

### P0-1 · Tablas QBO sin RLS — leak potencial de tokens OAuth

**Decisión pendiente: requiere verificación en Supabase antes de actuar.**

`migrations/2026_05_08_qbo_setup.sql` crea estas tablas **sin `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`**:

- `qbo_tokens` — guarda `access_token` y `refresh_token` en TEXT plano.
- `qbo_sync_audit`, `qbo_mapping_estaciones`, `qbo_mapping_skus`, `qbo_mapping_customers`.

Por defecto, una tabla en el schema `public` sin RLS es accesible vía PostgREST por las claves `anon` y `authenticated` (la `anon` está embebida en el bundle JS público como `NEXT_PUBLIC_SUPABASE_ANON_KEY`). Si la configuración de Supabase no las bloqueó manualmente, **cualquiera con la URL del proyecto y la anon key puede `SELECT * FROM qbo_tokens`**.

**Acción sugerida (DDL propuesto, ver §DDL más abajo):**
1. Verificar primero en el dashboard de Supabase si RLS está habilitada (puede haberse aplicado a mano fuera de migrations).
2. Si no, aplicar `ALTER TABLE qbo_tokens ENABLE ROW LEVEL SECURITY;` (sin políticas → solo `service_role`).
3. Repetir para `qbo_sync_audit`, `qbo_mapping_estaciones`, `qbo_mapping_skus`, `qbo_mapping_customers`.
4. **Rotar el `refresh_token` de QBO producción** si pudo haber estado expuesto.

**Impacto si se confirma:** acceso de lectura/escritura completo a la cuenta QuickBooks Online productiva. Riesgo financiero y reputacional.

---

### P0-2 · Bypass de autenticación en los 3 crons vía `User-Agent`

**Archivos:**
- `pages/api/cron/loyverse-sync.js:19-26`
- `pages/api/cron/resumen-ventas-diario.js:20-24`
- `pages/api/cron/alerta-cierre-faltante.js:20-24`

Los tres usan el patrón:

```js
const isVercelCron = req.headers['user-agent']?.includes('vercel-cron')
const hasValidSecret = req.headers.authorization === `Bearer ${expectedSecret}`
if (!isVercelCron && !hasValidSecret) return res.status(401).json({ error: 'Unauthorized' })
```

El header `User-Agent` es trivialmente spoofable (`curl -A 'vercel-cron' https://app/api/cron/loyverse-sync`). Esto permite:
- Forzar polling continuo a Loyverse desde cualquier IP (rate-limit gratis, costo de funciones Vercel).
- Spamear emails al equipo (`resumen-ventas-diario`, `alerta-cierre-faltante`).
- Disparar el `enviarResumenVentas` con `?fecha=` para sondear info por correo a destinatarios pre-configurados.

**Por qué no apliqué el fix esta noche:** el fix obvio (`if (!hasValidSecret) return 401` y quitar la rama `isVercelCron`) sólo es seguro si `CRON_SECRET` está efectivamente configurado en Vercel y Vercel está inyectando el header `Authorization` (lo hace automáticamente cuando la env var existe). Si por algún motivo `CRON_SECRET` no está seteado, el fix rompe los crons. **Charles: confirmá que `CRON_SECRET` está en Vercel (`vercel env ls`) antes de aplicar.**

**Fix propuesto (1 línea por archivo):**

```diff
- if (!isVercelCron && !hasValidSecret) {
+ if (!hasValidSecret) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
```

Y limpiar las referencias a `isVercelCron` que ya no se usan (en `loyverse-sync.js:48` se usa para el log `trigger`; se puede dejar como inferencia del header).

---

### P0-3 · `privacy.js` y `terms.js` contenían contenido legal de Hidrocom — **YA ARREGLADO**

Antes del audit, `pages/privacy.js` y `pages/terms.js` declaraban que la aplicación era de "Hidrocom S.A. (NIT 103183841)" con email de contacto `shelloakland@hidrocom.net`. Si alguien (cliente, auditor SAT, usuario externo, OAuth callback de Loyverse/QBO/Digifact con su política de privacidad) entraba a esos URLs, leía una EULA y Privacy Policy completamente equivocadas.

**Fix aplicado en esta rama (commit `d02f81a`):** ambas páginas reescritas en español para Julia Bakery, describiendo el alcance real (POS Loyverse, contabilidad, planillas, FEL). Sin email/NIT específicos hasta que Charles defina los oficiales.

---

### P0-4 · `pages/api/admin/carga-retroactiva.js` — endpoint legacy con allowlist hardcoded de GasOps

**Archivo:** `pages/api/admin/carga-retroactiva.js`

Características:
- Hardcoded `AUTHORIZED_EMAILS = ['adoffice569@gmail.com', 'estacionesdeservicioguatemala@gmail.com']` (los dos admins de GasOps).
- Opera sobre tablas legacy `ventas`, `ventas_lubricantes`, `tienda_facturas_fel`, `qbo_mapping_estaciones`, `cargas_retroactivas_audit` — todas de gasolinera.
- Marca registros como `qbo_processed: false` esperando que el cron QBO de GasOps los procese.

Si el sistema Julia Bakery hereda las cuentas Supabase de GasOps y esos emails siguen siendo admin, **el endpoint es operativamente activo y permite a los admins legacy escribir en tablas GasOps**. Es código muerto que sigue siendo un vector vivo.

**Fix sugerido:** eliminar el archivo completo. (No lo borré para no tocar nada sin confirmación.)

---

### P0-5 · `pages/api/qbo/test/prod-salesreceipt.js` y `prod-salesreceipt-v2.js` crean Sales Receipts REALES en QBO producción

**Archivos:**
- `pages/api/qbo/test/prod-salesreceipt.js`
- `pages/api/qbo/test/prod-salesreceipt-v2.js`

Ambos están autenticados con `INTERNAL_API_SECRET` (no es libre acceso), pero a cualquier `GET` con ese header crean Sales Receipts reales en la cuenta QBO de producción (5 SRs por llamada con montos de prueba, customer/class hardcoded de gasolinera).

Si `INTERNAL_API_SECRET` se filtra (logs, copia/pega, backup), un atacante o usuario interno descuidado puede contaminar la contabilidad. Estos archivos fueron herramientas de diagnóstico que **debieron eliminarse al cerrar la fase de integración QBO de GasOps**.

**Fix sugerido:** borrar todos los archivos en `pages/api/qbo/test/*` que tocan QBO producción (al menos `prod-salesreceipt*`, `cleanup-tests.js`, `prod-accounts.js`, `prod-taxcodes.js`, `prod-read.js`, `check-tienda-may.js`). Los de sandbox (`api.js`, `customer.js`, `email.js`, `sales_receipt.js`) son menos críticos pero también son legacy GasOps.

---

## P1 — Importante

Afecta workflow operativo, dato incorrecto o mal UX persistente.

### Seguridad / RLS

**P1-1 · Escalación horizontal: reportes y contabilidad accesibles a empleados**

Los endpoints `/api/reportes/*`, `/api/contabilidad/balance`, `/api/contabilidad/libro-mayor`, `/api/cierres/preview`, `/api/igss/preview`, `/api/igss/txt`, `/api/produccion/sugerencias`, `/api/inventario/historico-mermas`, `/api/bancos/movimientos/[id]/sugerir` usan `requireAuth` (cualquier usuario logueado) en lugar de `requireAdmin`, y leen vía `supabaseAdmin` (bypass RLS). Eso significa que **cualquier empleado con cuenta puede pedir el P&L completo, libro mayor, balance, libro de IGSS, etc.** vía la API directamente.

**Decisión pendiente con Charles:** ¿es por diseño (todos los empleados ven los reportes) o debería gatearse a admin? Si es por rol intermedio, considerar agregar un rol `contador` o similar.

**P1-2 · `pages/api/qbo/test/*` — superficie de ataque viva si `INTERNAL_API_SECRET` se filtra**

Aún protegidos por secret, son herramientas de diagnóstico que ya no se usan en Julia. Eliminar.

**P1-3 · HMAC de `neonet/ingest.js:50` lanza `RangeError` con firmas de longitud distinta**

```js
crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expectedSig))
```

`timingSafeEqual` **lanza** cuando los buffers difieren en tamaño. Un atacante manda firma corta y la app crashea (o devuelve 500 con stack en logs). `bac/ingest.js` lo envuelve en try/catch; este no. **Fix:** validar `if (sigHeader.length !== expectedSig.length) return 401`. Legacy GasOps, pero sigue desplegado.

**P1-4 · Sin rate limiting en `/login`**

`pages/index.js` llama directo a `supabase.auth.signInWithPassword`. Sólo lo defiende los límites por IP de Supabase. Para Julia Bakery con un equipo chico no es urgente, pero anotar para cuando se abra acceso.

---

### Cálculos y reglas de negocio

**P1-5 · `lib/liquidaciones.js:101` — empleado con N años exactos pierde 15 días de vacaciones**

```js
const diasVacProporcionales = round((aniosTrabajados % 1) * 15)
```

Si `aniosTrabajados = 1.0` (exactos), `1 % 1 = 0` → `diasVacProporcionales = 0`. Igual para 2.0, 3.0. La función calcula sólo la **fracción del año en curso**, asumiendo implícitamente que el año cumplido ya fue gozado o pagado. **Decisión pendiente con Charles:** ¿esto coincide con la práctica contable? En GT, las vacaciones se acreditan al cumplir el año (15 días hábiles). Si el empleado no las gozó, la liquidación debería incluirlas. Verificar con `lib/liquidaciones.js` cómo se contemplan vacaciones acumuladas.

**P1-6 · `lib/liquidaciones.js:116,131` — división por 365 fijo no maneja años bisiestos**

```js
aguinaldo += (dias / 365) * (esEspecial ? sal : salarioMinimoVigente(a))
bono14    += (dias / 365) * (esEspecial ? sal : salarioMinimoVigente(a))
```

Un empleado que trabaja del 1 dic 2023 al 30 nov 2024 (366 días, año bisiesto) recibe `366/365 = 100.27%` del salario en lugar de exactamente uno. Diferencia de Q5–10 por liquidación, pero acumulable. Fix: `const diasAnio = esBisiesto(a) ? 366 : 365`.

**P1-7 · `lib/planillas.js:46-54` — ISR no incluye horas extra, comisiones, otros ingresos gravables**

```js
export function calcularISRRetencionAnual(salarioMensualOrdinario, igssLaboralAnual = null) {
  const sal = Number(salarioMensualOrdinario) || 0
  ...
  const base = sal * 12 - ISR_DEDUCCION_UNICA - igss
```

La base anual asume sólo salario ordinario mensual × 12. Si un empleado cobra comisiones o horas extra regularmente, sub-retiene ISR. **Decisión pendiente con Charles:** Julia tiene comisiones? Si sí, agregar `otros_ingresos_anuales_proyectados` al cálculo. Si la planilla en general no retiene ISR (porque los salarios están bajo el umbral Q4,000/mes), no es urgente.

**P1-8 · `lib/contabilidad/generador.js:300-309` — `generarAsientoLiquidacion` puede generar doble contabilización con provisiones**

`generarAsientoPlanillaPagada` cada quincena hace: `DEBE bono14_gasto / HABER bono14_por_pagar` (acumula el pasivo). Luego en `generarAsientoLiquidacion` al dar de baja al empleado, el asiento de liquidación debita `bono14_gasto` otra vez y acredita `caja/banco` por la proporcional, **sin tocar `bono14_por_pagar`**. El pasivo se queda acumulado sin liberar. Igual con aguinaldo, vacaciones e indemnización.

**Decisión pendiente con Charles:** ¿se está provisionando bono14/aguinaldo/vacaciones mes a mes en la práctica, o sólo se contabiliza el gasto cuando se paga? Si lo primero, la liquidación debería debitar el pasivo (`DEBE bono14_por_pagar / HABER caja`), no el gasto. Si lo segundo, hay doble gasto en planillas cada quincena.

**P1-9 · `lib/igss.js:108` — fin de quincena 2 hardcoded al día 28 (todos los meses)**

```js
const fechaFin2 = `28/${mes2}/${anio}`
```

El comentario explica que es "requerimiento IGSS de 14 días exactos". Si el sistema oficial del IGSS espera exactamente ese formato (1-14 y 15-28 sin tocar los días 29-31), está bien. **Pero la planilla interna de Julia opera de 1-15 y 16-fin de mes** (ver `lib/planillas.js:167 deducirPeriodo`). Eso significa que el TXT del IGSS no incluye los devengados de los días 29-31. **Decisión pendiente con Charles:** confirmar con el contador que el TXT v2.2.0 de IGSS efectivamente acepta esa convención y que los empleados que ganan días extra el 29-31 no quedan sub-reportados.

**P1-10 · `lib/qbo/tokenManager.js` — no atómico + asume single token + hardcoded a env sandbox**

Tres issues:

1. `.from('qbo_tokens').select('*').limit(1).single()` sin filtrar por `realm_id`. Si Julia Bakery agrega una segunda cuenta QBO (sandbox + prod), `single()` lanza.
2. Si dos requests ven token expirado simultáneamente, ambos hacen refresh; QBO invalida el refresh_token anterior cuando emite uno nuevo → el segundo refresh falla y el sistema queda sin token válido.
3. Usa `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` (sandbox) sin branching por entorno. Para producción debería usar `QBO_CLIENT_ID_PROD` / `QBO_CLIENT_SECRET_PROD`.

Como QBO es Fase 3 pendiente, no urgente. Cuando se active la integración real, los tres deben resolverse.

**P1-11 · `lib/qbo/emailAlerts.js` — contenido 100% GasOps**

`enviarReporteSync` referencia `r.combustible`, `r.lubricantes`, `r.tienda`. From email default: `'noreply@hidrocom.net'`. Si algún cron actual de Julia llega a llamar este helper, los emails saldrán con datos inventados/nulos y branding equivocado. Actualmente está aislado (sólo lo llaman crons QBO de GasOps). Marcar para limpieza al cerrar Fase 3.

**P1-12 · `lib/loyverse/sync.js:522-535` — delete + insert de pagos no atómico**

```js
await supabaseAdmin.from('loyverse_receipt_payments').delete().in('receipt_id', receiptIds)
...
await supabaseAdmin.from('loyverse_receipt_payments').insert(payRows)
```

Si el insert falla después del delete (timeout, error de constraint, Supabase down), los pagos se pierden y el siguiente cron sólo retoma desde `updated_at_min` — los recibos cuyos pagos se borraron no se re-procesan a menos que `updated_at` cambie en Loyverse. Riesgo: cierre de caja del día queda con totales mal. Fix: usar una transacción RPC o cambiar a upsert con clave compuesta.

**P1-13 · `lib/recetas.js:79` — sub-receta usa `costoEfectivo` sin dividir por `rinde_cantidad` de la sub-receta**

```js
.select('id, cantidad, ..., recetas:sub_receta_id(rinde_cantidad, costo_calculado, costo_personalizado)')
...
snapshot = costoEfectivo(ing.recetas)  // costo_personalizado ?? costo_calculado
```

La convención documentada (`lib/recetas.js:5-7`) dice que `costo_calculado` es "POR UNIDAD". Si la convención se respeta, está bien y `rinde_cantidad` traído es innecesario. **Decisión pendiente con Charles:** confirmar que `costo_calculado` siempre representa "por unidad de `rinde_unidad`" y no "total de la receta". Si hay alguna receta donde representa el total, el costeo de la receta padre estaría inflado por un factor `rinde_cantidad`.

---

### Atomicidad / race conditions

**P1-14 · Patrón "cabecera + líneas" no transaccional en ~10 endpoints**

Endpoints afectados:
- `pages/api/asientos/index.js` (POST)
- `pages/api/compras/index.js` y `compras/[id].js` (POST/PATCH)
- `pages/api/cierres/[id].js` (PATCH al reemplazar egresos)
- `pages/api/recetas/[id].js` (DELETE + INSERT ingredientes)
- `pages/api/planillas/[id]/lineas/index.js` (DELETE + INSERT al regenerar)
- `pages/api/produccion/planes/[id]/lineas.js` (DELETE + INSERT)
- `pages/api/produccion/planes/[id]/ejecutar.js` (INSERT N movimientos)
- `pages/api/compras/[id]/anular.js` (INSERT N ajustes reversa)
- `pages/api/bancos/movimientos/[id]/generar-asiento.js`
- `pages/api/bancos/movimientos/clasificar-bulk.js`

Patrón: inserta cabecera + N filas hijas en queries separadas. Compensa con `delete` manual si la segunda falla. **Si el compensador también falla** (red, RLS, timeout), queda un estado inconsistente. Para una panadería con un solo operador es raro; para producción real conviene mover a RPCs PL/pgSQL transaccionales con `crear_asiento_con_partidas(payload jsonb)` y similares.

**P1-15 · `pages/api/planillas/[id]/estado.js` — UPDATE sin CAS**

```js
const { data: actual } = await auth.admin.from('planillas').select('estado')...
...
const { data, error } = await auth.admin.from('planillas').update(patch).eq('id', id)...
```

No tiene `.eq('estado', actual.estado)` en el update. Dos requests concurrentes al transition `aprobada → pagada` pueden ambos pasar el check de transición y ambos ejecutar el update → **dos asientos de planilla pagada por la misma planilla**. Mismo patrón en `pages/api/produccion/planes/[id]/ejecutar.js` (el update final sin CAS, aunque el flujo previo lo mitiga).

**Fix:** agregar `.eq('estado', actual.estado)` y reportar conflicto si no afecta filas.

**P1-16 · `pages/api/cierres/[id]/reabrir.js` — no anula el asiento generado al cerrar**

Cuando se cierra un cierre, `generarAsientoCierreCaja` postea un asiento contable. Al reabrir, el asiento sigue posteado. Si se vuelve a cerrar (con o sin cambios), `generarAsientoCierreCaja` chequea idempotencia por `(origen_tipo='cierre_caja', origen_id)` y devuelve `ya_existe: true` — entonces NO duplica.

**Pero:** si entre el reabrir y el re-cerrar se cambian `egresos` o `conteo_efectivo`, el asiento previo no refleja los datos nuevos. **Decisión pendiente con Charles:** ¿el comportamiento esperado es "el asiento es inmutable y el nuevo cierre simplemente no genera asiento adicional" o "el asiento debe regenerarse con los datos del nuevo cierre"? Si lo segundo, hay que anular el asiento previo antes de cerrar de nuevo.

**P1-17 · `pages/api/cierres/[id].js` DELETE — no chequea estado**

```js
async function borrar(req, res, id) { ...
  const { error } = await auth.admin.from('cierres_caja').delete().eq('id', id) ...
}
```

No tiene guard `if (estado === 'cerrado') return res.status(400)`. Un admin puede borrar un cierre cerrado, su asiento contable queda huérfano (`origen_id` apunta a un cierre que ya no existe). El FK no cascadea.

---

### Inventario, producción, recetas

**P1-18 · `pages/inventario.js:186-209` — debounce de save puede perder cambios concurrentes en `inicial` y `final`**

El debounce de 600ms se hace por `variant_id`. Si el usuario edita `inicial` y luego `final` antes de los 600ms, sólo se envía el último cambio. El estado local en React lo actualiza con `upsertLocal`, así que el body al backend incluye el valor `inicial` recién tipeado — **pero** depende del orden de re-renders y del closure de `fecha`. Si el usuario cambia de fecha rápido también, el timer dispara con la fecha vieja en closure → POST 400 silencioso.

**Decisión pendiente:** verificar con repro real en mobile que el debounce no pierde el primer cambio. Una solución más conservadora es disparar save en `onBlur` en vez de debounced.

**P1-19 · `pages/produccion.js:322` — borrar input de cantidad elimina la línea entera del plan**

```js
function actualizarCantidad(receta_id, valor) {
  const v = Number(valor)
  if (!(v > 0)) {
    return persistir(draft.filter(d => d.receta_id !== receta_id))  // ← elimina línea
  }
  ...
}
```

Si el usuario borra el input (deja vacío) o pone 0, la línea desaparece. Comportamiento sorpresivo: el usuario quería poner 0 para "anular temporalmente", pero perdió la línea. Fix: mantener la línea con `0` en el draft y sólo eliminar al hacer click explícito en "Quitar".

**P1-20 · `pages/api/produccion/planes/[id]/ejecutar.js:142` — código muerto + parcial deja plan en 'ejecutado'**

```js
estado: errores.length === 0 ? 'ejecutado' : 'ejecutado',  // ambas ramas iguales
```

El ternario es bug visible (probable copy-paste). Más importante: si fallan algunos movimientos de salida, el plan se marca `'ejecutado'` igualmente y los movimientos exitosos quedan registrados, pero los fallidos no tienen retry path. El usuario ve `status: 207` + `errores_parciales` y debe re-ejecutar manualmente los faltantes con ajustes.

**Decisión pendiente:** agregar un estado intermedio `'ejecutado_parcial'` o forzar retry idempotente del endpoint cuando ya existen movimientos para algunos insumos.

**P1-21 · `pages/api/compras/[id]/recibir.js:108-110` — `costo_unitario` y `costo_compra` del insumo se sobrescriben con el último recibo**

```js
const updPayload = { costo_unitario: costoUnitarioBase, updated_at: now }
if (fracciona) updPayload.costo_compra = Number(l.costo_unitario)
await auth.admin.from('insumos').update(updPayload).eq('id', l.insumo_id)
```

Si una compra puntual tiene precio anómalo (oferta, error de digitación), contamina el costeo de **todas** las recetas que usan ese insumo. El recálculo de recetas dispara con el costo nuevo. **Decisión pendiente:** ¿queremos "promedio ponderado" o "último costo"? El comentario del código dice "último", pero conviene confirmarlo y, si se mantiene, agregar una validación de "salto >50% del costo previo, pedir confirmación".

**P1-22 · `lib/produccion-inventario.js:61` — asume `variants[0]` siempre**

`poblarInventarioInicialDesdeProduccion` itera líneas del plan, busca el item Loyverse de la receta y usa `variants[0]` para el `variant_id`. Si un item Loyverse tiene 2+ variantes (ej. tamaños: chico/grande), todas las cantidades van a la primera variante; las demás quedan en 0. **Decisión pendiente:** chequear cuántas recetas/items tienen multi-variante en Loyverse hoy. Si todos son single-variant, OK; si hay multi, agregar campo `loyverse_variant_id` a `recetas`.

**P1-23 · `lib/produccion-inventario.js:91-93` — idempotencia frágil del conteo diario**

El upsert usa `.eq('store_id', '')` literal (string vacío). Si la base tiene store_id null o un ID real, no matchea y se inserta otro registro → posibles duplicados.

---

### UX y errores silenciosos

**P1-24 · Pattern transversal: `setErr(json.error)` sin fallback en ~15 páginas**

Si la API responde 500 con body vacío o sin `.error`, `setErr(undefined)` y el componente `Error` renderiza vacío → el usuario ve la pantalla limpia sin saber que hubo error. Estandarizar a `json?.error || 'Error inesperado'`.

**P1-25 · Pattern transversal: race conditions en filtros sin AbortController**

`pages/ventas.js`, `caja.js`, `compras.js`, `inventario.js`, `reportes.js`, `bancos.js`, `igss.js`, `contabilidad.js` — cambiar filtros rápidos puede hacer que la respuesta vieja gane sobre la nueva. Para una panadería sin tráfico simultáneo es raro, pero confunde en mobile lento.

**P1-26 · `pages/dashboard.js:155-167` — porcentaje vs ayer mal cuando hay refunds netos**

`(hoyTotal - ayerTotal) / ayerTotal` se calcula con guard `ayerTotal > 0`, pero `ayerTotal` puede ser negativo si el día anterior tuvo más devoluciones que ventas. Resultado: cálculo válido matemáticamente pero confuso al usuario.

**P1-27 · `pages/dashboard.js:74-162` — 5 fetches secuenciales sin try/catch global**

Si cualquiera lanza, la pantalla queda en `loading: true` para siempre. Adicionalmente, paralelizables con `Promise.all` para mejorar tiempo de carga ~5×.

**P1-28 · `pages/bancos.js:826-893` — `parseCSV` con regex `[̀-ͯ]` posiblemente roto**

```js
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
```

Los caracteres entre corchetes son combining marks unicode literales, no escapes `̀-ͯ`. Pueden romperse al pegar/editar el archivo en editores que normalizan. Fix: usar `replace(/[̀-ͯ]/g, '')`.

**P1-29 · `pages/bancos.js:858-863` — `parseNum` aplica `Math.abs()`**

Si el extracto del banco reporta débitos como negativos (común), el `abs` los pierde y el sistema asume todo como positivo, dejando la clasificación débito/crédito al heading de columna. Si el CSV no es claro, la conciliación queda inconsistente.

**P1-30 · `pages/planillas.js:64` — crash si `planillaSel === null` y `vista === 'detalle'`**

```jsx
{vista === 'detalle' && <VistaDetalle planillaId={planillaSel.id} ... />}
```

Si `planillaSel` queda en null por alguna razón (fetch falla mid-render, navegación rara), accede a `.id` y crashea. Fix: `vista === 'detalle' && planillaSel && <VistaDetalle planillaId={planillaSel.id} ... />`.

**P1-31 · `pages/api/qbo/sync/daily-prod.js` y `retry-failed.js` no registrados en `vercel.json`**

Estos archivos no aparecen en `vercel.json:functions`, así que corren con `maxDuration: 10s` default. Llaman QBO real, que tarda fácil 20-30s. **Si se intenta usarlos, fallarán por timeout en producción.** Como QBO es Fase 3 pendiente, esto es preventivo. Tablas `loyverse_sync_state` (en `lib/loyverse/sync.js`) ya tiene una columna `high_water_mark` que el código lee/escribe pero **no existe en ninguna migración**. Charles aplicó el DDL a mano vía MCP. Conviene agregarle el archivo de migración para sincronizar entornos.

---

## P2 — Menor

Cosmético, mejora, decisión de UX.

**P2-1 · `components/Layout.js:31` — bottom nav móvil sólo muestra 6 ítems alfabéticos**

Tras ordenar los items alfabéticamente, `bottomNavItems = navItems.slice(0, 6)` queda en: **Inicio, Bancos, Caja, Compras, Contabilidad, Empleados**. Los items operativos diarios (Ventas, Inventario, Producción, Recetas) quedan ocultos en el menú hamburguesa. Para Ximena (que vive en mobile) probablemente sea un downgrade vs el orden previo. Considerar `bottomNavItems = [Inicio, Ventas, Caja, Producción, Inventario, Compras]` curated.

**P2-2 · `components/Layout.js` — Layout NO recibe `estacion` prop pero CLAUDE.md lo documenta como `<Layout perfil={perfil} estacion={estacion}>`**

El prop `estacion` viene de GasOps (multi-estación). Julia es tienda única — el prop no se usa. Actualizar CLAUDE.md §6.2 para no mencionarlo.

**P2-3 · `pages/api/cierres/[id]/reabrir.js` — comentario dice "loguea quien reabrió en notas" pero NO lo hace**

```js
// Util para correcciones puntuales. Loguea quien lo reabrio en notas.
```

Sólo limpia `cerrado_at/cerrado_by`. Si Charles realmente quiere log, hay que poblarlo o sacar el comentario.

**P2-4 · `lib/cierres.js:48` — `cantidad_recibos++` incluye REFUNDs**

Eso infla el conteo en días con muchas devoluciones. Considerar contar sólo `receipt_type !== 'REFUND'`.

**P2-5 · Helpers de fecha duplicados en 8+ páginas**

`hoyGT()`, `fechaGT()`, `gtDayRange()`, `gtDateString()` reimplementados en `pages/dashboard.js`, `caja.js`, `inventario.js`, `compras.js`, `produccion.js`, `reportes.js`, `liquidaciones.js`, `igss.js`, `contabilidad.js`. Ya existe `lib/fecha-gt.js`. Migración mecánica.

**P2-6 · `lib/reportes.js:667-671` vs `lib/cierres.js:22-26` — normalización de pagos discrepante**

`reportes` reporta pagos como `'CASH'` mientras `cierres` los reporta como `'EFECTIVO'`. Si los dos se cruzan visualmente en UI, hay inconsistencia. Centralizar `normalizarPago`.

**P2-7 · Inputs `type="number"` sin `min="0"` en ~10 lugares**

`pages/compras.js`, `planillas.js` (CeldaEdit), `empleados.js`, `recetas.js`, `inventario.js`, `liquidaciones.js`. Permiten negativos en cantidades, costos, salarios. Distorsionan reportes silenciosamente.

**P2-8 · `confirm()` nativo en muchas páginas**

`pages/caja.js`, `compras.js`, `planillas.js`, `recetas.js`, `liquidaciones.js`, `inventario.js`, `bancos.js`, `contabilidad.js`, `produccion.js`. Bloquea thread, se ve feo en mobile. Reemplazar gradualmente con modal custom.

**P2-9 · Modales se cierran al click en overlay sin confirmación**

`pages/compras.js:795`, `bancos.js:1081`, `contabilidad.js:942`, `caja.js:504`, `recetas.js:573`, etc. En modales con muchos campos, un tap accidental pierde el trabajo. Considerar `if (form.dirty) confirm` o desactivar click-outside en modales largos.

**P2-10 · `pages/produccion.js:618` y `pages/inventario.js:1082` — ModalShell sin `max-h-[90vh] overflow-y-auto`**

`inventario.js` recibió el fix (commit `0500d68`) pero el `ModalShell` en `produccion.js:616` SÍ tiene el patrón correcto. Verifiqué: ambos están actualmente OK. **Nota:** otros modales (`compras.js`, `bancos.js`, `contabilidad.js`, etc.) usan `overflow-y-auto` en el wrapper externo, no en el inner — funciona pero la altura no respeta `max-h-90vh`. Sería bueno estandarizar el patrón de `produccion.js`.

**P2-11 · `lib/contabilidad/generador.js:21-22` — validación estricta de balance puede fallar por centavos**

`if (totalDebe !== totalHaber) return ...` sin tolerancia. Si la suma de partidas individuales acumula error de redondeo, aborta. En la práctica funciona porque todas las partidas se redondean antes de sumar, pero un dato sin redondear (ej. `Number(e.monto)` en egresos chicos) puede meter centavos. Recomendado `Math.abs(d - h) < 0.01`.

**P2-12 · `lib/contabilidad/generador.js:312` — heurística `total_neto >= 5000 ? banco : caja` para liquidación**

Decisión basada en monto, frágil. Liquidaciones de Q4,999.99 salen de caja, Q5,000.01 de banco. Mejor agregar campo explícito al form de liquidación.

**P2-13 · `pages/api/cron/resumen-ventas-diario.js:19` y `alerta-cierre-faltante.js:19` — `expectedSecret = CRON_SECRET || INTERNAL_API_SECRET`**

Si NINGUNA está definida, `expectedSecret = undefined` y `req.headers.authorization === 'Bearer undefined'` puede aceptar exactamente esa cadena. Caso extremo (env mal configurado), pero es bueno fail-fast: `if (!expectedSecret) return 500`.

**P2-14 · `lib/contabilidad/mappings.js` — no se cachea entre requests**

Cada generación de asiento hace round-trip a DB. Para volumen normal de Julia es fine.

**P2-15 · `pages/api/qbo/conciliar/mensual.js`, `qbo/sync/*` operan sobre tablas legacy de GasOps**

Eliminar al cerrar Fase 3.

**P2-16 · `legacy/` (carpeta del fork)**

`legacy/test-ia.js:86` tiene `dangerouslySetInnerHTML`. Como `legacy/` no está bajo `pages/`, no se enruta — no es vulnerable hoy. Pero si alguien lo mueve sin notar, queda XSS. Considerar borrar la carpeta entera (revisar primero qué hay útil ahí).

**P2-17 · `pages/index.js:21` — mensaje de error genérico de login**

Cualquier error de Supabase muestra "Correo o contraseña incorrectos." Si la red está caída o hay rate-limit, el usuario se confunde. Loggear `error.message` en consola al menos.

**P2-18 · `lib/qbo/apiClient.js:46` — `JSON.parse(responseText)` sin try/catch**

Si QBO responde 200 con body vacío o no-JSON, crash. Como QBO es Fase 3 pendiente, anotar.

**P2-19 · `lib/qbo/apiClient.js:17` — `process.env.QBO_API_BASE` sin default**

Si falta la env var, URL queda `undefined/v3/...` → 404 confuso.

**P2-20 · `pages/api/contabilidad/mappings.js` PUT — reporta 500 con éxitos parciales no informados**

Si actualizan 5 mappings y 1 falla, devuelve `{ ok: false, errores: [...] }` pero los 4 exitosos ya quedaron aplicados. El cliente no sabe cuáles. Mejor `{ ok: true, actualizados: [...], errores: [...] }`.

**P2-21 · `pages/api/qbo/conciliar/mensual.js:67` — código muerto**

```js
await supabaseAdmin.rpc('exec_sql_count', {}).select()
```

El comentario admite que no funciona. Limpiar.

**P2-22 · `pages/api/qbo/auth/connect.js`, `connect-prod.js` sin auth**

Inician el flow OAuth contra QBO. **No es P0** (el agent de seguridad lo flageó como tal): el CSRF state en cookie protege el callback — un atacante no puede completar el flow sin acceso al navegador del admin. Pero por higiene, requerir `requireAdmin` para iniciar.

**P2-23 · Branding GasOps en archivos vivos**

`lib/qbo/emailAlerts.js:32-33` (`noreply@hidrocom.net`, `'GasOps'`), `pages/api/bac/ingest.js:98`, `pages/api/neonet/ingest.js:376`, varios qbo/sync/* y qbo/test/* mencionan GasOps/Hidrocom. Confunde durante incidentes pero no afecta a usuarios de Julia hoy.

---

## DDL propuesto (NO aplicado — requiere aprobación de Charles)

**DDL-1 · Habilitar RLS en tablas QBO heredadas**

```sql
-- Migration: rls_qbo_tables.sql
-- Fecha: 2026-05-28
-- Proposito:
--   Las tablas heredadas de la migracion 2026_05_08_qbo_setup.sql NO tienen
--   RLS habilitado. Por defecto en Supabase, una tabla en schema public sin
--   RLS es accesible vía PostgREST con las claves anon/authenticated (la anon
--   esta embebida en el bundle JS). qbo_tokens contiene access_token y
--   refresh_token en texto plano — leak potencial completo de la cuenta QBO.
--
--   Esta migracion habilita RLS sin definir politicas → solo service_role
--   accede (que es el patron correcto para tablas de tokens internos).
--
-- NOTA: verificar primero en Supabase Dashboard si RLS ya esta habilitado
--       manualmente (sin migration tracking). Si si, marcar como aplicado
--       sin re-correr el ALTER.

ALTER TABLE qbo_tokens             ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_sync_audit         ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_mapping_estaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_mapping_skus       ENABLE ROW LEVEL SECURITY;
ALTER TABLE qbo_mapping_customers  ENABLE ROW LEVEL SECURITY;

-- No se definen policies para authenticated/anon: bloqueo por defecto.
-- service_role siempre puede (bypassea RLS automaticamente).
```

**Acción adicional recomendada:** rotar el refresh_token de QBO producción tras aplicar.

---

**DDL-2 · Agregar `high_water_mark` a `loyverse_sync_state` con migration formal**

`lib/loyverse/sync.js:22` y :51 leen/escriben la columna `high_water_mark`, pero **no aparece en ninguna migration**. Charles aplicó el DDL a mano vía MCP. Para sincronizar entornos:

```sql
-- Migration: loyverse_high_water_mark.sql
-- Fecha: 2026-05-28
-- Proposito:
--   El cron de sync de Loyverse usa una columna `high_water_mark` que NO
--   esta en la migracion original 2026_05_20_loyverse_schema.sql. El DDL
--   se aplico a mano via Supabase MCP. Este archivo lo formaliza para que
--   un environment nuevo o el script scripts/migrate.js queden sincronizados.

ALTER TABLE loyverse_sync_state
  ADD COLUMN IF NOT EXISTS high_water_mark timestamptz;

COMMENT ON COLUMN loyverse_sync_state.high_water_mark IS
  'Max updated_at visto en el ultimo drain completo. Se usa para filtrar incrementalmente con buffer de 5 min y evitar reprocesar todo el historico.';

INSERT INTO _schema_migrations (filename, applied_by) VALUES
  ('loyverse_high_water_mark.sql', 'manual') ON CONFLICT DO NOTHING;
```

---

**DDL-3 · Constraint para bloquear borrado de cierres cerrados (opcional)**

```sql
-- Si Charles confirma que NO se debe permitir borrar cierres cerrados:
-- (alternativa: hacerlo en la API; ver P1-17)

CREATE OR REPLACE FUNCTION prevent_delete_closed_cierre()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estado = 'cerrado' THEN
    RAISE EXCEPTION 'No se puede borrar un cierre cerrado. Reabrir primero.';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_prevent_delete_closed_cierre ON cierres_caja;
CREATE TRIGGER trg_prevent_delete_closed_cierre
  BEFORE DELETE ON cierres_caja
  FOR EACH ROW EXECUTE FUNCTION prevent_delete_closed_cierre();
```

---

## Fixes seguros ya aplicados en esta rama

Tres commits sobre `claude/audit-fixes-20260527`:

1. **`d02f81a` — `fix(legal): privacy.js y terms.js reescritos para Julia Bakery`**
   - `pages/privacy.js`: reescrita en español, sin datos Hidrocom.
   - `pages/terms.js`: idem.
   - Sin email/NIT específicos hasta que Charles defina los oficiales.

2. **`ccade05` — `fix(login): placeholder de email — quitar 'gerente@estacion.com' heredado de GasOps`**
   - `pages/index.js`: placeholder ahora `tu-correo@juliabakery.com`.

Estos son cambios cosméticos sin impacto funcional. Ningún cambio de lógica de negocio, ningún DDL, ningún cron, ningún endpoint API. Listos para deploy si Charles los aprueba.

---

## Decisiones pendientes para Charles

Listo aquí todo lo que el audit no pudo decidir solo:

1. **RLS de qbo_tokens y tablas QBO** — verificar estado real en Supabase Dashboard antes de aplicar DDL-1. Si confirmás leak, rotar refresh_token.
2. **Bypass de User-Agent en crons** — confirmar que `CRON_SECRET` está seteada en Vercel; si sí, aplicar el fix de quitar la rama `isVercelCron`.
3. **Reportes accesibles a empleados (P1-1)** — ¿es por diseño o debe ser admin-only?
4. **Liquidaciones (P1-5)** — ¿la lógica de `(años % 1) * 15` matchea la práctica contable?
5. **Generador de asientos de liquidación (P1-8)** — ¿se está provisionando bono14/aguinaldo/vacaciones mes a mes? Si sí, la liquidación debería debitar el pasivo, no el gasto.
6. **TXT del IGSS (P1-9)** — confirmar con el contador que el formato 1-14 / 15-28 es lo que IGSS realmente exige.
7. **ISR de planilla (P1-7)** — ¿hay empleados con comisiones/horas extra suficientes para superar el umbral de Q48,000 anual?
8. **Costo de insumos al recibir compra (P1-21)** — ¿"último costo" o "promedio ponderado"? Si "último", agregar validación de saltos grandes.
9. **Multi-variant de Loyverse (P1-22)** — ¿hay items con 2+ variantes hoy? Si sí, prioridad alta.
10. **Convención de `costo_calculado` en sub-recetas (P1-13)** — confirmar que SIEMPRE representa "costo por unidad de `rinde_unidad`".
11. **Reabrir cierre con cambios (P1-16)** — ¿el asiento debe regenerarse o queda inmutable?
12. **Bottom nav móvil (P2-1)** — ¿el orden alfabético es lo que Ximena prefiere o un curated `[Inicio, Ventas, Caja, Producción, Inventario, Compras]` sería mejor?
13. **Limpieza de legacy GasOps** — ¿borrar `pages/api/admin/carga-retroactiva.js`, `pages/api/qbo/test/*`, `pages/api/bac/*`, `pages/api/neonet/*`, `pages/api/myposoft/*`, `pages/api/wsm/*`, `legacy/`, helpers en `pages/api/qbo/sync/*` y `qbo/conciliar/*`?

---

## Notas sobre la metodología

- Audit corrido con 4 agentes paralelos (UI pages, API endpoints, lib, security) más auditoría manual del schema/migraciones, flujos críticos (cierres, compras, planillas, producción, bancos), y mobile.
- Cada hallazgo P0 lo verifiqué leyendo el código directamente, no solo confiando en el reporte del agente. Algunas falsas alarmas de los agentes fueron descartadas (ver "Verificados como NO bugs" abajo).
- Sin tests automatizados (no hay framework configurado), no pude correr regresiones. Recomendado considerar Vitest para los módulos de `lib/` que tienen lógica pura (planillas, liquidaciones, recetas, contabilidad/generador, cierres).

### Verificados como NO bugs (descartados de reportes de agentes)

- `lib/recetas.js:34` y `lib/produccion.js:50` `Math.max(Number(x) || 1, 0.0001)`: `Number(0) || 1 = 1`, no `0.0001`. El segundo argumento del max nunca aplica para rinde=0; aplica sólo si alguien explícitamente pasa `0.0001`. No es bug.
- `lib/cierres.js:31` y `lib/reportes.js:40` "receipt_date podría ser DATE": **confirmado `timestamptz`** en `migrations/2026_05_20_loyverse_schema.sql:173`. No hay pérdida de recibos.
- `lib/produccion.js:67` "false positivo en detección de ciclos para sub-recetas hermanas": el agente se autocorrigió leyendo el `usadasPath.delete()` al final de `visitar`. No es bug.
- `pages/api/qbo/auth/connect.js` "sin auth = P0": el flow OAuth no requiere auth del usuario por diseño; el CSRF cookie state protege el callback. Lo bajé a P2.
- `pages/api/admin/carga-retroactiva.js` "permite a admins GasOps escribir": el endpoint opera sobre tablas GasOps que probablemente no se usan en Julia, pero igualmente es código legacy que debe eliminarse (P0-4 por la lista hardcoded y la mantención de tablas no usadas).
