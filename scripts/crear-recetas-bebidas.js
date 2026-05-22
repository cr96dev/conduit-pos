// Crea insumos faltantes de barista + recetas para bebidas Loyverse.
// Costos en Q/g o Q/ml estimados (mercado GT, marca Monin/Torani para jarabes).
// El user puede ajustar costos individuales desde /inventario después.

const fs = require('fs')
const env = fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
for (const line of env) {
  const eq = line.indexOf('=')
  if (eq > 0) process.env[line.slice(0, eq)] = line.slice(eq+1)
}
const { createClient } = require('@supabase/supabase-js')
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ============================================================================
// INSUMOS NUEVOS DE BARISTA
// ============================================================================

const INSUMOS_NUEVOS = [
  { nombre: 'LECHE ENTERA DOS PINOS 1L',         unidad: 'g', costo: 0.0140, categoria: 'lacteos', proveedor: 'DOS PINOS' },
  { nombre: 'LECHE DE AVENA 1L',                 unidad: 'g', costo: 0.0700, categoria: 'lacteos', proveedor: 'IMPORTADO' },
  { nombre: 'LECHE DE ALMENDRA 1L',              unidad: 'g', costo: 0.0600, categoria: 'lacteos', proveedor: 'IMPORTADO' },
  { nombre: 'JARABE MONIN VAINILLA 750ML',       unidad: 'g', costo: 0.1000, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'JARABE MONIN CARAMELO 750ML',       unidad: 'g', costo: 0.1000, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'JARABE COOKIE BUTTER 750ML',        unidad: 'g', costo: 0.1200, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'JARABE PUMPKIN SPICE 750ML',        unidad: 'g', costo: 0.1200, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'JARABE GINGERBREAD 750ML',          unidad: 'g', costo: 0.1200, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'JARABE BROWN SUGAR 750ML',          unidad: 'g', costo: 0.1000, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'JARABE BISCOFF 750ML',              unidad: 'g', costo: 0.1300, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'JARABE MENTA 750ML',                unidad: 'g', costo: 0.1000, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'JARABE TARO 750ML',                 unidad: 'g', costo: 0.1500, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'SALSA CHOCOLATE GHIRARDELLI',       unidad: 'g', costo: 0.1500, categoria: 'jarabes', proveedor: 'IMPORTADO' },
  { nombre: 'MATCHA POLVO CEREMONIAL 100G',      unidad: 'g', costo: 1.5000, categoria: 'te', proveedor: 'IMPORTADO' },
  { nombre: 'HOJAS TE CHAI ESPECIAS',            unidad: 'g', costo: 0.4000, categoria: 'te', proveedor: 'TWININGS' },
  { nombre: 'HOJAS TE NEGRO EARL GREY',          unidad: 'g', costo: 0.4000, categoria: 'te', proveedor: 'TWININGS' },
  { nombre: 'HOJAS TE VERDE',                    unidad: 'g', costo: 0.4000, categoria: 'te', proveedor: 'TWININGS' },
  { nombre: 'HOJAS TE PIÑA COLADA TROPICAL',     unidad: 'g', costo: 0.5000, categoria: 'te', proveedor: 'IMPORTADO' },
  { nombre: 'HOJAS TE BORA BORA',                unidad: 'g', costo: 0.5000, categoria: 'te', proveedor: 'IMPORTADO' },
  { nombre: 'HIERBABUENA FRESCA',                unidad: 'g', costo: 0.1000, categoria: 'frescos', proveedor: 'PROSERVI' },
  { nombre: 'JENGIBRE FRESCO',                   unidad: 'g', costo: 0.0250, categoria: 'frescos', proveedor: 'PROSERVI' },
  { nombre: 'CURCUMA POLVO',                     unidad: 'g', costo: 0.1500, categoria: 'especias', proveedor: 'SUPERB' },
  { nombre: 'MIEL DE ABEJA',                     unidad: 'g', costo: 0.0700, categoria: 'endulzantes', proveedor: 'NACIONAL' },
  { nombre: 'MARSHMALLOW MINI',                  unidad: 'g', costo: 0.0900, categoria: 'toppings', proveedor: 'IMPORTADO' },
  { nombre: 'PURE DE MANGO',                     unidad: 'g', costo: 0.0500, categoria: 'frutas', proveedor: 'IMPORTADO' },
  { nombre: 'PURE DE MARACUYA',                  unidad: 'g', costo: 0.0500, categoria: 'frutas', proveedor: 'IMPORTADO' },
  { nombre: 'PURE DE GUAYABA',                   unidad: 'g', costo: 0.0500, categoria: 'frutas', proveedor: 'IMPORTADO' },
  { nombre: 'PURE DE MORA',                      unidad: 'g', costo: 0.0500, categoria: 'frutas', proveedor: 'IMPORTADO' },
  { nombre: 'PIÑA EN ALMIBAR',                   unidad: 'g', costo: 0.0400, categoria: 'frutas', proveedor: 'NACIONAL' },
  { nombre: 'JUGO DE MANZANA NATURAL',           unidad: 'g', costo: 0.0250, categoria: 'frutas', proveedor: 'NACIONAL' },
]

// ============================================================================
// RECETAS DE BEBIDAS
// ============================================================================
// Sigla: i=insumo, r=sub-receta

const BEBIDAS = [
  // -- ESPRESSO Y BASICOS --
  { ly: 'ESPRESSO', notas: 'Espresso simple 18g', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
  ]},
  { ly: 'AMERICANO', notas: 'Espresso + agua caliente', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 180, u: 'g' },
  ]},
  { ly: 'CORTADO', notas: 'Espresso + 30ml leche vapor', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 30, u: 'g' },
  ]},
  { ly: 'MACCHIATO', notas: 'Espresso + 15ml espuma leche', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 15, u: 'g' },
  ]},
  { ly: 'CAPPUCCINO', notas: 'Espresso + 120ml leche vapor', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 120, u: 'g' },
  ]},
  { ly: 'LATTE', notas: 'Espresso + 220ml leche vapor', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 220, u: 'g' },
  ]},
  { ly: 'FLAT WHITE', notas: 'Doble espresso + 150ml leche micro', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 36, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 150, u: 'g' },
  ]},
  { ly: 'MOCCA', notas: 'Espresso + leche + chocolate', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'SALSA CHOCOLATE GHIRARDELLI', c: 30, u: 'g' },
  ]},
  { ly: 'WITHE MOCCA', notas: 'Espresso + leche + chocolate blanco', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'LECHE EN POLVO OPEN COUNTRY 55 LBS', c: 15, u: 'g' },
    { t: 'i', n: 'AZUCAR GLASS FREEMAN 25 LBS', c: 15, u: 'g' },
  ]},
  { ly: 'PEPPERMINT MOCCA', notas: 'Mocca + jarabe menta', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'SALSA CHOCOLATE GHIRARDELLI', c: 25, u: 'g' },
    { t: 'i', n: 'JARABE MENTA 750ML', c: 15, u: 'g' },
  ]},

  // -- COLD COFFEE --
  { ly: 'COLD BREW', notas: 'Café en frío 24h (porción de batch)', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 12, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
  ]},
  { ly: 'COLD BREW HORCHATA', notas: 'Cold brew + leche/horchata simple', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 12, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 200, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 60, u: 'g' },
    { t: 'i', n: 'CANELA CASSIA MOLIDA', c: 1, u: 'g' },
  ]},
  { ly: 'METODO V60', notas: 'Filtrado V60 22g/350ml', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 22, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 350, u: 'g' },
  ]},
  { ly: 'RITUAL DEL CAFE', notas: 'Experiencia de cata (doble espresso)', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 36, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 200, u: 'g' },
  ]},

  // -- LATTES SABORIZADOS --
  { ly: 'COOKIE BUTTER LATTE', notas: 'Latte + jarabe cookie butter', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'JARABE COOKIE BUTTER 750ML', c: 30, u: 'g' },
  ]},
  { ly: 'COOKIE BUTTER', notas: 'Bebida con jarabe cookie butter base leche', ing: [
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 240, u: 'g' },
    { t: 'i', n: 'JARABE COOKIE BUTTER 750ML', c: 30, u: 'g' },
  ]},
  { ly: 'MARSHMALLOW LATTE', notas: 'Latte + marshmallow', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'MARSHMALLOW MINI', c: 20, u: 'g' },
    { t: 'i', n: 'JARABE MONIN VAINILLA 750ML', c: 15, u: 'g' },
  ]},
  { ly: 'MARSHMELLOW LATTE', notas: 'Variante typo de MARSHMALLOW LATTE', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'MARSHMALLOW MINI', c: 20, u: 'g' },
    { t: 'i', n: 'JARABE MONIN VAINILLA 750ML', c: 15, u: 'g' },
  ]},
  { ly: 'MARSHMALLOW HOT CHOCOLATE', notas: 'Chocolate caliente + marshmallow', ing: [
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 240, u: 'g' },
    { t: 'i', n: 'SALSA CHOCOLATE GHIRARDELLI', c: 30, u: 'g' },
    { t: 'i', n: 'MARSHMALLOW MINI', c: 25, u: 'g' },
  ]},
  { ly: 'MARSHMELLOW HOT CHOCOLATE', notas: 'Variante typo', ing: [
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 240, u: 'g' },
    { t: 'i', n: 'SALSA CHOCOLATE GHIRARDELLI', c: 30, u: 'g' },
    { t: 'i', n: 'MARSHMALLOW MINI', c: 25, u: 'g' },
  ]},
  { ly: 'PUMPKIN LATTE', notas: 'Latte + jarabe pumpkin spice', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'JARABE PUMPKIN SPICE 750ML', c: 30, u: 'g' },
  ]},
  { ly: 'APPLE CARAMEL', notas: 'Base leche + manzana + caramelo', ing: [
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'JUGO DE MANZANA NATURAL', c: 50, u: 'g' },
    { t: 'i', n: 'JARABE MONIN CARAMELO 750ML', c: 25, u: 'g' },
  ]},
  { ly: 'APPLE CARAMEL LATTE', notas: 'Latte + jugo manzana + caramelo', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 180, u: 'g' },
    { t: 'i', n: 'JUGO DE MANZANA NATURAL', c: 40, u: 'g' },
    { t: 'i', n: 'JARABE MONIN CARAMELO 750ML', c: 20, u: 'g' },
  ]},
  { ly: 'APPLE CIDER', notas: 'Sidra de manzana caliente', ing: [
    { t: 'i', n: 'JUGO DE MANZANA NATURAL', c: 240, u: 'g' },
    { t: 'i', n: 'CANELA CASSIA MOLIDA', c: 2, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 5, u: 'g' },
  ]},
  { ly: 'GINGERBREAD', notas: 'Bebida base gingerbread', ing: [
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 240, u: 'g' },
    { t: 'i', n: 'JARABE GINGERBREAD 750ML', c: 30, u: 'g' },
    { t: 'i', n: 'JENGIBRE FRESCO', c: 2, u: 'g' },
  ]},
  { ly: 'GINGERBREAD LATTE', notas: 'Latte + gingerbread', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'JARABE GINGERBREAD 750ML', c: 25, u: 'g' },
  ]},
  { ly: 'BROWN SUGGAR ESPRESSO', notas: 'Espresso + leche + brown sugar', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 150, u: 'g' },
    { t: 'i', n: 'JARABE BROWN SUGAR 750ML', c: 20, u: 'g' },
  ]},
  { ly: 'TARO', notas: 'Latte de taro', ing: [
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 240, u: 'g' },
    { t: 'i', n: 'JARABE TARO 750ML', c: 30, u: 'g' },
  ]},
  { ly: 'GOLDEN MILK', notas: 'Leche dorada con cúrcuma + miel', ing: [
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 240, u: 'g' },
    { t: 'i', n: 'CURCUMA POLVO', c: 3, u: 'g' },
    { t: 'i', n: 'JENGIBRE FRESCO', c: 2, u: 'g' },
    { t: 'i', n: 'MIEL DE ABEJA', c: 15, u: 'g' },
    { t: 'i', n: 'CANELA CASSIA MOLIDA', c: 1, u: 'g' },
  ]},
  { ly: 'GOLDEN MILK VERANO', notas: 'Golden milk fría', ing: [
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 240, u: 'g' },
    { t: 'i', n: 'CURCUMA POLVO', c: 3, u: 'g' },
    { t: 'i', n: 'MIEL DE ABEJA', c: 15, u: 'g' },
  ]},
  { ly: 'GOLDEN BRULEE', notas: 'Golden milk con caramelo crujiente', ing: [
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 240, u: 'g' },
    { t: 'i', n: 'CURCUMA POLVO', c: 3, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 15, u: 'g' },
    { t: 'i', n: 'MIEL DE ABEJA', c: 10, u: 'g' },
  ]},
  { ly: 'WHIPPED HONEY BANANA ESPRESSO', notas: 'Espresso + banano + miel + crema batida', ing: [
    { t: 'i', n: 'CAFE TOSTADO', c: 18, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 180, u: 'g' },
    { t: 'i', n: 'BANANO NACIONAL', c: 30, u: 'g' },
    { t: 'i', n: 'MIEL DE ABEJA', c: 15, u: 'g' },
    { t: 'r', n: 'CREAM FRAICHE', c: 15, u: 'g' },
  ]},
  { ly: 'WHIPPED HONEY BANANA MATCHA', notas: 'Matcha + banano + miel + crema', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 180, u: 'g' },
    { t: 'i', n: 'BANANO NACIONAL', c: 30, u: 'g' },
    { t: 'i', n: 'MIEL DE ABEJA', c: 15, u: 'g' },
    { t: 'r', n: 'CREAM FRAICHE', c: 15, u: 'g' },
  ]},

  // -- MATCHA --
  { ly: 'TE MATCHA', notas: 'Matcha latte 3g + 240ml leche', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 240, u: 'g' },
  ]},
  { ly: 'MANGO MATCHA', notas: 'Matcha + pure de mango', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'PURE DE MANGO', c: 40, u: 'g' },
  ]},
  { ly: 'STRAWBERRY MATCHA', notas: 'Matcha + fresa', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'FRESA', c: 40, u: 'g' },
  ]},
  { ly: 'STRAWBERRY WHITE MATCHA (COLD FOAM)', notas: 'Matcha fresa con cold foam', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 180, u: 'g' },
    { t: 'i', n: 'FRESA', c: 40, u: 'g' },
    { t: 'r', n: 'CREAM FRAICHE', c: 30, u: 'g' },
  ]},
  { ly: 'MATCHA DE PISTACHO', notas: 'Matcha + mantequilla pistacho', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'r', n: 'mantequilla de pistacho', c: 15, u: 'g' },
  ]},
  { ly: 'MATCHA BISCOFF LATTE', notas: 'Matcha latte + jarabe biscoff', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'JARABE BISCOFF 750ML', c: 25, u: 'g' },
  ]},
  { ly: 'COOKIE BUTTER MATCHA', notas: 'Matcha + cookie butter', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'JARABE COOKIE BUTTER 750ML', c: 25, u: 'g' },
  ]},
  { ly: 'PUMPKIN MATCHA', notas: 'Matcha + pumpkin spice', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'JARABE PUMPKIN SPICE 750ML', c: 25, u: 'g' },
  ]},
  { ly: 'COLD FOAM PUMPKIN MATCHA', notas: 'Matcha pumpkin frío + cold foam', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 180, u: 'g' },
    { t: 'i', n: 'JARABE PUMPKIN SPICE 750ML', c: 25, u: 'g' },
    { t: 'r', n: 'CREAM FRAICHE', c: 30, u: 'g' },
  ]},
  { ly: 'HONEY MATCHA LIME', notas: 'Matcha + miel + limón', ing: [
    { t: 'i', n: 'MATCHA POLVO CEREMONIAL 100G', c: 3, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 200, u: 'g' },
    { t: 'i', n: 'MIEL DE ABEJA', c: 15, u: 'g' },
    { t: 'i', n: 'LIMON PERSA', c: 5, u: 'g' },
  ]},

  // -- TES --
  { ly: 'TE CHAI', notas: 'Chai latte 5g hojas + 200ml leche', ing: [
    { t: 'i', n: 'HOJAS TE CHAI ESPECIAS', c: 5, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 80, u: 'g' },
    { t: 'i', n: 'LECHE ENTERA DOS PINOS 1L', c: 160, u: 'g' },
  ]},
  { ly: 'TE CHAI Infusión', notas: 'Chai solo infusión sin leche', ing: [
    { t: 'i', n: 'HOJAS TE CHAI ESPECIAS', c: 5, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
  ]},
  { ly: 'TE NEGRO EARL GREY', notas: 'Té negro infusión', ing: [
    { t: 'i', n: 'HOJAS TE NEGRO EARL GREY', c: 3, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
  ]},
  { ly: 'TE VERDE', notas: 'Té verde infusión', ing: [
    { t: 'i', n: 'HOJAS TE VERDE', c: 3, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
  ]},
  { ly: 'TE VERDE MENTA', notas: 'Té verde + hierbabuena', ing: [
    { t: 'i', n: 'HOJAS TE VERDE', c: 3, u: 'g' },
    { t: 'i', n: 'HIERBABUENA FRESCA', c: 5, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
  ]},
  { ly: 'TE DE PIÑA COLADA', notas: 'Té tropical piña coco', ing: [
    { t: 'i', n: 'HOJAS TE PIÑA COLADA TROPICAL', c: 4, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
  ]},
  { ly: 'TE BORA BORA', notas: 'Té blend tropical', ing: [
    { t: 'i', n: 'HOJAS TE BORA BORA', c: 4, u: 'g' },
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
  ]},

  // -- REFRESHERS (frías a base de fruta + agua + hielo) --
  { ly: 'REFRESHER MANGO MARACUYA', notas: 'Agua + pure mango + maracuyá', ing: [
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
    { t: 'i', n: 'PURE DE MANGO', c: 40, u: 'g' },
    { t: 'i', n: 'PURE DE MARACUYA', c: 30, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 8, u: 'g' },
  ]},
  { ly: 'REFRESHER GUAYABA', notas: 'Agua + pure guayaba', ing: [
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
    { t: 'i', n: 'PURE DE GUAYABA', c: 60, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 8, u: 'g' },
  ]},
  { ly: 'REFRESHER GUAYABA MARACUYA', notas: 'Guayaba + maracuyá', ing: [
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
    { t: 'i', n: 'PURE DE GUAYABA', c: 40, u: 'g' },
    { t: 'i', n: 'PURE DE MARACUYA', c: 30, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 8, u: 'g' },
  ]},
  { ly: 'REFRESHER MORA MARACUYA MANGO', notas: 'Triple frutas', ing: [
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
    { t: 'i', n: 'PURE DE MORA', c: 25, u: 'g' },
    { t: 'i', n: 'PURE DE MARACUYA', c: 25, u: 'g' },
    { t: 'i', n: 'PURE DE MANGO', c: 25, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 8, u: 'g' },
  ]},
  { ly: 'REFRESHER BERRIES MARACUYA MANGO', notas: 'Berries + tropicales', ing: [
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
    { t: 'i', n: 'ARANDANOS CONGELADOS', c: 30, u: 'g' },
    { t: 'i', n: 'PURE DE MARACUYA', c: 25, u: 'g' },
    { t: 'i', n: 'PURE DE MANGO', c: 25, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 8, u: 'g' },
  ]},
  { ly: 'REFRESHER DE FRESA LIMON HIERBABUENA', notas: 'Fresa + limón + hierbabuena', ing: [
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
    { t: 'i', n: 'FRESA', c: 40, u: 'g' },
    { t: 'i', n: 'LIMON PERSA', c: 10, u: 'g' },
    { t: 'i', n: 'HIERBABUENA FRESCA', c: 5, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 8, u: 'g' },
  ]},
  { ly: 'REFRESHER PIÑA HIERBA BUENA', notas: 'Piña + hierbabuena', ing: [
    { t: 'i', n: 'AGUA PURA DEL FILTRO', c: 240, u: 'g' },
    { t: 'i', n: 'PIÑA EN ALMIBAR', c: 50, u: 'g' },
    { t: 'i', n: 'HIERBABUENA FRESCA', c: 5, u: 'g' },
  ]},
]

// ============================================================================
// MAIN
// ============================================================================

const round4 = n => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

async function main() {
  // 1. Insertar insumos faltantes
  console.log('=== INSUMOS NUEVOS ===')
  const { data: existentes } = await supa.from('insumos').select('id, nombre').eq('activo', true)
  const exSet = new Set((existentes || []).map(i => i.nombre.toUpperCase()))
  let insumosCreados = 0
  for (const ins of INSUMOS_NUEVOS) {
    if (exSet.has(ins.nombre.toUpperCase())) continue
    const { error } = await supa.from('insumos').insert({
      nombre: ins.nombre,
      categoria: ins.categoria,
      unidad: ins.unidad,
      stock_actual: 0,
      stock_minimo: 0,
      costo_unitario: ins.costo,
      proveedor: ins.proveedor,
      notas: 'Insumo de barista (costo estimado, ajustable)',
    })
    if (!error) { insumosCreados++; console.log(`  + ${ins.nombre} Q${ins.costo}/g`) }
    else console.log(`  ✗ ${ins.nombre}: ${error.message}`)
  }
  console.log(`✓ ${insumosCreados} insumos nuevos\n`)

  // 2. Insertar bebidas
  console.log('=== BEBIDAS ===')
  const { data: loyItems } = await supa.from('loyverse_items').select('loyverse_id, item_name')
  const loyByName = new Map((loyItems || []).map(i => [i.item_name.normalize('NFC'), i.loyverse_id]))

  const { data: insumos } = await supa.from('insumos').select('id, nombre, unidad, costo_unitario').eq('activo', true)
  const insByName = new Map((insumos || []).map(i => [i.nombre.normalize('NFC'), i]))

  const { data: recetas } = await supa.from('recetas').select('id, nombre, rinde_cantidad, rinde_unidad, costo_calculado, loyverse_item_id').eq('activa', true)
  const recByName = new Map((recetas || []).map(r => [r.nombre.normalize('NFC'), r]))
  const recByLoyId = new Map((recetas || []).filter(r => r.loyverse_item_id).map(r => [r.loyverse_item_id, r]))

  let creadas = 0, omitidas = 0, errores = []
  for (const def of BEBIDAS) {
    const loyId = loyByName.get(def.ly.normalize('NFC'))
    if (!loyId) { errores.push(`${def.ly}: no se encontró item Loyverse`); continue }
    if (recByLoyId.has(loyId)) { omitidas++; continue }

    const ings = []
    let total = 0
    let ok = true
    for (const ing of def.ing) {
      if (ing.t === 'i') {
        const ins = insByName.get(ing.n.normalize('NFC'))
        if (!ins) { errores.push(`${def.ly}: insumo no encontrado '${ing.n}'`); ok = false; break }
        const snap = Number(ins.costo_unitario) || 0
        ings.push({ insumo_id: ins.id, sub_receta_id: null, cantidad: ing.c, unidad: ing.u,
                    costo_unitario_snapshot: snap, subtotal_costo: round4(ing.c * snap) })
      } else {
        const sub = recByName.get(ing.n.normalize('NFC'))
        if (!sub) { errores.push(`${def.ly}: sub-receta no encontrada '${ing.n}'`); ok = false; break }
        const snap = Number(sub.costo_calculado) || 0
        ings.push({ insumo_id: null, sub_receta_id: sub.id, cantidad: ing.c, unidad: ing.u,
                    costo_unitario_snapshot: snap, subtotal_costo: round4(ing.c * snap) })
      }
      total += ings[ings.length - 1].subtotal_costo
    }
    if (!ok) continue
    const costo = round4(total)

    const { data: receta, error: rErr } = await supa.from('recetas').insert({
      loyverse_item_id: loyId, nombre: def.ly, rinde_cantidad: 1, rinde_unidad: 'unidad',
      merma_pct: 0, costo_calculado: costo, notas: def.notas, activa: true,
    }).select().single()
    if (rErr) { errores.push(`${def.ly}: ${rErr.message}`); continue }

    const filas = ings.map((x, i) => ({ ...x, receta_id: receta.id, orden: i }))
    const { error: iErr } = await supa.from('receta_ingredientes').insert(filas)
    if (iErr) { errores.push(`${def.ly} ings: ${iErr.message}`); await supa.from('recetas').delete().eq('id', receta.id); continue }

    creadas++
    console.log(`  ✓ ${def.ly.padEnd(45)} Q${costo.toFixed(2)}`)
  }
  console.log()
  console.log(`✓ Bebidas creadas: ${creadas}`)
  console.log(`⊘ Omitidas (ya existían): ${omitidas}`)
  if (errores.length) {
    console.log(`✗ Errores: ${errores.length}`)
    errores.forEach(e => console.log('  -', e))
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
