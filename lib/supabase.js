import { createClient } from '@supabase/supabase-js'

// Fallbacks vacíos solo para que el build pase sin env vars (caso del
// landing público en conduitgt.net que no necesita DB). En cada tenant
// estos se sobreescriben con las claves reales del Supabase del tenant.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder_anon_key_for_build_only'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
