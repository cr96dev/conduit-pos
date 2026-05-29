// pages/api/soporte/chat.js
// POST /api/soporte/chat   body: { conversacion_id?, mensaje, contexto? }
//
// Si conversacion_id viene -> usa esa. Si no -> crea conversacion nueva.
// Persiste mensaje del user + respuesta del assistant + tokens (cost tracking).
// Llama a Claude haiku-4-5 con system prompt orientado a soporte de cajero.
//
// Auth: admin | cajero | barista.

import { requireAuth } from '../../../lib/auth'

const MODELO = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 1024
const HISTORIAL_MAX = 20  // mensajes recientes a incluir en la llamada

function systemPrompt(cajero, perfil) {
  return `Sos el asistente de soporte tecnico de Julia Bakery POS, una panaderia en Guatemala City.

Estas hablando con ${cajero || 'un cajero'} (rol: ${perfil?.rol || 'desconocido'}).

ROL Y TONO:
- Hablas espanol coloquial guatemalteco. Sin tecnicismos.
- Eres amigable pero conciso. Respuestas cortas (2-5 lineas tipico).
- El usuario es un cajero NO tecnico. NUNCA des comandos ADB, SQL, o de terminal.

QUE PODES HACER:
- Diagnosticar problemas operativos del POS (ventas que no salen, ticket que no imprime, NIT que no se encuentra, comanda que no llega al iPad, factura rechazada, etc.)
- Guiar paso a paso para resolver problemas comunes
- Sugerir workarounds si reconoces un bug
- Pedir info adicional cuando necesites (codigo de error, hora del problema, etc.)

CUANDO ESCALAR:
- Si el problema requiere admin (cambiar configuracion, resetear PIN de otro cajero, etc.), deci "Esto necesita que el admin lo haga, pediselo a [admin]".
- Si es un bug claro del software, agradeceé el reporte y deci "Lo registro como bug para que lo arreglen pronto".
- Si pide algo fuera de POS (cocina, contabilidad, planilla), reconducílo: "Eso no lo manejo yo, hablalo con el admin".

CONTEXTO OPERATIVO:
- El POS corre en un Sunmi D3 Mini (tablet POS) con la app Julia Bakery POS.
- El cajero abre caja al loguearse y la cierra al final del turno.
- Las ventas con productos de barra (cafe, frappes, jugos) generan automaticamente comanda al iPad de barra.
- El ticket impreso sale por la termica del Sunmi.
- Si el cajero cobra con tarjeta, hay que insertar la tarjeta en el lector P5L Neonet.

SI TE PREGUNTA "HOLA" / "QUE TAL":
- Saludalo brevemente y pregunta en que puede ayudarlo.

NO INVENTES funcionalidades que no existen. Si no sabes algo, deci "No estoy seguro, mejor preguntale al admin."`
}

function adminClient() {
  const { createClient } = require('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Llama Anthropic con messages history + system prompt + contexto.
async function llamarClaude(messages, system) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    }),
  })
  const json = await r.json()
  if (json.error) {
    throw new Error('Anthropic API: ' + (json.error.message || JSON.stringify(json.error)))
  }
  const text = json.content?.[0]?.text || 'Sin respuesta'
  const usage = json.usage || {}
  return {
    text,
    tokens_input: usage.input_tokens || 0,
    tokens_output: usage.output_tokens || 0,
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  const { rol, nombre_completo } = auth.perfil
  if (!['admin', 'cajero', 'barista'].includes(rol)) {
    return res.status(403).json({ error: 'Requiere rol operativo' })
  }

  const { conversacion_id, mensaje, contexto } = req.body || {}
  if (!mensaje || typeof mensaje !== 'string' || !mensaje.trim()) {
    return res.status(400).json({ error: 'mensaje requerido' })
  }
  if (mensaje.length > 4000) {
    return res.status(400).json({ error: 'mensaje demasiado largo (max 4000 chars)' })
  }

  const admin = adminClient()
  let convId = conversacion_id

  // 1. Crear conversacion si no se paso una
  if (!convId) {
    const { data: turnoActual } = await admin
      .from('turnos_caja')
      .select('id')
      .eq('cajero_id', auth.user.id)
      .eq('estado', 'abierto')
      .maybeSingle()
    const { data: convNueva, error: cErr } = await admin
      .from('soporte_conversaciones')
      .insert({
        cajero_id: auth.user.id,
        turno_id: turnoActual?.id || null,
        asunto: mensaje.slice(0, 80),
        contexto_inicial: contexto || {},
        estado: 'abierta',
      })
      .select('id')
      .single()
    if (cErr) return res.status(500).json({ error: 'Error creando conversacion: ' + cErr.message })
    convId = convNueva.id
  } else {
    // Verificar que la conversacion existe y es del cajero (o es admin)
    const { data: conv } = await admin
      .from('soporte_conversaciones')
      .select('cajero_id')
      .eq('id', convId)
      .maybeSingle()
    if (!conv) return res.status(404).json({ error: 'Conversacion no encontrada' })
    if (conv.cajero_id !== auth.user.id && rol !== 'admin') {
      return res.status(403).json({ error: 'No autorizado para esta conversacion' })
    }
  }

  // 2. Persistir el mensaje del usuario
  await admin.from('soporte_mensajes').insert({
    conversacion_id: convId,
    rol: 'user',
    contenido: mensaje,
    contexto: contexto || {},
  })

  // 3. Cargar historial (ultimos HISTORIAL_MAX mensajes ordenados crono)
  const { data: historial } = await admin
    .from('soporte_mensajes')
    .select('rol, contenido, contexto, created_at')
    .eq('conversacion_id', convId)
    .order('created_at', { ascending: true })
    .limit(HISTORIAL_MAX)

  // 4. Construir messages para Anthropic
  // El system prompt va aparte. Los user/assistant van en messages.
  // Si el ultimo mensaje del user tiene contexto operativo, lo enriquezo dentro
  // del mensaje (el modelo no recibe el campo 'contexto' del row, lo concateno).
  const messages = (historial || [])
    .filter(m => m.rol === 'user' || m.rol === 'assistant')
    .map(m => {
      if (m.rol === 'user' && m.contexto && Object.keys(m.contexto).length > 0) {
        const ctxStr = '\n\n[CONTEXTO OPERATIVO DEL CAJERO EN ESE MOMENTO]\n' + JSON.stringify(m.contexto, null, 2)
        return { role: 'user', content: m.contenido + ctxStr }
      }
      return { role: m.rol, content: m.contenido }
    })

  // 5. Llamar Claude
  let respuesta
  try {
    respuesta = await llamarClaude(messages, systemPrompt(nombre_completo, auth.perfil))
  } catch (e) {
    // Persistir el error como assistant message para auditoria
    await admin.from('soporte_mensajes').insert({
      conversacion_id: convId,
      rol: 'system',
      contenido: 'ERROR llamando Anthropic: ' + e.message,
      modelo: MODELO,
    })
    return res.status(502).json({
      error: 'Error consultando al asistente: ' + e.message,
      conversacion_id: convId,
    })
  }

  // 6. Persistir respuesta + tokens
  await admin.from('soporte_mensajes').insert({
    conversacion_id: convId,
    rol: 'assistant',
    contenido: respuesta.text,
    tokens_input: respuesta.tokens_input,
    tokens_output: respuesta.tokens_output,
    modelo: MODELO,
  })

  // 7. Actualizar updated_at de la conversacion
  await admin.from('soporte_conversaciones')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', convId)

  return res.status(200).json({
    ok: true,
    conversacion_id: convId,
    respuesta: respuesta.text,
    tokens: {
      input: respuesta.tokens_input,
      output: respuesta.tokens_output,
    },
  })
}

export const config = { maxDuration: 60 }
