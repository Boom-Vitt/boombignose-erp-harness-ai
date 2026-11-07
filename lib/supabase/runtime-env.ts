/** Keep the env-object lookup opaque to Next's NEXT_PUBLIC build-time inlining. */
export function runtimeSupabaseEnv() {
  const env = Reflect.get(process, "env") as NodeJS.ProcessEnv
  return {
    url: env["NEXT_PUBLIC_SUPABASE_URL"] ?? "",
    anonKey: env["NEXT_PUBLIC_SUPABASE_ANON_KEY"] ?? "",
  }
}
