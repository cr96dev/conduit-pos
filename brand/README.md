# Conduit POS — Brand Kit v0.1

Este directorio contiene el sistema de marca completo de Conduit POS — el design system base que todos los tenants whitelabel heredan.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| [`STRATEGY.md`](STRATEGY.md) | Posicionamiento, audiencia, metáfora central, anti-positioning. Empezar acá. |
| [`LOGO_CONCEPTS.md`](LOGO_CONCEPTS.md) | 3 direcciones de logo con comparativa. Hay que elegir una antes de Fase 2. |
| [`VOICE.md`](VOICE.md) | Taglines candidatas, voice principles, tono según contexto, anti-patterns. |
| [`APPLICATIONS.md`](APPLICATIONS.md) | Cómo se aplica en hero, POS, ticket, PWA pickup, email. Con snippets de código. |
| [`tokens.css`](tokens.css) | Sistema de design tokens (colores, tipografía, espaciado, sombras, motion). Drop-in para `styles/globals.css`. |
| [`logos/`](logos/) | SVGs de los 3 concepts. Recomendado: `concept-a-canal.svg`. |

## Decisiones pendientes

Antes de empezar Fase 2 (refactor multi-tenant), hay que confirmar:

- [ ] **Logo direction final** — Concept A · Canal (⭐ recomendado), B · Sello, o C · Pase
- [ ] **Color primario exacto** — default `#D7461C` tomato; alternativas en tokens.css
- [ ] **Tipografía** — confirmar Fraunces + Geist (ambas free en Google Fonts)
- [ ] **Tagline primaria** — recomendado #1 "El POS para los que sí venden."
- [ ] **Nombre en assets** — "Conduit POS" full vs "Conduit" solo
- [ ] **Dominio** — `conduit-pos.com`, `conduit.gt`, `useconduit.com`, otro

## Próximos pasos

1. Review + decisiones pendientes ↑
2. Generar variantes obligatorias del logo elegido (mark only, wordmark, lockups, reverse, B/N)
3. Fase 2: refactor multi-tenant en este repo. Convertir todo lo Julia-específico a env vars con default Conduit.
4. Fase 3: landing pública `conduit-pos.com` con la marca aplicada full premium.

## ¿Necesitás un board visual para pitch deck?

Este kit es accionable para código pero NO incluye boards de imagen tipo Midjourney/brandkit. Si lo necesitás para mostrar a inversores o vendedores, pasame el OK y armamos los prompts para generar 6-9 panels con Gemini/Midjourney basados en este `STRATEGY.md` + `tokens.css`.
