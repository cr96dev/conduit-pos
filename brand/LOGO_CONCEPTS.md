# Conduit POS — Logo Concepts

Tres direcciones, una metáfora central: **el canal por el que pasa la transacción**.

Las 3 son SVG vectoriales puros, escalables, blanco-y-negro como base (la versión a color es solo aplicación). Todas pasan los tests requeridos:

- ✅ Legible a 2cm de ancho en ticket térmico (impresión 1 bit)
- ✅ Funciona como favicon cuadrado 192px
- ✅ Soporta wordmark "Conduit" sola o con "POS" subordinado
- ✅ Funciona en cream y en color primario

---

## Concept A — "El Canal" ⭐ recomendado

Una **C geométrica con un corte horizontal limpio** que la atraviesa. La C es el canal/contenedor. El corte es la transacción pasando — el momento en que algo se mueve de un lado al otro.

**Por qué funciona:**
- Metáfora directa al nombre (canal = conduit)
- Forma simple, memorable, ownable
- El corte horizontal evoca el ticket térmico al ser arrancado (POS-native)
- Construcción geométrica — premium sin ser frío
- Funciona reducido (la C sola) o con el wordmark

**Archivo:** [`logos/concept-a-canal.svg`](logos/concept-a-canal.svg)

**Construcción:** círculo de radio R, abierto 90° hacia la derecha, atravesado por línea horizontal de grosor `R/6` a la altura del centro.

---

## Concept B — "El Sello"

Una **C envolvente, casi cerrada en círculo**, con un pequeño espacio donde el final de la curva se acerca al inicio. Como un sello artesanal, una moneda quetzal, un grano de café visto desde arriba.

**Por qué funciona:**
- Más cálido, más artesanal — vibe café/panadería
- Sensación de "marca registrada" del operador, no de SaaS
- Único pero contenido — no grita
- El gap funciona como "abierto a entrar"

**Cuándo elegirlo:** si querés posicionar Conduit más cerca del mundo "café de especialidad / panadería boutique" que del mundo "tecnología B2B".

**Archivo:** [`logos/concept-b-sello.svg`](logos/concept-b-sello.svg)

---

## Concept C — "El Pase" (wordmark puro)

Sin símbolo. Solo el wordmark **conduit** en lowercase, con una ligadura custom: la barra horizontal de la "d" se extiende hacia atrás y pasa por encima de la "n" y "u", como un canal físico cruzando.

**Por qué funciona:**
- Pure type — la apuesta más "Square" (Square solo tiene wordmark)
- La ligadura encarna la metáfora sin necesitar un icon separado
- Inolvidable a tamaño grande, pero no funciona bien chico
- Necesita type custom o un grotesco con buena 'd' modificada

**Cuándo elegirlo:** si la marca va a vivir 80% en pantalla y digital, y rara vez en favicon/icon.

**Archivo:** [`logos/concept-c-pase.svg`](logos/concept-c-pase.svg)

---

## Comparativa rápida

| Dimensión | A — Canal | B — Sello | C — Pase |
|---|---|---|---|
| Tiene símbolo standalone | ✅ Sí | ✅ Sí | ❌ No |
| Funciona como favicon 32px | ✅ Excelente | 🟡 OK | ❌ Mal |
| Funciona en ticket B/N 2cm | ✅ Excelente | 🟡 Bueno | 🟡 Apretado |
| Sensación premium | ✅ Alta | ✅ Alta | ✅ Alta |
| Operador empathy | ✅ Tactil/POS | ✅ Café/artesanal | 🟡 Más SaaS |
| Originalidad | ✅ Alta | 🟡 Recuerda a sellos comunes | ✅ Alta |
| Esfuerzo de producción | Bajo | Bajo | Alto (custom type) |

**Recomendación:** Concept A. Combina la metáfora del nombre, la solidez geométrica premium, y la flexibilidad de aplicación (favicon, ticket, social, signage). Concept B queda como segunda lectura para usar en applications más "consumer warm" (ej: la PWA Pickup donde el cliente final ve la marca).

---

## Variantes obligatorias (a producir tras elegir dirección)

Una vez elegida la dirección, hay que producir estas variantes:

1. **Mark only** (sin wordmark) — favicon, app icon, social avatar
2. **Wordmark only** (sin mark) — footer, headers donde el space sea limitado
3. **Lockup horizontal** — mark + wordmark al lado
4. **Lockup vertical** — mark arriba + wordmark debajo (para cards cuadradas)
5. **Reverse** (sobre fondo color/oscuro) — para hero y banners
6. **Black-only** — para ticket impreso, fax, etc.
7. **Single color tints** — primary, cream, espresso

Todas en SVG, exportables a PNG en 1x, 2x, 3x para retina.
