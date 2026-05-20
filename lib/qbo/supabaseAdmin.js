// lib/qbo/supabaseAdmin.js
// Cliente Supabase con service role key para operaciones admin de QBO
// Usar SOLO desde API routes (server-side), NUNCA en el cliente

import { createClient } from '@supabase/supabase-js'

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
