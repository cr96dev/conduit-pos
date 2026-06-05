# Conduit POS

> **El POS para los que sí venden.**

Plataforma B2B SaaS whitelabel para panaderías, cafés y restaurantes en Guatemala y Centroamérica. POS + FEL Infile nativo + Recurrente QR + pickup PWA + cierre de turno + comandas + inventario, todo en un solo flujo.

Forked desde [`julia-bakery`](https://github.com/cr96dev/julia-bakery) (la flagship instance) y siendo refactoreado a multi-tenant.

---

## Estado

🚧 **Fase 1 completada** — repo clonado, brand kit definido.
⏳ **Fase 2 en curso** — refactor a multi-tenant (extracción de Julia-specific a env vars + tema base Conduit).
📋 **Fase 3 pendiente** — landing pública en `conduit-pos.com`.

---

## Estructura

```
/
├── brand/                    # Brand kit completo · empezar aquí
│   ├── STRATEGY.md           # Posicionamiento, audiencia, anti-positioning
│   ├── LOGO_CONCEPTS.md      # 3 direcciones de logo
│   ├── logos/                # SVGs vectoriales
│   ├── tokens.css            # Design system (colors, fonts, motion)
│   ├── VOICE.md              # Taglines + voice principles
│   ├── APPLICATIONS.md       # Snippets de aplicación con código
│   └── README.md             # Índice del kit
│
├── pages/                    # Next.js Pages Router (heredado de julia-bakery)
├── components/               # Layout, Toast, Skeleton
├── lib/                      # Cliente Supabase, qbo, recurrente, pickup, etc.
├── migrations/               # SQL versionado
├── public/                   # Assets estáticos
├── styles/                   # Tailwind + globals
├── vercel.json               # Crons + maxDuration
└── package.json
```

---

## Stack

- **Framework:** Next.js 14.2.3 con Pages Router (no App Router)
- **Lenguaje:** JavaScript (TypeScript opcional, no usado)
- **UI:** React 18 + Tailwind CSS 3.4
- **DB:** Supabase (PostgreSQL + Auth + RLS)
- **Hosting:** Vercel (Functions + Cron Jobs)
- **FEL GT:** Infile (certificación electrónica)
- **Pagos QR:** Recurrente live mode (HMAC svix webhooks + fallback consulta directa)
- **AI:** Anthropic API (`claude-haiku-4-5`)

---

## Setup local

```bash
git clone https://github.com/cr96dev/conduit-pos.git
cd conduit-pos
npm install
vercel env pull .env.local    # requiere acceso al Vercel project
npm run dev                   # localhost:3000
```

**Mínimos requeridos en `.env.local`:**

```bash
# Supabase del tenant
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Branding del tenant (overrides los defaults de Conduit)
NEXT_PUBLIC_TENANT_NAME="Mi Negocio"
NEXT_PUBLIC_TENANT_LOGO_URL=
NEXT_PUBLIC_TENANT_PRIMARY=#D7461C
NEXT_PUBLIC_TENANT_URL=

# FEL Infile del tenant
# (se cargan en tabla config_fel, no en env)

# Recurrente (per tenant)
RECURRENTE_SECRET_KEY=
RECURRENTE_WEBHOOK_SECRET=

# Crons internos
CRON_SECRET=
INTERNAL_API_SECRET=

# AI
ANTHROPIC_API_KEY=
```

---

## Multi-tenancy model

**Una instalación = un tenant.** Cada tenant tiene:

- Su propio **Vercel project** apuntando a este mismo repo
- Su propio **Supabase database** (RLS + service_role per tenant)
- Sus propias **env vars** (branding + claves Infile + Recurrente)
- Su propio **subdomain o domain** (`tenant1.conduit-pos.com` o `pos.tenant1.com`)

El código es 100% compartido. Updates se despliegan a todos los tenants al mismo tiempo (o por canary release con Rolling Releases de Vercel).

**Onboard de un cliente nuevo:** ~1 día (crear Supabase, correr migrations, configurar Vercel project, cargar env vars, importar catálogo Loyverse, configurar Infile).

---

## Lo que vino de Julia Bakery (queda igual)

- Toda la lógica de POS, turnos, FEL Infile, comandas, pickup PWA, Recurrente
- Schema de Supabase (RLS obligatorio)
- Patterns de API routes, crons, auth
- Wrapper Android para Sunmi (`Julia Print` → renombrar a `Conduit Print`)

## Lo que se extrae a env vars (Fase 2)

- Logo, nombre comercial, color primario, dominio, copy "Julia Bakery"
- NIT emisor, alias firma Infile (ya viven en `config_fel`)
- Claves QBO, Recurrente, Anthropic

## Lo que NO se toca (riesgo a producción Julia)

- Layout del POS cajero (`/pos`) — funcional, no estético
- Hit-targets de botones grandes
- Workflow de cobro, FEL certificación, cierre turno

---

## Brand

Lee `brand/README.md` para empezar. Decisiones pendientes y framework completo del sistema.

---

## License

Privado. Todos los derechos reservados.

🤖 Forked from julia-bakery with [Claude Code](https://claude.com/claude-code)
