export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const { usuario, llave, identificador, body: felBody } = req.body

  try {
    const resp = await fetch('https://certificador.feel.com.gt/fel/certificacion/v2/dte/', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Usuario':       usuario,
        'Llave':         llave,
        'Identificador': identificador
      },
      body: JSON.stringify(felBody)
    })

    const data = await resp.json()
    res.status(200).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
