// pages/api/mcp/index.js
// Endpoint MCP HTTP para Claude Cowork.
//
// Implementa JSON-RPC 2.0 sobre HTTP — los métodos del protocolo MCP que
// nos interesan son:
//   - initialize         (handshake inicial con el cliente)
//   - tools/list         (lista las tools disponibles)
//   - tools/call         (ejecuta una tool con argumentos)
//
// Auth: header `Authorization: Bearer ${CLAUDE_MCP_TOKEN}`.
//
// Spec MCP: https://spec.modelcontextprotocol.io/specification/

import { validarTokenCowork } from '../../../lib/mcp/auth'
import { TOOLS, ejecutarTool } from '../../../lib/mcp/tools'

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_INFO = {
  name: 'julia-bakery',
  version: '0.1.0',
}

export default async function handler(req, res) {
  // Solo POST (JSON-RPC sobre HTTP). MCP también soporta SSE pero v0.1 va con
  // request/response simple.
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Validar token de Cowork.
  const auth = validarTokenCowork(req)
  if (!auth.ok) {
    return res.status(401).json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32001, message: auth.error || 'Unauthorized' },
    })
  }

  const { jsonrpc, id, method, params } = req.body || {}

  if (jsonrpc !== '2.0') {
    return res.status(400).json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32600, message: 'Invalid Request (jsonrpc must be 2.0)' },
    })
  }

  try {
    switch (method) {
      case 'initialize':
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        })

      case 'tools/list':
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        })

      case 'tools/call': {
        const { name, arguments: args } = params || {}
        if (!name) {
          return res.status(200).json({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Missing tool name' },
          })
        }
        const result = await ejecutarTool(name, args || {})
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: result?.ok === false,
          },
        })
      }

      case 'notifications/initialized':
        // El cliente nos avisa que está listo. Sin respuesta.
        return res.status(204).end()

      default:
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        })
    }
  } catch (e) {
    console.error('[api/mcp] ERROR:', e.message, e.stack)
    return res.status(500).json({
      jsonrpc: '2.0',
      id: id ?? null,
      error: { code: -32603, message: e.message || 'Internal error' },
    })
  }
}

export const config = { maxDuration: 30 }
