import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './supabase/database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase env vars: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required')
}

const databaseClient = createClient<Database>(supabaseUrl, supabaseAnonKey)

// New generated-schema integrations use the typed alias. Existing handwritten
// wrappers retain their accepted client surface until they are migrated
// deliberately; both aliases point to the same authenticated client instance.
export const databaseSupabase = databaseClient
export const supabase: SupabaseClient = databaseClient
