// pages/api/analyze.js
// Proxy a Anthropic Messages API (Haiku). Requiere usuario autenticado para
// evitar abuso del API key compartido.
import { requireAuth } from '../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  try {
    const { data, prompt } = req.body;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ analysis: 'Error: ANTHROPIC_API_KEY no configurada' });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Eres un analista de datos experto.\n${prompt}\n\nDatos:\n${JSON.stringify(data, null, 2)}`
          }
        ]
      }),
    });

    const result = await response.json();

    if (result.error) {
      return res.status(400).json({ analysis: `Error API: ${result.error.message}` });
    }

    const text = result.content?.[0]?.text ?? "Sin respuesta";
    return res.status(200).json({ analysis: text });

  } catch (err) {
    return res.status(500).json({ analysis: `Error servidor: ${err.message}` });
  }
}
