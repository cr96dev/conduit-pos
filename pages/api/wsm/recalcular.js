import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const OAKLAND_ID = '85da69a8-1e81-48a7-8b0d-82df9eeec15e'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const ayer = new Date()
  ayer.setDate(ayer.getDate() - 1)
  const fecha = ayer.toISOString().split('T')[0]

  const { error } = await supabase.rpc('calcular_wsm', {
    p_estacion_id: OAKLAND_ID,
    p_fecha: fecha
  })

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true, fecha })
}
