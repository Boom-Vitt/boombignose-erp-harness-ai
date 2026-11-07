// Build-time guard: importing this module from any Client Component throws, so
// the service-role key can never leak into the browser bundle.
import "server-only"
import { createClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/types/database"
import { runtimeSupabaseEnv } from "@/lib/supabase/runtime-env"

/**
 * SERVER-ONLY service-role Supabase client. Bypasses Row Level Security, so it
 * must NEVER be imported into client code or exposed to the browser. Use it only
 * in trusted server contexts that have no user session and authenticate by other
 * means — e.g. the cron route, which validates an `X-Cron-Secret` header before
 * touching data. Every query made through this client must scope `org_id`
 * itself, because RLS will not do it for you.
 *
 * The service-role key lives in `SUPABASE_SERVICE_ROLE_KEY` (server env only) and
 * must never be logged or returned in a response.
 */
export function createAdminClient() {
  const { url } = runtimeSupabaseEnv()
  const env = process.env
  return createClient<Database>(
    url,
    env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}
