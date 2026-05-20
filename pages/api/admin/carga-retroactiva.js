// pages/api/admin/carga-retroactiva.js
// SOLO accesible para Charles y Miguel
// Cargar ventas retroactivas: combustible, lubricantes, tienda

import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../../../lib/qbo/supabaseAdmin'

const AUTHORIZED_EMAILS = ['adoffice569@gmail.com', 'estacionesdeservicioguatemala@gmail.com']

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // 1. Obtener token del header Authorization (cliente lo envía)
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Falta token de autorización' })
  }
  const token = authHeader.replace('Bearer ', '')

  // 2. Crear cliente con el token del usuario y obtener su sesión
  const supabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  )

  const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token)
  if (authError || !user) {
    return res.status(401).json({ error: 'No autenticado' })
  }

  // 3. SOLO emails autorizados
  if (!AUTHORIZED_EMAILS.includes(user.email)) {
    return res.status(403).json({ error: 'Acceso denegado - funcionalidad restringida' })
  }

  // 4. Confirmar perfil admin
  const { data: perfil } = await supabaseAdmin
    .from('perfiles')
    .select('id, nombre_completo, rol')
    .eq('id', user.id)
    .single()

  if (!perfil || perfil.rol !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' })
  }

  const { categoria, fecha, estacion_id, datos, notas } = req.body

  if (!categoria || !fecha || !estacion_id || !datos) {
    return res.status(400).json({ error: 'Faltan campos: categoria, fecha, estacion_id, datos' })
  }

  const hoy = new Date().toISOString().split('T')[0]
  if (fecha > hoy) {
    return res.status(400).json({ error: 'No se permiten fechas futuras' })
  }

  const { data: estacion } = await supabaseAdmin
    .from('qbo_mapping_estaciones')
    .select('estacion_nombre')
    .eq('gasops_estacion_id', estacion_id)
    .single()

  try {
    let registroId = null
    let tablaDestino = null
    let montoTotal = 0
    let accion = 'INSERT'

    if (categoria === 'combustible') {
      tablaDestino = 'ventas'
      const { data: existente } = await supabaseAdmin
        .from('ventas')
        .select('id')
        .eq('fecha', fecha)
        .eq('estacion_id', estacion_id)
        .maybeSingle()

      const ventaData = {
        fecha,
        estacion_id,
        regular_litros: datos.regular_litros || 0,
        regular_ingresos: datos.regular_ingresos || 0,
        premium_litros: datos.premium_litros || 0,
        premium_ingresos: datos.premium_ingresos || 0,
        diesel_litros: datos.diesel_litros || 0,
        diesel_ingresos: datos.diesel_ingresos || 0,
        diesel_plus_litros: datos.diesel_plus_litros || 0,
        diesel_plus_ingresos: datos.diesel_plus_ingresos || 0,
        qbo_processed: false,
        qbo_processed_prod: false
      }

      montoTotal = (datos.regular_ingresos || 0) + (datos.premium_ingresos || 0) +
                   (datos.diesel_ingresos || 0) + (datos.diesel_plus_ingresos || 0)

      if (existente) {
        accion = 'UPDATE'
        registroId = existente.id
        const { error } = await supabaseAdmin
          .from('ventas')
          .update(ventaData)
          .eq('id', existente.id)
        if (error) throw error
      } else {
        const { data: nuevo, error } = await supabaseAdmin
          .from('ventas')
          .insert(ventaData)
          .select('id')
          .single()
        if (error) throw error
        registroId = nuevo.id
      }

    } else if (categoria === 'lubricantes') {
      tablaDestino = 'ventas_lubricantes'
      const lubData = {
        fecha,
        estacion_id,
        total_venta: datos.total_venta || 0,
        qbo_processed: false,
        qbo_processed_prod: false
      }
      montoTotal = datos.total_venta || 0

      const { data: nuevo, error } = await supabaseAdmin
        .from('ventas_lubricantes')
        .insert(lubData)
        .select('id')
        .single()
      if (error) throw error
      registroId = nuevo.id

      if (datos.detalles && Array.isArray(datos.detalles)) {
        const detalles = datos.detalles.map(d => ({
          ventas_lubricantes_id: registroId,
          sku: d.sku || 'LUB-GEN',
          nombre: d.nombre || 'Lubricante',
          cantidad: d.cantidad || 1,
          precio_unitario: d.precio_unitario || d.subtotal,
          subtotal: d.subtotal
        }))
        await supabaseAdmin.from('ventas_lubricantes_detalle').insert(detalles)
      }

    } else if (categoria === 'tienda') {
      tablaDestino = 'tienda_facturas_fel'
      if (!Array.isArray(datos.fels)) {
        return res.status(400).json({ error: 'Para tienda enviar datos.fels como array' })
      }

      const felsToInsert = datos.fels.map(f => ({
        fecha,
        estacion_id,
        numero_factura: f.numero_factura,
        uuid_fel: f.uuid_fel,
        nit_cliente: f.nit_cliente || 'CF',
        nombre_cliente: f.nombre_cliente || 'CONSUMIDOR FINAL',
        monto: f.monto,
        estado: 'pagada',
        tipo_documento: 'FACT',
        qbo_processed: false,
        qbo_processed_prod: false
      }))

      montoTotal = felsToInsert.reduce((s, f) => s + parseFloat(f.monto || 0), 0)

      const { data: nuevos, error } = await supabaseAdmin
        .from('tienda_facturas_fel')
        .insert(felsToInsert)
        .select('id')
      if (error) throw error
      registroId = nuevos[0]?.id
    } else {
      return res.status(400).json({ error: 'Categoria invalida' })
    }

    await supabaseAdmin.from('cargas_retroactivas_audit').insert({
      cargado_por_perfil_id: perfil.id,
      cargado_por_nombre: perfil.nombre_completo,
      categoria,
      fecha_venta: fecha,
      estacion_id,
      estacion_nombre: estacion?.estacion_nombre || 'Desconocida',
      tabla_destino: tablaDestino,
      registro_id: registroId,
      monto_total: montoTotal,
      detalles_json: datos,
      accion,
      notas
    })

    return res.status(200).json({
      success: true,
      categoria,
      fecha,
      estacion: estacion?.estacion_nombre,
      monto_total: montoTotal,
      accion,
      registro_id: registroId,
      mensaje: `Carga ${accion === 'UPDATE' ? 'actualizada' : 'creada'} correctamente. El cron del dia siguiente la procesara a QBO automaticamente.`
    })

  } catch (err) {
    console.error('[carga-retroactiva] Error:', err)
    return res.status(500).json({ error: err.message })
  }
}
