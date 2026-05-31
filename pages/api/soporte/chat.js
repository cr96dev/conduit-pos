// pages/api/soporte/chat.js
// POST /api/soporte/chat   body: { conversacion_id?, mensaje, contexto? }
//
// Si conversacion_id viene -> usa esa. Si no -> crea conversacion nueva.
// Persiste mensaje del user + respuesta del assistant + tokens (cost tracking).
// Llama a Claude haiku-4-5 con system prompt orientado a soporte de cajero.
//
// Auth: admin | cajero | barista.

import { requireAuth } from '../../../lib/auth'

// Sonnet 4.5 maneja tool use + conversaciones largas mejor que haiku.
// Probado: haiku-4-5 devolvia content=[] cuando la historia tenia mucho ruido.
const MODELO = 'claude-sonnet-4-5-20250929'
const MAX_TOKENS = 3000
const HISTORIAL_MAX = 4   // ultimos N mensajes (mas que esto = contagio de estilos viejos)

function systemPrompt(cajero, perfil) {
  return `Es el asistente de soporte de Julia Bakery POS, una panaderia en Guatemala.
Esta hablando con ${cajero || 'un cajero'} (rol: ${perfil?.rol || 'desconocido'}).

ESTILO (importante):
- Espanol formal, usando "usted". Sea conciso (2 a 4 oraciones).
- Texto plano. NO use markdown (asteriscos, almohadillas, guiones bajos para formato). NO use emojis. NO use lenguaje coloquial.
- Para pasos: numere 1., 2., 3. sin negritas.

QUE PUEDE HACER:
- Diagnosticar problemas operativos del POS (ventas, impresion, certificacion FEL, NIT, comandas).
- Usar herramientas read-only para consultar datos del sistema en tiempo real.
- Proponer acciones de escritura (reimprimir, reintentar certificacion, actualizar correo) que el usuario debera confirmar tocando un boton en pantalla.
- Si la consulta es off-topic (ej. saludo o pregunta personal), responda brevemente y redirija: "Soy el asistente de soporte. ¿En que puedo asistirle con el POS?"

HERRAMIENTAS DE ACCION (write):
- Cuando invoque reimprimir_factura, reintentar_certificar, actualizar_correo_receptor o anular_factura: NO se ejecuta inmediatamente. Se crea una accion pendiente. Su respuesta de texto debe explicar QUE va a hacer y mencionar que el usuario vera botones Confirmar/Cancelar abajo.
- Anular es solo para admin y es irreversible — proponerla solo si el usuario lo pide explicitamente.

REGLAS DURAS:
1. SIEMPRE responda con texto (al menos una oracion). Nunca con vacio.
2. No invente funcionalidades. Si no sabe, diga "No tengo certeza, consulte con el administrador".
3. Si una tool devuelve cero resultados, diga claramente que no encontro y pida mas datos.
4. No proponga write tools sin que el usuario lo pida explicitamente.`
}

function adminClient() {
  const { createClient } = require('@supabase/supabase-js')
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

import { toolsParaAnthropic, obtenerTool, permitida } from '../../../lib/soporte/tools'

const MAX_TOOL_ITERACIONES = 5  // Hard cap por mensaje: si Claude pide mas, paramos

/**
 * Llama Anthropic con messages + system + tools, y resuelve el tool-use loop.
 * Devuelve el texto final + tokens acumulados + lista de tool calls ejecutadas
 * (para audit + UI).
 *
 * El loop:
 *   1. POST a Anthropic con messages + tools.
 *   2. Si la respuesta tiene stop_reason='end_turn', devolver el texto.
 *   3. Si tiene stop_reason='tool_use', extraer cada tool_use block:
 *      - validar que la tool existe y el usuario tiene permiso
 *      - ejecutar el handler local
 *      - construir tool_result block con el resultado (o error)
 *      - agregar assistant message + user message con tool_results
 *      - continuar loop (max MAX_TOOL_ITERACIONES iteraciones)
 *   4. Si excedemos iteraciones: devolver lo ultimo + warning.
 */
async function llamarClaudeConTools(messagesInit, system, ctxTools) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurada')

  const tools = toolsParaAnthropic()
  let messages = [...messagesInit]
  let tokens_input = 0
  let tokens_output = 0
  const toolCallsLog = []  // para audit + UI: [{name, input, output, ok, duracion_ms}]

  for (let i = 0; i < MAX_TOOL_ITERACIONES; i++) {
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
        tools,
      }),
    })
    const json = await r.json()
    if (json.error) {
      throw new Error('Anthropic API: ' + (json.error.message || JSON.stringify(json.error)))
    }
    tokens_input += json.usage?.input_tokens || 0
    tokens_output += json.usage?.output_tokens || 0

    const stopReason = json.stop_reason
    const content = json.content || []

    if (stopReason === 'end_turn' || stopReason === 'max_tokens' || stopReason === 'stop_sequence') {
      // No mas tools, extraer texto
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim()
      if (!text) {
        // Debug visible si quedo vacio. Dumpeo la respuesta cruda + lo que mandamos.
        console.warn('[soporte] respuesta vacia. stop_reason=' + stopReason +
          ' content_types=' + JSON.stringify(content.map(c => c.type)) +
          ' tools_corridas=' + toolCallsLog.map(t => t.name + (t.ok ? '' : '!')).join(','))
        console.warn('[soporte] ANTHROPIC RESPONSE:', JSON.stringify(json).slice(0, 2000))
        console.warn('[soporte] MESSAGES enviados (len=' + messages.length + '):',
          JSON.stringify(messages).slice(0, 1500))
        const ultimaToolError = [...toolCallsLog].reverse().find(t => !t.ok)
        const fallback = ultimaToolError
          ? `Tuve un problema al consultar la informacion: ${ultimaToolError.output?.error || 'error desconocido'}. ¿Desea intentarlo nuevamente o reformular su consulta?`
          : 'No tengo una respuesta clara para esa consulta. ¿Podria reformularla con mas detalle?'
        return { text: fallback, tokens_input, tokens_output, toolCallsLog }
      }
      return { text, tokens_input, tokens_output, toolCallsLog }
    }

    if (stopReason !== 'tool_use') {
      // Resultado inesperado — extraer lo que se pueda
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('\n\n').trim()
      console.warn('[soporte] stop_reason inesperado=' + stopReason + ' text_len=' + text.length)
      return {
        text: text || `Respuesta truncada o invalida (codigo: ${stopReason}). Intente reformular.`,
        tokens_input, tokens_output, toolCallsLog,
      }
    }

    // Procesar tool_use: agregar la assistant turn al historial, ejecutar cada tool,
    // mandar tool_results en una user turn.
    messages.push({ role: 'assistant', content })

    const toolResults = []
    for (const block of content) {
      if (block.type !== 'tool_use') continue
      const { id: tu_id, name, input } = block
      const tool = obtenerTool(name)
      const t0 = Date.now()
      let resultadoTool
      try {
        if (!tool) {
          resultadoTool = { ok: false, error: `Tool desconocida: ${name}` }
        } else if (!permitida(tool, ctxTools.perfil)) {
          resultadoTool = { ok: false, error: `Permiso denegado para tool ${name} (requiere admin)` }
        } else {
          resultadoTool = await tool.handler(input || {}, ctxTools)
        }
      } catch (e) {
        resultadoTool = { ok: false, error: 'Excepcion ejecutando tool: ' + (e.message || String(e)) }
      }
      const duracion = Date.now() - t0
      toolCallsLog.push({ name, input, output: resultadoTool, ok: !!resultadoTool.ok, duracion_ms: duracion, tu_id })
      if (!resultadoTool.ok) {
        console.warn('[soporte] tool ' + name + ' fallo:', resultadoTool.error || JSON.stringify(resultadoTool).slice(0, 200))
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu_id,
        content: JSON.stringify(resultadoTool),
        is_error: !resultadoTool.ok,
      })
    }

    messages.push({ role: 'user', content: toolResults })
    // Continuar el loop para que Claude resuma / decida proximo paso
  }

  // Salimos por max iteraciones — devolver mensaje fallback
  return {
    text: 'Lo siento, no pude completar la operacion en el numero de pasos permitido. Por favor reformule su consulta o contacte al administrador.',
    tokens_input,
    tokens_output,
    toolCallsLog,
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

  // 3. Cargar historial: los HISTORIAL_MAX mensajes MAS RECIENTES, despues
  //    invertidos para presentarlos crono al modelo. Si ordenamos ascending
  //    y limitamos, agarra los mas viejos — bug que dejo al modelo viendo
  //    mensajes ancestros sin enterarse de la consulta actual.
  const { data: historialDesc } = await admin
    .from('soporte_mensajes')
    .select('rol, contenido, contexto, created_at')
    .eq('conversacion_id', convId)
    .order('created_at', { ascending: false })
    .limit(HISTORIAL_MAX)
  const historial = (historialDesc || []).reverse()

  // 4. Construir messages para Anthropic
  // El system prompt va aparte. Los user/assistant van en messages.
  // Si el ultimo mensaje del user tiene contexto operativo, lo enriquezo dentro
  // del mensaje (el modelo no recibe el campo 'contexto' del row, lo concateno).
  //
  // IMPORTANTE: Filtramos del historial los mensajes assistant que sean
  // fallbacks vacios ("Sin respuesta", "No tengo una respuesta clara"). Si
  // los dejamos, Claude se "contagia" del patron y devuelve respuestas vacias
  // tambien — comportamiento observado en produccion.
  const FALLBACK_PATTERNS = [
    /^Sin respuesta\.?$/i,
    /^No tengo una respuesta clara/i,
    /^Tuve un problema al consultar/i,
    /^Respuesta truncada/i,
    /^Lo siento, no pude completar/i,
  ]
  function esFallback(texto) {
    if (!texto || typeof texto !== 'string') return true
    return FALLBACK_PATTERNS.some(re => re.test(texto.trim()))
  }
  /**
   * Sanitiza un mensaje assistant antiguo para que no contamine el estilo
   * actual con markdown / emojis / tono informal viejo. Mantiene la
   * informacion pero quita la presentacion.
   */
  function sanitizarAssistant(texto) {
    if (typeof texto !== 'string') return texto
    return texto
      // Markdown bold/italic
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
      .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
      // Headings
      .replace(/^#{1,6}\s+/gm, '')
      // Inline code
      .replace(/`([^`]+)`/g, '$1')
      // Emojis (rangos comunes — no exhaustivo pero cubre mayoria)
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '')  // emoticonos
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')  // simbolos
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')  // transporte
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')  // gestos extra
      .replace(/[\u{2600}-\u{27BF}]/gu, '')    // misc symbols
      // Multiples espacios consecutivos
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  }
  const messages = (historial || [])
    .filter(m => m.rol === 'user' || m.rol === 'assistant')
    .filter(m => !(m.rol === 'assistant' && esFallback(m.contenido)))
    .map(m => {
      if (m.rol === 'user' && m.contexto && Object.keys(m.contexto).length > 0) {
        const ctxStr = '\n\n[CONTEXTO OPERATIVO DEL CAJERO EN ESE MOMENTO]\n' + JSON.stringify(m.contexto, null, 2)
        return { role: 'user', content: m.contenido + ctxStr }
      }
      // Sanitizar assistant para no contaminar con markdown/emojis viejos
      if (m.rol === 'assistant') {
        return { role: 'assistant', content: sanitizarAssistant(m.contenido) }
      }
      return { role: m.rol, content: m.contenido }
    })
    .filter(m => m.content && String(m.content).trim().length > 0)
  // Tras filtrar, puede pasar que dos messages de user queden consecutivos
  // (porque su assistant intermedio fue fallback). Anthropic NO acepta
  // role:'user' consecutivos. Combinamos en uno solo.
  const messagesLimpios = []
  for (const m of messages) {
    const last = messagesLimpios[messagesLimpios.length - 1]
    if (last && last.role === m.role) {
      last.content = last.content + '\n\n' + m.content
    } else {
      messagesLimpios.push({ ...m })
    }
  }

  // 5. Llamar Claude (con tool-use loop)
  const ctxTools = {
    admin,
    perfil: auth.perfil,
    user: auth.user,
    conversacion_id: convId,
    ip: (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || null,
  }
  let respuesta
  try {
    respuesta = await llamarClaudeConTools(messagesLimpios, systemPrompt(nombre_completo, auth.perfil), ctxTools)
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

  // 5b. Persistir tool calls al audit log. Best-effort: si falla, no bloquea.
  for (const tc of respuesta.toolCallsLog) {
    try {
      await admin.from('soporte_tool_calls').insert({
        conversacion_id: convId,
        usuario_id: auth.user.id,
        tool_name: tc.name,
        tool_input: tc.input || {},
        tool_output: tc.output || {},
        ok: tc.ok,
        error_mensaje: tc.ok ? null : (tc.output?.error || null),
        duracion_ms: tc.duracion_ms,
        ip: ctxTools.ip,
      })
    } catch (e) {
      console.error('[soporte/chat] no pude logear tool call:', e.message)
    }
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

  // Tool calls resumidas para que la UI las muestre como "Claude consultó X"
  const toolCallsResumen = respuesta.toolCallsLog.map(tc => ({
    name: tc.name,
    ok: tc.ok,
    duracion_ms: tc.duracion_ms,
  }))

  // Pending actions creadas durante esta vuelta (write tools devuelven
  // pending_action_id). La UI las muestra como botones [Confirmar]/[Cancelar].
  const pendingActions = respuesta.toolCallsLog
    .filter(tc => tc.ok && tc.output?.pending_action_id)
    .map(tc => ({
      id: tc.output.pending_action_id,
      tool_name: tc.name,
      resumen: tc.output.resumen,
    }))

  return res.status(200).json({
    ok: true,
    conversacion_id: convId,
    respuesta: respuesta.text,
    tool_calls: toolCallsResumen,
    pending_actions: pendingActions,
    tokens: {
      input: respuesta.tokens_input,
      output: respuesta.tokens_output,
    },
  })
}

export const config = { maxDuration: 60 }
