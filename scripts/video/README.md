# Conduit POS · Generador de Video Lanzamiento

Script Node que toma tu API key de Google AI Studio y genera los 12 shots del video lanzamiento usando Veo. Tu key nunca se sube al repo ni pasa por nadie más que vos.

---

## Requisitos previos

- **Node.js 20+** (corré `node --version` para verificar)
- **API key de Google AI Studio con acceso a Veo**
  - Generala en https://aistudio.google.com/apikey
  - Verificá que tu cuenta tenga **billing habilitado** (Veo es paid, no free)
  - Verificá que **Veo aparezca** en aistudio.google.com (menú lateral "Video generation")

## Instalación

Una sola vez:

```bash
cd /Users/cjrh/conduit-pos
npm install @google/genai
```

## Uso

### Estimar costo sin generar

```bash
GOOGLE_API_KEY=tu_key_aqui node scripts/video/generate.js --dry-run
```

Muestra los 12 shots con costos individuales y total. **Cero llamadas a la API. Cero costo.**

### Generar todos los shots pendientes (recomendado)

```bash
GOOGLE_API_KEY=tu_key_aqui node scripts/video/generate.js
```

El script:
1. Lee qué shots ya generaste (revisa `video-output/shots/`)
2. Calcula el costo de los pendientes
3. **Pide confirmación** antes de empezar
4. Genera uno por uno con polling cada 15s
5. Reintenta hasta 3 veces si algún shot falla
6. Guarda progreso en `video-output/.video-state.json` (resumable)

### Generar solo un shot específico

```bash
GOOGLE_API_KEY=tu_key_aqui node scripts/video/generate.js --shot=5
```

Útil para reintentar uno fallido o iterar sobre el prompt de un shot.

### Usar Veo 2 en vez de Veo 3 (más barato, menos calidad)

```bash
GOOGLE_API_KEY=tu_key_aqui node scripts/video/generate.js --model=veo-2.0-generate-001
```

Veo 2 cuesta ~$0.10/seg (7.5× más barato), pero menos cinematic.

### Saltear la confirmación

```bash
GOOGLE_API_KEY=tu_key_aqui node scripts/video/generate.js --yes
```

## Output

```
conduit-pos/
└── video-output/
    ├── .video-state.json              ← progreso, ignorá
    └── shots/
        ├── shot-01-reloj-23-14.mp4    ← 5s, 16:9
        ├── shot-02-excel-rojo.mp4
        ├── shot-03-papeles-tachados.mp4
        ├── shot-04-counter-amanecer.mp4
        ├── shot-05-pos-revelado.mp4
        ├── shot-06-qr-factura.mp4
        ├── shot-07-ipad-comanda.mp4
        ├── shot-08-inventario-auto.mp4
        ├── shot-09-phone-pwa.mp4
        ├── shot-10-macbook-dashboard.mp4
        ├── shot-11-wide-bakery.mp4
        └── shot-12-logo-closing.mp4
```

## Estimación de costos

### Si usás Veo 3 (default, recomendado para Apple-quality)

| Item | Duración | Costo |
|---|---|---|
| 12 shots | 74 segundos | ~**$55** |
| Regeneración 30% | +22 seg | +$17 |
| **Total típico** | — | **~$72** |

### Si usás Veo 2 (budget)

| Item | Duración | Costo |
|---|---|---|
| 12 shots | 74 segundos | ~**$7.40** |
| Regeneración 50% | +37 seg | +$3.70 |
| **Total típico** | — | **~$11** |

> **Tip:** generá un shot piloto (Shot 5 — POS revelado, el más visible) con Veo 3 primero, validá que te guste, después decidí si vale la pena Veo 3 para todos o usás Veo 2 para los restantes.

## Tiempos de generación

| Por shot | ~2-3 min (a veces hasta 10) |
| Los 12 shots | **~30-60 min** wall-clock |
| Si fallan algunos | +5-10 min por reintento |

Mientras corre, podés dejar el terminal abierto y hacer otras cosas.

## ¿Qué hacer después de generar los MP4?

El script no edita el video. Solo genera los clips. Vos editás en:

1. **CapCut Desktop** (gratis, fácil) — recomendado
   - Importá los 12 MP4
   - Arrastrá al timeline en orden
   - Pegá la música (sugerencias en `brand/VIDEO_PROMPT_LAUNCH.md`)
   - Agregá text overlays según el storyboard
   - Render 1920×1080 H.264

2. **Final Cut Pro / DaVinci Resolve** — pro option

3. **Adobe Premiere** — si tenés suscripción

Tiempo de edición típico: **1-2 horas** para el primer cut.

## Troubleshooting

### "GOOGLE_API_KEY no está configurada"

Asegurate de exportarla en la misma línea o sesión:

```bash
export GOOGLE_API_KEY=tu_key_aqui
node scripts/video/generate.js
```

O todo en una línea (lo que recomendamos):

```bash
GOOGLE_API_KEY=tu_key_aqui node scripts/video/generate.js
```

### "Permission denied" o "Veo not available for your account"

Veo requiere billing. Andá a https://aistudio.google.com → Settings → enabled billing → verificá que aparezca "Video generation" como modelo disponible.

### Un shot falla con error transient (red, timeout)

El script reintenta hasta 3 veces solo. Si después de eso falla, podés correr:

```bash
GOOGLE_API_KEY=xxx node scripts/video/generate.js --shot=5
```

Solo regenera el shot 5.

### Querés cambiar un prompt antes de generar

Editá `scripts/video/shots.js`, modificá el prompt del shot que querés, y corré de nuevo. Va a regenerar solo los que no existen como MP4.

Si querés FORZAR regeneración de un shot que ya existe, borrá el MP4 primero:

```bash
rm video-output/shots/shot-05-pos-revelado.mp4
GOOGLE_API_KEY=xxx node scripts/video/generate.js --shot=5
```

### El video se ve "AI" — pupilas raras, dedos extras

Estos prompts están diseñados para **cero personas en frame** (config `personGeneration: 'dont_allow'`). Si aparece una persona accidentalmente, regenerá el shot. Si te pasa repetido en un shot, ajustá el prompt para reforzar "NO people, NO hands, NO faces".

## Seguridad

- ✅ Tu API key vive en tu sesión de shell
- ✅ NO se commitea al repo (`video-output/` está en `.gitignore`)
- ✅ NO se loggea en ninguna parte
- ❌ NO pegues la key en chats, Slack, emails, ni screenshots

Si por accidente exponés la key, regenerala inmediatamente desde https://aistudio.google.com/apikey
