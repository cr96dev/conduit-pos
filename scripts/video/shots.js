// scripts/video/shots.js
// Storyboard de los 12 shots del video lanzamiento Conduit POS.
// Cada shot tiene: id, label, durationSeconds, aspectRatio, prompt.
// Veo 3 acepta: aspectRatio 16:9, 9:16, 1:1 — durationSeconds: 4 a 8.
// Para shots de 10s+ del storyboard original, los cortamos a 8s y los
// extendemos en edición con ralenti o crossfade.

export const shots = [
  {
    id: 1,
    label: 'Reloj 23:14',
    durationSeconds: 5,
    aspectRatio: '16:9',
    prompt: `Cinematic close-up of a single dim warm-glow digital clock display reading 23:14 in a dark room. Very slow zoom-out revealing a corner of a wooden counter and the silhouette of an open laptop with a faint glow. Pure black ambient background, single warm tungsten light source from the left. Hyperrealistic, shot on Arri Alexa, anamorphic lens, film grain. Color grading: deep blacks, warm amber highlights only. Mood: tense, lonely, late night. Slow motion, no camera shake.`,
  },
  {
    id: 2,
    label: 'Excel rojo',
    durationSeconds: 5,
    aspectRatio: '16:9',
    prompt: `Tight overhead shot of a dark laptop screen displaying a spreadsheet with rows of numbers in a dim room. A single cell highlighted in red showing a negative value. The mouse cursor slowly drifts across the screen, hesitating, indecisive. Background: blurry darkness, only the screen glow lights the frame. Color: dark amber from screen, cold blue around. Mood: frustration, fatigue. Locked-off camera, no movement. Hyperrealistic.`,
  },
  {
    id: 3,
    label: 'Papeles tachados',
    durationSeconds: 5,
    aspectRatio: '16:9',
    prompt: `Macro top-down shot of an anonymous hand holding a red ballpoint pen, crossing out numbers on a crumpled paper receipt. Multiple wrinkled paper receipts scattered on a dark wooden desk surface in the background. Single warm tungsten light from upper-left creating dramatic shadow. Color: cream paper, red pen mark, deep brown wood, warm amber tones. Mood: exhausting, frustrating, repetitive. Macro 90mm lens, f/2.8, slight handheld shake. NO face, partial hand only.`,
  },
  {
    id: 4,
    label: 'Counter amanecer',
    durationSeconds: 5,
    aspectRatio: '16:9',
    prompt: `Cinematic wide shot of an empty warm wooden bakery counter at dawn. Soft golden morning light streams in from a window on the right, creating long warm shadows across the counter surface. The counter is completely empty — clean, ready, anticipatory. Background: out-of-focus warm cream walls. Slow lateral camera move from left to right, very smooth. Color: warm cream, golden hour amber, deep walnut brown. Mood: calm, hopeful, fresh start. 50mm anamorphic at f/4. Smooth dolly movement, no shake. Photorealistic, NOT 3D render.`,
  },
  {
    id: 5,
    label: 'POS revelado',
    durationSeconds: 8,
    aspectRatio: '16:9',
    prompt: `Cinematic slow push-in toward a sleek small dark POS terminal sitting alone in the center of a warm wooden counter. The terminal screen ignites with a soft warm tomato-red glow that radiates and intensifies as the camera approaches. Dramatic side lighting creates a long shadow. The terminal feels precious, important, intentional. Background: completely out of focus cream walls, soft warm bokeh. Color palette: tomato red glow, cream background, deep espresso brown counter. Cinematic anamorphic 50mm lens at f/2.8. Smooth push-in dolly shot, no camera shake. Apple product reveal aesthetic. Photorealistic, NOT 3D render.`,
  },
  {
    id: 6,
    label: 'QR + factura',
    durationSeconds: 8,
    aspectRatio: '16:9',
    prompt: `Hyper-realistic macro sequence showing three actions in continuous flow: First, a smartphone screen displaying a QR code approaches a POS terminal screen. Second, a soft tomato-red flash of light pulses between them, indicating successful payment. Third, immediately a thermal printer to the side begins ejecting a freshly printed receipt with visible cream paper texture. NO hands or faces visible — just devices and paper. Dramatic side lighting, deep walnut wood counter, warm cinematic color grade. 80mm macro lens at f/4. Smooth slow-motion. Photorealistic, NOT 3D render.`,
  },
  {
    id: 7,
    label: 'iPad comanda',
    durationSeconds: 6,
    aspectRatio: '16:9',
    prompt: `Editorial shot of an iPad in a minimalist stand mounted on a stainless steel kitchen prep surface. The iPad screen lights up with a soft cream-colored interface showing an order notification with an animated tomato-red dot. Light steam drifts across the frame from the right edge suggesting espresso machine activity. Single overhead warm tungsten light. Background: blurred kitchen environment, hints of metal and dark surfaces. Color: cream UI, stainless steel reflections, warm amber rim light, single tomato-red status dot. Locked-off shot with very subtle pan. 35mm lens at f/2.8. Photorealistic.`,
  },
  {
    id: 8,
    label: 'Inventario auto',
    durationSeconds: 6,
    aspectRatio: '16:9',
    prompt: `Macro screen capture of a clean cream-colored dashboard interface showing inventory numbers ticking down in real-time: a number changes from 245 to 244 to 243 with a smooth digital transition. A small tomato-red alert badge pulses gently next to one item. Background: very subtle bokeh of a warm office environment. The interface design is minimal premium aesthetic. No readable text other than the numbers. 50mm at f/4, screen-only with photographic depth-of-field. Locked-off camera. Photorealistic interface, NOT pure 3D render.`,
  },
  {
    id: 9,
    label: 'Phone PWA',
    durationSeconds: 8,
    aspectRatio: '16:9',
    prompt: `Studio product photography of a modern smartphone standing vertically on a warm wooden surface. The screen displays a soft cream-colored mobile bakery app interface showing a product grid (no readable text, abstract rounded card shapes). A prominent tomato-red CTA button at the bottom pulses with a subtle glow animation. Single dramatic side light from upper-left creating a soft long shadow. Background: completely out of focus warm tungsten lights and hints of café atmosphere. Color: cream UI, espresso brown wood, tomato-red CTA, golden bokeh. Subtle reflection on wood surface. Locked-off shot with very slow zoom-in. 80mm at f/4. Apple product launch aesthetic. NO hands, NO faces.`,
  },
  {
    id: 10,
    label: 'MacBook dashboard',
    durationSeconds: 7,
    aspectRatio: '16:9',
    prompt: `Editorial product photography of an open MacBook on a warm wooden desk. The screen displays a clean cream-colored dashboard with abstract data visualizations — a large prominent number smoothly counts up from zero with smooth typography animation. Subtle tomato-red accent dots indicate data points on rounded chart shapes. Background: out-of-focus warm window light, blurred bakery shelves. Color: cream UI, deep walnut wood, espresso brown, single tomato-red data accents. 50mm at f/2.8, cinematic warm color grade. Smooth slow zoom-in. Photorealistic, NOT 3D render.`,
  },
  {
    id: 11,
    label: 'Wide bakery',
    durationSeconds: 7,
    aspectRatio: '16:9',
    prompt: `Wide cinematic shot of a beautiful artisan bakery operating in full flow at golden hour. Visible in middle ground: a POS terminal glowing softly, fresh croissants and cinnamon rolls on display, a receipt printer with a fresh ticket curled at its base. Warm afternoon light streams in creating long shadows. Background: blurred terracotta walls, hints of activity, no clearly visible people. Color palette: warm cream, deep walnut wood, terracotta accents, tomato-red glow from devices, golden hour amber. Slow lateral dolly camera move from left to right. Anamorphic 35mm at f/4. Smooth dolly, no shake. Mood: validation, success, calm productivity. Photorealistic.`,
  },
  {
    id: 12,
    label: 'Logo closing',
    durationSeconds: 4,
    aspectRatio: '16:9',
    prompt: `Pure black background. A bold geometric capital letter C with a horizontal bar through its center fades in smoothly in warm cream color, centered. The wordmark "Conduit" appears smoothly to its right in elegant grotesk sans-serif typography. Below, smaller cream text reading "El POS para los que sí venden." All text and the C-mark are in single warm cream color on pure black. No camera movement, only graphics elements fade in sequentially with smooth easing. Apple product launch closing aesthetic.`,
  },
]

export const totalSeconds = shots.reduce((s, x) => s + x.durationSeconds, 0)
