# Conduit POS — Brand Applications

Cómo se aplica el sistema (logo + paleta + tipografía + voz) en los 5 touchpoints más importantes. Cada uno con un snippet de código real (no mockup raster) que se puede pegar directo al refactor.

---

## 1. Hero de Landing Pública (`conduit-pos.com`)

**Vibe Toast/Square premium:** color tomato + foto humana + tagline en serif warm + CTA grande.

```html
<section class="hero">
  <div class="hero-text">
    <h1>El POS para los<br/>que sí venden.</h1>
    <p>Conduit corre tu caja, tu factura electrónica, tu inventario,
       tu delivery y tu pickup. Una sola plataforma. Hecha en GT.</p>
    <div class="hero-cta">
      <a href="/demo" class="btn btn-primary">Ver demo</a>
      <a href="/casos" class="btn btn-ghost">Cómo lo usa Julia Bakery →</a>
    </div>
  </div>
  <div class="hero-photo">
    <!-- Foto: cajera real de Julia escaneando con Sunmi, 6:30am, luz cálida -->
    <img src="/img/hero-cajera-amanecer.jpg" alt="Cajera abriendo la tienda con Conduit POS" />
  </div>
</section>

<style>
.hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-12);
  background: var(--brand-cream);
  padding: var(--space-24) var(--space-12);
}
.hero h1 {
  font-family: var(--font-display);  /* Fraunces */
  font-size: var(--text-6xl);
  font-weight: var(--weight-bold);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-tight);
  color: var(--brand-espresso);
  margin-bottom: var(--space-6);
}
.hero p {
  font-family: var(--font-body);     /* Geist */
  font-size: var(--text-lg);
  line-height: var(--leading-normal);
  color: var(--brand-ink-soft);
  max-width: 40ch;
  margin-bottom: var(--space-8);
}
.btn-primary {
  background: var(--brand-primary);
  color: var(--brand-cream);
  padding: var(--space-4) var(--space-8);
  border-radius: var(--radius-sm);
  font-weight: var(--weight-semibold);
  box-shadow: var(--shadow-brand);
  transition: transform var(--duration-fast) var(--ease-quick);
}
.btn-primary:hover { transform: translateY(-1px); background: var(--brand-primary-hover); }
.hero-photo img {
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
```

**Foto:** SIN gente sonriendo a cámara stock. Owner trabajando real, perfil bajo, luz natural, manos en cuadro.

---

## 2. Login del POS (cajeros)

**Mantiene los botones grandes** (no rompemos hit-targets de Dalia/Alexander) pero sube el chrome a Conduit.

```jsx
// pages/index.js (login)
<div className="min-h-screen flex items-center justify-center"
     style={{ background: 'var(--brand-cream)' }}>
  <div className="w-full max-w-md p-8 rounded-2xl bg-white"
       style={{ boxShadow: 'var(--shadow-md)' }}>

    {/* Logo Conduit — concept-a-canal.svg */}
    <div className="mb-8 flex items-center justify-center gap-3">
      <ConduitLogo className="w-12 h-12" style={{ color: 'var(--brand-primary)' }} />
      <span className="text-2xl"
            style={{ fontFamily: 'var(--font-display)',
                     fontWeight: 700,
                     color: 'var(--brand-espresso)' }}>
        Conduit
      </span>
    </div>

    <h1 className="text-center text-xl mb-2"
        style={{ fontFamily: 'var(--font-display)',
                 color: 'var(--brand-espresso)' }}>
      ¿Cuál es tu PIN?
    </h1>
    <p className="text-center text-sm mb-6"
       style={{ color: 'var(--brand-ink-soft)' }}>
      Tu turno empieza cuando lo ingresás.
    </p>

    <NumericKeypad /> {/* botones grandes, sin cambio funcional */}
  </div>
</div>
```

**Lo crítico:** el `NumericKeypad` no se toca. Solo cambia el chrome alrededor. Cero riesgo a workflow del cajero.

---

## 3. Ticket Térmico (impresión)

Logo debe verse perfecto en B/N a 384px de ancho (papel de 58mm) o 576px (80mm). La C de Concept A funciona porque tiene forma sólida grande.

```
        ┌──────────────┐
        │              │
        │     ◖▬▬▬     │     ← logo Concept A, alto 60px
        │              │
        └──────────────┘
              conduit

   ━━━━━━━━━━━━━━━━━━━━━━━━━━━
   JULIA BAKERY                ← config_fel.nombre_comercial
   NIT 120302411
   Av. Las Américas 14-50
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━

   Factura serie A-001
   #00074    04/06/2026 18:39

   CONSUMIDOR FINAL  CF

   ───────────────────────────
    1 x  Cinammon Roll   Q 47
    1 x  Americano       Q 20
   ───────────────────────────
   TOTAL                Q 67
   ===========================

   Recurrente QR · Aprobado
   Cajero: Dalia Mishel

   [QR código SAT]

   ¡Gracias por venir!
   conduit-pos.com
```

**Implementación:** el componente actual `Ticket.js` solo necesita 2 cambios:
1. Reemplazar el logo Julia hardcoded por `process.env.NEXT_PUBLIC_BRAND_LOGO_URL` (o un SVG embebido a 1-bit)
2. Reemplazar el footer "juliabakery.com" por `process.env.NEXT_PUBLIC_BRAND_URL`

Todo lo demás (data del comercio, FEL, items) ya viene de Supabase y es per-tenant.

---

## 4. PWA Pickup (cliente final pidiendo online)

Aquí es donde la marca del TENANT vive (Julia Bakery, no Conduit). Conduit solo aparece sutil en el footer como "Powered by Conduit". El primary color es el del tenant.

```jsx
// pages/pickup/index.js
<header className="px-4 py-3"
        style={{ background: 'var(--tenant-cream, var(--brand-cream))' }}>
  <img src={tenantLogo}
       alt={tenantName}
       className="h-10"
       style={{ filter: 'none' }} />
</header>

<main className="px-4 py-6">
  <h1 className="text-3xl mb-2"
      style={{ fontFamily: 'var(--font-display)',
               color: 'var(--tenant-espresso, var(--brand-espresso))' }}>
    Pedí. Recogé. Listo.
  </h1>
  <p style={{ color: 'var(--tenant-ink-soft, var(--brand-ink-soft))' }}>
    Hoy: {todaySlots}. Pagás al recoger o con QR ahora.
  </p>
</main>

<footer className="text-center text-xs py-4"
        style={{ color: 'var(--brand-ink-mute)' }}>
  <a href="https://conduit-pos.com" target="_blank">
    Powered by <strong style={{ color: 'var(--brand-primary)' }}>Conduit POS</strong>
  </a>
</footer>
```

**Reglas multi-tenant:**
- `--tenant-primary`, `--tenant-cream`, `--tenant-espresso` se inyectan en `<html style="">` desde env vars
- Si el tenant no define algunas, caen a las defaults Conduit (los del `tokens.css`)
- El logo del tenant vive en Vercel Blob, URL en env var `NEXT_PUBLIC_TENANT_LOGO`

---

## 5. Email de Confirmación de Pedido

Cliente recibe email cuando termina su pedido en PWA Pickup. La marca es del TENANT, pero el "Powered by Conduit" queda en el footer.

```html
<!-- email plain HTML, optimizado para Gmail / Apple Mail -->
<table role="presentation" cellpadding="0" cellspacing="0" width="100%"
       style="background:#FBF7F0; padding:48px 0; font-family: Georgia, serif;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0">

      <!-- Logo del tenant -->
      <tr><td style="padding:32px 0; text-align:center;">
        <img src="{tenantLogoUrl}" alt="{tenantName}" width="120" />
      </td></tr>

      <!-- Mensaje principal -->
      <tr><td style="padding:0 32px;">
        <h1 style="font-family: Fraunces, Georgia, serif;
                   font-size: 32px;
                   color: #1F1411;
                   margin: 0 0 8px;
                   line-height: 1.1;">
          Tu pedido está listo, {nombreCliente}.
        </h1>
        <p style="font-family: -apple-system, sans-serif;
                  font-size: 16px;
                  color: #6E5C52;
                  margin: 0 0 24px;
                  line-height: 1.5;">
          {tenantName} ya tiene tu pedido <strong>{referencia}</strong> esperando.
          Pasá en cualquier momento entre {slotInicio} y {slotFin}.
        </p>

        <a href="{linkDetalle}"
           style="display: inline-block;
                  background: {tenantPrimary};
                  color: #FBF7F0;
                  padding: 14px 28px;
                  border-radius: 8px;
                  text-decoration: none;
                  font-family: -apple-system, sans-serif;
                  font-weight: 600;
                  font-size: 16px;">
          Ver mi pedido
        </a>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:48px 32px 16px; text-align: center;
                     font-family: -apple-system, sans-serif;
                     font-size: 12px; color: #9C8A7E;">
        Powered by <a href="https://conduit-pos.com"
                      style="color:#D7461C; text-decoration:none;">
          Conduit POS
        </a>
      </td></tr>

    </table>
  </td></tr>
</table>
```

---

## Checklist para el refactor Fase 2

Cuando trabaje el refactor multi-tenant, **estos son los archivos a tocar primero** para aplicar la marca Conduit como default:

| Archivo Julia actual | Acción |
|---|---|
| `tailwind.config.js` | Importar `tokens.css` y mapear las CSS vars a Tailwind colors/fonts |
| `styles/globals.css` | Reemplazar paleta julia-red por `var(--brand-primary)` |
| `components/Layout.js` | Logo del header → `process.env.NEXT_PUBLIC_TENANT_LOGO \|\| /conduit-logo.svg` |
| `pages/_app.js` | Inyectar CSS vars del tenant en `<html style>` desde env vars |
| `pages/index.js` (login) | Aplicar nuevo chrome login (ver arriba) |
| `pages/pickup/*` | Tema base Conduit (cream + tomato) que sobreescribe el tenant |
| `lib/pdf/branding.js` | Logo en PDFs/recetas/cotizaciones lee de env |
| `public/favicon-marca.png` | Reemplazar por favicon Conduit (Concept A en cream sobre tomato) |
| `package.json` | `name: "conduit-pos"` |
| `README.md` | Re-escribir como producto whitelabel |

Ninguno de estos cambios toca lógica de cobro, FEL, comandas, ni cierre de turno. Es **solo chrome**. Si lo hacés metódicamente, no rompés workflow operativo de Julia ni de ningún tenant futuro.
