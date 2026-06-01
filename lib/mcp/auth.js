// lib/mcp/auth.js
// Validación del token de Claude Cowork.
//
// Cowork manda el token configurado en el plugin (.mcp.json) como header
// `Authorization: Bearer ${CLAUDE_MCP_TOKEN}`. Acá lo comparamos contra la env
// var del mismo nombre en Vercel.
//
// Mantener separado de INTERNAL_API_SECRET — son scopes distintos:
// - INTERNAL_API_SECRET = server-to-server admin
// - CLAUDE_MCP_TOKEN    = Claude Cowork con permisos de solo lectura (v0.1)

export function validarTokenCowork(req) {
  const expected = process.env.CLAUDE_MCP_TOKEN
  if (!expected) {
    return { ok: false, error: 'CLAUDE_MCP_TOKEN no configurada en el servidor' }
  }

  const auth = req.headers.authorization || ''
  const match = auth.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return { ok: false, error: 'Falta header Authorization Bearer' }
  }

  const provided = match[1].trim()

  // Comparación timing-safe para evitar timing attacks.
  if (provided.length !== expected.length) {
    return { ok: false, error: 'Token inválido' }
  }
  let diff = 0
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  if (diff !== 0) {
    return { ok: false, error: 'Token inválido' }
  }

  return { ok: true }
}
