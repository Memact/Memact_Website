import { createClient } from "@supabase/supabase-js"

const env = import.meta.env || {}
const supabaseUrl = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
const authRedirectUrl = env.VITE_AUTH_REDIRECT_URL || env.NEXT_PUBLIC_AUTH_REDIRECT_URL || ""

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.")
  }
  return supabase
}

export function getAuthRedirectUrl() {
  if (authRedirectUrl) return authRedirectUrl
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL("/dashboard", window.location.origin).toString()
  }
  return "https://memact.com/dashboard"
}
