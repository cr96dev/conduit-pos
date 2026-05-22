# CLAUDE.md — Julia Bakery

Guía de desarrollo para **Julia Bakery**, plataforma de operaciones para una panadería en Guatemala City. El repo es un fork de **GasOps (Hidrocom)** y estamos migrando la arquitectura de gasolineras a panadería.

> **Importante:** `package.json` todavía dice `"name": "gasops"`, los componentes muestran el logo de GasOps y muchos módulos (`/ventas`, `/lubricantes`, `/tanques`, etc.) son del dominio anterior. Tratarlos como **referencia de patrones**, no como features finales del producto.

## Contexto del producto
- **Negocio:** panadería única, Guatemala City.
- **Origen:** fork de GasOps. Reutilizamos patrones (Next.js Pages, Supabase, Vercel crons, FEL), no el dominio.
- **Fuentes de datos:**
  - **Loyverse POS API v1** (`https://api.loyverse.com/v1.0/`) — reemplaza todas las fuentes de combustible/MyPOSoft.
    - Polling cada **15 min** (no hay webhooks).
    - Paginación **cursor-based**.
    - Endpoints relevantes: `/receipts`, `/items`, `/inventory`, `/employees`, `/stores`, `/merchant`.
  - **Digifact** — certificación FEL. **Se mantiene**, no migrar. Pendiente validar si expone API.
  - **QuickBooks Online** — cuenta **nueva** para Julia Bakery (el flujo OAuth de `lib/qbo/*` sirve de referencia, pero los IDs, mappings y configuración son distintos).

## Convenciones específicas de este proyecto
- **Código de dominio en español** (variables de negocio, comentarios, mensajes al usuario). Inglés solo para lo técnico (handlers, integraciones, libs externas). Ver §7.
- **Salidas de archivo completas**, no diffs parciales — al pedir cambios, devolver archivos enteros listos para pegar.
- **RLS obligatorio** en todas las tablas de Supabase. Ninguna tabla nueva se mergea sin políticas de Row Level Security.

## Roadmap (estado)
- [ ] **Fase 1** — Cliente Loyverse + schema Supabase
- [ ] **Fase 2** — Validación Digifact (¿tiene API?, alternativas)
- [ ] **Fase 3** — Integrador QBO (cuenta nueva, mappings de panadería)
- [ ] **Fase 4** — Dashboard

Mantener este checklist actualizado conforme se cierren fases.

---

## 1. Stack

| Capa             | Tecnología                                                                 |
| ---------------- | -------------------------------------------------------------------------- |
| Framework        | **Next.js 14.2.3** con **Pages Router** (no App Router)                    |
| Lenguaje         | **JavaScript** (`.js`) — TypeScript instalado como devDep pero no se usa   |
| UI               | **React 18** + **Tailwind CSS 3.4** (`postcss` + `autoprefixer`)           |
| Backend / DB     | **Supabase** (`@supabase/supabase-js`, `@supabase/auth-helpers-nextjs`)    |
| Auth             | Supabase Auth (email/password)                                             |
| Hosting          | **Vercel** (cron jobs + functions configurados en `vercel.json`)           |
| Charts           | `recharts`                                                                 |
| Parseo archivos  | `unpdf` (PDFs), `xlsx` (Excel)                                             |
| IA               | API directa a Anthropic (`/api/analyze.js`, modelo `claude-haiku-4-5`)     |

### Notas sobre el stack
- **No usar App Router.** Todo va en `pages/` (estilo Next.js clásico).
- **No usar TypeScript** salvo que se acuerde migrar. `next.config.js` tiene `typescript.ignoreBuildErrors: true` y `eslint.ignoreDuringBuilds: true` — el código se acepta tal cual.
- **Sin gestor de estado externo** (Redux/Zustand). Estado local con `useState` + lectura directa a Supabase desde componentes.
- **Sin librería de componentes** (no shadcn, no MUI). Todo se compone con Tailwind a mano.

---

## 2. Estructura de carpetas

```
/
├── pages/                    # Rutas Next.js (Pages Router)
│   ├── _app.js               # Wrapper global: maneja sesión Supabase
│   ├── index.js              # Login
│   ├── dashboard.js          # Home del usuario
│   ├── admin.js              # Home del admin
│   ├── <feature>.js          # Una página por feature de negocio
│   ├── admin/                # Subpáginas de admin (cargas retroactivas, auditorías)
│   ├── contabilidad/         # Subpáginas de contabilidad
│   └── api/                  # API routes (server-side)
│       ├── analyze.js        # Endpoint Anthropic
│       ├── <dominio>/        # Agrupación por integración o feature
│       │   ├── qbo/          # QuickBooks Online (auth, sync, conciliación)
│       │   ├── fel/          # Facturación electrónica Guatemala
│       │   ├── myposoft/     # POS externo
│       │   ├── contabilidad/ # Asientos contables
│       │   ├── cron/         # Endpoints de cron job
│       │   └── ...
│
├── components/               # Componentes React compartidos
│   ├── Layout.js             # Sidebar + topbar móvil + auth-aware nav
│   ├── Toast.js              # Hook useToast + ToastContainer
│   └── Skeleton.js           # Placeholders de carga
│
├── lib/                      # Lógica server/client compartida
│   ├── supabase.js           # Cliente público (anon key) — usar en el front
│   ├── qbo/
│   │   ├── supabaseAdmin.js  # Cliente con service role — SOLO server
│   │   ├── apiClient.js      # Wrapper de llamadas a QBO API
│   │   ├── tokenManager.js   # Refresh automático de OAuth tokens
│   │   └── emailAlerts.js    # Envío de reportes/errores
│   ├── myposoft/             # Cliente + sync de POS externo
│   └── anthropic.js          # Cliente front para llamar /api/analyze
│
├── migrations/               # SQL versionado a mano (no es supabase CLI)
│   └── YYYY_MM_DD_<nombre>.sql
│
├── public/                   # Assets estáticos (logo.svg, etc.)
├── styles/globals.css        # Tailwind + overrides de modo noche
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json               # Cron jobs + maxDuration por función
└── package.json
```

### Reglas para añadir archivos
- Una feature de UI = **una página** en `pages/<feature>.js`. Si crece mucho, mover a `pages/<feature>/index.js` + subpáginas.
- Una integración externa = **una carpeta** en `pages/api/<integracion>/` y, si tiene lógica reusable, su gemela en `lib/<integracion>/`.
- Migraciones SQL: `migrations/YYYY_MM_DD_<descripcion_snake_case>.sql`.

---

## 3. Variables de entorno

### Patrón

| Tipo                | Prefijo                | Visibilidad           | Ejemplos                                     |
| ------------------- | ---------------------- | --------------------- | -------------------------------------------- |
| Públicas (cliente)  | `NEXT_PUBLIC_*`        | Bundle del navegador  | `NEXT_PUBLIC_SUPABASE_URL`, `..._ANON_KEY`   |
| Server-only         | sin prefijo            | Solo API routes / SSR | `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`   |

### Vars que el código usa hoy

**Supabase:**
- `NEXT_PUBLIC_SUPABASE_URL` — URL del proyecto Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — anon key (cliente)
- `SUPABASE_SERVICE_ROLE_KEY` — service role (solo server)

**Auth de crons / endpoints internos:**
- `CRON_SECRET` — para autenticar llamadas de Vercel Cron (header `Authorization: Bearer ...`)
- `INTERNAL_API_SECRET` — alternativa para llamadas manuales/server-to-server

**QBO (heredado, dual sandbox/producción):**
- `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` / `QBO_REDIRECT_URI` (sandbox)
- `QBO_CLIENT_ID_PROD` / `QBO_CLIENT_SECRET_PROD` / `QBO_REDIRECT_URI_PROD`

**Loyverse (Fase 1):**
- `LOYVERSE_ACCESS_TOKEN` — token de API (server-only)
- (Si se mueve a OAuth) `LOYVERSE_CLIENT_ID` / `LOYVERSE_CLIENT_SECRET` / `LOYVERSE_REDIRECT_URI`

**Digifact (Fase 2):**
- Pendiente de definir según lo que exponga su API.

**Anthropic:**
- `ANTHROPIC_API_KEY` — para `/api/analyze`

### Reglas
1. **Nunca** referenciar `SUPABASE_SERVICE_ROLE_KEY` o cualquier secret sin `NEXT_PUBLIC_` desde código que pueda terminar en el bundle (componentes, hooks, `lib/supabase.js`).
2. **Nunca** hardcodear secrets como fallback (`process.env.X || "valor_real"`). Si falta una var, fallar explícitamente con `res.status(500).json({ error: 'X no configurada' })`.
3. Usar `vercel env pull .env.local` para sincronizar localmente (los archivos `.env*` están en `.gitignore`).
4. Si añadís una variable nueva, documentala aquí.

---

## 4. Patrón de API routes

Todas las rutas viven en `pages/api/**/*.js` y exportan `default async function handler(req, res)`. Convenciones que se repiten en todo el codebase:

### 4.1 Estructura base
```js
// pages/api/<dominio>/<accion>.js

export default async function handler(req, res) {
  // 1. Validar método
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // 2. Validar auth (si aplica)
  const auth = req.headers.authorization
  if (auth !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  // 3. Validar body / query
  const { campo } = req.body
  if (!campo) return res.status(400).json({ error: 'Missing required fields' })

  // 4. Lógica + try/catch
  try {
    // ...
    return res.status(200).json({ ok: true, ... })
  } catch (e) {
    console.error('[<nombre>] ERROR:', e.message)
    return res.status(500).json({ ok: false, error: e.message })
  }
}

// 5. Config opcional (solo si necesita más de 10s)
export const config = { maxDuration: 60 }
```

### 4.2 Convenciones
- **Cliente Supabase server-side:** importar `supabaseAdmin` desde `lib/qbo/supabaseAdmin.js`. **No** crear un nuevo `createClient` cada vez (excepto si la ruta es realmente independiente; ver `cron-asientos-diarios.js` como ejemplo aceptable).
- **Respuesta JSON con forma `{ ok: boolean, ... }`** o `{ error: string }`. No mezclar con `success`. Hay routes legacy con `success`/`message` — **al refactorizar, migrar a `ok`**.
- **Logging:** `console.log('[<nombre-route>] mensaje', ...)`. Vercel captura `stdout`/`stderr` automáticamente.
- **Errores:** siempre devolver `error: e.message` (no el objeto completo), nunca el stack al cliente en producción.
- **Timeouts:** default Vercel = 10s. Cualquier route que llame APIs externas (QBO, MyPOSoft, Anthropic, FEL) **debe** declarar `export const config = { maxDuration: 60 }` y, además, registrarse en `vercel.json` en `functions`.

### 4.3 Auth en routes internos
Hay tres mecanismos conviviendo. Al añadir uno nuevo, elegí el que más se parezca al caso:

| Caso                                  | Header                                          |
| ------------------------------------- | ----------------------------------------------- |
| Cron de Vercel                        | `Authorization: Bearer ${CRON_SECRET}`          |
| Llamada server-to-server (admin tool) | `Authorization: Bearer ${INTERNAL_API_SECRET}`  |

Pattern recomendado para crons que también permiten invocación manual:
```js
const isVercelCron = req.headers['user-agent']?.includes('vercel-cron')
const hasValidSecret = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`
if (!isVercelCron && !hasValidSecret) return res.status(401).json({ error: 'Unauthorized' })
```

---

## 5. Cron jobs

### 5.1 Cómo registrar uno
Dos pasos, **ambos obligatorios**:

1. Crear el handler en `pages/api/.../<nombre>.js` siguiendo el patrón de API route (acepta `GET`, valida `CRON_SECRET`).
2. Declararlo en `vercel.json`:
   ```json
   {
     "crons": [
       { "path": "/api/cron/mi-job", "schedule": "0 9 * * *" }
     ],
     "functions": {
       "pages/api/cron/mi-job.js": { "maxDuration": 60 }
     }
   }
   ```

### 5.2 Schedules (cron en UTC)
Guatemala = **UTC-6** sin DST. Convertí siempre antes de escribir el schedule:

| Hora GT | Cron UTC      |
| ------- | ------------- |
| 02:00   | `0 8 * * *`   |
| 03:00   | `0 9 * * *`   |
| 11:00   | `0 17 * * *`  |
| 12:00   | `0 18 * * *`  |

### 5.3 Reglas para crons
- **GET method** (Vercel cron usa GET). Permitir POST opcional para disparo manual con `INTERNAL_API_SECRET`.
- **Autenticar siempre.** Sin auth, cualquiera puede dispararlo desde internet.
- **Idempotencia.** Los crons se pueden re-ejecutar (retries de Vercel, disparo manual, ventana solapada). Filtrar por flags tipo `qbo_processed_prod = false` o procesar solo registros sin gemelo, nunca por "lo nuevo desde la última corrida".
- **Logging estructurado** con prefijo `[<nombre-cron>]` para grepear en Vercel logs.
- **Fechas en zona horaria GT.** Hay un helper en `pages/api/cron/myposoft-sync.js`:
  ```js
  function gtDate(daysAgo = 0) {
    const now = new Date()
    const gtMs = now.getTime() - 6 * 60 * 60 * 1000 - daysAgo * 24 * 60 * 60 * 1000
    return new Date(gtMs).toISOString().slice(0, 10)
  }
  ```
  Reutilizarlo o moverlo a `lib/` si lo necesitás en más lugares.

### 5.4 Polling de Loyverse
Loyverse no tiene webhooks, así que necesitamos cron cada 15 min:

```json
{ "path": "/api/cron/loyverse-sync", "schedule": "*/15 * * * *" }
```

Convenciones específicas:
- **Cursor persistente.** Guardar el último `cursor` devuelto por Loyverse en una tabla `loyverse_sync_state` por endpoint (`receipts`, `items`, etc.). El cron retoma desde ese cursor — **no** desde "hace 15 min" (corredera de tiempo no es confiable).
- **Manejar paginación dentro del handler:** loop while `cursor` esté presente en la respuesta, hasta agotar.
- **Backoff y respeto al rate limit** de Loyverse (devuelven `429`; al toparse, registrar y salir, no retry agresivo — el siguiente tick lo retoma).
- **Idempotencia por `id` de Loyverse:** todos los upserts a Supabase usan `onConflict: 'loyverse_id'` (o el PK natural correspondiente).

---

## 6. Patrones de UI

### 6.1 Sesión y rutas privadas
- `pages/_app.js` carga la sesión Supabase y la inyecta como `pageProps.session`.
- Cada página privada hace:
  ```js
  useEffect(() => {
    if (!session) { router.push('/'); return }
    loadData()
  }, [session])
  ```
- Después se lee `perfil` desde la tabla `perfiles` (joineado con `estaciones`) y se decide rol (`perfil.rol === 'admin'`) y estación.

### 6.2 Layout
- Envolver el contenido de cada página privada en `<Layout perfil={perfil} estacion={estacion}>`. El layout maneja sidebar (desktop), topbar/drawer (móvil), modo noche, modal de cambio de contraseña y barra inferior móvil.
- El menú lateral está hardcodeado en `components/Layout.js` (`navItems`, `adminItems`, `contabilidadItems`). **Para Julia Bakery hay que reescribirlos** cuando definamos los módulos.

### 6.3 Toasts y skeletons
- Feedback al usuario: `const { toasts, toast } = useToast()` + `<ToastContainer toasts={toasts} />`. Tipos: `success`, `error`, `warning`, `info`.
- Estados de carga: usar `<SkeletonCard />`, `<SkeletonRow />`, `<SkeletonCircle />` de `components/Skeleton.js`. **No** spinners genéricos para listas/dashboards.

### 6.4 Modo noche
Lo maneja `Layout.js` con `localStorage('darkMode')` + `document.documentElement.classList.toggle('dark')`. Los overrides están en `styles/globals.css` (`html.dark .bg-white { ... }`). Si añadís componentes con colores nuevos, validá que se vean bien en modo noche o añadí los overrides ahí.

---

## 7. Reglas de estilo (código)

### JavaScript / React
- **Indentación:** 2 espacios. Sin punto y coma (es opcional en el codebase; mayoría sin `;`, algunos archivos con `;`. Al editar, mantené el estilo del archivo).
- **Comillas:** simples (`'...'`). JSX usa dobles (`"..."`) por convención de React.
- **Imports:** relativos (`../lib/supabase`), no usar alias de path (`@/...`) — no están configurados.
- **Componentes:** `export default function NombreComponente(props)`. PascalCase.
- **Hooks personalizados:** `useNombre` en camelCase, exportados como named export.
- **Helpers:** funciones top-level en el mismo archivo si son chicas; si son reutilizables, a `lib/`.
- **Async:** `async/await` con `try/catch`. Evitá `.then()` encadenado.

### Naming
- **Español** para todo lo de dominio (variables, comentarios, mensajes de error al usuario, nombres de archivos de features): `perfil`, `estacion`, `ventas`, `compras-pendientes.js`.
- **Inglés** para lo técnico/integraciones: `handler`, `session`, `tokenManager`, `salesreceipt`, `apiClient`.
- **kebab-case** para nombres de archivo de páginas/rutas API.
- **snake_case** en columnas de Supabase.
- **camelCase** en variables JS.

### Comentarios
- Encabezado breve al inicio de cada API route / cron explicando qué hace, su schedule (si aplica) y auth. Ejemplo:
  ```js
  // pages/api/cron/mi-job.js
  // Cron diario: descripción corta.
  // Schedule: 0 9 * * *  (3 AM GT)
  // Auth: Bearer ${CRON_SECRET}
  ```
- Dentro del código, comentar **el porqué**, no el qué. Si el código deja una decisión rara (un workaround, un ID hardcodeado, un cálculo de impuestos), explicarla.

### Tailwind
- Clases inline, sin `@apply`.
- Paleta dominante: grises (`gray-50` a `gray-900`), azul (`blue-600` acciones primarias, `blue-50/700` estados activos), verde para éxito, ámbar para advertencias, rojo para errores.
- Bordes suaves: `rounded-lg` / `rounded-xl` / `rounded-2xl` (cards). Sombras finas: `shadow-sm`.
- Espaciado generoso (`px-4 py-3`, `gap-2`/`gap-3`).
- Tamaños de texto pequeños por default (`text-xs`, `text-sm`). Evitar `text-base` salvo para titulares.

### SQL / Migraciones
- Archivo por migración en `migrations/YYYY_MM_DD_<descripcion>.sql`.
- Encabezado con `-- Migration:` + `-- Fecha:` + `-- Proposito:`.
- Usar `IF NOT EXISTS` / `IF EXISTS` para idempotencia.
- Añadir `COMMENT ON COLUMN` cuando el nombre no sea autoexplicativo.
- **RLS obligatorio.** Cada `CREATE TABLE` viene acompañado de:
  1. `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;`
  2. Políticas explícitas (`CREATE POLICY ...`) para `SELECT`/`INSERT`/`UPDATE`/`DELETE` según los roles que correspondan (`authenticated`, `service_role`, rol propio del perfil).
  3. Comentario explicando el modelo de acceso si no es trivial.
  Una tabla sin políticas con RLS habilitado queda **inaccesible para todos menos `service_role`** — verificarlo a propósito, no por descuido.

### Lo que **no** hacemos
- No agregar tests (no hay framework configurado). Si llega el momento, decidir antes Vitest vs Jest.
- No agregar Prettier/ESLint configs sin acordar. Los builds ignoran ambos hoy.
- No introducir TypeScript en archivos sueltos. O migramos todo o nada.
- No introducir SSR/getServerSideProps donde basta con fetch desde el cliente. El patrón actual es CSR puro contra Supabase.
- No instalar libs UI (shadcn, Radix, MUI) sin acuerdo. La UI está construida con Tailwind directo.

---

## 8. Scripts

```bash
npm run dev      # next dev (localhost:3000)
npm run build    # next build
npm run start    # next start (server de producción local)
```

No hay `lint`, `test` ni `format` configurados.

---

## 9. Notas de transición GasOps → Julia Bakery

Cosas que hay que decidir/hacer antes de tratar este repo como "Julia Bakery puro":

- [ ] Renombrar `name` en `package.json`.
- [ ] Reemplazar `public/logo.svg` y el texto `GasOps` en `Layout.js` e `index.js`.
- [ ] Reescribir `navItems` / `adminItems` / `contabilidadItems` en `components/Layout.js` con los módulos reales de la panadería.
- [ ] Eliminar módulos sin uso en panadería: `pages/tanques.js`, `pages/lubricantes.js`, `pages/wsm.js`, `pages/igss.js` (revisar), `pages/api/myposoft/`, `lib/myposoft/`, `pages/api/bac/`, `pages/api/neonet/`.
- [ ] Reescribir/reusar la integración FEL existente (`pages/api/fel/`) apuntando a **Digifact** una vez confirmada su API.
- [ ] Limpiar `lib/qbo/*` y `pages/api/qbo/*` y reconfigurar para la nueva cuenta QBO de Julia Bakery (mappings de items, customers, classes son específicos del negocio).
- [ ] Revisar `vercel.json` y desactivar los crons heredados (QBO sync por gasolineras, myposoft, etc.) — mantenerlos prendidos apuntando a tablas vacías es ruido y costo.
- [ ] Crear schema nuevo en Supabase para el dominio panadería (`receipts`, `items`, `inventory`, `employees`, `stores` espejando Loyverse, con RLS).

Mientras tanto, **al construir features nuevas, seguí los patrones de este documento** y dejá el código legacy quieto a menos que esté siendo migrado intencionalmente.
