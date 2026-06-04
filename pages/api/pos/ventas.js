// pages/api/pos/ventas.js
// POST /api/pos/ventas  — crea factura, certifica con Infile, descuenta PT,
// (opcional) descuenta insumos por receta, genera asiento contable.
//
// Body:
//   {
//     items: [
//       { variant_id?, descripcion, cantidad, precio_unitario,
//         descuenta_insumos?, receta_id?, unidad_medida? }
//     ],
//     receptor: { nit, nombre, email?, direccion? },   // nit='CF' o NIT real
//     metodo_pago: 'efectivo'|'tarjeta'|'transferencia'|'pedidos_ya'|'otro',
//     notas?,
//     frases?: [{ escenario, tipo }, ...]              // override para emisores agente retencion
//     // Si metodo_pago === 'tarjeta', REQUERIDO el resultado de la
//     // autorizacion Neonet ya capturado por el bridge NeoPOS / mock:
//     neonet_resultado?: {
//       idsale,                        // generado por el front antes del Intent
//       amount_cents,                  // monto autorizado en centavos
//       respuesta_lector: { ... },     // shape identico al manual NeoPos
//       origen: 'mock'|'sandbox'|'prod'
//     }
//   }
//
// Flujo:
//   1. Validar entrada.
//   2. Si tarjeta: validar neonet_resultado.respuesta_lector.approved === 'true'.
//      Si no aprobado, 400 con detalle.
//   3. Si tarjeta: INSERT en neonet_transacciones (factura_id=NULL) ANTES
//      de tocar facturas_fel. Esto captura el cobro real aunque despues
//      todo el resto falle (caso pendiente_idx).
//   4. Crear facturas_fel (estado='borrador') + facturas_fel_items.
//   5. Cargar config_fel; construir XML; firmar+certificar con Infile.
//   6a. Si certifica OK: marcar factura certificada. Si tarjeta: UPDATE
//       neonet_transacciones.factura_id = factura.id (vinculo final).
//       Llamar RPC pos_descontar_inventario, descontar insumos opt-in,
//       asiento.
//   6b. Si certificación falla: borrar borrador FEL.
//       Si tarjeta: dejar neonet_transacciones tal cual (factura_id=NULL).
//       Esto entra al indice pendiente_idx para manejo manual (anular en
//       Neonet o esperar reversal).

import { requireAdminOCajero } from '../../../lib/auth'
import { crearCliente, InfileError, frasesDesdeConfig } from '../../../lib/infile/client'
import { construirDteFactura } from '../../../lib/infile/construirDte'
import { generarAsientoVentaPos } from '../../../lib/contabilidad/generador'
import { explotarPlan } from '../../../lib/produccion'
import { turnoAbiertoDeCajero } from '../../../lib/turnos/helpers'
import { crearComandaParaFactura } from '../../../lib/comandas/helpers'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAdminOCajero(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  // Si es cajero, exige turno abierto. La factura quedara ligada al turno.
  let turnoId = null
  if (auth.perfil.rol === 'cajero') {
    const turno = await turnoAbiertoDeCajero(auth.admin, auth.user.id)
    if (!turno) {
      return res.status(403).json({ error: 'Necesitás abrir caja antes de vender' })
    }
    turnoId = turno.id
  }

  const body = req.body || {}
  const { items, receptor = {}, metodo_pago, notas, frases, neonet_resultado, pagos } = body

  // ===== Validación =====
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items[] requerido' })
  }
  const METODOS = new Set(['efectivo', 'tarjeta', 'transferencia', 'pedidos_ya', 'otro'])
  if (!METODOS.has(metodo_pago)) {
    return res.status(400).json({ error: 'metodo_pago invalido (efectivo|tarjeta|transferencia|pedidos_ya|otro)' })
  }

  // Split payments (opcional). Si pagos[] viene con >=1 elemento, validamos
  // que la suma cuadre con el total de la venta (calculado mas abajo). Si
  // pagos.length > 1, en la factura quedara metodo_pago='mixto' y los
  // detalles se insertan en facturas_fel_pagos. Si pagos.length === 1, se
  // ignora pagos[] y se respeta el comportamiento legacy (metodo_pago plano).
  let pagosNorm = null
  if (Array.isArray(pagos) && pagos.length > 0) {
    pagosNorm = []
    for (const [i, p] of pagos.entries()) {
      if (!METODOS.has(p.metodo)) {
        return res.status(400).json({ error: `pago ${i + 1}: metodo invalido` })
      }
      const monto = Number(p.monto)
      if (!Number.isFinite(monto) || monto <= 0) {
        return res.status(400).json({ error: `pago ${i + 1}: monto debe ser > 0` })
      }
      pagosNorm.push({
        metodo: p.metodo,
        monto: round2(monto),
        referencia: p.referencia ? String(p.referencia).slice(0, 200) : null,
        notas: p.notas ? String(p.notas).slice(0, 500) : null,
      })
    }
  }

  // ===== Validación Neonet si metodo_pago = tarjeta =====
  // El frontend del POS DEBE haber capturado la autorización via Intent
  // (Sunmi prod) o mock (desarrollo) antes de llamarnos. Acá solo validamos
  // y persistimos.
  //
  // Modo "tarjeta externa" (env TARJETA_INTEGRADA != 'true'): el cajero pasó
  // la tarjeta en un lector aparte (ej. BAC PAX standalone) y solo nos
  // confirma "ya cobré" — no esperamos neonet_resultado. La factura sale
  // con metodo_pago='tarjeta' pero sin auth_code interno.
  const tarjetaIntegrada = String(process.env.TARJETA_INTEGRADA || 'false').toLowerCase() === 'true'
  let neonetParsed = null
  if (metodo_pago === 'tarjeta' && tarjetaIntegrada) {
    if (!neonet_resultado || typeof neonet_resultado !== 'object') {
      return res.status(400).json({ error: 'tarjeta requiere neonet_resultado del bridge NeoPOS' })
    }
    const { idsale, amount_cents, respuesta_lector, origen } = neonet_resultado
    if (!idsale || typeof idsale !== 'string') {
      return res.status(400).json({ error: 'neonet_resultado.idsale requerido' })
    }
    if (!Number.isFinite(Number(amount_cents)) || Number(amount_cents) <= 0) {
      return res.status(400).json({ error: 'neonet_resultado.amount_cents debe ser entero > 0' })
    }
    if (!respuesta_lector || typeof respuesta_lector !== 'object') {
      return res.status(400).json({ error: 'neonet_resultado.respuesta_lector requerido' })
    }
    // El manual NeoPOS usa strings 'true'/'false' en `approved` (no booleano).
    // Aceptamos ambas formas por defensa.
    const approvedRaw = respuesta_lector.approved
    const approved = approvedRaw === true || approvedRaw === 'true' || approvedRaw === '1'
    if (!approved) {
      return res.status(400).json({
        error: 'Neonet rechazó la autorización — no se crea factura',
        response_code: respuesta_lector.response_code,
        response_message: respuesta_lector.response_message,
      })
    }
    const validOrigen = ['mock', 'sandbox', 'prod'].includes(origen) ? origen : 'mock'
    neonetParsed = {
      idsale,
      amount_cents: Math.round(Number(amount_cents)),
      respuesta_lector,
      origen: validOrigen,
    }
  }
  for (const [i, it] of items.entries()) {
    if (!it.descripcion?.trim()) return res.status(400).json({ error: `item ${i + 1}: descripcion requerida` })
    if (!(Number(it.cantidad) > 0)) return res.status(400).json({ error: `item ${i + 1}: cantidad > 0 requerida` })
    if (!(Number(it.precio_unitario) > 0)) return res.status(400).json({ error: `item ${i + 1}: precio_unitario > 0 requerido` })
  }

  // Receptor
  const receptorNit = (receptor.nit || 'CF').trim().toUpperCase()
  const esCF = receptorNit === 'CF' || !receptorNit
  const receptorNombre = (receptor.nombre || (esCF ? 'CONSUMIDOR FINAL' : '')).trim()
  if (!esCF && !receptorNombre) {
    return res.status(400).json({ error: 'receptor.nombre requerido cuando no es CF' })
  }

  // ===== Cargar config_fel y validar credenciales Infile =====
  const { data: config } = await auth.admin.from('config_fel').select('*').limit(1).maybeSingle()
  if (!config) return res.status(400).json({ error: 'No hay config_fel. Configurá emisor en /configuracion-fel.' })
  for (const k of ['nit_emisor', 'nombre_comercial', 'infile_alias_firma', 'infile_llave_firma', 'infile_llave_cert']) {
    if (!config[k]) return res.status(400).json({ error: `Falta ${k} en config_fel` })
  }

  // ===== 0. Si tarjeta: persistir neonet_transacciones ANTES de la factura =====
  // Captura el cobro real aunque la certificacion FEL falle despues.
  // Si la certificacion falla, factura_id queda NULL y entra al indice
  // pendiente_idx para manejo manual (anular en Neonet o esperar reversal).
  let neonetTransaccionId = null
  if (neonetParsed) {
    const rl = neonetParsed.respuesta_lector || {}
    const { data: insRow, error: nErr } = await auth.admin
      .from('neonet_transacciones')
      .insert({
        idsale:             neonetParsed.idsale,
        tipo:               'sale',
        terminal_id:        rl.terminalId || null,
        card_acq_id:        rl.cardAcqId || null,
        amount_cents:       neonetParsed.amount_cents,
        approved:           true,
        response_code:      rl.response_code || null,
        response_message:   rl.response_message || null,
        authorization_code: rl.authorization_code || null,
        retrieval_no:       rl.retrieval_no || null,
        voucher_code:       rl.voucher_code || null,
        suggested_nit:      rl.suggested_nit || null,
        pan_masked:         rl.panPci || null,
        card_holder_name:   rl.cardHolderName || null,
        pos_entry_mode:     rl.posEntryMode || null,
        origen:             neonetParsed.origen,
        factura_id:         null,
        raw_response:       rl,
        created_by:         auth.user.id,
      })
      .select('id').single()
    if (nErr) {
      // 23505 = unique_violation sobre idsale -> doble click.
      if (nErr.code === '23505') {
        return res.status(409).json({
          ok: false, etapa: 'neonet_duplicate_idsale',
          error: 'Ya existe una transacción Neonet con ese idsale. ¿Doble click?',
          idsale: neonetParsed.idsale,
        })
      }
      return res.status(500).json({ ok: false, etapa: 'neonet_persist', error: nErr.message })
    }
    neonetTransaccionId = insRow.id
  }

  // ===== Calcular totales =====
  let totalGravado = 0
  let ivaTotal = 0
  const itemsNorm = items.map((it, i) => {
    const cantidad = Number(it.cantidad)
    const precioUnit = Number(it.precio_unitario)
    const total = round2(cantidad * precioUnit)
    const afectaIva = it.afecta_iva !== false
    const gravable = afectaIva ? round2(total / 1.12) : 0
    const ivaItem = afectaIva ? round2(total - gravable) : 0
    totalGravado += gravable
    ivaTotal += ivaItem
    return {
      orden: i,
      bien_o_servicio: it.bien_o_servicio === 'S' ? 'S' : 'B',
      descripcion: it.descripcion.trim(),
      unidad_medida: (it.unidad_medida || 'UND').trim() || 'UND',
      cantidad,
      precio_unitario: precioUnit,
      descuento: 0,
      subtotal: total,
      afecta_iva: afectaIva,
      variant_id: it.variant_id || null,
      receta_id: it.receta_id || null,
      descuenta_insumos: !!it.descuenta_insumos,
    }
  })
  const totalFinal = round2(itemsNorm.reduce((s, it) => s + it.subtotal, 0))

  // Si hay split payments, validar que la suma de pagos cuadre con el total.
  // Tolerancia de Q0.01 por errores de redondeo. Si pagos.length === 1
  // colapsamos a metodo_pago plano (no necesita fila en facturas_fel_pagos).
  let metodoPagoFinal = metodo_pago
  if (pagosNorm && pagosNorm.length > 0) {
    const sumaPagos = round2(pagosNorm.reduce((s, p) => s + p.monto, 0))
    if (Math.abs(sumaPagos - totalFinal) > 0.01) {
      return res.status(400).json({
        error: `Suma de pagos (Q${sumaPagos.toFixed(2)}) no coincide con total de venta (Q${totalFinal.toFixed(2)})`,
      })
    }
    if (pagosNorm.length > 1) {
      metodoPagoFinal = 'mixto'  // multiple = mixto en facturas_fel; detalle en facturas_fel_pagos
    } else {
      // 1 solo pago → respetamos su metodo (override del metodo_pago top-level)
      metodoPagoFinal = pagosNorm[0].metodo
    }
  }

  // ===== 1. Crear factura en borrador =====
  const { data: facturaBorrador, error: insErr } = await auth.admin
    .from('facturas_fel')
    .insert({
      receptor_nit: receptorNit,
      receptor_nombre: receptorNombre,
      receptor_direccion: receptor.direccion || null,
      receptor_email: receptor.email || null,
      tipo_documento: 'FACT',
      moneda: 'GTQ',
      fecha_emision: new Date().toISOString(),
      total_gravado: round2(totalGravado),
      total_exento: 0,
      iva: round2(ivaTotal),
      total: totalFinal,
      metodo_pago: metodoPagoFinal,
      estado: 'borrador',
      origen_tipo: 'pos_propio',
      turno_id: turnoId,
      notas: notas || null,
      creado_por: auth.user.id,
    })
    .select().single()
  if (insErr) {
    return res.status(500).json({ ok: false, etapa: 'crear_borrador', error: insErr.message })
  }

  const itemsParaInsert = itemsNorm.map(it => ({ ...it, factura_id: facturaBorrador.id }))
  const { error: itemsErr } = await auth.admin.from('facturas_fel_items').insert(itemsParaInsert)
  if (itemsErr) {
    await auth.admin.from('facturas_fel').delete().eq('id', facturaBorrador.id)
    return res.status(500).json({ ok: false, etapa: 'crear_items', error: itemsErr.message })
  }

  // ===== 2. Construir XML y certificar =====
  // Frases: si el caller pasa explicitamente `frases`, se respeta; sino se
  // derivan de la config del emisor (Frase Tipo 1 base + extras como
  // Agente Retencion IVA si aplica).
  const frasesFinales = (Array.isArray(frases) && frases.length > 0)
    ? frases
    : frasesDesdeConfig(config)
  let xmlInfo
  try {
    xmlInfo = construirDteFactura({
      config,
      factura: { ...facturaBorrador, frase_iva: '1', escenario_iva: 1 },
      items: itemsNorm,
      opciones: { frases: frasesFinales },
    })
  } catch (e) {
    await auth.admin.from('facturas_fel_items').delete().eq('factura_id', facturaBorrador.id)
    await auth.admin.from('facturas_fel').delete().eq('id', facturaBorrador.id)
    return res.status(500).json({ ok: false, etapa: 'construir_xml', error: e.message })
  }

  let cert
  try {
    const client = crearCliente(config)
    cert = await client.firmarYCertificar(xmlInfo.xml, facturaBorrador.id, {
      correoCopia: receptor.email || '',
    })
  } catch (e) {
    // ======================================================================
    // FALLBACK INFILE — vender y certificar después
    //
    // Si el error es de RED o HTTP 5xx (Infile caído / sobrecargado), NO
    // borramos el borrador: lo guardamos en estado 'pendiente_certificacion'
    // con el XML listo. El cron /api/cron/reintentar-fel cada 5 min lo va
    // a procesar cuando Infile vuelva. Cliente sigue cobrando, la cola
    // sigue avanzando. La factura sale por email automáticamente cuando
    // la certificación termine.
    //
    // Si el error es 4xx o validación local (XML mal armado, NIT inválido,
    // etc), Infile dijo NO conscientemente — no tiene sentido reintentar.
    // Borramos el borrador y devolvemos error como antes.
    // ======================================================================
    const esCaida = !(e instanceof InfileError)
      ? true   // error de runtime/red → fallback
      : (e.status == null || e.status >= 500)   // sin status (network) o 5xx
    const esFirma502 = (e instanceof InfileError) && e.etapa === 'firma' && e.status >= 500
    const debeReintentarse = esCaida || esFirma502

    if (debeReintentarse) {
      console.warn('[ventas] Infile caído — marcando pendiente_certificacion:', e.message)
      await auth.admin.from('facturas_fel')
        .update({
          estado: 'pendiente_certificacion',
          xml_pendiente: xmlInfo.xml,
          intentos_certificacion: 1,
          ultimo_intento_at: new Date().toISOString(),
          error_ultimo_intento: e.message,
          pendiente_desde: new Date().toISOString(),
        })
        .eq('id', facturaBorrador.id)

      // Devolvemos 200 con flag pendiente_certificacion: el front del POS
      // imprime ticket NO FISCAL ("En certificación") y permite seguir
      // operando. La factura se certifica sola en el cron.
      return res.status(200).json({
        ok: true,
        certificada: false,
        pendiente_certificacion: true,
        factura: {
          id: facturaBorrador.id,
          serie_sat: null,
          numero_sat: null,
          uuid_sat: null,
          total: facturaBorrador.total,
          iva: facturaBorrador.iva,
          metodo_pago: facturaBorrador.metodo_pago,
          receptor_nit: facturaBorrador.receptor_nit,
          receptor_nombre: facturaBorrador.receptor_nombre,
          fecha_certificacion: null,
        },
        descuento: null,
        asiento: null,
        warning: 'Infile no responde — venta guardada en cola de certificación. Se certifica automáticamente al volver.',
      })
    }

    // Caso "rechazo legítimo": borrar borrador y devolver error como siempre.
    await auth.admin.from('facturas_fel_items').delete().eq('factura_id', facturaBorrador.id)
    await auth.admin.from('facturas_fel').delete().eq('id', facturaBorrador.id)
    if (e instanceof InfileError) {
      return res.status(502).json({
        ok: false, etapa: e.etapa || 'infile', error: e.message,
        payload: e.payload, xml_que_fallo: xmlInfo.xml,
      })
    }
    return res.status(500).json({ ok: false, etapa: 'infile_runtime', error: e.message })
  }
  if (!cert?.uuid) {
    await auth.admin.from('facturas_fel_items').delete().eq('factura_id', facturaBorrador.id)
    await auth.admin.from('facturas_fel').delete().eq('id', facturaBorrador.id)
    return res.status(502).json({ ok: false, etapa: 'cert_sin_uuid', error: 'Infile sin uuid', respuesta: cert?.raw })
  }

  // ===== 3. Marcar factura certificada =====
  const { data: facturaCert, error: updErr } = await auth.admin.from('facturas_fel').update({
    estado: 'certificada',
    uuid_sat: cert.uuid,
    serie_sat: cert.serie,
    numero_sat: cert.numero,
    fecha_certificacion: new Date().toISOString(),
    certificador: 'infile',
    xml_dte: cert.xml_certificado || xmlInfo.xml,
    updated_at: new Date().toISOString(),
  }).eq('id', facturaBorrador.id).select().single()
  if (updErr) {
    // La factura YA esta certificada en Infile pero falló el UPDATE local.
    // Devolvemos exito parcial para que el operador pueda recuperar.
    return res.status(207).json({
      ok: true, certificada: true, warning: 'Certifico Infile pero fallo UPDATE local: ' + updErr.message,
      uuid: cert.uuid, serie: cert.serie, numero: cert.numero,
      neonet_transaccion_id: neonetTransaccionId,  // sigue sin factura_id (pendiente)
    })
  }

  // ===== 3b. Si tarjeta: vincular neonet_transaccion con la factura =====
  // Cierra el caso "feliz" — sale del indice pendiente_idx.
  // Si este UPDATE falla, no abortamos: la conciliacion via idsale sigue
  // funcionando; solo queda como pendiente en el indice (manejo manual).
  if (neonetTransaccionId) {
    await auth.admin.from('neonet_transacciones')
      .update({ factura_id: facturaCert.id })
      .eq('id', neonetTransaccionId)
  }

  // ===== 3c. Si split payment: persistir desglose en facturas_fel_pagos =====
  // Solo cuando hay >1 pago (el caso de 1 solo ya quedo en facturas_fel.metodo_pago).
  // Si esto falla, NO abortamos — la factura ya esta certificada. Se loggea
  // para que admin pueda completar el desglose manualmente.
  let pagosInsertados = null
  if (pagosNorm && pagosNorm.length > 1) {
    const filasPagos = pagosNorm.map(p => ({
      factura_id: facturaCert.id,
      metodo: p.metodo,
      monto: p.monto,
      referencia: p.referencia,
      notas: p.notas,
      created_by: auth.user.id,
    }))
    const { error: errPagos } = await auth.admin
      .from('facturas_fel_pagos').insert(filasPagos)
    if (errPagos) {
      console.error('[pos/ventas] Fallo insertar facturas_fel_pagos:', errPagos.message)
      pagosInsertados = { ok: false, error: errPagos.message }
    } else {
      pagosInsertados = { ok: true, cantidad: filasPagos.length }
    }
  }

  // ===== 4. Descuento PT (atomico via RPC) =====
  const descuento = { pt: null, insumos: null }
  try {
    const { data: rpcResult, error: rpcErr } = await auth.admin
      .rpc('pos_descontar_inventario', { p_factura_id: facturaCert.id })
    if (rpcErr) {
      descuento.pt = { ok: false, error: rpcErr.message }
    } else {
      descuento.pt = rpcResult
    }
  } catch (e) {
    descuento.pt = { ok: false, error: e.message }
  }

  // ===== 5. Descuento insumos (opcional por linea) =====
  const itemsConReceta = itemsNorm.filter(it => it.descuenta_insumos && it.receta_id)
  if (itemsConReceta.length > 0) {
    try {
      const lineas = itemsConReceta.map(it => ({ receta_id: it.receta_id, cantidad: it.cantidad }))
      const explosion = await explotarPlan(auth.admin, lineas)
      // Crear movimientos tipo='salida' por cada insumo requerido.
      const motivo = `Venta POS ${facturaCert.uuid_sat || facturaCert.id.slice(0, 8)}`
      const insumoIds = explosion.requerimientos.map(r => r.insumo_id)
      const { data: insumosAhora } = await auth.admin
        .from('insumos').select('id, stock_actual, costo_unitario').in('id', insumoIds)
      const stockMap = new Map((insumosAhora || []).map(i => [i.id, Number(i.stock_actual) || 0]))
      const moves = []
      for (const r of explosion.requerimientos) {
        const stockAntes = stockMap.get(r.insumo_id) || 0
        const cant = Number(r.requerido)
        if (!(cant > 0)) continue
        moves.push({
          insumo_id: r.insumo_id,
          tipo: 'salida',
          delta: -cant,
          stock_antes: stockAntes,
          stock_despues: Number((stockAntes - cant).toFixed(4)),
          costo_unitario: r.costo_unitario,
          motivo,
          referencia: { factura_id: facturaCert.id, origen: 'pos_propio' },
          created_by: auth.user.id,
        })
      }
      if (moves.length > 0) {
        const { error: movErr } = await auth.admin.from('insumos_movimientos').insert(moves)
        descuento.insumos = movErr ? { ok: false, error: movErr.message } : { ok: true, movimientos: moves.length }
      } else {
        descuento.insumos = { ok: true, movimientos: 0 }
      }
    } catch (e) {
      descuento.insumos = { ok: false, error: e.message }
    }
  }

  // ===== 6. Asiento contable (best effort) =====
  let asiento = null
  try {
    asiento = await generarAsientoVentaPos(auth.admin, facturaCert.id, auth.user.id)
  } catch (e) {
    asiento = { ok: false, error: e.message }
  }

  // ===== 7. Comanda de barra (best effort) =====
  // Si la venta tiene items en categorias con es_barra=true, abre comanda.
  // El iPad de la barra se subscribe via Supabase Realtime y la ve aparecer.
  let comanda = null
  try {
    const r = await crearComandaParaFactura(auth.admin, facturaCert, itemsNorm)
    comanda = r
  } catch (e) {
    comanda = { error: e.message }
  }

  return res.status(200).json({
    ok: true,
    factura: {
      id: facturaCert.id,
      uuid_sat: facturaCert.uuid_sat,
      serie_sat: facturaCert.serie_sat,
      numero_sat: facturaCert.numero_sat,
      total: facturaCert.total,
      iva: facturaCert.iva,
      metodo_pago: facturaCert.metodo_pago,
      receptor_nit: facturaCert.receptor_nit,
      receptor_nombre: facturaCert.receptor_nombre,
      fecha_certificacion: facturaCert.fecha_certificacion,
    },
    descuento,
    asiento,
    comanda,
    // Solo si fue split payment (>1 pago):
    pagos: pagosInsertados,
    // Solo si la venta fue con tarjeta:
    neonet: neonetParsed ? {
      transaccion_id: neonetTransaccionId,
      authorization_code: neonetParsed.respuesta_lector.authorization_code,
      voucher_code: neonetParsed.respuesta_lector.voucher_code,
      pan_masked: neonetParsed.respuesta_lector.panPci,
      origen: neonetParsed.origen,
    } : null,
  })
}

export const config = { maxDuration: 60 }
