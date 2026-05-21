// Crea recetas para productos Loyverse sin receta, replicando el patrón
// base + sub-recetas + toppings de CROISSANT DE PISTACHO.
//
// Cada receta: rinde=1 unidad, ingredientes lista de {tipo, nombre, cant, unidad}
// donde tipo = 'insumo' o 'subreceta'.

const fs = require('fs')
const env = fs.readFileSync('.env.local', 'utf8').split('\n').filter(l => l && !l.startsWith('#'))
for (const line of env) {
  const eq = line.indexOf('=')
  if (eq > 0) process.env[line.slice(0, eq)] = line.slice(eq+1)
}
const { createClient } = require('@supabase/supabase-js')
const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Sigla: i=insumo, r=receta (sub-receta).
// Cantidades en gramos salvo cuando uso 'unidad' (para CROISSANT, CHEESECAKE, etc.).
const RECETAS = [
  // -- CROISSANTS dulces --
  { ly: 'CROISSANT DE NUTELLA', notas: 'Croissant relleno o cubierto con nutella', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'NUTELLA CREMA DE AVELLANAS', c: 30, u: 'g' },
  ]},
  { ly: 'CROISSANT RELLENO DE ALMENDRAS', notas: 'Croissant + crema pastelera + harina almendra', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREMA PASTELERA', c: 25, u: 'g' },
    { t: 'i', n: 'HARINA DE ALMENDRAS', c: 15, u: 'g' },
    { t: 'i', n: 'EXTRACTO DE ALMENDRA', c: 0.5, u: 'g' },
  ]},
  { ly: 'CROISSANT DE ROSA', notas: 'Croissant + crema pastelera (saborizada)', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREMA PASTELERA', c: 25, u: 'g' },
  ]},
  { ly: 'CROISSANT CREMA CAF√Â', notas: 'Croissant + crema pastelera al café', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREMA PASTELERA', c: 25, u: 'g' },
    { t: 'i', n: 'CAFE TOSTADO', c: 3, u: 'g' },
  ]},
  { ly: 'CROISSANT CREMA MARAÑON', notas: 'Croissant + crema pastelera + nuez maní (proxy marañón)', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREMA PASTELERA', c: 25, u: 'g' },
    { t: 'i', n: 'MANIA ENTERA', c: 10, u: 'g' },
  ]},
  { ly: 'CROISSANT DE CREMA DE SESAMO NEGRO', notas: 'Croissant + crema pastelera saborizada (sésamo no en catálogo)', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREMA PASTELERA', c: 25, u: 'g' },
  ]},
  { ly: 'CROISSANT CHOCO BANANO', notas: 'Croissant + chocolate + banano', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'CHOCOLATE LUKER OSCURO 70%', c: 20, u: 'g' },
    { t: 'i', n: 'BANANO NACIONAL', c: 30, u: 'g' },
  ]},
  { ly: 'CROISSANT OREO&CREAM', notas: 'Croissant + crema pastelera + oreo', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREMA PASTELERA', c: 20, u: 'g' },
    { t: 'i', n: 'GALLETA OREO', c: 20, u: 'g' },
  ]},
  { ly: 'CROISSANT MINIS', notas: '½ croissant en tamaño mini', ing: [
    { t: 'r', n: 'CROISSANT', c: 0.5, u: 'unidad' },
  ]},
  { ly: 'CROISSANT MINI RELLENO', notas: '½ croissant + crema pastelera', ing: [
    { t: 'r', n: 'CROISSANT', c: 0.5, u: 'unidad' },
    { t: 'r', n: 'CREMA PASTELERA', c: 10, u: 'g' },
  ]},
  { ly: 'CROISSANT TART', notas: 'Croissant en forma de tart', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREMA PASTELERA', c: 30, u: 'g' },
  ]},
  { ly: 'PECAN PIE CROISSANT', notas: 'Croissant + pecanas caramelizadas', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'PECANAS SIN CASCARA', c: 20, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 10, u: 'g' },
  ]},
  { ly: 'SWEET ROLL CROISSANT', notas: 'Croissant + canela + glaseado', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'CANELA CASSIA MOLIDA', c: 5, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 10, u: 'g' },
    { t: 'r', n: 'GLASEADO DE CANELA', c: 0.05, u: 'unidad' },
  ]},
  { ly: 'FLAN CROISSANT', notas: 'Croissant relleno tipo flan', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREMA PASTELERA', c: 30, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 5, u: 'g' },
  ]},

  // -- CROISSANTS salados --
  { ly: 'CROISSANT CAPRESE', notas: 'Croissant + pesto + queso parmesano', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'PESTO', c: 15, u: 'g' },
    { t: 'i', n: 'QUESO PARMESANO KRAFT 680G', c: 15, u: 'g' },
  ]},
  { ly: 'CROISSANT JAMON Y QUESO', notas: 'Croissant + queso (falta insumo jamón)', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'QUESO PARMESANO KRAFT 680G', c: 20, u: 'g' },
  ]},
  { ly: 'CROISSANT PEPERONI', notas: 'Croissant + queso (falta insumo peperoni)', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'QUESO PARMESANO KRAFT 680G', c: 15, u: 'g' },
  ]},

  // -- PAIN (variantes de croissant) --
  { ly: 'PAIN DE CHOCOLAT', notas: 'Croissant + barra de chocolate', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'CHOCOLATE LUKER OSCURO 70%', c: 20, u: 'g' },
  ]},
  { ly: 'PAIN DE CHOCOLAT Y ALMENDRA', notas: 'Croissant + chocolate + harina almendra', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'CHOCOLATE LUKER OSCURO 70%', c: 15, u: 'g' },
    { t: 'i', n: 'HARINA DE ALMENDRAS', c: 10, u: 'g' },
  ]},
  { ly: 'PAIN DE CHOCOLATE, ALMENDRAS Y COCO', notas: 'Croissant + chocolate + almendras (falta coco)', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'CHOCOLATE LUKER OSCURO 70%', c: 15, u: 'g' },
    { t: 'i', n: 'HARINA DE ALMENDRAS', c: 10, u: 'g' },
  ]},

  // -- PAVLOVAS --
  { ly: 'PAVLOVA CON CREMA DE NUTELLA', notas: 'Base pavlova + nutella + cream fraiche', ing: [
    { t: 'r', n: 'PAVLOVAS', c: 1, u: 'unidad' },
    { t: 'i', n: 'NUTELLA CREMA DE AVELLANAS', c: 25, u: 'g' },
    { t: 'r', n: 'CREAM FRAICHE', c: 30, u: 'g' },
  ]},
  { ly: 'PAVLOVA DE PISTACHO', notas: 'Pavlova + mantequilla pistacho + pistacho topping', ing: [
    { t: 'r', n: 'PAVLOVAS', c: 1, u: 'unidad' },
    { t: 'r', n: 'mantequilla de pistacho', c: 15, u: 'g' },
    { t: 'i', n: 'PISTACHO TOSTADO SIN CASCARA', c: 10, u: 'g' },
  ]},
  { ly: 'PAVLOVA DE CORAZÓN', notas: 'Pavlova en forma de corazón + cream fraiche + fresa', ing: [
    { t: 'r', n: 'PAVLOVAS', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREAM FRAICHE', c: 30, u: 'g' },
    { t: 'i', n: 'FRESA', c: 30, u: 'g' },
  ]},
  { ly: 'Pavlova sin fruta', notas: 'Pavlova solo con crema', ing: [
    { t: 'r', n: 'PAVLOVAS', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREAM FRAICHE', c: 30, u: 'g' },
  ]},
  { ly: 'PAVLOVA COMNPLETA', notas: 'Pavlova "completa" — porción grande con topping', ing: [
    { t: 'r', n: 'PAVLOVAS', c: 1, u: 'unidad' },
    { t: 'r', n: 'CREAM FRAICHE', c: 50, u: 'g' },
    { t: 'i', n: 'FRESA', c: 50, u: 'g' },
  ]},

  // -- SCONES (base SCONE PLAIN, rinde 50, cada unidad ya está bien) --
  { ly: 'SCONE CHOCO CHIPS', notas: 'Scone con chispas de chocolate', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
    { t: 'i', n: 'TROCITOS CHOCOLATE SEMI AMARGO', c: 15, u: 'g' },
  ]},
  { ly: 'SCONE CRANBERRY', notas: 'Scone con pasas (proxy cranberry)', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
    { t: 'i', n: 'PASAS', c: 15, u: 'g' },
  ]},
  { ly: 'SCONE DE MORAS', notas: 'Scone con moras', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
    { t: 'i', n: 'MORA', c: 20, u: 'g' },
  ]},
  { ly: 'SCONE DE BANANO CON MANTEQUILLA DE MANÍ', notas: 'Scone + banano + mantequilla maní', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
    { t: 'i', n: 'BANANO NACIONAL', c: 20, u: 'g' },
    { t: 'r', n: 'mantequilla de mani', c: 10, u: 'g' },
  ]},
  { ly: 'SCONE DE BANANO Y MANÍ', notas: 'Scone + banano + maní entero', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
    { t: 'i', n: 'BANANO NACIONAL', c: 20, u: 'g' },
    { t: 'i', n: 'MANIA ENTERA', c: 10, u: 'g' },
  ]},
  { ly: 'SCONE DE LIMÓN Y MIEL', notas: 'Scone con limón (falta miel en insumos)', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
    { t: 'i', n: 'LIMON PERSA', c: 5, u: 'g' },
  ]},
  { ly: 'SCONE DE NARANJAS CON CRANBERRY', notas: 'Scone con limón (proxy naranja) + pasas (proxy cranberry)', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
    { t: 'i', n: 'LIMON PERSA', c: 5, u: 'g' },
    { t: 'i', n: 'PASAS', c: 15, u: 'g' },
  ]},
  { ly: 'SCONE DE ZANAHORIA Y PASAS', notas: 'Scone + zanahoria + pasas', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
    { t: 'i', n: 'ZANAHORIA', c: 20, u: 'g' },
    { t: 'i', n: 'PASAS', c: 15, u: 'g' },
  ]},
  { ly: 'SCONE-CHITA', notas: 'Scone variante (asumido similar al plain)', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
  ]},
  { ly: 'SCONNE NORMAL', notas: 'Scone normal — equivalente a SCONE PLAIN', ing: [
    { t: 'r', n: 'SCONE PLAIN', c: 1, u: 'unidad' },
  ]},

  // -- TIRAMISÚ (TIRAMISU rinde 10) — para venta individual = 1 unidad de la receta base --
  { ly: 'TIRAMISÚ', notas: 'Tiramisú clásico', ing: [
    { t: 'r', n: 'TIRAMISU', c: 1, u: 'unidad' },
  ]},
  { ly: 'TIRAMISÚ DE PISTACHO', notas: 'Tiramisú + mantequilla pistacho + topping pistacho', ing: [
    { t: 'r', n: 'TIRAMISU', c: 1, u: 'unidad' },
    { t: 'r', n: 'mantequilla de pistacho', c: 10, u: 'g' },
    { t: 'i', n: 'PISTACHO TOSTADO SIN CASCARA', c: 5, u: 'g' },
  ]},
  { ly: 'Tiramisú MARAÑON', notas: 'Tiramisú + maní (proxy marañón)', ing: [
    { t: 'r', n: 'TIRAMISU', c: 1, u: 'unidad' },
    { t: 'i', n: 'MANIA ENTERA', c: 10, u: 'g' },
  ]},

  // -- ROLLS --
  { ly: 'CINAMON ROLL', notas: 'Croissant + canela + azúcar + glaseado', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'CANELA CASSIA MOLIDA', c: 5, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 15, u: 'g' },
    { t: 'r', n: 'GLASEADO DE CANELA', c: 0.1, u: 'unidad' },
  ]},
  { ly: 'ROLL CHOCOLATE, NUTELLA Y OREO', notas: 'Roll triple chocolate', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'CHOCOLATE LUKER OSCURO 70%', c: 15, u: 'g' },
    { t: 'i', n: 'NUTELLA CREMA DE AVELLANAS', c: 15, u: 'g' },
    { t: 'i', n: 'GALLETA OREO', c: 15, u: 'g' },
  ]},
  { ly: 'ROLL DE TOCINO Y CIBOULLETTE', notas: 'Roll salado con queso (falta tocino/ciboullette)', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'QUESO PARMESANO KRAFT 680G', c: 10, u: 'g' },
  ]},
  { ly: 'ROLL DE TOCINO Y AJO', notas: 'Roll con ajo (falta tocino)', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'i', n: 'RED DE AJO', c: 5, u: 'g' },
    { t: 'i', n: 'QUESO PARMESANO KRAFT 680G', c: 10, u: 'g' },
  ]},
  { ly: 'ROLL PISTACCIO Y NARANJA', notas: 'Roll + pistacho + limón (proxy naranja)', ing: [
    { t: 'r', n: 'CROISSANT', c: 1, u: 'unidad' },
    { t: 'r', n: 'mantequilla de pistacho', c: 10, u: 'g' },
    { t: 'i', n: 'PISTACHO TOSTADO SIN CASCARA', c: 8, u: 'g' },
    { t: 'i', n: 'LIMON PERSA', c: 3, u: 'g' },
  ]},

  // -- CHEESECAKES (base CHEESECAKE rinde 12 porciones; cada porción = 1 unidad) --
  { ly: 'CHEESECAKE FRESA', notas: 'Cheesecake + topping fresa', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 1, u: 'unidad' },
    { t: 'i', n: 'FRESA', c: 20, u: 'g' },
  ]},
  { ly: 'CHEESECAKE BLUEBERRY', notas: 'Cheesecake + arándanos', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 1, u: 'unidad' },
    { t: 'i', n: 'ARANDANOS CONGELADOS', c: 20, u: 'g' },
  ]},
  { ly: 'CHESSECAKE DE FRESA', notas: 'Variante typo: Cheesecake fresa', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 1, u: 'unidad' },
    { t: 'i', n: 'FRESA', c: 20, u: 'g' },
  ]},
  { ly: 'CHEESECAKE KITKAT', notas: 'Cheesecake + chocolate', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 1, u: 'unidad' },
    { t: 'i', n: 'CHOCOLATE LUKER OSCURO 70%', c: 20, u: 'g' },
  ]},
  { ly: 'CHEESECAKE SELVA NEGRA', notas: 'Cheesecake + mora + chocolate', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 1, u: 'unidad' },
    { t: 'i', n: 'MORA', c: 15, u: 'g' },
    { t: 'i', n: 'CHOCOLATE LUKER OSCURO 70%', c: 10, u: 'g' },
  ]},
  { ly: 'CHEESECAKE BISCOFF', notas: 'Cheesecake + galleta tipo biscoff (uso oreo como proxy)', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 1, u: 'unidad' },
    { t: 'i', n: 'GALLETA OREO', c: 15, u: 'g' },
  ]},
  { ly: 'CHEESECAKE DE BANANO CARAMELIZADO CON TOFFEE', notas: 'Cheesecake + banano + caramelo (azúcar)', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 1, u: 'unidad' },
    { t: 'i', n: 'BANANO NACIONAL', c: 30, u: 'g' },
    { t: 'i', n: 'AZUCAR STANDARD 50 LBS', c: 15, u: 'g' },
  ]},
  { ly: 'CHEESECAKE DE ESPRESO', notas: 'Cheesecake + café', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 1, u: 'unidad' },
    { t: 'i', n: 'CAFE TOSTADO', c: 5, u: 'g' },
  ]},
  { ly: 'CHEESSECAKE MORA', notas: 'Cheesecake + mora', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 1, u: 'unidad' },
    { t: 'i', n: 'MORA', c: 20, u: 'g' },
  ]},
  { ly: 'CHEESECAKE MINI', notas: '½ porción de cheesecake', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 0.5, u: 'unidad' },
  ]},
  { ly: 'CHEESECAKE COMPLETO', notas: 'Cheesecake entero (12 porciones)', ing: [
    { t: 'r', n: 'CHEESECAKE', c: 12, u: 'unidad' },
  ]},

  // -- OTROS --
  { ly: 'PIE DE MANZANA ALSACIANO', notas: 'Variante del PIE ALSACIANO DE FRUTA', ing: [
    { t: 'r', n: 'PIE ALSACIANO DE FRUTA', c: 1, u: 'unidad' },
  ]},
  { ly: 'PECAN PIE TART', notas: 'Tart con pecanas caramelizadas', ing: [
    { t: 'r', n: 'MASA BRISE', c: 1, u: 'unidad' },
    { t: 'r', n: 'PECANAS CARAMELIZADAS', c: 0.5, u: 'unidad' },
  ]},
]

async function main() {
  // Cargar IDs de loyverse items, insumos y recetas existentes
  const { data: loyItems } = await supa.from('loyverse_items').select('loyverse_id, item_name')
  const loyByName = new Map((loyItems || []).map(i => [i.item_name, i.loyverse_id]))

  const { data: insumos } = await supa.from('insumos').select('id, nombre, unidad, costo_unitario').eq('activo', true)
  const insByName = new Map((insumos || []).map(i => [i.nombre, i]))

  const { data: recetas } = await supa.from('recetas').select('id, nombre, rinde_cantidad, rinde_unidad, costo_calculado, loyverse_item_id').eq('activa', true)
  const recByName = new Map((recetas || []).map(r => [r.nombre, r]))
  const recByLoyId = new Map((recetas || []).filter(r => r.loyverse_item_id).map(r => [r.loyverse_item_id, r]))

  let creadas = 0
  let omitidas = []
  let errores = []

  for (const def of RECETAS) {
    const loyId = loyByName.get(def.ly)
    if (!loyId) { errores.push(`${def.ly}: no se encontró item Loyverse`); continue }

    // Si ya hay receta activa para este loyverse_id, saltar
    if (recByLoyId.has(loyId)) {
      omitidas.push(`${def.ly} (ya tiene receta)`)
      continue
    }

    // Validar todos los ingredientes
    const ingsValidos = []
    let valido = true
    for (const ing of def.ing) {
      if (ing.t === 'i') {
        const ins = insByName.get(ing.n)
        if (!ins) { errores.push(`${def.ly}: insumo no encontrado '${ing.n}'`); valido = false; break }
        const snap = Number(ins.costo_unitario) || 0
        ingsValidos.push({
          insumo_id: ins.id, sub_receta_id: null,
          cantidad: ing.c, unidad: ing.u,
          costo_unitario_snapshot: snap,
          subtotal_costo: Math.round((ing.c * snap) * 10000) / 10000,
        })
      } else {
        const sub = recByName.get(ing.n)
        if (!sub) { errores.push(`${def.ly}: sub-receta no encontrada '${ing.n}'`); valido = false; break }
        const snap = Number(sub.costo_calculado) || 0
        ingsValidos.push({
          insumo_id: null, sub_receta_id: sub.id,
          cantidad: ing.c, unidad: ing.u,
          costo_unitario_snapshot: snap,
          subtotal_costo: Math.round((ing.c * snap) * 10000) / 10000,
        })
      }
    }
    if (!valido) continue

    const costo = ingsValidos.reduce((s, i) => s + i.subtotal_costo, 0)
    const costoCalc = Math.round(costo * 10000) / 10000

    const { data: receta, error: rErr } = await supa.from('recetas').insert({
      loyverse_item_id: loyId,
      nombre: def.ly,
      rinde_cantidad: 1,
      rinde_unidad: 'unidad',
      merma_pct: 0,
      costo_calculado: costoCalc,
      notas: def.notas,
      activa: true,
    }).select().single()
    if (rErr) { errores.push(`${def.ly}: ${rErr.message}`); continue }

    const filas = ingsValidos.map((x, i) => ({ ...x, receta_id: receta.id, orden: i }))
    const { error: iErr } = await supa.from('receta_ingredientes').insert(filas)
    if (iErr) {
      errores.push(`${def.ly} (ings): ${iErr.message}`)
      await supa.from('recetas').delete().eq('id', receta.id)
      continue
    }

    creadas++
    console.log(`✓ ${def.ly.padEnd(45)} costo: Q${costoCalc.toFixed(2)}`)
  }

  console.log()
  console.log(`✓ Creadas: ${creadas}`)
  console.log(`⊘ Omitidas (ya existían): ${omitidas.length}`)
  if (omitidas.length > 0) omitidas.forEach(o => console.log('  -', o))
  if (errores.length > 0) {
    console.log(`✗ Errores: ${errores.length}`)
    errores.forEach(e => console.log('  -', e))
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
