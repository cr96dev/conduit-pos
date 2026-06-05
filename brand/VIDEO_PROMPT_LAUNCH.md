# Conduit POS — Video Lanzamiento (Apple-style)

Storyboard cinematográfico de **75 segundos** para video lanzamiento de plataforma. Estética: Apple keynote / Stripe Sessions / Linear product reveal.

---

## Visión general

**Duración total:** 75 segundos
**Aspect ratio:** `16:9` (1920×1080 o 3840×2160)
**Paleta:** negro profundo → cream cálido → tomato red accents → espresso brown
**Música:** ambient electronic + minimal piano, tipo Hans Zimmer-meets-Stranger-Things, build emocional
**Voz:** una sola frase corta por sección, voz femenina o masculina seria, español neutro

**Arco narrativo:**
1. **Tensión** (0-15s) — el problema: operador agotado, papeles, cuadre manual a las 11pm
2. **Promesa** (15-25s) — el amanecer: hay una mejor manera
3. **Revelación** (25-55s) — el producto: hardware + UI + features
4. **Prueba** (55-67s) — números reales, Julia operando
5. **Marca** (67-75s) — logo + tagline + URL

---

## Herramientas recomendadas para generar

| Tool | Costo | Calidad | Length clips | Mi pick |
|---|---|---|---|---|
| **Sora 2** (OpenAI Plus/Pro) | $20-200/mes | Mejor narrativo | hasta 20s | ⭐ Si tenés acceso |
| **Veo 3** (Google) | Vía Vertex AI | Excelente | hasta 8s | ⭐ Alternativa premium |
| **Runway Gen-4 Alpha** | $35/mes | Muy buena | hasta 10s | Plan B |
| **Kling 2.1** | ~$20/mes | Buena | hasta 10s | Budget option |
| **Luma Ray 2** | $25/mes | Buena cinematics | hasta 10s | Para shots atmosféricos |

**Workflow:** Generá cada shot individual con el prompt correspondiente, descargá los clips, editá en CapCut / Final Cut / Premiere con la música y los text overlays.

---

## STORYBOARD

### Shot 1 — 0:00 → 0:05 (5s) — La hora cruel

**Lo que vemos:** Pantalla casi negra. Un reloj digital marca **23:14** parpadeando suavemente en luz cálida. Slow zoom out muy lento.

**Prompt video:**
```
Cinematic close-up of a single dim warm-glow digital clock display reading 23:14 in a dark room. Very slow zoom-out revealing a corner of a wooden counter and the silhouette of an open laptop with a faint glow. Pure black ambient background, single warm tungsten light source from the left. Hyperrealistic, shot on Arri Alexa, anamorphic lens, film grain. Color grading: deep blacks, warm amber highlights only. Mood: tense, lonely, late night. 5-second shot, slow motion, no camera shake.
```

**Audio:** silencio + tick suave de reloj + un piano grave que entra al segundo 3

---

### Shot 2 — 0:05 → 0:10 (5s) — Excel infinito

**Lo que vemos:** Pantalla de Excel sobre laptop oscura, cursor moviéndose lento por filas de números, alguna celda en rojo marcando "Diferencia: -Q 47.00". El cursor tiembla.

**Prompt video:**
```
Tight overhead shot of a dark laptop screen displaying an Excel spreadsheet with rows of numbers in a dim room. A single cell highlighted in red showing "−Q 47.00". The mouse cursor slowly drifts across the screen, hesitating, indecisive. Background: blurry darkness, only the screen glow lights the frame. Color: dark amber from screen, cold blue around. Mood: frustration, fatigue. 5-second shot, locked-off camera, no movement. Hyperrealistic, screen recording aesthetic with photographic depth.
```

**Audio:** tecleo suave + click de mouse + piano sigue creciendo

---

### Shot 3 — 0:10 → 0:15 (5s) — Papeles acumulados

**Lo que vemos:** Macro top-down de una mano (solo dedos y nudillos, no cara) tachando con bolígrafo rojo sobre un papel impreso de POS antiguo. Atrás se ven más papeles arrugados.

**Prompt video:**
```
Macro top-down shot of an anonymous hand (only fingers visible, partial frame) crossing out numbers with a red ballpoint pen on a crumpled paper receipt. Multiple wrinkled paper receipts scattered on a dark wooden desk surface in the background. Single warm tungsten light from upper-left creating dramatic shadow. Color: cream paper, red pen mark, deep brown wood, warm amber tones. Mood: exhausting, frustrating, repetitive. Shot at 1:1 macro on Sony A7R, 90mm lens, f/2.8, slight handheld shake. NO face, NO arm visible.
```

**Audio:** roce del bolígrafo, papel arrugado en background

---

### Shot 4 — 0:15 → 0:20 (5s) — El amanecer

**Lo que vemos:** Crossfade lento. La oscuridad se transforma. Counter de madera vacío, luz dorada del amanecer entrando desde la derecha. Sin tecnología visible aún.

**Prompt video:**
```
Cinematic wide shot of an empty warm wooden bakery counter at dawn. Soft golden morning light streams in from a window on the right, creating long warm shadows across the counter surface. The counter is completely empty — clean, ready, anticipatory. Background: out-of-focus warm cream walls. Slow lateral camera move from left to right, very smooth. Color: warm cream, golden hour amber, deep walnut brown. Mood: calm, hopeful, fresh start. Shot on Arri Alexa with 50mm anamorphic at f/4. 5-second shot, smooth dolly movement, no shake. Photorealistic, NOT 3D render.
```

**Audio:** piano cambia a tono mayor + ambient pad cálido entra

**Text overlay (optional):** ninguno

---

### Shot 5 — 0:20 → 0:30 (10s) — La revelación

**Lo que vemos:** En el mismo counter, un POS terminal materializa (push-in lento). Pantalla se enciende con un glow cálido tomato. Apple-keynote vibe.

**Prompt video:**
```
Cinematic slow push-in toward a sleek small dark POS terminal sitting alone in the center of a warm wooden counter. The terminal screen ignites with a soft warm tomato-red glow that radiates and intensifies as the camera approaches. Dramatic side lighting creates a long shadow. The terminal feels precious, important, intentional. Background: completely out of focus cream walls, soft warm bokeh. Color palette: tomato red glow #D7461C, cream background, deep espresso brown counter. Cinematic anamorphic 50mm lens at f/2.8. 10-second smooth push-in dolly shot, no camera shake. Apple product reveal aesthetic. Photorealistic, NOT 3D render.
```

**Audio:** music builds — string section + electronic synth swell

**Text overlay (sutil, 24-28s):**
> _Conduit POS_

---

### Shot 6 — 0:30 → 0:38 (8s) — QR + factura instantánea

**Lo que vemos:** Macro: un celular acerca su QR a la pantalla del POS → flash sutil tomato → ticket térmico empieza a salir de impresora.

**Prompt video:**
```
Hyper-realistic macro sequence showing three actions in continuous flow: First, a smartphone screen displaying a QR code approaches a POS terminal screen. Second, a soft tomato-red flash of light pulses between them, indicating successful payment. Third, immediately a thermal printer to the side begins ejecting a freshly printed receipt with visible cream paper texture. NO hands or faces visible — just devices and paper. Dramatic side lighting, deep walnut wood counter, warm cinematic color grade. Shot on Phase One IQ4 with 80mm macro lens at f/4. 8-second shot, smooth slow-motion (1.5x speed reduction). Photorealistic, NOT 3D render.
```

**Audio:** subtle "chime" sound + printer mechanical click

**Text overlay (32-37s):**
> _Cobro QR. Factura FEL. 8 segundos._

---

### Shot 7 — 0:38 → 0:44 (6s) — Comanda al iPad

**Lo que vemos:** Cut a cocina. Un iPad sobre superficie metálica vibra suavemente, muestra notificación "Cinnamon roll · Cappuccino" en cream UI. Vapor sutil entrando del lado.

**Prompt video:**
```
Editorial shot of an iPad in a minimalist stand mounted on a stainless steel kitchen prep surface. The iPad screen lights up with a soft cream-colored interface showing an order notification. Light steam drifts across the frame from the right edge (suggesting espresso machine activity). Single overhead warm tungsten light. Background: blurred kitchen environment, hints of metal and dark surfaces. Color: cream UI, stainless steel reflections, warm amber rim light, single tomato-red status dot. 6-second locked-off shot with very subtle pan. Shot on Sony FX6 with 35mm lens at f/2.8. Photorealistic.
```

**Audio:** soft notification ping + steam hiss

**Text overlay (40-43s):**
> _Comanda en cocina. Cero pasos._

---

### Shot 8 — 0:44 → 0:50 (6s) — Inventario auto-descuento

**Lo que vemos:** Pantalla minimalista cream con números bajando — "245 → 244 → 243" con número rojo alertando "Cinnamon roll: stock crítico".

**Prompt video:**
```
Macro screen capture of a clean cream-colored dashboard interface showing inventory numbers ticking down in real-time: a number changes from 245 to 244 to 243 with a smooth digital transition. A small tomato-red alert badge pulses gently next to one item. Background: very subtle bokeh of a warm office environment. The interface design is Linear-clean meets warm bakery aesthetic. No readable text other than the numbers. Shot at 50mm at f/4, screen-only with photographic depth-of-field. 6-second shot, locked-off camera. Photorealistic interface, NOT pure 3D render.
```

**Audio:** subtle digital counter sound + soft pulse

**Text overlay (46-49s):**
> _Inventario que se descuenta solo._

---

### Shot 9 — 0:50 → 0:58 (8s) — PWA Pickup

**Lo que vemos:** Macro de un iPhone vertical mostrando UI cream con grid de productos. Botón tomato "Pedir ahora" pulsa. Background blurred — cliente en café.

**Prompt video:**
```
Studio product photography of a modern smartphone standing vertically on a warm wooden surface. The screen displays a soft cream-colored mobile bakery app interface showing a product grid (no readable text, abstract rounded card shapes). A prominent tomato-red CTA button at the bottom pulses with a subtle glow animation. Single dramatic side light from upper-left creating a soft long shadow. Background: completely out of focus warm tungsten lights and hints of café atmosphere. Color: cream UI, espresso brown wood, tomato-red CTA, golden bokeh. Subtle reflection on wood surface. 8-second locked-off shot with very slow zoom-in. Shot on Hasselblad with 80mm at f/4. Apple product launch aesthetic. NO hands, NO faces.
```

**Audio:** music swells + soft click of "Pedir ahora"

**Text overlay (53-57s):**
> _Tu PWA pickup. Tu marca._

---

### Shot 10 — 0:58 → 1:05 (7s) — El dashboard

**Lo que vemos:** Open MacBook sobre desk, screen mostrando dashboard con números reales subiendo. "Q 8,227 hoy" en grande, charts animándose.

**Prompt video:**
```
Editorial product photography of an open MacBook on a warm wooden desk. The screen displays a clean cream-colored dashboard with abstract data visualizations — a large prominent number "Q 8,227" smoothly counts up from zero over the duration of the shot. Subtle tomato-red accent dots indicate data points on rounded chart shapes. Background: out-of-focus warm window light, blurred bakery shelves. Color: cream UI, deep walnut wood, espresso brown, single tomato-red data accents. Shot on Hasselblad with 50mm at f/2.8, cinematic warm color grade. 7-second smooth slow zoom-in. Photorealistic, NOT 3D render.
```

**Audio:** music reaches climax + soft digital tick of numbers counting

**Text overlay (60-64s):**
> _Q 8,227 facturados hoy. Sin Excel._

---

### Shot 11 — 1:05 → 1:12 (7s) — La validación

**Lo que vemos:** Wide editorial shot — bakery operando en su mejor día. POS visible, productos en exhibición, ambient warm light, todo en flujo.

**Prompt video:**
```
Wide cinematic shot of a beautiful artisan bakery operating in full flow at golden hour. Visible in middle ground: a POS terminal glowing softly, fresh croissants and cinnamon rolls on display, the receipt printer with a fresh ticket curled at its base. Warm afternoon light streams in creating long shadows. Background: blurred terracotta walls, hints of activity, no clearly visible people. Color palette: warm cream, deep walnut wood, terracotta accents, tomato-red glow from devices, golden hour amber. Slow lateral dolly camera move from left to right. Shot on Arri Alexa with anamorphic 35mm at f/4. 7-second smooth dolly, no shake. Mood: validation, success, calm productivity. Photorealistic.
```

**Audio:** music sustains, full emotional release

---

### Shot 12 — 1:12 → 1:15 (3s) — Closing brand

**Lo que vemos:** Cut to black absoluto. La C de Conduit emerge en cream sobre negro (fade-in). Wordmark "Conduit" aparece al lado. Tagline aparece debajo. URL bajo todo.

**Prompt video:**
```
Pure black background. A bold geometric capital letter C (with a horizontal bar through its center) fades in smoothly in warm cream color, centered. The wordmark "Conduit" appears smoothly to its right in elegant grotesk sans-serif. Below, in smaller text: "El POS para los que sí venden." Even smaller URL at the bottom: "conduitgt.net". All text and the C-mark are in single warm cream color #FBF7F0 on pure black. 3-second shot, no camera movement, only graphics elements fade in sequentially with smooth easing. Apple product launch closing aesthetic.
```

**Audio:** music resolves to a single sustained note + soft "swoosh" on logo fade

**Text overlay (full duration):**
```
        ◖▬▬▬  Conduit

   El POS para los que sí venden.

           conduitgt.net
```

---

## TIMING TABLE — para edición

| Tiempo | Duración | Shot | Música | Voz/Texto |
|---|---|---|---|---|
| 0:00 | 5s | Reloj 23:14 | Tick + piano grave | — |
| 0:05 | 5s | Excel rojo | Piano sube | — |
| 0:10 | 5s | Papeles tachados | Tensión sube | — |
| 0:15 | 5s | Counter al amanecer | Piano cambia mayor | — |
| 0:20 | 10s | POS revelado | String swell | "Conduit POS" |
| 0:30 | 8s | QR + factura | Chime | "Cobro QR. Factura. 8 seg." |
| 0:38 | 6s | iPad comanda | Notification | "Comanda en cocina." |
| 0:44 | 6s | Inventario auto | Digital tick | "Inventario que se descuenta solo." |
| 0:50 | 8s | Phone PWA | Music swell | "Tu PWA pickup. Tu marca." |
| 0:58 | 7s | MacBook dashboard | Climax | "Q 8,227 hoy. Sin Excel." |
| 1:05 | 7s | Wide bakery | Release | — |
| 1:12 | 3s | Logo close | Resolución | "Conduit · conduitgt.net" |

**Total:** 75 segundos

---

## Audio + Música

**Estilo:** Hans Zimmer minimal piano meets electronic ambient (Tycho, Bonobo). Build emocional desde tensión a release.

**Estructura sonora:**
- **0-15s:** silencio inicial + tick reloj + piano grave que entra al 3
- **15-25s:** piano cambia de menor a mayor, ambient pad cálido
- **25-55s:** string section sube en capas, tensión + esperanza
- **55-67s:** climax — full orchestra + electronic textures
- **67-75s:** resolution — vuelve a piano simple sostenido

**Libraries gratis con esto:** YouTube Audio Library ("Vivid", "Sunlight"), Pixabay Music, Epidemic Sound (suscripción).

---

## Voz en off (opcional)

Si querés una sola voz minimal en español:

- **0:18:** "Hay una mejor manera."
- **0:30:** "Cobrás. Facturás. Imprimís. En segundos."
- **0:58:** "Y todo se queda registrado. En orden."
- **1:08:** "Conduit. El POS para los que sí venden."

Voz: profesional, calma, NO publicitaria-vendedora. Imaginá la voz de Jony Ive describiendo un producto. Pago: ElevenLabs Voice o contratá voice actor por Fiverr (~$50 GT).

---

## Workflow completo

### Plan A — Sora 2 (si tenés acceso ChatGPT Pro)

1. Pegá los 12 prompts de Shot, uno por uno
2. Generá 2-3 variantes por shot, elegí la mejor
3. Descargá los 12 clips
4. Importá a CapCut o Final Cut
5. Agregá música + text overlays + audio cues
6. Exportá 1920×1080, 24fps, H.264

### Plan B — Veo 3 vía Vertex AI

Similar, pero clips de 8s máx (algunos shots los reducís de 10s a 8s).

### Plan C — Kling 2.1 ($20/mes, budget)

Genera con buena calidad pero shots de 10s. Workflow idéntico al Plan A.

### Edición — tiempo estimado

- Generación clips: 30-60 min
- Edición timeline: 1-2 hr
- Música + voz: 30-45 min
- Render final + revisión: 30 min

**Total:** 3-4 horas para el primer cut

---

## Dónde usar el video

- **Hero del landing** (autoplay muted, fallback a imagen estática)
- **Instagram Reels / TikTok** (cortar a 30s)
- **YouTube ads** (versión 60s + skip 6s teaser)
- **Pitch deck a inversores** (slide 1)
- **Email firma** (link al video)
- **Stand de feria comercial** (loop continuo)

---

## Si querés algo más corto

Versión **30s ad-ready:**
- 0-3s: Reloj 23:14 + papeles (combinado)
- 3-8s: POS revealed + glow
- 8-13s: QR pago + factura
- 13-18s: PWA phone + dashboard
- 18-25s: Wide bakery operando
- 25-30s: Logo + tagline + URL

Versión **6s teaser (TikTok/Instagram bumper):**
- 0-2s: Cut rápido entre 5 features de Conduit en flash montage
- 2-5s: POS terminal con glow tomato + tagline
- 5-6s: Logo Conduit + URL

---

## Estimación de presupuesto

| Item | Costo estimado |
|---|---|
| Sora 2 / Veo 3 generation | $20-40 (1 mes suscripción) |
| Música licencia (Epidemic Sound) | $15 (1 mes) |
| Voz en off ElevenLabs | $5 (créditos) |
| Edición CapCut Pro | Gratis o $7/mes |
| **Total para primera versión** | **$50-70** |

Versus video profesional con productora en Guatemala: $1,500-5,000.

---

## Lo que NO hagas

❌ NO incluyas caras humanas — las IAs todavía fallan con detalles
❌ NO uses texto en pantalla que la IA genere — overlay en edición
❌ NO uses logos de competidores (Stripe, Square) como referencia visible
❌ NO uses música del top 40 sin licencia
❌ NO escribas la tagline en inglés primero — siempre español primero (es el mercado objetivo)
❌ NO uses transiciones de PowerPoint (zoom, swipe). Solo cuts + fades + dolly moves naturales

✅ Sí pedí: f-stop, lente, color grading, mood, camera movement explícito en cada prompt
