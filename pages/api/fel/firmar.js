import { requireAuth } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const auth = await requireAuth(req)
  if (auth.error) return res.status(auth.status).json({ error: auth.error })

  try {
    const resp = await fetch('https://signer-emisores.feel.com.gt/sign_solicitud_firmas/firma_xml', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(req.body)
    })

    const text = await resp.text()
    res.status(200).json({ xml: text })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
