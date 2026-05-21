// lib/loyverse/client.js
// Cliente HTTP para Loyverse API v1.0 (https://api.loyverse.com/v1.0/).
//
// Auth: Personal Access Token via env LOYVERSE_ACCESS_TOKEN.
// Paginacion: cursor-based. Endpoints de listado devuelven { <recurso>: [...], cursor? }.
//   Si viene `cursor`, hay mas paginas. Se pasa como query param ?cursor=...
// Rate limit: ~300 req/min segun docs. Cuando devuelven 429 abortamos el tick;
//   el siguiente cron (15 min despues) retomara desde el cursor persistido.

const BASE_URL = 'https://api.loyverse.com/v1.0'
const PAGE_LIMIT = 250            // tope que acepta Loyverse en la mayoria de endpoints
const DEFAULT_TIMEOUT_MS = 45_000 // 45s: receipts puede tardar 20-30s en responder cuando hay backlog
                                  // (cabe holgado en el deadline de 50s del cron)

export class LoyverseRateLimitError extends Error {
  constructor(message, retryAfter) {
    super(message)
    this.name = 'LoyverseRateLimitError'
    this.retryAfter = retryAfter
  }
}

export class LoyverseClient {
  constructor({ accessToken, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    const token = accessToken || process.env.LOYVERSE_ACCESS_TOKEN
    if (!token) throw new Error('LOYVERSE_ACCESS_TOKEN no configurada')
    this.token = token
    this.timeoutMs = timeoutMs
  }

  // GET arbitrario. Devuelve el JSON parseado.
  // Lanza LoyverseRateLimitError en 429 y Error en cualquier otro fallo HTTP.
  async get(path, query = {}) {
    const url = new URL(BASE_URL + path)
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue
      url.searchParams.set(k, String(v))
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let response
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/json',
        },
        signal: controller.signal,
      })
    } catch (e) {
      throw new Error(`Loyverse GET ${path} fallo de red: ${e.message}`)
    } finally {
      clearTimeout(timer)
    }

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10)
      throw new LoyverseRateLimitError(
        `Loyverse rate limit en ${path}. retry-after=${retryAfter}s`,
        retryAfter
      )
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Loyverse ${response.status} en ${path}: ${body.substring(0, 400)}`)
    }

    return response.json()
  }

  // Itera todas las paginas de un endpoint de listado.
  //
  //   for await (const page of client.paginate('/receipts', { created_at_min: '...' })) {
  //     // page.items = registros de esta pagina
  //     // page.cursor = cursor que esa pagina dejo (para persistir)
  //   }
  //
  // - `resourceKey`: la propiedad del JSON donde viene el array (ej. 'receipts').
  // - `startCursor`: si pasamos cursor previo, retomamos desde ahi.
  // - `maxPages`: tope de seguridad. Default Infinity para drenar todo.
  async *paginate(path, {
    resourceKey,
    query = {},
    startCursor = null,
    limit = PAGE_LIMIT,
    maxPages = Infinity,
  }) {
    if (!resourceKey) throw new Error('paginate requiere resourceKey')

    let cursor = startCursor
    let pagesYielded = 0

    while (pagesYielded < maxPages) {
      const json = await this.get(path, { ...query, limit, cursor: cursor || undefined })
      const items = json[resourceKey] || []
      cursor = json.cursor || null

      yield { items, cursor, raw: json }
      pagesYielded++

      if (!cursor) break
    }
  }
}

export function getClient() {
  return new LoyverseClient()
}
