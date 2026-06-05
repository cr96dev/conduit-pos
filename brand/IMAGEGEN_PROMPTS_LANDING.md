# Conduit POS — Prompts AI para placeholders del landing

Prompts paste-ready para **Gemini 2.5 Flash Image** (gratis · [aistudio.google.com](https://aistudio.google.com)) o **Midjourney v7**.

Genera 4 variantes de cada uno, elegí la mejor. Workflow al final.

---

## Image 1 — Hero atmosférico (más importante)

**Donde va:** Reemplaza el bloque tomato del hero (right side). Es lo primero que ve el visitante.

**Aspect ratio:** `4:5` (vertical)

```
Documentary-style photograph of a Guatemalan female cashier in her late twenties, dark hair pulled back, wearing a simple cream-colored apron, leaning over a small dark tablet POS terminal on a warm wooden counter. Early morning soft golden light from windows on her left. Behind her, slightly out of focus, fresh croissants and cinnamon rolls on a metal baking rack. The mood is calm, focused, professional — she is concentrated on the screen, not smiling at camera. The terminal screen glows softly with a warm orange-red interface (no text visible, just abstract warm glow). Editorial color grading: warm creams, terracottas, deep browns. Shot on 50mm lens, shallow depth of field, photographic realism. Composition: woman occupies right two-thirds of frame, counter and terminal in foreground. Cinematic, intentional, not stock photo. Aspect ratio 4:5.
```

**Si Gemini te da algo muy "stock":** agregá al final del prompt: `Saul Leiter influence, candid moment, documentary realism, NOT corporate stock photography, NOT smiling at camera.`

---

## Image 2 — Customer Story (Dalia panel)

**Donde va:** Reemplaza el bloque oscuro de la sección "Caso real · Julia Bakery", donde va el quote de Dalia.

**Aspect ratio:** `4:5` (vertical)

```
Editorial photography of a young Guatemalan woman, mid-twenties, working as a cashier at a small artisan bakery. She is at the counter, both hands resting on it, looking down at a tablet POS interface. Soft warm tungsten lighting from above and behind her. She wears a deep brown apron over a cream blouse. Out-of-focus warm background: shelves with brown paper bags, a chalkboard with handwritten menu items, terracotta wall. Her expression is calm and present — neither smiling nor frowning. The tablet screen reflects a subtle orange-red glow on her chin and hands. Composition: she's slightly off-center to the left, frame extends right to show the bakery atmosphere. Color palette: deep espresso brown, warm cream, tomato red accents (kept minimal). Shot 35mm wide, photographic realism, slight film grain. NOT looking at camera. NOT corporate smile. Documentary moment. Aspect ratio 4:5.
```

---

## Image 3 — Caso Julia hero (página /casos/julia-bakery)

**Donde va:** Hero de la página de caso de estudio.

**Aspect ratio:** `16:9` (horizontal)

```
Wide editorial photograph of an artisan bakery interior at opening time, 6:30 AM in Guatemala City. Wooden shelves filled with fresh croissants, cinnamon rolls, brioches, and laminated pastries arranged on raw aluminum trays. A dark wooden counter in the foreground with a small Sunmi-style POS tablet visible (kept simple, no readable text on screen). Warm tungsten lighting mixed with soft cool dawn light from a side window. A barista barely visible in the deep background, slightly blurred, working at an espresso machine. Color palette: warm wood, cream walls, terracotta accents, deep browns. The mood is quiet anticipation — the day hasn't started yet, but the bakery is alive. Editorial composition with strong leading lines. Photography style, NOT 3D render. Shallow depth of field, 50mm lens. Aspect ratio 16:9.
```

---

## Image 4 — "Detrás de barra" (opcional, para sección How it works)

**Donde va:** Podría ir en el "Step 2 · Operación" de la sección Cómo funciona.

**Aspect ratio:** `4:3` (horizontal medio)

```
Photograph from the customer's perspective at a small Guatemalan café counter. Foreground: out-of-focus customer's hands holding a cream-colored ceramic cup of espresso. Mid-frame: the wooden counter with a small dark Sunmi-style POS terminal showing a warm interface glow. Background: a female barista in profile, slightly out of focus, working at an espresso machine, steam rising. Warm morning light streaming from the right. Color grading: deep browns, cream, terracotta, with a subtle tomato-red glow from the terminal. Photographic realism, 35mm lens, photographer at customer's eye level. The mood is intimate, calm, mid-morning. Aspect ratio 4:3.
```

---

## Image 5 — "El equipo" (opcional, futuro caso "About us")

```
Editorial portrait of a Guatemalan small business owner in his thirties — short dark hair, casual button-up shirt, leaning against a wooden counter inside a small artisan bakery. Warm afternoon light from a side window. He's looking off-camera, slight smile, calm and confident expression. Out-of-focus background: shelves with paper-wrapped bread loaves, a small chalkboard, terracotta wall. Color palette: warm wood, cream, deep browns, subtle terracotta. Shot 85mm lens portrait style, soft bokeh background, photographic realism. NOT a stock business portrait. Documentary feel. Aspect ratio 4:5.
```

---

## Workflow recomendado

### Paso 1 — Generar en Gemini (15 min)

1. Andá a https://aistudio.google.com → login Google
2. Click el botón **Image generation**
3. Pegá el prompt de Image 1
4. Generá 4 variantes
5. Click la mejor → **Download** → guardá como `hero-cajera.png`
6. Repetí con Image 2 → `story-dalia.png`
7. Image 3 → `caso-julia-hero.png`
8. Image 4 (opcional) → `barra-cliente.png`

### Paso 2 — Pasame los archivos

Subí los 3-4 PNG a un folder (Google Drive, Dropbox, o pegame los archivos directamente). Te confirmo cuáles me gustan más y cuáles vale la pena regenerar.

### Paso 3 — Yo integro (15 min)

1. Subo a Vercel Blob (CDN rápido, cache global)
2. Reemplazo los gradientes CSS por `<img>` tags
3. Optimizo responsive + lazy loading
4. Mantengo overlays de texto / receipts CSS encima donde hace falta
5. Commit + push → live en conduitgt.net en 60 segundos

---

## Si no te gusta cómo se ven los outputs de Gemini

**Plan B:** Midjourney v7 — calidad superior pero paga ($10/mes). Te puedo reformatear los mismos prompts al estilo Midjourney (separadores `--ar 4:5 --style raw --v 7` etc).

**Plan C:** Flux Pro 1.1 via fal.ai — un poco caro pero da imágenes hyper-realistas. ~$0.04/imagen.

---

## ⚠️ Lo que vas a notar

- **Caras AI todavía tienen sutiles "AI tells"** (pupilas raras, manos con dedos extras). Mirá de cerca antes de usar.
- **Texto en pantallas del POS sale random** — por eso mantenemos overlay CSS encima en producción.
- **Diversidad étnica** — Gemini por default suele dar caras genéricas latino-americanas. Si querés específicamente afro-guatemalteca, maya, mestiza, agregalo al prompt.

Si el output de Gemini te decepciona, escalamos a Midjourney o Flux y te ayudo a calibrar.
